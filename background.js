/*
 * Clipfox - background service worker
 *
 * The popup sets a per-tab count badge after a scan. This worker only keeps
 * that badge honest: it clears stale counts when a tab navigates or closes.
 * It makes no network requests and keeps no browsing history.
 */
'use strict';

var BADGE_COLOR = '#6f5df0';

function configureBadge() {
  if (!globalThis.chrome || !chrome.action) return;
  try {
    if (chrome.action.setBadgeBackgroundColor) {
      var result = chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR });
      if (result && typeof result.catch === 'function') result.catch(function () {});
    }
  } catch (error) {
    // Badge styling is cosmetic; the rest of the extension works without it.
  }
}

function clearBadge(tabId) {
  if (typeof tabId !== 'number' || !globalThis.chrome || !chrome.action) return;
  try {
    var result = chrome.action.setBadgeText({ tabId: tabId, text: '' });
    if (result && typeof result.catch === 'function') result.catch(function () {});
  } catch (error) {
    // The tab may already be gone.
  }
}

if (globalThis.chrome) {
  if (chrome.runtime && chrome.runtime.onInstalled) {
    chrome.runtime.onInstalled.addListener(configureBadge);
  }
  if (chrome.runtime && chrome.runtime.onStartup) {
    chrome.runtime.onStartup.addListener(configureBadge);
  }

  if (chrome.tabs && chrome.tabs.onUpdated) {
    chrome.tabs.onUpdated.addListener(function (tabId, changeInfo) {
      if (!changeInfo) return;
      // Clear as soon as a navigation starts so the old count never looks
      // like it belongs to the new page. In-page history updates also clear.
      if (changeInfo.status === 'loading' || typeof changeInfo.url === 'string') {
        clearBadge(tabId);
      }
    });
  }

  if (chrome.tabs && chrome.tabs.onRemoved) {
    chrome.tabs.onRemoved.addListener(function (tabId) {
      clearBadge(tabId);
    });
  }

  configureBadge();
}
