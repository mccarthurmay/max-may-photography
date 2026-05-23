import { loadPhotoDatabase, getPhotoURL } from './photo-data.js';
import { populateLightboxInfo } from './photo-portfolio-main.js';

let map;
let markerCluster;
let photosByLocation = {};

async function initMap() {
    // Initialize Leaflet map - center on US
    map = L.map('map-container').setView([39.8283, -98.5795], 4);

    // Add topographic tile layer with natural colors
    L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors, © OpenTopoMap',
        maxZoom: 17
    }).addTo(map);

    // Cluster group
    markerCluster = L.markerClusterGroup({
        maxClusterRadius: 60,
        iconCreateFunction: () => L.divIcon({
            className: 'photo-marker cluster-marker',
            iconSize: [26, 26],
            iconAnchor: [13, 13]
        })
    });
    map.addLayer(markerCluster);

    // Load photos and create markers
    await loadPhotosAndCreateMarkers();
}

async function loadPhotosAndCreateMarkers() {
    // Load all photos from database
    const allPhotos = await loadPhotoDatabase();
    const photos = allPhotos.filter(p => p.folder !== 'favorites');

    // Group photos by location
    photosByLocation = groupPhotosByLocation(photos);

    console.log(`Found ${Object.keys(photosByLocation).length} unique locations`);

    // Create markers for each location
    Object.entries(photosByLocation).forEach(([locationKey, locationPhotos]) => {
        createLocationMarker(locationKey, locationPhotos);
    });

    // Fit map to show all markers if there are any
    const bounds = Object.keys(photosByLocation).map(key => {
        const [lat, lon] = key.split(',').map(Number);
        return [lat, lon];
    });

    if (bounds.length > 0) {
        map.fitBounds(bounds, { padding: [50, 50] });
    }
}

function groupPhotosByLocation(photos) {
    const grouped = {};

    photos.forEach(photo => {
        if (photo.location && photo.location.lat && photo.location.lon) {
            const key = `${photo.location.lat},${photo.location.lon}`;

            if (!grouped[key]) {
                grouped[key] = [];
            }

            grouped[key].push(photo);
        }
    });

    return grouped;
}

function createLocationMarker(locationKey, photos) {
    const [lat, lon] = locationKey.split(',').map(Number);

    // Create custom icon
    const icon = L.divIcon({
        className: 'photo-marker',
        iconSize: [20, 20],
        iconAnchor: [10, 10]
    });

    // Create marker
    const marker = L.marker([lat, lon], { icon });
    markerCluster.addLayer(marker);

    // Create popup content
    const popupContent = createPopupContent(photos);

    // Bind popup
    marker.bindPopup(popupContent, {
        maxWidth: 600,
        className: 'photo-popup'
    });

    // Center map on marker when popup opens - offset to position popup better
    marker.on('click', () => {
        // Pan the marker up (north) to make room for popup below
        const offset = map.getSize().y * 0.30; // Move up 30% of viewport height
        const targetPoint = map.project([lat, lon], map.getZoom()).subtract([0, offset]);
        const targetLatLng = map.unproject(targetPoint, map.getZoom());

        map.setView(targetLatLng, map.getZoom(), {
            animate: true,
            duration: 0.5
        });
    });
}

function createPopupContent(photos) {
    const container = document.createElement('div');
    container.className = 'photo-popup-content';

    // Create 2 columns
    const columns = [
        document.createElement('div'),
        document.createElement('div')
    ];
    columns.forEach(col => {
        col.className = 'popup-column';
        container.appendChild(col);
    });

    // Distribute photos using greedy algorithm (shortest column first)
    const columnHeights = [0, 0];

    photos.forEach(photo => {
        // Find shortest column
        const shortestIndex = columnHeights[0] <= columnHeights[1] ? 0 : 1;

        // Create photo item
        const item = document.createElement('div');
        item.className = 'photo-popup-item';

        const img = document.createElement('img');
        img.src = getPhotoURL(photo.cloudinaryUrl, 'grid');
        img.alt = photo.allTags ? photo.allTags.join(', ') : '';
        img.loading = 'lazy';

        // Click to open lightbox
        item.addEventListener('click', () => {
            openLightbox(photo);
        });

        item.appendChild(img);
        columns[shortestIndex].appendChild(item);

        // Update column height (using aspect ratio)
        columnHeights[shortestIndex] += (1 / (photo.aspectRatio || 1));
    });

    return container;
}

function openLightbox(photoData) {
    const lightbox = document.getElementById('photo-lightbox');
    const lightboxImage = document.getElementById('lightbox-image');

    if (!lightbox || !lightboxImage) {
        console.error('Lightbox elements not found');
        return;
    }

    // Remove loaded class to start fade from 0 (portfolio style)
    lightboxImage.classList.remove('loaded');

    // Load full original quality
    lightboxImage.src = getPhotoURL(photoData.cloudinaryUrl, 'original');
    lightboxImage.alt = photoData.allTags ? photoData.allTags.join(', ') : '';

    // Add loaded class when image is fully loaded
    lightboxImage.onload = () => {
        lightboxImage.classList.add('loaded');
    };

    populateLightboxInfo(photoData);

    lightbox.classList.remove('hidden');
    lightbox.classList.add('visible');
}

function initLightbox() {
    const lightbox = document.getElementById('photo-lightbox');
    const closeBtn = document.getElementById('lightbox-close');
    const backdrop = document.getElementById('lightbox-backdrop');

    if (!lightbox || !closeBtn || !backdrop) {
        console.error('Lightbox elements not found');
        return;
    }

    closeBtn.addEventListener('click', closeLightbox);
    backdrop.addEventListener('click', closeLightbox);

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeLightbox();
        }
    });
}

function closeLightbox() {
    const lightbox = document.getElementById('photo-lightbox');
    const lightboxImage = document.getElementById('lightbox-image');

    if (lightbox) {
        lightbox.classList.remove('visible');
        lightbox.classList.add('hidden');
    }

    if (lightboxImage) {
        lightboxImage.classList.remove('loaded');
        lightboxImage.src = '';
    }

    const infoPanel = document.getElementById('lightbox-info');
    if (infoPanel) infoPanel.classList.add('hidden');
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    initMap();
    initLightbox();
});
