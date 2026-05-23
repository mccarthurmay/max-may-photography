import { getPhotoURL } from './photo-data.js';
import { populateLightboxInfo } from './photo-portfolio-main.js';

// ============================================================================
// LAZY LOAD
// ============================================================================

let observer = null;

function setupLazyLoadObserver() {
    const portfolioView = document.getElementById('portfolio-view');

    if (observer) observer.disconnect();

    observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (!entry.isIntersecting) return;
            const img = entry.target;
            if (img.dataset.src) {
                img.src = img.dataset.src;
                delete img.dataset.src;
            }
            observer.unobserve(img);
        });
    }, {
        root: portfolioView,
        rootMargin: '200px',   // preload slightly before visible
        threshold: 0
    });

    document.querySelectorAll('img[data-src]').forEach(img => observer.observe(img));
}

// ============================================================================
// GRID ITEM
// ============================================================================

function createGridItem(photo, eagerLoad) {
    const item = document.createElement('div');
    item.className = 'portfolio-photo';

    const img = document.createElement('img');
    img.alt = (photo.subjects || []).join(', ') || photo.location_name || '';

    if (eagerLoad) {
        img.src = getPhotoURL(photo.cloudinaryUrl, 'grid');
        item.classList.add('loaded');
    } else {
        img.dataset.src = getPhotoURL(photo.cloudinaryUrl, 'grid');
        img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
    }

    img.addEventListener('load', () => {
        if (!img.src.startsWith('data:')) item.classList.add('loaded');
    });
    img.addEventListener('error', () => {
        item.remove();
    });

    item.addEventListener('click', () => openLightbox(photo));
    item.appendChild(img);
    return item;
}

// ============================================================================
// LIGHTBOX (inline, portfolio-specific)
// ============================================================================

function openLightbox(photo) {
    const lightbox = document.getElementById('photo-lightbox');
    const lightboxImage = document.getElementById('lightbox-image');
    if (!lightbox || !lightboxImage) return;

    lightboxImage.classList.remove('loaded');
    lightboxImage.src = getPhotoURL(photo.cloudinaryUrl, 'original');
    lightboxImage.alt = (photo.subjects || []).join(', ');
    lightboxImage.onload = () => lightboxImage.classList.add('loaded');

    populateLightboxInfo(photo);

    lightbox.classList.remove('hidden');
    lightbox.classList.add('visible');
}

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Render the masonry grid for a given photo array.
 * Clears existing grid content, sorts by color, and re-builds columns.
 */
export function renderGrid(photos) {
    const gridContainer = document.getElementById('portfolio-grid');
    if (!gridContainer) return;

    gridContainer.innerHTML = '';

    if (!photos || photos.length === 0) {
        gridContainer.innerHTML = '<p style="padding:40px;opacity:.5">No photos match the current filters.</p>';
        return;
    }

    const sorted = [...photos].sort((a, b) => {
        const da = a.createdAt ? new Date(a.createdAt) : new Date(0);
        const db = b.createdAt ? new Date(b.createdAt) : new Date(0);
        return db - da;
    });
    const columns = 3;
    const cols = [];

    for (let i = 0; i < columns; i++) {
        const col = document.createElement('div');
        col.className = 'portfolio-column';
        gridContainer.appendChild(col);
        cols.push(col);
    }

    const heights = new Array(columns).fill(0);

    sorted.forEach((photo, index) => {
        let shortest = 0;
        for (let i = 1; i < columns; i++) {
            if (heights[i] < heights[shortest]) shortest = i;
        }

        const item = createGridItem(photo, index < 9);
        cols[shortest].appendChild(item);
        heights[shortest] += 1 / (photo.aspectRatio || 1);
    });

    setupLazyLoadObserver();
}

// Keep named export for legacy callers
export function initPortfolioView(photos) {
    renderGrid(photos);
}

export function clearPortfolioView() {
    const gridContainer = document.getElementById('portfolio-grid');
    if (gridContainer) gridContainer.innerHTML = '';
}
