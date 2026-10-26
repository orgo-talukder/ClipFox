/* Background harness: loads the real background.js with mocked chrome APIs. */
(function () {
  'use strict';

  var CACHE_BUST = '?v=' + Date.now();
  var listeners = {
    updated: [],
    removed: [],
    installed: [],
    startup: []
  };
  var mock = {
    badgeWrites: [],
    badgeColor: '',
    chrome: {
      action: {
        setBadgeText: function (details) {
          mock.badgeWrites.push({
            tabId: details && details.tabId,
            text: details && details.text !== undefined ? details.text : ''
          });
          return Promise.resolve();
        },
        setBadgeBackgroundColor: function (details) {
          mock.badgeColor = details && details.color ? details.color : '';
          return Promise.resolve();
        }
      },
      tabs: {
        onUpdated: {
          addListener: function (listener) {
            listeners.updated.push(listener);
          }
        },
        onRemoved: {
          addListener: function (listener) {
            listeners.removed.push(listener);
          }
        }
      },
      runtime: {
        onInstalled: {
          addListener: function (listener) {
            listeners.installed.push(listener);
          }
        },
        onStartup: {
          addListener: function (listener) {
            listeners.startup.push(listener);
          }
        }
      }
    }
  };

  window.__backgroundMock = mock;
  window.__backgroundReady = false;

  function delay(milliseconds) {
    return new Promise(function (resolve) {
      setTimeout(resolve, milliseconds);
    });
  }

  function setText(id, text) {
    var element = document.getElementById(id);
    if (element) element.textContent = text;
  }

  function renderChecks(results) {
    var container = document.getElementById('checks');
    container.replaceChildren();
    results.forEach(function (item) {
      var line = document.createElement('p');
      line.className = 'check ' + (item.ok ? 'pass' : 'fail');
      line.textContent = (item.ok ? 'PASS ' : 'FAIL ') + item.name +
        (item.ok ? '' : ' — ' + item.detail);
      container.appendChild(line);
    });
  }

  function updatePanel(results) {
    setText('mock-writes', JSON.stringify(mock.badgeWrites, null, 2));
    setText('mock-listeners', JSON.stringify({
      updated: listeners.updated.length,
      removed: listeners.removed.length,
      installed: listeners.installed.length,
      startup: listeners.startup.length
    }, null, 2));
    if (results) renderChecks(results);
  }

  function showError(message) {
    var banner = document.getElementById('error-banner');
    banner.textContent = message;
    banner.style.display = 'block';
    window.__backgroundHarnessError = message;
  }

  function loadWorker(frame) {
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () {
        reject(new Error('The worker frame did not load within 6 seconds.'));
      }, 6000);
      frame.addEventListener('load', function () {
        clearTimeout(timer);
        resolve();
      }, { once: true });
      frame.srcdoc = '<!doctype html><html><head><meta charset="utf-8"><title>worker</title></head><body>' +
        '<script>window.chrome = parent.__backgroundMock.chrome;</script>' +
        '<script src="../background.js' + CACHE_BUST + '"></script>' +
        '</body></html>';
    });
  }

  function clearWrites() {
    mock.badgeWrites.length = 0;
  }

  async function runChecks() {
    var results = [];
    var source = await fetch('../background.js' + CACHE_BUST, { cache: 'no-store' }).then(function (response) {
      if (!response.ok) throw new Error('Could not load background.js (HTTP ' + response.status + ').');
      return response.text();
    });

    function check(name, fn) {
      try {
        var value = fn();
        results.push({ name: name, ok: value !== false, detail: value === false ? 'Assertion returned false.' : '' });
      } catch (error) {
        results.push({ name: name, ok: false, detail: error && error.message ? error.message : String(error) });
      }
    }

    await delay(150);

    check('Registers navigation and close listeners', function () {
      if (listeners.updated.length !== 1) throw new Error('expected 1 onUpdated listener, found ' + listeners.updated.length);
      if (listeners.removed.length !== 1) throw new Error('expected 1 onRemoved listener, found ' + listeners.removed.length);
      if (listeners.installed.length !== 1) throw new Error('expected 1 onInstalled listener, found ' + listeners.installed.length);
      if (listeners.startup.length !== 1) throw new Error('expected 1 onStartup listener, found ' + listeners.startup.length);
    });

    check('Sets the badge colour while starting up', function () {
      if (mock.badgeColor !== '#6f5df0') throw new Error('badge colour is ' + JSON.stringify(mock.badgeColor));
    });

    check('Clears a badge when a navigation starts', function () {
      clearWrites();
      listeners.updated[0](7, { status: 'loading' }, {});
      if (mock.badgeWrites.length !== 1) throw new Error('expected one write, found ' + mock.badgeWrites.length);
      if (mock.badgeWrites[0].tabId !== 7 || mock.badgeWrites[0].text !== '') {
        throw new Error('unexpected write ' + JSON.stringify(mock.badgeWrites[0]));
      }
    });

    check('Clears a badge on an in-page URL change', function () {
      clearWrites();
      listeners.updated[0](8, { url: 'https://example.com/next' }, {});
      if (mock.badgeWrites.length !== 1) throw new Error('expected one write, found ' + mock.badgeWrites.length);
      if (mock.badgeWrites[0].tabId !== 8 || mock.badgeWrites[0].text !== '') {
        throw new Error('unexpected write ' + JSON.stringify(mock.badgeWrites[0]));
      }
    });

    check('Ignores unrelated tab updates', function () {
      clearWrites();
      listeners.updated[0](9, { status: 'complete' }, {});
      listeners.updated[0](9, null, {});
      if (mock.badgeWrites.length !== 0) {
        throw new Error('unexpected write(s) ' + JSON.stringify(mock.badgeWrites));
      }
    });

    check('Clears a badge when the tab closes', function () {
      clearWrites();
      listeners.removed[0](10, { isWindowClosing: false });
      if (mock.badgeWrites.length !== 1) throw new Error('expected one write, found ' + mock.badgeWrites.length);
      if (mock.badgeWrites[0].tabId !== 10 || mock.badgeWrites[0].text !== '') {
        throw new Error('unexpected write ' + JSON.stringify(mock.badgeWrites[0]));
      }
    });

    check('Re-applies the badge colour on install and browser startup', function () {
      mock.badgeColor = '';
      listeners.installed[0]({ reason: 'update' });
      if (mock.badgeColor !== '#6f5df0') throw new Error('install did not set the colour');
      mock.badgeColor = '';
      listeners.startup[0]();
      if (mock.badgeColor !== '#6f5df0') throw new Error('startup did not set the colour');
    });

    check('Uses no network, cookie, or history APIs', function () {
      var forbidden = [
        /\bfetch\s*\(/,
        /\bXMLHttpRequest\b/,
        /\bWebSocket\b/,
        /\bsendBeacon\b/,
        /chrome\.cookies/,
        /chrome\.history/,
        /chrome\.webRequest/,
        /chrome\.scripting/
      ];
      var hits = forbidden.filter(function (pattern) { return pattern.test(source); });
      if (hits.length) {
        throw new Error('forbidden API reference(s): ' + hits.map(String).join(', '));
      }
    });

    return results;
  }

  async function boot() {
    var frame = document.getElementById('worker-frame');
    await loadWorker(frame);
    var results = await runChecks();
    window.__backgroundResults = {
      passed: results.filter(function (item) { return item.ok; }).length,
      failed: results.filter(function (item) { return !item.ok; }).length,
      total: results.length,
      checks: results
    };
    window.__backgroundReady = true;
    updatePanel(results);
    setInterval(function () { updatePanel(); }, 350);
  }

  boot().catch(function (error) {
    showError('Harness failed: ' + (error && error.message ? error.message : String(error)));
    updatePanel();
  });
})();
