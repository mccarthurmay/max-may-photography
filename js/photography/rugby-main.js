import { loadPhotoDatabase } from './photo-data.js';
import { initPortfolioView } from './photo-portfolio.js';
import { initLightbox } from './photo-lightbox.js';

let lastScrollTop = 0;
let scrollTimeout;

async function init() {
    try {
        const photos = await loadPhotoDatabase('rugby');

        if (photos.length === 0) {
            console.error('No rugby photos found. Run classify_cloudinary.py first!');
            return;
        }

        // Initialize portfolio grid view
        initPortfolioView(photos);

        // Initialize lightbox handlers
        initLightbox();

        // Initialize hide-on-scroll navigation
        initNavigation();

        console.log('Rugby view initialized with', photos.length, 'photos');
    } catch (error) {
        console.error('Error initializing rugby view:', error);
    }
}

// Navigation hide-on-scroll
function initNavigation() {
    const mainNav = document.getElementById('main-nav');
    const portfolioView = document.getElementById('portfolio-view');

    if (portfolioView) {
        portfolioView.addEventListener('scroll', () => {
            const scrollTop = portfolioView.scrollTop;

            // Clear existing timeout
            clearTimeout(scrollTimeout);

            // Hide nav when scrolling down, show when scrolling up
            if (scrollTop > lastScrollTop && scrollTop > 100) {
                // Scrolling down & past threshold
                mainNav.classList.add('hidden');
            } else {
                // Scrolling up
                mainNav.classList.remove('hidden');
            }

            lastScrollTop = scrollTop;

            // Show nav again after user stops scrolling for 2 seconds
            scrollTimeout = setTimeout(() => {
                mainNav.classList.remove('hidden');
            }, 2000);
        });
    }
}

// Start
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
