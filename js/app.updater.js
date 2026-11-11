// ================== АВТООБНОВЛЕНИЕ (UI) ==================
let updateBanner = null;

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
        updateText.textContent = `Доступна новая версия v${info.version}!`;
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
        updateText.textContent = `Обновление v${info.version} готово!`;
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
