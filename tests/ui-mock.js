/* Runs inside the mocked popup iframe for tests/ui-harness.html.
 * Provides a chrome.* surface, clipboard recorder, and export download capture
 * before popup.js runs.
 */
(function () {
  'use strict';

  var host = parent.__uiMock;

  window.chrome = host.chrome;

  try {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: function (text) {
          host.copied.push(String(text));
          return Promise.resolve();
        }
      }
    });
  } catch (error) {
    host.clipboardError = String(error);
  }

  try {
    Object.defineProperty(window, 'isSecureContext', {
      configurable: true,
      value: true
    });
  } catch (error) {
    // The native value is already true on localhost.
  }

  // Export uses a temporary <a download> with a Blob URL. Capture the blob
  // contents so the harness can verify the exported format.
  var nativeClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (!this.hasAttribute('download')) {
      return nativeClick.apply(this, arguments);
    }

    var filename = this.download;
    var href = this.href;
    fetch(href).then(function (response) {
      return response.text();
    }).then(function (text) {
      host.downloads.push({ name: filename, text: text });
    }).catch(function (error) {
      host.downloadErrors.push({ name: filename, error: String(error) });
    });
  };
})();
