(function (globalScope) {
    function moveSettingsTabLast(tabList, tab) {
        if (tabList && tab) {
            tabList.appendChild(tab);
        }
    }

    function configureStoreRating(button, storeUrl, openUrl) {
        if (!button) {
            return;
        }

        const url = typeof storeUrl === 'string' ? storeUrl.trim() : '';
        if (!url || typeof openUrl !== 'function') {
            button.disabled = true;
            return;
        }

        button.disabled = false;
        button.addEventListener('click', () => openUrl(url));
    }

    const settingsUi = {
        moveSettingsTabLast,
        configureStoreRating
    };

    globalScope.SettingsUI = settingsUi;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = settingsUi;
    }
})(typeof globalThis !== 'undefined' ? globalThis : this);
