/* Clipfox - settings page controller */
(function () {
  'use strict';

  var DEFAULTS = {
    defaultCopyFormat: 'urls',
    autoWatch: false,
    showBadge: true,
    defaultFilter: 'video',
    badgeCountMode: 'all',
    watchIntervalMs: 3000
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
  var saving = false;
  var saved = null;
  var draft = null;

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
      setDetail('Settings are unavailable in this preview.');
      return;
    }

    load().catch(function (error) {
      console.error('[Clipfox] Could not load settings:', error);
      handleLoadError('Could not load your settings.');
    });
  }

  function cacheElements() {
    els.copyFormat = document.getElementById('copy-format');
    els.defaultFilter = document.getElementById('default-filter');
    els.formatHint = document.getElementById('format-hint');
    els.autoWatch = document.getElementById('auto-watch');
    els.watchInterval = document.getElementById('watch-interval');
    els.showBadge = document.getElementById('show-badge');
    els.badgeCountMode = document.getElementById('badge-count-mode');
    els.reset = document.getElementById('reset-btn');
    els.cancel = document.getElementById('cancel-btn');
    els.save = document.getElementById('save-btn');
    els.retry = document.getElementById('retry-btn');
    els.status = document.getElementById('save-status');
    els.detail = document.getElementById('save-detail');
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
    [els.copyFormat, els.defaultFilter, els.autoWatch, els.watchInterval,
      els.showBadge, els.badgeCountMode].forEach(function (control) {
      control.addEventListener('change', function () {
        if (!ready || saving) return;
        draft = readForm();
        updateFormatHint();
        updateFormState();
      });
    });

    els.reset.addEventListener('click', function () {
      if (!ready || saving) return;
      draft = normalize(DEFAULTS);
      applyForm(draft);
      updateFormState('Defaults are staged. Save changes to apply them.');
    });

    els.cancel.addEventListener('click', function () {
      if (!ready || saving) return;
      draft = normalize(saved);
      applyForm(draft);
      updateFormState('Your saved preferences are unchanged.');
    });

    els.save.addEventListener('click', saveDraft);
    els.retry.addEventListener('click', function () {
      if (!storageArea || saving) return;
      els.retry.disabled = true;
      load().catch(function (error) {
        console.error('[Clipfox] Could not reload settings:', error);
        handleLoadError('Could not load your settings. Try again.');
      });
    });

    window.addEventListener('beforeunload', function (event) {
      if (!ready || saving || !isDirty()) return;
      event.preventDefault();
      event.returnValue = '';
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
    saved = normalize(stored);
    draft = normalize(stored);
    ready = true;
    setDisabled(false);
    els.retry.hidden = true;
    updateFormState('Your preferences are saved in browser storage.');
  }

  function normalize(raw) {
    var source = raw && typeof raw === 'object' ? raw : {};
    return {
      defaultCopyFormat: FORMAT_HINTS[source.defaultCopyFormat]
        ? source.defaultCopyFormat
        : DEFAULTS.defaultCopyFormat,
      autoWatch: source.autoWatch === true,
      showBadge: source.showBadge !== false,
      defaultFilter: source.defaultFilter === 'all' ? 'all' : DEFAULTS.defaultFilter,
      badgeCountMode: source.badgeCountMode === 'video' ? 'video' : DEFAULTS.badgeCountMode,
      watchIntervalMs: [3000, 5000, 10000].indexOf(Number(source.watchIntervalMs)) !== -1
        ? Number(source.watchIntervalMs)
        : DEFAULTS.watchIntervalMs
    };
  }

  function applyForm(values) {
    var settings = normalize(values);
    els.defaultFilter.value = settings.defaultFilter;
    els.copyFormat.value = settings.defaultCopyFormat;
    els.autoWatch.checked = settings.autoWatch;
    els.watchInterval.value = String(settings.watchIntervalMs);
    els.showBadge.checked = settings.showBadge;
    els.badgeCountMode.value = settings.badgeCountMode;
    updateFormatHint();
    updateFormState();
  }

  function readForm() {
    return normalize({
      defaultFilter: els.defaultFilter.value,
      defaultCopyFormat: els.copyFormat.value,
      autoWatch: els.autoWatch.checked,
      watchIntervalMs: els.watchInterval.value,
      showBadge: els.showBadge.checked,
      badgeCountMode: els.badgeCountMode.value
    });
  }

  function isDirty() {
    return !!saved && !!draft && JSON.stringify(saved) !== JSON.stringify(draft);
  }

  function updateFormState(detail) {
    var dirty = isDirty();
    els.badgeCountMode.disabled = !ready || saving || !draft || !draft.showBadge;
    els.save.disabled = !ready || saving || !dirty;
    els.cancel.disabled = !ready || saving || !dirty;
    els.reset.disabled = !ready || saving || !dirty && JSON.stringify(draft) === JSON.stringify(normalize(DEFAULTS));
    if (saving) {
      setStatus('Saving changes…', '');
      setDetail('Keep this page open while your preferences are saved.');
    } else if (dirty) {
      setStatus('Unsaved changes', 'dirty');
      setDetail(detail || 'Save your changes to apply them to Clipfox.');
    } else {
      setStatus('All changes saved', 'saved');
      setDetail(detail || 'Your preferences are saved in browser storage.');
    }
  }

  function updateFormatHint() {
    var hint = FORMAT_HINTS[els.copyFormat.value] || FORMAT_HINTS.urls;
    els.formatHint.textContent = hint;
  }

  async function saveDraft() {
    if (!storageArea || !ready || saving || !isDirty()) return;
    var next = normalize(draft);
    var modeChanged = saved.badgeCountMode !== next.badgeCountMode;
    var shouldClearBadges = !next.showBadge || modeChanged;
    var syncAvailable = !!(globalThis.chrome && chrome.storage && chrome.storage.sync);
    saving = true;
    setDisabled(true);
    updateFormState();
    var result;
    try {
      await storageArea.set(next);
      result = { ok: true, localOnly: !syncAvailable };
    } catch (error) {
      var fallback = getFallbackArea();
      if (fallback) {
        try {
          await fallback.set(next);
          result = { ok: true, localOnly: true };
        } catch (fallbackError) {
          console.error('[Clipfox] Could not save settings:', fallbackError);
          result = { ok: false };
        }
      } else {
        console.error('[Clipfox] Could not save settings:', error);
        result = { ok: false };
      }
    }
    if (result.ok) {
      saved = next;
      draft = normalize(next);
      if (shouldClearBadges) {
        var cleared = await clearAllTabBadges();
        result.badgesCleared = cleared;
      }
    }
    saving = false;
    setDisabled(false);
    updateFormState();
    if (!result.ok) {
      setStatus('Could not save changes', 'error');
      setDetail('Your edits are still here. Check storage access, then select Save changes to retry.');
      return;
    }
    if (result.localOnly) {
      setDetail('Saved on this device. Browser sync is unavailable.');
    } else if (shouldClearBadges) {
      setDetail(result.badgesCleared
        ? 'Saved. Existing badge counts were cleared; each tab updates after its next scan.'
        : 'Saved. Badge counts will refresh the next time each tab is scanned.');
    } else {
      setDetail('Your preferences are saved in browser storage.');
    }
  }

  function setStatus(text, tone) {
    if (!els.status) return;
    els.status.textContent = text;
    els.status.className = 'save-status' +
      (tone === 'saved' ? ' is-saved' : '') +
      (tone === 'dirty' ? ' is-dirty' : '') +
      (tone === 'error' ? ' is-error' : '');
  }

  function setDetail(text) {
    if (els.detail) els.detail.textContent = text;
  }

  function handleLoadError(message) {
    ready = false;
    setDisabled(true);
    els.retry.hidden = false;
    els.retry.disabled = false;
    setStatus(message, 'error');
    setDetail('Your saved preferences were not changed. Retry loading or reopen Settings.');
  }

  function setDisabled(disabled) {
    els.defaultFilter.disabled = disabled;
    els.copyFormat.disabled = disabled;
    els.autoWatch.disabled = disabled;
    els.watchInterval.disabled = disabled;
    els.showBadge.disabled = disabled;
    els.badgeCountMode.disabled = disabled || !draft || !draft.showBadge;
    els.reset.disabled = disabled;
    els.cancel.disabled = disabled || !isDirty();
    els.save.disabled = disabled || !isDirty();
  }

  async function clearAllTabBadges() {
    var success = true;
    try {
      if (!globalThis.chrome || !chrome.action || !chrome.tabs) return false;
      var tabs = await chrome.tabs.query({});
      if (!Array.isArray(tabs)) return false;
      for (var i = 0; i < tabs.length; i++) {
        var tabId = tabs[i] && typeof tabs[i].id === 'number' ? tabs[i].id : null;
        if (tabId === null) continue;
        try {
          await chrome.action.setBadgeText({ tabId: tabId, text: '' });
        } catch (error) {
          success = false;
          // A tab can disappear while badges are being cleared.
        }
      }
    } catch (error) {
      return false;
    }
    return success;
  }
})();
