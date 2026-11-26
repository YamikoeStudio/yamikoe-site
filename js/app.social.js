(function (window, document) {
    'use strict';

    var client;
    var currentUser;
    var requestedFriendsAfterAuth = false;
    var overview = [];
    var activeFriend = null;
    var pendingShare = null;
    var heartbeatTimer = null;
    var overviewTimer = null;
    var messageTimer = null;
    var loadingMessages = false;
    var lastMessageId = null;

    function element(id) {
        return document.getElementById(id);
    }

    function setMessage(id, text, isError) {
        var target = element(id);
        if (!target) return;
        target.textContent = text || '';
        target.classList.toggle('is-error', !!text && !!isError);
        target.classList.toggle('is-success', !!text && !isError);
    }

    function isFriendsSectionVisible() {
        return element('tab-profile').style.display !== 'none'
            && element('profile-section-friends').style.display !== 'none';
    }

    function selectProfileSection(section) {
        if (section !== 'overview' && section !== 'friends') return;
        var target = element('profile-section-' + section);
        if (!target) return;

        ['overview', 'friends'].forEach(function (name) {
            var isActive = name === section;
            element('profile-section-' + name).style.display = isActive ? 'block' : 'none';
            var button = document.querySelector('[data-profile-section="' + name + '"]');
            if (!button) return;
            button.classList.toggle('active', isActive);
            if (isActive) button.setAttribute('aria-current', 'page');
            else button.removeAttribute('aria-current');
        });
        window.dispatchEvent(new CustomEvent('yamikoe-profile-section', { detail: { section: section } }));
    }

    function openProfileSection(section) {
        currentUser = window.YamikoeSupabase.getCurrentUser();
        if (!currentUser) {
            requestedFriendsAfterAuth = section === 'friends';
            window.openAuthModal('login');
            return;
        }
        window.switchTab('profile');
        selectProfileSection(section);
    }

    function supabase() {
        if (!window.YamikoeSupabase) throw new Error('Сервис аккаунтов ещё не загружен.');
        return window.YamikoeSupabase.getClient();
    }

    function reportError(error, action) {
        console.error('[Social] Не удалось ' + action + ': ' + String(error && error.message || error), error);
        setMessage('social-error', (error && error.message) || 'Не удалось ' + action + '. Проверьте SQL-схему Supabase и подключение.', true);
    }

    function presenceLabel(isOnline) {
        return isOnline ? 'В сети' : 'Не в сети';
    }

    function makeAvatar(profile, className) {
        var avatar = document.createElement('span');
        avatar.className = className || 'social-avatar';
        var url = profile && /^https?:\/\//i.test(profile.avatar_url || '') ? profile.avatar_url : '';
        if (url) {
            var image = document.createElement('img');
            image.src = url;
            image.alt = '';
            image.referrerPolicy = 'no-referrer';
            avatar.appendChild(image);
        } else {
            avatar.textContent = String(profile && profile.username || '?').trim().charAt(0).toUpperCase();
        }
        return avatar;
    }

    function findRelation(userId) {
        return overview.find(function (item) { return item.user_id === userId; }) || null;
    }

    function makeButton(text, action, id, className) {
        var button = document.createElement('button');
        button.type = 'button';
        button.className = className || 'profile-action-btn profile-secondary-btn';
        button.textContent = text;
        button.dataset.socialAction = action;
        if (id) button.dataset.id = id;
        return button;
    }

    function makeUserRow(profile, relation, actions) {
        var row = document.createElement('div');
        row.className = 'social-user-row';
        row.dataset.userId = profile.id || profile.user_id || '';
        row.appendChild(makeAvatar(profile));

        var info = document.createElement('div');
        info.className = 'social-user-info';
        var name = document.createElement('strong');
        name.textContent = profile.username || 'Пользователь';
        var status = document.createElement('span');
        status.className = 'social-presence' + (profile.is_online ? ' is-online' : '');
        status.textContent = presenceLabel(profile.is_online);
        info.append(name, status);
        row.appendChild(info);

        actions.forEach(function (action) {
            var profileId = profile.id || profile.user_id;
            var targetId = action.name === 'accept-request' || action.name === 'reject-request'
                ? relation && relation.friendship_id
                : profileId;
            row.appendChild(makeButton(action.text, action.name, targetId, action.className));
        });
        return row;
    }

    function renderSearchResults(users) {
        var container = element('social-search-results');
        container.replaceChildren();
        if (!users.length) {
            var empty = document.createElement('p');
            empty.className = 'social-empty';
            empty.textContent = 'Пользователи не найдены.';
            container.appendChild(empty);
            return;
        }
        users.forEach(function (user) {
            var relation = findRelation(user.id);
            var actions;
            if (relation && relation.status === 'accepted') {
                actions = [{ text: 'Открыть чат', name: 'open-chat' }];
            } else if (relation && relation.status === 'pending' && relation.is_requester) {
                actions = [{ text: 'Заявка отправлена', name: 'noop' }];
            } else if (relation && relation.status === 'pending') {
                actions = [{ text: 'Принять', name: 'accept-request' }, { text: 'Отклонить', name: 'reject-request' }];
            } else {
                actions = [{ text: 'Добавить', name: 'send-request' }];
            }
            container.appendChild(makeUserRow(user, relation, actions));
        });
    }

    function renderOverview() {
        var requests = element('social-requests');
        var friends = element('social-friends');
        requests.replaceChildren();
        friends.replaceChildren();

        var incoming = overview.filter(function (item) { return item.status === 'pending' && !item.is_requester; });
        var outgoing = overview.filter(function (item) { return item.status === 'pending' && item.is_requester; });
        if (!incoming.length && !outgoing.length) {
            var noRequests = document.createElement('p');
            noRequests.className = 'social-empty';
            noRequests.textContent = 'Нет заявок.';
            requests.appendChild(noRequests);
        }
        incoming.concat(outgoing).forEach(function (item) {
            var actions = item.is_requester
                ? [{ text: 'Отменить', name: 'reject-request' }]
                : [{ text: 'Принять', name: 'accept-request' }, { text: 'Отклонить', name: 'reject-request' }];
            requests.appendChild(makeUserRow(item, item, actions));
        });

        var accepted = overview.filter(function (item) { return item.status === 'accepted'; });
        if (!accepted.length) {
            var noFriends = document.createElement('p');
            noFriends.className = 'social-empty';
            noFriends.textContent = 'Пока нет друзей.';
            friends.appendChild(noFriends);
        }
        accepted.forEach(function (item) {
            var row = makeUserRow(item, item, [
                { text: activeFriend && activeFriend.user_id === item.user_id ? 'Открыт' : 'Чат', name: 'open-chat' }
            ]);
            row.classList.add('social-friend-row');
            row.classList.toggle('is-active', !!activeFriend && activeFriend.user_id === item.user_id);
            friends.appendChild(row);
        });
    }

    async function refreshOverview() {
        var result = await supabase().rpc('get_social_overview');
        if (result.error) throw result.error;
        overview = result.data || [];
        renderOverview();
        if (activeFriend) {
            var fresh = overview.find(function (item) {
                return item.user_id === activeFriend.user_id && item.status === 'accepted';
            });
            if (!fresh) closeChat();
            else {
                activeFriend = fresh;
                updateChatHeader();
            }
        }
    }

    function updateChatHeader() {
        if (!activeFriend) return;
        var avatar = element('social-chat-avatar');
        avatar.replaceChildren(makeAvatar(activeFriend, 'social-avatar-inner').firstChild || document.createTextNode(String(activeFriend.username || '?').charAt(0).toUpperCase()));
        element('social-chat-username').textContent = activeFriend.username || 'Пользователь';
        var status = element('social-chat-presence');
        status.textContent = presenceLabel(activeFriend.is_online);
        status.classList.toggle('is-online', !!activeFriend.is_online);
    }

    function closeChat() {
        activeFriend = null;
        lastMessageId = null;
        element('social-chat-active').style.display = 'none';
        element('social-chat-empty').style.display = 'flex';
        if (messageTimer) window.clearInterval(messageTimer);
        messageTimer = null;
        renderOverview();
    }

    async function openChat(userId) {
        var friend = overview.find(function (item) {
            return item.user_id === userId && item.status === 'accepted';
        });
        if (!friend) return;
        activeFriend = friend;
        lastMessageId = null;
        element('social-chat-empty').style.display = 'none';
        element('social-chat-active').style.display = 'flex';
        element('social-messages').replaceChildren();
        updateChatHeader();
        updateSharePreview();
        renderOverview();
        try {
            await loadMessages();
        } catch (error) {
            reportError(error, 'загрузить переписку');
        }
        if (messageTimer) window.clearInterval(messageTimer);
        messageTimer = window.setInterval(function () {
            if (!isFriendsSectionVisible()) return;
            loadMessages().catch(function (error) { reportError(error, 'обновить переписку'); });
        }, 5000);
    }

    function safeImageUrl(value) {
        return /^https?:\/\//i.test(value || '') ? value : '';
    }

    function renderShareCard(share) {
        var card = document.createElement('div');
        card.className = 'social-shared-card';
        var imageUrl = safeImageUrl(share.poster_url);
        if (imageUrl) {
            var image = document.createElement('img');
            image.src = imageUrl;
            image.alt = '';
            image.loading = 'lazy';
            image.referrerPolicy = 'no-referrer';
            card.appendChild(image);
        }
        var details = document.createElement('div');
        details.className = 'social-shared-details';
        var title = document.createElement('strong');
        title.textContent = share.title || 'Аниме';
        var subtitle = document.createElement('span');
        subtitle.textContent = share.kind === 'episode' ? 'Серия ' + share.episode : 'Аниме';
        details.append(title, subtitle);
        card.appendChild(details);
        if (share.kind === 'episode') {
            var playButton = makeButton('Открыть серию', 'play-shared', '', 'social-play-shared');
            playButton.dataset.animeId = share.id;
            playButton.dataset.animeTitle = share.title;
            playButton.dataset.animePoster = share.poster_url || '';
            playButton.dataset.episode = String(share.episode);
            card.appendChild(playButton);
        }
        return card;
    }

    function appendMessage(message) {
        var list = element('social-messages');
        var bubble = document.createElement('article');
        bubble.className = 'social-message' + (message.sender_id === currentUser.id ? ' is-mine' : '');
        var meta = document.createElement('div');
        meta.className = 'social-message-meta';
        meta.textContent = message.sender_id === currentUser.id ? 'Вы' : activeFriend.username;
        var created = document.createElement('time');
        var date = new Date(message.created_at);
        created.textContent = Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
        meta.appendChild(created);
        bubble.appendChild(meta);
        if (message.body) {
            var text = document.createElement('p');
            text.textContent = message.body;
            bubble.appendChild(text);
        }
        if (message.share_data) bubble.appendChild(renderShareCard(message.share_data));
        list.appendChild(bubble);
    }

    async function loadMessages() {
        if (!activeFriend || loadingMessages) return;
        loadingMessages = true;
        try {
            var me = currentUser.id;
            var friendId = activeFriend.user_id;
            var filter = 'and(sender_id.eq.' + me + ',recipient_id.eq.' + friendId + '),and(sender_id.eq.' + friendId + ',recipient_id.eq.' + me + ')';
            var result = await supabase().from('friend_messages')
                .select('id, sender_id, recipient_id, body, share_data, created_at')
                .or(filter)
                .order('created_at', { ascending: true })
                .limit(150);
            if (result.error) throw result.error;
            if (!activeFriend || activeFriend.user_id !== friendId) return;
            var messages = result.data || [];
            var newestId = messages.length ? messages[messages.length - 1].id : null;
            if (newestId !== lastMessageId) {
                var list = element('social-messages');
                list.replaceChildren();
                messages.forEach(appendMessage);
                list.scrollTop = list.scrollHeight;
                lastMessageId = newestId;
            }
        } finally {
            loadingMessages = false;
        }
    }

    function getCurrentShare() {
        if (typeof currentAnime === 'undefined' || !currentAnime) return null;
        var id = String(currentAnime.id || '');
        var title = String(currentAnime.title || '').trim().slice(0, 200);
        if (!id || !title) return null;
        var episode = typeof currentEpisodeNumber !== 'undefined' ? Number(currentEpisodeNumber) : 0;
        var share = {
            kind: Number.isInteger(episode) && episode > 0 ? 'episode' : 'anime',
            id: id.slice(0, 100),
            title: title,
            poster_url: safeImageUrl(currentAnime.poster_url || currentAnime.poster || '')
        };
        if (share.kind === 'episode') share.episode = episode;
        return share;
    }

    function updateSharePreview() {
        var currentShare = getCurrentShare();
        var share = pendingShare || currentShare;
        var button = element('social-share-current');
        button.disabled = !activeFriend || !share;
        button.textContent = pendingShare
            ? 'Отправить ' + (pendingShare.kind === 'episode' ? 'серию' : 'аниме')
            : 'Поделиться ' + (currentShare && currentShare.kind === 'episode' ? 'серией' : 'аниме');
        element('social-share-preview').textContent = pendingShare
            ? 'Готово к отправке: ' + pendingShare.title + (pendingShare.kind === 'episode' ? ' · серия ' + pendingShare.episode : '')
            : '';
    }

    function openFriendsWithShare(share) {
        pendingShare = share;
        var playerOverlay = element('player-overlay');
        if (playerOverlay && playerOverlay.style.display !== 'none' && typeof window.closePlayerOverlay === 'function') {
            window.closePlayerOverlay();
        }
        window.openFriends();
        updateSharePreview();
    }

    async function sendMessage(body, share) {
        if (!activeFriend) throw new Error('Сначала откройте чат с другом.');
        var payload = {
            sender_id: currentUser.id,
            recipient_id: activeFriend.user_id,
            body: body,
            share_data: share || null
        };
        var result = await supabase().from('friend_messages').insert(payload);
        if (result.error) throw result.error;
        await loadMessages();
    }

    async function handleSocialAction(event) {
        var button = event.target.closest('[data-social-action]');
        if (!button || button.disabled) return;
        var action = button.dataset.socialAction;
        var id = button.dataset.id;
        try {
            if (action === 'noop') return;
            if (action === 'open-chat') {
                var relation = findRelation(id);
                if (relation && relation.status === 'accepted') await openChat(id);
                return;
            }
            if (action === 'send-request') {
                var inserted = await supabase().from('friendships').insert({
                    requester_id: currentUser.id,
                    addressee_id: id,
                    status: 'pending'
                });
                if (inserted.error) throw inserted.error;
            } else if (action === 'accept-request') {
                var updated = await supabase().from('friendships')
                    .update({ status: 'accepted' })
                    .eq('id', id)
                    .eq('addressee_id', currentUser.id);
                if (updated.error) throw updated.error;
            } else if (action === 'reject-request') {
                var removed = await supabase().from('friendships').delete().eq('id', id);
                if (removed.error) throw removed.error;
            }
            setMessage('social-status', action === 'send-request' ? 'Заявка отправлена.' : 'Список друзей обновлён.', false);
            await refreshOverview();
            var query = element('social-search-input').value.trim();
            if (query.length >= 2) await searchUsers(query);
        } catch (error) {
            reportError(error, 'обновить список друзей');
        }
    }

    async function searchUsers(term) {
        setMessage('social-error', '');
        var result = await supabase().rpc('search_social_users', { search_term: term });
        if (result.error) throw result.error;
        renderSearchResults(result.data || []);
    }

    async function openFriends() {
        if (!currentUser) {
            requestedFriendsAfterAuth = true;
            window.openAuthModal('login');
            return;
        }
        openProfileSection('friends');
        element('friends-content').style.display = 'grid';
        setMessage('social-error', '');
        try {
            await refreshOverview();
            updateSharePreview();
        } catch (error) {
            reportError(error, 'загрузить друзей');
        }
    }

    function renderAuthState() {
        currentUser = window.YamikoeSupabase.getCurrentUser();
        var signedIn = !!currentUser;
        element('friends-content').style.display = signedIn ? 'grid' : 'none';
        if (!signedIn) {
            overview = [];
            closeChat();
            if (heartbeatTimer) window.clearInterval(heartbeatTimer);
            if (overviewTimer) window.clearInterval(overviewTimer);
            heartbeatTimer = overviewTimer = null;
            element('social-requests').replaceChildren();
            element('social-friends').replaceChildren();
            element('social-search-results').replaceChildren();
            return;
        }
        supabase().rpc('record_social_presence').then(function (result) {
            if (result.error) throw result.error;
        }).catch(function (error) { reportError(error, 'обновить сетевой статус'); });
        if (heartbeatTimer) window.clearInterval(heartbeatTimer);
        heartbeatTimer = window.setInterval(function () {
            if (window.YamikoeSupabase.getCurrentUser()) {
                supabase().rpc('record_social_presence').then(function (result) {
                    if (result.error) throw result.error;
                }).catch(function (error) { console.error('[Social] Не удалось обновить сетевой статус:', error); });
            }
        }, 60000);
        if (overviewTimer) window.clearInterval(overviewTimer);
        overviewTimer = window.setInterval(function () {
            if (isFriendsSectionVisible()) {
                refreshOverview().catch(function (error) { reportError(error, 'обновить список друзей'); });
            }
        }, 30000);
        if (requestedFriendsAfterAuth) {
            requestedFriendsAfterAuth = false;
            window.setTimeout(openFriends, 0);
        } else if (isFriendsSectionVisible()) {
            openFriends();
        }
    }

    function playSharedEpisode(share) {
        var videoAnime = typeof API !== 'undefined' ? API.findVideoAnime(share.id) : null;
        if (!videoAnime || !Array.isArray(videoAnime.episodes)) {
            setMessage('social-error', 'Эта серия больше недоступна в каталоге.', true);
            return;
        }
        var episode = videoAnime.episodes.find(function (item) {
            return Number(item.number) === Number(share.episode);
        });
        if (!episode) {
            setMessage('social-error', 'Не удалось найти эту серию в каталоге.', true);
            return;
        }
        currentAnime = Object.assign({}, videoAnime, {
            id: share.id,
            title: share.title,
            poster_url: share.poster_url || videoAnime.poster_url || videoAnime.poster || '',
            episodes: videoAnime.episodes.map(function (item) {
                return typeof item === 'number' ? { number: item } : item;
            })
        });
        window.playEpisode(Number(share.episode));
    }

    function installPlayerShareButton() {
        var controls = document.querySelector('.player-buttons-right');
        if (!controls || controls.querySelector('.social-player-share-btn')) return;
        var button = document.createElement('button');
        button.type = 'button';
        button.className = 'player-btn social-player-share-btn';
        button.title = 'Поделиться с другом';
        button.setAttribute('aria-label', 'Поделиться с другом');
        button.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.7 10.7 6.6-4.4m-6.6 7 6.6 4.4"/></svg>';
        button.addEventListener('click', function () {
            var share = getCurrentShare();
            if (!share) {
                setMessage('social-error', 'Не удалось получить данные текущего аниме.', true);
                return;
            }
            openFriendsWithShare(share);
        });
        controls.appendChild(button);
    }

    function installAuthDeepLinkHandler() {
        if (!window.electronAPI || typeof window.electronAPI.onAuthDeepLink !== 'function') return;
        window.electronAPI.onAuthDeepLink(async function (link) {
            try {
                await window.YamikoeSupabase.handleAuthDeepLink(link);
                window.closeAuthModal();
                window.openProfile();
                selectProfileSection('overview');
                setMessage('profile-load-error', 'Почта подтверждена — вы вошли в аккаунт.', false);
            } catch (error) {
                console.error('[Auth] Не удалось подтвердить почту по ссылке:', error);
                window.openAuthModal('login');
                setMessage('auth-login-message', 'Не удалось подтвердить почту. ' + String(error && error.message || 'Запросите новое письмо.'), true);
            }
        });
    }

    document.addEventListener('DOMContentLoaded', function () {
        element('social-search-form').addEventListener('submit', async function (event) {
            event.preventDefault();
            var query = element('social-search-input').value.trim();
            if (query.length < 2) {
                setMessage('social-status', 'Введите не менее двух символов никнейма.', true);
                return;
            }
            try {
                setMessage('social-status', 'Ищем пользователей…');
                await searchUsers(query);
                setMessage('social-status', '');
            } catch (error) {
                reportError(error, 'найти пользователей');
            }
        });
        element('social-search-results').addEventListener('click', handleSocialAction);
        element('social-requests').addEventListener('click', handleSocialAction);
        element('social-friends').addEventListener('click', handleSocialAction);
        element('social-friends').addEventListener('click', function (event) {
            if (event.target.closest('button')) return;
            var row = event.target.closest('.social-user-row');
            if (row && row.dataset.userId) openChat(row.dataset.userId);
        });
        element('social-message-form').addEventListener('submit', async function (event) {
            event.preventDefault();
            var input = element('social-message-input');
            var body = input.value.trim();
            if (!body) return;
            var submit = element('social-send-message');
            submit.disabled = true;
            try {
                await sendMessage(body, null);
                input.value = '';
                setMessage('social-error', '');
            } catch (error) {
                reportError(error, 'отправить сообщение');
            } finally {
                submit.disabled = false;
            }
        });
        element('social-share-current').addEventListener('click', async function () {
            var share = pendingShare || getCurrentShare();
            if (!share || !activeFriend) return;
            var button = element('social-share-current');
            button.disabled = true;
            try {
                await sendMessage('', share);
                pendingShare = null;
                updateSharePreview();
                setMessage('social-error', '');
            } catch (error) {
                reportError(error, 'отправить карточку');
            } finally {
                updateSharePreview();
            }
        });
        element('social-messages').addEventListener('click', function (event) {
            var button = event.target.closest('[data-social-action="play-shared"]');
            if (!button) return;
            playSharedEpisode({
                id: button.dataset.animeId,
                title: button.dataset.animeTitle,
                poster_url: button.dataset.animePoster,
                episode: Number(button.dataset.episode)
            });
        });
        document.querySelector('.profile-sidebar').addEventListener('click', function (event) {
            var button = event.target.closest('[data-profile-section]');
            if (!button) return;
            if (button.dataset.profileSection === 'friends') openFriends();
            else selectProfileSection(button.dataset.profileSection);
        });
        window.addEventListener('yamikoe-profile-section', function (event) {
            if (event.detail.section !== 'friends' && messageTimer) {
                window.clearInterval(messageTimer);
                messageTimer = null;
            }
        });
        window.addEventListener('yamikoe-auth-state', renderAuthState);
        installAuthDeepLinkHandler();
        window.openFriends = openFriends;
        window.openFriendsWithShare = openFriendsWithShare;
        window.openProfileSection = openProfileSection;
        window.selectProfileSection = selectProfileSection;
        if (window.YamikoeSupabase) renderAuthState();
        var observer = new MutationObserver(installPlayerShareButton);
        observer.observe(document.body, { childList: true, subtree: true });
        installPlayerShareButton();
    });

    window.YamikoeSocial = {
        openFriends: openFriends,
        refresh: refreshOverview
    };
})(window, document);
