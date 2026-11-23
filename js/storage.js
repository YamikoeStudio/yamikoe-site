// storage.js - Надежное хранилище (схема v3)
// Флаг отладки: в релизе false, логи выключены
const DEBUG = false;
function dlog(...args) { if (DEBUG) console.log(...args); }

const STORAGE_KEY = 'ymk_store_v3';
const SCHEMA_VERSION = 3;

class StorageManager {
    constructor() {
        this.cache = null;
        this._listenerAttached = false;
        this.init();
    }

    init() {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) {
            this.cache = this.getDefaultData();
            this.save();
        } else {
            try {
                const parsed = JSON.parse(raw);
                if (parsed.schemaVersion !== SCHEMA_VERSION) this.migrate(parsed);
                else {
                    this.cache = parsed.data;
                    if (!this.cache.playbackUpdatedAt) {
                        this.cache.playbackUpdatedAt = {};
                        this.save();
                    }
                }
            } catch (e) {
                console.warn('[Storage] Битый JSON. Сброс к заводским настройкам.', e);
                this.cache = this.getDefaultData();
                this.save();
            }
        }

        if (!this._listenerAttached) {
            this._listenerAttached = true;
            window.addEventListener('storage', (e) => {
                if (e.key === STORAGE_KEY) this.init();
            });
        }
    }

    getDefaultData() {
        return {
            favorites: [],
            history: [],
            watched: {},
            searchHistory: [],
            playbackPositions: {}, // { "animeId": { "1": 123.4, "2": 55.0 } }
            playbackDurations: {}, // { "animeId": { "1": 1440.0 } } — для расчёта процента в «Продолжить просмотр»
            playbackUpdatedAt: {},
            settings: {
                autoplayNext: true,
                skipOpening: 90,
                skipEnding: 90,
                skipTime: 90,
                playbackRate: 1,
                volume: 1,
                muted: false
            }
        };
    }

    migrate(oldData) {
        dlog('[Storage] Миграция данных...');
        this.cache = this.getDefaultData();
        if (oldData.data) {
            if (Array.isArray(oldData.data.favorites)) this.cache.favorites = oldData.data.favorites;
            if (Array.isArray(oldData.data.history)) this.cache.history = oldData.data.history;
            if (typeof oldData.data.watched === 'object') this.cache.watched = oldData.data.watched;
            if (typeof oldData.data.playbackPositions === 'object') this.cache.playbackPositions = oldData.data.playbackPositions;
            if (oldData.data.playbackDurations && typeof oldData.data.playbackDurations === 'object') this.cache.playbackDurations = oldData.data.playbackDurations;
            if (oldData.data.playbackUpdatedAt && typeof oldData.data.playbackUpdatedAt === 'object') this.cache.playbackUpdatedAt = oldData.data.playbackUpdatedAt;
            if (oldData.data.settings && typeof oldData.data.settings === 'object') {
                this.cache.settings = { ...this.cache.settings, ...oldData.data.settings };
            }
        }
        this.save();
    }

    save() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify({
                schemaVersion: SCHEMA_VERSION,
                updatedAt: Date.now(),
                data: this.cache
            }));
        } catch (e) {
            console.error('[Storage] Ошибка сохранения:', e);
        }
    }

    getFavorites() { return this.cache.favorites || []; }
    replaceFavorites(favorites) { this.cache.favorites = favorites; this.save(); }
    isFavorite(id) { return this.getFavorites().some(f => String(f.id) === String(id)); }
    toggleFavorite(anime) {
        const idx = this.cache.favorites.findIndex(f => String(f.id) === String(anime.id));
        if (idx >= 0) {
            this.cache.favorites.splice(idx, 1);
            this.save();
            return false;
        }
        this.cache.favorites.unshift({ ...anime, added: Date.now() });
        this.save();
        return true;
    }

    getHistory() { return this.cache.history || []; }
    replaceHistory(history) { this.cache.history = history; this.save(); }
    addToHistory(anime) {
        this.cache.history = this.cache.history.filter(h => String(h.id) !== String(anime.id));
        this.cache.history.unshift({ ...anime, timestamp: Date.now() });
        if (this.cache.history.length > 50) this.cache.history.pop();
        this.save();
    }
    clearHistory() { this.cache.history = []; this.save(); }
    removeFromHistory(id) {
        this.cache.history = this.cache.history.filter(h => String(h.id) !== String(id));
        this.save();
    }

    getWatched(id) { return this.cache.watched[String(id)] || []; }
    toggleWatched(animeId, epNum) {
        const id = String(animeId);
        if (!this.cache.watched[id]) this.cache.watched[id] = [];
        const arr = this.cache.watched[id];
        const idx = arr.indexOf(epNum);
        if (idx >= 0) arr.splice(idx, 1);
        else arr.push(epNum);
        this.save();
        return arr;
    }
    resetAllWatched() { this.cache.watched = {}; this.save(); }

    getSearchHistory() { return this.cache.searchHistory || []; }
    addSearchQuery(q) {
        if (!q || q.trim().length < 2) return;
        q = q.trim();
        this.cache.searchHistory = this.cache.searchHistory.filter(x => x.toLowerCase() !== q.toLowerCase());
        this.cache.searchHistory.unshift(q);
        if (this.cache.searchHistory.length > 8) this.cache.searchHistory.pop();
        this.save();
    }
    clearSearchHistory() { this.cache.searchHistory = []; this.save(); }

    // ================== НАСТРОЙКИ ==================
    getSetting(key, defaultValue) {
        if (!this.cache.settings) this.cache.settings = {};
        return this.cache.settings[key] !== undefined ? this.cache.settings[key] : defaultValue;
    }

    setSetting(key, value) {
        if (!this.cache.settings) this.cache.settings = {};
        this.cache.settings[key] = value;
        this.save();
    }

    // ================== ПОЗИЦИИ ПРОСМОТРА ==================
    getPlaybackPosition(animeId, epNum) {
        if (!this.cache.playbackPositions) this.cache.playbackPositions = {};
        const anime = this.cache.playbackPositions[String(animeId)];
        if (!anime) return 0;
        const pos = anime[String(epNum)];
        return typeof pos === 'number' && pos > 3 ? pos : 0; // если меньше 3 сек — считаем, что начало
    }

    getPlaybackDuration(animeId, epNum) {
        const d = this.cache.playbackDurations && this.cache.playbackDurations[String(animeId)];
        const v = d ? d[String(epNum)] : 0;
        return typeof v === 'number' && v > 0 ? v : 0;
    }

    setPlaybackPosition(animeId, epNum, seconds, duration) {
        if (!this.cache.playbackPositions) this.cache.playbackPositions = {};
        if (!this.cache.playbackDurations) this.cache.playbackDurations = {};
        if (!this.cache.playbackUpdatedAt) this.cache.playbackUpdatedAt = {};
        const aId = String(animeId);
        if (!this.cache.playbackPositions[aId]) this.cache.playbackPositions[aId] = {};
        if (!this.cache.playbackUpdatedAt[aId]) this.cache.playbackUpdatedAt[aId] = {};
        if (seconds && seconds > 3) {
            this.cache.playbackPositions[aId][String(epNum)] = seconds;
            this.cache.playbackUpdatedAt[aId][String(epNum)] = Date.now();
            if (duration && isFinite(duration) && duration > 0) {
                if (!this.cache.playbackDurations[aId]) this.cache.playbackDurations[aId] = {};
                this.cache.playbackDurations[aId][String(epNum)] = duration;
            }
        } else {
            delete this.cache.playbackPositions[aId][String(epNum)];
            delete this.cache.playbackUpdatedAt[aId][String(epNum)];
            if (this.cache.playbackDurations[aId]) delete this.cache.playbackDurations[aId][String(epNum)];
        }
        this.save();
    }

    clearPlaybackPosition(animeId, epNum) {
        const aId = String(animeId);
        if (this.cache.playbackPositions[aId]) {
            delete this.cache.playbackPositions[aId][String(epNum)];
        }
        if (this.cache.playbackUpdatedAt && this.cache.playbackUpdatedAt[aId]) {
            delete this.cache.playbackUpdatedAt[aId][String(epNum)];
        }
        if (this.cache.playbackDurations && this.cache.playbackDurations[aId]) {
            delete this.cache.playbackDurations[aId][String(epNum)];
        }
        this.save();
    }

    clearAllPlaybackPositions(animeId) {
        if (animeId === undefined || animeId === null) {
            this.cache.playbackPositions = {};
            this.cache.playbackDurations = {};
            this.cache.playbackUpdatedAt = {};
        } else {
            const key = String(animeId);
            if (this.cache.playbackPositions) delete this.cache.playbackPositions[key];
            if (this.cache.playbackDurations) delete this.cache.playbackDurations[key];
            if (this.cache.playbackUpdatedAt) delete this.cache.playbackUpdatedAt[key];
        }
        this.save();
    }

    getPlaybackUpdatedAt(animeId, epNum) {
        const timestamps = this.cache.playbackUpdatedAt && this.cache.playbackUpdatedAt[String(animeId)];
        return timestamps ? Number(timestamps[String(epNum)]) || 0 : 0;
    }

    replaceCloudPlaybackProgress(animeId, epNum, seconds, duration, updatedAt) {
        const animeKey = String(animeId);
        const episodeKey = String(epNum);
        if (!this.cache.playbackPositions) this.cache.playbackPositions = {};
        if (!this.cache.playbackDurations) this.cache.playbackDurations = {};
        if (!this.cache.playbackUpdatedAt) this.cache.playbackUpdatedAt = {};
        this.cache.playbackPositions[animeKey] = {};
        this.cache.playbackDurations[animeKey] = {};
        this.cache.playbackUpdatedAt[animeKey] = {};
        if (Number(seconds) > 3) {
            this.cache.playbackPositions[animeKey][episodeKey] = Number(seconds);
            this.cache.playbackUpdatedAt[animeKey][episodeKey] = Date.parse(updatedAt) || Date.now();
            if (Number(duration) > 0) this.cache.playbackDurations[animeKey][episodeKey] = Number(duration);
        }
        this.save();
    }

    exportData() { return JSON.stringify(this.cache, null, 2); }

    importData(jsonString) {
        try {
            const parsed = JSON.parse(jsonString);
            if (parsed && Array.isArray(parsed.favorites) && Array.isArray(parsed.history)) {
                this.cache = parsed;
                if (!this.cache.playbackPositions) this.cache.playbackPositions = {};
                if (!this.cache.playbackDurations) this.cache.playbackDurations = {};
                if (!this.cache.playbackUpdatedAt) this.cache.playbackUpdatedAt = {};
                if (!this.cache.searchHistory) this.cache.searchHistory = [];
                if (!this.cache.watched) this.cache.watched = {};
                if (!this.cache.settings) this.cache.settings = { autoplayNext: true, skipOpening: 90, skipEnding: 90, skipTime: 90, playbackRate: 1, volume: 1, muted: false };
                this.save();
                return true;
            }
            return false;
        } catch (e) {
            return false;
        }
    }
}

const storage = new StorageManager();