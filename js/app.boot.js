// ================== КАСТОМНЫЕ СЕЛЕКТЫ ==================
function initCustomSelects() {
    document.querySelectorAll('.custom-select').forEach(select => {
        const trigger = select.querySelector('.custom-select-trigger');
        const options = select.querySelector('.custom-options');
        trigger.addEventListener('click', (e) => {
            e.stopPropagation();
            if (activeSelect && activeSelect !== select) activeSelect.classList.remove('open');
            select.classList.toggle('open');
            activeSelect = select.classList.contains('open') ? select : null;
        });
        options.addEventListener('click', (e) => {
            const option = e.target.closest('.custom-option');
            if (!option) return;
            trigger.querySelector('span:first-child').textContent = option.textContent;
            options.querySelectorAll('.custom-option').forEach(o => o.classList.remove('selected'));
            option.classList.add('selected');
            select.classList.remove('open');
            activeSelect = null;
            applyFilters();
        });
    });
    document.addEventListener('click', () => {
        if (activeSelect) { activeSelect.classList.remove('open'); activeSelect = null; }
    });
}

// ================== СКЕЛЕТОНЫ ==================
function showSkeletons(container, count = 6) {
    container.innerHTML = '';
    for (let i = 0; i < count; i++) {
        const skel = document.createElement('div');
        skel.className = 'skeleton-card';
        skel.innerHTML = `<div class="skeleton-img"></div><div class="skeleton-info"><div class="skeleton-title"></div><div class="skeleton-title short"></div></div>`;
        container.appendChild(skel);
    }
}

// ================== ИНИЦИАЛИЗАЦИЯ ==================
document.addEventListener('DOMContentLoaded', async () => {
    const splash = document.getElementById('splash-screen');
    const splashAnimation = splash ? new Promise(resolve => {
        const progress = splash.querySelector('.splash-progress-fill');
        if (!progress || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            resolve();
            return;
        }

        const timeout = setTimeout(finish, 3500);
        function finish(event) {
            if (event && (event.target !== progress || event.animationName !== 'fillProgress')) return;
            clearTimeout(timeout);
            progress.removeEventListener('animationend', finish);
            resolve();
        }
        progress.addEventListener('animationend', finish);
    }) : Promise.resolve();

    applyGridSettings();
    if (window.electronAPI && window.electronAPI.onRefresh) {
        window.electronAPI.onRefresh(async () => {
            await API.init(); allReleasesCache = []; filtersInitialized = false;
            const activeTab = document.querySelector('.nav-btn.active');
            if (activeTab) switchTab(activeTab.id.replace('btn-', ''));
            await renderMainPage();
        });
    }
    
    const grid = document.getElementById('recent-releases-grid');
    if (grid) showSkeletons(grid, 10);

    await API.init(); 
    initCustomSelects();
    const today = new Date().getDay();
    currentDayIndex = today === 0 ? 6 : today - 1;
    await renderMainPage();
    await splashAnimation;
    if (splash) splash.classList.add('hidden');
    document.body.classList.add('loaded');

    updateMobileNav();
    window.addEventListener('resize', updateMobileNav);
});

function updateMobileNav() {
    const isMobile = window.innerWidth <= 768;
    const mobileNav = document.getElementById('mobile-nav');
    const desktopHeader = document.getElementById('desktop-header');
    if (isMobile) {
        if (mobileNav) mobileNav.style.display = 'flex';
        if (desktopHeader) desktopHeader.style.display = 'none';
    } else {
        if (mobileNav) mobileNav.style.display = 'none';
        if (desktopHeader) desktopHeader.style.display = 'flex';
    }
}

function switchTab(tab) {
    const activeTab = document.querySelector('.nav-btn.active') || document.querySelector('.bottom-nav-btn.active');
    if (activeTab) {
        const prevTab = activeTab.id.replace('btn-', '').replace('mob-', '');
        scrollPositions[prevTab] = window.scrollY;
    }

    document.querySelectorAll('.tab-content').forEach(el => el.style.display = 'none');
    document.querySelectorAll('.nav-btn').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.bottom-nav-btn').forEach(el => el.classList.remove('active'));

    const tabEl = document.getElementById(`tab-${tab}`); 
    const btnEl = document.getElementById(`btn-${tab}`);
    const mobBtnEl = document.getElementById(`btn-mob-${tab}`);
    
    if (tabEl) tabEl.style.display = 'block'; 
    if (btnEl) btnEl.classList.add('active');
    if (mobBtnEl) mobBtnEl.classList.add('active');
    
    if (tab === 'schedule') renderSchedule();
    if (tab === 'history') renderHistory();
    if (tab === 'all') { 
        releasePage_showing = releasePage_limit; 
        if (!filtersInitialized) { initFilters(); filtersInitialized = true; } 
        renderAllReleases(); 
    }
    if (tab === 'favorites') renderFavorites();
    if (tab === 'catalog') renderContinueWatching();
    
    const releasePage = document.getElementById('release-page'); if (releasePage) releasePage.remove();
    setTimeout(() => {
        window.scrollTo({ top: scrollPositions[tab] || 0, behavior: 'instant' });
    }, 50);
}
