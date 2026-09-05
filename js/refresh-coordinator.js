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
        const getScreenshotRecord = dependencies.getScreenshotRecord;
        const saveThumbnail = dependencies.saveThumbnail;
        const notifyUpdated = dependencies.notifyUpdated || (async () => {});
        const claimStore = dependencies.claimStore || {
            claim: async () => true,
            release: async () => {}
        };
        const migrationStore = dependencies.migrationStore || {
            hasCompleted: async () => true,
            markCompleted: async () => {}
        };
        const screenshotInFlight = new Set();
        const thumbnailInFlight = new Set();
        let runningDueCheck = null;
        let runningMigration = null;

        async function migrateLegacyVisuals() {
            if (runningMigration) return runningMigration;

            runningMigration = (async () => {
                if (await migrationStore.hasCompleted()) return { skipped: true };

                const result = {
                    migratedThumbnailIds: [],
                    recapturedScreenshotIds: [],
                    failedIds: []
                };

                try {
                    const bookmarks = await getBookmarks();
                    for (const bookmark of bookmarks) {
                        if (!getScreenshotRecord) continue;

                        let record;
                        try {
                            record = await getScreenshotRecord(bookmark.id);
                        } catch (error) {
                            result.failedIds.push(bookmark.id);
                            continue;
                        }

                        const isLegacyMetadata = bookmark.previewSource === 'metadata' ||
                            (record && record.source === 'metadata');
                        if (!record || !record.imageDataUrl || !isLegacyMetadata) continue;

                        try {
                            const current = await getBookmark(bookmark.id);
                            if (PreviewPolicy.isThumbnailBookmark(current) && saveThumbnail) {
                                await saveThumbnail(current.id, record.imageDataUrl, {
                                    plateColor: current.previewPlateColor || null,
                                    sourceUrl: current.previewSourceUrl || null,
                                    source: 'migration',
                                    timestamp: record.timestamp || now(),
                                    expectedUrl: current.url
                                });
                                result.migratedThumbnailIds.push(current.id);
                            } else if (PreviewPolicy.isScreenshotBookmark(current)) {
                                if (screenshotInFlight.has(current.id)) continue;
                                screenshotInFlight.add(current.id);
                                try {
                                    await captureScreenshot(current, 'migration');
                                    result.recapturedScreenshotIds.push(current.id);
                                } finally {
                                    screenshotInFlight.delete(current.id);
                                }
                            }
                        } catch (error) {
                            result.failedIds.push(bookmark.id);
                        }
                    }
                } finally {
                    await migrationStore.markCompleted();
                }

                const updatedIds = [
                    ...result.migratedThumbnailIds,
                    ...result.recapturedScreenshotIds
                ];
                if (updatedIds.length) await notifyUpdated(updatedIds);
                return result;
            })().finally(() => {
                runningMigration = null;
            });

            return runningMigration;
        }

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
            migrateLegacyVisuals,
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
