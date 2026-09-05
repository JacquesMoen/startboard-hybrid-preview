const test = require('node:test');
const assert = require('node:assert/strict');

const {
    extractCandidateGroups,
    sortManifestIcons,
    calculateCoverCrop,
    resizeToThumbnail,
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
        ['link[rel~="apple-touch-icon"], link[rel~="icon"]', [
            node({ href: '/favicon-32.png', sizes: '32x32' }),
            node({ href: '/apple-touch.png', sizes: '180x180' })
        ]],
        ['link[rel~="manifest"]', [node({ href: '/manifest.webmanifest' })]],
        ['img[src], img[data-src]', [node({ src: '/first.jpg' }), node({ 'data-src': '/lazy.jpg' })]]
    ]);
    const document = { querySelectorAll: (selector) => matches.get(selector) || [] };

    assert.deepEqual(extractCandidateGroups(document), {
        openGraph: ['/og.jpg'],
        twitter: ['/twitter.jpg'],
        schema: ['/schema.jpg'],
        imageSrc: ['/image-src.jpg'],
        icons: ['/apple-touch.png', '/favicon-32.png'],
        manifestUrls: ['/manifest.webmanifest'],
        content: ['/first.jpg', '/lazy.jpg']
    });
});

test('calculates a centered cover crop for wide and tall source images', () => {
    assert.deepEqual(calculateCoverCrop(1200, 630, 440, 248), {
        sourceX: 41.12903225806451,
        sourceY: 0,
        sourceWidth: 1117.741935483871,
        sourceHeight: 630
    });
    assert.deepEqual(calculateCoverCrop(600, 900, 440, 248), {
        sourceX: 0,
        sourceY: 280.9090909090909,
        sourceWidth: 600,
        sourceHeight: 338.1818181818182
    });
});

test('renders the selected image as a 440 by 248 WebP thumbnail', async () => {
    const drawCalls = [];
    const canvas = {
        width: 0,
        height: 0,
        getContext: () => ({ drawImage: (...args) => drawCalls.push(args) }),
        toDataURL: (type, quality) => {
            assert.equal(type, 'image/webp');
            assert.equal(quality, 0.86);
            return 'data:image/webp;base64,dGh1bWI=';
        }
    };
    const image = {
        naturalWidth: 1200,
        naturalHeight: 630,
        set src(value) {
            assert.equal(value, 'data:image/jpeg;base64,aW1hZ2U=');
            queueMicrotask(() => this.onload());
        }
    };

    const result = await resizeToThumbnail('data:image/jpeg;base64,aW1hZ2U=', {
        createImage: () => image,
        createCanvas: () => canvas
    });

    assert.equal(result, 'data:image/webp;base64,dGh1bWI=');
    assert.deepEqual([canvas.width, canvas.height], [440, 248]);
    assert.equal(drawCalls.length, 1);
    assert.deepEqual(drawCalls[0].slice(-4), [0, 0, 440, 248]);
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
    const thumbnailer = async () => 'data:image/webp;base64,dGh1bWI=';
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
        }, { force: true, storage, parser, fetchImpl, thumbnailer }), true);
        assert.equal(writes.length, 1);
        assert.deepEqual(writes[0].slice(0, 3), [
            'bookmark-1',
            'data:image/webp;base64,dGh1bWI=',
            'metadata'
        ]);
    } finally {
        global.FileReader = OriginalFileReader;
    }
});
