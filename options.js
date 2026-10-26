/* Clipfox - settings page controller */
(function () {
  'use strict';

  var DEFAULTS = {
    defaultCopyFormat: 'urls',
    autoWatch: false,
    showBadge: true
  };

  var FORMAT_HINTS = {
    urls: 'Plain URLs, one per line. Video IDs mode skips playlists and channels.',
    'title-url': 'One readable line per result: title, an em dash, then the URL.',
    markdown: 'A linked Markdown list. Paste into notes, docs, or a README.',
    csv: 'A header row plus Title, URL, and Category columns. Excel and Sheets ready.',
    json: 'A pretty-printed array with title, URL, category, and main-video flag.',
    ids: 'Just the 11-character YouTube video IDs. Playlists and channels are skipped.'
  };

  var els = {};
  var storageArea = null;
  var ready = false;
  var statusTimer = 0;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }

  function init() {
    cacheElements();
    setVersion();
    bindEvents();

    storageArea = getStorageArea();
    if (!storageArea) {
      setDisabled(true);
      setStatus('Open this page from the extension to change settings.', 'error');
      applyForm(DEFAULTS);
      return;
    }

    load().catch(function (error) {
      console.error('[Clipfox] Could not load settings:', error);
      applyForm(DEFAULTS);
      setStatus('Could not load settings. Showing defaults.', 'error');
    });
  }

  function cacheElements() {
    els.copyFormat = document.getElementById('copy-format');
    els.formatHint = document.getElementById('format-hint');
    els.autoWatch = document.getElementById('auto-watch');
    els.showBadge = document.getElementById('show-badge');
    els.reset = document.getElementById('reset-btn');
    els.status = document.getElementById('save-status');
    els.version = document.getElementById('version');
  }

  function setVersion() {
    try {
      if (globalThis.chrome && chrome.runtime && chrome.runtime.getManifest) {
        var manifest = chrome.runtime.getManifest();
        if (manifest && manifest.version) els.version.textContent = 'v' + manifest.version;
      }
    } catch (error) {
      // The static version in the markup is a fine fallback.
    }
  }

  function bindEvents() {
    els.copyFormat.addEventListener('change', function () {
      if (!ready) return;
      updateFormatHint();
      save({ defaultCopyFormat: els.copyFormat.value });
    });

    els.autoWatch.addEventListener('change', function () {
      if (!ready) return;
      save({ autoWatch: els.autoWatch.checked });
    });

    els.showBadge.addEventListener('change', function () {
      if (!ready) return;
      var enabled = els.showBadge.checked;
      save({ showBadge: enabled }).then(function (saved) {
        if (saved && !enabled) clearAllTabBadges();
      });
    });

    els.reset.addEventListener('click', function () {
      if (!ready) return;
      applyForm(DEFAULTS);
      save(DEFAULTS).then(function (saved) {
        if (!saved) return;
        clearAllTabBadges().then(function () {
          setStatus('Defaults restored', 'saved');
        });
      });
    });
  }

  function getStorageArea() {
    try {
      if (!globalThis.chrome || !chrome.storage) return null;
      return chrome.storage.sync || chrome.storage.local || null;
    } catch (error) {
      return null;
    }
  }

  function getFallbackArea() {
    try {
      if (!globalThis.chrome || !chrome.storage) return null;
      if (!chrome.storage.sync || !chrome.storage.local) return null;
      return chrome.storage.local;
    } catch (error) {
      return null;
    }
  }

  async function load() {
    var stored;
    try {
      stored = await storageArea.get(DEFAULTS);
    } catch (error) {
      var fallback = getFallbackArea();
      if (!fallback) throw error;
      stored = await fallback.get(DEFAULTS);
    }
    applyForm(normalize(stored));
    ready = true;
    setDisabled(false);
    setStatus('Saved', 'saved');
  }

  function normalize(raw) {
    var source = raw && typeof raw === 'object' ? raw : {};
    return {
      defaultCopyFormat: FORMAT_HINTS[source.defaultCopyFormat]
        ? source.defaultCopyFormat
        : DEFAULTS.defaultCopyFormat,
      autoWatch: source.autoWatch === true,
      showBadge: source.showBadge !== false
    };
  }

  function applyForm(values) {
    var settings = normalize(values);
    els.copyFormat.value = settings.defaultCopyFormat;
    els.autoWatch.checked = settings.autoWatch;
    els.showBadge.checked = settings.showBadge;
    updateFormatHint();
  }

  function updateFormatHint() {
    var hint = FORMAT_HINTS[els.copyFormat.value] || FORMAT_HINTS.urls;
    els.formatHint.textContent = hint;
  }

  async function save(patch) {
    if (!storageArea) return false;
    setStatus('Saving\u2026', '');
    try {
      await storageArea.set(patch);
      setStatus('Saved', 'saved');
      scheduleStatusFade();
      return true;
    } catch (error) {
      var fallback = getFallbackArea();
      if (fallback) {
        try {
          await fallback.set(patch);
          setStatus('Saved locally \u2014 sync is unavailable', 'saved');
          scheduleStatusFade();
          return true;
        } catch (fallbackError) {
          console.error('[Clipfox] Could not save settings:', fallbackError);
          setStatus('Could not save. Try again.', 'error');
          return false;
        }
      }
      console.error('[Clipfox] Could not save settings:', error);
      setStatus('Could not save. Try again.', 'error');
      return false;
    }
  }

  function setStatus(text, tone) {
    if (!els.status) return;
    window.clearTimeout(statusTimer);
    els.status.textContent = text;
    els.status.className = 'save-status' +
      (tone === 'saved' ? ' is-saved' : '') +
      (tone === 'error' ? ' is-error' : '');
  }

  function scheduleStatusFade() {
    statusTimer = window.setTimeout(function () {
      if (els.status) els.status.textContent = 'Saved';
    }, 3200);
  }

  function setDisabled(disabled) {
    els.copyFormat.disabled = disabled;
    els.autoWatch.disabled = disabled;
    els.showBadge.disabled = disabled;
    els.reset.disabled = disabled;
  }

  async function clearAllTabBadges() {
    try {
      if (!globalThis.chrome || !chrome.action || !chrome.tabs) return;
      var tabs = await chrome.tabs.query({});
      if (!Array.isArray(tabs)) return;
      for (var i = 0; i < tabs.length; i++) {
        var tabId = tabs[i] && typeof tabs[i].id === 'number' ? tabs[i].id : null;
        if (tabId === null) continue;
        try {
          await chrome.action.setBadgeText({ tabId: tabId, text: '' });
        } catch (error) {
          // A tab can disappear while badges are being cleared.
        }
      }
    } catch (error) {
      // Badge cleanup is best-effort and never blocks saving the preference.
    }
  }
})();
