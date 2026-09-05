(function (root, factory) {
    const policy = root && root.PreviewPolicy ? root.PreviewPolicy : require('./preview-policy.js');
    const api = factory(policy);
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.RefreshCoordinator = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (PreviewPolicy) {
    function createRefreshCoordinator(dependencies) {
        const now = dependencies.now || Date.now;
        const getBookmarks = dependencies.getBookmarks;
        const getBookmark = dependencies.getBookmark;
        const captureScreenshot = dependencies.captureScreenshot;
        const captureVisitedScreenshots = dependencies.captureVisitedScreenshots;
        const refreshThumbnail = dependencies.refreshThumbnail;
        const notifyUpdated = dependencies.notifyUpdated || (async () => {});
        const claimStore = dependencies.claimStore || {
            claim: async () => true,
            release: async () => {}
        };
        const screenshotInFlight = new Set();
        const thumbnailInFlight = new Set();
        let runningDueCheck = null;

        async function checkDueScreenshotRefreshes(trigger) {
            if (runningDueCheck) return runningDueCheck;

            runningDueCheck = (async () => {
                const result = { trigger, updatedIds: [], failedIds: [] };
                const bookmarks = await getBookmarks();
                const due = bookmarks.filter((bookmark) =>
                    PreviewPolicy.isScheduledScreenshotDue(bookmark, now()));

                for (const bookmark of due) {
                    if (screenshotInFlight.has(bookmark.id)) continue;
                    if (!await claimStore.claim(bookmark.id, now())) continue;
                    screenshotInFlight.add(bookmark.id);

                    try {
                        const current = await getBookmark(bookmark.id);
                        if (!PreviewPolicy.isScheduledScreenshotDue(current, now())) continue;
                        await captureScreenshot(current, 'scheduled');
                        result.updatedIds.push(bookmark.id);
                    } catch (error) {
                        result.failedIds.push(bookmark.id);
                    } finally {
                        screenshotInFlight.delete(bookmark.id);
                        await claimStore.release(bookmark.id);
                    }
                }

                if (result.updatedIds.length) await notifyUpdated(result.updatedIds);
                return result;
            })().finally(() => {
                runningDueCheck = null;
            });

            return runningDueCheck;
        }

        async function refreshBookmarkVisual(bookmarkId, source = 'manual') {
            const bookmark = await getBookmark(bookmarkId);
            if (!bookmark) return false;

            if (PreviewPolicy.isScreenshotBookmark(bookmark)) {
                if (screenshotInFlight.has(bookmark.id)) return false;
                screenshotInFlight.add(bookmark.id);
                try {
                    await captureScreenshot(bookmark, source);
                    await notifyUpdated([bookmark.id]);
                    return true;
                } finally {
                    screenshotInFlight.delete(bookmark.id);
                }
            }

            if (PreviewPolicy.isThumbnailBookmark(bookmark)) {
                if (thumbnailInFlight.has(bookmark.id)) return false;
                thumbnailInFlight.add(bookmark.id);
                try {
                    await refreshThumbnail(bookmark, source);
                    await notifyUpdated([bookmark.id]);
                    return true;
                } finally {
                    thumbnailInFlight.delete(bookmark.id);
                }
            }

            return false;
        }

        async function captureVisitedBookmarkVisuals(tab, candidateGroups) {
            const result = { updatedIds: [], failedIds: [] };
            if (!tab || !tab.id || !tab.active || tab.status !== 'complete' ||
                !PreviewPolicy.normalizeComparableUrl(tab.url)) return result;

            const bookmarks = await getBookmarks();
            const screenshotTargets = bookmarks.filter((bookmark) =>
                !screenshotInFlight.has(bookmark.id) &&
                PreviewPolicy.shouldCaptureScreenshotVisit(bookmark, tab.url, now()));
            const thumbnailTargets = bookmarks.filter((bookmark) =>
                !thumbnailInFlight.has(bookmark.id) &&
                PreviewPolicy.shouldRefreshThumbnailVisit(bookmark, tab.url, now()));

            if (screenshotTargets.length && captureVisitedScreenshots) {
                screenshotTargets.forEach((bookmark) => screenshotInFlight.add(bookmark.id));
                try {
                    await captureVisitedScreenshots(screenshotTargets, tab);
                    result.updatedIds.push(...screenshotTargets.map((bookmark) => bookmark.id));
                } catch (error) {
                    result.failedIds.push(...screenshotTargets.map((bookmark) => bookmark.id));
                } finally {
                    screenshotTargets.forEach((bookmark) => screenshotInFlight.delete(bookmark.id));
                }
            }

            for (const bookmark of thumbnailTargets) {
                thumbnailInFlight.add(bookmark.id);
                try {
                    const current = await getBookmark(bookmark.id);
                    if (!PreviewPolicy.shouldRefreshThumbnailVisit(current, tab.url, now())) continue;
                    await refreshThumbnail(current, 'rendered-metadata', {
                        candidateGroups,
                        pageUrl: tab.url,
                        tabId: tab.id
                    });
                    result.updatedIds.push(bookmark.id);
                } catch (error) {
                    result.failedIds.push(bookmark.id);
                } finally {
                    thumbnailInFlight.delete(bookmark.id);
                }
            }

            if (result.updatedIds.length) await notifyUpdated(result.updatedIds);
            return result;
        }

        return {
            checkDueScreenshotRefreshes,
            refreshBookmarkVisual,
            captureVisitedBookmarkVisuals
        };
    }

    function registerRefreshCoordinatorEvents(chromeApi, coordinator) {
        chromeApi.runtime.onStartup.addListener(() =>
            coordinator.checkDueScreenshotRefreshes('startup').catch((error) =>
                console.debug('Scheduled screenshot catch-up skipped:', error.message)));

        chromeApi.runtime.onMessage.addListener((message, sender, sendResponse) => {
            if (!message || (message.type !== 'visual:check-due' && message.type !== 'visual:refresh')) {
                return false;
            }

            const task = message.type === 'visual:check-due'
                ? coordinator.checkDueScreenshotRefreshes('board-open')
                : coordinator.refreshBookmarkVisual(message.bookmarkId, message.source || 'manual');
            Promise.resolve(task)
                .then(() => sendResponse({ success: true }))
                .catch((error) => sendResponse({ success: false, error: error.message }));
            return true;
        });
    }

    return { createRefreshCoordinator, registerRefreshCoordinatorEvents };
});
