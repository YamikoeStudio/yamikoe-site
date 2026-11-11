// ================== УМНЫЙ ПОИСК ==================
const ruToEn = { 'й':'q','ц':'w','у':'e','к':'r','е':'t','н':'y','г':'u','ш':'i','щ':'o','з':'p','х':'[','ъ':']','ф':'a','ы':'s','в':'d','а':'f','п':'g','о':'j','л':'k','д':'l','ж':';','э':"'",'я':'z','ч':'x','с':'c','м':'v','и':'b','т':'n','ь':'m','б':',','ю':'.' };
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
// ---------- Настройки сетки карточек ----------
const GRID_COUNTS = [12, 24, 30, 48, 72];
const GRID_ALIGNS = ['start', 'center', 'stretch'];
function applyGridSettings() {
    let size = parseInt(storage.getSetting('cardSize', 180), 10);
    if (!size || size < 140) size = 140;
    if (size > 260) size = 260;
    let align = storage.getSetting('gridAlign', 'start');
    if (!GRID_ALIGNS.includes(align)) align = 'start';
    let count = parseInt(storage.getSetting('gridCount', 30), 10);
    if (!GRID_COUNTS.includes(count)) count = 30;
    document.documentElement.style.setProperty('--card-w', size + 'px');
    document.documentElement.setAttribute('data-grid-align', align);
    releasePage_limit = count;
    return { size, align, count };
}
function syncGridSettingsUI() {
    const s = applyGridSettings();
    const range = document.getElementById('setting-card-size');
    if (range) range.value = s.size;
    const label = document.getElementById('card-size-value');
    if (label) label.textContent = s.size;
    document.querySelectorAll('#setting-grid-align .seg-btn').forEach(b => b.classList.toggle('active', b.dataset.value === s.align));
    document.querySelectorAll('#setting-grid-count .seg-btn').forEach(b => b.classList.toggle('active', parseInt(b.dataset.value, 10) === s.count));
}
function previewCardSize(value) {
    const label = document.getElementById('card-size-value');
    if (label) label.textContent = value;
    document.documentElement.style.setProperty('--card-w', value + 'px');
}
function saveCardSize(value) {
    storage.setSetting('cardSize', parseInt(value, 10));
    syncGridSettingsUI();
}
function setGridAlign(value) {
    storage.setSetting('gridAlign', value);
    syncGridSettingsUI();
}
function setGridCount(value) {
    storage.setSetting('gridCount', parseInt(value, 10));
    syncGridSettingsUI();
    releasePage_showing = releasePage_limit;
    const activeTab = document.querySelector('.nav-btn.active');
    if (activeTab) switchTab(activeTab.id.replace('btn-', ''));
    renderMainPage();
}
function resetGridSettings() {
    storage.setSetting('cardSize', 180);
    storage.setSetting('gridAlign', 'start');
    setGridCount(30);
}

function openSettings() {
    syncGridSettingsUI();
    const auto = document.getElementById('setting-autoplay-next');
    if (auto) auto.checked = storage.getSetting('autoplayNext', true);
    const skip = document.getElementById('setting-skip-time');
    if (skip) skip.value = storage.getSetting('skipTime', 90);
    
    const adultCheckbox = document.getElementById('setting-adult-mode');
    if (adultCheckbox) adultCheckbox.checked = storage.getSetting('adultMode', false);

    const ver = document.getElementById('app-version');
    if (ver) ver.textContent = 'v' + APP_VERSION;
    document.getElementById('settings-modal').style.display = 'flex';
}
function closeSettings() { document.getElementById('settings-modal').style.display = 'none'; }
function toggleAutoplayNext(enabled) { storage.setSetting('autoplayNext', enabled); }
function saveSkipSettings() {
    const input = document.getElementById('setting-skip-time');
    let skipVal = parseInt(input.value, 10);
    if (!skipVal || skipVal < 1) skipVal = 90;
    if (skipVal > 600) skipVal = 600;
    input.value = skipVal;
    storage.setSetting('skipTime', skipVal);
}
function openBindingsModal() { document.getElementById('bindings-modal').style.display = 'flex'; }
function closeBindingsModal() { document.getElementById('bindings-modal').style.display = 'none'; }
document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const m = document.getElementById('bindings-modal');
    if (m && m.style.display !== 'none') {
        e.preventDefault();
        e.stopImmediatePropagation();
        closeBindingsModal();
    }
});

// ================== 18+ ЛОГИКА ==================
async function handleAdultToggle() {
    const checkbox = document.getElementById('setting-adult-mode');
    const isChecked = checkbox.checked;

    if (isChecked) {
        const confirmed = await showConfirm(
            'Вы собираетесь включить контент 18+.\n\nВам есть 18 лет?',
            'Подтверждение возраста'
        );
        if (confirmed) {
            storage.setSetting('adultMode', true);
            if (filtersInitialized) { initFilters(); applyFilters(); }
            renderHistory(); renderFavorites(); renderMainPage();
        } else {
            checkbox.checked = false; 
        }
    } else {
        storage.setSetting('adultMode', false);
        if (filtersInitialized) { initFilters(); applyFilters(); }
        renderHistory(); renderFavorites(); renderMainPage();
    }
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
