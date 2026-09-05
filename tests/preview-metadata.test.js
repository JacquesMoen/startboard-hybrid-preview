const test = require('node:test');
const assert = require('node:assert/strict');

const {
    extractCandidateGroups,
    sortManifestIcons,
    calculateThumbnailPlan,
    sampleEdgeColor,
    resizeToThumbnail,
    refreshBookmarkMetadata,
    refreshBookmarkFromCandidateGroups
} = require('../js/preview-metadata.js');

function node(attributes) {
    return { getAttribute: (name) => attributes[name] || null };
}

test('extracts representative metadata without depending on visible page layout', () => {
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

test('crops near-wide images to 16:9 but preserves portrait image proportions', () => {
    assert.deepEqual(calculateThumbnailPlan(1200, 630), {
        canvasWidth: 1200,
        canvasHeight: 675,
        sourceX: 40,
        sourceY: 0,
        sourceWidth: 1120,
        sourceHeight: 630
    });

    assert.deepEqual(calculateThumbnailPlan(600, 900), {
        canvasWidth: 450,
        canvasHeight: 675,
        sourceX: 0,
        sourceY: 0,
        sourceWidth: 600,
        sourceHeight: 900
    });
});

test('samples a stable plate color from image edges', () => {
    const pixels = new Uint8ClampedArray([
        12, 34, 56, 255, 12, 34, 56, 255, 12, 34, 56, 255,
        12, 34, 56, 255, 99, 99, 99, 255, 12, 34, 56, 255,
        12, 34, 56, 255, 12, 34, 56, 255, 12, 34, 56, 255
    ]);

    assert.equal(sampleEdgeColor(pixels, 3, 3), 'rgb(12, 34, 56)');
});

test('renders a portrait representative image inside the bounded cache without cropping it', async () => {
    const drawCalls = [];
    const renderedPixels = new Uint8ClampedArray(450 * 675 * 4);
    for (let index = 0; index < renderedPixels.length; index += 4) {
        renderedPixels[index] = 20;
        renderedPixels[index + 1] = 40;
        renderedPixels[index + 2] = 60;
        renderedPixels[index + 3] = 255;
    }
    const canvas = {
        width: 0,
        height: 0,
        getContext: () => ({
            drawImage: (...args) => drawCalls.push(args),
            getImageData: () => ({ data: renderedPixels })
        }),
        toDataURL: (type, quality) => {
            assert.equal(type, 'image/webp');
            assert.equal(quality, 0.86);
            return 'data:image/webp;base64,dGh1bWI=';
        }
    };
    const image = {
        naturalWidth: 600,
        naturalHeight: 900,
        set src(value) {
            assert.equal(value, 'data:image/jpeg;base64,aW1hZ2U=');
            queueMicrotask(() => this.onload());
        }
    };

    const result = await resizeToThumbnail('data:image/jpeg;base64,aW1hZ2U=', {
        createImage: () => image,
        createCanvas: () => canvas
    });

    assert.deepEqual(result, {
        imageDataUrl: 'data:image/webp;base64,dGh1bWI=',
        plateColor: 'rgb(20, 40, 60)'
    });
    assert.deepEqual([canvas.width, canvas.height], [450, 675]);
    assert.deepEqual(drawCalls[0].slice(1), [0, 0, 600, 900, 0, 0, 450, 675]);
});

test('sorts manifest icons by declared pixel area', () => {
    const icons = [
        { src: '/small.png', sizes: '64x64' },
        { src: '/scalable.svg', sizes: 'any' },
        { src: '/large.png', sizes: '512x512' }
    ];

    assert.deepEqual(sortManifestIcons(icons), ['/large.png', '/scalable.svg', '/small.png']);
});

test('downloads the best representative image into thumbnail storage', async () => {
    const document = {
        querySelectorAll: (selector) => selector.startsWith('meta[property="og:image"')
            ? [node({ content: '/chronicle.jpg' })]
            : []
    };
    const fetchImpl = async (url) => {
        if (url === 'https://ampcode.com/chronicle') {
            return { ok: true, text: async () => '<html></html>' };
        }
        assert.equal(url, 'https://ampcode.com/chronicle.jpg');
        return {
            ok: true,
            headers: new Headers({ 'content-type': 'image/jpeg' }),
            blob: async () => new Blob(['image'], { type: 'image/jpeg' })
        };
    };
    const writes = [];
    const storage = { saveThumbnail: async (...args) => writes.push(args) };
    const thumbnailer = async () => ({
        imageDataUrl: 'data:image/webp;base64,dGh1bWI=',
        plateColor: 'rgb(12, 34, 56)'
    });
    const OriginalFileReader = global.FileReader;
    global.FileReader = class {
        readAsDataURL() {
            this.result = 'data:image/jpeg;base64,aW1hZ2U=';
            queueMicrotask(() => this.onload());
        }
    };

    try {
        assert.equal(await refreshBookmarkMetadata({
            id: 'chronicle',
            url: 'https://ampcode.com/chronicle',
            displayType: 'icon'
        }, {
            force: true,
            storage,
            parser: { parseFromString: () => document },
            fetchImpl,
            thumbnailer,
            now: () => 12345
        }), true);
        assert.deepEqual(writes, [[
            'chronicle',
            'data:image/webp;base64,dGh1bWI=',
            {
                plateColor: 'rgb(12, 34, 56)',
                sourceUrl: 'https://ampcode.com/chronicle.jpg',
                source: 'metadata',
                timestamp: 12345,
                expectedUrl: 'https://ampcode.com/chronicle'
            }
        ]]);
    } finally {
        global.FileReader = OriginalFileReader;
    }
});

test('uses rendered-DOM candidate groups for visit refreshes', async () => {
    const writes = [];
    const OriginalFileReader = global.FileReader;
    global.FileReader = class {
        readAsDataURL() {
            this.result = 'data:image/png;base64,aW1hZ2U=';
            queueMicrotask(() => this.onload());
        }
    };

    try {
        assert.equal(await refreshBookmarkFromCandidateGroups(
            { id: 'bookmark-1', url: 'https://example.com/app', displayType: 'icon' },
            { openGraph: ['/rendered-og.png'] },
            'https://example.com/app',
            {
                storage: { saveThumbnail: async (...args) => writes.push(args) },
                fetchImpl: async () => ({
                    ok: true,
                    headers: new Headers({ 'content-type': 'image/png' }),
                    blob: async () => new Blob(['image'], { type: 'image/png' })
                }),
                thumbnailer: async () => ({ imageDataUrl: 'data:image/webp;base64,eA==', plateColor: 'rgb(1, 2, 3)' }),
                source: 'rendered-metadata',
                now: () => 67890
            }
        ), true);
        assert.equal(writes[0][2].source, 'rendered-metadata');
        assert.equal(writes[0][2].sourceUrl, 'https://example.com/rendered-og.png');
    } finally {
        global.FileReader = OriginalFileReader;
    }
});
