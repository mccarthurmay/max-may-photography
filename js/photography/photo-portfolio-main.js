import { loadPhotoDatabase } from './photo-data.js';
import { renderGrid } from './photo-portfolio.js';
import { initLightbox } from './photo-lightbox.js';

let allPhotos = [];       // all loaded photos for current view
let filteredPhotos = [];  // after filters applied
let currentView = 'grid'; // 'grid' | 'favorites'

let lastScrollTop = 0;
let scrollTimeout;

// ============================================================================
// FILTERS
// ============================================================================

const filterState = { year: '', location: '', subject: '' };

// Maps filter key → { pillId, dropdownId, labelDefault }
const FILTER_CONFIG = [
    { key: 'year',     pillId: 'pill-year',     dropdownId: 'dropdown-year',     label: 'Year'    },
    { key: 'location', pillId: 'pill-location',  dropdownId: 'dropdown-location', label: 'Country' },
    { key: 'subject',  pillId: 'pill-subject',   dropdownId: 'dropdown-subject',  label: 'Subject' },
];


function getYear(photo) {
    if (!photo.createdAt) return null;
    const d = new Date(photo.createdAt);
    return isNaN(d.getFullYear()) ? null : d.getFullYear();
}

function getCountry(photo) {
    if (!photo.location_name) return null;
    const parts = photo.location_name.split(',');
    return parts[parts.length - 1].trim() || null;
}

function populateFilters(photos) {
    const yearCounts = {}, locationCounts = {}, subjectCounts = {};

    photos.forEach(photo => {
        const y = getYear(photo);
        if (y) yearCounts[y] = (yearCounts[y] || 0) + 1;
        const country = getCountry(photo);
        if (country) locationCounts[country] = (locationCounts[country] || 0) + 1;
        (photo.subjects || []).forEach(s => {
            if (s) subjectCounts[s] = (subjectCounts[s] || 0) + 1;
        });
    });

    buildDropdown('year',     Object.keys(yearCounts).sort((a,b) => b - a), yearCounts);
    buildDropdown('location', Object.keys(locationCounts).sort(),            locationCounts);
    buildDropdown('subject',  Object.keys(subjectCounts).sort(),             subjectCounts);
}

function buildDropdown(key, values, counts) {
    const cfg = FILTER_CONFIG.find(c => c.key === key);
    const el = document.getElementById(cfg.dropdownId);
    if (!el) return;
    el.innerHTML = '';
    values.forEach(v => {
        const item = document.createElement('div');
        item.className = 'filter-dropdown-item' + (filterState[key] === v ? ' selected' : '');
        item.innerHTML = `<span class="item-label">${v}</span><span class="item-count">${counts[v]}</span>`;
        item.addEventListener('click', () => selectFilter(key, v, cfg));
        el.appendChild(item);
    });
}

function selectFilter(key, value, cfg) {
    // Toggle off if already selected
    filterState[key] = filterState[key] === value ? '' : value;
    closeAllDropdowns();
    applyFilters();
    updatePillState(cfg);
    updateResetVisibility();
}

function updatePillState(cfg) {
    const pill = document.getElementById(cfg.pillId);
    if (!pill) return;
    const val = filterState[cfg.key];
    pill.classList.toggle('active', !!val);

    const labelEl = pill.querySelector('.pill-label');
    const countEl = pill.querySelector('.pill-count');

    if (val) {
        // Truncate long values
        const display = val.length > 16 ? val.slice(0, 14) + '…' : val;
        labelEl.textContent = display;
        const matchCount = filteredPhotos.length;
        if (!countEl) {
            const badge = document.createElement('span');
            badge.className = 'pill-count';
            badge.textContent = matchCount;
            pill.appendChild(badge);
        } else {
            countEl.textContent = matchCount;
        }
    } else {
        labelEl.textContent = cfg.label;
        if (countEl) countEl.remove();
    }

    // Refresh dropdown item selected states
    const dropdown = document.getElementById(cfg.dropdownId);
    if (dropdown) {
        dropdown.querySelectorAll('.filter-dropdown-item').forEach(item => {
            item.classList.toggle('selected', item.querySelector('.item-label').textContent === filterState[cfg.key]);
        });
    }
}

function updateResetVisibility() {
    const resetPill = document.getElementById('pill-reset');
    if (!resetPill) return;
    const hasAny = Object.values(filterState).some(Boolean);
    resetPill.style.display = hasAny ? '' : 'none';
}

function applyFilters() {
    filteredPhotos = allPhotos.filter(photo => {
        if (filterState.year     && String(getYear(photo)) !== filterState.year) return false;
        if (filterState.location && getCountry(photo) !== filterState.location) return false;
        if (filterState.subject  && !(photo.subjects || []).includes(filterState.subject)) return false;
        return true;
    });
    renderGrid(filteredPhotos);
}

function closeAllDropdowns() {
    document.querySelectorAll('.filter-dropdown').forEach(d => d.classList.remove('open'));
}

function positionDropdown(pillEl, dropdownEl) {
    const pillRect = pillEl.getBoundingClientRect();
    const dropW = dropdownEl.offsetWidth || 200;
    // Center dropdown above the pill
    let left = pillRect.left + pillRect.width / 2 - dropW / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - dropW - 8));
    dropdownEl.style.left = left + 'px';
}

function initFilters() {
    FILTER_CONFIG.forEach(cfg => {
        const pill = document.getElementById(cfg.pillId);
        const dropdown = document.getElementById(cfg.dropdownId);
        if (!pill || !dropdown) return;

        pill.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = dropdown.classList.contains('open');
            closeAllDropdowns();
            if (!isOpen) {
                dropdown.classList.add('open');
                positionDropdown(pill, dropdown);
            }
        });
    });

    document.getElementById('pill-reset')?.addEventListener('click', () => {
        filterState.year = '';
        filterState.location = '';
        filterState.subject = '';
        FILTER_CONFIG.forEach(cfg => updatePillState(cfg));
        updateResetVisibility();
        closeAllDropdowns();
        applyFilters();
    });

    // Close dropdowns when clicking outside
    document.addEventListener('click', () => closeAllDropdowns());
}

// ============================================================================
// VIEW SWITCHING (Grid / Favorites)
// ============================================================================

function getViewFromHash() {
    return window.location.hash === '#favorites' ? 'favorites' : 'grid';
}

function updateNavActiveState(view) {
    document.querySelectorAll('.nav-link[data-view]').forEach(a => {
        a.classList.toggle('active', a.dataset.view === view);
    });
}

async function switchView(view) {
    if (view === currentView && allPhotos.length > 0) return;
    currentView = view;
    updateNavActiveState(view);

    const folder = view === 'favorites' ? 'favorites' : 'portfolio';

    // Clear grid
    const grid = document.getElementById('portfolio-grid');
    if (grid) grid.innerHTML = '';

    allPhotos = await loadPhotoDatabase(folder);

    if (allPhotos.length === 0) {
        if (grid) grid.innerHTML = `<p style="padding:40px;opacity:.5">No photos found in '${folder}' folder.</p>`;
        return;
    }

    populateFilters(allPhotos);
    filteredPhotos = [...allPhotos];
    renderGrid(filteredPhotos);
}

// ============================================================================
// LIGHTBOX INFO PANEL
// ============================================================================

export function populateLightboxInfo(photo) {
    const panel = document.getElementById('lightbox-info');
    if (!panel) return;

    const cam = photo.camera || {};

    function setRow(id, value) {
        const row = document.getElementById(id);
        const val = document.getElementById(id + '-val');
        if (row && val) {
            if (value) {
                val.textContent = value;
                row.style.display = '';
            } else {
                row.style.display = 'none';
            }
        }
    }

    setRow('info-location', photo.location_name || '');
    setRow('info-date', formatDate(photo.createdAt));
    setRow('info-camera', cam.camera || '');
    setRow('info-lens', cam.lens || '');
    setRow('info-focal', cam.focal_length ? cam.focal_length + ' mm' : '');
    setRow('info-aperture', cam.aperture ? 'f/' + cam.aperture : '');
    setRow('info-shutter', cam.shutter_speed || '');
    setRow('info-iso', cam.iso ? 'ISO ' + cam.iso : '');

    // Show panel only if at least one field has data
    const hasData = ['info-location', 'info-date', 'info-camera', 'info-focal',
                     'info-aperture', 'info-shutter', 'info-iso']
        .some(id => document.getElementById(id)?.style.display !== 'none');

    panel.classList.toggle('hidden', !hasData);
}

function formatDate(dateStr) {
    if (!dateStr) return '';
    try {
        const d = new Date(dateStr);
        if (isNaN(d)) return '';
        return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    } catch {
        return '';
    }
}

// ============================================================================
// INERTIA SCROLL
// ============================================================================

function initInertiaScroll() {
    const view = document.getElementById('portfolio-view');
    if (!view) return;

    const EASE = 0.07;
    let target = 0;
    let current = 0;

    // Intercept wheel — accumulate target, prevent native scroll
    view.addEventListener('wheel', (e) => {
        e.preventDefault();
        target += e.deltaY;
        // Clamp to scrollable range
        const max = view.scrollHeight - view.clientHeight;
        target = Math.max(0, Math.min(target, max));
    }, { passive: false });

    function tick() {
        current += (target - current) * EASE;

        // Snap when close enough to avoid infinite micro-updates
        if (Math.abs(target - current) < 0.2) current = target;

        view.scrollTop = current;
        requestAnimationFrame(tick);
    }

    requestAnimationFrame(tick);
}

// ============================================================================
// NAVIGATION HIDE ON SCROLL
// ============================================================================

function initNavigation() {
    const mainNav = document.getElementById('main-nav');
    const portfolioView = document.getElementById('portfolio-view');

    if (portfolioView) {
        portfolioView.addEventListener('scroll', () => {
            const scrollTop = portfolioView.scrollTop;
            clearTimeout(scrollTimeout);

            if (scrollTop > lastScrollTop && scrollTop > 100) {
                mainNav.classList.add('hidden');
            } else {
                mainNav.classList.remove('hidden');
            }

            lastScrollTop = scrollTop;

            scrollTimeout = setTimeout(() => {
                mainNav.classList.remove('hidden');
            }, 5000);
        }, { passive: true });
    }
}

// ============================================================================
// INIT
// ============================================================================

async function init() {
    try {
        initLightbox();
        initFilters();
        initNavigation();
        initInertiaScroll();

        const view = getViewFromHash();
        await switchView(view);

        // Handle back/forward navigation
        window.addEventListener('hashchange', () => {
            switchView(getViewFromHash());
        });

        // Handle nav link clicks
        document.querySelectorAll('.nav-link[data-view]').forEach(a => {
            a.addEventListener('click', (e) => {
                e.preventDefault();
                const view = a.dataset.view;
                window.location.hash = view === 'favorites' ? 'favorites' : '';
                switchView(view);
            });
        });

    } catch (error) {
        console.error('Error initializing portfolio:', error);
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
