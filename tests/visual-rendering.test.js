const test = require('node:test');
const assert = require('node:assert/strict');

const {
    applyRepresentativeThumbnail,
    applyScreenshot,
    applyBookmarkFrameSetting,
    requestVisualRefresh
} = require('../js/visual-rendering.js');

function previewElement() {
    const classes = new Set(['bookmark-preview']);
    return {
        innerHTML: 'old',
        style: {},
        children: [],
        classList: {
            add: (...names) => names.forEach(name => classes.add(name)),
            remove: (...names) => names.forEach(name => classes.delete(name)),
            contains: name => classes.has(name)
        },
        appendChild(child) {
            this.children.push(child);
        }
    };
}

function cardElement() {
    const classes = new Set(['bookmark-card']);
    return {
        classList: {
            add: (...names) => names.forEach(name => classes.add(name)),
            remove: (...names) => names.forEach(name => classes.delete(name)),
            contains: name => classes.has(name)
        }
    };
}

test('representative thumbnail uses contain presentation and its sampled plate color', () => {
    const preview = previewElement();
    applyRepresentativeThumbnail(preview, {
        imageDataUrl: 'data:image/webp;base64,dGh1bWI=',
        plateColor: 'rgb(12, 34, 56)'
    });

    assert.equal(preview.classList.contains('representative-thumbnail'), true);
    assert.equal(preview.classList.contains('screenshot-preview'), false);
    assert.equal(preview.style.backgroundColor, 'rgb(12, 34, 56)');
    assert.match(preview.style.backgroundImage, /data:image\/webp;base64,dGh1bWI=/);
    assert.equal(preview.children.length, 0);
});

test('transparent representative thumbnail also clears the opaque card underlay', () => {
    const card = cardElement();
    const preview = previewElement();
    preview.parentElement = card;

    applyRepresentativeThumbnail(preview, {
        imageDataUrl: 'data:image/webp;base64,dHJhbnNwYXJlbnQ=',
        plateColor: 'transparent'
    });

    assert.equal(preview.style.backgroundColor, 'transparent');
    assert.equal(card.classList.contains('transparent-thumbnail-card'), true);

    applyScreenshot(preview, 'data:image/jpeg;base64,c2NyZWVu', 'Example', () => ({}));
    assert.equal(card.classList.contains('transparent-thumbnail-card'), false);
});

test('real screenshot renders as a dedicated image and clears thumbnail presentation', () => {
    const preview = previewElement();
    preview.classList.add('representative-thumbnail');
    preview.style.backgroundImage = 'url(old)';
    preview.style.backgroundColor = 'red';
    const image = {};

    applyScreenshot(
        preview,
        'data:image/jpeg;base64,c2NyZWVu',
        'Example',
        () => image
    );

    assert.equal(preview.classList.contains('representative-thumbnail'), false);
    assert.equal(preview.classList.contains('screenshot-preview'), true);
    assert.equal(preview.style.backgroundImage, '');
    assert.equal(preview.style.backgroundColor, '');
    assert.equal(image.className, 'screenshot');
    assert.equal(image.src, 'data:image/jpeg;base64,c2NyZWVu');
    assert.equal(image.alt, 'Example');
});

test('manual refresh delegates by bookmark id without changing its display type', async () => {
    const bookmark = { id: 'icon-1', displayType: 'icon' };
    const messages = [];
    const chromeApi = {
        runtime: {
            sendMessage: async message => {
                messages.push(message);
                return { success: true };
            }
        }
    };

    await requestVisualRefresh(chromeApi, bookmark.id, 'manual');

    assert.deepEqual(messages, [{
        type: 'visual:refresh',
        bookmarkId: 'icon-1',
        source: 'manual'
    }]);
    assert.equal(bookmark.displayType, 'icon');
});

test('bookmark frame setting hides ordinary frames only when explicitly disabled', () => {
    const classes = new Set();
    const body = {
        classList: {
            toggle(name, enabled) {
                if (enabled) classes.add(name);
                else classes.delete(name);
            },
            contains: name => classes.has(name)
        }
    };

    assert.equal(typeof applyBookmarkFrameSetting, 'function');
    applyBookmarkFrameSetting(body, false);
    assert.equal(body.classList.contains('bookmark-frames-hidden'), true);

    applyBookmarkFrameSetting(body, true);
    assert.equal(body.classList.contains('bookmark-frames-hidden'), false);

    applyBookmarkFrameSetting(body, undefined);
    assert.equal(body.classList.contains('bookmark-frames-hidden'), false);
});
