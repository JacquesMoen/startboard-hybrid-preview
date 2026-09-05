const test = require('node:test');
const assert = require('node:assert/strict');

const {
    extractCandidateGroups,
    sortManifestIcons,
    refreshBookmarkMetadata
} = require('../js/preview-metadata.js');

function node(attributes) {
    return { getAttribute: (name) => attributes[name] || null };
}

test('extracts preview metadata without depending on visible page layout', () => {
    const matches = new Map([
        ['meta[property="og:image"], meta[property="og:image:secure_url"]', [node({ content: '/og.jpg' })]],
        ['meta[name="twitter:image"], meta[name="twitter:image:src"]', [node({ content: '/twitter.jpg' })]],
        ['meta[itemprop="image"], link[itemprop="image"], img[itemprop="image"]', [node({ src: '/schema.jpg' })]],
        ['link[rel="image_src"]', [node({ href: '/image-src.jpg' })]],
        ['link[rel~="manifest"]', [node({ href: '/manifest.webmanifest' })]],
        ['img[src], img[data-src]', [node({ src: '/first.jpg' }), node({ 'data-src': '/lazy.jpg' })]]
    ]);
    const document = { querySelectorAll: (selector) => matches.get(selector) || [] };

    assert.deepEqual(extractCandidateGroups(document), {
        openGraph: ['/og.jpg'],
        twitter: ['/twitter.jpg'],
        schema: ['/schema.jpg'],
        imageSrc: ['/image-src.jpg'],
        manifestUrls: ['/manifest.webmanifest'],
        content: ['/first.jpg', '/lazy.jpg']
    });
});

test('sorts manifest icons by declared pixel area', () => {
    const icons = [
        { src: '/small.png', sizes: '64x64' },
        { src: '/scalable.svg', sizes: 'any' },
        { src: '/large.png', sizes: '512x512' }
    ];

    assert.deepEqual(sortManifestIcons(icons), ['/large.png', '/scalable.svg', '/small.png']);
});

test('downloads the best representative image and records it as metadata', async () => {
    const document = {
        querySelectorAll: (selector) => selector.startsWith('meta[property="og:image"')
            ? [node({ content: '/preview.jpg' })]
            : []
    };
    const parser = { parseFromString: () => document };
    const fetchImpl = async (url) => {
        if (url === 'https://example.com/page') {
            return { ok: true, text: async () => '<html></html>' };
        }
        assert.equal(url, 'https://example.com/preview.jpg');
        return {
            ok: true,
            headers: new Headers({ 'content-type': 'image/jpeg' }),
            blob: async () => new Blob(['image'], { type: 'image/jpeg' })
        };
    };
    const writes = [];
    const storage = {
        savePreview: async (...args) => writes.push(args),
        markPreviewMetadataChecked: async () => assert.fail('successful refresh should not be marked as failed')
    };
    const OriginalFileReader = global.FileReader;
    global.FileReader = class {
        readAsDataURL() {
            this.result = 'data:image/jpeg;base64,aW1hZ2U=';
            queueMicrotask(() => this.onload());
        }
    };

    try {
        assert.equal(await refreshBookmarkMetadata({
            id: 'bookmark-1',
            url: 'https://example.com/page',
            displayType: 'preview'
        }, { force: true, storage, parser, fetchImpl }), true);
        assert.equal(writes.length, 1);
        assert.deepEqual(writes[0].slice(0, 3), [
            'bookmark-1',
            'data:image/jpeg;base64,aW1hZ2U=',
            'metadata'
        ]);
    } finally {
        global.FileReader = OriginalFileReader;
    }
});
