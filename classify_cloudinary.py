#!/usr/bin/env python3
"""
Cloudinary Photo Classifier using CLIP
Automatically tags photos in your Cloudinary account with color, location, and subject labels.

Usage:
    python classify_cloudinary.py              # Process all folders (skip already-labeled)
    python classify_cloudinary.py portfolio    # Process only portfolio folder
    python classify_cloudinary.py rugby        # Process only rugby folder
    python classify_cloudinary.py --force      # Re-label everything (ignore existing tags)
    python classify_cloudinary.py portfolio --force
"""

import torch
import clip
from PIL import Image
from PIL.ExifTags import TAGS
import requests
from io import BytesIO
import json
import cloudinary
import cloudinary.api
from tqdm import tqdm
import os
import sys
import re
import time
from datetime import datetime

# ============================================================================
# CONFIGURATION
# ============================================================================

def load_config():
    config_path = '.cloudinary-config'
    if not os.path.exists(config_path):
        print(f"Error: {config_path} not found!")
        print("Please create .cloudinary-config with your Cloudinary credentials:")
        print('''{
  "cloud_name": "your_cloud_name",
  "api_key": "your_api_key",
  "api_secret": "your_api_secret"
}''')
        sys.exit(1)

    with open(config_path, 'r') as f:
        return json.load(f)

config = load_config()

CLOUD_NAME = config['cloud_name']
API_KEY = config['api_key']
API_SECRET = config['api_secret']

# Tagging settings
COLOR_TAGS_PER_IMAGE = 2

# ============================================================================
# LABEL SETS  (only color — subject comes from filename, location from geocoding)
# ============================================================================

COLOR_LABELS = [
    # Color Palettes
    "warm colors", "cool colors", "pastel colors", "vibrant colors", "muted colors",
    "earth tones", "jewel tones", "neon colors", "monochromatic",

    # Dominant Colors
    "red dominant", "blue dominant", "green dominant", "yellow dominant",
    "orange dominant", "purple dominant", "pink dominant", "brown dominant",
    "gray dominant", "black dominant", "white dominant",

    # Color Characteristics
    "high saturation", "low saturation", "desaturated", "black and white",
    "grayscale", "sepia tone", "colorful", "multicolored"
]

# ============================================================================
# CLOUDINARY SETUP
# ============================================================================

cloudinary.config(
    cloud_name=CLOUD_NAME,
    api_key=API_KEY,
    api_secret=API_SECRET
)

def fetch_images_from_folder(folder_name):
    """Fetch all images from a single Cloudinary asset folder"""
    print(f"\nFetching from '{folder_name}' asset folder...")
    all_images = []
    next_cursor = None

    while True:
        try:
            result = cloudinary.api.resources_by_asset_folder(
                folder_name,
                max_results=500,
                next_cursor=next_cursor,
                context=True,
                image_metadata=True   # request EXIF/metadata where available
            )

            folder_images = result.get("resources", [])
            for img in folder_images:
                img["folder"] = folder_name

            all_images.extend(folder_images)
            next_cursor = result.get("next_cursor")

            print(f"  Fetched {len(folder_images)} images (total: {len(all_images)})")

            if not next_cursor:
                break
        except Exception as e:
            print(f"  Error fetching from '{folder_name}': {e}")
            break

    return [
        {
            "public_id": r["public_id"],
            "url": r["secure_url"],
            "folder": folder_name,
            "created_at": r.get("created_at", ""),
            "context": r.get("context", {}),
            "image_metadata": r.get("image_metadata", {})   # EXIF data from Cloudinary
        }
        for r in all_images
    ]

def fetch_all_images(folders=None):
    """Fetch all images from given folders (default: portfolio + rugby)"""
    if folders is None:
        folders = ["portfolio", "rugby", "favorites"]

    print("Fetching images from Cloudinary...")
    all_images = []
    for folder in folders:
        all_images.extend(fetch_images_from_folder(folder))

    print(f"\nTotal images found: {len(all_images)}")
    return all_images

# ============================================================================
# CLIP MODEL
# ============================================================================

print("Loading CLIP model...")

if torch.cuda.is_available():
    device = "cuda"
    print(f"Using device: NVIDIA CUDA GPU ({torch.cuda.get_device_name(0)})")
elif hasattr(torch.version, 'hip') and torch.version.hip is not None:
    device = "cuda"
    print("Using device: AMD ROCm GPU")
else:
    device = "cpu"
    print("Using device: CPU")

    import platform
    if platform.system() == "Windows":
        try:
            import torch_directml
            device = torch_directml.device()
            print("  DirectML device available — using AMD/Intel GPU acceleration")
        except ImportError:
            print("  No GPU acceleration available")
            print("  For AMD GPUs on Windows: pip install torch-directml")

model, preprocess = clip.load("ViT-B/32", device=device)
print("CLIP model loaded successfully!")

# ============================================================================
# CLIP TAGGING FUNCTIONS
# ============================================================================

def get_clip_tags(image, labels, top_k):
    try:
        image_input = preprocess(image).unsqueeze(0).to(device)
        text_inputs = clip.tokenize([f"a photo of {label}" for label in labels]).to(device)

        with torch.no_grad():
            image_features = model.encode_image(image_input)
            text_features = model.encode_text(text_inputs)
            image_features /= image_features.norm(dim=-1, keepdim=True)
            text_features /= text_features.norm(dim=-1, keepdim=True)
            similarity = (image_features @ text_features.T).squeeze(0)

        values, indices = similarity.topk(top_k)
        return [labels[i] for i in indices.cpu().numpy()]
    except Exception as e:
        print(f"    Error in CLIP tagging: {e}")
        return []

def download_image(url):
    try:
        low_res_url = url.replace('/upload/', '/upload/h_300,q_60,f_auto,c_fit/')
        response = requests.get(low_res_url, timeout=10)
        response.raise_for_status()
        image = Image.open(BytesIO(response.content))
        if image.mode != 'RGB':
            image = image.convert('RGB')
        return image
    except Exception as e:
        print(f"    Error downloading image: {e}")
        return None

def calculate_saturation(image):
    try:
        import numpy as np
        from colorsys import rgb_to_hsv

        img = image.copy()
        img.thumbnail((150, 150))
        pixels = np.array(img).reshape(-1, 3) / 255.0
        saturations = [rgb_to_hsv(p[0], p[1], p[2])[1] for p in pixels]
        return float(np.mean(saturations))
    except Exception as e:
        print(f"    Error calculating saturation: {e}")
        return 0.5

def get_color_palette(image, num_colors=5):
    try:
        import numpy as np
        from sklearn.cluster import KMeans

        img = image.copy()
        img.thumbnail((150, 150))
        pixels = np.array(img).reshape(-1, 3)

        kmeans = KMeans(n_clusters=num_colors, random_state=42, n_init=10)
        kmeans.fit(pixels)
        colors = kmeans.cluster_centers_
        labels_arr = kmeans.labels_
        counts = np.bincount(labels_arr)
        indices = np.argsort(-counts)

        return [
            {
                'r': int(colors[i][0]),
                'g': int(colors[i][1]),
                'b': int(colors[i][2]),
                'weight': float(counts[i] / len(labels_arr))
            }
            for i in indices
        ]
    except Exception as e:
        print(f"    Error extracting color palette: {e}")
        return [{'r': 128, 'g': 128, 'b': 128, 'weight': 1.0}]

def filter_bw_tags(color_tags, saturation):
    SATURATION_THRESHOLD = 0.15
    bw_keywords = ['black and white', 'grayscale', 'monochromatic', 'sepia tone', 'desaturated']

    if saturation > SATURATION_THRESHOLD:
        filtered = [t for t in color_tags if t.lower() not in bw_keywords]
        return filtered if filtered else color_tags
    return color_tags

def get_photo_date(image):
    try:
        exif_data = image._getexif()
        if exif_data is None:
            return None

        for tag_id, value in exif_data.items():
            if TAGS.get(tag_id) == 'DateTimeOriginal':
                try:
                    return datetime.strptime(value, "%Y:%m:%d %H:%M:%S").isoformat()
                except:
                    return value

        for tag_id, value in exif_data.items():
            if TAGS.get(tag_id) == 'DateTime':
                try:
                    return datetime.strptime(value, "%Y:%m:%d %H:%M:%S").isoformat()
                except:
                    return value

        return None
    except:
        return None

def get_date_from_cloudinary_metadata(image_metadata):
    """Extract date from Cloudinary image_metadata Title or Caption field (e.g. '12/1/2025')."""
    if not image_metadata:
        return None
    for field in ('Title', 'Caption', 'Caption-Abstract'):
        val = str(image_metadata.get(field, '')).strip()
        if not val:
            continue
        for fmt in ('%m/%d/%Y', '%Y:%m:%d %H:%M:%S', '%Y-%m-%dT%H:%M:%S', '%Y-%m-%d'):
            try:
                return datetime.strptime(val, fmt).isoformat()
            except ValueError:
                continue
        return val
    return None

# ============================================================================
# LOCATION & SUBJECT PARSING
# ============================================================================

def parse_gps_from_context(context):
    if not context or 'custom' not in context:
        return None
    alt_text = context['custom'].get('alt', '')
    if not alt_text:
        return None
    try:
        parts = alt_text.split(',')
        if len(parts) == 2:
            lat, lon = float(parts[0].strip()), float(parts[1].strip())
            return {"lat": lat, "lon": lon}
    except:
        pass
    return None

VALID_SUBJECTS = {"people", "earth", "conservation", "plant", "animal", "architecture", "other"}

# Map common filename variants to canonical subject names
SUBJECT_ALIASES = {
    "architexture": "architecture",
    "arch": "architecture",
    "person": "people",
    "human": "people",
    "humans": "people",
    "animals": "animal",
    "plants": "plant",
    "nature": "earth",
    "landscape": "earth",
    "wildlife": "animal",
}

def normalize_subject(raw):
    """Map a raw filename word to a canonical subject, or 'other' if unrecognized."""
    s = raw.lower().strip()
    if s in VALID_SUBJECTS:
        return s
    if s in SUBJECT_ALIASES:
        return SUBJECT_ALIASES[s]
    return "other"

def parse_gps_from_filename(public_id):
    """
    Extract GPS and subjects from filename convention:
    -0.8182833_-89.4654444_12345_animal_conservation
    Returns: ({"lat": ..., "lon": ...}, ["animal", "conservation"]) or (None, [])
    """
    filename = public_id.split('/')[-1]

    # Match coordinates: two signed floats, optional _digits, then optional _subjects
    match = re.match(r'^(-?\d+\.\d+)_(-?\d+\.\d+)(?:_\d+)?(?:_(.+))?$', filename)
    if match:
        try:
            lat = float(match.group(1))
            lon = float(match.group(2))
            subjects_str = match.group(3) or ''

            if -90 <= lat <= 90 and -180 <= lon <= 180:
                gps = {"lat": lat, "lon": lon}

                # Parse subjects: split on underscores, normalize, deduplicate
                subjects = []
                seen = set()
                if subjects_str:
                    for part in subjects_str.split('_'):
                        raw = part.replace('-', ' ').strip()
                        if not raw:
                            continue
                        canonical = normalize_subject(raw)
                        if canonical not in seen:
                            seen.add(canonical)
                            subjects.append(canonical)

                return gps, subjects
        except:
            pass

    return None, []

def get_location_and_subjects(public_id, context):
    """
    Get GPS + subjects with fallback chain:
    1. Context alt text for GPS
    2. Filename for GPS and subjects
    """
    location = parse_gps_from_context(context)
    filename_gps, subjects = parse_gps_from_filename(public_id)

    if location is None:
        location = filename_gps

    return location, subjects

def reverse_geocode(lat, lon):
    """
    Convert lat/lon to a human-readable location name using BigDataCloud (no key, no rate limit).
    Returns a string like "San Cristóbal, Ecuador" or "Colorado, USA"
    """
    try:
        url = (
            f"https://api.bigdatacloud.net/data/reverse-geocode-client"
            f"?latitude={lat}&longitude={lon}&localityLanguage=en"
        )
        response = requests.get(url, timeout=8)
        response.raise_for_status()
        data = response.json()

        region = data.get("principalSubdivision", "")
        country = data.get("countryName", "")
        country_code = data.get("countryCode", "")

        if country_code == "US":
            return f"{region}, USA" if region else "USA"
        else:
            if region and country:
                return f"{region}, {country}"
            elif country:
                return country
            return ""

    except Exception as e:
        print(f"    Geocoding error for ({lat}, {lon}): {e}")
        return ""

# ============================================================================
# EXIF / CAMERA METADATA
# ============================================================================

def extract_camera_metadata_from_pil(image):
    """Read camera metadata from PIL EXIF (primary source)."""
    meta = {}
    try:
        exif_data = image._getexif()
        if not exif_data:
            return meta

        for tag_id, value in exif_data.items():
            tag = TAGS.get(tag_id)

            if tag == 'Make':
                meta['camera_make'] = str(value).strip()
            elif tag == 'Model':
                meta['camera_model'] = str(value).strip()
            elif tag == 'LensModel':
                meta['lens'] = str(value).strip()
            elif tag == 'FocalLength':
                # Value is often a tuple (numerator, denominator)
                try:
                    meta['focal_length'] = str(round(float(value), 1))
                except:
                    meta['focal_length'] = str(value)
            elif tag == 'FNumber':
                try:
                    meta['aperture'] = str(round(float(value), 1))
                except:
                    meta['aperture'] = str(value)
            elif tag == 'ExposureTime':
                try:
                    val = float(value)
                    if val >= 1:
                        meta['shutter_speed'] = f"{val}s"
                    else:
                        # Express as fraction e.g. 1/500
                        denom = round(1 / val)
                        meta['shutter_speed'] = f"1/{denom}s"
                except:
                    meta['shutter_speed'] = str(value)
            elif tag == 'ISOSpeedRatings':
                meta['iso'] = str(value)

    except Exception:
        pass

    # Build combined camera string
    make = meta.get('camera_make', '')
    model = meta.get('camera_model', '')
    if make and model:
        meta['camera'] = model if model.startswith(make) else f"{make} {model}"
    elif model:
        meta['camera'] = model

    return meta

# ============================================================================
# MAIN PROCESSING
# ============================================================================

def process_image(img_data, existing_entry=None):
    """
    Process a single image. If existing_entry is provided, only re-run what's missing.
    Returns the result dict or None on failure.
    """
    public_id = img_data["public_id"]
    url = img_data["url"]
    folder = img_data.get("folder", "unknown")
    context = img_data.get("context", {})
    image_metadata_cloudinary = img_data.get("image_metadata", {})

    # --- Location & subjects from filename/context (no image download needed) ---
    location, subjects = get_location_and_subjects(public_id, context)

    # --- Geocode if we have coordinates and no location string yet ---
    location_name = ""
    if existing_entry and existing_entry.get("location_name"):
        location_name = existing_entry["location_name"]
    elif location:
        location_name = reverse_geocode(location["lat"], location["lon"])

    # --- Check if we need to download the image (color tagging + PIL EXIF + dimensions) ---
    need_color = existing_entry is None or not existing_entry.get("colors")
    need_camera = existing_entry is None or not existing_entry.get("camera")
    need_dimensions = existing_entry is None or not existing_entry.get("aspect_ratio")

    photo_date = existing_entry.get("created_at", "") if existing_entry else ""
    color_tags = existing_entry.get("colors", []) if existing_entry else []
    color_palette = existing_entry.get("color_palette", []) if existing_entry else []
    camera_meta = existing_entry.get("camera", {}) if existing_entry else {}
    aspect_ratio = existing_entry.get("aspect_ratio") if existing_entry else None
    width = existing_entry.get("width") if existing_entry else None
    height = existing_entry.get("height") if existing_entry else None

    if need_color or need_camera or need_dimensions:
        image = download_image(url)
        if image is None:
            return None

        if need_dimensions:
            width, height = image.size
            aspect_ratio = round(width / height, 4)

        if need_color:
            photo_date = get_photo_date(image)
            saturation = calculate_saturation(image)
            color_tags_raw = get_clip_tags(image, COLOR_LABELS, COLOR_TAGS_PER_IMAGE)
            color_tags = filter_bw_tags(color_tags_raw, saturation)
            color_palette = get_color_palette(image, num_colors=5)

        if need_camera:
            camera_meta = extract_camera_metadata_from_pil(image)
            if not need_color and not photo_date:
                photo_date = get_photo_date(image)

        if not photo_date:
            if camera_meta:
                photo_date = img_data.get("created_at", "")
            else:
                photo_date = get_date_from_cloudinary_metadata(image_metadata_cloudinary) or ""
    else:
        if not photo_date:
            photo_date = img_data.get("created_at", "")

    return {
        "url": url,
        "folder": folder,
        "created_at": photo_date,
        "location": location,
        "location_name": location_name,
        "subjects": subjects,
        "colors": color_tags,
        "color_palette": color_palette,
        "camera": camera_meta,
        "aspect_ratio": aspect_ratio,
        "width": width,
        "height": height,
        "all_tags": color_tags + subjects
    }

def process_all_images(folders=None, force=False):
    """Main function: fetch, optionally skip already-labeled, process, save."""

    # Load existing tags
    existing_tags = {}
    if os.path.exists('tags.json'):
        with open('tags.json', 'r') as f:
            existing_tags = json.load(f)
        print(f"Loaded {len(existing_tags)} existing entries from tags.json")

    images = fetch_all_images(folders)
    if not images:
        print("No images found!")
        return

    # Determine which images need processing
    to_process = []
    skipped = 0

    for img in images:
        pid = img["public_id"]
        if not force and pid in existing_tags:
            existing = existing_tags[pid]
            # Skip if already has colors, location processed, subjects present
            has_colors = bool(existing.get("colors"))
            if has_colors:
                skipped += 1
                # Still update subjects/location/camera from filename if missing
                if not existing.get("subjects") or not existing.get("location_name") or not existing.get("camera"):
                    to_process.append((img, existing))
                continue
        to_process.append((img, None if force else existing_tags.get(pid)))

    print(f"\n  Skipping {skipped} already-labeled images (use --force to re-label all)")
    print(f"  Processing {len(to_process)} images...")
    print("=" * 60)

    if force and folders:
        # Remove existing entries for the folders being reprocessed
        fetched_ids = {img["public_id"] for img in images}
        results = {k: v for k, v in existing_tags.items() if k not in fetched_ids}
    else:
        results = dict(existing_tags)  # start with existing

    for img_data, existing_entry in tqdm(to_process, desc="Processing images"):
        public_id = img_data["public_id"]
        try:
            result = process_image(img_data, existing_entry)
            if result is not None:
                results[public_id] = result
        except Exception as e:
            print(f"  Error processing {public_id}: {e}")

    # Remove stale entries (deleted from Cloudinary since last run)
    all_live_ids = {img["public_id"] for img in images}
    if folders is None:
        # Only purge when processing all folders (full run)
        stale = [pid for pid in results if pid not in all_live_ids]
        if stale:
            print(f"\n  Removing {len(stale)} stale entries no longer on Cloudinary...")
            for pid in stale:
                del results[pid]

    print("\n" + "=" * 60)
    print(f"Total entries in database: {len(results)}")

    with open('tags.json', 'w') as f:
        json.dump(results, f, indent=2)

    print(f"Results saved to tags.json")

    # Sample output
    new_entries = [(k, v) for k, v in results.items() if k in [img["public_id"] for img, _ in to_process]]
    if new_entries:
        sample_id, sample = new_entries[0]
        print(f"\nSample result: {sample_id}")
        print(f"  Colors:    {', '.join(sample.get('colors', []))}")
        print(f"  Subjects:  {', '.join(sample.get('subjects', []))}")
        print(f"  Location:  {sample.get('location_name', 'N/A')}")
        print(f"  Camera:    {sample.get('camera', {}).get('camera', 'N/A')}")

# ============================================================================
# ENTRY POINT
# ============================================================================

if __name__ == "__main__":
    print("=" * 60)
    print("CLOUDINARY PHOTO CLASSIFIER WITH CLIP")
    print("=" * 60)
    print()

    args = [a.lower() for a in sys.argv[1:]]
    force = "--force" in args
    folder_args = [a for a in args if a not in ("--force",)]

    if force:
        print("--force mode: re-labeling all images regardless of existing tags")

    valid_folders = {"portfolio", "rugby", "favorites"}
    folders = None  # None = all default folders

    if folder_args:
        unknown = [a for a in folder_args if a not in valid_folders]
        if unknown:
            print(f"Unknown argument(s): {', '.join(unknown)}")
            print("Usage: python classify_cloudinary.py [portfolio|rugby|favorites] [--force]")
            sys.exit(1)
        folders = folder_args

    process_all_images(folders=folders, force=force)

    print("\n" + "=" * 60)
    print("DONE! You can now use tags.json in your Photography World.")
    print("=" * 60)
