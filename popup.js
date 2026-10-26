/* Clipfox - popup controller */
(function () {
  'use strict';

  var MAX_LINKS = 500;
  var RENDER_BATCH = 100;
  var SCAN_TIMEOUT_MS = 15000;
  var DEFAULT_WATCH_INTERVAL_MS = 3000;
  var WATCH_PROBE_TIMEOUT_MS = 5000;
  var SVG_NS = 'http://www.w3.org/2000/svg';

  var SETTINGS_DEFAULTS = {
    defaultCopyFormat: 'urls',
    autoWatch: false,
    showBadge: true,
    defaultFilter: 'video',
    badgeCountMode: 'all',
    watchIntervalMs: DEFAULT_WATCH_INTERVAL_MS
  };

  var COPY_FORMATS = {
    urls: { label: 'URLs', noun: 'URLs', extension: 'txt', mime: 'text/plain' },
    'title-url': { label: 'Title + URL', noun: 'title + URL rows', extension: 'txt', mime: 'text/plain' },
    markdown: { label: 'Markdown', noun: 'Markdown links', extension: 'md', mime: 'text/markdown' },
    csv: { label: 'CSV', noun: 'CSV rows', extension: 'csv', mime: 'text/csv' },
    json: { label: 'JSON', noun: 'JSON entries', extension: 'json', mime: 'application/json' },
    ids: { label: 'Video IDs', noun: 'video IDs', extension: 'txt', mime: 'text/plain' }
  };

  // "Videos" is a group filter: it covers normal videos, Shorts, and live
  // streams so the popup shows playable YouTube content only by default.
  var FILTER_ORDER = ['video', 'playlist', 'channel', 'other'];
  var VIDEO_CATEGORIES = { video: true, short: true, live: true };
  var DEFAULT_FILTER = SETTINGS_DEFAULTS.defaultFilter;

  var CATEGORY_META = {
    video: { label: 'Video', filterLabel: 'Videos', fallbackTitle: 'YouTube video' },
    short: { label: 'Short', filterLabel: 'Shorts', fallbackTitle: 'YouTube Short' },
    live: { label: 'Live', filterLabel: 'Live', fallbackTitle: 'YouTube live stream' },
    playlist: { label: 'Playlist', filterLabel: 'Playlists', fallbackTitle: 'YouTube playlist' },
    channel: { label: 'Channel', filterLabel: 'Channels', fallbackTitle: 'YouTube channel' },
    other: { label: 'Other', filterLabel: 'Other', fallbackTitle: 'YouTube link' }
  };

  var state = {
    phase: 'idle',
    busy: false,
    copying: false,
    tabId: null,
    pageUrl: '',
    pageTitle: '',
    links: [],
    stats: null,
    scanMs: 0,
    filter: DEFAULT_FILTER,
    query: '',
    renderLimit: RENDER_BATCH,
    error: null,
    stale: false,
    settings: Object.assign({}, SETTINGS_DEFAULTS),
    copyFormat: SETTINGS_DEFAULTS.defaultCopyFormat,
    watch: {
      enabled: false,
      timer: 0,
      signature: null,
      probing: false,
      lastError: '',
      autoApplied: false,
      nextAttemptAt: 0
    }
  };

  var els = {};
  var byKey = new Map();
  var toastTimer = 0;
  var stateAction = 'rescan';
  var badgeMemo = { tabId: null, text: null, show: null, mode: null };
  var badgeColorSet = false;

  // Declared before init() runs. popup.js is deferred, so init() executes
  // during this script's evaluation; assigning null further down would wipe
  // the reference to the loading skeleton that buildIconIcons() just created.
  var loadingPanel = null;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }

  function init() {
    cacheElements();
    buildIconIcons();
    bindEvents();
    observeTabChanges();
    observeSettings();
    syncCopyFormatControl();
    renderAll();
    loadSettings();
    primeActiveTab();
    window.addEventListener('pagehide', function () {
      stopWatch(true);
    }, { once: true });
  }

  // Read the active tab URL for the header without scanning the page.
  async function primeActiveTab() {
    try {
      if (!globalThis.chrome || !chrome.tabs || !chrome.tabs.query) return;
      var tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      var tab = tabs && tabs.length ? tabs[0] : null;
      if (!tab || typeof tab.id !== 'number') return;
      state.tabId = tab.id;
      if (typeof tab.url === 'string') state.pageUrl = tab.url;
      if (typeof tab.title === 'string') state.pageTitle = tab.title;

      // Explain protected pages before the user presses Scan. Reading the tab
      // URL is not a page scan; normal pages still wait for the button.
      var blocked = describeRestrictedUrl(state.pageUrl);
      if (blocked) {
        state.phase = 'restricted';
        state.error = {
          title: blocked.title,
          message: blocked.message,
          footer: blocked.footer,
          restricted: true,
          retryable: false,
          tone: 'warning'
        };
        renderAll();
        applyBadge();
        return;
      }

      updatePageStrip();
      applyBadge();
    } catch (error) {
      // The scan button still works without this hint.
    }
  }

  function cacheElements() {
    els.countBadge = document.getElementById('count-badge');
    els.linkCount = document.getElementById('link-count');
    els.linkLabel = document.getElementById('link-label');
    els.pageHost = document.getElementById('page-host');
    els.scanTime = document.getElementById('scan-time');
    els.search = document.getElementById('search-input');
    els.searchClear = document.getElementById('search-clear');
    els.rescan = document.getElementById('rescan-btn');
    els.watch = document.getElementById('watch-btn');
    els.watchLabel = document.getElementById('watch-label');
    els.copyAll = document.getElementById('copy-all-btn');
    els.copyAllLabel = document.getElementById('copy-all-label');
    els.copyFormat = document.getElementById('copy-format');
    els.export = document.getElementById('export-btn');
    els.controls = document.getElementById('controls');
    els.filters = document.getElementById('filters');
    els.resultsArea = document.getElementById('results-area');
    els.resultsScroll = document.getElementById('results-scroll');
    els.results = document.getElementById('results');
    els.statePanel = document.getElementById('state-panel');
    els.stateIcon = document.getElementById('state-icon');
    els.stateTitle = document.getElementById('state-title');
    els.stateMessage = document.getElementById('state-message');
    els.stateAction = document.getElementById('state-action');
    els.stateDiagnostics = document.getElementById('state-diagnostics');
    els.loadMoreWrap = document.getElementById('load-more-wrap');
    els.loadMore = document.getElementById('load-more-btn');
    els.renderSummary = document.getElementById('render-summary');
    els.footerStatus = document.getElementById('footer-status');
    els.statusDot = document.getElementById('status-dot');
    els.settingsBtn = document.getElementById('settings-btn');
    els.toast = document.getElementById('toast');
    els.toastIcon = document.getElementById('toast-icon');
    els.toastMessage = document.getElementById('toast-message');
    els.announcer = document.getElementById('sr-announcer');
  }

  // The loading panel is created on demand so the static markup stays minimal.
  function buildIconIcons() {
    loadingPanel = document.createElement('div');
    loadingPanel.className = 'results';
    loadingPanel.id = 'loading-panel';
    loadingPanel.setAttribute('aria-hidden', 'true');
    loadingPanel.hidden = true;
    for (var i = 0; i < 4; i++) {
      var skeleton = document.createElement('div');
      skeleton.className = 'skeleton';

      var bars = document.createElement('div');
      bars.className = 'skeleton-bars';

      var pill = document.createElement('div');
      pill.className = 'skeleton-line skeleton-pill';
      var title = document.createElement('div');
      title.className = 'skeleton-line skeleton-title';
      var url = document.createElement('div');
      url.className = 'skeleton-line skeleton-url';

      bars.appendChild(pill);
      bars.appendChild(title);
      bars.appendChild(url);

      var actions = document.createElement('div');
      actions.className = 'skeleton-line skeleton-actions';

      skeleton.appendChild(bars);
      skeleton.appendChild(actions);
      loadingPanel.appendChild(skeleton);
    }
    els.resultsScroll.insertBefore(loadingPanel, els.results);
  }

  function bindEvents() {
    els.rescan.addEventListener('click', function () {
      startScan();
    });

    els.watch.addEventListener('click', toggleWatch);

    els.copyAll.addEventListener('click', copyAll);

    els.copyFormat.addEventListener('change', function () {
      setCopyFormat(els.copyFormat.value, true);
    });

    els.export.addEventListener('click', exportLinks);

    els.stateDiagnostics.addEventListener('click', copyDiagnostics);

    els.settingsBtn.addEventListener('click', openOptions);

    els.search.addEventListener('input', function () {
      state.query = els.search.value;
      state.renderLimit = RENDER_BATCH;
      updateSearchClear();
      renderResults(true);
      renderControls();
      updateFooterStatus();
      announce(visibleSummary());
    });

    els.searchClear.addEventListener('click', function () {
      clearSearch();
      els.search.focus();
    });

    els.filters.addEventListener('click', function (event) {
      var chip = event.target.closest ? event.target.closest('button[data-filter]') : null;
      if (!chip) return;
      setFilter(chip.getAttribute('data-filter'));
    });

    els.results.addEventListener('click', function (event) {
      var button = event.target.closest ? event.target.closest('button[data-action]') : null;
      if (!button) return;
      var link = byKey.get(button.getAttribute('data-key'));
      if (!link) return;
      var action = button.getAttribute('data-action');
      if (action === 'copy') {
        copyOne(link, button);
      } else if (action === 'copy-id') {
        copyVideoId(link, button);
      } else if (action === 'open') {
        openOne(link);
      }
    });

    els.loadMore.addEventListener('click', function () {
      var visible = getVisibleLinks();
      state.renderLimit = Math.min(state.renderLimit + RENDER_BATCH, visible.length);
      renderResults(false);
    });

    els.stateAction.addEventListener('click', function () {
      if (stateAction === 'clear') {
        clearFilters();
      } else if (stateAction === 'show-all') {
        setFilter('all');
      } else {
        startScan();
      }
    });

    document.addEventListener('keydown', function (event) {
      var target = event.target;
      var tag = target && target.tagName ? target.tagName.toLowerCase() : '';
      var inField = tag === 'input' || tag === 'textarea' || (target && target.isContentEditable);

      if (!inField && (event.key === '/' || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k'))) {
        event.preventDefault();
        els.search.focus();
        els.search.select();
        return;
      }

      if (event.key === 'Escape' && document.activeElement === els.search && els.search.value) {
        event.preventDefault();
        clearSearch();
      }
    });
  }

  function observeTabChanges() {
    try {
      if (!globalThis.chrome || !chrome.tabs || !chrome.tabs.onUpdated) return;
      chrome.tabs.onUpdated.addListener(function (tabId, changeInfo) {
        if (state.busy || !state.tabId || tabId !== state.tabId) return;
        if (changeInfo && changeInfo.status === 'complete' &&
            (state.phase === 'ready' || state.phase === 'empty')) {
          state.stale = true;
          updateFooterStatus();
          announce('The page changed since this scan. Rescan to refresh.');
        }
      });
    } catch (error) {
      // Tab update hints are a convenience, never a hard requirement.
    }
  }

  // ------------------------------------------------------------------ settings

  function observeSettings() {
    try {
      if (!globalThis.chrome || !chrome.storage || !chrome.storage.onChanged) return;
      chrome.storage.onChanged.addListener(function (changes, areaName) {
        if (areaName !== 'sync' && areaName !== 'local') return;
        var patch = {};
        if (changes.defaultCopyFormat) patch.defaultCopyFormat = changes.defaultCopyFormat.newValue;
        if (changes.autoWatch) patch.autoWatch = changes.autoWatch.newValue;
        if (changes.showBadge) patch.showBadge = changes.showBadge.newValue;
        if (changes.defaultFilter) patch.defaultFilter = changes.defaultFilter.newValue;
        if (changes.badgeCountMode) patch.badgeCountMode = changes.badgeCountMode.newValue;
        if (changes.watchIntervalMs) patch.watchIntervalMs = changes.watchIntervalMs.newValue;
        if (Object.keys(patch).length) applySettings(patch, false);
      });
    } catch (error) {
      // Settings sync is optional; defaults still work.
    }
  }

  async function loadSettings() {
    var stored = null;
    try {
      if (globalThis.chrome && chrome.storage && chrome.storage.sync) {
        stored = await chrome.storage.sync.get(SETTINGS_DEFAULTS);
      } else if (globalThis.chrome && chrome.storage && chrome.storage.local) {
        stored = await chrome.storage.local.get(SETTINGS_DEFAULTS);
      }
    } catch (error) {
      // A sync failure should not discard preferences saved locally.
      try {
        if (globalThis.chrome && chrome.storage && chrome.storage.local) {
          stored = await chrome.storage.local.get(SETTINGS_DEFAULTS);
        }
      } catch (fallbackError) {
        // Keep the privacy-safe defaults when storage is unavailable.
      }
    }
    if (stored) applySettings(stored, true);
  }

  function normalizeSettings(raw) {
    var source = raw && typeof raw === 'object' ? raw : {};
    return {
      defaultCopyFormat: COPY_FORMATS[source.defaultCopyFormat]
        ? source.defaultCopyFormat
        : SETTINGS_DEFAULTS.defaultCopyFormat,
      autoWatch: source.autoWatch === true,
      showBadge: source.showBadge !== false,
      defaultFilter: source.defaultFilter === 'all' ? 'all' : SETTINGS_DEFAULTS.defaultFilter,
      badgeCountMode: source.badgeCountMode === 'video' ? 'video' : SETTINGS_DEFAULTS.badgeCountMode,
      watchIntervalMs: [3000, 5000, 10000].indexOf(Number(source.watchIntervalMs)) !== -1
        ? Number(source.watchIntervalMs)
        : SETTINGS_DEFAULTS.watchIntervalMs
    };
  }

  function applySettings(raw, initial) {
    var previousInterval = state.settings.watchIntervalMs;
    state.settings = normalizeSettings(Object.assign({}, state.settings, raw || {}));
    state.copyFormat = state.settings.defaultCopyFormat;
    if (initial) state.filter = state.settings.defaultFilter;
    syncCopyFormatControl();
    renderControls();
    applyBadge();
    if (!initial && state.watch.enabled && previousInterval !== state.settings.watchIntervalMs) {
      scheduleWatchTick(state.settings.watchIntervalMs);
    }
  }

  function syncCopyFormatControl() {
    if (!els.copyFormat) return;
    var format = COPY_FORMATS[state.copyFormat] ? state.copyFormat : SETTINGS_DEFAULTS.defaultCopyFormat;
    els.copyFormat.value = format;
  }

  function setCopyFormat(format, persist) {
    if (!COPY_FORMATS[format]) return;
    state.copyFormat = format;
    syncCopyFormatControl();
    renderControls();
    if (persist) persistSettings({ defaultCopyFormat: format });
  }

  async function persistSettings(patch) {
    applySettings(patch, false);
    var area = null;
    var fallback = null;
    try {
      if (globalThis.chrome && chrome.storage) {
        area = chrome.storage.sync || chrome.storage.local || null;
        if (chrome.storage.sync && chrome.storage.local) fallback = chrome.storage.local;
      }
    } catch (error) {
      area = null;
      fallback = null;
    }
    if (!area) {
      console.error('[Clipfox] Could not save settings: storage is unavailable');
      showToast('Couldn\'t save this preference', 'error');
      return;
    }
    try {
      await area.set(patch);
      return;
    } catch (error) {
      if (!fallback) {
        console.error('[Clipfox] Could not save settings:', error);
        showToast('Couldn\'t save this preference', 'error');
        return;
      }
      // Sync can be present but reject writes (for example when the browser
      // profile has sync disabled). Keep the preference locally instead.
      try {
        await fallback.set(patch);
        showToast('Saved locally \u2014 sync is unavailable', 'success');
        return;
      } catch (fallbackError) {
        console.error('[Clipfox] Could not save settings:', fallbackError);
        showToast('Couldn\'t save this preference', 'error');
      }
    }
  }

  // ---------------------------------------------------------------- watch mode

  function toggleWatch() {
    if (state.watch.enabled) {
      stopWatch(false);
    } else {
      state.watch.autoApplied = true;
      startWatch(false);
    }
  }

  function watchInterval() {
    return state.settings.watchIntervalMs || DEFAULT_WATCH_INTERVAL_MS;
  }

  function startWatch(automatic) {
    if (state.watch.enabled) return;
    if (state.busy) return;

    var prober = globalThis.YTExtractor && globalThis.YTExtractor.probeEmbeds;
    if (typeof prober !== 'function') {
      if (!automatic) showToast('Watch mode is unavailable', 'error');
      return;
    }

    state.watch.enabled = true;
    state.watch.signature = null;
    state.watch.lastError = '';
    state.watch.nextAttemptAt = 0;
    state.watch.autoApplied = state.watch.autoApplied || automatic;
    renderWatchState();
    renderControls();
    updateFooterStatus();
    applyBadge();

    if (!automatic) {
      showToast('Watching for player changes', 'success');
      announce('Watch mode on. The results refresh when the page player changes.');
    }
    scheduleWatchTick(0);
  }

  function stopWatch(silent) {
    if (state.watch.timer) {
      window.clearTimeout(state.watch.timer);
      state.watch.timer = 0;
    }
    if (!state.watch.enabled) return;
    state.watch.enabled = false;
    state.watch.signature = null;
    state.watch.lastError = '';
    state.watch.probing = false;
    state.watch.nextAttemptAt = 0;
    state.watch.autoApplied = true;
    renderWatchState();
    updateFooterStatus();
    applyBadge();
    if (!silent) {
      showToast('Watch mode off');
      announce('Watch mode off.');
    }
  }

  function scheduleWatchTick(delay) {
    if (!state.watch.enabled) return;
    if (state.watch.timer) window.clearTimeout(state.watch.timer);
    state.watch.timer = window.setTimeout(function () {
      state.watch.timer = 0;
      watchTick();
    }, delay);
  }

  async function watchTick() {
    if (!state.watch.enabled || state.busy || state.watch.probing) {
      scheduleWatchTick(watchInterval());
      return;
    }

    state.watch.probing = true;
    var probe = null;
    try {
      probe = await probeCurrentPage();
    } catch (error) {
      probe = null;
    } finally {
      state.watch.probing = false;
    }

    if (!state.watch.enabled) return;

    if (!probe) {
      // A transient scripting failure should never wipe good results.
      scheduleWatchTick(watchInterval());
      return;
    }

    var signature = probe.signature || '';
    if (state.watch.signature === null) {
      state.watch.signature = signature;
      scheduleWatchTick(watchInterval());
      return;
    }

    if (signature !== state.watch.signature) {
      if (Date.now() < state.watch.nextAttemptAt) {
        scheduleWatchTick(watchInterval());
        return;
      }
      var previousUrls = state.links.map(function (link) { return link.url; }).join('\n');
      var succeeded = await startScan({ silent: true, watchSignature: signature });
      if (!state.watch.enabled) return;
      if (succeeded) {
        state.watch.signature = signature;
        state.watch.lastError = '';
        state.watch.nextAttemptAt = 0;
        var nextUrls = state.links.map(function (link) { return link.url; }).join('\n');
        if (nextUrls !== previousUrls) {
          showToast('Results updated while watching', 'success');
          announce('The page player changed. Results refreshed.');
        } else {
          updateFooterStatus();
        }
      } else {
        if (!state.watch.lastError) {
          state.watch.lastError = state.error && state.error.footer
            ? state.error.footer
            : 'The page player changed, but the refresh failed.';
        }
        state.watch.nextAttemptAt = Date.now() + 10000;
        updateFooterStatus();
      }
    }

    scheduleWatchTick(watchInterval());
  }

  async function probeCurrentPage() {
    var prober = globalThis.YTExtractor && globalThis.YTExtractor.probeEmbeds;
    if (typeof prober !== 'function' || typeof state.tabId !== 'number') return null;
    var injection = await withTimeout(
      chrome.scripting.executeScript({
        target: { tabId: state.tabId },
        func: prober,
        args: [{ maxEmbeds: 50 }]
      }),
      WATCH_PROBE_TIMEOUT_MS
    );
    var data = injection && injection[0] ? injection[0].result : null;
    return data && data.ok === true ? data : null;
  }

  function renderWatchState() {
    if (!els.watch) return;
    var watching = state.watch.enabled;
    els.watch.setAttribute('aria-pressed', watching ? 'true' : 'false');
    els.watch.title = watching
      ? 'Stop watching this page for player changes'
      : 'Refresh automatically when the page player changes';
    els.watch.setAttribute('aria-label', watching
      ? 'Watch mode on. Stop watching this page.'
      : 'Watch this page for player changes');
    els.watchLabel.textContent = watching ? 'Watching' : 'Watch';
  }

  // ------------------------------------------------------------------ scanning

  function ScanError(code, message, details) {
    this.name = 'ScanError';
    this.code = code;
    this.message = message || code;
    this.details = details || null;
  }
  ScanError.prototype = Object.create(Error.prototype);
  ScanError.prototype.constructor = ScanError;

  async function startScan(options) {
    var scanOptions = options || {};
    var silent = scanOptions.silent === true;
    var watchSignature = typeof scanOptions.watchSignature === 'string'
      ? scanOptions.watchSignature
      : null;

    if (state.busy) return false;

    var hadResults = state.links.length > 0 &&
      (state.phase === 'ready' || state.phase === 'empty');
    var previousUrls = state.links.map(function (link) { return link.url; }).join('\n');
    var succeeded = false;

    state.busy = true;
    if (!silent) {
      state.filter = state.settings.defaultFilter;
      state.phase = 'loading';
      state.error = null;
      state.stale = false;
      state.watch.signature = null;
      state.watch.lastError = '';
      renderAll();
      applyBadge();
      announce('Scanning the current page.');
    }

    try {
      if (!globalThis.chrome || !chrome.tabs || !chrome.scripting) {
        throw new ScanError('ENV', 'Extension APIs are unavailable.',
          'Reload the extension from the extensions page and try again.');
      }

      var tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      var tab = tabs && tabs.length ? tabs[0] : null;
      if (!tab || typeof tab.id !== 'number' || tab.id < 0) {
        throw new ScanError('NO_TAB', 'No active tab was found.',
          'Open a normal website tab and try again.');
      }

      state.tabId = tab.id;
      state.pageUrl = typeof tab.url === 'string' ? tab.url : '';
      state.pageTitle = typeof tab.title === 'string' ? tab.title : '';

      var blocked = describeRestrictedUrl(state.pageUrl);
      if (blocked) {
        throw new ScanError('RESTRICTED', 'Restricted page', blocked);
      }

      var scanner = globalThis.YTExtractor && globalThis.YTExtractor.scan;
      if (typeof scanner !== 'function') {
        throw new ScanError('SCANNER_MISSING', 'The page scanner failed to load.',
          'Reload the extension and try again.');
      }

      var injection = await withTimeout(
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: scanner,
          args: [{ maxLinks: MAX_LINKS, includeText: true }]
        }),
        SCAN_TIMEOUT_MS
      );

      var data = injection && injection[0] ? injection[0].result : null;
      if (!data || data.ok !== true) {
        throw new ScanError('SCAN_FAILED', 'The page did not return scan data.',
          data && data.error
            ? 'The page returned an unexpected response (' + data.error + ').'
            : 'Reload the page and try again.');
      }

      var seen = new Set();
      var links = [];
      var rawLinks = Array.isArray(data.links) ? data.links : [];
      for (var i = 0; i < rawLinks.length; i++) {
        var link = normalizeLink(rawLinks[i]);
        if (!link || seen.has(link.key)) continue;
        seen.add(link.key);
        links.push(link);
      }

      markMainVideo(links);

      state.links = links;
      state.stats = data.stats && typeof data.stats === 'object' ? data.stats : null;
      if (!state.pageUrl && typeof data.pageUrl === 'string' && data.pageUrl) {
        state.pageUrl = data.pageUrl;
      }
      state.pageTitle = typeof data.pageTitle === 'string' && data.pageTitle ? data.pageTitle : state.pageTitle;
      state.scanMs = state.stats && typeof state.stats.elapsedMs === 'number'
        ? Math.round(state.stats.elapsedMs)
        : 0;
      state.renderLimit = RENDER_BATCH;
      state.error = null;
      // A successful silent watch refresh also clears a pending stale hint;
      // otherwise the footer would keep warning after the results updated.
      state.stale = false;

      if (!state.filter || (state.filter !== 'all' && !CATEGORY_META[state.filter])) {
        state.filter = DEFAULT_FILTER;
      }

      state.phase = links.length ? 'ready' : 'empty';
      state.watch.lastError = '';
      duplicateByKey(links);

      if (watchSignature !== null) state.watch.signature = watchSignature;

      if (silent) {
        var nextUrls = links.map(function (entry) { return entry.url; }).join('\n');
        if (nextUrls !== previousUrls) {
          announce(links.length
            ? 'The page changed. ' + links.length + (links.length === 1 ? ' link found.' : ' links found.')
            : 'The page changed. No YouTube links found.');
        }
      } else {
        announce(links.length
          ? links.length + (links.length === 1 ? ' link found.' : ' links found.')
          : 'No YouTube links found on this page.');
      }

      succeeded = true;
    } catch (error) {
      if (!(error instanceof ScanError)) {
        console.error('[Clipfox] Scan failed:', error);
      }
      var info = describeScanError(error);

      if (silent && hadResults) {
        // Watch mode preserves the last good results when a transient refresh
        // fails. The footer explains the failure and a later tick retries.
        state.watch.lastError = info.footer || info.message;
        state.watch.nextAttemptAt = Date.now() + 10000;
        state.stale = true;
      } else {
        state.links = [];
        state.stats = null;
        state.scanMs = 0;
        state.error = info;
        state.phase = info.restricted ? 'restricted' : 'error';
        duplicateByKey([]);
        stopWatch(true);
        announce(info.title + '. ' + info.message);
      }
    } finally {
      state.busy = false;
      renderAll();
      applyBadge();
    }

    if (!silent && succeeded && state.settings.autoWatch &&
        !state.watch.enabled && !state.watch.autoApplied) {
      state.watch.autoApplied = true;
      startWatch(true);
    }

    return succeeded;
  }

  function duplicateByKey(links) {
    byKey = new Map();
    for (var i = 0; i < links.length; i++) {
      byKey.set(links[i].key, links[i]);
    }
  }

  function withTimeout(promise, milliseconds) {
    return new Promise(function (resolve, reject) {
      var settled = false;
      var timer = setTimeout(function () {
        if (settled) return;
        settled = true;
        reject(new ScanError('TIMEOUT', 'The scan timed out.',
          'The page took too long to read. Reload it and try again.'));
      }, milliseconds);

      promise.then(function (value) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      }, function (error) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      });
    });
  }

  function normalizeLink(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var category = CATEGORY_META[raw.category] ? raw.category : 'other';
    var url = typeof raw.url === 'string' ? raw.url : '';
    if (!isYouTubeHttpUrl(url)) return null;
    var title = typeof raw.title === 'string' ? raw.title.trim().slice(0, 300) : '';
    return {
      key: typeof raw.key === 'string' && raw.key ? raw.key : url,
      url: url,
      title: title || CATEGORY_META[category].fallbackTitle,
      category: category,
      source: typeof raw.source === 'string' ? raw.source : 'page',
      embedOrder: typeof raw.embedOrder === 'number' ? raw.embedOrder : null,
      isMain: false
    };
  }

  // Pin the first embedded video to the top. On pages like Udvash's class
  // player, the embed is the media the user is actually watching, while the
  // surrounding page can contain many unrelated YouTube links.
  function markMainVideo(links) {
    var mainIndex = -1;
    var bestOrder = Infinity;
    for (var i = 0; i < links.length; i++) {
      if (links[i].source !== 'embed' || !VIDEO_CATEGORIES[links[i].category]) continue;
      var order = typeof links[i].embedOrder === 'number' ? links[i].embedOrder : Infinity;
      if (mainIndex < 0 || order < bestOrder) {
        bestOrder = order;
        mainIndex = i;
      }
    }
    if (mainIndex < 0) return links;

    for (var j = 0; j < links.length; j++) links[j].isMain = false;
    var main = links.splice(mainIndex, 1)[0];
    main.isMain = true;
    links.unshift(main);
    return links;
  }

  function describeRestrictedUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') return null;

    var url;
    try {
      url = new URL(rawUrl);
    } catch (error) {
      return null;
    }

    var protocol = url.protocol.toLowerCase();
    if (protocol !== 'http:' && protocol !== 'https:' && protocol !== 'file:') {
      return {
        title: 'This page can\'t be read',
        message: 'Browser settings, the New Tab page, extension pages, and other protected browser screens cannot be scanned. Open a regular website and try again.',
        footer: 'This page is protected by the browser.'
      };
    }

    var hostname = url.hostname.toLowerCase();
    if (hostname === 'chromewebstore.google.com' ||
        (hostname === 'chrome.google.com' && /^\/webstore(?:\/|$)/i.test(url.pathname))) {
      return {
        title: 'The extension store is protected',
        message: 'Chrome Web Store pages block extension scripts. Open a regular website to extract links.',
        footer: 'The Chrome Web Store blocks extension scripts.'
      };
    }
    if (hostname === 'microsoftedge.microsoft.com' && /^\/addons(?:\/|$)/i.test(url.pathname)) {
      return {
        title: 'The add-on store is protected',
        message: 'Microsoft Edge Add-ons pages block extension scripts. Open a regular website to extract links.',
        footer: 'Edge Add-ons blocks extension scripts.'
      };
    }
    if (/\.pdf$/i.test(url.pathname)) {
      return {
        title: 'PDF pages can\'t be scanned',
        message: 'The built-in PDF viewer does not expose a normal webpage to extensions. Try a standard HTML page instead.',
        footer: 'The PDF viewer is not accessible.'
      };
    }

    return null;
  }

  function describeScanError(error) {
    if (error && error instanceof ScanError) {
      if (error.code === 'RESTRICTED' && error.details) {
        return {
          title: error.details.title,
          message: error.details.message,
          footer: error.details.footer,
          restricted: true,
          retryable: false,
          tone: 'warning'
        };
      }
      if (error.code === 'TIMEOUT') {
        return {
          title: 'The scan timed out',
          message: error.details || 'The page took too long to read. Reload it and try again.',
          footer: 'The page took too long to read.',
          restricted: false,
          retryable: true,
          tone: 'error'
        };
      }
      if (error.code === 'NO_TAB' || error.code === 'ENV' || error.code === 'SCANNER_MISSING') {
        return {
          title: 'The page could not be reached',
          message: error.details || 'Open a normal website tab and try again.',
          footer: error.message,
          restricted: false,
          retryable: true,
          tone: 'error'
        };
      }
    }

    var message = error && error.message ? String(error.message) : '';
    if (message) console.error('[Clipfox] Scan error:', message);

    if (/^file:/i.test(state.pageUrl) &&
        /cannot access contents|missing host permission|must request permission|cannot be scripted/i.test(message)) {
      return {
        title: 'Local files are protected',
        message: 'Enable "Allow access to file URLs" for Clipfox on the extensions page, reload the file, then rescan.',
        footer: 'Local file access is turned off.',
        restricted: true,
        retryable: true,
        tone: 'warning'
      };
    }

    var byUrl = describeRestrictedUrl(state.pageUrl);
    if (byUrl) {
      return {
        title: byUrl.title,
        message: byUrl.message,
        footer: byUrl.footer,
        restricted: true,
        retryable: false,
        tone: 'warning'
      };
    }

    if (/extensions gallery cannot be scripted|webstore|edge add-ons/i.test(message)) {
      return {
        title: 'This page is protected',
        message: 'Extension galleries block extension scripts. Open a regular website to extract links.',
        footer: 'The browser store blocks extension scripts.',
        restricted: true,
        retryable: false,
        tone: 'warning'
      };
    }
    if (/cannot access contents|cannot access a chrome|missing host permission|must request permission|cannot be scripted/i.test(message)) {
      return {
        title: 'The page can\'t be accessed',
        message: 'The browser did not allow this extension to read the page. Reload the tab, then try scanning again.',
        footer: 'Access to this page was denied.',
        restricted: true,
        retryable: true,
        tone: 'warning'
      };
    }
    if (/no tab with id|tab was closed|invalid tab id/i.test(message)) {
      return {
        title: 'The tab is no longer available',
        message: 'The active tab was closed or replaced. Open the page again and reopen this popup.',
        footer: 'The active tab is no longer available.',
        restricted: false,
        retryable: false,
        tone: 'error'
      };
    }
    if (/frame with id|no frame with id|navigated|removed from the document/i.test(message)) {
      return {
        title: 'The page changed while scanning',
        message: 'The page navigated or reloaded before the scan finished. Rescan to try again.',
        footer: 'The page changed during the scan.',
        restricted: false,
        retryable: true,
        tone: 'error'
      };
    }

    return {
      title: 'The scan didn\'t finish',
      message: 'The page could not be read. Reload the page and try again, or try another website.',
      footer: 'Scan failed. Try rescanning.',
      restricted: false,
      retryable: true,
      tone: 'error'
    };
  }

  // -------------------------------------------------------------------- render

  function renderAll() {
    updateHeader();
    updatePageStrip();
    updateSearchClear();
    renderFilters();
    renderControls();
    renderResults(false);
    updateFooterStatus();
  }

  function updateHeader() {
    var countText;
    var label = 'links';
    var aria;

    if (state.phase === 'idle') {
      countText = '0';
      aria = 'Not scanned yet';
    } else if (state.phase === 'loading') {
      countText = '\u2026';
      aria = 'Scanning for links';
    } else if (state.phase === 'error' || state.phase === 'restricted') {
      countText = '\u2014';
      aria = 'Links are unavailable';
    } else {
      countText = String(state.links.length);
      var truncated = state.stats && state.stats.truncated;
      if (truncated) countText += '+';
      if (state.links.length === 1) label = 'link';
      aria = countText + ' ' + (state.links.length === 1 ? 'link' : 'links') + ' detected';
      if (truncated) aria += ' (results capped)';
    }

    els.linkCount.textContent = countText;
    els.linkLabel.textContent = label;
    els.countBadge.classList.toggle('is-scanning', state.phase === 'loading');
    els.countBadge.setAttribute('aria-label', aria);
    els.countBadge.title = aria;
  }

  function getPageLabel() {
    if (!state.pageUrl) return state.phase === 'restricted' ? 'Protected page' : 'Current tab';
    try {
      var url = new URL(state.pageUrl);
      if (url.protocol === 'http:' || url.protocol === 'https:') {
        return url.hostname.replace(/^www\./i, '');
      }
      if (url.protocol === 'file:') return 'Local file';
      if (state.phase === 'restricted') return 'Protected page';
      if (url.protocol === 'chrome:' || url.protocol === 'edge:') return 'Browser page';
      if (url.protocol === 'chrome-extension:' || url.protocol === 'edge-extension:') return 'Extension page';
      return url.protocol.replace(/:$/, '') + ' page';
    } catch (error) {
      return 'Current tab';
    }
  }

  function updatePageStrip() {
    els.pageHost.textContent = getPageLabel();
    els.pageHost.title = state.pageUrl || 'Current tab';

    var timeText = 'Ready';
    if (state.phase === 'loading') timeText = 'Scanning\u2026';
    else if (state.phase === 'restricted') timeText = 'Blocked';
    else if (state.phase === 'error') timeText = 'Failed';
    else if (state.phase === 'ready' || state.phase === 'empty') {
      timeText = state.scanMs ? state.scanMs + ' ms' : 'Done';
    }
    els.scanTime.textContent = timeText;
  }

  function renderFilters() {
    if (!state.links.length || (state.phase !== 'ready' && state.phase !== 'empty')) {
      els.filters.hidden = true;
      els.filters.replaceChildren();
      return;
    }

    var counts = countByFilter();
    var focusedFilter = document.activeElement && document.activeElement.getAttribute
      ? document.activeElement.getAttribute('data-filter')
      : null;

    var fragment = document.createDocumentFragment();
    fragment.appendChild(createFilterChip('all', 'All', state.links.length, 'All links'));
    for (var i = 0; i < FILTER_ORDER.length; i++) {
      var filter = FILTER_ORDER[i];
      if (!counts[filter] && state.filter !== filter) continue;
      var label = CATEGORY_META[filter].filterLabel;
      fragment.appendChild(createFilterChip(
        filter,
        label,
        counts[filter],
        filter === 'other' ? 'Other YouTube links' : label
      ));
    }

    els.filters.replaceChildren(fragment);
    els.filters.hidden = false;
    syncFilterPressed();

    if (focusedFilter) {
      var match = els.filters.querySelector('button[data-filter="' + focusedFilter + '"]');
      if (match) match.focus({ preventScroll: true });
    }
  }

  function createFilterChip(id, label, count, ariaLabel) {
    var chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.setAttribute('data-filter', id);
    chip.setAttribute('aria-label', ariaLabel + ', ' + count + (count === 1 ? ' link' : ' links'));
    chip.setAttribute('aria-pressed', 'false');

    var text = document.createElement('span');
    text.textContent = label;
    var badge = document.createElement('span');
    badge.className = 'chip-count';
    badge.textContent = String(count);

    chip.appendChild(text);
    chip.appendChild(badge);
    return chip;
  }

  function syncFilterPressed() {
    var chips = els.filters.querySelectorAll('button[data-filter]');
    for (var i = 0; i < chips.length; i++) {
      chips[i].setAttribute('aria-pressed', chips[i].getAttribute('data-filter') === state.filter ? 'true' : 'false');
    }
  }

  function setFilter(filter) {
    if (!filter || (filter !== 'all' && !CATEGORY_META[filter])) return;
    if (state.filter === filter) return;
    state.filter = filter;
    state.renderLimit = RENDER_BATCH;
    syncFilterPressed();
    renderResults(true);
    renderControls();
    updateFooterStatus();
    announce(visibleSummary());
  }

  function clearSearch() {
    state.query = '';
    state.renderLimit = RENDER_BATCH;
    if (els.search.value) els.search.value = '';
    updateSearchClear();
    renderResults(true);
    renderControls();
    updateFooterStatus();
    announce(visibleSummary());
  }

  function clearFilters() {
    state.query = '';
    state.filter = state.settings.defaultFilter;
    state.renderLimit = RENDER_BATCH;
    if (els.search.value) els.search.value = '';
    updateSearchClear();
    syncFilterPressed();
    renderResults(true);
    renderControls();
    updateFooterStatus();
    els.search.focus();
    announce(visibleSummary());
  }

  function updateSearchClear() {
    els.searchClear.hidden = !els.search.value;
  }

  function getVisibleLinks() {
    var query = state.query.trim().toLowerCase();
    var filtered = state.links;

    if (state.filter !== 'all') {
      filtered = filtered.filter(function (link) {
        return filterMatches(link.category, state.filter);
      });
    }
    if (query) {
      filtered = filtered.filter(function (link) {
        return link.title.toLowerCase().indexOf(query) !== -1 ||
          link.url.toLowerCase().indexOf(query) !== -1;
      });
    }
    return filtered;
  }

  function filterMatches(category, filter) {
    if (filter === 'video') return !!VIDEO_CATEGORIES[category];
    return category === filter;
  }

  function countByFilter() {
    var counts = { all: state.links.length };
    for (var i = 0; i < FILTER_ORDER.length; i++) counts[FILTER_ORDER[i]] = 0;
    for (var j = 0; j < state.links.length; j++) {
      var category = state.links[j].category;
      if (VIDEO_CATEGORIES[category]) counts.video++;
      else if (counts[category] !== undefined) counts[category]++;
    }
    return counts;
  }

  function renderControls() {
    var visible = getVisibleLinks();
    var filtering = state.query.trim() !== '' ||
      (state.filter !== 'all' && visible.length !== state.links.length);
    var noLinks = visible.length === 0;
    var copyable = state.copyFormat === 'ids' ? hasVideoIds(visible) : !noLinks;
    var formatLabel = COPY_FORMATS[state.copyFormat].label;

    // The scan call-to-action lives in the middle of the popup until the
    // first scan, so the search and action row stay out of the way.
    els.controls.hidden = state.phase !== 'loading' &&
      state.phase !== 'ready' &&
      state.phase !== 'empty';

    els.rescan.disabled = state.busy;
    els.rescan.classList.toggle('is-busy', state.busy);
    els.watch.disabled = state.busy;
    renderWatchState();

    els.copyAll.disabled = state.busy || state.copying || !copyable;
    els.copyFormat.disabled = state.busy || noLinks;
    els.export.disabled = state.busy || !copyable;

    if (state.copying) {
      els.copyAllLabel.textContent = 'Copying\u2026';
    } else if (filtering && !noLinks) {
      els.copyAllLabel.textContent = 'Copy ' + visible.length;
    } else {
      els.copyAllLabel.textContent = 'Copy all';
    }

    if (!copyable) {
      els.copyAll.title = state.copyFormat === 'ids'
        ? 'No video IDs in this selection'
        : 'No links to copy';
    } else if (filtering) {
      els.copyAll.title = 'Copy the ' + visible.length + ' matching ' +
        (visible.length === 1 ? 'link' : 'links') + ' currently shown as ' + formatLabel;
    } else {
      els.copyAll.title = 'Copy all ' + visible.length + ' ' +
        (visible.length === 1 ? 'link' : 'links') + ' as ' + formatLabel;
    }

    if (!copyable && state.copyFormat === 'ids') {
      els.export.title = 'No video IDs in this selection';
    } else if (!copyable) {
      els.export.title = 'No links to export';
    } else {
      els.export.title = 'Download the current results as ' + formatLabel;
    }
  }

  function renderResults(resetScroll) {
    var visible = getVisibleLinks();
    var loading = state.phase === 'loading';

    loadingPanel.hidden = !loading;
    els.loadMoreWrap.hidden = true;
    els.statePanel.hidden = true;

    if (loading) {
      els.results.hidden = true;
      els.results.replaceChildren();
      els.resultsArea.setAttribute('aria-busy', 'true');
      if (resetScroll) els.resultsScroll.scrollTop = 0;
      return;
    }

    els.resultsArea.setAttribute('aria-busy', 'false');

    if (state.phase === 'idle') {
      els.results.hidden = true;
      els.results.replaceChildren();
      showState({
        icon: 'search',
        tone: 'default',
        title: 'Find YouTube links on this page',
        message: 'Click Scan this page. The extension reads the current tab and lists YouTube videos, Shorts, live streams, playlists, and channels.',
        actionLabel: 'Scan this page',
        action: 'scan',
        primary: true
      });
      return;
    }

    if (state.phase === 'error' || state.phase === 'restricted') {
      els.results.hidden = true;
      els.results.replaceChildren();
      showState({
        icon: state.phase === 'restricted' ? 'lock' : 'alert',
        tone: state.error && state.error.tone === 'error' ? 'error' : 'warning',
        title: state.error ? state.error.title : 'The scan didn\'t finish',
        message: state.error ? state.error.message : 'Reload the page and try again.',
        actionLabel: state.error && state.error.retryable === false ? '' : 'Try again',
        action: 'rescan',
        diagnostics: true
      });
      return;
    }

    if (state.phase === 'empty') {
      els.results.hidden = true;
      els.results.replaceChildren();
      showState({
        icon: 'empty',
        tone: 'default',
        title: 'No YouTube links found on this page.',
        message: 'Try another website or rescan the page.',
        actionLabel: 'Rescan page',
        action: 'rescan'
      });
      return;
    }

    if (!visible.length) {
      els.results.hidden = true;
      els.results.replaceChildren();
      if (!state.links.length) {
        showState({
          icon: 'empty',
          tone: 'default',
          title: 'No YouTube links found on this page.',
          message: 'Try another website or rescan the page.',
          actionLabel: 'Rescan page',
          action: 'rescan'
        });
        return;
      }

      if (state.query.trim()) {
        showState({
          icon: 'search',
          tone: 'default',
          title: state.filter === 'video' ? 'No matching videos' : 'No matching links',
          message: 'Try a different search, or clear it to see every extracted link.',
          actionLabel: 'Clear search',
          action: 'clear'
        });
        return;
      }

      if (state.filter === 'video') {
        showState({
          icon: 'empty',
          tone: 'default',
          title: 'No video links found',
          message: 'This page has ' + state.links.length + ' other YouTube ' +
            (state.links.length === 1 ? 'link' : 'links') +
            ' (channels, playlists, or pages), but no playable video links.',
          actionLabel: 'Show all links',
          action: 'show-all'
        });
        return;
      }

      if (state.filter !== 'all') {
        var filterLabel = state.filter === 'other'
          ? 'other links'
          : CATEGORY_META[state.filter].filterLabel.toLowerCase();
        showState({
          icon: 'empty',
          tone: 'default',
          title: 'No ' + filterLabel + ' found',
          message: 'This page has ' + state.links.length + ' YouTube ' +
            (state.links.length === 1 ? 'link' : 'links') + ' in other categories.',
          actionLabel: 'Show all links',
          action: 'show-all'
        });
        return;
      }

      showState({
        icon: 'search',
        tone: 'default',
        title: 'No matching links',
        message: 'Try a different search, or clear the filters to see every extracted link.',
        actionLabel: 'Clear filters',
        action: 'clear'
      });
      return;
    }

    var slice = visible.slice(0, state.renderLimit);
    var fragment = document.createDocumentFragment();
    for (var i = 0; i < slice.length; i++) {
      fragment.appendChild(createResultCard(slice[i]));
    }

    els.statePanel.hidden = true;
    els.results.hidden = false;
    els.results.replaceChildren(fragment);

    var remaining = visible.length - slice.length;
    if (remaining > 0) {
      els.loadMoreWrap.hidden = false;
      els.loadMore.textContent = 'Show ' + Math.min(RENDER_BATCH, remaining) + ' more';
      els.renderSummary.textContent = 'Showing ' + slice.length + ' of ' + visible.length +
        ' ' + (visible.length === 1 ? 'match' : 'matches');
    }

    if (resetScroll) els.resultsScroll.scrollTop = 0;
  }

  function createResultCard(link) {
    var card = document.createElement('article');
    card.className = 'result' + (link.isMain ? ' is-main' : '');
    card.setAttribute('role', 'listitem');
    card.setAttribute('data-category', link.category);
    if (link.isMain) card.setAttribute('data-main', 'true');

    var main = document.createElement('div');
    main.className = 'result-main';

    var meta = document.createElement('div');
    meta.className = 'result-meta';

    var pill = document.createElement('span');
    pill.className = 'category-pill';
    pill.textContent = CATEGORY_META[link.category].label;

    if (link.isMain) {
      var mainPill = document.createElement('span');
      mainPill.className = 'main-pill';
      mainPill.textContent = 'Main';
      mainPill.title = 'Detected from the embedded player on this page';
      meta.appendChild(mainPill);
    }

    var title = document.createElement('h2');
    title.className = 'result-title';
    title.textContent = link.title;
    title.title = link.title;

    var anchor = document.createElement('a');
    anchor.className = 'result-url';
    anchor.href = link.url;
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
    anchor.textContent = link.url;
    anchor.title = link.url;
    anchor.setAttribute('aria-label', 'Open ' + link.url + ' in a new tab');

    meta.appendChild(pill);
    main.appendChild(meta);
    main.appendChild(title);
    main.appendChild(anchor);

    var actions = document.createElement('div');
    actions.className = 'result-actions';

    var copyButton = document.createElement('button');
    copyButton.type = 'button';
    copyButton.className = 'icon-btn';
    copyButton.setAttribute('data-action', 'copy');
    copyButton.setAttribute('data-key', link.key);
    copyButton.setAttribute('aria-label', 'Copy link: ' + link.title);
    copyButton.title = 'Copy link';
    copyButton.appendChild(makeIcon('copy', 'icon-default', 14));
    copyButton.appendChild(makeIcon('check', 'icon-success', 14));

    actions.appendChild(copyButton);

    var videoId = getVideoId(link);
    if (videoId) {
      var idButton = document.createElement('button');
      idButton.type = 'button';
      idButton.className = 'icon-btn';
      idButton.setAttribute('data-action', 'copy-id');
      idButton.setAttribute('data-key', link.key);
      idButton.setAttribute('aria-label', 'Copy video ID ' + videoId + ' for ' + link.title);
      idButton.title = 'Copy video ID (' + videoId + ')';
      idButton.appendChild(makeIcon('hash', 'icon-default', 14));
      idButton.appendChild(makeIcon('check', 'icon-success', 14));
      actions.appendChild(idButton);
    }

    var openButton = document.createElement('button');
    openButton.type = 'button';
    openButton.className = 'icon-btn';
    openButton.setAttribute('data-action', 'open');
    openButton.setAttribute('data-key', link.key);
    openButton.setAttribute('aria-label', 'Open ' + link.title + ' in a new tab');
    openButton.title = 'Open in new tab';
    openButton.appendChild(makeIcon('external', '', 14));
    actions.appendChild(openButton);

    card.appendChild(main);
    card.appendChild(actions);
    return card;
  }

  function showState(options) {
    els.statePanel.hidden = false;
    els.statePanel.setAttribute('data-tone', options.tone || 'default');
    els.stateIcon.replaceChildren(makeIcon(options.icon, '', 26));
    els.stateTitle.textContent = options.title;
    els.stateMessage.textContent = options.message;

    stateAction = options.action || 'rescan';
    els.stateAction.className = 'btn state-action ' + (options.primary ? 'btn-primary' : 'btn-secondary');
    els.stateAction.hidden = !options.actionLabel;
    els.stateAction.textContent = options.actionLabel || '';
    els.stateDiagnostics.hidden = options.diagnostics !== true;
  }

  function updateFooterStatus() {
    var tone = 'idle';
    var text = 'Ready. Click Scan this page to find YouTube links.';

    if (state.phase === 'loading') {
      tone = 'scanning';
      text = 'Scanning the current page\u2026';
    } else if (state.phase === 'restricted') {
      tone = 'warning';
      text = state.error && state.error.footer ? state.error.footer : 'This page cannot be read by the extension.';
    } else if (state.phase === 'error') {
      tone = 'error';
      text = state.error && state.error.footer ? state.error.footer : 'Scan failed. Try again.';
    } else if (state.phase === 'empty') {
      tone = 'warning';
      text = 'No YouTube links found on this page.';
    } else if (state.phase === 'ready') {
      tone = 'ok';
      var visible = getVisibleLinks();
      var filtering = state.query.trim() !== '' ||
        (state.filter !== 'all' && visible.length !== state.links.length);

      if (state.stale) {
        tone = 'warning';
        text = 'The page changed since this scan. Rescan to refresh.';
      } else if (filtering) {
        if (state.filter === 'video' && !state.query.trim() && !visible.length) {
          tone = 'warning';
          text = 'No video links found \u00b7 ' + state.links.length + ' other ' +
            (state.links.length === 1 ? 'link' : 'links') + ' on this page.';
        } else {
          text = visible.length + ' of ' + state.links.length + ' links shown.';
          if (state.filter === 'video' && !state.query.trim()) text += ' Videos only.';
        }
      } else if (state.stats && state.stats.truncated) {
        var detected = state.stats.unique || state.stats.detected || state.links.length;
        text = 'Scan complete \u00b7 showing ' + state.links.length + ' of ' + detected + ' detected links.';
      } else {
        text = 'Scan complete \u00b7 ' + state.links.length + ' unique ' +
          (state.links.length === 1 ? 'link' : 'links') + ' in ' + state.scanMs + ' ms.';
      }
    }

    if (state.watch.enabled && (state.phase === 'ready' || state.phase === 'empty')) {
      if (state.watch.lastError) {
        tone = 'warning';
        text = 'Watch paused \u00b7 ' + state.watch.lastError;
      } else {
        text = 'Watching \u00b7 ' + text;
      }
    }

    els.footerStatus.textContent = text;
    els.footerStatus.title = text;
    els.statusDot.setAttribute('data-tone', tone);
  }

  // ---------------------------------------------------------------- clipboard

  async function copyOne(link, button) {
    try {
      await copyText(link.url);
      button.classList.add('is-copied');
      button.setAttribute('aria-label', 'Copied: ' + link.title);
      window.setTimeout(function () {
        button.classList.remove('is-copied');
        button.setAttribute('aria-label', 'Copy link: ' + link.title);
      }, 1500);
      showToast('Link copied', 'success');
    } catch (error) {
      console.error('[Clipfox] Copy failed:', error);
      showToast('Couldn\'t copy the link', 'error');
    }
  }

  async function copyAll() {
    if (state.busy || state.copying) return;
    var visible = getVisibleLinks();
    if (!visible.length) {
      showToast('There are no links to copy', 'error');
      return;
    }

    var text = formatLinks(visible, state.copyFormat);
    if (!text) {
      showToast('No video IDs in this selection', 'error');
      return;
    }

    state.copying = true;
    renderControls();

    try {
      await copyText(text);
      var format = COPY_FORMATS[state.copyFormat];
      var count = state.copyFormat === 'ids' ? countVideoIds(visible) : visible.length;
      var filtering = state.query.trim() !== '' ||
        (state.filter !== 'all' && visible.length !== state.links.length);
      var message = filtering
        ? 'Copied ' + count + ' filtered ' + format.noun
        : 'Copied ' + count + ' ' + format.noun;
      showToast(message, 'success');
      announce(message + '.');
    } catch (error) {
      console.error('[Clipfox] Copy all failed:', error);
      showToast('Couldn\'t access the clipboard', 'error');
    } finally {
      state.copying = false;
      renderControls();
    }
  }

  async function copyVideoId(link, button) {
    var videoId = getVideoId(link);
    if (!videoId) {
      showToast('This result has no video ID', 'error');
      return;
    }

    try {
      await copyText(videoId);
      button.classList.add('is-copied');
      button.setAttribute('aria-label', 'Copied video ID ' + videoId);
      window.setTimeout(function () {
        button.classList.remove('is-copied');
        button.setAttribute('aria-label', 'Copy video ID ' + videoId + ' for ' + link.title);
      }, 1500);
      showToast('Video ID copied', 'success');
    } catch (error) {
      console.error('[Clipfox] Copy ID failed:', error);
      showToast('Couldn\'t copy the video ID', 'error');
    }
  }

  async function exportLinks() {
    var visible = getVisibleLinks();
    if (!visible.length) {
      showToast('There are no links to export', 'error');
      return;
    }

    var text = formatLinks(visible, state.copyFormat);
    if (!text) {
      showToast('No video IDs in this selection', 'error');
      return;
    }

    var format = COPY_FORMATS[state.copyFormat];
    var count = state.copyFormat === 'ids' ? countVideoIds(visible) : visible.length;
    var filename = buildExportName(format.extension);
    try {
      downloadText(text, filename, format.mime);
      showToast('Exported ' + count + ' ' + format.noun, 'success');
      announce('Exported ' + count + ' ' + format.noun + ' to ' + filename + '.');
    } catch (error) {
      console.error('[Clipfox] Export failed:', error);
      showToast('Couldn\'t create the export file', 'error');
    }
  }

  function formatLinks(links, format) {
    if (!links || !links.length) return '';
    var i;
    if (format === 'ids') {
      var ids = [];
      for (i = 0; i < links.length; i++) {
        var id = getVideoId(links[i]);
        if (id) ids.push(id);
      }
      return ids.join('\n');
    }
    if (format === 'title-url') {
      return links.map(function (link) {
        return link.title + ' \u2014 ' + link.url;
      }).join('\n');
    }
    if (format === 'markdown') {
      return links.map(function (link) {
        return '- [' + escapeMarkdown(link.title) + '](' + escapeMarkdownUrl(link.url) + ')';
      }).join('\n');
    }
    if (format === 'csv') {
      var rows = ['Title,URL,Category'];
      for (i = 0; i < links.length; i++) {
        rows.push(csvCell(links[i].title) + ',' + csvCell(links[i].url) + ',' + csvCell(links[i].category));
      }
      return rows.join('\r\n');
    }
    if (format === 'json') {
      return JSON.stringify(links.map(function (link) {
        return {
          title: link.title,
          url: link.url,
          category: link.category,
          main: !!link.isMain
        };
      }), null, 2);
    }
    return links.map(function (link) { return link.url; }).join('\n');
  }

  function csvCell(value) {
    var text = String(value === null || value === undefined ? '' : value);
    if (/[",\r\n]/.test(text)) return '"' + text.replace(/"/g, '""') + '"';
    return text;
  }

  function escapeMarkdown(value) {
    return String(value).replace(/([\[\]\\])/g, '\\$1');
  }

  function escapeMarkdownUrl(value) {
    return String(value).replace(/\)/g, '%29').replace(/\s/g, '%20');
  }

  function countVideoIds(links) {
    var count = 0;
    for (var i = 0; i < links.length; i++) {
      if (getVideoId(links[i])) count++;
    }
    return count;
  }

  function hasVideoIds(links) {
    return countVideoIds(links) > 0;
  }

  function getVideoId(link) {
    if (!link || !VIDEO_CATEGORIES[link.category]) return '';
    var keyMatch = /^v:([A-Za-z0-9_-]{11})$/.exec(String(link.key || ''));
    if (keyMatch) return keyMatch[1];

    try {
      var url = new URL(link.url);
      var segments = url.pathname.split('/').filter(Boolean);
      if (url.hostname === 'youtu.be' && segments[0] && /^[A-Za-z0-9_-]{11}$/.test(segments[0])) {
        return segments[0];
      }
      if (/^\/watch$/i.test(url.pathname)) {
        var watchId = url.searchParams.get('v') || '';
        return /^[A-Za-z0-9_-]{11}$/.test(watchId) ? watchId : '';
      }
      if (/^\/(?:shorts|live|embed|v)\//i.test(url.pathname)) {
        var pathId = segments[1] || '';
        return /^[A-Za-z0-9_-]{11}$/.test(pathId) ? pathId : '';
      }
    } catch (error) {
      return '';
    }
    return '';
  }

  function buildExportName(extension) {
    var host = '';
    try {
      if (state.pageUrl) {
        var url = new URL(state.pageUrl);
        if (url.hostname) host = url.hostname.replace(/^www\./i, '');
      }
    } catch (error) {
      host = '';
    }
    host = host.toLowerCase().replace(/[^a-z0-9.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
    var date = new Date();
    var stamp = date.getFullYear() + '-' +
      String(date.getMonth() + 1).padStart(2, '0') + '-' +
      String(date.getDate()).padStart(2, '0');
    return (host ? host + '-clipfox' : 'clipfox') + '-' + stamp + '.' + extension;
  }

  function downloadText(text, filename, mimeType) {
    var blob = new Blob([text], { type: mimeType + ';charset=utf-8' });
    var objectUrl = URL.createObjectURL(blob);
    var anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = filename;
    anchor.rel = 'noopener';
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(function () {
      URL.revokeObjectURL(objectUrl);
    }, 4000);
  }

  async function copyText(text) {
    if (!text) throw new Error('Nothing to copy');

    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function' && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(text);
        return;
      } catch (error) {
        // Fall through to the legacy clipboard path.
      }
    }

    var area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.setAttribute('aria-hidden', 'true');
    area.style.position = 'fixed';
    area.style.top = '-1000px';
    area.style.left = '-1000px';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    area.setSelectionRange(0, area.value.length);

    var copied = false;
    try {
      copied = document.execCommand('copy');
    } catch (error) {
      copied = false;
    }
    area.remove();
    if (!copied) throw new Error('Clipboard write failed');
  }

  function openOne(link) {
    if (!isYouTubeHttpUrl(link.url)) {
      showToast('That is not a valid YouTube URL', 'error');
      return;
    }
    try {
      var result = chrome.tabs.create({ url: link.url });
      if (result && typeof result.catch === 'function') {
        result.catch(function (error) {
          console.error('[Clipfox] Open failed:', error);
          showToast('Couldn\'t open the link', 'error');
        });
      }
    } catch (error) {
      console.error('[Clipfox] Open failed:', error);
      showToast('Couldn\'t open the link', 'error');
    }
  }

  // --------------------------------------------------------- diagnostics/settings

  function buildDiagnostics() {
    var manifest = {};
    try {
      if (globalThis.chrome && chrome.runtime && chrome.runtime.getManifest) {
        manifest = chrome.runtime.getManifest() || {};
      }
    } catch (error) {
      manifest = {};
    }

    return JSON.stringify({
      extension: 'Clipfox',
      version: manifest.version || 'unknown',
      scannerVersion: globalThis.YTExtractor && globalThis.YTExtractor.version
        ? globalThis.YTExtractor.version
        : 'unknown',
      generatedAt: new Date().toISOString(),
      page: {
        url: state.pageUrl || '',
        title: state.pageTitle || '',
        label: getPageLabel()
      },
      scan: {
        phase: state.phase,
        links: state.links.length,
        scanMs: state.scanMs,
        stale: state.stale,
        stats: state.stats,
        error: state.error
      },
      watch: {
        enabled: state.watch.enabled,
        lastError: state.watch.lastError || ''
      },
      settings: state.settings,
      browser: typeof navigator !== 'undefined' ? navigator.userAgent : ''
    }, null, 2);
  }

  async function copyDiagnostics() {
    try {
      await copyText(buildDiagnostics());
      showToast('Diagnostics copied', 'success');
      announce('Diagnostic information copied to the clipboard.');
    } catch (error) {
      console.error('[Clipfox] Copy diagnostics failed:', error);
      showToast('Couldn\'t copy diagnostics', 'error');
    }
  }

  function openOptions() {
    try {
      if (globalThis.chrome && chrome.runtime && typeof chrome.runtime.openOptionsPage === 'function') {
        var result = chrome.runtime.openOptionsPage();
        if (result && typeof result.catch === 'function') {
          result.catch(function (error) {
            console.error('[Clipfox] Could not open settings:', error);
            showToast('Couldn\'t open settings', 'error');
          });
        }
        return;
      }
      var url = globalThis.chrome && chrome.runtime && chrome.runtime.getURL
        ? chrome.runtime.getURL('options.html')
        : 'options.html';
      window.open(url, '_blank', 'noopener');
    } catch (error) {
      console.error('[Clipfox] Could not open settings:', error);
      showToast('Couldn\'t open settings', 'error');
    }
  }

  function badgingAvailable() {
    return !!(globalThis.chrome && chrome.action &&
      typeof chrome.action.setBadgeText === 'function');
  }

  function ensureBadgeColor() {
    if (badgeColorSet || !badgingAvailable()) return;
    badgeColorSet = true;
    try {
      if (chrome.action.setBadgeBackgroundColor) {
        var result = chrome.action.setBadgeBackgroundColor({ color: '#6f5df0' });
        if (result && typeof result.catch === 'function') result.catch(function () {});
      }
    } catch (error) {
      // The badge is a convenience; never let it break the popup.
    }
  }

  function applyBadge() {
    if (!badgingAvailable() || typeof state.tabId !== 'number') return;

    var show = state.settings.showBadge === true;
    var mode = state.settings.badgeCountMode;
    var text = '';
    if (show && (state.phase === 'ready' || state.phase === 'empty')) {
      var count = mode === 'video'
        ? state.links.filter(function (link) { return !!VIDEO_CATEGORIES[link.category]; }).length
        : state.links.length;
      text = count > 999 ? '999+' : String(count);
    }

    if (badgeMemo.tabId === state.tabId && badgeMemo.text === text &&
        badgeMemo.show === show && badgeMemo.mode === mode) {
      return;
    }
    badgeMemo = { tabId: state.tabId, text: text, show: show, mode: mode };
    ensureBadgeColor();

    try {
      var result = chrome.action.setBadgeText({ tabId: state.tabId, text: text });
      if (result && typeof result.catch === 'function') result.catch(function () {});
    } catch (error) {
      // Ignore transient badge failures (for example a closed tab).
    }
  }

  // ----------------------------------------------------------------- utilities

  function isYouTubeHttpUrl(raw) {
    try {
      var url = new URL(raw);
      if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
      var host = url.hostname.toLowerCase().replace(/\.$/, '');
      return hostMatches(host, 'youtube.com') ||
        hostMatches(host, 'youtu.be') ||
        hostMatches(host, 'youtube-nocookie.com');
    } catch (error) {
      return false;
    }
  }

  function hostMatches(host, base) {
    return host === base || host.slice(-(base.length + 1)) === '.' + base;
  }

  function makeIcon(name, className, size) {
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'icon' + (className ? ' ' + className : ''));
    svg.setAttribute('width', String(size));
    svg.setAttribute('height', String(size));
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    var use = document.createElementNS(SVG_NS, 'use');
    use.setAttribute('href', '#i-' + name);
    svg.appendChild(use);
    return svg;
  }

  function showToast(message, tone) {
    els.toastMessage.textContent = message;
    els.toast.setAttribute('data-tone', tone || 'success');
    els.toastIcon.replaceChildren(makeIcon(tone === 'error' ? 'alert' : 'check', '', 13));
    els.toast.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(function () {
      els.toast.classList.remove('is-visible');
    }, 2600);
  }

  function announce(message) {
    if (!message) return;
    els.announcer.textContent = '';
    window.setTimeout(function () {
      els.announcer.textContent = message;
    }, 30);
  }

  function visibleSummary() {
    var visible = getVisibleLinks();
    if (state.phase === 'ready' && state.links.length) {
      return visible.length + ' of ' + state.links.length + ' links shown.';
    }
    return '';
  }
})();
