/* global OffscreenHandler, PreviewMetadata */

const handleOffscreenMessage = OffscreenHandler.createOffscreenMessageHandler({
    findRepresentativeImage: (pageUrl) => PreviewMetadata.findRepresentativeImage(pageUrl),
    processCandidates: (groups, pageUrl) => PreviewMetadata.processCandidates(groups, pageUrl),
    publishResult: (message) => chrome.runtime.sendMessage(message)
});

chrome.runtime.onMessage.addListener(handleOffscreenMessage);
