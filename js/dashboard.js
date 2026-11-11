(function (window, document) {
    'use strict';

    var NAV_ITEMS = [
        ['catalog', 'Главная'],
        ['schedule', 'Расписание'],
        ['all', 'Все релизы'],
        ['favorites', 'Избранное'],
        ['history', 'История']
    ];

    var MOBILE_ITEMS = NAV_ITEMS.concat([['settings', 'Настройки']]);
    var ICONS = {
        catalog: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1V10Z"/></svg>',
        schedule: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/></svg>',
        all: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 5 5"/></svg>',
        favorites: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3Z"/></svg>',
        history: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2M4 5v4h4"/></svg>',
        settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z"/><path d="m19.4 15 .1.1 1.2 1-.9 1.7-1.6-.4a8 8 0 0 1-1.8 1l-.4 1.6h-2l-.4-1.6a8 8 0 0 1-1.8-1l-1.6.4-.9-1.7 1.2-1a7 7 0 0 1 0-2l-1.2-1 .9-1.7 1.6.4a8 8 0 0 1 1.8-1l.4-1.6h2l.4 1.6a8 8 0 0 1 1.8 1l1.6-.4.9 1.7-1.2 1a7 7 0 0 1 0 2Z"/></svg>'
    };

    function makeButton(id, label, mobile) {
        var button = document.createElement('button');
        button.id = mobile ? 'btn-mob-' + id : 'btn-' + id;
        button.dataset.tab = id;
        button.className = mobile ? 'bottom-nav-btn' : 'nav-btn';

        if (mobile) {
            button.innerHTML = (ICONS[id] || '') + '<span>' + label + '</span>';
            button.addEventListener('click', function () {
                if (id === 'settings') window.openSettings();
                else window.switchTab(id);
            });
        } else {
            button.textContent = label;
            button.addEventListener('click', function () { window.switchTab(id); });
        }
        return button;
    }

    function renderNav() {
        var desktop = document.getElementById('nav-buttons-row');
        var mobile = document.getElementById('mobile-nav');
        if (!desktop || !mobile) return;

        desktop.replaceChildren();
        mobile.replaceChildren();
        NAV_ITEMS.forEach(function (item) {
            desktop.appendChild(makeButton(item[0], item[1], false));
        });
        MOBILE_ITEMS.forEach(function (item) {
            mobile.appendChild(makeButton(item[0], item[1], true));
        });
        var catalogButton = document.getElementById('btn-catalog');
        if (catalogButton) catalogButton.classList.add('active');
    }

    window.renderChrome = renderNav;
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', renderNav);
    } else {
        renderNav();
    }
})(window, document);
