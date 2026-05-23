// Simple lightbox handlers without Three.js dependencies

export function initLightbox() {
    const lightboxClose = document.getElementById('lightbox-close');
    const lightboxBackdrop = document.getElementById('lightbox-backdrop');

    if (lightboxClose) {
        lightboxClose.addEventListener('click', closeLightbox);
    }

    if (lightboxBackdrop) {
        lightboxBackdrop.addEventListener('click', closeLightbox);
    }

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            closeLightbox();
        }
    });
}

export function openLightbox(imageUrl, altText = '') {
    const lightbox = document.getElementById('photo-lightbox');
    const lightboxImage = document.getElementById('lightbox-image');

    if (lightbox && lightboxImage) {
        lightboxImage.src = imageUrl;
        lightboxImage.alt = altText;

        lightbox.classList.remove('hidden');
        lightbox.classList.add('visible');
    }
}

function closeLightbox() {
    const lightbox = document.getElementById('photo-lightbox');
    const lightboxImage = document.getElementById('lightbox-image');

    if (lightbox) {
        lightbox.classList.remove('visible');
        lightbox.classList.add('hidden');

        // Clear the image to prevent showing stale image on next open
        if (lightboxImage) {
            lightboxImage.classList.remove('loaded');
            lightboxImage.src = '';
        }

        document.getElementById('lightbox-info')?.classList.add('hidden');
    }
}
