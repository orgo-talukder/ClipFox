/* Popup UI harness: serves the real popup assets inside an iframe with mocked chrome APIs. */
(function () {
  'use strict';

  var params = new URLSearchParams(window.location.search);
  var requested = params.get('scenario') || 'default';
  var scenario = requested;

  var DEFAULT_FIXTURE = '<!doctype html><html><head><meta charset="utf-8"><title>Design inspiration links</title></head><body>' +
    '<h1>Design inspiration</h1>' +
    '<a href="https://www.youtube.com/watch?v=dQw4w9WgXcQ">Never Gonna Give You Up - Rick Astley (Official Video)</a>' +
    '<a href="https://www.youtube.com/shorts/aBcDeFgHiJk"><img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==" alt="A 45-second Short about CSS grid layouts"></a>' +
    '<a href="https://www.youtube.com/live/LiveStream1" aria-label="Lo-fi beats to relax to - live from the studio">Watch</a>' +
    '<a href="https://www.youtube.com/watch?v=LongTitle01" title="Designing a browser extension that feels native - a deliberately long title that needs two lines">A long-titled design talk</a>' +
    '<a href="https://www.youtube.com/watch?v=DesignVid01">Quick tip: normalize URLs before deduplicating them</a>' +
    '<a href="https://www.youtube.com/playlist?list=PLdesignplaylist123">The complete frontend engineering playlist (2026 edition)</a>' +
    '<a href="https://www.youtube.com/@Fireship">Fireship</a>' +
    '<a href="https://www.youtube.com/results?search_query=design+systems">YouTube search: design systems</a>' +
    '<iframe src="about:blank" data-src="https://www.youtube.com/embed/dQw4w9WgXcQ" title="Embedded duplicate"></iframe>' +
    '</body></html>';

  var EMPTY_FIXTURE = '<!doctype html><html><head><meta charset="utf-8"><title>Quiet page</title></head><body>' +
    '<h1>A page without video</h1><p>Nothing to extract here. There are no video links on this page.</p>' +
    '<a href="https://example.com/">An ordinary link</a>' +
    '<a href="https://vimeo.com/123456789">A video on another platform</a>' +
    '</body></html>';

  var NO_VIDEO_FIXTURE = '<!doctype html><html><head><meta charset="utf-8"><title>Channel page</title></head><body>' +
    '<h1>No playable videos here</h1>' +
    '<a href="https://www.youtube.com/@Fireship">Fireship</a>' +
    '<a href="https://www.youtube.com/playlist?list=PLnoVideoPlaylist1">A playlist without a video link</a>' +
    '<a href="https://www.youtube.com/results?search_query=design+systems">YouTube search: design systems</a>' +
    '</body></html>';

  var MAIN_VIDEO_FIXTURE = '<!doctype html><html><head><meta charset="utf-8"><title>Varsity class page</title></head><body>' +
    '<h1>Varsity KA Chemistry-07</h1>' +
    // The earlier anchor points at the *second* embed. The main video must
    // still be the first embedded player, not merely the first duplicate.
    '<a href="https://www.youtube.com/watch?v=SecondVid01">Recommended: part two</a>' +
    '<a href="https://www.youtube.com/playlist?list=PLclassroom01">Full course playlist</a>' +
    '<a href="https://www.youtube.com/@Udvash">Udvash channel</a>' +
    '<iframe src="about:blank" data-src="https://www.youtube.com/embed/MainClass01" title="VAP \'KA\'-2026_Marathon Live Class Chemistry-07 (Part-01)"></iframe>' +
    '<iframe src="about:blank" data-src="https://www.youtube.com/embed/SecondVid01" title="Second class player"></iframe>' +
    '</body></html>';

  var WATCH_FIXTURE_A = '<!doctype html><html><head><meta charset="utf-8"><title>Watching fixture A</title></head><body>' +
    '<h1>Watching fixture</h1>' +
    '<a href="https://www.youtube.com/watch?v=OtherVideo1">A related video</a>' +
    '<iframe src="about:blank" data-src="https://www.youtube.com/embed/WatchVid001" title="Live class part one"></iframe>' +
    '</body></html>';

  var WATCH_FIXTURE_B = '<!doctype html><html><head><meta charset="utf-8"><title>Watching fixture B</title></head><body>' +
    '<h1>Watching fixture</h1>' +
    '<a href="https://www.youtube.com/watch?v=OtherVideo1">A related video</a>' +
    '<iframe src="about:blank" data-src="https://www.youtube.com/embed/WatchVid002" title="Live class part two"></iframe>' +
    '</body></html>';

  var CACHE_BUST = '?v=' + Date.now();
  var LARGE_FIXTURE = (function () {
    var items = [];
    for (var i = 0; i < 240; i++) {
      var id = 'U' + String(i).padStart(10, '0');
      items.push('<a href="https://www.youtube.com/watch?v=' + id + '">Large result ' + (i + 1) +
        ' - a page with many links</a><br>');
    }
    return '<!doctype html><html><head><meta charset="utf-8"><title>Large page</title></head><body><h1>Large page</h1>' +
      items.join('') + '</body></html>';
  })();

  var scenarioDefs = {
    idle: {
      label: 'Ready - not scanned yet',
      tabUrl: 'https://news.example.com/design-inspiration',
      fixture: DEFAULT_FIXTURE
    },
    default: {
      label: 'Default - 8 links',
      tabUrl: 'https://news.example.com/design-inspiration',
      fixture: DEFAULT_FIXTURE
    },
    empty: {
      label: 'No links',
      tabUrl: 'https://news.example.com/quiet-page',
      fixture: EMPTY_FIXTURE
    },
    noVideo: {
      label: 'No videos - 3 other links',
      tabUrl: 'https://news.example.com/channel-page',
      fixture: NO_VIDEO_FIXTURE
    },
    restricted: {
      label: 'Restricted page',
      tabUrl: 'chrome://settings/',
      fixture: EMPTY_FIXTURE
    },
    error: {
      label: 'Injection error',
      tabUrl: 'https://news.example.com/protected-page',
      fixture: DEFAULT_FIXTURE
    },
    large: {
      label: 'Large page - 240 links',
      tabUrl: 'https://news.example.com/many-links',
      fixture: LARGE_FIXTURE
    },
    slow: {
      label: 'Slow scan - loading state',
      tabUrl: 'https://news.example.com/design-inspiration',
      fixture: DEFAULT_FIXTURE
    },
    mainVideo: {
      label: 'Main video pinned',
      tabUrl: 'https://course.example.com/class/chemistry-07',
      fixture: MAIN_VIDEO_FIXTURE
    },
    watch: {
      label: 'Watch - player changes',
      tabUrl: 'https://course.example.com/class/live',
      fixture: WATCH_FIXTURE_A
    },
    watchAuto: {
      label: 'Auto-watch setting',
      tabUrl: 'https://course.example.com/class/live',
      fixture: WATCH_FIXTURE_A,
      settings: { autoWatch: true }
    },
    settings: {
      label: 'Saved settings - Markdown, no badge',
      tabUrl: 'https://news.example.com/design-inspiration',
      fixture: DEFAULT_FIXTURE,
      settings: { defaultCopyFormat: 'markdown', autoWatch: false, showBadge: false }
    }
  };

  if (!scenarioDefs[scenario]) scenario = 'default';
  var definition = scenarioDefs[scenario];

  var storageData = Object.assign({
    defaultCopyFormat: 'urls',
    autoWatch: false,
    showBadge: true
  }, definition.settings || {});
  var storageListeners = [];

  function clone(value) {
    if (value === null || value === undefined) return value;
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (error) {
      return value;
    }
  }

  function notifyStorage(changes) {
    storageListeners.forEach(function (listener) {
      try {
        listener(clone(changes), 'sync');
      } catch (error) {
        console.error('[harness] storage listener failed', error);
      }
    });
  }

  var storageArea = {
    get: function (defaults) {
      var result = {};
      if (defaults && typeof defaults === 'object') {
        Object.keys(defaults).forEach(function (key) { result[key] = defaults[key]; });
      }
      Object.keys(storageData).forEach(function (key) { result[key] = storageData[key]; });
      return Promise.resolve(result);
    },
    set: function (patch) {
      var changes = {};
      Object.keys(patch || {}).forEach(function (key) {
        changes[key] = { oldValue: storageData[key], newValue: patch[key] };
        storageData[key] = patch[key];
      });
      notifyStorage(changes);
      return Promise.resolve();
    },
    remove: function (keys) {
      var list = Array.isArray(keys) ? keys : [keys];
      var changes = {};
      list.forEach(function (key) {
        changes[key] = { oldValue: storageData[key], newValue: undefined };
        delete storageData[key];
      });
      notifyStorage(changes);
      return Promise.resolve();
    },
    clear: function () {
      var changes = {};
      Object.keys(storageData).forEach(function (key) {
        changes[key] = { oldValue: storageData[key], newValue: undefined };
        delete storageData[key];
      });
      notifyStorage(changes);
      return Promise.resolve();
    }
  };

  var mock = {
    scenario: scenario,
    copied: [],
    opened: [],
    scanCalls: 0,
    probeCalls: 0,
    tabUpdates: [],
    clipboardError: null,
    badges: {},
    badgeColor: '',
    openOptionsCalls: 0,
    downloads: [],
    downloadErrors: [],
    watchFixtureChanges: 0,
    storage: storageData,
    chrome: {
      tabs: {
        query: function (filter) {
          var tab = {
            id: 7,
            url: definition.tabUrl,
            title: 'Harness: ' + scenario
          };
          if (filter && filter.active) return Promise.resolve([tab]);
          return Promise.resolve([tab]);
        },
        create: function (options) {
          mock.opened.push(options && options.url ? options.url : '');
          return Promise.resolve({ id: 99 });
        },
        onUpdated: {
          addListener: function (listener) {
            mock.tabUpdates.push(listener);
          }
        }
      },
      scripting: {
        executeScript: function (injection) {
          var options = injection.args && injection.args[0] ? Object.assign({}, injection.args[0]) : {};
          var isProbe = typeof options.maxEmbeds === 'number';
          if (isProbe) mock.probeCalls++;
          else mock.scanCalls++;

          if (scenario === 'error') {
            return Promise.reject(new Error(
              'Cannot access contents of the page. Extension manifest must request permission to access the respective host.'
            ));
          }

          var fixture = document.getElementById('fixture-frame');
          options.document = fixture.contentDocument;
          var result = injection.func(options);

          if (scenario === 'slow') {
            return new Promise(function (resolve) {
              setTimeout(function () {
                resolve([{ result: result }]);
              }, 1200);
            });
          }
          return Promise.resolve([{ result: result }]);
        }
      },
      action: {
        setBadgeText: function (details) {
          if (details && typeof details.tabId === 'number') {
            mock.badges[String(details.tabId)] = details.text || '';
          }
          return Promise.resolve();
        },
        setBadgeBackgroundColor: function (details) {
          mock.badgeColor = details && details.color ? details.color : '';
          return Promise.resolve();
        }
      },
      storage: {
        sync: storageArea,
        local: storageArea,
        onChanged: {
          addListener: function (listener) {
            storageListeners.push(listener);
          }
        }
      },
      runtime: {
        getManifest: function () {
          return { manifest_version: 3, name: 'Clipfox', version: '1.4.0' };
        },
        openOptionsPage: function () {
          mock.openOptionsCalls++;
          return Promise.resolve();
        },
        lastError: null
      }
    }
  };

  window.__uiMock = mock;
  window.__uiReady = false;

  function loadFrame(frame, html) {
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () {
        reject(new Error('The frame did not finish loading within 6 seconds.'));
      }, 6000);
      frame.addEventListener('load', function () {
        clearTimeout(timer);
        resolve();
      }, { once: true });
      frame.srcdoc = html;
    });
  }

  function delay(milliseconds) {
    return new Promise(function (resolve) {
      setTimeout(resolve, milliseconds);
    });
  }

  function setText(id, text) {
    var element = document.getElementById(id);
    if (element) element.textContent = text;
  }

  function updatePanel() {
    setText('mock-scenario', scenario);
    setText('mock-tab', scenario === 'restricted' ? 'Protected browser page' : 'Regular web page');
    setText('mock-scans', String(mock.scanCalls));
    setText('mock-probes', String(mock.probeCalls));
    setText('mock-copies', String(mock.copied.length));
    setText('mock-opens', String(mock.opened.length));
    setText('mock-badge', Object.prototype.hasOwnProperty.call(mock.badges, '7')
      ? (mock.badges['7'] || '(empty)')
      : '(none)');
    setText('mock-badge-color', mock.badgeColor || '-');
    setText('mock-options', String(mock.openOptionsCalls));
    setText('mock-downloads', String(mock.downloads.length));
    setText('mock-copied', JSON.stringify(mock.copied, null, 2));
    setText('mock-opened', JSON.stringify(mock.opened, null, 2));
    setText('mock-exports', JSON.stringify(mock.downloads, null, 2));
    setText('mock-storage', JSON.stringify(storageData, null, 2));
    setText('mock-ready', window.__uiReady ? 'yes' : 'no');
  }

  function buildNav() {
    var nav = document.getElementById('scenarios');
    Object.keys(scenarioDefs).forEach(function (key) {
      var link = document.createElement('a');
      link.href = '?scenario=' + encodeURIComponent(key);
      link.textContent = scenarioDefs[key].label;
      if (key === scenario) link.className = 'active';
      nav.appendChild(link);
    });
  }

  function showError(message) {
    var banner = document.getElementById('error-banner');
    banner.textContent = message;
    banner.style.display = 'block';
    window.__uiHarnessError = message;
  }

  function popupUrls(popupDocument) {
    var anchors = popupDocument.querySelectorAll('#results .result-url');
    var urls = [];
    for (var i = 0; i < anchors.length; i++) urls.push(anchors[i].textContent);
    return urls;
  }

  function checkExpectations(popupFrame) {
    var doc = popupFrame.contentDocument;

    if (scenario === 'idle' && mock.scanCalls !== 0) {
      throw new Error('Idle scenario performed ' + mock.scanCalls + ' scan(s) before the button was clicked.');
    }

    if (scenario === 'mainVideo') {
      var first = doc.querySelector('#results .result');
      if (!first || first.getAttribute('data-main') !== 'true') {
        throw new Error('Main video was not pinned to the first card.');
      }
      var mainTitle = first.querySelector('.result-title');
      if (!mainTitle || mainTitle.textContent.indexOf('Chemistry-07') === -1) {
        throw new Error('The pinned card was not the embedded class player.');
      }
      if (!first.querySelector('.main-pill')) {
        throw new Error('The main-video card has no Main badge.');
      }
      if (doc.querySelectorAll('#results .result[data-main="true"]').length !== 1) {
        throw new Error('Exactly one card should be marked as the main video.');
      }
      var mainUrls = [...doc.querySelectorAll('#results .result-url')].map(function (anchor) { return anchor.textContent; });
      if (!mainUrls.some(function (url) { return url.indexOf('SecondVid01') !== -1; })) {
        throw new Error('The second embedded video should still be listed after the main card.');
      }
      if (mock.badges['7'] !== '4') {
        throw new Error('Badge should show 4 links for the main-video scenario, received ' + JSON.stringify(mock.badges['7']));
      }
    }

    if (scenario === 'settings') {
      if (doc.getElementById('copy-format').value !== 'markdown') {
        throw new Error('Saved copy format was not applied.');
      }
      if ((mock.badges['7'] || '') !== '') {
        throw new Error('Badge should be empty when showBadge is off.');
      }
    }

    if (scenario === 'default') {
      if (mock.badges['7'] !== '8') {
        throw new Error('Badge should show 8 links, received ' + JSON.stringify(mock.badges['7']));
      }
      if (mock.badgeColor !== '#6f5df0') {
        throw new Error('Badge colour was not configured.');
      }
      var defaultMain = doc.querySelector('#results .result');
      if (!defaultMain || defaultMain.getAttribute('data-main') !== 'true') {
        throw new Error('The embedded duplicate should pin the first card as Main.');
      }
      if (defaultMain.querySelector('.result-url').textContent.indexOf('dQw4w9WgXcQ') === -1) {
        throw new Error('The default main card is not the embedded video.');
      }
    }

    if (scenario === 'watch' || scenario === 'watchAuto') {
      var urls = popupUrls(doc);
      if (!urls.some(function (url) { return url.indexOf('WatchVid002') !== -1; })) {
        throw new Error('Watch mode did not refresh to the new player.');
      }
      if (urls.some(function (url) { return url.indexOf('WatchVid001') !== -1; })) {
        throw new Error('Watch mode kept the old player after refresh.');
      }
      var watchButton = doc.getElementById('watch-btn');
      if (!watchButton || watchButton.getAttribute('aria-pressed') !== 'true') {
        throw new Error('Watch button is not pressed after starting watch mode.');
      }
      if (mock.scanCalls < 2) {
        throw new Error('Watch mode did not perform a silent rescan.');
      }
    }

    if (scenario === 'error' || scenario === 'restricted') {
      var diagnostic = mock.copied[mock.copied.length - 1] || '';
      var parsed;
      try {
        parsed = JSON.parse(diagnostic);
      } catch (error) {
        throw new Error('Diagnostics were not copied as JSON.');
      }
      if (!parsed.extension || parsed.extension !== 'Clipfox') {
        throw new Error('Diagnostics are missing the extension name.');
      }
      if (!parsed.page || typeof parsed.page.url !== 'string') {
        throw new Error('Diagnostics are missing page context.');
      }
    }
  }

  async function boot() {
    buildNav();
    updatePanel();
    if (params.get('plain') === '1') {
      document.body.classList.add('plain');
    }

    var fixtureFrame = document.getElementById('fixture-frame');
    await loadFrame(fixtureFrame, definition.fixture);

    var response = await fetch('../popup.html', { cache: 'no-store' });
    if (!response.ok) throw new Error('Could not load popup.html (HTTP ' + response.status + ').');
    var html = await response.text();
    var parsed = new DOMParser().parseFromString(html, 'text/html');
    parsed.body.querySelectorAll('script').forEach(function (script) { script.remove(); });
    // Resolve brand images from the site root. The srcdoc preload scanner can
    // otherwise request them relative to /tests/ before <base> is applied.
    var bodyHtml = parsed.body.innerHTML.replace(/(src=")brand\//g, '$1/brand/');

    var popupDocument = '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width, initial-scale=1">' +
      '<base href="../">' +
      '<title>Clipfox (harness)</title>' +
      '<link rel="stylesheet" href="/popup.css' + CACHE_BUST + '">' +
      '</head><body>' + bodyHtml +
      // defer matches how the real popup loads its scripts; without it the
      // harness would run init() after the script body and hide startup bugs.
      '<script defer src="/tests/ui-mock.js' + CACHE_BUST + '"></script>' +
      '<script defer src="/extractor.js' + CACHE_BUST + '"></script>' +
      '<script defer src="/popup.js' + CACHE_BUST + '"></script>' +
      '</body></html>';

    var popupFrame = document.getElementById('popup-frame');
    await loadFrame(popupFrame, popupDocument);
    await delay(250);

    // The popup is click-to-scan now. Drive the real button for every
    // scenario except the idle one, which is meant to stay on the CTA.
    if (scenario !== 'idle' && scenario !== 'restricted') {
      var scanButton = popupFrame.contentDocument.getElementById('state-action');
      if (scanButton && !scanButton.hidden) {
        scanButton.click();
      } else {
        var rescanButton = popupFrame.contentDocument.getElementById('rescan-btn');
        if (rescanButton) rescanButton.click();
      }
    }

    await delay(400);

    if (scenario === 'error' || scenario === 'restricted') {
      var diagnosticsButton = popupFrame.contentDocument.getElementById('state-diagnostics');
      if (diagnosticsButton && !diagnosticsButton.hidden) diagnosticsButton.click();
      await delay(150);
    }

    if (scenario === 'watch' || scenario === 'watchAuto') {
      if (scenario === 'watch') {
        var watchButton = popupFrame.contentDocument.getElementById('watch-btn');
        if (watchButton) watchButton.click();
      }
      await delay(350);
      await loadFrame(fixtureFrame, WATCH_FIXTURE_B);
      mock.watchFixtureChanges++;
      // The popup polls every 3 seconds. Give it one full cycle plus scan time.
      await delay(3900);
    }

    checkExpectations(popupFrame);
    window.__uiReady = true;
    updatePanel();
    setInterval(updatePanel, 350);
  }

  document.getElementById('update-btn').addEventListener('click', function () {
    mock.tabUpdates.forEach(function (listener) {
      listener(7, { status: 'complete' }, { id: 7, url: definition.tabUrl });
    });
    updatePanel();
  });

  boot().catch(function (error) {
    showError('Harness failed: ' + (error && error.message ? error.message : String(error)));
    updatePanel();
  });
})();
