// api.js
const API = {
    SCHEDULE_GIST_ID: "76f2084a69fabcefc69c20a6d5cb48a1",
   ANIME_GIST_ID: "45939046dffb33d6f67e9eb47fed2d5a", 
    SHIKIMORI_BASE: "https://shikimori.io",

    animeCache: new Map(),
    animeRequests: new Map(),
    scheduleData: [],
    videoData: [],
    cacheSaveTimer: null,

    loadCache() {
        try {
            const raw = localStorage.getItem('ymk_anime_cache_v1');
            if (raw) {
                const data = JSON.parse(raw);
                for (const [key, val] of Object.entries(data)) {
                    this.animeCache.set(key, val);
                }
            }
        } catch (e) { dlog('[API] Cache load error:', e); }
    },

    saveCache() {
        clearTimeout(this.cacheSaveTimer);
        this.cacheSaveTimer = setTimeout(() => this.flushCache(), 250);
    },

    flushCache() {
        clearTimeout(this.cacheSaveTimer);
        this.cacheSaveTimer = null;
        try {
            const obj = {};
            for (const [key, val] of this.animeCache.entries()) {
                obj[key] = val;
            }
            localStorage.setItem('ymk_anime_cache_v1', JSON.stringify(obj));
        } catch (e) { dlog('[API] Cache save error:', e); }
    },

    async init() {
        this.loadCache();
        dlog("[API] Загрузка данных через GitHub API...");
        try {
            const [schRes, vidRes] = await Promise.all([
                fetch(`https://api.github.com/gists/${this.SCHEDULE_GIST_ID}`),
                fetch(`https://api.github.com/gists/${this.ANIME_GIST_ID}`)
            ]);

            if (!schRes.ok) dlog(`[API] schedule gist: HTTP ${schRes.status}`);
            if (!vidRes.ok) dlog(`[API] anime gist: HTTP ${vidRes.status}`);

            if (schRes.ok) {
                const schData = await schRes.json();
                const content = schData.files?.['schedule.json']?.content;
                if (content) {
                    try { this.scheduleData = JSON.parse(content); }
                    catch (e) { console.error("[API] schedule.json — битый JSON", e); }
                }
            }

            if (vidRes.ok) {
                const vidData = await vidRes.json();
                const content = vidData.files?.['Config.json']?.content;
                if (content) {
                    try {
                        const rawVid = JSON.parse(content);
                        if (rawVid && rawVid.anime) {
                            this.videoData = [];
                            Object.keys(rawVid.anime).forEach(id => {
                                const anime = rawVid.anime[id];
                                anime.shikimoriId = String(id);
                                if (!anime.voice_team) anime.voice_team = [];
                                this.videoData.push(anime);
                            });
                        }
                    } catch (e) { console.error("[API] Config.json — битый JSON", e); }
                }
            }

            dlog(`[API] Данные загружены: ${this.scheduleData.length} дней, ${this.videoData.length} релизов`);
        } catch (e) {
            console.error("[API] Ошибка загрузки:", e);
        }
    },

    async fetchWithTimeout(resource, options = {}) {
        const { timeout = 3000 } = options;
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), timeout);
        try {
            return await fetch(resource, { ...options, signal: controller.signal });
        } finally {
            clearTimeout(id);
        }
    },

    async getAnimeMetas(ids, concurrency = 4) {
        const results = new Array(ids.length);
        let nextIndex = 0;
        const workerCount = Math.min(Math.max(1, concurrency), ids.length);
        await Promise.all(Array.from({ length: workerCount }, async () => {
            while (nextIndex < ids.length) {
                const index = nextIndex++;
                results[index] = await this.getAnimeMeta(ids[index]);
            }
        }));
        return results;
    },

    async getAnimeMeta(id) {
        if (!id || id === 'null') return null;
        const key = String(id);
        
        if (this.animeCache.has(key)) return this.animeCache.get(key);
        if (this.animeRequests.has(key)) return this.animeRequests.get(key);

        const request = this.fetchAnimeMeta(key);
        this.animeRequests.set(key, request);
        try {
            return await request;
        } finally {
            if (this.animeRequests.get(key) === request) this.animeRequests.delete(key);
        }
    },

    async fetchAnimeMeta(key) {
        const localData = this.findVideoAnime(key);

        try {
            const res = await this.fetchWithTimeout(`${this.SHIKIMORI_BASE}/api/animes/${key}`, { timeout: 3000 });
            if (res.ok) {
                const data = await res.json();
                if (localData) {
                    if (localData.poster) data.image = { original: localData.poster };
                    if (localData.episodes && localData.episodes.length > 0) {
                        data.episodes = localData.episodes.length;
                    }
                }
                // НОВОЕ: Убеждаемся, что темы и рейтинг сохраняются
                if (!data.genres) data.genres = [];
                this.animeCache.set(key, data);
                this.saveCache();
                return data;
            }
        } catch (e) {
            dlog(`Shikimori.io не ответил за 3 сек для ${key}. Берем из конфига.`);
        }

        if (localData) {
            const loadedEps = localData.episodes ? localData.episodes.length : 0;
            const totalEps = Number(localData.total_episodes) || loadedEps || 12;

            let derivedStatus;
            if (localData.status) derivedStatus = localData.status;
            else if (loadedEps > 0 && loadedEps < totalEps) derivedStatus = 'ongoing';
            else derivedStatus = 'released';

            const stub = {
                id: key,
                name: localData.title || 'Без названия',
                russian: localData.title || 'Без названия',
                image: { original: localData.poster || '' },
                episodes: totalEps,
                status: derivedStatus,
                score: localData.score || null,
                genres: localData.genres || [],
                aired_on: localData.year ? `${localData.year}-01-01` : (localData.aired_on || null),
                description: localData.description || ''
            };
            this.animeCache.set(key, stub);
            this.saveCache();
            return stub;
        }

        return null;
    },

    findVideoAnime(id) {
        const target = String(id);
        return this.videoData.find(a => String(a.shikimoriId) === target || String(a.id) === target);
    },

    getAllUniqueIds() {
        const ids = new Set();
        if (Array.isArray(this.scheduleData)) {
            this.scheduleData.forEach(day => (day.items || []).forEach(it => {
                const id = it.shikimoriId || it["shikimoriId"];
                if (id) ids.add(String(id));
            }));
        }
        this.videoData.forEach(a => ids.add(String(a.shikimoriId)));
        return [...ids];
    }
};

window.addEventListener('pagehide', () => API.flushCache(), { once: true });