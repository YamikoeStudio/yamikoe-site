// app.js - Полная логика интерфейса - Bunny Stream + расширенный плеер
let currentAnime = null;
let currentEpisodeNumber = null;
let deleteMode = false;
let searchTimer = null;
let currentDayIndex = 0;
let allReleasesCache = [];
let filtersInitialized = false;
let APP_VERSION = '';
let releasePage_limit = 30;
let releasePage_showing = 30;
let activeSelect = null;
let pendingResumeTime = 0;
let scrollPositions = { catalog: 0, schedule: 0, all: 0, favorites: 0, history: 0, profile: 0 };
