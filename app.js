// app.js - Веб-версия с Google Picker (v4.12.0)
let currentAnime = null;
let currentEpisodeNumber = null;
let watchTimer = null;
let deleteMode = false;
let searchTimer = null;
let currentDayIndex = 0;
let allReleasesCache = [];
let filtersInitialized = false;
const APP_VERSION = "4.12.0";
let releasePage_limit = 30;
let releasePage_showing = 30;
let activeSelect = null;
let playerKeydownHandler = null;
let playerMouseHandlers = null;
let controlsHideTimer = null;
let positionSaveTimer = null;
let pendingResumeTime = 0;
let scrollPositions = { catalog: 0, schedule: 0, all: 0, favorites: 0, history: 0 };

// ================== GOOGLE PICKER ==================

// ИСПОЛЬЗУЕМ ТОЛЬКО drive.readonly ДЛЯ ВЕБ-ВЕРСИИ
const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';

// ================== УМНЫЙ ПОИСК ==================
const ruToEn = { 'й':'q','ц':'w','у':'e','к':'r','е':'t','н':'y','г':'u','ш':'i','щ':'o','з':'p','х':'[','ъ':']','ф':'a','ы':'s','в':'d','а':'f','п':'g','р':'h','о':'j','л':'k','д':'l','ж':';','э':"'",'я':'z','ч':'x','с':'c','м':'v','и':'b','т':'n','ь':'m','б':',','ю':'.' };
const enToRu = { 'q':'й','w':'ц','e':'у','r':'к','t':'е','y':'н','u':'г','i':'ш','o':'щ','p':'з','[':'х',']':'ъ','a':'ф','s':'ы','d':'в','f':'а','g':'п','h':'р','j':'о','k':'л','l':'д',';':'ж',"'":'э','z':'я','x':'ч','c':'с','v':'м','b':'и','n':'т','m':'ь',',':'б','.':'ю' };

function convertLayout(text, direction = 'ru-to-en') {
    const map = direction === 'ru-to-en' ? ruToEn : enToRu;
    return text.split('').map(char => map[char.toLowerCase()] || char).join('');
}
function isMatch(text, query) {
    if (!text) return false;
    const t = text.toLowerCase();
    const q = query.toLowerCase();
    if (t.includes(q)) return true;
    const isRussianQuery = /[а-яё]/.test(query);
    const converted = convertLayout(query, isRussianQuery ? 'ru-to-en' : 'en-to-ru');
    if (t.includes(converted)) return true;
    return false;
}
function isAdult(anime) {
    if (!anime) return false;
    const genres = (anime.genres || []).map(g => g.russian || g.name);
    const adultGenres = ['Эротика', 'Хентай', 'Этти'];
    const hasAdultGenre = genres.some(g => adultGenres.includes(g));
    const isAdultRating = ['r_plus', 'r_17', 'rx'].includes(anime.rating);
    return hasAdultGenre || isAdultRating;
}

// ================== МОДАЛКИ ==================
function showConfirm(message, title = 'Подтверждение') {
    return new Promise((resolve) => {
        const modal = document.getElementById('custom-confirm');
        document.getElementById('confirm-title').textContent = title;
        document.getElementById('confirm-message').textContent = message;
        modal.style.display = 'flex';
        const cleanup = () => {
            modal.style.display = 'none';
            document.getElementById('confirm-ok').removeEventListener('click', onOk);
            document.getElementById('confirm-cancel').removeEventListener('click', onCancel);
        };
        const onOk = () => { cleanup(); resolve(true); };
        const onCancel = () => { cleanup(); resolve(false); };
        document.getElementById('confirm-ok').addEventListener('click', onOk);
        document.getElementById('confirm-cancel').addEventListener('click', onCancel);
    });
}
function showAlert(message, title = 'Уведомление') {
    return new Promise((resolve) => {
        const modal = document.getElementById('custom-alert');
        document.getElementById('alert-title').textContent = title;
        document.getElementById('alert-message').textContent = message;
        modal.style.display = 'flex';
        const cleanup = () => {
            modal.style.display = 'none';
            document.getElementById('alert-ok').removeEventListener('click', onOk);
        };
        const onOk = () => { cleanup(); resolve(true); };
        document.getElementById('alert-ok').addEventListener('click', onOk);
    });
}

// ================== НАСТРОЙКИ ==================
function openSettings() {
    const auto = document.getElementById('setting-autoplay-next');
    if (auto) auto.checked = storage.getSetting('autoplayNext', true);
    const skip = document.getElementById('setting-skip-time');
    if (skip) skip.value = storage.getSetting('skipTime', 90);
    const adultCheckbox = document.getElementById('setting-adult-mode');
    if (adultCheckbox) adultCheckbox.checked = storage.getSetting('adultMode', false);
    document.getElementById('settings-modal').style.display = 'flex';
}
function closeSettings() { document.getElementById('settings-modal').style.display = 'none'; }
function toggleAutoplayNext(enabled) { storage.setSetting('autoplayNext', enabled); }
function saveSkipSettings() {
    const skipVal = parseInt(document.getElementById('setting-skip-time').value, 10) || 0;
    storage.setSetting('skipTime', skipVal);
}
function openBindingsModal() { document.getElementById('bindings-modal').style.display = 'flex'; }
function closeBindingsModal() { document.getElementById('bindings-modal').style.display = 'none'; }

// ================== 18+ ==================
async function handleAdultToggle() {
    const checkbox = document.getElementById('setting-adult-mode');
    const isChecked = checkbox.checked;
    if (isChecked) {
        const confirmed = await showConfirm('Вы собираетесь включить контент 18+.\n\nВам есть 18 лет?', 'Подтверждение возраста');
        if (confirmed) {
            storage.setSetting('adultMode', true);
            if (filtersInitialized) { initFilters(); applyFilters(); }
            renderHistory(); renderFavorites(); renderMainPage();
        } else { checkbox.checked = false; }
    } else {
        storage.setSetting('adultMode', false);
        if (filtersInitialized) { initFilters(); applyFilters(); }
        renderHistory(); renderFavorites(); renderMainPage();
    }
}

// ================== GOOGLE LOGIN ==================
function handleGoogleLogin() {
    if (typeof google === 'undefined' || !google.accounts) {
        showAlert('Библиотека Google не успела загрузиться. Повторите попытку.', 'Ошибка');
        return;
    }
    const client = google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: GOOGLE_SCOPE,
        callback: (response) => {
            if (response.access_token) {
                localStorage.setItem('google_access_token', response.access_token);
                updateGoogleLoginButton(true);
                showAlert('Вы успешно вошли в Google!', 'Готово');
            }
        },
    });
    // Запрашиваем согласие, чтобы обновить разрешения, если они изменились
    client.requestAccessToken({ prompt: 'consent' });
}
function handleGoogleLogout() {
    localStorage.removeItem('google_access_token');
    updateGoogleLoginButton(false);
    showAlert('Вы вышли из Google.', 'Готово');
}
function updateGoogleLoginButton(isLoggedIn) {
    const text = document.getElementById('google-login-text');
    const hint = document.getElementById('google-status-hint');
    const logoutBtn = document.getElementById('google-logout-btn');
    const loginBtn = document.getElementById('google-login-btn');
    if (text) text.textContent = isLoggedIn ? 'Вы вошли в Google' : 'Войти в Google';
    if (loginBtn) {
        loginBtn.style.background = isLoggedIn ? 'rgba(34, 197, 94, 0.12)' : '';
        loginBtn.style.borderColor = isLoggedIn ? 'rgba(34, 197, 94, 0.4)' : '';
    }
    if (hint) hint.textContent = isLoggedIn ? 'Google-аккаунт подключён. Видео с Drive доступны.' : 'Войдите, чтобы смотреть видео с Google Drive';
    if (logoutBtn) logoutBtn.style.display = isLoggedIn ? 'flex' : 'none';
}

// ================== БЭКАП ==================
function exportBackup() {
    const data = storage.exportData();
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `yamikoe-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click(); URL.revokeObjectURL(url); showAlert('Бэкап сохранён!', 'Готово');
}
async function importBackup(event) {
    const file = event.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
        const confirmed = await showConfirm('Загрузить бэкап? Текущие данные будут заменены.', 'Импорт');
        if (!confirmed) return;
        const success = storage.importData(e.target.result);
        if (success) {
            showAlert('Бэкап загружен!', 'Готово'); closeSettings(); switchTab('history');
        } else { showAlert('Ошибка: файл повреждён или имеет неверный формат.', 'Ошибка'); }
    };
    reader.readAsText(file); event.target.value = '';
}

// ================== ОБНОВЛЕНИЕ ==================
function handleRefresh() { refreshData(); }
async function refreshData() {
    const grid = document.getElementById('recent-releases-grid');
    if (grid) showSkeletons(grid, 10);
    await API.init();
    allReleasesCache = []; filtersInitialized = false; releasePage_showing = releasePage_limit;
    const activeTab = document.querySelector('.nav-btn.active');
    if (activeTab) { switchTab(activeTab.id.replace('btn-', '')); } else { switchTab('catalog'); }
    await renderMainPage();
}

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
    const savedToken = localStorage.getItem('google_access_token');
    updateGoogleLoginButton(!!savedToken);

    const grid = document.getElementById('recent-releases-grid');
    if (grid) showSkeletons(grid, 10);

    await API.init();
    initCustomSelects();
    const today = new Date().getDay();
    currentDayIndex = today === 0 ? 6 : today - 1;
    await renderMainPage();
    const splash = document.getElementById('splash-screen');
    if (splash) {
        if (sessionStorage.getItem('splashShown')) { splash.classList.add('hidden'); document.body.classList.add('loaded'); }
        else { setTimeout(() => { splash.classList.add('hidden'); document.body.classList.add('loaded'); sessionStorage.setItem('splashShown', 'true'); }, 4000); }
    } else { document.body.classList.add('loaded'); }
});

function switchTab(tab) {
    if (watchTimer) { clearTimeout(watchTimer); watchTimer = null; }
    const activeTab = document.querySelector('.nav-btn.active');
    if (activeTab) { scrollPositions[activeTab.id.replace('btn-', '')] = window.scrollY; }

    document.querySelectorAll('.tab-content').forEach(el => el.style.display = 'none');
    document.querySelectorAll('.nav-btn').forEach(el => el.classList.remove('active'));
    const tabEl = document.getElementById(`tab-${tab}`); const btnEl = document.getElementById(`btn-${tab}`);
    if (tabEl) tabEl.style.display = 'block'; if (btnEl) btnEl.classList.add('active');

    if (tab === 'schedule') renderSchedule();
    if (tab === 'history') renderHistory();
    if (tab === 'all') { releasePage_showing = releasePage_limit; if (!filtersInitialized) { initFilters(); filtersInitialized = true; } renderAllReleases(); }
    if (tab === 'favorites') renderFavorites();

    const releasePage = document.getElementById('release-page'); if (releasePage) releasePage.remove();
    if (playerKeydownHandler) { document.removeEventListener('keydown', playerKeydownHandler); playerKeydownHandler = null; }
    if (playerMouseHandlers) { window.removeEventListener('mousemove', playerMouseHandlers.move); window.removeEventListener('mouseup', playerMouseHandlers.up); playerMouseHandlers = null; }
    if (controlsHideTimer) { clearTimeout(controlsHideTimer); controlsHideTimer = null; }

    setTimeout(() => { window.scrollTo({ top: scrollPositions[tab] || 0, behavior: 'instant' }); }, 50);
}

// ================== ГЛАВНАЯ ==================
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
            if (recentIds.length >= 15) break;
        }
    }
    if (recentIds.length === 0) recentIds = API.getAllUniqueIds();
    const seenTitles = new Set();
    for (const id of recentIds.slice(0, 15)) {
        const anime = await API.getAnimeMeta(id); if (!anime) continue;
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
        randomContainer.innerHTML = ''; const allIds = API.getAllUniqueIds().sort(() => 0.5 - Math.random()); let added = 0;
        for (const id of allIds) {
            if (added >= 4) break; if (uniqueIds.has(id)) continue;
            const anime = await API.getAnimeMeta(id); if (!anime) continue;
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

// ================== ПРОДОЛЖИТЬ ==================
async function renderContinueWatching() {
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
                if (pos > 5) continueItems.push({ ...item, lastEp, pos });
            }
        }
        if (continueItems.length >= 5) break;
    }
    if (continueItems.length === 0) { title.style.display = 'none'; grid.style.display = 'none'; return; }
    title.style.display = 'block'; grid.style.display = 'grid'; grid.innerHTML = '';
    const isAdultMode = storage.getSetting('adultMode', false);
    for (const item of continueItems) {
        const meta = await API.getAnimeMeta(item.id);
        if (!isAdultMode && isAdult(meta)) continue;
        const card = document.createElement('div'); card.className = 'anime-card';
        card.onclick = () => openAnimePage({ shikimoriId: item.id });
        const percent = Math.min(100, Math.round((item.pos / 1440) * 100));
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
            </div>`;
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
        const allIds = API.getAllUniqueIds(); const seenTitles = new Set();
        for (const id of allIds) {
            if (id === 'null') continue; const anime = await API.getAnimeMeta(id); if (!anime) continue;
            const title = anime.russian || anime.name || ''; const titleKey = title.toLowerCase().trim();
            if (seenTitles.has(titleKey)) continue; seenTitles.add(titleKey);
            allReleasesCache.push({ id, anime });
        }
        initFilters(); filtersInitialized = true;
    }
    applyFilters();
}
function initFilters() {
    const genresSet = new Set(); const yearsSet = new Set(); const voiceSet = new Set();
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
        if (videoData && videoData.voice_team) videoData.voice_team.forEach(v => voiceSet.add(v));
    });
    if (isAdultMode) { genresSet.add('Эротика'); genresSet.add('Хентай'); genresSet.add('Этти'); }
    const genreSelect = document.getElementById('select-genre');
    if (genreSelect) {
        const optionsDiv = genreSelect.querySelector('.custom-options');
        const genres = [...genresSet].filter(Boolean).sort();
        optionsDiv.innerHTML = `<div class="custom-option selected" data-value="">Все жанры</div>` + genres.map(g => `<div class="custom-option" data-value="${String(g).replace(/"/g, '&quot;')}">${g}</div>`).join('');
    }
    const yearSelect = document.getElementById('select-year');
    if (yearSelect) {
        const optionsDiv = yearSelect.querySelector('.custom-options');
        const years = [...yearsSet].filter(Boolean).sort((a, b) => b - a);
        optionsDiv.innerHTML = `<div class="custom-option selected" data-value="">Все годы</div>` + years.map(y => `<div class="custom-option" data-value="${y}">${y}</div>`).join('');
    }
    const voiceSelect = document.getElementById('select-voice');
    if (voiceSelect) {
        const optionsDiv = voiceSelect.querySelector('.custom-options');
        const voices = [...voiceSet].filter(Boolean).sort();
        optionsDiv.innerHTML = `<div class="custom-option selected" data-value="">Все</div>` + voices.map(v => `<div class="custom-option" data-value="${String(v).replace(/"/g, '&quot;')}">${v}</div>`).join('');
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
        if (voice) { const videoData = API.findVideoAnime(id); if (!(videoData?.voice_team || []).includes(voice)) return false; }
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
    filtered.slice(0, releasePage_showing).forEach(({ id, anime }) => {
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
            if (!isAdultMode) { const anime = await API.getAnimeMeta(fav.id); if (isAdult(anime)) continue; }
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
            if (!isAdultMode) { const anime = await API.getAnimeMeta(item.id); if (isAdult(anime)) continue; }
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
        epHTML += `<div class="ep-item ${isWatched ? 'watched' : ''}"><div class="ep-info" onclick="playEpisode(${ep.number})"><div class="ep-name">Серия ${ep.number}</div></div><span class="check-icon ${isWatched ? 'active' : ''}" onclick="handleToggleWatched(event, ${ep.number})">✓</span></div>`;
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
        <div class="release-header"><img class="rel-poster" src="${imgUrl}"><div class="rel-meta"><h1>${currentAnime.title}</h1><div class="rel-subtext">${episodesCount} серий</div>${genres ? `<div class="rel-genres">${genres}</div>` : ''}<div class="rel-tags"><span class="tag">${fullVideoData?.studio || 'Yamikoe Studio'}</span><span class="tag">Плеер: Google Drive</span></div></div></div>
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
            if (targetOption) { targetOption.classList.add('selected'); }
            else {
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

// ================== ПЛЕЕР ==================
function openPlayerOverlay() { document.getElementById('player-overlay').style.display = 'flex'; document.body.style.overflow = 'hidden'; }
function closePlayerOverlay() {
    const video = document.getElementById('my-player');
    if (video && currentAnime && currentEpisodeNumber !== null) { storage.setPlaybackPosition(currentAnime.id, currentEpisodeNumber, video.currentTime); }
    const overlay = document.getElementById('player-overlay'); overlay.style.display = 'none'; document.body.style.overflow = '';
    if (playerKeydownHandler) { document.removeEventListener('keydown', playerKeydownHandler); playerKeydownHandler = null; }
    if (playerMouseHandlers) { window.removeEventListener('mousemove', playerMouseHandlers.move); window.removeEventListener('mouseup', playerMouseHandlers.up); playerMouseHandlers = null; }
    if (controlsHideTimer) { clearTimeout(controlsHideTimer); controlsHideTimer = null; }
    if (positionSaveTimer) { clearInterval(positionSaveTimer); positionSaveTimer = null; }
    if (watchTimer) { clearTimeout(watchTimer); watchTimer = null; }
    document.getElementById('overlay-video-container').innerHTML = '';
    document.getElementById('episodes-panel').classList.remove('open');
    pendingResumeTime = 0;
}
function toggleEpisodesPanel() { const panel = document.getElementById('episodes-panel'); if (panel) panel.classList.toggle('open'); }
function skipTime() { const video = document.getElementById('my-player'); if (!video) return; const sec = parseInt(storage.getSetting('skipTime', 90), 10) || 0; video.currentTime = Math.min(video.currentTime + sec, (video.duration || Infinity) - 1); }
function playPrevEpisode() { if (!currentAnime || currentEpisodeNumber === null) return; const idx = currentAnime.episodes.findIndex(e => e.number === currentEpisodeNumber); if (idx > 0) playEpisode(currentAnime.episodes[idx - 1].number); }
function playNextEpisode() { if (!currentAnime || currentEpisodeNumber === null) return; const idx = currentAnime.episodes.findIndex(e => e.number === currentEpisodeNumber); if (idx >= 0 && idx + 1 < currentAnime.episodes.length) { playEpisode(currentAnime.episodes[idx + 1].number); } }
function applyResume() { const video = document.getElementById('my-player'); if (!video) return; video.currentTime = pendingResumeTime; document.getElementById('resume-bar').style.display = 'none'; pendingResumeTime = 0; video.play(); }
function dismissResume() { document.getElementById('resume-bar').style.display = 'none'; pendingResumeTime = 0; }

// Рендер HTML плеера + вся логика
function renderPlayer(videoUrl, number) {
    const container = document.getElementById('overlay-video-container');
    container.innerHTML = `
        <div class="custom-player-wrapper" id="custom-player">
            <video id="my-player" autoplay>
                <source src="${videoUrl}" type="video/mp4">
            </video>
            <aside class="episodes-panel" id="episodes-panel">
                <div class="episodes-panel-header">
                    <span>Серии</span>
                    <span class="close-btn" onclick="toggleEpisodesPanel()">&times;</span>
                </div>
                <div class="episodes-panel-list" id="episodes-panel-list"></div>
            </aside>
            <div class="player-close-btn" onclick="closePlayerOverlay(); switchTab('catalog');">✕</div>
            <div class="player-controls">
                <div class="player-top-info">
                    <span class="player-title">${currentAnime.title}</span>
                    <span class="player-subtitle">Серия ${number}</span>
                </div>
                <div class="player-middle-section">
                    <div class="resume-bar" id="resume-bar" style="display: none;">
                        <span class="resume-text">Продолжить с <span class="resume-time-highlight" id="resume-time-text">0:00</span>?</span>
                        <button class="resume-confirm-btn" onclick="applyResume()">
                            <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg> Продолжить
                        </button>
                        <button class="resume-close-btn" onclick="dismissResume()">✕</button>
                    </div>
                    <div class="player-progress-container" id="player-progress">
                        <div class="player-progress-fill" id="player-progress-fill"></div>
                        <div class="player-progress-thumb" id="player-progress-thumb"></div>
                    </div>
                </div>
                <div class="player-bottom-wrapper">
                    <div class="player-bottom-left">
                        <div class="player-time-volume">
                            <span class="player-time" id="time-current">0:00</span> / <span class="player-time" id="time-total">0:00</span>
                            <span class="player-time" id="time-remaining" style="margin-left: 8px; color: #a78bfa; font-size: 12px;">(-0:00)</span>
                            <div class="volume-container">
                                <button class="player-btn" id="mute-btn"><svg id="icon-volume" viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg><svg id="icon-mute" viewBox="0 0 24 24" style="display:none;"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/></svg></button>
                                <div class="volume-slider" id="volume-slider"><div class="volume-fill" id="volume-fill"></div><div class="volume-thumb" id="volume-thumb"></div></div>
                            </div>
                        </div>
                    </div>
                    <div class="player-center-controls">
                        <button class="player-btn player-btn-nav" id="prev-btn"><svg viewBox="0 0 24 24"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg></button>
                        <button class="player-btn player-btn-main" id="play-pause-btn"><svg id="icon-pause" viewBox="0 0 24 24" style="display:none;"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg><svg id="icon-play" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></button>
                        <button class="player-btn player-btn-nav" id="next-btn"><svg viewBox="0 0 24 24"><path d="M16 6h2v12h-2zM6 18l8.5-6L6 6z"/></svg></button>
                    </div>
                    <div class="player-buttons-right">
                        <button class="player-btn" id="skip-btn"><svg viewBox="0 0 24 24"><path d="M4 18l8.5-6L4 6v12zm9-12v12l8.5-6L13 6z"/></svg></button>
                        <button class="player-btn player-btn-pip" id="pip-btn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="2"/><rect x="12" y="12" width="8" height="6" rx="1" fill="currentColor"/></svg></button>
                        <button class="player-btn" id="episodes-toggle-btn"><svg viewBox="0 0 24 24"><path d="M3 6h18v2H3zm0 5h18v2H3zm0 5h18v2H3z"/></svg></button>
                        <button class="player-btn" id="fullscreen-btn"><svg viewBox="0 0 24 24"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/></svg></button>
                    </div>
                </div>
            </div>
        </div>
    `;
    initPlayerLogic(number);
}

// Логика плеера (навешиваем обработчики)
function initPlayerLogic(number) {
    const video = document.getElementById('my-player'); const playerWrapper = document.getElementById('custom-player');
    const playPauseBtn = document.getElementById('play-pause-btn');
    const iconPlay = document.getElementById('icon-play'); const iconPause = document.getElementById('icon-pause');
    const timeCurrent = document.getElementById('time-current'); const timeTotal = document.getElementById('time-total');
    const timeRemaining = document.getElementById('time-remaining');
    const progressFill = document.getElementById('player-progress-fill'); const progressContainer = document.getElementById('player-progress');
    const progressThumb = document.getElementById('player-progress-thumb');
    const volumeSlider = document.getElementById('volume-slider'); const volumeFill = document.getElementById('volume-fill'); const volumeThumb = document.getElementById('volume-thumb');
    const muteBtn = document.getElementById('mute-btn'); const iconVolume = document.getElementById('icon-volume'); const iconMute = document.getElementById('icon-mute');
    const fullscreenBtn = document.getElementById('fullscreen-btn');
    const pipBtn = document.getElementById('pip-btn');

    const savedPos = storage.getPlaybackPosition(currentAnime.id, number);
    video.addEventListener('loadedmetadata', () => {
        if (savedPos > 0 && savedPos < (video.duration || Infinity) - 5) { pendingResumeTime = savedPos; document.getElementById('resume-time-text').textContent = formatTime(savedPos); document.getElementById('resume-bar').style.display = 'flex'; }
        timeTotal.textContent = formatTime(video.duration);
        updateRemainingTime();
    });

    video.addEventListener('error', () => {
        const container = document.getElementById('overlay-video-container');
        container.innerHTML = `
            <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; color: #f87171;">
                <p style="font-size: 18px; font-weight: 600; margin-bottom: 10px;">Ошибка воспроизведения</p>
                <p style="font-size: 14px; opacity: 0.7; text-align: center; max-width: 400px;">Не удалось загрузить видео. Возможно, файл недоступен или поврежден.</p>
                <button onclick="closePlayerOverlay(); switchTab('catalog');" class="player-error-btn">Вернуться на главную</button>
            </div>
        `;
    });

    function updateRemainingTime() {
        if (video.duration && timeRemaining) {
            const rem = video.duration - video.currentTime;
            timeRemaining.textContent = `(-${formatTime(rem)})`;
        }
    }

    const showControls = () => {
        playerWrapper.classList.remove('controls-hidden');
        if (controlsHideTimer) clearTimeout(controlsHideTimer);
        if (!video.paused) { controlsHideTimer = setTimeout(() => { playerWrapper.classList.add('controls-hidden'); }, 2500); }
    };
    playerWrapper.addEventListener('mousemove', showControls);
    playerWrapper.addEventListener('mouseleave', () => { if (!video.paused) playerWrapper.classList.add('controls-hidden'); });

    const togglePlay = () => { if (video.paused) { video.play(); } else { video.pause(); } };
    playPauseBtn.addEventListener('click', togglePlay);

    video.addEventListener('play', () => { iconPlay.style.display = 'none'; iconPause.style.display = 'block'; playerWrapper.classList.remove('paused'); showControls(); });
    video.addEventListener('pause', () => { iconPlay.style.display = 'block'; iconPause.style.display = 'none'; playerWrapper.classList.add('paused'); playerWrapper.classList.remove('controls-hidden'); if (controlsHideTimer) { clearTimeout(controlsHideTimer); controlsHideTimer = null; } if (currentAnime && currentEpisodeNumber !== null) { storage.setPlaybackPosition(currentAnime.id, currentEpisodeNumber, video.currentTime); } });

    positionSaveTimer = setInterval(() => { if (video && !video.paused && currentAnime && currentEpisodeNumber !== null) { storage.setPlaybackPosition(currentAnime.id, currentEpisodeNumber, video.currentTime); } }, 5000);

    let clickTimer = null;
    video.addEventListener('click', () => {
        if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; return; }
        clickTimer = setTimeout(() => { clickTimer = null; togglePlay(); }, 220);
    });
    video.addEventListener('dblclick', () => { if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; } toggleFullscreen(); });

    let isDragging = false;
    const seek = (e) => {
        const rect = progressContainer.getBoundingClientRect(); let pos = (e.clientX - rect.left) / rect.width;
        pos = Math.max(0, Math.min(1, pos)); progressFill.style.width = `${pos * 100}%`;
        progressThumb.style.left = `${pos * 100}%`;
        if (video.duration) timeCurrent.textContent = formatTime(pos * video.duration);
        return pos;
    };
    progressContainer.addEventListener('mousedown', (e) => { isDragging = true; const pos = seek(e); if (video.duration) video.currentTime = pos * video.duration; });

    let isVolumeDragging = false;
    const setVolume = (e) => {
        const rect = volumeSlider.getBoundingClientRect(); let pos = (e.clientX - rect.left) / rect.width;
        pos = Math.max(0, Math.min(1, pos)); video.volume = pos; volumeFill.style.width = `${pos * 100}%`; volumeThumb.style.left = `${pos * 100}%`;
        if (video.volume > 0) { video.muted = false; iconVolume.style.display = 'block'; iconMute.style.display = 'none'; }
        else { iconVolume.style.display = 'none'; iconMute.style.display = 'block'; }
    };
    volumeSlider.addEventListener('mousedown', (e) => { isVolumeDragging = true; setVolume(e); });

    playerMouseHandlers = {
        move: (e) => { if (isDragging) { const pos = seek(e); if (video.duration) video.currentTime = pos * video.duration; } if (isVolumeDragging) setVolume(e); },
        up: () => { isDragging = false; isVolumeDragging = false; }
    };
    window.addEventListener('mousemove', playerMouseHandlers.move);
    window.addEventListener('mouseup', playerMouseHandlers.up);

    video.addEventListener('timeupdate', () => {
        if (!isDragging && video.duration) {
            const percent = (video.currentTime / video.duration) * 100;
            progressFill.style.width = `${percent}%`;
            progressThumb.style.left = `${percent}%`;
            timeCurrent.textContent = formatTime(video.currentTime);
            updateRemainingTime();
        }
    });

    muteBtn.addEventListener('click', () => {
        video.muted = !video.muted;
        if (video.muted) { iconVolume.style.display = 'none'; iconMute.style.display = 'block'; volumeFill.style.width = '0%'; volumeThumb.style.left = '0%'; }
        else { iconVolume.style.display = 'block'; iconMute.style.display = 'none'; volumeFill.style.width = `${video.volume * 100}%`; volumeThumb.style.left = `${video.volume * 100}%`; }
    });

    const toggleFullscreen = () => {
        if (!document.fullscreenElement) { playerWrapper.requestFullscreen().catch(err => console.error(err)); } else { document.exitFullscreen(); }
    };
    fullscreenBtn.addEventListener('click', toggleFullscreen);

    if (pipBtn) {
        pipBtn.addEventListener('click', async () => {
            try {
                if (document.pictureInPictureElement) { await document.exitPictureInPicture(); }
                else { await video.requestPictureInPicture(); }
            } catch (e) { console.error('PiP error:', e); }
        });
    }

    document.getElementById('prev-btn').addEventListener('click', playPrevEpisode);
    document.getElementById('next-btn').addEventListener('click', playNextEpisode);
    document.getElementById('skip-btn').addEventListener('click', skipTime);
    document.getElementById('episodes-toggle-btn').addEventListener('click', toggleEpisodesPanel);

    video.addEventListener('ended', () => {
        if (currentAnime && currentEpisodeNumber !== null) { storage.clearPlaybackPosition(currentAnime.id, currentEpisodeNumber); }
        if (!storage.getSetting('autoplayNext', true)) return;
        const all = currentAnime?.episodes || []; const idx = all.findIndex(e => e.number === number);
        if (idx >= 0 && idx + 1 < all.length) { playEpisode(all[idx + 1].number); } else { playerWrapper.innerHTML = '<p style="color:#a78bfa; padding:40px; text-align:center; font-size:16px;">Все серии просмотрены</p>'; }
    });

    if (playerKeydownHandler) { document.removeEventListener('keydown', playerKeydownHandler); }
    playerKeydownHandler = (e) => {
        if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA') return;
        switch(e.code) {
            case 'Space': case 'KeyK': e.preventDefault(); togglePlay(); break;
            case 'KeyF': e.preventDefault(); toggleFullscreen(); break;
            case 'ArrowRight': e.preventDefault(); video.currentTime += 5; break;
            case 'KeyL': e.preventDefault(); video.currentTime += 10; break;
            case 'ArrowLeft': e.preventDefault(); video.currentTime -= 5; break;
            case 'KeyJ': e.preventDefault(); video.currentTime -= 10; break;
            case 'ArrowUp': e.preventDefault(); video.volume = Math.min(1, video.volume + 0.1); volumeFill.style.width = `${video.volume * 100}%`; volumeThumb.style.left = `${video.volume * 100}%`; break;
            case 'ArrowDown': e.preventDefault(); video.volume = Math.max(0, video.volume - 0.1); volumeFill.style.width = `${video.volume * 100}%`; volumeThumb.style.left = `${video.volume * 100}%`; break;
            case 'KeyM': e.preventDefault(); muteBtn.click(); break;
            case 'Escape': e.preventDefault(); closePlayerOverlay(); break;
        }
    };
    document.addEventListener('keydown', playerKeydownHandler);

    watchTimer = setTimeout(() => handleToggleWatched(null, number, true), 10000);
}

// ГЛАВНАЯ ФУНКЦИЯ ПЛЕЕРА
async function playEpisode(number, event) {
    if (event) event.stopPropagation(); if (!currentAnime) return;
    const videoData = API.findVideoAnime(currentAnime.id); const ep = videoData?.episodes.find(e => e.number === number);
    if (!ep || !ep.video_url) return;

    if (currentEpisodeNumber !== null && currentAnime) { const oldVideo = document.getElementById('my-player'); if (oldVideo) { storage.setPlaybackPosition(currentAnime.id, currentEpisodeNumber, oldVideo.currentTime); } }
    if (watchTimer) { clearTimeout(watchTimer); watchTimer = null; }
    if (controlsHideTimer) { clearTimeout(controlsHideTimer); controlsHideTimer = null; }
    if (playerMouseHandlers) { window.removeEventListener('mousemove', playerMouseHandlers.move); window.removeEventListener('mouseup', playerMouseHandlers.up); playerMouseHandlers = null; }
    if (positionSaveTimer) { clearInterval(positionSaveTimer); positionSaveTimer = null; }

    currentEpisodeNumber = number;
    openPlayerOverlay();

    const idx = currentAnime.episodes.findIndex(e => e.number === number);
    const prevBtn = document.getElementById('prev-btn');
    const nextBtn = document.getElementById('next-btn');
    if (prevBtn) prevBtn.disabled = idx <= 0;
    if (nextBtn) nextBtn.disabled = idx >= currentAnime.episodes.length - 1;

    renderEpisodesPanel(number);

    const url = ep.video_url; let fileId = null;
    if (url.includes('drive.google.com')) { const match = url.match(/\/d\/([a-zA-Z0-9_-]+)/); if (match) fileId = match[1]; }
    const container = document.getElementById('overlay-video-container');

    // ===== ДЕСКТОП (Electron) =====
    if (fileId && window.electronAPI && window.electronAPI.getDriveVideoUrl) {
        container.innerHTML = `
            <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; color: #a78bfa;">
                <svg width="50" height="50" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom: 20px; animation: spin 2s linear infinite;">
                    <line x1="12" y1="2" x2="12" y2="6"></line><line x1="12" y1="18" x2="12" y2="22"></line><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line><line x1="2" y1="12" x2="6" y2="12"></line><line x1="18" y1="12" x2="22" y2="12"></line><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"></line><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"></line>
                </svg>
                <p style="font-size: 18px; font-weight: 600; margin-bottom: 10px;">Ожидание подтверждения...</p>
                <p style="font-size: 14px; opacity: 0.7; text-align: center; max-width: 400px;">В открывшемся браузере нажмите <b>«Разрешить»</b> и <b>«Вставить»</b>, чтобы видео загрузилось.</p>
                <button onclick="closePlayerOverlay(); switchTab('catalog');" style="margin-top: 20px; padding: 8px 16px; background: rgba(168, 85, 247, 0.2); border: 1px solid #a855f7; color: #fff; border-radius: 8px; cursor: pointer;">Вернуться на главную</button>
            </div>
            <style>@keyframes spin { 100% { transform: rotate(360deg); } }</style>
        `;
        const result = await window.electronAPI.getDriveVideoUrl(fileId);
        if (result.success) { renderPlayer(result.url, number); }
        else {
            container.innerHTML = `
                <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; color: #f87171;">
                    <p style="font-size: 18px; font-weight: 600; margin-bottom: 10px;">Ошибка загрузки видео</p>
                    <p style="font-size: 14px; opacity: 0.7; text-align: center; max-width: 400px;">${result.error}</p>
                    <button onclick="closePlayerOverlay(); switchTab('catalog');" style="margin-top: 20px; padding: 8px 16px; background: rgba(239, 68, 68, 0.2); border: 1px solid #ef4444; color: #fff; border-radius: 8px; cursor: pointer;">Вернуться на главную</button>
                </div>
            `;
        }
        return;
    }

    // ===== ВЕБ (Google Picker) =====
    const token = localStorage.getItem('google_access_token');
    if (!token) {
        container.innerHTML = `
            <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; color: #f87171; padding: 20px; text-align: center;">
                <p style="font-size: 18px; font-weight: 600; margin-bottom: 10px;">Требуется вход в Google</p>
                <p style="font-size: 14px; opacity: 0.7; margin-bottom: 20px;">Чтобы смотреть видео с Google Drive, войдите в аккаунт.</p>
                <button onclick="closePlayerOverlay(); openSettings();" style="padding: 10px 20px; background: rgba(168, 85, 247, 0.2); border: 1px solid #a855f7; color: #fff; border-radius: 8px; cursor: pointer;">Перейти в настройки</button>
            </div>
        `;
        return;
    }

    if (!fileId) {
        container.innerHTML = `<p style="color:#f87171; padding:20px;">Неверная ссылка на видео.</p>`;
        return;
    }

    container.innerHTML = `
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; color: #a78bfa;">
            <svg width="50" height="50" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom: 20px; animation: spin 2s linear infinite;">
                <line x1="12" y1="2" x2="12" y2="6"></line><line x1="12" y1="18" x2="12" y2="22"></line><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line><line x1="2" y1="12" x2="6" y2="12"></line><line x1="18" y1="12" x2="22" y2="12"></line><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"></line><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"></line>
            </svg>
            <p style="font-size: 18px; font-weight: 600; margin-bottom: 10px;">Открываем окно выбора файла...</p>
            <p style="font-size: 14px; opacity: 0.7; text-align: center; max-width: 400px;">Разрешите доступ к файлу в открывшемся окне Google Picker.</p>
            <button onclick="closePlayerOverlay(); switchTab('catalog');" style="margin-top: 20px; padding: 8px 16px; background: rgba(168, 85, 247, 0.2); border: 1px solid #a855f7; color: #fff; border-radius: 8px; cursor: pointer;">Вернуться на главную</button>
        </div>
        <style>@keyframes spin { 100% { transform: rotate(360deg); } }</style>
    `;

    try {
        await new Promise((resolve, reject) => {
            if (window.gapi) { window.gapi.load('picker', { callback: resolve, onerror: reject }); }
            else { reject(new Error('Библиотека Google Picker не загрузилась. Проверьте подключение скрипта apis.google.com')); }
        });

        createPicker(token, number, fileId);

    } catch (e) {
        console.error('Picker error:', e);
        container.innerHTML = `<p style="color:#f87171; padding:20px;">Ошибка: ${e.message}</p>`;
    }
}

// ================== ФУНКЦИЯ СОЗДАНИЯ PICKER (ИСПРАВЛЕНО) ==================
function createPicker(token, number, fileId) {
    // ИСПОЛЬЗУЕМ DocsView, ЧТОБЫ ПОКАЗАТЬ ТОЛЬКО НУЖНЫЙ ФАЙЛ
    const view = new google.picker.DocsView(google.picker.ViewId.DOCS)
        .setFileIds(fileId)
        .setMimeTypes('video/mp4,video/mkv,video/webm')
        .setSelectFolderEnabled(false);

    const picker = new google.picker.PickerBuilder()
        .enableFeature(google.picker.Feature.NAV_HIDDEN)
        .setAppId(GOOGLE_APP_ID)
        .setOAuthToken(token)
        .addView(view)
        .setDeveloperKey(GOOGLE_API_KEY)
        .setCallback(async (data) => {
            if (data.action === google.picker.Action.PICKED) {
                const selectedFileId = data.docs[0].id;
                // Получаем URL для воспроизведения, а не прямую ссылку alt=media
                try {
                    const streamUrl = await getVideoStreamUrl(selectedFileId, token);
                    if (streamUrl) {
                        renderPlayer(streamUrl, number);
                    } else {
                        throw new Error('Не удалось получить ссылку на видеопоток.');
                    }
                } catch (error) {
                    console.error('Ошибка получения видео:', error);
                    const container = document.getElementById('overlay-video-container');
                    if (container) {
                        container.innerHTML = `<p style="color:#f87171; padding:20px;">Ошибка: ${error.message}</p>`;
                    }
                }
            } else if (data.action === google.picker.Action.CANCEL) {
                closePlayerOverlay();
            }
        })
        .build();

    picker.setVisible(true);
}

// Новая функция для получения URL видеопотока
async function getVideoStreamUrl(fileId, token) {
    // Используем эндпоинт get_video_info, который возвращает прямые ссылки на потоки
    const response = await fetch(`https://docs.google.com/get_video_info?docid=${fileId}&access_token=${token}`);
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    const text = await response.text();
    const params = new URLSearchParams(text);
    const fmtStreamMap = params.get('url_encoded_fmt_stream_map');

    if (!fmtStreamMap) {
        // Если карта потоков недоступна, пробуем вернуть прямую ссылку alt=media как fallback
        console.warn('fmt_stream_map не найден, пробуем alt=media');
        return `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&access_token=${token}`;
    }

    // Парсим строку с потоками, чтобы найти URL с хорошим качеством (обычно первый или с itag=22/18)
    const streams = fmtStreamMap.split(',');
    for (const stream of streams) {
        const streamParams = new URLSearchParams(stream);
        const itag = streamParams.get('itag');
        const url = streamParams.get('url');
        if (url && (itag === '22' || itag === '18')) {
            // Декодируем URL, так как он может быть закодирован
            return decodeURIComponent(url);
        }
    }
    // Если не нашли предпочтительный, берем первый доступный
    const firstStream = new URLSearchParams(streams[0]);
    const firstUrl = firstStream.get('url');
    if (firstUrl) {
        return decodeURIComponent(firstUrl);
    }
    throw new Error('Не удалось найти подходящий видеопоток.');
}

function renderEpisodesPanel(activeNumber) {
    const list = document.getElementById('episodes-panel-list'); if (!list || !currentAnime) return;
    const watched = storage.getWatched(currentAnime.id);
    list.innerHTML = currentAnime.episodes.map(ep => {
        const isWatched = watched.includes(ep.number); const isActive = ep.number === activeNumber;
        return `<div class="panel-ep-item ${isActive ? 'active' : ''} ${isWatched ? 'watched' : ''}" onclick="playEpisode(${ep.number})"><span>Серия ${ep.number}</span>${isWatched ? '<span class="panel-check">✓</span>' : ''}</div>`;
    }).join('');
}

function handleToggleWatched(event, epNum, forceWatch = false) {
    if (event) event.stopPropagation(); if (!currentAnime) return;
    const watched = storage.toggleWatched(currentAnime.id, epNum); const isWatched = watched.includes(epNum);
    const epItem = document.querySelector(`.ep-item[onclick="playEpisode(${epNum})"]`);
    if (epItem) { epItem.classList.toggle('watched', isWatched); const icon = epItem.querySelector('.check-icon'); if (icon) icon.classList.toggle('active', isWatched); }
    const episodesCount = currentAnime.episodes && currentAnime.episodes.length > 0 ? currentAnime.episodes.length : 12;
    const percent = Math.round((watched.length / episodesCount) * 100);
    const progressText = document.querySelector('.progress-text'); const progressFill = document.querySelector('.progress-fill');
    if (progressText) progressText.textContent = `Прогресс просмотра: ${watched.length} из ${episodesCount} (${percent}%)`;
    if (progressFill) progressFill.style.width = `${percent}%`;
    if (currentEpisodeNumber !== null) renderEpisodesPanel(currentEpisodeNumber);
}

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
    const genresSet = new Set(); const themesSet = new Set(); const yearsSet = new Set();
    allReleasesCache.forEach(({ anime }) => {
        if (anime.genres) anime.genres.forEach(g => {
            const genreName = g.russian || g.name;
            if (['Школа', 'Повседневность', 'Гарем', 'Исекай', 'Меха', 'Магия', 'Демоны', 'Вампиры', 'Спорт', 'Музыка', 'Историческое'].includes(genreName)) themesSet.add(genreName);
            else genresSet.add(genreName);
        });
        if (anime.aired_on) yearsSet.add(anime.aired_on.split('-')[0]);
    });
    const genres = [...genresSet].filter(Boolean).sort(); const themes = [...themesSet].filter(Boolean).sort();
    const years = [...yearsSet].filter(Boolean).sort((a, b) => b - a);
    const btn = document.querySelector('.random-btn'); if (!btn) return; const rect = btn.getBoundingClientRect();
    const menu = document.createElement('div'); menu.id = 'random-menu-popup';
    menu.innerHTML = `
        <div class="random-menu-header">Случайное аниме</div>
        <div class="random-filter-group"><label>Жанр:</label><div class="custom-select" id="random-select-genre"><div class="custom-select-trigger"><span>Любой</span><span class="arrow">▼</span></div><div class="custom-options"><div class="custom-option selected" data-value="">Любой</div>${genres.map(g => `<div class="custom-option" data-value="${g}">${g}</div>`).join('')}</div></div></div>
        <div class="random-filter-group"><label>Тема:</label><div class="custom-select" id="random-select-theme"><div class="custom-select-trigger"><span>Любая</span><span class="arrow">▼</span></div><div class="custom-options"><div class="custom-option selected" data-value="">Любая</div>${themes.map(t => `<div class="custom-option" data-value="${t}">${t}</div>`).join('')}</div></div></div>
        <div class="random-filter-group"><label>Год:</label><div class="custom-select" id="random-select-year"><div class="custom-select-trigger"><span>Любой</span><span class="arrow">▼</span></div><div class="custom-options"><div class="custom-option selected" data-value="">Любой</div>${years.map(y => `<div class="custom-option" data-value="${y}">${y}</div>`).join('')}</div></div></div>
        <div class="random-filter-group"><label>Рейтинг:</label><div class="custom-select" id="random-select-rating"><div class="custom-select-trigger"><span>Любой</span><span class="arrow">▼</span></div><div class="custom-options"><div class="custom-option selected" data-value="">Любой</div><div class="custom-option" data-value="g">G - Без ограничений</div><div class="custom-option" data-value="pg">PG - Детям</div><div class="custom-option" data-value="pg_13">PG-13 - 13+</div><div class="custom-option" data-value="r_17">R-17 - 17+</div><div class="custom-option" data-value="r_plus">R+ - 18+</div><div class="custom-option" data-value="rx">Rx - 18++</div></div></div></div>
        <button class="random-menu-item random-roll-btn" onclick="doRandomAnime()"><span>Крутить</span></button>
    `;
    menu.style.position = 'absolute'; menu.style.top = `${rect.bottom + window.scrollY + 10}px`; menu.style.left = `${rect.left + window.scrollX - 120}px`;
    document.body.appendChild(menu);
    menu.querySelectorAll('.custom-select').forEach(select => {
        const trigger = select.querySelector('.custom-select-trigger'); const options = select.querySelector('.custom-options');
        trigger.addEventListener('click', (e) => { e.stopPropagation(); if (activeSelect && activeSelect !== select) activeSelect.classList.remove('open'); select.classList.toggle('open'); activeSelect = select.classList.contains('open') ? select : null; });
        options.addEventListener('click', (e) => { const option = e.target.closest('.custom-option'); if (!option) return; trigger.querySelector('span:first-child').textContent = option.textContent; options.querySelectorAll('.custom-option').forEach(o => o.classList.remove('selected')); option.classList.add('selected'); select.classList.remove('open'); activeSelect = null; });
    });
    setTimeout(() => { document.addEventListener('click', function closeMenu(e) { if (!menu.contains(e.target) && e.target !== btn) { menu.remove(); document.removeEventListener('click', closeMenu); } }); }, 100);
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

// ================== МЕНЮ СОЦСЕТЕЙ ==================
function toggleSocialMenu(e) { if (e) e.stopPropagation(); const menu = document.getElementById('social-menu'); if (menu) menu.classList.toggle('show'); }
document.addEventListener('click', () => { const menu = document.getElementById('social-menu'); if (menu && menu.classList.contains('show')) menu.classList.remove('show'); });
