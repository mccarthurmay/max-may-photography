export async function loadPhotoDatabase(folderFilter = null) {
    const response = await fetch('tags.json');
    const data = await response.json();

    let photos = Object.entries(data).map(([id, info]) => ({
        id: id,
        cloudinaryUrl: info.url,
        folder: info.folder || 'unknown',
        location: info.location || null,
        location_name: info.location_name || '',
        subjects: info.subjects || [],
        colorTags: info.colors || [],
        allTags: info.all_tags || [],
        colorPalette: info.color_palette || [{ r: 128, g: 128, b: 128, weight: 1.0 }],
        createdAt: info.created_at || '',
        camera: info.camera || {},
        aspectRatio: info.aspect_ratio || 1,
        width: info.width || null,
        height: info.height || null,
    }));

    if (folderFilter) {
        photos = photos.filter(photo => photo.folder === folderFilter);
    }

    return photos;
}

// Cloudinary URL transformation
export function getPhotoURL(cloudinaryUrl, size = 'thumbnail') {
    const transforms = {
        thumbnail: '/h_300,q_60,f_auto,c_fit/',   // Small, lower quality for dimension check
        grid: '/h_900,q_75,f_auto,c_fit/',         // Grid previews
        large: '/h_1400,q_80,f_auto,c_fit/',       // Lightbox full view
        original: '/'
    };

    const transform = transforms[size] || transforms.grid;
    return cloudinaryUrl.replace('/upload/', `/upload${transform}`);
}
