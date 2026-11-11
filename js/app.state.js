// app.js - Полная логика интерфейса (v4.14.0) - Bunny Stream + расширенный плеер
let currentAnime = null;
let currentEpisodeNumber = null;
let deleteMode = false;
let searchTimer = null;
let currentDayIndex = 0;
let allReleasesCache = [];
let filtersInitialized = false;
const APP_VERSION = "4.14.0";
let releasePage_limit = 30;
let releasePage_showing = 30;
let activeSelect = null;
let pendingResumeTime = 0;
let scrollPositions = { catalog: 0, schedule: 0, all: 0, favorites: 0, history: 0 };
