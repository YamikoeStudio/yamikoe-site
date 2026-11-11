// ================== ГЛАВНАЯ ==================
const homeCardCount = () => Math.min(releasePage_limit, 30);
async function renderMainPage() {
    const grid = document.getElementById('recent-releases-grid');
    const randomContainer = document.getElementById('random-anime-list'); if (!grid) return;
    
    renderContinueWatching();
    showSkeletons(grid, 10);
    grid.innerHTML = ''; let recentIds = []; const uniqueIds = new Set();
    const isAdultMode = storage.getSetting('adultMode', false);

    if (API.scheduleData && API.scheduleData.length > 0) {
        for (let i = 0; i < API.scheduleData.length; i++) {
            let idx = (currentDayIndex - i + API.scheduleData.length) % API.scheduleData.length;
            const day = API.scheduleData[idx];
            (day.items || []).forEach(it => {
                const id = String(it.shikimoriId || it["shikimoriId"]);
                if (id && id !== 'null' && !uniqueIds.has(id)) { uniqueIds.add(id); recentIds.push(id); }
            });
            if (recentIds.length >= homeCardCount()) break;
        }
    }
    if (recentIds.length === 0) recentIds = API.getAllUniqueIds();
    const seenTitles = new Set();
    const homeIds = recentIds.slice(0, homeCardCount());
    const homeAnime = await API.getAnimeMetas(homeIds);
    for (let index = 0; index < homeIds.length; index++) {
        const id = homeIds[index];
        const anime = homeAnime[index]; if (!anime) continue;
        if (!isAdultMode && isAdult(anime)) continue;
        
        const title = anime.russian || anime.name || ''; const titleKey = title.toLowerCase().trim();
        if (seenTitles.has(titleKey)) continue; seenTitles.add(titleKey);
        const videoData = API.findVideoAnime(id);
        let imgUrl = ''; if (anime.image && anime.image.original) { imgUrl = anime.image.original.startsWith('http') ? anime.image.original : `https://shikimori.one${anime.image.original}`; }
        const isFav = storage.isFavorite(id); let statusBadge = ''; if (anime.score) statusBadge = `<span class="badge">★ ${anime.score}</span>`;
        const card = document.createElement('div'); card.className = 'anime-card'; card.dataset.id = id; card.onclick = () => openAnimePage(videoData || { shikimoriId: id });
        card.innerHTML = `<div class="card-img-wrapper"><div class="favorite-btn ${isFav ? 'active' : ''}" onclick="handleToggleFavorite(event, '${id}', '${title.replace(/'/g, "\\'")}', '${imgUrl}')">${isFav ? '★' : '☆'}</div><img src="${imgUrl}" alt="${title}" onerror="this.style.display='none'">${statusBadge}</div><div class="card-info"><div class="title">${title}</div></div>`;
        grid.appendChild(card);
    }

    if (randomContainer) {
        randomContainer.innerHTML = '';
        const allIds = API.getAllUniqueIds().sort(() => 0.5 - Math.random())
            .filter(id => !uniqueIds.has(id));
        let added = 0;
        for (let offset = 0; offset < allIds.length && added < 4; offset += 4) {
            const batchIds = allIds.slice(offset, offset + 4);
            const batchAnime = await API.getAnimeMetas(batchIds);
            for (let index = 0; index < batchIds.length && added < 4; index++) {
                const id = batchIds[index];
                const anime = batchAnime[index]; if (!anime) continue;
                if (!isAdultMode && isAdult(anime)) continue;
                const title = anime.russian || anime.name || ''; const titleKey = title.toLowerCase().trim();
                if (seenTitles.has(titleKey)) continue; seenTitles.add(titleKey);
                const videoData = API.findVideoAnime(id);
                let imgUrl = ''; if (anime.image && anime.image.original) { imgUrl = anime.image.original.startsWith('http') ? anime.image.original : `https://shikimori.one${anime.image.original}`; }
                const desc = getDescription(anime, videoData);
                const row = document.createElement('div'); row.className = 'random-anime-row'; row.onclick = () => openAnimePage(videoData || { shikimoriId: id });
                row.innerHTML = `<img src="${imgUrl}" alt="${title}" onerror="this.style.display='none'"><div class="random-anime-info"><h3>${title}</h3><p>${desc}</p></div>`;
                randomContainer.appendChild(row); added++;
            }
        }
    }
}

// ================== ПРОДОЛЖИТЬ ПРОСМОТР ==================
let continueRenderToken = 0;
async function renderContinueWatching() {
    const token = ++continueRenderToken;
    const title = document.getElementById('continue-watching-title');
    const grid = document.getElementById('continue-watching-grid');
    if (!title || !grid) return;

    const history = storage.getHistory();
    const continueItems = [];

    for (const item of history) {
        const positions = storage.cache.playbackPositions[item.id];
        if (positions) {
            const epKeys = Object.keys(positions);
            if (epKeys.length > 0) {
                let lastEp = epKeys.sort((a,b) => Number(b) - Number(a))[0];
                let pos = positions[lastEp];
                if (pos > 5) {
                    continueItems.push({ ...item, lastEp, pos });
                }
            }
        }
        if (continueItems.length >= 5) break;
    }

    if (continueItems.length === 0) {
        title.style.display = 'none';
        grid.style.display = 'none';
        return;
    }

    title.style.display = 'block';
    grid.style.display = 'grid';
    grid.innerHTML = '';

    const isAdultMode = storage.getSetting('adultMode', false);

    for (const item of continueItems) {
        const meta = await API.getAnimeMeta(item.id);
        if (token !== continueRenderToken) return;
        if (!isAdultMode && isAdult(meta)) continue;
        
        const card = document.createElement('div');
        card.className = 'anime-card';
        card.onclick = () => openAnimePage({ shikimoriId: item.id });
        const videoData = API.findVideoAnime(item.id);
        const epCount = videoData ? videoData.episodes.length : 12;
        const knownDuration = storage.getPlaybackDuration(item.id, item.lastEp) || 1440;
        const percent = Math.min(100, Math.round((item.pos / knownDuration) * 100));

        card.innerHTML = `
            <div class="card-img-wrapper">
                <img src="${item.image}" alt="${item.title}">
                <span class="badge" style="background: rgba(168, 85, 247, 0.8); color: #fff;">Серия ${item.lastEp}</span>
            </div>
            <div class="card-info">
                <div class="title">${item.title}</div>
                <div class="progress-track" style="margin-top: 8px; height: 4px;">
                    <div class="progress-fill" style="width: ${percent}%;"></div>
                </div>
            </div>
        `;
        grid.appendChild(card);
    }
}

// ================== РАСПИСАНИЕ ==================
function renderSchedule() {
    const container = document.getElementById('schedule-box'); if (!container) return;
    if (!API.scheduleData || API.scheduleData.length === 0) { container.innerHTML = '<p class="empty-msg">Расписание пусто</p>'; return; }
    const group = API.scheduleData[currentDayIndex]; const itemsList = group ? (group.items || []) : [];
    let html = `<div class="schedule-controls"><button class="arrow-btn" onclick="changeDay(-1)">&lt;</button><div class="days-tabs">`;
    API.scheduleData.forEach((item, idx) => { const dName = item.day || `День ${idx + 1}`; const activeClass = idx === currentDayIndex ? 'active-day' : ''; html += `<button class="day-tab-btn ${activeClass}" onclick="selectDay(${idx})">${dName}</button>`; });
    html += `</div><button class="arrow-btn" onclick="changeDay(1)">&gt;</button></div><div id="day-anime-grid" class="anime-grid"><p class="loading-msg">Загрузка...</p></div>`;
    container.innerHTML = html;
    const grid = document.getElementById('day-anime-grid'); grid.innerHTML = '';
    if (itemsList.length === 0) { grid.innerHTML = '<p class="empty-msg">В этот день релизов нет</p>'; return; }
    const seenIds = new Set(); const seenTitles = new Set();
    const isAdultMode = storage.getSetting('adultMode', false);
    (async () => {
        for (const item of itemsList) {
            const id = String(item.shikimoriId || item["shikimoriId"]); if (seenIds.has(id)) continue; seenIds.add(id);
            const anime = await API.getAnimeMeta(id); if (!anime) continue;
            if (!isAdultMode && isAdult(anime)) continue;
            const title = anime.russian || anime.name || ''; const titleKey = title.toLowerCase().trim();
            if (seenTitles.has(titleKey)) continue; seenTitles.add(titleKey);
            let imgUrl = ''; if (anime.image && anime.image.original) { imgUrl = anime.image.original.startsWith('http') ? anime.image.original : `https://shikimori.one${anime.image.original}`; }
            const isFav = storage.isFavorite(id);
            const card = document.createElement('div'); card.className = 'anime-card'; card.dataset.id = id; card.onclick = () => openAnimePage(item);
            card.innerHTML = `<div class="card-img-wrapper"><div class="favorite-btn ${isFav ? 'active' : ''}" onclick="handleToggleFavorite(event, '${id}', '${title.replace(/'/g, "\\'")}', '${imgUrl}')">${isFav ? '★' : '☆'}</div><img src="${imgUrl}" alt="${title}"></div><div class="card-info"><div class="title">${title}</div></div>`;
            grid.appendChild(card);
        }
    })();
}
function changeDay(delta) { currentDayIndex = (currentDayIndex + delta + API.scheduleData.length) % API.scheduleData.length; renderSchedule(); }
function selectDay(index) { currentDayIndex = index; renderSchedule(); }

// ================== ВСЕ РЕЛИЗЫ ==================
async function renderAllReleases() {
    const grid = document.getElementById('all-releases-grid'); if (!grid) return;
    showSkeletons(grid, 10);
    
    if (allReleasesCache.length === 0) {
        const allIds = API.getAllUniqueIds().filter(id => id !== 'null');
        const animeList = await API.getAnimeMetas(allIds);
        const seenTitles = new Set();
        for (let index = 0; index < allIds.length; index++) {
            const id = allIds[index];
            const anime = animeList[index]; if (!anime) continue;
            const title = anime.russian || anime.name || ''; const titleKey = title.toLowerCase().trim();
            if (seenTitles.has(titleKey)) continue; seenTitles.add(titleKey);
            allReleasesCache.push({ id, anime });
        }
        initFilters();
        filtersInitialized = true;
    }
    applyFilters();
}

function initFilters() {
    const genresSet = new Set();
    const yearsSet = new Set();
    const voiceSet = new Set();
    const isAdultMode = storage.getSetting('adultMode', false);

    allReleasesCache.forEach(({ id, anime }) => {
        if (anime.genres) anime.genres.forEach(g => {
            const genreName = g.russian || g.name;
            const adultGenres = ['Эротика', 'Хентай', 'Этти'];
            if (!isAdultMode && adultGenres.includes(genreName)) return;
            genresSet.add(genreName);
        });
        if (anime.aired_on) yearsSet.add(anime.aired_on.split('-')[0]);
        
        const videoData = API.findVideoAnime(id);
        if (videoData && videoData.voice_team) {
            videoData.voice_team.forEach(v => voiceSet.add(v));
        }
    });

    if (isAdultMode) {
        genresSet.add('Эротика');
        genresSet.add('Хентай');
        genresSet.add('Этти');
    }

    const genreSelect = document.getElementById('select-genre');
    if (genreSelect) {
        const optionsDiv = genreSelect.querySelector('.custom-options');
        const genres = [...genresSet].filter(Boolean).sort();
        optionsDiv.innerHTML = `<div class="custom-option selected" data-value="">Все жанры</div>` +
            genres.map(g => `<div class="custom-option" data-value="${String(g).replace(/"/g, '&quot;')}">${g}</div>`).join('');
    }

    const yearSelect = document.getElementById('select-year');
    if (yearSelect) {
        const optionsDiv = yearSelect.querySelector('.custom-options');
        const years = [...yearsSet].filter(Boolean).sort((a, b) => b - a);
        optionsDiv.innerHTML = `<div class="custom-option selected" data-value="">Все годы</div>` +
            years.map(y => `<div class="custom-option" data-value="${y}">${y}</div>`).join('');
    }

    const voiceSelect = document.getElementById('select-voice');
    if (voiceSelect) {
        const optionsDiv = voiceSelect.querySelector('.custom-options');
        const voices = [...voiceSet].filter(Boolean).sort();
        optionsDiv.innerHTML = `<div class="custom-option selected" data-value="">Все</div>` +
            voices.map(v => `<div class="custom-option" data-value="${String(v).replace(/"/g, '&quot;')}">${v}</div>`).join('');
    }
}

function applyFilters() {
    const grid = document.getElementById('all-releases-grid'); if (!grid) return;
    const genre = document.querySelector('#select-genre .custom-option.selected')?.dataset.value || '';
    const year = document.querySelector('#select-year .custom-option.selected')?.dataset.value || '';
    const voice = document.querySelector('#select-voice .custom-option.selected')?.dataset.value || '';
    const sort = document.querySelector('#select-sort .custom-option.selected')?.dataset.value || 'rating';
    const isAdultMode = storage.getSetting('adultMode', false);

    let filtered = allReleasesCache.filter(({ id, anime }) => {
        if (!isAdultMode && isAdult(anime)) return false;
        if (genre && !(anime.genres || []).some(g => (g.russian || g.name) === genre)) return false;
        if (year && (!anime.aired_on || anime.aired_on.split('-')[0] !== year)) return false;
        
        if (voice) {
            const videoData = API.findVideoAnime(id);
            const team = videoData?.voice_team || [];
            if (!team.includes(voice)) return false;
        }
        return true;
    });

    filtered.sort((a, b) => {
        if (sort === 'rating') return (b.anime.score || 0) - (a.anime.score || 0);
        if (sort === 'name') return (a.anime.russian || '').localeCompare(b.anime.russian || '');
        if (sort === 'year') return (b.anime.aired_on || '').localeCompare(a.anime.aired_on || '');
        if (sort === 'episodes') return (b.anime.episodes || 0) - (a.anime.episodes || 0);
        return 0;
    });
    grid.innerHTML = ''; if (filtered.length === 0) { grid.innerHTML = '<p class="empty-msg">Ничего не найдено</p>'; return; }
    const toShow = filtered.slice(0, releasePage_showing);
    toShow.forEach(({ id, anime }) => {
        const videoData = API.findVideoAnime(id); let imgUrl = '';
        if (anime.image && anime.image.original) { imgUrl = anime.image.original.startsWith('http') ? anime.image.original : `https://shikimori.one${anime.image.original}`; }
        const title = anime.russian || anime.name || ''; const isFav = storage.isFavorite(id);
        let statusBadge = ''; if (anime.score) statusBadge = `<span class="badge">★ ${anime.score}</span>`;
        const card = document.createElement('div'); card.className = 'anime-card'; card.dataset.id = id; card.onclick = () => openAnimePage(videoData || { shikimoriId: id });
        card.innerHTML = `<div class="card-img-wrapper"><div class="favorite-btn ${isFav ? 'active' : ''}" onclick="handleToggleFavorite(event, '${id}', '${title.replace(/'/g, "\\'")}', '${imgUrl}')">${isFav ? '★' : '☆'}</div><img src="${imgUrl}" alt="${title}">${statusBadge}</div><div class="card-info"><div class="title">${title}</div></div>`;
        grid.appendChild(card);
    });
    const loadMoreBtn = document.getElementById('btn-load-more');
    if (loadMoreBtn) { if (releasePage_showing < filtered.length) { loadMoreBtn.style.display = 'inline-block'; loadMoreBtn.textContent = `Показать ещё (${filtered.length - releasePage_showing} осталось) ▼`; } else { loadMoreBtn.style.display = 'none'; } }
}
function loadMoreReleases() { releasePage_showing += releasePage_limit; applyFilters(); }
function resetFilters() {
    releasePage_showing = releasePage_limit;
    const genreSelect = document.getElementById('select-genre');
    if (genreSelect) { genreSelect.querySelector('.custom-select-trigger span:first-child').textContent = 'Все жанры'; genreSelect.querySelectorAll('.custom-option').forEach(o => o.classList.remove('selected')); genreSelect.querySelector('.custom-option[data-value=""]').classList.add('selected'); }
    const yearSelect = document.getElementById('select-year');
    if (yearSelect) { yearSelect.querySelector('.custom-select-trigger span:first-child').textContent = 'Все годы'; yearSelect.querySelectorAll('.custom-option').forEach(o => o.classList.remove('selected')); yearSelect.querySelector('.custom-option[data-value=""]').classList.add('selected'); }
    const voiceSelect = document.getElementById('select-voice');
    if (voiceSelect) { voiceSelect.querySelector('.custom-select-trigger span:first-child').textContent = 'Все'; voiceSelect.querySelectorAll('.custom-option').forEach(o => o.classList.remove('selected')); voiceSelect.querySelector('.custom-option[data-value=""]').classList.add('selected'); }
    const sortSelect = document.getElementById('select-sort');
    if (sortSelect) { sortSelect.querySelector('.custom-select-trigger span:first-child').textContent = 'По рейтингу'; sortSelect.querySelectorAll('.custom-option').forEach(o => o.classList.remove('selected')); sortSelect.querySelector('.custom-option[data-value="rating"]').classList.add('selected'); }
    applyFilters();
}

// ================== ИЗБРАННОЕ ==================
function handleToggleFavorite(event, id, title, imgUrl) {
    if (event) event.stopPropagation(); const isNowFav = storage.toggleFavorite({ id, title, image: imgUrl });
    document.querySelectorAll('.anime-card').forEach(card => { if (String(card.dataset.id) !== String(id)) return; const btn = card.querySelector('.favorite-btn'); if (!btn) return; btn.classList.toggle('active', isNowFav); btn.textContent = isNowFav ? '★' : '☆'; });
    const relBtn = document.querySelector('.fav-release-btn'); if (relBtn && String(relBtn.dataset.id) === String(id)) { relBtn.classList.toggle('active', isNowFav); relBtn.textContent = isNowFav ? 'В избранном' : 'В избранное'; }
}
function renderFavorites() {
    const grid = document.getElementById('favorites-grid'); if (!grid) return; grid.innerHTML = '';
    const favs = storage.getFavorites(); if (favs.length === 0) { grid.innerHTML = '<div class="empty-favorites"><div class="icon">★</div><p>Здесь пока пусто</p></div>'; return; }
    const isAdultMode = storage.getSetting('adultMode', false);
    (async () => {
        for (const fav of favs) {
            if (!isAdultMode) {
                const anime = await API.getAnimeMeta(fav.id);
                if (isAdult(anime)) continue;
            }
            const card = document.createElement('div'); card.className = 'anime-card'; card.dataset.id = fav.id; card.onclick = () => openAnimePage({ shikimoriId: fav.id });
            card.innerHTML = `<div class="card-img-wrapper"><div class="favorite-btn active" onclick="handleToggleFavorite(event, '${fav.id}', '${fav.title.replace(/'/g, "\\'")}', '${fav.image}')">★</div><img src="${fav.image}" alt="${fav.title}"></div><div class="card-info"><div class="title">${fav.title}</div></div>`;
            grid.appendChild(card);
        }
    })();
}

// ================== ИСТОРИЯ ==================
function renderHistory() {
    const grid = document.getElementById('history-grid'); if (!grid) return; grid.innerHTML = '';
    const history = storage.getHistory(); if (history.length === 0) { grid.innerHTML = '<p class="empty-msg">История пуста</p>'; return; }
    const isAdultMode = storage.getSetting('adultMode', false);
    (async () => {
        for (const item of history) {
            if (!isAdultMode) {
                const anime = await API.getAnimeMeta(item.id);
                if (isAdult(anime)) continue;
            }
            const card = document.createElement('div'); card.className = 'anime-card history-card' + (deleteMode ? ' delete-mode' : ''); card.dataset.id = item.id;
            card.onclick = () => { if (!deleteMode) openAnimePage({ shikimoriId: item.id }); };
            const deleteBadge = deleteMode ? `<div class="delete-badge" onclick="removeFromHistory(event, '${item.id}')">✕</div>` : '';
            card.innerHTML = `<div class="card-img-wrapper">${deleteBadge}<img src="${item.image}" alt="${item.title}"></div><div class="card-info"><div class="title">${item.title}</div></div>`;
            grid.appendChild(card);
        }
    })();
}
async function clearAnimeHistory() { if (!await showConfirm('Очистить историю?', 'Очистка')) return; storage.clearHistory(); renderHistory(); }
async function resetAllWatched() { if (!await showConfirm('Сбросить весь прогресс?', 'Сброс')) return; storage.resetAllWatched(); showAlert('Прогресс сброшен!'); if (currentAnime) openAnimePage({ shikimoriId: currentAnime.id }); }
function toggleDeleteMode() { deleteMode = !deleteMode; const btn = document.getElementById('btn-toggle-delete'); if (btn) { btn.classList.toggle('active-delete', deleteMode); btn.textContent = deleteMode ? 'Выйти из удаления' : 'Режим удаления'; } renderHistory(); }
async function removeFromHistory(event, id) { event.stopPropagation(); if (!await showConfirm('Удалить из истории?', 'Удаление')) return; storage.removeFromHistory(id); renderHistory(); }

// ================== СТРАНИЦА РЕЛИЗА ==================
function getDescription(animeMeta, fullVideoData) {
    if (animeMeta && animeMeta.description_raw && animeMeta.description_raw.trim()) return animeMeta.description_raw.trim();
    if (animeMeta && animeMeta.description && animeMeta.description.trim()) return animeMeta.description.replace(/<[^>]*>/g, '').replace(/\[.*?\]/g, '').trim();
    if (fullVideoData && fullVideoData.description && fullVideoData.description.trim()) return fullVideoData.description.replace(/<[^>]*>/g, '').trim();
    return "Описание отсутствует.";
}
function formatTime(seconds) {
    if (isNaN(seconds) || seconds < 0) return '0:00';
    const m = Math.floor(seconds / 60); const s = Math.floor(seconds % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
}

async function openAnimePage(item) {
    const id = String(item.shikimoriId || item.id); if (id === 'null') return;
    const fullVideoData = API.findVideoAnime(id); const meta = await API.getAnimeMeta(id);
    let episodes = fullVideoData?.episodes || [];
    currentAnime = { id, title: meta?.russian || meta?.name || 'Без названия', episodes: episodes };
    let posterUrl = '';
    if (meta?.image && meta.image.original) { posterUrl = meta.image.original.startsWith('http') ? meta.image.original : `https://shikimori.one${meta.image.original}`; }
    if (posterUrl && currentAnime.title !== "Без названия") { storage.addToHistory({ id, title: currentAnime.title, image: posterUrl }); }
    document.querySelectorAll('.tab-content').forEach(el => el.style.display = 'none');
    document.getElementById('release-page')?.remove();
    const container = document.querySelector('.container'); const page = document.createElement('section'); page.id = 'release-page';
    const watched = storage.getWatched(id); const imgUrl = posterUrl; const isFav = storage.isFavorite(id);
    let epHTML = '';
    episodes.forEach(ep => {
        const isWatched = watched.includes(ep.number);
        epHTML += `<div class="ep-item ${isWatched ? 'watched' : ''}" data-ep="${ep.number}"><div class="ep-info" onclick="playEpisode(${ep.number})"><div class="ep-name">Серия ${ep.number}</div></div><span class="check-icon ${isWatched ? 'active' : ''}" onclick="handleToggleWatched(event, ${ep.number})">✓</span></div>`;
    });
    const description = getDescription(meta, fullVideoData);
    const genres = meta && meta.genres ? meta.genres.map(g => g.russian || g.name).join(', ') : '';
    const episodesCount = episodes.length > 0 ? episodes.length : (meta?.episodes || 12);
    const progressPercent = episodesCount > 0 ? Math.round((watched.length / episodesCount) * 100) : 0;
    let voiceHTML = '';
    if (fullVideoData && fullVideoData.voice_team && fullVideoData.voice_team.length > 0) {
        voiceHTML = `<div class="voice-team-section"><h3>Команда озвучки</h3><div class="voice-grid">${fullVideoData.voice_team.map(v => `<div class="voice-card" onclick="filterByVoiceActor('${v.replace(/'/g, "\\'")}')"><div class="voice-avatar">${String(v).charAt(0).toUpperCase()}</div><div class="voice-info"><span class="voice-name">${v}</span><span class="voice-role">Актёр озвучки</span></div></div>`).join('')}</div></div>`;
    }
    page.innerHTML = `
        <button class="back-btn" onclick="switchTab('catalog')">← Назад</button>
        <button class="fav-release-btn ${isFav ? 'active' : ''}" data-id="${id}" onclick="handleToggleFavorite(event, '${id}', '${currentAnime.title.replace(/'/g, "\\'")}', '${imgUrl}')">${isFav ? 'В избранном' : 'В избранное'}</button>
        <div class="release-header"><img class="rel-poster" src="${imgUrl}"><div class="rel-meta"><h1>${currentAnime.title}</h1><div class="rel-subtext">${episodesCount} серий</div>${genres ? `<div class="rel-genres">${genres}</div>` : ''}<div class="rel-tags"><span class="tag">${fullVideoData?.studio || 'Yamikoe Studio'}</span><span class="tag">Плеер: Yamikoe Studio</span></div></div></div>
        <p class="rel-description">${description}</p>
        ${voiceHTML}
        <div class="episodes-section"><div class="progress-bar-box"><div class="progress-text">Прогресс просмотра: ${watched.length} из ${episodesCount} (${progressPercent}%)</div><div class="progress-track"><div class="progress-fill" style="width: ${progressPercent}%"></div></div></div><div class="episodes-list">${epHTML}</div></div>
    `;
    container.appendChild(page);
}

// ================== ФИЛЬТР ПО АКТЕРУ ==================
function filterByVoiceActor(actorName) {
    switchTab('all');
    setTimeout(() => {
        const voiceSelect = document.getElementById('select-voice');
        if (voiceSelect) {
            const triggerSpan = voiceSelect.querySelector('.custom-select-trigger span:first-child');
            if (triggerSpan) triggerSpan.textContent = actorName;
            voiceSelect.querySelectorAll('.custom-option').forEach(o => o.classList.remove('selected'));
            const targetOption = Array.from(voiceSelect.querySelectorAll('.custom-option')).find(o => o.dataset.value === actorName);
            if (targetOption) {
                targetOption.classList.add('selected');
            } else {
                const optionsDiv = voiceSelect.querySelector('.custom-options');
                const newOpt = document.createElement('div');
                newOpt.className = 'custom-option selected';
                newOpt.dataset.value = actorName;
                newOpt.textContent = actorName;
                optionsDiv.appendChild(newOpt);
            }
        }
        applyFilters();
    }, 50);
}
