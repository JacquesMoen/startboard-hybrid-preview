const test = require('node:test');
const assert = require('node:assert/strict');

const manifest = require('../manifest.json');
const { createOffscreenBridge } = require('../js/offscreen-bridge.js');
const { extractRenderedCandidateGroups } = require('../js/rendered-metadata.js');
const { createOffscreenMessageHandler } = require('../js/offscreen-handler.js');

test('extension declares only the extra Chrome capabilities used by the visual pipeline', () => {
    assert.ok(manifest.permissions.includes('scripting'));
    assert.ok(manifest.permissions.includes('offscreen'));
    assert.ok(manifest.host_permissions.includes('<all_urls>'));
});

test('concurrent thumbnail requests create one offscreen document and receive responses', async () => {
    const calls = [];
    let created = false;
    const chromeApi = {
        offscreen: {
            async hasDocument() {
                return created;
            },
            async createDocument(options) {
                calls.push(['create', options]);
                await new Promise(resolve => setImmediate(resolve));
                created = true;
            }
        },
        runtime: {
            async sendMessage(message) {
                if (message.type === 'offscreen:ping') return { ready: true };
                calls.push(['message', message.bookmarkId]);
                return { success: true, bookmarkId: message.bookmarkId };
            }
        }
    };
    const bridge = createOffscreenBridge(chromeApi);

    const responses = await Promise.all([
        bridge.refreshThumbnail({ bookmarkId: 'a', source: 'metadata' }),
        bridge.refreshThumbnail({ bookmarkId: 'b', source: 'metadata' })
    ]);

    assert.equal(calls.filter(call => call[0] === 'create').length, 1);
    assert.deepEqual(calls.filter(call => call[0] === 'message').map(call => call[1]), ['a', 'b']);
    assert.deepEqual(responses.map(response => response.bookmarkId), ['a', 'b']);
});

test('thumbnail refresh waits until the newly created offscreen listener is ready', async () => {
    let created = false;
    let pingCount = 0;
    const messages = [];
    const chromeApi = {
        offscreen: {
            async hasDocument() {
                return created;
            },
            async createDocument() {
                created = true;
            }
        },
        runtime: {
            async sendMessage(message) {
                messages.push(message.type);
                if (message.type === 'offscreen:ping') {
                    pingCount += 1;
                    if (pingCount === 1) {
                        throw new Error('Could not establish connection. Receiving end does not exist.');
                    }
                    return { ready: true };
                }
                return { success: true, bookmarkId: message.bookmarkId };
            }
        }
    };

    const bridge = createOffscreenBridge(chromeApi);
    await bridge.refreshThumbnail({ bookmarkId: 'chronicle', source: 'metadata' });

    assert.equal(pingCount, 2);
    assert.deepEqual(messages, [
        'offscreen:ping',
        'offscreen:ping',
        'offscreen:thumbnail-refresh'
    ]);
});

test('rendered page extraction returns social, schema, icon, manifest, and content candidates', () => {
    const originalDocument = global.document;
    const matches = new Map([
        ['meta[property="og:image"], meta[property="og:image:secure_url"]', [{ content: '/og.jpg' }]],
        ['meta[name="twitter:image"], meta[name="twitter:image:src"]', [{ content: '/twitter.jpg' }]],
        ['meta[itemprop="image"], link[itemprop="image"], img[itemprop="image"]', [{ src: '/schema.jpg' }]],
        ['link[rel="image_src"]', [{ href: '/image-src.jpg' }]],
        ['link[rel~="manifest"]', [{ href: '/manifest.json' }]],
        ['link[rel~="apple-touch-icon"], link[rel~="icon"]', [{ href: '/icon.png', sizes: '192x192' }]],
        ['img[src], img[data-src]', [{ currentSrc: '/rendered.jpg', src: '/fallback.jpg' }]]
    ]);
    global.document = {
        baseURI: 'https://example.com/page',
        querySelectorAll: selector => matches.get(selector) || []
    };

    try {
        assert.deepEqual(extractRenderedCandidateGroups(), {
            pageUrl: 'https://example.com/page',
            candidateGroups: {
                openGraph: ['/og.jpg'],
                twitter: ['/twitter.jpg'],
                schema: ['/schema.jpg'],
                imageSrc: ['/image-src.jpg'],
                manifestUrls: ['/manifest.json'],
                icons: ['/icon.png'],
                content: ['/rendered.jpg']
            }
        });
    } finally {
        global.document = originalDocument;
    }
});

test('offscreen handler processes rendered candidates only for the current icon bookmark', async () => {
    const calls = [];
    const bookmark = { id: 'a', url: 'https://example.com/page', displayType: 'icon' };
    const listener = createOffscreenMessageHandler({
        getBookmark: async () => bookmark,
        refreshMetadata: async () => assert.fail('rendered candidates should avoid a second page fetch'),
        refreshFromCandidateGroups: async (...args) => calls.push(args)
    });

    const response = await new Promise(resolve => {
        const keepChannelOpen = listener({
            type: 'offscreen:thumbnail-refresh',
            bookmarkId: 'a',
            expectedUrl: 'https://example.com/page',
            source: 'rendered-metadata',
            candidateGroups: { openGraph: ['/og.jpg'] },
            pageUrl: 'https://example.com/page'
        }, {}, resolve);
        assert.equal(keepChannelOpen, true);
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], bookmark);
    assert.deepEqual(calls[0][1], { openGraph: ['/og.jpg'] });
    assert.equal(calls[0][3].source, 'rendered-metadata');
    assert.deepEqual(response, { success: true, bookmarkId: 'a' });
});

test('offscreen handler answers readiness probes synchronously', () => {
    const listener = createOffscreenMessageHandler({});
    let response;

    const keepChannelOpen = listener(
        { type: 'offscreen:ping' },
        {},
        value => { response = value; }
    );

    assert.equal(keepChannelOpen, false);
    assert.deepEqual(response, { ready: true });
});
