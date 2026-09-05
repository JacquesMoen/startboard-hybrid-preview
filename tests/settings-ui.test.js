const test = require('node:test');
const assert = require('node:assert/strict');

const settingsUi = require('../js/settings-ui.js');

test('rating tab is moved behind every other settings tab', () => {
    const ratingTab = { id: 'rating' };
    const tabList = {
        children: [{ id: 'visual' }, ratingTab, { id: 'whats-new' }],
        appendChild(tab) {
            this.children = this.children.filter(child => child !== tab);
            this.children.push(tab);
        }
    };

    assert.equal(typeof settingsUi.moveSettingsTabLast, 'function');
    settingsUi.moveSettingsTabLast(tabList, ratingTab);

    assert.deepEqual(tabList.children.map(tab => tab.id), [
        'visual',
        'whats-new',
        'rating'
    ]);
});

test('an unlisted extension disables rating without registering a link action', () => {
    const listeners = [];
    const button = {
        disabled: false,
        addEventListener(type, listener) {
            listeners.push({ type, listener });
        }
    };

    assert.equal(typeof settingsUi.configureStoreRating, 'function');
    settingsUi.configureStoreRating(button, null, () => {
        throw new Error('An unavailable rating button must not open a URL');
    });

    assert.equal(button.disabled, true);
    assert.deepEqual(listeners, []);
});
