(function (window) {
    'use strict';

    var SUPABASE_URL = 'https://uudanseoqlmzygglpyng.supabase.co';
    var SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_tAvRNnIzx32a0gitPrH3rg_94n-spTC';
    var AVATAR_BUCKET = 'avatars';
    var PROFILE_FIELDS = 'id, username, yamikoe_coins, premium_until, accent_color, avatar_url, banner_url, bio, created_at, updated_at';
    var client = null;
    var currentUser = null;
    var currentProfile = null;
    var authSubscription = null;

    function getClient() {
        if (client) return client;
        if (!window.supabase || typeof window.supabase.createClient !== 'function') {
            throw new Error('Не удалось загрузить Supabase. Проверьте подключение к интернету и перезапустите приложение.');
        }
        client = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
            auth: {
                persistSession: true,
                autoRefreshToken: true,
                detectSessionInUrl: true
            }
        });
        return client;
    }

    function authErrorMessage(error, action) {
        var rawMessage = String(error && (error.message || error.msg) || '').trim();
        var message = rawMessage.toLowerCase();
        var code = String(error && error.code || '').toLowerCase();
        var friendlyMessage;

        if (code === '23505' || message.includes('already registered') || message.includes('already been registered') || message.includes('duplicate key')) {
            friendlyMessage = 'Эта почта или никнейм уже заняты.';
        } else if (message.includes('invalid login credentials') || message.includes('invalid credentials')) {
            friendlyMessage = 'Неверная почта или пароль.';
        } else if (message.includes('email not confirmed')) {
            friendlyMessage = 'Подтвердите почту по ссылке из письма, затем войдите.';
        } else if (message.includes('password') && (message.includes('at least') || message.includes('too short') || message.includes('weak'))) {
            friendlyMessage = 'Пароль слишком короткий или ненадёжный. Используйте не менее 6 символов.';
        } else if (message.includes('email') && (message.includes('invalid') || message.includes('valid'))) {
            friendlyMessage = 'Введите корректный адрес электронной почты.';
        } else if (message.includes('username')) {
            friendlyMessage = 'Никнейм занят или имеет недопустимый формат.';
        } else if (message.includes('fetch') || message.includes('network') || message.includes('failed to fetch')) {
            friendlyMessage = 'Не удалось подключиться к серверу. Проверьте интернет и попробуйте ещё раз.';
        } else if (message.includes('profiles') || message.includes('favorites') || message.includes('watch_history') ||
            code === '42p01' || code === '42501' || code === 'pgrst116') {
            friendlyMessage = 'Не удалось получить данные Supabase.';
        } else {
            friendlyMessage = 'Не удалось ' + action + '.';
        }
        return rawMessage ? friendlyMessage + '\nSupabase: ' + rawMessage : friendlyMessage + ' Попробуйте ещё раз.';
    }

    function dispatchAuthState(error) {
        window.dispatchEvent(new CustomEvent('yamikoe-auth-state', {
            detail: { user: currentUser, profile: currentProfile, error: error || null }
        }));
    }

    async function loadProfile(userId) {
        var result = await getClient()
            .from('profiles')
            .select(PROFILE_FIELDS)
            .eq('id', userId)
            .single();
        if (result.error) throw result.error;
        currentProfile = result.data;
        return currentProfile;
    }

    function getProfileUsername(user) {
        var metadata = user.user_metadata || {};
        var candidate = metadata.username || (user.email ? user.email.split('@')[0] : '');
        var username = String(candidate || '').trim().replace(/[^\p{L}\p{N}_-]/gu, '').slice(0, 24);
        if (username.length < 2) {
            username = 'user_' + String(user.id || '').replace(/-/g, '').slice(0, 8);
        }
        return username;
    }

    async function ensureProfile(user) {
        var username = getProfileUsername(user);
        var result = await getClient()
            .from('profiles')
            .upsert({ id: user.id, username: username }, {
                onConflict: 'id',
                ignoreDuplicates: true
            });
        if (result.error && String(result.error.code || '') === '23505') {
            var suffix = String(user.id || '').replace(/-/g, '').slice(0, 6);
            var uniqueUsername = username.slice(0, 17) + '_' + suffix;
            result = await getClient()
                .from('profiles')
                .upsert({ id: user.id, username: uniqueUsername }, {
                    onConflict: 'id',
                    ignoreDuplicates: true
                });
        }
        if (result.error) throw result.error;
    }

    async function syncSession(session) {
        currentUser = session && session.user ? session.user : null;
        currentProfile = null;
        if (!currentUser) {
            dispatchAuthState();
            return null;
        }
        try {
            await ensureProfile(currentUser);
            await loadProfile(currentUser.id);
            dispatchAuthState();
            if (window.YamikoeCloudSync) await window.YamikoeCloudSync.ensureSynced();
            return { user: currentUser, profile: currentProfile };
        } catch (error) {
            dispatchAuthState(authErrorMessage(error, 'загрузить профиль'));
            throw error;
        }
    }

    async function initialize() {
        var supabaseClient = getClient();
        if (!authSubscription) {
            var subscriptionResult = supabaseClient.auth.onAuthStateChange(function (_event, session) {
                window.setTimeout(function () {
                    syncSession(session).catch(function (error) {
                        console.error('[Supabase] Не удалось синхронизировать сессию: ' + String(error && error.message || error), error);
                    });
                }, 0);
            });
            authSubscription = subscriptionResult.data.subscription;
        }
        var result = await supabaseClient.auth.getSession();
        if (result.error) throw result.error;
        return syncSession(result.data.session);
    }

    async function register(username, email, password) {
        var result = await getClient().auth.signUp({
            email: email,
            password: password,
            options: { data: { username: username } }
        });
        if (result.error) throw result.error;
        if (result.data.user && Array.isArray(result.data.user.identities) && result.data.user.identities.length === 0) {
            throw new Error('User already registered');
        }

        if (result.data.session) {
            await syncSession(result.data.session);
        } else {
            // Email confirmation has no authenticated session; the auth.users trigger creates the profile.
            currentUser = null;
            currentProfile = null;
            dispatchAuthState();
        }
        return {
            user: result.data.user,
            requiresEmailConfirmation: !result.data.session
        };
    }

    async function signIn(email, password) {
        var result = await getClient().auth.signInWithPassword({ email: email, password: password });
        if (result.error) throw result.error;
        await syncSession(result.data.session);
        return { user: currentUser, profile: currentProfile };
    }

    async function signOut() {
        var result = await getClient().auth.signOut();
        if (result.error) throw result.error;
        currentUser = null;
        currentProfile = null;
        dispatchAuthState();
    }

    async function updateProfile(changes) {
        if (!currentUser) throw new Error('Войдите в аккаунт, чтобы изменить профиль.');
        var result = await getClient()
            .from('profiles')
            .update(changes)
            .eq('id', currentUser.id)
            .select(PROFILE_FIELDS)
            .single();
        if (result.error) throw result.error;
        currentProfile = result.data;
        dispatchAuthState();
        return currentProfile;
    }

    async function uploadAvatar(blob) {
        if (!currentUser) throw new Error('Войдите в аккаунт, чтобы загрузить аватар.');
        if (blob.type !== 'image/webp') throw new Error('Не удалось преобразовать аватар в WebP.');
        var path = currentUser.id + '/avatar.webp';
        var result = await getClient().storage
            .from(AVATAR_BUCKET)
            .upload(path, blob, { contentType: 'image/webp', cacheControl: '3600', upsert: true });
        if (result.error) {
            if (/bucket.*not found/i.test(result.error.message || '')) {
                throw new Error('В Supabase Storage не найден бакет avatars. Выполните Storage-блок из supabase/schema.sql.');
            }
            throw result.error;
        }
        var publicUrl = getClient().storage.from(AVATAR_BUCKET).getPublicUrl(path).data.publicUrl;
        return publicUrl + '?v=' + Date.now();
    }

    window.YamikoeSupabase = {
        getClient: getClient,
        initialize: initialize,
        register: register,
        signIn: signIn,
        signOut: signOut,
        updateProfile: updateProfile,
        uploadAvatar: uploadAvatar,
        getCurrentUser: function () { return currentUser; },
        getCurrentProfile: function () { return currentProfile; },
        getAuthErrorMessage: authErrorMessage
    };
})(window);
