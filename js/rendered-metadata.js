(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.RenderedMetadata = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    // This function is intentionally self-contained so Chrome can execute it in a page.
    function extractRenderedCandidateGroups() {
        function read(element, names) {
            for (const name of names) {
                const propertyValue = element[name];
                if (propertyValue) return propertyValue;
                if (typeof element.getAttribute === 'function') {
                    const attributeValue = element.getAttribute(name);
                    if (attributeValue) return attributeValue;
                }
            }
            return null;
        }

        function values(selector, names, limit) {
            return Array.from(document.querySelectorAll(selector))
                .map((element) => read(element, names))
                .filter(Boolean)
                .slice(0, limit || 50);
        }

        return {
            pageUrl: document.baseURI,
            candidateGroups: {
                openGraph: values(
                    'meta[property="og:image"], meta[property="og:image:secure_url"]', ['content']),
                twitter: values(
                    'meta[name="twitter:image"], meta[name="twitter:image:src"]', ['content']),
                schema: values(
                    'meta[itemprop="image"], link[itemprop="image"], img[itemprop="image"]',
                    ['content', 'href', 'currentSrc', 'src']),
                imageSrc: values('link[rel="image_src"]', ['href']),
                manifestUrls: values('link[rel~="manifest"]', ['href']),
                icons: values(
                    'link[rel~="apple-touch-icon"], link[rel~="icon"]', ['href']),
                content: values('img[src], img[data-src]', ['currentSrc', 'src', 'data-src'], 12)
            }
        };
    }

    return { extractRenderedCandidateGroups };
});
