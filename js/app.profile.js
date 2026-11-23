(function (window, document) {
    'use strict';

    var authMode = 'login';
    var profileEditing = false;
    var authBusy = false;
    var profileBusy = false;
    var selectedAvatarFile = null;
    var avatarPreviewUrl = null;

    function byId(id) {
        return document.getElementById(id);
    }

    function setMessage(id, message, isError) {
        var element = byId(id);
        if (!element) return;
        element.textContent = message || '';
        element.classList.toggle('is-error', !!isError && !!message);
        element.classList.toggle('is-success', !isError && !!message);
    }

    function setButtonBusy(button, busy, busyText, idleText) {
        button.disabled = busy;
        button.textContent = busy ? busyText : idleText;
    }

    function validateUsername(username) {
        return /^[\p{L}\p{N}_-]{2,24}$/u.test(username);
    }

    function safeImageUrl(value) {
        if (!value) return '';
        try {
            var parsed = new URL(value);
            return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : '';
        } catch (_error) {
            return '';
        }
    }

    function setImage(id, value) {
        var image = byId(id);
        var url = safeImageUrl(value);
        image.src = url;
        image.style.display = url ? 'block' : 'none';
    }

    function clearAvatarSelection() {
        selectedAvatarFile = null;
        if (avatarPreviewUrl) URL.revokeObjectURL(avatarPreviewUrl);
        avatarPreviewUrl = null;
        var input = byId('profile-edit-avatar-file');
        if (input) input.value = '';
        var fileName = byId('profile-avatar-file-name');
        if (fileName) {
            fileName.textContent = 'Файл не выбран';
            fileName.removeAttribute('title');
        }
    }

    async function compressAvatar(file) {
        if (!file || !/^image\/(png|jpeg|webp)$/.test(file.type)) {
            throw new Error('Выберите изображение в формате PNG, JPG или WebP.');
        }
        if (file.size > 10 * 1024 * 1024) {
            throw new Error('Размер изображения не должен превышать 10 МБ.');
        }
        if (typeof createImageBitmap !== 'function') {
            throw new Error('Этот браузер не поддерживает обработку изображений.');
        }
        var bitmap = await createImageBitmap(file);
        var scale = Math.min(1, 512 / Math.max(bitmap.width, bitmap.height));
        var canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
        canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        bitmap.close();
        var blob = await new Promise(function (resolve) {
            canvas.toBlob(resolve, 'image/webp', 0.84);
        });
        if (!blob) throw new Error('Не удалось обработать изображение.');
        return blob;
    }

    function updateProfileNavigation(profile) {
        ['btn-profile', 'btn-mob-profile'].forEach(function (id) {
            var button = byId(id);
            if (!button) return;
            var label = button.querySelector('span');
            var text = profile && profile.username ? profile.username : 'Профиль';
            button.title = text;
            button.setAttribute('aria-label', text);
            if (label) label.textContent = text;
            else button.textContent = text;
        });
    }

    function showAuthMode(mode) {
        authMode = mode === 'register' ? 'register' : 'login';
        var isRegister = authMode === 'register';
        byId('auth-title').textContent = isRegister ? 'Регистрация' : 'Вход';
        byId('auth-login-form').style.display = isRegister ? 'none' : 'flex';
        byId('auth-register-form').style.display = isRegister ? 'flex' : 'none';
        byId('auth-tab-login').classList.toggle('active', !isRegister);
        byId('auth-tab-register').classList.toggle('active', isRegister);
        byId('auth-tab-login').setAttribute('aria-selected', String(!isRegister));
        byId('auth-tab-register').setAttribute('aria-selected', String(isRegister));
        setMessage('auth-login-message', '');
        setMessage('auth-register-message', '');
    }

    function openAuthModal(mode) {
        showAuthMode(mode || 'login');
        byId('auth-modal').style.display = 'flex';
        var focusId = authMode === 'register' ? 'auth-register-username' : 'auth-login-email';
        byId(focusId).focus();
    }

    function closeAuthModal() {
        byId('auth-modal').style.display = 'none';
    }

    function renderProfile() {
        var user = window.YamikoeSupabase.getCurrentUser();
        var profile = window.YamikoeSupabase.getCurrentProfile();
        var signedOut = byId('profile-signed-out');
        var content = byId('profile-content');
        var loadError = byId('profile-load-error');
        loadError.textContent = '';
        byId('profile-sign-out-btn').style.display = user ? 'inline-flex' : 'none';
        signedOut.style.display = user ? 'none' : 'flex';
        content.style.display = user && profile ? 'block' : 'none';
        if (!user || !profile) {
            if (user) setMessage('profile-load-error', 'Не удалось загрузить профиль. Проверьте SQL-схему Supabase и подключение.', true);
            return;
        }

        byId('profile-username').textContent = profile.username || 'Пользователь';
        byId('profile-email').textContent = user.email || '';
        byId('profile-coins').textContent = Number(profile.yamikoe_coins || 0).toLocaleString('ru-RU') + ' YK';
        byId('profile-bio').textContent = profile.bio || 'Расскажите о себе.';
        byId('profile-avatar-fallback').textContent = (profile.username || '?').trim().charAt(0).toUpperCase();
        setImage('profile-avatar-image', profile.avatar_url);
        setImage('profile-banner-image', profile.banner_url);
        var premiumUntil = profile.premium_until ? new Date(profile.premium_until) : null;
        var isPremium = premiumUntil && !Number.isNaN(premiumUntil.getTime()) && premiumUntil > new Date();
        var membership = byId('profile-membership');
        membership.textContent = isPremium ? 'Premium' : 'Обычный аккаунт';
        membership.classList.toggle('is-premium', !!isPremium);
        var accent = /^#[0-9a-f]{6}$/i.test(profile.accent_color || '') ? profile.accent_color : '#9b5cff';
        byId('profile-content').style.setProperty('--profile-accent', accent);

        byId('profile-edit-form').style.display = profileEditing ? 'flex' : 'none';
        byId('profile-edit-btn').style.display = profileEditing ? 'none' : 'inline-flex';
        byId('profile-sign-out-btn').style.display = profileEditing ? 'none' : 'inline-flex';
        if (selectedAvatarFile && avatarPreviewUrl) {
            byId('profile-avatar-image').src = avatarPreviewUrl;
            byId('profile-avatar-image').style.display = 'block';
        }
        if (profileEditing) {
            byId('profile-edit-username').value = profile.username || '';
            byId('profile-edit-bio').value = profile.bio || '';
            byId('profile-edit-accent').value = accent;
        }
    }

    function openProfile() {
        var user = window.YamikoeSupabase.getCurrentUser();
        if (!user) {
            openAuthModal('login');
            return;
        }
        profileEditing = false;
        window.switchTab('profile');
        renderProfile();
    }

    function authErrorMessage(error, action) {
        return window.YamikoeSupabase.getAuthErrorMessage(error, action);
    }

    async function handleLogin(event) {
        event.preventDefault();
        if (authBusy) return;
        authBusy = true;
        var button = byId('auth-login-submit');
        setButtonBusy(button, true, 'Входим...', 'Войти');
        setMessage('auth-login-message', '');
        try {
            var form = new FormData(event.currentTarget);
            await window.YamikoeSupabase.signIn(
                String(form.get('email')).trim(),
                String(form.get('password'))
            );
            closeAuthModal();
            profileEditing = false;
            window.switchTab('profile');
            renderProfile();
        } catch (error) {
            console.error('[Supabase] Ошибка входа: ' + String(error && error.message || error), error);
            setMessage('auth-login-message', authErrorMessage(error, 'войти'), true);
        } finally {
            authBusy = false;
            setButtonBusy(button, false, 'Входим...', 'Войти');
        }
    }

    async function handleRegistration(event) {
        event.preventDefault();
        if (authBusy) return;
        var formElement = event.currentTarget;
        var form = new FormData(formElement);
        var username = String(form.get('username')).trim();
        var email = String(form.get('email')).trim();
        var password = String(form.get('password'));
        if (!validateUsername(username)) {
            setMessage('auth-register-message', 'Никнейм: 2–24 символа, только буквы, цифры, _ или -.', true);
            return;
        }
        if (password.length < 6) {
            setMessage('auth-register-message', 'Пароль должен содержать не менее 6 символов.', true);
            return;
        }

        authBusy = true;
        var button = byId('auth-register-submit');
        setButtonBusy(button, true, 'Создаём аккаунт...', 'Создать аккаунт');
        setMessage('auth-register-message', '');
        try {
            var result = await window.YamikoeSupabase.register(username, email, password);
            if (result.requiresEmailConfirmation) {
                setMessage('auth-register-message', 'Аккаунт создан. Подтвердите почту по ссылке в письме, затем войдите.', false);
                formElement.reset();
            } else {
                closeAuthModal();
                profileEditing = false;
                window.switchTab('profile');
                renderProfile();
            }
        } catch (error) {
            console.error('[Supabase] Ошибка регистрации: ' + String(error && error.message || error), error);
            setMessage('auth-register-message', authErrorMessage(error, 'создать аккаунт'), true);
        } finally {
            authBusy = false;
            setButtonBusy(button, false, 'Создаём аккаунт...', 'Создать аккаунт');
        }
    }

    async function handleProfileSave(event) {
        event.preventDefault();
        if (profileBusy) return;
        var username = byId('profile-edit-username').value.trim();
        if (!validateUsername(username)) {
            setMessage('profile-edit-message', 'Никнейм: 2–24 символа, только буквы, цифры, _ или -.', true);
            return;
        }
        profileBusy = true;
        var button = byId('profile-save-btn');
        setButtonBusy(button, true, 'Сохраняем...', 'Сохранить');
        setMessage('profile-edit-message', '');
        try {
            var avatarUrl = window.YamikoeSupabase.getCurrentProfile().avatar_url || '';
            if (selectedAvatarFile) {
                var compressedAvatar = await compressAvatar(selectedAvatarFile);
                avatarUrl = await window.YamikoeSupabase.uploadAvatar(compressedAvatar);
            }
            await window.YamikoeSupabase.updateProfile({
                username: username,
                avatar_url: avatarUrl,
                bio: byId('profile-edit-bio').value.trim(),
                accent_color: byId('profile-edit-accent').value
            });
            clearAvatarSelection();
            profileEditing = false;
            renderProfile();
        } catch (error) {
            console.error('[Supabase] Ошибка сохранения профиля: ' + String(error && error.message || error), error);
            setMessage('profile-edit-message', error.message || authErrorMessage(error, 'сохранить профиль'), true);
        } finally {
            profileBusy = false;
            setButtonBusy(button, false, 'Сохраняем...', 'Сохранить');
        }
    }

    async function handleSignOut() {
        var button = byId('profile-sign-out-btn');
        setButtonBusy(button, true, 'Выходим...', 'Выйти');
        try {
            await window.YamikoeSupabase.signOut();
            profileEditing = false;
            renderProfile();
        } catch (error) {
            console.error('[Supabase] Ошибка выхода: ' + String(error && error.message || error), error);
            setMessage('profile-load-error', authErrorMessage(error, 'выйти'), true);
        } finally {
            if (button) setButtonBusy(button, false, 'Выходим...', 'Выйти');
        }
    }

    document.addEventListener('DOMContentLoaded', function () {
        byId('auth-tab-login').addEventListener('click', function () { showAuthMode('login'); });
        byId('auth-tab-register').addEventListener('click', function () { showAuthMode('register'); });
        byId('auth-close-btn').addEventListener('click', closeAuthModal);
        byId('auth-login-form').addEventListener('submit', handleLogin);
        byId('auth-register-form').addEventListener('submit', handleRegistration);
        byId('profile-edit-btn').addEventListener('click', function () {
            profileEditing = true;
            clearAvatarSelection();
            renderProfile();
            byId('profile-edit-username').focus();
        });
        byId('profile-cancel-edit').addEventListener('click', function () {
            profileEditing = false;
            clearAvatarSelection();
            renderProfile();
        });
        byId('profile-avatar-file-trigger').addEventListener('click', function () {
            byId('profile-edit-avatar-file').click();
        });
        byId('profile-edit-avatar-file').addEventListener('change', function (event) {
            var file = event.target.files && event.target.files[0];
            if (!file) return;
            if (avatarPreviewUrl) URL.revokeObjectURL(avatarPreviewUrl);
            selectedAvatarFile = file;
            avatarPreviewUrl = URL.createObjectURL(file);
            byId('profile-avatar-file-name').textContent = file.name;
            byId('profile-avatar-file-name').title = file.name;
            byId('profile-avatar-image').src = avatarPreviewUrl;
            byId('profile-avatar-image').style.display = 'block';
            setMessage('profile-edit-message', '');
        });
        byId('profile-edit-form').addEventListener('submit', handleProfileSave);
        byId('profile-sign-out-btn').addEventListener('click', handleSignOut);
        updateProfileNavigation(null);
    });

    window.addEventListener('yamikoe-auth-state', function (event) {
        var profile = event.detail && event.detail.profile;
        updateProfileNavigation(profile);
        if (byId('tab-profile').style.display !== 'none') renderProfile();
        if (event.detail && event.detail.error && byId('tab-profile').style.display !== 'none') {
            setMessage('profile-load-error', event.detail.error, true);
        }
    });

    window.openProfile = openProfile;
    window.openAuthModal = openAuthModal;
    window.closeAuthModal = closeAuthModal;
    window.renderProfile = renderProfile;
})(window, document);
