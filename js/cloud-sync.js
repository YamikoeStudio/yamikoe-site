(function (window, document) {
    'use strict';

    var activeUserId = null;
    var syncedUserId = null;
    var lastAttemptAt = 0;
    var lastSyncSucceeded = false;
    var syncPromise = Promise.resolve(true);
    var favoriteQueues = Object.create(null);
    var progressQueues = Object.create(null);
    var statusTimer = null;
    var lastErrorText = '';
    var lastErrorAt = 0;

    function currentUserId() {
        var user = window.YamikoeSupabase.getCurrentUser();
        return user ? user.id : null;
    }

    function integerSeconds(value) {
        var seconds = Number(value);
        if (!Number.isFinite(seconds)) return 0;
        return Math.min(2147483647, Math.max(0, Math.round(seconds)));
    }

    function showStatus(message, isError) {
        var status = document.getElementById('cloud-sync-status');
        if (!status) return;
        status.textContent = message;
        status.classList.toggle('is-error', !!isError);
        status.style.display = 'block';
        window.clearTimeout(statusTimer);
        if (!isError) {
            statusTimer = window.setTimeout(function () { status.style.display = 'none'; }, 4500);
        }
    }

    function clearStatus() {
        var status = document.getElementById('cloud-sync-status');
        if (status) status.style.display = 'none';
        window.clearTimeout(statusTimer);
        lastErrorText = '';
        lastErrorAt = 0;
    }

    function reportError(error, action) {
        var now = Date.now();
        var detail = window.YamikoeSupabase.getAuthErrorMessage(error, action);
        var message = 'Облачная синхронизация не выполнена. Данные сохранены на этом устройстве. ' + detail;
        console.error('[CloudSync] ' + action + ': ' + String(error && error.message || error), error);
        if (message !== lastErrorText || now - lastErrorAt > 30000) {
            showStatus(message, true);
            lastErrorText = message;
            lastErrorAt = now;
        }
    }

    function localWatchRows(userId) {
        var historyById = new Map();
        storage.getHistory().forEach(function (item) {
            if (item && item.id !== undefined && item.id !== null) historyById.set(String(item.id), item);
        });

        var positions = storage.cache.playbackPositions || {};
        return Object.keys(positions).reduce(function (rows, animeId) {
            var animePositions = positions[animeId] || {};
            var episodes = Object.keys(animePositions);
            if (!episodes.length) return rows;
            var latestEpisode = episodes.reduce(function (latest, episode) {
                var latestTime = storage.getPlaybackUpdatedAt(animeId, latest);
                var episodeTime = storage.getPlaybackUpdatedAt(animeId, episode);
                if (episodeTime > latestTime) return episode;
                if (episodeTime === latestTime && Number(episode) > Number(latest)) return episode;
                return latest;
            });
            var rawPosition = Number(animePositions[latestEpisode]);
            if (!Number.isFinite(rawPosition) || rawPosition <= 3) return rows;
            var historyItem = historyById.get(String(animeId)) || {};
            var localUpdatedAt = storage.getPlaybackUpdatedAt(animeId, latestEpisode) ||
                Number(historyItem.timestamp) || Date.now();
            rows.push({
                user_id: userId,
                anime_id: String(animeId),
                anime_title: String(historyItem.title || ''),
                poster_url: String(historyItem.image || historyItem.poster_url || ''),
                episode: Number(latestEpisode),
                position_seconds: integerSeconds(rawPosition),
                duration_seconds: integerSeconds(storage.getPlaybackDuration(animeId, latestEpisode)),
                updated_at: new Date(localUpdatedAt).toISOString()
            });
            return rows;
        }, []);
    }

    async function fetchCloudData(userId) {
        var db = window.YamikoeSupabase.getClient();
        var results = await Promise.all([
            db.from('favorites')
                .select('user_id, anime_id, anime_title, poster_url')
                .eq('user_id', userId),
            db.from('watch_history')
                .select('user_id, anime_id, anime_title, poster_url, episode, position_seconds, duration_seconds, updated_at')
                .eq('user_id', userId)
        ]);
        if (results[0].error) throw results[0].error;
        if (results[1].error) throw results[1].error;
        return { favorites: results[0].data || [], history: results[1].data || [] };
    }

    function mergeCloudHistory(cloudRows) {
        var history = new Map();
        storage.getHistory().forEach(function (item) {
            if (item && item.id !== undefined && item.id !== null) history.set(String(item.id), item);
        });
        cloudRows.forEach(function (item) {
            var id = String(item.anime_id);
            var existing = history.get(id);
            var cloudTimestamp = Date.parse(item.updated_at) || 0;
            if (!existing) {
                history.set(id, {
                    id: id,
                    title: item.anime_title || '',
                    image: item.poster_url || '',
                    timestamp: cloudTimestamp
                });
            } else {
                history.set(id, Object.assign({}, existing, {
                    timestamp: Math.max(Number(existing.timestamp) || 0, cloudTimestamp),
                    title: existing.title || item.anime_title || '',
                    image: existing.image || item.poster_url || ''
                }));
            }
            storage.replaceCloudPlaybackProgress(
                id,
                item.episode,
                item.position_seconds,
                item.duration_seconds,
                item.updated_at
            );
        });
        storage.replaceHistory(Array.from(history.values())
            .sort(function (a, b) { return (Number(b.timestamp) || 0) - (Number(a.timestamp) || 0); })
            .slice(0, 50));
    }

    function applyCloudData(localFavs, cloudData) {
        var favorites = new Map();
        localFavs.forEach(function (item) { favorites.set(String(item.id), item); });
        cloudData.favorites.forEach(function (item) {
            var id = String(item.anime_id);
            if (!favorites.has(id)) {
                favorites.set(id, {
                    id: id,
                    title: item.anime_title || '',
                    image: item.poster_url || '',
                    added: 0
                });
            }
        });
        storage.replaceFavorites(Array.from(favorites.values()));
        mergeCloudHistory(cloudData.history);
    }

    async function syncAccountData(userId) {
        var localFavs = storage.getFavorites().slice();
        var localWatch = localWatchRows(userId);
        var initialCloud = await fetchCloudData(userId);
        if (activeUserId !== userId) return;
        var favoriteRows = localFavs
            .filter(function (item) { return item && item.id !== undefined && item.id !== null; })
            .map(function (item) {
                return {
                    user_id: userId,
                    anime_id: String(item.id),
                    anime_title: String(item.title || ''),
                    poster_url: String(item.image || item.poster_url || '')
                };
            });
        if (favoriteRows.length) {
            var favoriteResult = await window.YamikoeSupabase.getClient()
                .from('favorites')
                .upsert(favoriteRows, { onConflict: 'user_id,anime_id' });
            if (favoriteResult.error) throw favoriteResult.error;
        }

        var cloudHistoryById = new Map();
        initialCloud.history.forEach(function (item) { cloudHistoryById.set(String(item.anime_id), item); });
        var watchRowsToUpload = localWatch.filter(function (item) {
            var cloud = cloudHistoryById.get(String(item.anime_id));
            if (!cloud) return true;
            return (Date.parse(item.updated_at) || 0) >= (Date.parse(cloud.updated_at) || 0);
        });
        if (watchRowsToUpload.length) {
            var historyResult = await window.YamikoeSupabase.getClient()
                .from('watch_history')
                .upsert(watchRowsToUpload, { onConflict: 'user_id,anime_id' });
            if (historyResult.error) throw historyResult.error;
        }

        var updatedCloud = await fetchCloudData(userId);
        if (activeUserId !== userId) return;
        applyCloudData(localFavs, updatedCloud);
        lastSyncSucceeded = true;
        syncedUserId = userId;
        clearStatus();
        if (document.body.classList.contains('loaded')) {
            if (document.getElementById('tab-favorites').style.display !== 'none') renderFavorites();
            if (document.getElementById('tab-history').style.display !== 'none') renderHistory();
            renderContinueWatching();
        }
    }

    function startAccountSync(userId) {
        activeUserId = userId;
        syncedUserId = null;
        lastSyncSucceeded = false;
        lastAttemptAt = Date.now();
        syncPromise = syncAccountData(userId).catch(function (error) {
            reportError(error, 'синхронизировать данные');
            return false;
        });
        return syncPromise;
    }

    function ensureSynced() {
        var userId = currentUserId();
        if (!userId) return Promise.resolve(false);
        if (userId === syncedUserId && lastSyncSucceeded) return syncPromise;
        if (userId === activeUserId && Date.now() - lastAttemptAt < 15000) return syncPromise;
        return startAccountSync(userId);
    }

    async function refreshCloudProgress() {
        var userId = currentUserId();
        if (!userId) return false;
        await ensureSynced();
        if (currentUserId() !== userId) return false;
        try {
            var db = window.YamikoeSupabase.getClient();
            var result = await db.from('watch_history')
                .select('user_id, anime_id, anime_title, poster_url, episode, position_seconds, duration_seconds, updated_at')
                .eq('user_id', userId);
            if (result.error) throw result.error;
            if (currentUserId() !== userId) return false;

            var cloudById = new Map();
            (result.data || []).forEach(function (row) { cloudById.set(String(row.anime_id), row); });
            var localRows = localWatchRows(userId);
            var newerLocalRows = localRows.filter(function (row) {
                var cloud = cloudById.get(String(row.anime_id));
                return !cloud || (Date.parse(row.updated_at) || 0) > (Date.parse(cloud.updated_at) || 0);
            });
            if (newerLocalRows.length) {
                var uploadResult = await db.from('watch_history')
                    .upsert(newerLocalRows, { onConflict: 'user_id,anime_id' });
                if (uploadResult.error) throw uploadResult.error;
                var refreshed = await db.from('watch_history')
                    .select('user_id, anime_id, anime_title, poster_url, episode, position_seconds, duration_seconds, updated_at')
                    .eq('user_id', userId);
                if (refreshed.error) throw refreshed.error;
                mergeCloudHistory(refreshed.data || []);
            } else {
                mergeCloudHistory(result.data || []);
            }
            clearStatus();
            return true;
        } catch (error) {
            reportError(error, 'обновить прогресс просмотра');
            return false;
        }
    }

    function queueById(queues, id, operation) {
        var key = String(id);
        var previous = queues[key] || Promise.resolve();
        var current = previous.catch(function () {}).then(operation);
        var wrapped = current.finally(function () {
            if (queues[key] === wrapped) delete queues[key];
        });
        queues[key] = wrapped;
        return wrapped;
    }

    function updateFavorite(anime, isFavorite) {
        var requestedUserId = currentUserId();
        if (!requestedUserId) return Promise.resolve();
        return queueById(favoriteQueues, anime.id, async function () {
            await ensureSynced();
            var userId = currentUserId();
            if (userId !== requestedUserId) return;
            var query = window.YamikoeSupabase.getClient().from('favorites');
            var result = isFavorite
                ? await query.upsert({
                    user_id: userId,
                    anime_id: String(anime.id),
                    anime_title: String(anime.title || ''),
                    poster_url: String(anime.image || '')
                }, { onConflict: 'user_id,anime_id' })
                : await query.delete().eq('user_id', userId).eq('anime_id', String(anime.id));
            if (result.error) throw result.error;
            clearStatus();
        }).catch(function (error) {
            reportError(error, isFavorite ? 'добавить избранное' : 'удалить избранное');
        });
    }

    function savePlaybackProgress(progress) {
        if (!progress || !currentUserId()) return Promise.resolve();
        var userId = currentUserId();
        return queueById(progressQueues, progress.anime_id, async function () {
            await ensureSynced();
            if (currentUserId() !== userId) return;
            var result = await window.YamikoeSupabase.getClient().from('watch_history').upsert({
                user_id: userId,
                anime_id: String(progress.anime_id),
                anime_title: String(progress.anime_title || ''),
                poster_url: String(progress.poster_url || ''),
                episode: Number(progress.episode),
                position_seconds: integerSeconds(progress.position_seconds),
                duration_seconds: integerSeconds(progress.duration_seconds),
                updated_at: new Date().toISOString()
            }, { onConflict: 'user_id,anime_id' });
            if (result.error) throw result.error;
            clearStatus();
        }).catch(function (error) {
            reportError(error, 'сохранить прогресс просмотра');
        });
    }

    function clearProgress(animeId) {
        if (!currentUserId()) return Promise.resolve();
        var userId = currentUserId();
        return queueById(progressQueues, animeId, async function () {
            await ensureSynced();
            if (currentUserId() !== userId) return;
            var result = await window.YamikoeSupabase.getClient().from('watch_history')
                .delete()
                .eq('user_id', userId)
                .eq('anime_id', String(animeId));
            if (result.error) throw result.error;
            clearStatus();
        }).catch(function (error) {
            reportError(error, 'очистить прогресс просмотра');
        });
    }

    function clearHistory(animeId) {
        if (!currentUserId()) return Promise.resolve();
        var userId = currentUserId();
        return (async function () {
            await ensureSynced();
            var pendingProgress = animeId === undefined || animeId === null
                ? Object.keys(progressQueues).map(function (id) { return progressQueues[id]; })
                : [progressQueues[String(animeId)]].filter(Boolean);
            await Promise.all(pendingProgress.map(function (promise) { return promise.catch(function () {}); }));
            if (currentUserId() !== userId) return;
            var query = window.YamikoeSupabase.getClient().from('watch_history').delete().eq('user_id', userId);
            if (animeId !== undefined && animeId !== null) query = query.eq('anime_id', String(animeId));
            var result = await query;
            if (result.error) throw result.error;
            clearStatus();
        })().catch(function (error) {
            reportError(error, 'удалить историю просмотра');
        });
    }

    window.addEventListener('yamikoe-auth-state', function (event) {
        var userId = event.detail && event.detail.user ? event.detail.user.id : null;
        if (userId !== activeUserId) {
            if (userId) startAccountSync(userId);
            else {
                activeUserId = null;
                syncedUserId = null;
                lastSyncSucceeded = false;
                syncPromise = Promise.resolve(true);
            }
        }
    });

    window.YamikoeCloudSync = {
        ensureSynced: ensureSynced,
        refreshCloudProgress: refreshCloudProgress,
        waitForSync: function () { return syncPromise; },
        updateFavorite: updateFavorite,
        savePlaybackProgress: savePlaybackProgress,
        clearProgress: clearProgress,
        clearHistory: clearHistory
    };
})(window, document);
