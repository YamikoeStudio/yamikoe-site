// storage.js - Надежное хранилище (схема v3)
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
                else this.cache = parsed.data;
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
            settings: {
                autoplayNext: true,
                skipOpening: 90,
                skipEnding: 90
            }
        };
    }

    migrate(oldData) {
        console.log('[Storage] Миграция данных...');
        this.cache = this.getDefaultData();
        if (oldData.data) {
            if (Array.isArray(oldData.data.favorites)) this.cache.favorites = oldData.data.favorites;
            if (Array.isArray(oldData.data.history)) this.cache.history = oldData.data.history;
            if (typeof oldData.data.watched === 'object') this.cache.watched = oldData.data.watched;
            if (typeof oldData.data.playbackPositions === 'object') this.cache.playbackPositions = oldData.data.playbackPositions;
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

    setPlaybackPosition(animeId, epNum, seconds) {
        if (!this.cache.playbackPositions) this.cache.playbackPositions = {};
        const aId = String(animeId);
        if (!this.cache.playbackPositions[aId]) this.cache.playbackPositions[aId] = {};
        if (seconds && seconds > 3) {
            this.cache.playbackPositions[aId][String(epNum)] = seconds;
        } else {
            delete this.cache.playbackPositions[aId][String(epNum)];
        }
        this.save();
    }

    clearPlaybackPosition(animeId, epNum) {
        if (!this.cache.playbackPositions) return;
        const aId = String(animeId);
        if (this.cache.playbackPositions[aId]) {
            delete this.cache.playbackPositions[aId][String(epNum)];
            this.save();
        }
    }

    exportData() { return JSON.stringify(this.cache, null, 2); }

    importData(jsonString) {
        try {
            const parsed = JSON.parse(jsonString);
            if (parsed && Array.isArray(parsed.favorites) && Array.isArray(parsed.history)) {
                this.cache = parsed;
                if (!this.cache.playbackPositions) this.cache.playbackPositions = {};
                if (!this.cache.settings) this.cache.settings = { autoplayNext: true, skipOpening: 90, skipEnding: 90 };
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