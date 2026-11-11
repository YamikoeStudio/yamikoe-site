// ================== ПЛЕЕР (ОВЕРЛЕЙ) ==================
const PLAYER_SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
let playerSession = null;

function openPlayerOverlay() {
    document.getElementById('player-overlay').style.display = 'flex';
    document.body.style.overflow = 'hidden';
}

function saveCurrentPosition() {
    const video = document.getElementById('my-player');
    if (!video || !currentAnime || currentEpisodeNumber === null) return;
    const dur = video.duration;
    if (video.ended || (isFinite(dur) && dur > 0 && video.currentTime > dur - 5)) {
        storage.clearPlaybackPosition(currentAnime.id, currentEpisodeNumber);
    } else {
        storage.setPlaybackPosition(currentAnime.id, currentEpisodeNumber, video.currentTime, dur);
    }
}

function teardownPlayer() {
    if (!playerSession) return;
    const session = playerSession;
    playerSession = null;
    session.closed = true;
    session.cleanups.forEach(fn => { try { fn(); } catch (e) { /* игнорируем */ } });
    if (session.requestController) session.requestController.abort();
    if (session.hls) { try { session.hls.destroy(); } catch (e) { /* игнорируем */ } }
    if (session.video) {
        try { session.video.pause(); session.video.removeAttribute('src'); session.video.load(); } catch (e) { /* игнорируем */ }
    }
}

// ---------- Настоящий полноэкранный режим ----------
let appFullscreen = false;
const hasElectronFs = () => !!(window.electronAPI && window.electronAPI.setFullScreen);
function setAppFullscreen(on) {
    on = !!on;
    appFullscreen = on;
    const w = document.getElementById('custom-player');
    if (w) w.classList.toggle('player-fullscreen', on);
    if (hasElectronFs()) {
        window.electronAPI.setFullScreen(on);
    } else if (on) {
        if (w && w.requestFullscreen) w.requestFullscreen().catch(() => {});
    } else if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
    }
}

function closePlayerOverlay() {
    if (appFullscreen) setAppFullscreen(false);
    saveCurrentPosition();
    teardownPlayer();
    const overlay = document.getElementById('player-overlay');
    overlay.style.display = 'none';
    document.body.style.overflow = '';
    document.getElementById('overlay-video-container').innerHTML = '';
    currentEpisodeNumber = null;
    pendingResumeTime = 0;
}

function toggleEpisodesPanel() {
    const panel = document.getElementById('episodes-panel');
    if (panel) panel.classList.toggle('open');
}

function skipTime() {
    const video = document.getElementById('my-player');
    if (!video) return;
    const sec = parseInt(storage.getSetting('skipTime', 90), 10) || 0;
    video.currentTime = Math.min(video.currentTime + sec, (video.duration || Infinity) - 1);
}

function playPrevEpisode() {
    if (!currentAnime || currentEpisodeNumber === null) return;
    const idx = currentAnime.episodes.findIndex(e => e.number === currentEpisodeNumber);
    if (idx > 0) playEpisode(currentAnime.episodes[idx - 1].number);
}
function playNextEpisode() {
    if (!currentAnime || currentEpisodeNumber === null) return;
    const idx = currentAnime.episodes.findIndex(e => e.number === currentEpisodeNumber);
    if (idx >= 0 && idx + 1 < currentAnime.episodes.length) playEpisode(currentAnime.episodes[idx + 1].number);
}
function applyResume() {
    const video = document.getElementById('my-player');
    if (!video) return;
    video.currentTime = pendingResumeTime;
    document.getElementById('resume-bar').style.display = 'none';
    pendingResumeTime = 0;
    video.play();
}
function dismissResume() {
    const bar = document.getElementById('resume-bar');
    if (bar) bar.style.display = 'none';
    pendingResumeTime = 0;
}

function normalizeSegment(seg) {
    if (!seg) return null;
    const start = Number(seg.start);
    const end = Number(seg.end);
    if (!isFinite(start) || !isFinite(end) || start < 0 || end <= start) return null;
    return { start, end };
}

function ensureWatched(epNum) {
    if (!currentAnime) return;
    if (!storage.getWatched(currentAnime.id).includes(epNum)) handleToggleWatched(null, epNum);
}

async function playEpisode(number, event) {
    if (event) event.stopPropagation();
    if (!currentAnime) return;
    const videoData = API.findVideoAnime(currentAnime.id);
    const ep = (videoData?.episodes || []).find(e => e.number === number);
    if (!ep) { showAlert('Серия не найдена.', 'Ошибка'); return; }

    saveCurrentPosition();
    teardownPlayer();

    currentEpisodeNumber = number;
    openPlayerOverlay();
    renderPlayer(ep, number);
}


function renderPlayer(ep, number) {
    const container = document.getElementById('overlay-video-container');
    const episodes = currentAnime.episodes;
    const idx = episodes.findIndex(e => e.number === number);
    const hasPrev = idx > 0;
    const hasNext = idx >= 0 && idx + 1 < episodes.length;
    const title = String(currentAnime.title || '').replace(/</g, '&lt;');

    container.innerHTML = `
        <div class="custom-player-wrapper" id="custom-player">
            <video id="my-player" autoplay playsinline></video>

            <div class="player-buffering visible" id="player-buffering" role="status" aria-live="polite">
                <div class="player-spinner"></div>
                <span class="player-loading-text">Загрузка серии ${number}...</span>
            </div>
            <div class="player-osd" id="player-osd"></div>
            <button class="skip-segment-btn" id="skip-segment-btn" style="display: none;"></button>

            <div class="player-end-overlay" id="player-end-overlay" style="display: none;">
                <div class="player-end-card">
                    <div class="player-end-title">Серия ${number} завершена</div>
                    <div class="player-end-sub">${title}</div>
                    <div class="player-end-actions">
                        <button class="end-btn end-btn-primary" id="end-next-btn" ${hasNext ? '' : 'disabled'}>Следующая серия</button>
                        <button class="end-btn" id="end-replay-btn">Повторить</button>
                        <button class="end-btn" id="end-home-btn">На главную</button>
                    </div>
                </div>
            </div>

            <div class="player-error-overlay" id="player-error-overlay" style="display: none;">
                <div class="player-error-card">
                    <p class="player-error-title">Ошибка воспроизведения</p>
                    <p class="player-error-text" id="player-error-text">Не удалось загрузить видео. Возможно, файл недоступен или повреждён.</p>
                    <div class="player-end-actions">
                        <button class="end-btn end-btn-primary" id="error-retry-btn">Повторить</button>
                        <button class="end-btn" id="error-close-btn">Закрыть</button>
                    </div>
                </div>
            </div>

            <aside class="episodes-panel" id="episodes-panel">
                <div class="episodes-panel-header">
                    <span>Серии</span>
                    <span class="close-btn" onclick="toggleEpisodesPanel()">&times;</span>
                </div>
                <div class="episodes-panel-list" id="episodes-panel-list"></div>
            </aside>

            <button type="button" class="player-close-btn" id="player-close-btn" title="Закрыть плеер" aria-label="Закрыть плеер">✕</button>

            <div class="player-controls">
                <div class="player-top-info">
                    <span class="player-title">${title}</span>
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
                        <div class="player-progress-buffer" id="player-progress-buffer"></div>
                        <div class="player-progress-fill" id="player-progress-fill"></div>
                        <div class="player-progress-thumb" id="player-progress-thumb"></div>
                        <div class="player-progress-tooltip" id="player-progress-tooltip">0:00</div>
                    </div>
                </div>
                <div class="player-bottom-wrapper">
                    <div class="player-bottom-left">
                        <div class="player-time-volume">
                            <span class="player-time" id="time-current">0:00</span> / <span class="player-time" id="time-total">0:00</span>
                            <span class="player-time player-time-remaining" id="time-remaining">(-0:00)</span>
                            <div class="volume-container">
                                <button class="player-btn" id="mute-btn" title="Выключить звук" aria-label="Выключить звук"><svg id="icon-volume" viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg><svg id="icon-mute" viewBox="0 0 24 24" style="display:none;"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4 9.91 6.09 12 8.18V4z"/></svg></button>
                                <div class="volume-slider" id="volume-slider"><div class="volume-fill" id="volume-fill"></div><div class="volume-thumb" id="volume-thumb"></div></div>
                            </div>
                        </div>
                    </div>
                    <div class="player-center-controls">
                        <button class="player-btn player-btn-nav" id="prev-btn" title="Предыдущая серия" aria-label="Предыдущая серия" ${hasPrev ? '' : 'disabled'}><svg viewBox="0 0 24 24"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg></button>
                        <button class="player-btn player-btn-seek" id="rewind-btn" title="Назад на 10 секунд" aria-label="Назад на 10 секунд">−10</button>
                        <button class="player-btn player-btn-main" id="play-pause-btn" title="Воспроизвести" aria-label="Воспроизвести"><svg id="icon-pause" viewBox="0 0 24 24" style="display:none;"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg><svg id="icon-play" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></button>
                        <button class="player-btn player-btn-seek" id="forward-btn" title="Вперёд на 10 секунд" aria-label="Вперёд на 10 секунд">+10</button>
                        <button class="player-btn player-btn-nav" id="next-btn" title="Следующая серия" aria-label="Следующая серия" ${hasNext ? '' : 'disabled'}><svg viewBox="0 0 24 24"><path d="M16 6h2v12h-2zM6 18l8.5-6L6 6z"/></svg></button>
                    </div>
                    <div class="player-buttons-right">
                        <button class="player-btn" id="skip-btn" title="Пропустить опенинг" aria-label="Пропустить опенинг"><svg viewBox="0 0 24 24"><path d="M4 18l8.5-6L4 6v12zm9-12v12l8.5-6L13 6z"/></svg></button>
                        <button type="button" class="player-btn player-btn-speed" id="speed-btn" title="Скорость воспроизведения" aria-label="Скорость воспроизведения">1x</button>
                        <button type="button" class="player-btn player-btn-quality" id="subs-btn" title="Субтитры" aria-label="Субтитры" style="display: none;"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M7 10h4m2 0h4M7 14h2m2 0h6"/></svg></button>
                        <button class="player-btn player-btn-pip" id="pip-btn" title="Картинка в картинке" aria-label="Картинка в картинке"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="2"/><rect x="12" y="12" width="8" height="6" rx="1" fill="currentColor"/></svg></button>
                        <button type="button" class="player-btn player-btn-quality" id="quality-btn" title="Качество видео" aria-label="Качество видео" style="display: none;">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <line x1="4" y1="21" x2="4" y2="14"></line><line x1="4" y1="10" x2="4" y2="3"></line>
                                <line x1="12" y1="21" x2="12" y2="12"></line><line x1="12" y1="8" x2="12" y2="3"></line>
                                <line x1="20" y1="21" x2="20" y2="16"></line><line x1="20" y1="12" x2="20" y2="3"></line>
                                <line x1="1" y1="14" x2="7" y2="14"></line><line x1="9" y1="8" x2="15" y2="8"></line><line x1="17" y1="16" x2="23" y2="16"></line>
                            </svg>
                            <span class="quality-badge" id="quality-badge"></span>
                        </button>
                        <button class="player-btn" id="episodes-toggle-btn" title="Список серий" aria-label="Список серий"><svg viewBox="0 0 24 24"><path d="M3 6h18v2H3zm0 5h18v2H3zm0 5h18v2H3z"/></svg></button>
                        <button class="player-btn" id="fullscreen-btn" title="Полноэкранный режим" aria-label="Полноэкранный режим"><svg viewBox="0 0 24 24"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/></svg></button>
                    </div>
                </div>
                <div class="quality-menu speed-menu" id="speed-menu">
                    <div class="quality-menu-list" id="speed-menu-list"></div>
                </div>
                <div class="quality-menu" id="quality-menu">
                    <div class="quality-menu-list" id="quality-menu-list">
                        <div class="quality-menu-item selected" data-level="-1">Авто</div>
                    </div>
                </div>
            </div>
        </div>
    `;

    const video = document.getElementById('my-player');
    const session = { hls: null, video, closed: false, cleanups: [], requestController: null };
    playerSession = session;

    const savedRate = clampSpeed(Number(storage.getSetting('playbackRate', 1)));
    video.defaultPlaybackRate = savedRate;
    video.playbackRate = savedRate;
    video.volume = Math.max(0, Math.min(1, Number(storage.getSetting('volume', 1))));
    video.muted = !!storage.getSetting('muted', false);

    renderEpisodesPanel(number);
    initPlayerLogic(session, ep, number);
    loadEpisodeSource(session, ep, number);
}

function layoutPlayerVideo(video, wrapper) {
    const viewportWidth = wrapper.clientWidth || document.documentElement.clientWidth;
    const viewportHeight = wrapper.clientHeight || window.visualViewport?.height || window.innerHeight;
    const isPortraitPhone = viewportWidth <= 1100 && viewportHeight > viewportWidth;
    const ratio = video.videoWidth > 0 && video.videoHeight > 0
        ? video.videoWidth / video.videoHeight
        : 16 / 9;
    const controls = wrapper.querySelector('.player-controls');
    let controlsHeight = 0;
    if (isPortraitPhone && controls) {
        wrapper.classList.add('player-mobile-portrait');
        wrapper.style.setProperty('--player-video-height', '0px');
        controlsHeight = controls.scrollHeight;
    }
    const maxWidth = viewportWidth;
    const maxHeight = isPortraitPhone
        ? Math.max(120, viewportHeight - controlsHeight)
        : viewportHeight;
    const scale = Math.min(maxWidth / ratio, maxHeight);
    const height = Math.round(scale);
    const width = Math.round(scale * ratio);

    video.style.width = `${width}px`;
    video.style.height = `${height}px`;
    wrapper.classList.toggle('player-mobile-portrait', isPortraitPhone);
    wrapper.style.setProperty('--player-video-height', `${height}px`);
}

function clampSpeed(rate) {
    if (!isFinite(rate)) return 1;
    const r = Math.round(rate * 4) / 4;
    return Math.max(PLAYER_SPEEDS[0], Math.min(PLAYER_SPEEDS[PLAYER_SPEEDS.length - 1], r));
}

function attachPlayerSource(session, video, url, number) {
    if (typeof Hls !== 'undefined' && Hls.isSupported()) {
        const hls = new Hls({ enableWorker: true });
        session.hls = hls;
        if (session.setHls) session.setHls(hls);
        hls.on(Hls.Events.ERROR, (event, data) => {
            if (session.closed || !data.fatal) return;
            const message = data.response?.code === 403
                ? 'Доступ к видео запрещён (HTTP 403)'
                : 'Не удалось загрузить HLS-поток. Проверьте CORS и доступ к видео.';
            showPlayerError(number, message);
        });
        hls.loadSource(url);
        hls.attachMedia(video);
    } else {
        video.src = url;
        video.load();
    }
}

async function loadEpisodeSource(session, ep, number) {
    if (!ep.bunny_id || typeof window.getHlsVideoUrl !== 'function') {
        showPlayerError(number, 'Ошибка загрузки видео');
        return;
    }

    const controller = new AbortController();
    session.requestController = controller;
    const buffering = document.getElementById('player-buffering');
    if (buffering) buffering.classList.add('visible');

    try {
        const url = await window.getHlsVideoUrl(String(ep.bunny_id), {
            signal: controller.signal,
            timeoutMs: 15000
        });
        if (session.closed || playerSession !== session) return;
        attachPlayerSource(session, session.video, url, number);
    } catch (error) {
        if (session.closed || playerSession !== session) return;
        if (error.name === 'AbortError' && controller.signal.aborted) return;
        console.error('[VideoPlayer] Failed to resolve episode stream:', error);
        showPlayerError(number, error.message || 'Ошибка загрузки видео');
    }
}

function showPlayerError(number, message) {
    const overlay = document.getElementById('player-error-overlay');
    if (!overlay) return;
    const text = document.getElementById('player-error-text');
    if (text) text.textContent = message || 'Ошибка загрузки видео';
    const buffering = document.getElementById('player-buffering');
    if (buffering) buffering.classList.remove('visible');
    overlay.style.display = 'flex';
}

function initPlayerLogic(session, ep, number) {
    const video = session.video;
    let hls = session.hls;
    const $ = (id) => document.getElementById(id);
    const wrapper = $('custom-player');
    const episodes = currentAnime.episodes;
    const idx = episodes.findIndex(e => e.number === number);
    const hasNext = idx >= 0 && idx + 1 < episodes.length;

    const playPauseBtn = $('play-pause-btn');
    const iconPlay = $('icon-play'); const iconPause = $('icon-pause');
    const timeCurrent = $('time-current'); const timeTotal = $('time-total'); const timeRemaining = $('time-remaining');
    const progress = $('player-progress'); const progressFill = $('player-progress-fill');
    const progressThumb = $('player-progress-thumb'); const progressBuffer = $('player-progress-buffer');
    const progressTooltip = $('player-progress-tooltip');
    const volumeSlider = $('volume-slider'); const volumeFill = $('volume-fill'); const volumeThumb = $('volume-thumb');
    const muteBtn = $('mute-btn'); const iconVolume = $('icon-volume'); const iconMute = $('icon-mute');
    const fullscreenBtn = $('fullscreen-btn'); const pipBtn = $('pip-btn');
    const bufferingEl = $('player-buffering'); const osdEl = $('player-osd');
    const skipSegBtn = $('skip-segment-btn'); const endOverlay = $('player-end-overlay');
    const speedBtn = $('speed-btn'); const speedMenu = $('speed-menu'); const speedList = $('speed-menu-list');
    const qualityBtn = $('quality-btn'); const qualityMenu = $('quality-menu'); const qualityList = $('quality-menu-list');
    const qualityBadge = $('quality-badge');
    const subtitlesBtn = $('subs-btn');

    const listen = (target, type, handler, opts) => {
        target.addEventListener(type, handler, opts);
        session.cleanups.push(() => target.removeEventListener(type, handler, opts));
    };
    const alive = () => playerSession === session && !session.closed;

    const resizeVideo = () => layoutPlayerVideo(video, wrapper);
    resizeVideo();
    listen(video, 'loadedmetadata', resizeVideo);
    listen(window, 'resize', resizeVideo);
    listen(window, 'orientationchange', resizeVideo);
    if (window.visualViewport) listen(window.visualViewport, 'resize', resizeVideo);

    let osdTimer = null;
    const showOsd = (text) => {
        osdEl.textContent = text;
        osdEl.classList.add('visible');
        clearTimeout(osdTimer);
        osdTimer = setTimeout(() => osdEl.classList.remove('visible'), 900);
    };
    session.cleanups.push(() => clearTimeout(osdTimer));

    let hideTimer = null;
    const showControls = () => {
        wrapper.classList.remove('controls-hidden');
        clearTimeout(hideTimer);
        if (!video.paused) hideTimer = setTimeout(hideControls, 2500);
    };
    const hideControls = () => {
        if (video.paused) return;
        if (speedMenu.classList.contains('open') || qualityMenu.classList.contains('open')) return;
        wrapper.classList.add('controls-hidden');
    };
    session.cleanups.push(() => clearTimeout(hideTimer));
    listen(wrapper, 'mousemove', showControls);
    listen(wrapper, 'mouseleave', () => { if (!video.paused) hideControls(); });


    const togglePlay = () => { if (video.paused) video.play().catch(() => {}); else video.pause(); };
    listen(playPauseBtn, 'click', togglePlay);

    listen(video, 'play', () => {
        iconPlay.style.display = 'none'; iconPause.style.display = 'block';
        playPauseBtn.setAttribute('aria-label', 'Пауза');
        playPauseBtn.title = 'Пауза';
        wrapper.classList.remove('paused');
        endOverlay.style.display = 'none';
        showControls();
    });
    listen(video, 'pause', () => {
        iconPlay.style.display = 'block'; iconPause.style.display = 'none';
        playPauseBtn.setAttribute('aria-label', 'Воспроизвести');
        playPauseBtn.title = 'Воспроизвести';
        wrapper.classList.add('paused');
        wrapper.classList.remove('controls-hidden');
        clearTimeout(hideTimer);
        if (!video.ended) saveCurrentPosition();
    });

    const saveInterval = setInterval(() => { if (!video.paused) saveCurrentPosition(); }, 5000);
    session.cleanups.push(() => clearInterval(saveInterval));

    let clickTimer = null;
    listen(video, 'click', () => {
        if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; return; }
        clickTimer = setTimeout(() => { clickTimer = null; togglePlay(); }, 220);
    });
    listen(video, 'dblclick', () => {
        if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
        toggleFullscreen();
    });
    session.cleanups.push(() => clearTimeout(clickTimer));

    // ---------- Прогресс-бар (мышь + тач) ----------
    let isDragging = false;
    const getClientX = (e) => (e.touches && e.touches.length) ? e.touches[0].clientX : (e.changedTouches && e.changedTouches.length ? e.changedTouches[0].clientX : e.clientX);

    const posFromEvent = (e) => {
        const rect = progress.getBoundingClientRect();
        const clientX = getClientX(e);
        return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    };
    const seekTo = (e) => {
        const pos = posFromEvent(e);
        progressFill.style.width = `${pos * 100}%`;
        progressThumb.style.left = `${pos * 100}%`;
        if (video.duration) {
            timeCurrent.textContent = formatTime(pos * video.duration);
            video.currentTime = pos * video.duration;
        }
    };
    listen(progress, 'mousedown', (e) => { isDragging = true; seekTo(e); });
    listen(progress, 'mousemove', (e) => {
        if (!video.duration) return;
        const pos = posFromEvent(e);
        progressTooltip.textContent = formatTime(pos * video.duration);
        progressTooltip.style.left = `${pos * 100}%`;
    });
    // Тач
    listen(progress, 'touchstart', (e) => { isDragging = true; seekTo(e); }, { passive: true });
    listen(progress, 'touchmove', (e) => {
        if (!isDragging) return;
        e.preventDefault();
        seekTo(e);
    }, { passive: false });

    // ---------- Громкость (мышь + тач) ----------
    let isVolumeDragging = false;
    let volumeSaveTimer = null;
    const syncVolumeUI = () => {
        const v = video.muted ? 0 : video.volume;
        volumeFill.style.width = `${v * 100}%`;
        volumeThumb.style.left = `${v * 100}%`;
        iconVolume.style.display = v > 0 ? 'block' : 'none';
        iconMute.style.display = v > 0 ? 'none' : 'block';
        muteBtn.setAttribute('aria-label', v > 0 ? 'Выключить звук' : 'Включить звук');
        muteBtn.title = v > 0 ? 'Выключить звук' : 'Включить звук';
    };
    const setVolumeValue = (v) => {
        v = Math.max(0, Math.min(1, v));
        video.volume = v;
        video.muted = v === 0;
        syncVolumeUI();
    };
    const volumeFromEvent = (e) => {
        const rect = volumeSlider.getBoundingClientRect();
        const clientX = getClientX(e);
        setVolumeValue((clientX - rect.left) / rect.width);
    };
    listen(volumeSlider, 'mousedown', (e) => { isVolumeDragging = true; volumeFromEvent(e); });
    listen(volumeSlider, 'touchstart', (e) => { isVolumeDragging = true; volumeFromEvent(e); }, { passive: true });
    listen(volumeSlider, 'touchmove', (e) => {
        if (!isVolumeDragging) return;
        e.preventDefault();
        volumeFromEvent(e);
    }, { passive: false });

    listen(video, 'volumechange', () => {
        syncVolumeUI();
        clearTimeout(volumeSaveTimer);
        volumeSaveTimer = setTimeout(() => {
            storage.setSetting('volume', video.volume);
            storage.setSetting('muted', video.muted);
        }, 300);
    });
    session.cleanups.push(() => clearTimeout(volumeSaveTimer));
    listen(muteBtn, 'click', () => {
        video.muted = !video.muted;
        if (!video.muted && video.volume === 0) video.volume = 0.5;
        syncVolumeUI();
        showOsd(video.muted ? 'Звук выключен' : `Громкость ${Math.round(video.volume * 100)}%`);
    });
    syncVolumeUI();

    listen(wrapper, 'wheel', (e) => {
        if (e.target.closest('.episodes-panel') || e.target.closest('.quality-menu')) return;
        e.preventDefault();
        const base = video.muted ? 0 : video.volume;
        const next = Math.round((base + (e.deltaY < 0 ? 0.05 : -0.05)) * 100) / 100;
        setVolumeValue(next);
        showOsd(`Громкость ${Math.round(video.volume * 100)}%`);
        showControls();
    }, { passive: false });

    // ---------- Глобальные обработчики drag (мышь + тач) ----------
    listen(window, 'mousemove', (e) => {
        if (isDragging) seekTo(e);
        if (isVolumeDragging) volumeFromEvent(e);
    });
    listen(window, 'mouseup', () => { isDragging = false; isVolumeDragging = false; });

    listen(window, 'touchmove', (e) => {
        if (isDragging) { e.preventDefault(); seekTo(e); }
        if (isVolumeDragging) { e.preventDefault(); volumeFromEvent(e); }
    }, { passive: false });
    listen(window, 'touchend', () => { isDragging = false; isVolumeDragging = false; });
    listen(window, 'touchcancel', () => { isDragging = false; isVolumeDragging = false; });

    // ---------- Время и прогресс ----------
    const updateTimes = () => {
        const dur = video.duration;
        if (!isFinite(dur) || dur <= 0) return;
        if (!isDragging) {
            const percent = (video.currentTime / dur) * 100;
            progressFill.style.width = `${percent}%`;
            progressThumb.style.left = `${percent}%`;
            timeCurrent.textContent = formatTime(video.currentTime);
        }
        timeRemaining.textContent = `(-${formatTime(dur - video.currentTime)})`;
    };
    const updateBuffered = () => {
        const dur = video.duration;
        if (!isFinite(dur) || dur <= 0 || !video.buffered.length) return;
        let end = 0;
        for (let i = 0; i < video.buffered.length; i++) {
            if (video.buffered.start(i) <= video.currentTime + 0.5) end = Math.max(end, video.buffered.end(i));
        }
        progressBuffer.style.width = `${Math.min(100, (end / dur) * 100)}%`;
    };

    // ---------- Skip intro / outro ----------
    const intro = normalizeSegment(ep.intro);
    const outro = normalizeSegment(ep.outro);
    let activeSegment = null;
    const updateSegmentButton = () => {
        const t = video.currentTime;
        let seg = null; let label = '';
        if (intro && t >= intro.start && t < intro.end) { seg = intro; label = 'Пропустить опенинг'; }
        else if (outro && t >= outro.start && t < outro.end) { seg = outro; label = 'Пропустить эндинг'; }
        if (seg === activeSegment) return;
        activeSegment = seg;
        if (seg) { skipSegBtn.textContent = `${label} ▶▶`; skipSegBtn.style.display = 'flex'; }
        else { skipSegBtn.style.display = 'none'; }
    };
    listen(skipSegBtn, 'click', (e) => {
        e.stopPropagation();
        if (!activeSegment) return;
        const target = isFinite(video.duration) ? Math.min(activeSegment.end, video.duration - 0.3) : activeSegment.end;
        video.currentTime = target;
        activeSegment = null;
        skipSegBtn.style.display = 'none';
    });

    const addSegmentMarks = () => {
        const dur = video.duration;
        if (!isFinite(dur) || dur <= 0) return;
        progress.querySelectorAll('.player-segment').forEach(el => el.remove());
        [intro, outro].forEach(seg => {
            if (!seg) return;
            const mark = document.createElement('div');
            mark.className = 'player-segment';
            mark.style.left = `${(seg.start / dur) * 100}%`;
            mark.style.width = `${(Math.min(seg.end, dur) - seg.start) / dur * 100}%`;
            progress.appendChild(mark);
        });
    };

    // ---------- Автоотметка «просмотрено» ----------
    let playedSeconds = 0; let lastTime = null; let watchMarked = false;
    const trackWatch = () => {
        if (watchMarked) return;
        const t = video.currentTime;
        if (!video.paused && lastTime !== null) {
            const d = t - lastTime;
            if (d > 0 && d < 1.5) playedSeconds += d;
        }
        lastTime = t;
        if (playedSeconds >= 10) { watchMarked = true; ensureWatched(number); }
    };

    listen(video, 'timeupdate', () => {
        if (!alive()) return;
        updateTimes();
        updateSegmentButton();
        trackWatch();
        updateBuffered();
        if (video.readyState >= 3) bufferingEl.classList.remove('visible');
    });
    listen(video, 'progress', updateBuffered);
    listen(video, 'seeked', () => { lastTime = video.currentTime; });

    // ---------- Индикатор буферизации ----------
    const setBuffering = (on) => bufferingEl.classList.toggle('visible', on);
    listen(video, 'loadstart', () => setBuffering(true));
    listen(video, 'waiting', () => setBuffering(true));
    listen(video, 'seeking', () => { if (video.readyState < 3) setBuffering(true); });
    ['canplay', 'playing', 'seeked', 'loadeddata'].forEach(evt => {
        listen(video, evt, () => { if (video.readyState >= 3) setBuffering(false); });
    });

    // ---------- Бейдж качества (нативное видео) ----------
    const updateNativeQualityBadge = () => {
        if (hls) return;
        const h = video.videoHeight;
        if (!h) return;
        qualityBtn.style.display = 'flex';
        qualityBadge.textContent = `${h}p`;
        qualityBadge.classList.remove('auto');
            };

    // ---------- Метаданные и resume ----------
    listen(video, 'loadedmetadata', () => {
        if (!alive()) return;
        video.playbackRate = clampSpeed(Number(storage.getSetting('playbackRate', 1)));
        timeTotal.textContent = formatTime(video.duration);
        updateTimes();
        addSegmentMarks();
        updateNativeQualityBadge();
        const savedPos = storage.getPlaybackPosition(currentAnime.id, number);
        if (savedPos > 0 && savedPos < (video.duration || Infinity) - 5) {
            pendingResumeTime = savedPos;
            $('resume-time-text').textContent = formatTime(savedPos);
            $('resume-bar').style.display = 'flex';
        }
    });
    listen(video, 'resize', updateNativeQualityBadge);

    // ---------- Ошибка видео ----------
    listen(video, 'error', () => {
        if (!alive()) return;
        showPlayerError(number);
    });
    listen($('error-retry-btn'), 'click', () => playEpisode(number));
    listen($('error-close-btn'), 'click', closePlayerOverlay);

    // ---------- Конец серии ----------
    listen(video, 'ended', () => {
        if (!alive()) return;
        storage.clearPlaybackPosition(currentAnime.id, number);
        ensureWatched(number);
        if (hasNext && storage.getSetting('autoplayNext', true)) {
            playEpisode(episodes[idx + 1].number);
            return;
        }
        activeSegment = null;
        skipSegBtn.style.display = 'none';
        endOverlay.style.display = 'flex';
        wrapper.classList.remove('controls-hidden');
    });
    listen($('end-next-btn'), 'click', playNextEpisode);
    listen($('end-replay-btn'), 'click', () => {
        endOverlay.style.display = 'none';
        video.currentTime = 0;
        video.play().catch(() => {});
    });
    listen($('end-home-btn'), 'click', () => { closePlayerOverlay(); switchTab('catalog'); });

    // ---------- Полный экран и PiP ----------
    const toggleFullscreen = () => setAppFullscreen(!appFullscreen);
    // Запасной путь: если HTML-fullscreen закрыт системой (Esc), синхронизируем состояние
    listen(document, 'fullscreenchange', () => {
        if (!document.fullscreenElement && appFullscreen && !hasElectronFs()) {
            appFullscreen = false;
            wrapper.classList.remove('player-fullscreen');
        }
    });
    listen(fullscreenBtn, 'click', toggleFullscreen);
    listen(pipBtn, 'click', async () => {
        try {
            if (document.pictureInPictureElement) await document.exitPictureInPicture();
            else await video.requestPictureInPicture();
        } catch (e) { dlog('PiP error:', e); }
    });

    // ---------- Навигация по сериям и кнопки перемотки ----------
    const seekBy = (sec) => {
        if (!isFinite(video.duration)) return;
        video.currentTime = Math.max(0, Math.min(video.duration, video.currentTime + sec));
        showOsd(`${sec > 0 ? '+' : '−'}${Math.abs(sec)} сек`);
    };
    listen($('prev-btn'), 'click', playPrevEpisode);
    listen($('next-btn'), 'click', playNextEpisode);
    listen($('rewind-btn'), 'click', () => seekBy(-10));
    listen($('forward-btn'), 'click', () => seekBy(10));
    listen($('skip-btn'), 'click', skipTime);
    listen($('episodes-toggle-btn'), 'click', toggleEpisodesPanel);
    listen($('player-close-btn'), 'click', closePlayerOverlay);

    listen(wrapper, 'click', (e) => { const b = e.target.closest('button'); if (b) b.blur(); });

    // ---------- Меню (скорость, качество) ----------
    const closeMenus = () => { speedMenu.classList.remove('open'); qualityMenu.classList.remove('open'); };
    const openMenu = (menu, btn) => {
        closeMenus();
        if (window.innerWidth > 700) {
            const wr = wrapper.getBoundingClientRect(); const br = btn.getBoundingClientRect();
            const right = (wr.right - br.right) + br.width / 2 - menu.offsetWidth / 2;
            menu.style.right = `${Math.max(8, right)}px`;
        }
        menu.classList.add('open');
        showControls();
    };
    listen(document, 'click', (e) => {
        if (e.target.closest('.quality-menu') || e.target === speedBtn || e.target === qualityBtn || qualityBtn.contains(e.target)) return;
        closeMenus();
    });

    // Скорость: клик по надписи открывает компактное меню выбора
    const applySpeed = (rate, announce) => {
        rate = clampSpeed(rate);
        video.defaultPlaybackRate = rate;
        video.playbackRate = rate;
        storage.setSetting('playbackRate', rate);
        speedBtn.textContent = `${rate}x`;
        speedBtn.classList.toggle('active', rate !== 1);
        buildSpeedMenu();
        if (announce) showOsd(`Скорость ${rate}x`);
    };
    function buildSpeedMenu() {
        const cur = video.playbackRate;
        speedList.innerHTML = PLAYER_SPEEDS.map(r =>
            `<div class="quality-menu-item ${Math.abs(r - cur) < 0.001 ? 'selected' : ''}" data-rate="${r}">${r}x</div>`
        ).join('');
    }
    listen(speedBtn, 'click', (e) => {
        e.stopPropagation();
        if (speedMenu.classList.contains('open')) { closeMenus(); return; }
        buildSpeedMenu();
        openMenu(speedMenu, speedBtn);
    });
    listen(speedList, 'click', (e) => {
        e.stopPropagation();
        const item = e.target.closest('.quality-menu-item');
        if (!item) return;
        applySpeed(parseFloat(item.dataset.rate), true);
        closeMenus();
    });
    applySpeed(Number(storage.getSetting('playbackRate', 1)), false);

    // Качество (HLS)
    const setupHlsQualityControls = () => {
        if (!hls) return;
        const levelLabel = (lvl) => {
            if (lvl.height) return lvl.height >= 2160 ? `${lvl.height}p (4K)` : `${lvl.height}p`;
            if (lvl.bitrate) return `${Math.round(lvl.bitrate / 1000)} kbps`;
            return `Уровень ${lvl.index}`;
        };
        const updateQualityBadge = () => {
            const auto = hls.autoLevelEnabled || hls.manualLevel === -1;
            const cur = hls.currentLevel >= 0 ? hls.levels[hls.currentLevel] : null;
            const manual = !auto ? hls.levels[hls.manualLevel] : null;
            const lvl = manual || cur;
            qualityBadge.textContent = lvl && lvl.height ? `${lvl.height}p` : (auto ? 'A' : '');
            qualityBadge.classList.toggle('auto', auto);
        };
        const buildQualityMenu = () => {
            const levels = (hls.levels || []).map((lvl, i) => ({ ...lvl, index: i })).sort((a, b) => (b.height || 0) - (a.height || 0));
            const seen = new Set();
            const unique = levels.filter(l => { const k = l.height || l.bitrate; if (seen.has(k)) return false; seen.add(k); return true; });
            const auto = hls.autoLevelEnabled || hls.manualLevel === -1;
            qualityList.innerHTML = `<div class="quality-menu-item ${auto ? 'selected' : ''}" data-level="-1">Авто</div>` +
                unique.map(l => `<div class="quality-menu-item ${!auto && hls.manualLevel === l.index ? 'selected' : ''}" data-level="${l.index}">${levelLabel(l)}</div>`).join('');
        };
        listen(qualityBtn, 'click', (e) => {
            e.stopPropagation();
            if (qualityMenu.classList.contains('open')) { closeMenus(); return; }
            buildQualityMenu();
            openMenu(qualityMenu, qualityBtn);
        });
        listen(qualityList, 'click', (e) => {
            e.stopPropagation();
            const item = e.target.closest('.quality-menu-item');
            if (!item) return;
            hls.currentLevel = parseInt(item.dataset.level, 10);
            updateQualityBadge();
            closeMenus();
        });
        const onManifestParsed = () => {
            qualityBtn.style.display = (hls.levels || []).length > 1 ? 'flex' : 'none';
            buildQualityMenu();
            updateQualityBadge();
        };
        const onLevelSwitched = () => {
            updateQualityBadge();
            if (qualityMenu.classList.contains('open')) buildQualityMenu();
        };
        hls.on(Hls.Events.MANIFEST_PARSED, onManifestParsed);
        hls.on(Hls.Events.LEVEL_SWITCHED, onLevelSwitched);
        session.cleanups.push(() => {
            hls.off(Hls.Events.MANIFEST_PARSED, onManifestParsed);
            hls.off(Hls.Events.LEVEL_SWITCHED, onLevelSwitched);
        });
    };
    setupHlsQualityControls();

    // ---------- Субтитры ----------
    const getNativeSubtitleTracks = () => Array.from(video.textTracks || [])
        .filter(track => track.kind === 'captions' || track.kind === 'subtitles');
    const updateSubtitlesButton = () => {
        const nativeTracks = getNativeSubtitleTracks();
        const hasHlsTracks = !!(hls && hls.subtitleTracks && hls.subtitleTracks.length);
        const available = hasHlsTracks || nativeTracks.length > 0;
        subtitlesBtn.style.display = available ? 'flex' : 'none';
        const enabled = hasHlsTracks
            ? hls.subtitleTrack >= 0
            : nativeTracks.some(track => track.mode === 'showing');
        subtitlesBtn.classList.toggle('active', enabled);
        subtitlesBtn.setAttribute('aria-pressed', String(enabled));
    };
    const toggleSubtitles = () => {
        if (hls && hls.subtitleTracks && hls.subtitleTracks.length) {
            hls.subtitleTrack = hls.subtitleTrack < 0 ? 0 : -1;
        } else {
            const tracks = getNativeSubtitleTracks();
            const enable = !tracks.some(track => track.mode === 'showing');
            tracks.forEach(track => { track.mode = enable ? 'showing' : 'disabled'; });
        }
        updateSubtitlesButton();
        showOsd(subtitlesBtn.classList.contains('active') ? 'Субтитры включены' : 'Субтитры выключены');
    };
    listen(subtitlesBtn, 'click', toggleSubtitles);
    listen(video, 'loadedmetadata', updateSubtitlesButton);
    if (video.textTracks && typeof video.textTracks.addEventListener === 'function') {
        listen(video.textTracks, 'addtrack', updateSubtitlesButton);
        listen(video.textTracks, 'removetrack', updateSubtitlesButton);
    }
    const onSubtitleTracksUpdated = updateSubtitlesButton;
    const connectHls = (instance) => {
        hls = instance;
        setupHlsQualityControls();
        if (Hls.Events.SUBTITLE_TRACKS_UPDATED) {
            hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, onSubtitleTracksUpdated);
            session.cleanups.push(() => hls.off(Hls.Events.SUBTITLE_TRACKS_UPDATED, onSubtitleTracksUpdated));
        }
        updateSubtitlesButton();
    };
    session.setHls = connectHls;
    updateSubtitlesButton();

    if (!document.pictureInPictureEnabled || typeof video.requestPictureInPicture !== 'function') {
        pipBtn.style.display = 'none';
    }

    // ---------- Скриншот кадра ----------
    const takeScreenshot = () => {
        if (!video.videoWidth) { showOsd('Кадр ещё не загружен'); return; }
        try {
            const canvas = document.createElement('canvas');
            canvas.width = video.videoWidth; canvas.height = video.videoHeight;
            canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
            canvas.toBlob((blob) => {
                if (!blob) { showOsd('Не удалось сделать скриншот'); return; }
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `yamikoe_${currentAnime.id}_ep${number}_${formatTime(video.currentTime).replace(':', '-')}.png`;
                a.click();
                setTimeout(() => URL.revokeObjectURL(url), 1500);
                showOsd('Скриншот сохранён');
            }, 'image/png');
        } catch (e) {
            showOsd('Не удалось сделать скриншот');
        }
    };

    // ---------- Горячие клавиши ----------
    const onKeyDown = (e) => {
        const tag = document.activeElement ? document.activeElement.tagName : '';
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        const modalOpen = ['custom-confirm', 'custom-alert', 'settings-modal', 'bindings-modal']
            .some(id => { const el = document.getElementById(id); return el && el.style.display !== 'none'; });
        if (modalOpen) return;

        const digit = /^(Digit|Numpad)([0-9])$/.exec(e.code);
        if (digit) {
            e.preventDefault();
            if (isFinite(video.duration)) {
                video.currentTime = video.duration * (parseInt(digit[2], 10) / 10);
                showOsd(`${parseInt(digit[2], 10) * 10}%`);
            }
            showControls();
            return;
        }
        switch (e.code) {
            case 'Space': case 'KeyK': e.preventDefault(); togglePlay(); break;
            case 'KeyF': e.preventDefault(); toggleFullscreen(); break;
            case 'ArrowRight': e.preventDefault(); seekBy(5); showControls(); break;
            case 'ArrowLeft': e.preventDefault(); seekBy(-5); showControls(); break;
            case 'KeyL': e.preventDefault(); seekBy(10); showControls(); break;
            case 'KeyJ': e.preventDefault(); seekBy(-10); showControls(); break;
            case 'ArrowUp': e.preventDefault(); setVolumeValue((video.muted ? 0 : video.volume) + 0.1); showOsd(`Громкость ${Math.round(video.volume * 100)}%`); showControls(); break;
            case 'ArrowDown': e.preventDefault(); setVolumeValue((video.muted ? 0 : video.volume) - 0.1); showOsd(`Громкость ${Math.round(video.volume * 100)}%`); showControls(); break;
            case 'KeyM': e.preventDefault(); muteBtn.click(); break;
            case 'BracketLeft': e.preventDefault(); applySpeed(video.playbackRate - 0.25, true); break;
            case 'BracketRight': e.preventDefault(); applySpeed(video.playbackRate + 0.25, true); break;
            case 'KeyS': e.preventDefault(); takeScreenshot(); break;
            case 'Escape':
                e.preventDefault();
                if (speedMenu.classList.contains('open') || qualityMenu.classList.contains('open')) closeMenus();
                else if ($('episodes-panel').classList.contains('open')) toggleEpisodesPanel();
                else if (appFullscreen) setAppFullscreen(false);
                else closePlayerOverlay();
                break;
        }
    };
    const onKeyUp = (e) => { if (e.code === 'Space') e.preventDefault(); };
    listen(document, 'keydown', onKeyDown);
    listen(document, 'keyup', onKeyUp);
}

function renderEpisodesPanel(activeNumber) {
    const list = document.getElementById('episodes-panel-list');
    if (!list || !currentAnime) return;
    const watched = storage.getWatched(currentAnime.id);
    list.innerHTML = currentAnime.episodes.map(ep => {
        const isWatched = watched.includes(ep.number); const isActive = ep.number === activeNumber;
        return `<div class="panel-ep-item ${isActive ? 'active' : ''} ${isWatched ? 'watched' : ''}" onclick="playEpisode(${ep.number})"><span>Серия ${ep.number}</span>${isWatched ? '<span class="panel-check">✓</span>' : ''}</div>`;
    }).join('');
}

function handleToggleWatched(event, epNum) {
    if (event) event.stopPropagation();
    if (!currentAnime) return;
    const watched = storage.toggleWatched(currentAnime.id, epNum);
    const isWatched = watched.includes(epNum);
    const page = document.getElementById('release-page');
    if (page) {
        const epItem = page.querySelector(`.ep-item[data-ep="${epNum}"]`);
        if (epItem) {
            epItem.classList.toggle('watched', isWatched);
            const icon = epItem.querySelector('.check-icon');
            if (icon) icon.classList.toggle('active', isWatched);
        }
        const episodesCount = currentAnime.episodes && currentAnime.episodes.length > 0 ? currentAnime.episodes.length : 12;
        const percent = Math.round((watched.length / episodesCount) * 100);
        const progressText = page.querySelector('.progress-text');
        const progressFill = page.querySelector('.progress-fill');
        if (progressText) progressText.textContent = `Прогресс просмотра: ${watched.length} из ${episodesCount} (${percent}%)`;
        if (progressFill) progressFill.style.width = `${percent}%`;
    }
    if (currentEpisodeNumber !== null) renderEpisodesPanel(currentEpisodeNumber);
}
