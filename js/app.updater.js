// ================== АВТООБНОВЛЕНИЕ (UI) ==================
// Целевой репозиторий сайта и релизов. При переносе обновите owner/repo также в main.js и release.yml.
const RELEASE_REPOSITORY = Object.freeze({ owner: 'YamikoeStudio', repo: 'yamikoe-site' });
const RELEASES_API_URL = `https://api.github.com/repos/${RELEASE_REPOSITORY.owner}/${RELEASE_REPOSITORY.repo}/releases/latest`;
const RELEASE_DOWNLOAD_URL_PREFIX = `https://github.com/${RELEASE_REPOSITORY.owner}/${RELEASE_REPOSITORY.repo}/releases/download/`;
const RELEASE_ASSET_EXTENSIONS = {
    windows: ['.exe', '.msi', '.zip'],
    android: ['.apk'],
    linux: ['.appimage', '.tar.gz', '.deb']
};
let updateBanner = null;

async function fetchLatestRelease() {
    const response = await fetch(RELEASES_API_URL, {
        headers: { Accept: 'application/vnd.github+json' },
        cache: 'no-store'
    });
    if (!response.ok) {
        throw new Error(`GitHub Releases API: ${response.status} ${response.statusText}`.trim());
    }

    const release = await response.json();
    if (!release || !Array.isArray(release.assets)) {
        throw new Error('В ответе GitHub отсутствует список файлов релиза.');
    }
    return release;
}

function findReleaseAsset(release, platform) {
    const extensions = RELEASE_ASSET_EXTENSIONS[platform];
    if (!extensions) throw new Error('Неизвестная платформа для скачивания.');
    const candidates = release.assets.filter(asset => {
        const name = String(asset.name || '').toLowerCase();
        return extensions.some(extension => name.endsWith(extension)) &&
            !/uninstaller|blockmap|symbols/i.test(asset.name || '');
    });
    candidates.sort((left, right) => {
        const leftInstaller = /setup|installer/i.test(left.name) ? 0 : 1;
        const rightInstaller = /setup|installer/i.test(right.name) ? 0 : 1;
        return leftInstaller - rightInstaller;
    });
    return candidates[0] || null;
}

function isAllowedReleaseAssetUrl(value) {
    try {
        const url = new URL(value);
        return url.protocol === 'https:' && url.href.startsWith(RELEASE_DOWNLOAD_URL_PREFIX);
    } catch (error) {
        return false;
    }
}

window.YamikoeReleaseTools = {
    repository: `${RELEASE_REPOSITORY.owner}/${RELEASE_REPOSITORY.repo}`,
    apiUrl: RELEASES_API_URL,
    fetchLatestRelease,
    findReleaseAsset,
    isAllowedReleaseAssetUrl
};

function formatUpdateVersion(version) {
    return String(version || '').trim().replace(/^v/i, '').replace(/^(\d+\.\d+)\.0$/, '$1');
}

function openUpdatePlatformModal() {
    const modal = document.getElementById('update-platform-modal');
    const status = document.getElementById('update-download-status');
    if (!modal) return;
    status.textContent = '';
    status.classList.remove('is-error');
    modal.style.display = 'flex';
}

function closeUpdatePlatformModal() {
    const modal = document.getElementById('update-platform-modal');
    if (modal) modal.style.display = 'none';
}

async function downloadLatestRelease(platform) {
    const status = document.getElementById('update-download-status');
    const buttons = document.querySelectorAll('#update-platform-modal [data-update-platform]');
    buttons.forEach(button => { button.disabled = true; });
    status.classList.remove('is-error');
    const isElectron = window.electronAPI && typeof window.electronAPI.downloadLatestRelease === 'function';
    status.textContent = isElectron
        ? 'Скачивание файла в папку «Загрузки»...'
        : 'Подготавливаем прямое скачивание...';
    try {
        if (isElectron) {
            const result = await window.electronAPI.downloadLatestRelease(platform);
            status.textContent = `Файл «${result.fileName}» сохранён в папку «Загрузки».`;
            return;
        }

        const release = await fetchLatestRelease();
        const asset = findReleaseAsset(release, platform);
        if (!asset) {
            const platformNames = { windows: 'Windows', android: 'Android', linux: 'Linux' };
            throw new Error(`В последнем релизе нет файла для ${platformNames[platform] || platform}.`);
        }
        if (!asset.browser_download_url || !isAllowedReleaseAssetUrl(asset.browser_download_url)) {
            throw new Error('Ссылка на файл релиза недействительна.');
        }

        const link = document.createElement('a');
        link.href = asset.browser_download_url;
        link.download = asset.name;
        link.rel = 'noopener';
        link.hidden = true;
        document.body.appendChild(link);
        link.click();
        link.remove();
        status.textContent = `Скачивание «${asset.name}» началось. Файл появится в папке загрузок браузера.`;
    } catch (error) {
        status.textContent = String(error && error.message || error || 'Не удалось скачать файл.');
        status.classList.add('is-error');
    } finally {
        buttons.forEach(button => { button.disabled = false; });
    }
}

function initUpdateListener() {
    if (!window.electronAPI) return;

    updateBanner = document.getElementById('update-banner');
    const updateText = document.getElementById('update-text');
    const updateBtn = document.getElementById('update-btn');
    const restartBtn = document.getElementById('restart-btn');
    const progressFill = document.getElementById('update-progress-fill');

    if (!updateBanner) return;

    window.electronAPI.onUpdateAvailable((info) => {
        updateBanner.style.display = 'flex';
        updateText.textContent = `Доступна новая версия v${formatUpdateVersion(info.version)}!`;
        updateBtn.style.display = 'block';
        restartBtn.style.display = 'none';
        progressFill.style.width = '0%';
        progressFill.parentElement.style.display = 'none';
    });

    window.electronAPI.onUpdateProgress((progress) => {
        progressFill.parentElement.style.display = 'block';
        const percent = Math.round(progress.percent);
        const speedMB = (progress.bytesPerSecond / 1024 / 1024).toFixed(1);
        updateText.textContent = `Скачивание обновления... ${percent}% (${speedMB} МБ/с)`;
        progressFill.style.width = `${percent}%`;
        updateBtn.style.display = 'none';
    });

    window.electronAPI.onUpdateDownloaded((info) => {
        updateText.textContent = `Обновление v${formatUpdateVersion(info.version)} готово!`;
        progressFill.parentElement.style.display = 'none';
        restartBtn.style.display = 'block';
    });

    window.electronAPI.onUpdateError((error) => {
        updateText.textContent = `Ошибка обновления: ${error}`;
        updateBtn.style.display = 'none';
        setTimeout(() => { updateBanner.style.display = 'none'; }, 10000);
    });
}

function startUpdate() {
    if (window.electronAPI) window.electronAPI.startDownloadUpdate();
}

function restartApp() {
    if (window.electronAPI) window.electronAPI.installUpdate();
}

document.addEventListener('DOMContentLoaded', () => {
    initUpdateListener();
});

document.addEventListener('keydown', (event) => {
    const modal = document.getElementById('update-platform-modal');
    if (event.key === 'Escape' && modal && modal.style.display !== 'none') {
        event.preventDefault();
        closeUpdatePlatformModal();
    }
});

// ---------- Страховка: вычищаем нативные подсказки (атрибут title) ----------
if (window.electronAPI && window.electronAPI.onFullscreenChanged) {
    window.electronAPI.onFullscreenChanged((on) => {
        appFullscreen = !!on;
        const w = document.getElementById('custom-player');
        if (w) w.classList.toggle('player-fullscreen', !!on);
    });
}

(function stripNativeTitles() {
    const strip = (root) => {
        if (!root || root.nodeType !== 1) return;
        if (root.hasAttribute('title')) root.removeAttribute('title');
        root.querySelectorAll('[title]').forEach(el => el.removeAttribute('title'));
    };
    const start = () => {
        strip(document.body);
        new MutationObserver((muts) => {
            for (const m of muts) {
                if (m.type === 'attributes') m.target.removeAttribute('title');
                else m.addedNodes.forEach(strip);
            }
        }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['title'] });
    };
    if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
})();
