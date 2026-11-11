// ================== ПОИСК ==================
function searchAnime() { clearTimeout(searchTimer); searchTimer = setTimeout(() => doSearchAnime(), 400); }

async function doSearchAnime() {
    const query = document.getElementById('search-input').value.trim(); if (!query) return switchTab('catalog');
    switchTab('all'); const grid = document.getElementById('all-releases-grid'); showSkeletons(grid, 6);
    if (allReleasesCache.length === 0) { await renderAllReleases(); }
    const lowerQuery = query.toLowerCase(); const results = [];
    const isAdultMode = storage.getSetting('adultMode', false);

    for (const animeObj of API.videoData) {
        const id = String(animeObj.shikimoriId); if (id === 'null') continue;
        const meta = await API.getAnimeMeta(id);
        if (!isAdultMode && isAdult(meta)) continue;

        const titles = [animeObj.title || '', meta?.russian || '', meta?.name || ''].map(t => String(t).toLowerCase());
        let matched = titles.some(t => isMatch(t, lowerQuery));
        if (!matched && animeObj.voice_team) { matched = animeObj.voice_team.some(v => isMatch(String(v), lowerQuery)); }
        
        if (matched) { results.push({ id, animeObj, meta }); }
    }
    grid.innerHTML = ''; const loadMoreBtn = document.getElementById('btn-load-more'); if (loadMoreBtn) loadMoreBtn.style.display = 'none';
    if (results.length === 0) { grid.innerHTML = '<p class="empty-msg">Ничего не найдено</p>'; return; }
    results.forEach(({ id, animeObj, meta }) => {
        let imgUrl = '';
        if (animeObj.poster && animeObj.poster.startsWith('http')) { imgUrl = animeObj.poster; }
        else if (meta?.image && meta.image.original) { imgUrl = meta.image.original.startsWith('http') ? meta.image.original : `https://shikimori.one${meta.image.original}`; }
        const title = meta?.russian || animeObj.title || meta?.name || 'Без названия'; const isFav = storage.isFavorite(id);
        const card = document.createElement('div'); card.className = 'anime-card'; card.dataset.id = id; card.onclick = () => openAnimePage(animeObj);
        card.innerHTML = `<div class="card-img-wrapper"><div class="favorite-btn ${isFav ? 'active' : ''}" onclick="handleToggleFavorite(event, '${id}', '${title.replace(/'/g, "\\'")}', '${imgUrl}')">${isFav ? '★' : '☆'}</div><img src="${imgUrl}" alt="${title}"></div><div class="card-info"><div class="title">${title}</div></div>`;
        grid.appendChild(card);
    });
}

function handleSearchKey(event) {
    if (event.key === 'Enter') {
        event.preventDefault(); const query = document.getElementById('search-input').value.trim();
        if (query && query.length >= 2) { storage.addSearchQuery(query); hideSearchHistory(); clearTimeout(searchTimer); doSearchAnime(); }
    }
}
function showSearchHistory() {
    const box = document.getElementById('search-history'); if (!box) return;
    const history = storage.getSearchHistory();
    if (history.length === 0) { box.innerHTML = '<div class="search-history-empty">Здесь появятся ваши запросы</div>'; }
    else { box.innerHTML = history.map(q => `<div class="search-history-item" onclick="selectSearchQuery('${q.replace(/'/g, "\\'")}')"><span class="history-text">${q}</span></div>`).join(''); }
    box.style.display = 'block';
}
function hideSearchHistory() { const box = document.getElementById('search-history'); if (box) box.style.display = 'none'; }
function selectSearchQuery(query) { document.getElementById('search-input').value = query; doSearchAnime(); hideSearchHistory(); }
function clearSearchHistory() { storage.clearSearchHistory(); showSearchHistory(); }

// ================== СЛУЧАЙНОЕ АНИМЕ ==================
async function openRandomAnime() {
    const existingMenu = document.getElementById('random-menu-popup'); if (existingMenu) { existingMenu.remove(); return; }
    if (allReleasesCache.length === 0) await renderAllReleases();
    
    const genresSet = new Set(); 
    const themesSet = new Set(); 
    const yearsSet = new Set();

    allReleasesCache.forEach(({ anime }) => { 
        if (anime.genres) anime.genres.forEach(g => {
            const genreName = g.russian || g.name;
            if (['Школа', 'Повседневность', 'Гарем', 'Исекай', 'Меха', 'Магия', 'Демоны', 'Вампиры', 'Спорт', 'Музыка', 'Историческое'].includes(genreName)) {
                themesSet.add(genreName);
            } else {
                genresSet.add(genreName);
            }
        }); 
        if (anime.aired_on) yearsSet.add(anime.aired_on.split('-')[0]); 
    });
    
    const genres = [...genresSet].filter(Boolean).sort(); 
    const themes = [...themesSet].filter(Boolean).sort();
    const years = [...yearsSet].filter(Boolean).sort((a, b) => b - a);
    
    const btn = document.querySelector('.random-btn'); 
    if (!btn) return; 
    const rect = btn.getBoundingClientRect();
    
    const menu = document.createElement('div'); 
    menu.id = 'random-menu-popup';
    menu.innerHTML = `
        <div class="random-menu-header">Случайное аниме</div>
        <div class="random-filter-group">
            <label>Жанр:</label>
            <div class="custom-select" id="random-select-genre">
                <div class="custom-select-trigger"><span>Любой</span><span class="arrow">▼</span></div>
                <div class="custom-options">
                    <div class="custom-option selected" data-value="">Любой</div>
                    ${genres.map(g => `<div class="custom-option" data-value="${g}">${g}</div>`).join('')}
                </div>
            </div>
        </div>
        <div class="random-filter-group">
            <label>Тема:</label>
            <div class="custom-select" id="random-select-theme">
                <div class="custom-select-trigger"><span>Любая</span><span class="arrow">▼</span></div>
                <div class="custom-options">
                    <div class="custom-option selected" data-value="">Любая</div>
                    ${themes.map(t => `<div class="custom-option" data-value="${t}">${t}</div>`).join('')}
                </div>
            </div>
        </div>
        <div class="random-filter-group">
            <label>Год:</label>
            <div class="custom-select" id="random-select-year">
                <div class="custom-select-trigger"><span>Любой</span><span class="arrow">▼</span></div>
                <div class="custom-options">
                    <div class="custom-option selected" data-value="">Любой</div>
                    ${years.map(y => `<div class="custom-option" data-value="${y}">${y}</div>`).join('')}
                </div>
            </div>
        </div>
        <div class="random-filter-group">
            <label>Рейтинг:</label>
            <div class="custom-select" id="random-select-rating">
                <div class="custom-select-trigger"><span>Любой</span><span class="arrow">▼</span></div>
                <div class="custom-options">
                    <div class="custom-option selected" data-value="">Любой</div>
                    <div class="custom-option" data-value="g">G - Без ограничений</div>
                    <div class="custom-option" data-value="pg">PG - Детям</div>
                    <div class="custom-option" data-value="pg_13">PG-13 - 13+</div>
                    ${storage.getSetting('adultMode', false) ? `<div class="custom-option" data-value="r_17">R-17 - 17+</div>
                    <div class="custom-option" data-value="r_plus">R+ - 18+</div>
                    <div class="custom-option" data-value="rx">Rx - 18++</div>` : ''}
                </div>
            </div>
        </div>
        <button class="random-menu-item random-roll-btn" onclick="doRandomAnime()"><span>Крутить</span></button>
    `;
    
    menu.style.position = 'absolute'; 
    menu.style.top = `${rect.bottom + window.scrollY + 10}px`; 
    menu.style.left = `${rect.left + window.scrollX - 120}px`;
    document.body.appendChild(menu);

    menu.querySelectorAll('.custom-select').forEach(select => {
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
        });
    });

    setTimeout(() => { document.addEventListener('click', function closeMenu(e) { 
        if (!menu.contains(e.target) && e.target !== btn) { menu.remove(); document.removeEventListener('click', closeMenu); } 
    }); }, 100);
}

async function doRandomAnime() {
    const genre = document.querySelector('#random-select-genre .custom-option.selected')?.dataset.value || '';
    const theme = document.querySelector('#random-select-theme .custom-option.selected')?.dataset.value || '';
    const year = document.querySelector('#random-select-year .custom-option.selected')?.dataset.value || '';
    const rating = document.querySelector('#random-select-rating .custom-option.selected')?.dataset.value || '';
    
    document.getElementById('random-menu-popup')?.remove(); 
    if (allReleasesCache.length === 0) await renderAllReleases();
    
    const isAdultMode = storage.getSetting('adultMode', false);
    
    const filtered = allReleasesCache.filter(({ anime }) => { 
        if (!isAdultMode && isAdult(anime)) return false;
        
        if (genre && !(anime.genres || []).some(g => (g.russian || g.name) === genre)) return false; 
        if (theme && !(anime.genres || []).some(g => (g.russian || g.name) === theme)) return false; 
        if (year && (!anime.aired_on || anime.aired_on.split('-')[0] !== year)) return false; 
        if (rating && anime.rating !== rating) return false;
        
        return true; 
    });
    
    if (filtered.length === 0) { showAlert('Нет аниме с такими параметрами! Попробуй другие.', 'Пусто'); return; }
    const randomItem = filtered[Math.floor(Math.random() * filtered.length)]; 
    const videoData = API.findVideoAnime(randomItem.id);
    openAnimePage(videoData || { shikimoriId: randomItem.id });
}

window.addEventListener('beforeunload', () => { try { saveCurrentPosition(); } catch (e) { /* игнорируем */ } });

// ================== МЕНЮ СОЦСЕТЕЙ ==================
function toggleSocialMenu(e) { if (e) e.stopPropagation(); const menu = document.getElementById('social-menu'); if (menu) menu.classList.toggle('show'); }
document.addEventListener('click', () => { const menu = document.getElementById('social-menu'); if (menu && menu.classList.contains('show')) menu.classList.remove('show'); });
