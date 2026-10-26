# Testing

Last verified: **2026-10-25** (Clipfox **1.4.0**)

## Status at a glance

| Area | Method | Result |
| --- | --- | --- |
| Extraction logic | Automated browser test page, 10 groups | **PASS — 10/10** |
| Scanner function serialization | Automated test re-evaluates `scan.toString()` | **PASS** |
| Embed probe and change detection | Automated test re-evaluates `probeEmbeds.toString()` | **PASS** |
| Popup default interactions | UI harness with mocked `chrome.*` | **PASS** |
| Click-to-scan idle state (no scan before click) | UI harness | **PASS** |
| Deferred-script startup path | UI harness loaded with `defer` | **PASS** |
| Videos-only default and no-video state | UI harness with mocked `chrome.*` | **PASS** |
| Popup empty / restricted / error states | UI harness | **PASS** |
| Popup large-page state (240 links) | UI harness | **PASS** |
| Loading state | UI harness with a delayed injection | **PASS** |
| Keyboard shortcuts and native Tab order | UI harness + browser key events | **PASS** |
| Main-video pinning and violet **Main** badge | UI harness `mainVideo` scenario | **PASS** |
| Watch mode refresh | UI harness `watch` scenario | **PASS** |
| Auto-watch setting | UI harness `watchAuto` scenario | **PASS** |
| Copy formats and export | UI harness browser evaluation | **PASS** |
| Per-card video-ID copy | UI harness browser evaluation | **PASS** |
| Toolbar badge and settings suppression | UI harness + options harness | **PASS** |
| Local storage fallback when sync writes fail | UI harness browser evaluation | **PASS** |
| Diagnostics JSON copy | UI harness `error` / `restricted` scenarios | **PASS** |
| Settings page | Options harness, 5 checks | **PASS — 5/5** |
| Background badge cleanup | Background harness, 8 checks | **PASS — 8/8** |
| Clipfox mark, wordmark, icons, and local font | Visual inspection + browser font check | **PASS — visual** |
| Popup state screenshots at 400 × 588 | Visual inspection | **PASS — visual** |
| Settings page at 760 px and 1,000 px | Visual inspection | **PASS — visual** |
| Real unpacked extension install and toolbar click | Chrome/Edge/Brave extensions page | **NOT RUN** |
| Real clipboard contents in the OS | Manual | **NOT RUN** |
| Real `chrome.tabs.create` tab opening | Manual | **NOT RUN** |
| Real export download | Manual | **NOT RUN** |
| Real `chrome.storage.sync` persistence | Manual | **NOT RUN** |
| Real service-worker lifecycle and badge clearing | Manual | **NOT RUN** |
| Real Watch mode on a live changing player | Manual | **NOT RUN** |
| File URL with "Allow access to file URLs" | Manual | **NOT RUN** |
| Cross-origin iframe interiors on a live page | Manual | **NOT RUN / known limitation** |

The extraction, popup, settings, and background code are well covered by harnesses. The extension has **not** been installed as an unpacked extension in this environment, so the final browser-integration step is still a manual check. See [What was not tested](#what-was-not-tested).

---

## Environment

| Item | Value |
| --- | --- |
| OS | Windows |
| Test browser | Google Chrome **156.0.8078.48** (headless, driven over the DevTools Protocol) |
| Also installed | Microsoft Edge **156.0.4314.42** (not used for the automated runs) |
| Server | `python -m http.server 8123` (Python 3.15.1) |
| Test origin | `http://127.0.0.1:8123` |
| Extension package | `yt-link-extractor/` |
| Manifest | Manifest V3, version **1.4.0** |
| Brand | Clipfox fox/link mark, local Space Grotesk wordmark, bundled variable WOFF2 |

The tests were run against files served over HTTP, not from `file://`, because the harnesses need `fetch` to load fixtures and popup assets. The popup harness uses `<base href="../">` inside its `srcdoc` iframe so the local `brand/` and `fonts/` assets resolve correctly.

---

## 1. Automated extraction tests

**Page:** `http://127.0.0.1:8123/tests/test-runner.html`

**Recorded result (Chrome 156.0.8078.48, 2026-10-25):** **10 of 10 groups passed, 0 failed, 0 console errors (975 ms).**

These tests load the real `extractor.js` and run `YTExtractor.scan` against real iframe documents. They do not use mocked extraction logic.

### Groups

1. **Rich fixture: every supported link shape, dedupe, and titles**
   `fixtures.html` produces exactly 21 unique links: 12 videos, 1 Short, 1 live, 3 playlists, 4 channels, 0 other. Checks URL uniqueness, anchor/image/aria/iframe/Open Graph/JSON-LD title precedence, ignores a `javascript:` link, ignores lookalike hosts, and verifies duplicate candidates are counted.
2. **Page with no YouTube links returns an empty, successful scan**
   `fixtures-empty.html` returns `ok: true`, 0 links, 0 detected, 0 unique.
3. **Malformed and dangerous URLs are ignored safely**
   Empty IDs, short IDs, bad percent escapes, an empty channel path, and whitespace/`&amp;` handling produce only the 2 valid links.
4. **Title precedence and fallbacks are predictable**
   Visible text wins; `aria-label`, `title`, image `alt`, and a clean ID-based fallback are used in order; generic text such as "Watch" is discarded.
5. **Duplicates merge by video ID without merging different videos**
   A `youtu.be` anchor and an embed `data-src` for the same ID collapse to one canonical watch URL with the stronger title. The embed source overrides the earlier anchor so the popup can pin it as the main video. A different video ID remains separate and keeps the `link` source.
6. **Large pages are capped and reported as truncated**
   650 links with `maxLinks: 500` stores 500, reports 650 unique, and sets `stats.truncated`.
7. **Visible plain-text URLs respect host boundaries and punctuation**
   Finds one real URL in prose, strips a trailing period, and rejects `notyoutube.com` and `youtube.com.evil.example`.
8. **URL shapes map to the right categories and canonical URLs**
   Covers `youtu.be`, `/embed/`, `/v/`, mobile, music, video-in-playlist, playlist, `@handle`, `/channel/ID`, search, hashtag, and home. Video playlist context is stripped; channel tabs reduce to the channel root.
9. **Scanner source is self-contained and survives function serialization**
   Re-evaluates `YTExtractor.scan.toString()` with `new Function` in global scope and scans a new fixture. This catches accidental references to closure variables that would break `chrome.scripting.executeScript({ func })` injection. The rebuilt scanner extracts both a `youtu.be` anchor and a `data-src` embed with correct titles.
10. **Embed probe detects player changes and survives serialization**
    `probeEmbeds` finds both a normal embed and a `youtube-nocookie.com` embed, returns canonical watch URLs and titles, and includes both player IDs in its signature. The fixture also puts an anchor for the second player before both embeds; deduplication upgrades it to `source: embed`, keeps `embedOrder: 1`, and leaves the first embed at `embedOrder: 0`. Replacing one player ID changes the signature. Re-evaluating `probeEmbeds.toString()` produces the same count and signature, so the function is safe to inject remotely.

### What this does not cover

- Chrome's actual function serialization and remote injection path.
- `activeTab` temporary host permission.
- A live page's cross-origin frame contents.
- Real clipboard, storage, badge, download, or tab APIs.

---

## 2. Popup UI harness

**Page:** `http://127.0.0.1:8123/tests/ui-harness.html`

The harness loads the real `popup.html`, `popup.css`, and `popup.js` in an iframe. `tests/ui-mock.js` supplies a mocked `chrome.*` surface, clipboard recorder, storage area, badge recorder, and export capture; `tests/ui-harness.js` feeds fixture documents through the scanner. It is not a separate reimplementation of the popup.

The harness loads `ui-mock.js`, `extractor.js`, and `popup.js` with `defer`, matching the real popup. It then clicks the real **Scan this page** button for every scenario except `idle` and `restricted`, so the tests exercise the click-to-scan flow instead of an automatic scan.

**Recorded result (Chrome 156.0.8078.48, 2026-10-25):** all **12/12** scenarios completed with `__uiReady: true` and no harness error:

`idle`, `default`, `empty`, `noVideo`, `restricted`, `error`, `large`, `slow`, `mainVideo`, `watch`, `watchAuto`, `settings`.

### Idle scenario — before the first scan

Recorded observations:

- Count badge: `0`.
- Page host strip shows the active tab host.
- Search/actions row hidden; filters hidden.
- No scan request was made (`scanCalls` stayed 0).
- Center panel: **"Find YouTube links on this page"** with the message explaining what the scan reads.
- Primary action: **"Scan this page"**.
- Footer: `Ready. Click Scan this page to find YouTube links.`
- The idle panel is vertically centered in the results area after the `.state-panel` height fix.

### Default scenario — 8 links (after clicking Scan this page)

Recorded observations:

- Page host strip: `news.example.com`.
- Count badge: `8 links`.
- Category chips: `All 8`, `Videos 5`, `Playlists 1`, `Channels 1`, `Other 1`.
- **Videos** is selected by default and covers 3 watch videos, 1 Short, and 1 live stream.
- 5 cards rendered (the 3 playlists/channels/other links are hidden by default).
- The embedded duplicate of `dQw4w9WgXcQ` did not add a sixth video card. It marked the first card as **Main**.
- Footer: `5 of 8 links shown. Videos only.`
- Titles came from anchors, image alt text, aria labels, and iframe titles as expected.
- Clicking **All** rendered all 8 cards and changed the footer to `Scan complete · 8 unique links ...`.

### Search

- Typing `css` produced exactly 1 result (the Short card).
- Footer changed to `1 of 5 links shown.` because the default Videos group contains 5 links.
- Copy button label changed to `Copy 1`.
- Pressing `Escape` while the search field was focused cleared the query and restored the 5 video cards.

### No-match state

- Searching `zzzz` produced 0 cards.
- The state panel showed **"No matching videos"** with the message "Try a different search, or clear it to see every extracted link."
- The action button was **"Clear search"**.
- Copy All was disabled.
- Clicking **Clear search** restored the query to empty, the `Videos` chip, and 5 cards.

### Category filter and Copy All

- Clicking **Videos** showed 5 cards (video + Short + live), set the chip to pressed, and changed the copy label to **Copy 5**.
- Copy All in the default **URLs** format wrote exactly 5 URLs, one per line, to the mocked clipboard:
  - `https://www.youtube.com/watch?v=dQw4w9WgXcQ`
  - `https://www.youtube.com/shorts/aBcDeFgHiJk`
  - `https://www.youtube.com/live/LiveStream1`
  - `https://www.youtube.com/watch?v=LongTitle01`
  - `https://www.youtube.com/watch?v=DesignVid01`
- Toast: `Copied 5 filtered links`.
- The copied set respected the active filter, not all 8 links.
- Clicking **Channels** showed 1 card and copy label **Copy 1**.

### Copy formats

With **All** selected (8 links), changing the **Copy as** control and pressing **Copy all** produced:

| Format | Recorded output |
| --- | --- |
| URLs | 8 canonical URLs, one per line |
| Title + URL | `Title — URL` lines, including the embedded duplicate's title |
| Markdown | `- [Title](URL)` lines |
| CSV | `Title,URL,Category` header plus 8 rows using CRLF line endings |
| JSON | Pretty-printed array with `title`, `url`, `category`, and `main` |
| Video IDs | 5 IDs: `dQw4w9WgXcQ`, `aBcDeFgHiJk`, `LiveStream1`, `LongTitle01`, `DesignVid01` |

The selected format was persisted to the mocked `chrome.storage.sync` after each change. Per-card copy still wrote the card's URL regardless of the selected bulk format.

### Export

- With JSON selected, **Export** captured one file named **`news.example.com-clipfox-2026-10-25.json`**.
- The captured file began with the pretty-printed JSON array and included the same entries as Copy all.
- Export used the same filtered set and format as Copy all.
- No download permission is declared; the harness captures the Blob contents through the temporary `<a download>` element.

### Per-card actions

- The first copy button wrote the card's URL to the mock clipboard, added `is-copied`, changed its accessible label to `Copied: ...`, and showed `Link copied`.
- The first `#` button copied `dQw4w9WgXcQ` and added the copied state.
- The first open button called `chrome.tabs.create` with `https://www.youtube.com/watch?v=dQw4w9WgXcQ`.
- The footer **Settings** button called `chrome.runtime.openOptionsPage` (mock count 1).

### Watch toggle

- Pressing **Watch** set `aria-pressed="true"`, changed the label to **Watching**, and updated the footer to start with `Watching ·`.
- Pressing **Watching** set `aria-pressed="false"` and restored the **Watch** label.

### Rescan

- Clicking Rescan increased the mock scan count from 1 to 2 and re-rendered 5 video cards.
- The active Videos filter remained selected after the rescan.

### Stale-page hint

- Firing the mocked `tabs.onUpdated` completion event changed the footer to **"The page changed since this scan. Rescan to refresh."**
- The status dot changed to the warning tone.
- The rescan control remained available.

### Main-video scenario

Fixture: a class page with a related video anchor that points at the *second* embed, one playlist, one channel, and two embedded class players (`MainClass01` first, `SecondVid01` second).

- Scan found 4 unique links: 2 videos, 1 playlist, 1 channel.
- The first card was the first embedded class player, marked `data-main="true"` and showing the violet **Main** pill.
- Its canonical URL was `https://www.youtube.com/watch?v=MainClass01`.
- The second video (`SecondVid01`) remained in the list after the main card.
- Exactly one card was marked as main.
- Badge showed `4`.
- Footer: `2 of 4 links shown. Videos only.`

### Watch scenario

Fixture A embeds `WatchVid001`; the harness presses **Watch**, replaces the fixture with one embedding `WatchVid002`, and waits one polling cycle (3.9 seconds).

- Watch button became pressed and showed **Watching**.
- The probe ran during the wait.
- Watch performed a second, silent scan (`scanCalls` 2) after the player changed.
- Results updated to `WatchVid002`; the old `WatchVid001` card disappeared.
- Footer: `Watching · Scan complete · 2 unique links in 1 ms.` (the 1 ms is the harness fixture, not a real-page timing claim).
- Badge showed `2`.

### Auto-watch scenario

- Mock storage had `autoWatch: true`.
- After the initial successful scan, Watch started automatically without a button press.
- The player change was detected and the results updated to `WatchVid002`.
- `scanCalls` was 2 and the footer started with `Watching ·`.

### Watch failure behavior

A transient failure was injected for the silent rescan only, while the probe kept working:

- The old `WatchVid002` results stayed on screen.
- Footer: `Watch paused · Scan failed. Try rescanning.`
- Status dot tone: `warning`.
- Watch remained enabled (`aria-pressed="true"`) so a later tick could retry.
- `scanCalls` stayed at 2, confirming the failed silent scan did not clear the prior results.

### Settings scenario

Mock storage had `defaultCopyFormat: 'markdown'`, `autoWatch: false`, and `showBadge: false`.

- The **Copy as** control loaded as **Markdown**.
- Badge text was empty for the tab.
- The footer and card rendering still worked normally.
- Badge color was configured as **`#6f5df0`** (Clipfox violet).

### Storage fallback

The settings scenario was also used to exercise a sync write failure:

- `chrome.storage.sync.set` was replaced with a rejecting mock.
- `chrome.storage.local.set` recorded the write.
- Changing **Copy as** to `JSON` wrote `{ "defaultCopyFormat": "json" }` to local storage.
- The toast read **Saved locally — sync is unavailable**, and the control stayed on `JSON`.

The options page uses the same primary-then-local save pattern, but that page's fallback path was not separately exercised.

### Empty scenario

- `0` links, count badge `0`, no chips.
- State panel: **"No YouTube links found on this page."**
- Action: **"Rescan page"**.
- Copy All disabled; footer warned that no links were found.
- Badge showed `0` (the scan succeeded with zero links).

### No-video scenario (3 non-video links)

- Chips: `All 3`, `Videos 0` (selected), `Playlists 1`, `Channels 1`, `Other 1`.
- State panel: **"No video links found"** with the message "This page has 3 other YouTube links (channels, playlists, or pages), but no playable video links."
- Action: **"Show all links"**.
- Footer: `No video links found · 3 other links on this page.`; Copy All disabled.
- Clicking **Show all links** switched to the `All` chip, rendered 3 cards, and re-enabled Copy All.
- Badge showed `3`.

### Restricted scenario (`chrome://settings/`)

- Scan was not attempted; mock scan count remained 0.
- Page strip: `Protected page`, time `Blocked`.
- State panel: **"This page can't be read"** with the protected-page explanation.
- No retry action was shown, because retrying a protected browser page cannot succeed.
- **Copy diagnostics** was visible. Clicking it copied valid JSON with `extension: "Clipfox"`, `version: "1.4.0"`, `scannerVersion: "1.1.0"`, `phase: restricted`, and page context.
- Footer: "This page is protected by the browser."
- Badge was empty.
- The state panel is vertically centered in the results area.

### Error scenario (simulated injection denial)

- The popup showed **"The page can't be accessed"**.
- The **"Try again"** action was present because this failure is retryable.
- **Copy diagnostics** was visible and copied valid JSON with `extension: "Clipfox"`, `version: "1.4.0"`, `scannerVersion: "1.1.0"`, the page URL, title, phase, error details, watch state, settings, and browser string.
- Footer: "Access to this page was denied."
- The page host still showed `news.example.com` rather than an unrelated "protected page" label.
- Badge was empty.
- The console messages are expected diagnostics for the deliberately rejected mock injection; they are not uncaught exceptions.

### Large-page scenario (240 links)

- Scan found 240 unique links in the recorded run.
- Chips: `All 240`, `Videos 240`.
- Initial render: 100 cards; summary **"Showing 100 of 240 matches"**; button **"Show 100 more"**.
- First click: 200 cards; button **"Show 40 more"**.
- Second click: 240 cards; load-more area hidden.
- Copy All wrote 240 URLs (240 lines) and showed `Copied 240 links`.

### Loading state

The mock injection was delayed to expose the loading UI for inspection. The harness clicked **Scan this page**, then observed:

- 4 skeleton cards visible, results list hidden.
- Count badge showed `…`; page strip time: `Scanning…`; footer: "Scanning the current page…"; status dot tone `scanning`.
- `aria-busy="true"` on the results area.
- Filters hidden; Rescan disabled with the busy spinner class; Watch disabled; Copy All and Export disabled.
- After completion, the skeleton was hidden, the count changed to `8`, 5 video cards rendered, and controls re-enabled.

### Keyboard and focus

- Pressing `/` while focus was outside a field moved focus to `#search-input`.
- `Ctrl+K` and `Cmd+K` also moved focus to search.
- `Escape` with a non-empty search cleared it and restored 5 results while keeping focus in the search field.
- Native Tab key events moved focus in DOM order: Rescan → Watch → Copy All → All chip → Videos chip; Shift+Tab moved back.
- Focused controls computed to a solid 2 px focus outline.

### Console

- Default, empty, restricted, large, loading, main-video, watch, settings, and interaction runs produced **no unexpected console errors**.
- The simulated error scenario logs the deliberate injection denial, as designed.
- The simulated Watch failure logs the deliberate silent-scan rejection, as designed.

---

## 3. Settings page harness

**Page:** `http://127.0.0.1:8123/tests/options-harness.html`

**Recorded result:** **5 of 5 checks passed, 0 failed.**

The harness loads the real `options.html`, `options.css`, and `options.js` in an iframe with a mocked `chrome.storage.sync`, `chrome.tabs.query`, and `chrome.action.setBadgeText`. It does not reimplement the settings logic.

### Checks

1. **Settings load with defaults** — copy format `urls`, auto-watch off, show-badge on, controls enabled.
2. **Copy format change saves** — selecting `json` writes `defaultCopyFormat: "json"` to storage.
3. **Auto-watch saves** — toggling the switch writes `autoWatch: true`.
4. **Badge preference saves and clears badges** — toggling show-badge off writes `showBadge: false` and calls `setBadgeText({ text: '' })` for both mocked tabs (two clear writes).
5. **Reset restores defaults** — the reset button restores `urls`, `false`, and `true` in storage and in the form controls.

### Also observed

- The version pill read **`v1.4.0`** from the mocked manifest.
- The Clipfox lockup (fox mark + wordmark) and the supporting line rendered correctly.
- The format hint updated when the format changed.
- The save status showed **Saved** after each successful write.
- When opened directly over HTTP without extension APIs, the page showed a disabled preview state: **"Open this page from the extension to change settings."** This is the intended graceful fallback.

---

## 4. Background worker harness

**Page:** `http://127.0.0.1:8123/tests/background-harness.html`

**Recorded result:** **8 of 8 checks passed, 0 failed.**

The harness loads the real `background.js` in an iframe with a mocked `chrome.action`, `chrome.tabs`, and `chrome.runtime`. It does not reimplement the badge logic.

### Checks

1. **Registers navigation and close listeners** — one `tabs.onUpdated`, one `tabs.onRemoved`, one `runtime.onInstalled`, and one `runtime.onStartup` listener.
2. **Sets the badge colour while starting up** — `setBadgeBackgroundColor` receives **`#6f5df0`**.
3. **Clears a badge when a navigation starts** — `onUpdated(7, { status: 'loading' })` calls `setBadgeText({ tabId: 7, text: '' })`.
4. **Clears a badge on an in-page URL change** — `onUpdated(8, { url: ... })` calls `setBadgeText({ tabId: 8, text: '' })`.
5. **Ignores unrelated tab updates** — `onUpdated(9, { status: 'complete' })` and a null `changeInfo` produce no badge writes.
6. **Clears a badge when the tab closes** — `onRemoved(10)` calls `setBadgeText({ tabId: 10, text: '' })`.
7. **Re-applies the badge colour on install and browser startup** — both listeners set **`#6f5df0`** again.
8. **Uses no network, cookie, or history APIs** — a source scan finds no `fetch(`, `XMLHttpRequest`, `WebSocket`, `sendBeacon`, `chrome.cookies`, `chrome.history`, `chrome.webRequest`, or `chrome.scripting` references.

### What this does not cover

- Chrome's real service-worker start/stop lifecycle.
- Whether `tabs.onUpdated` supplies `changeInfo.url` without the `tabs` permission in a real installation. The `status: 'loading'` path is the primary clear trigger and does not depend on the URL field.
- Real badge rendering in the toolbar.

---

## 5. Visual checks

Screenshots were reviewed for default, empty, restricted, error, large, no-video, loading, main-video, watch, settings, and clipboard-copied states at the real popup size (**400 × 588**). The README preview `docs/popup.png` was refreshed from the default harness scenario after the Clipfox rebrand.

Checks included:

- Header lockup: fox mark, **Clipfox** wordmark, supporting line **YouTube Link Extractor**, and unique-link count fit without overlap.
- The wordmark loads from the bundled local SVG and Space Grotesk WOFF2; no CDN or runtime font request is made.
- Search, actions, copy-format row, chips, cards, footer, and toast fit without horizontal overflow at 400 px.
- 400 px width is inside the requested 380–420 px range.
- Scroll region clips long result lists while the header, controls, and footer remain fixed.
- The **Watch** button, **Copy as** select, **Export** button, violet **Main** pill, **#** copy button, **Settings** link, and **Copy diagnostics** action are visible and readable.
- The main-video card's violet accent and the **Main** pill are distinct without overpowering the category colors.
- Search placeholder, chip counts, card URLs, and footer note have sufficient contrast in the dark theme.
- Category colour accents and icons are visible in the dark theme.
- Idle, empty, restricted, and error state panels are vertically centered in the results area after the `.state-panel { min-height: 100%; }` fix.
- The Settings page was reviewed at 760 px and at a 1,000 px browser width; the Clipfox lockup, tagline, cards, switches, privacy list, and footer fit without overlap.
- The brand preview was inspected with the mark at 16, 24, 32, 48, 96, and 128 px, on dark and light backgrounds, and with the dark, light-background, and monochrome wordmarks.
- The 16 px and 128 px PNG icons were inspected for legibility and transparent edges.

Visual checks were performed in Chrome 156 headless at 100% zoom through the harness. High-contrast mode, forced colours, 200% zoom, and macOS rendering were not tested.

---

## 6. What was not tested

These items require a real unpacked installation and were **not** run in this environment:

1. **Loading `yt-link-extractor/` from `chrome://extensions`, `edge://extensions`, or `brave://extensions`.**
   The manifest parses as JSON and the assets execute in a page, but the browser's extension loader was not successfully exercised. See the real-install attempt below.
2. **Clicking the toolbar action to open the real popup.**
   The harness opens `popup.html` in an iframe instead.
3. **`activeTab` permission grant and real `chrome.scripting.executeScript`.**
   The mock calls the scanner and probe functions directly. The serialization tests re-evaluate the function source, which is a strong proxy, but not the browser's remote injection.
4. **Reading `tab.url` via `chrome.tabs.query` without the `tabs` permission.**
   Expected to work through `activeTab`; not confirmed in an installed extension.
5. **Real clipboard writes to the OS clipboard.**
   The harness records text but cannot verify paste into another application.
6. **Real new-tab creation from per-card Open.**
   The harness records the `chrome.tabs.create` argument.
7. **Real export downloads.**
   The harness captures the Blob contents and filename but does not verify the browser's download shelf, filename collision handling, or blocked-download behavior.
8. **Real `chrome.storage.sync` persistence and cross-device sync.**
   The harness uses an in-memory mock. The local fallback and the preview state were exercised only as code paths.
9. **Real service-worker lifecycle and badge clearing.**
   The harness fires the listeners directly; it does not wait for Chrome to start/stop the worker or verify the toolbar pixels.
10. **Real Watch mode on a live changing player.**
    The harness replaces an iframe fixture and waits for the 3-second poll. A real Udvash or YouTube player may change its iframe URL differently or be cross-origin.
11. **The real Udvash class page.**
    A previous manual check found that an embed such as `pZwQ10i33Ic` produced `https://www.youtube.com/watch?v=pZwQ10i33Ic`. The Clipfox **Main** pinning and Watch behavior still need a fresh manual check on the exact class page.
12. **The real keyboard shortcut.**
    The manifest declares `Ctrl+Shift+Y` / `Cmd+Shift+Y`; the browser's shortcut handling was not exercised.
13. **File URL scanning with "Allow access to file URLs".**
    The code attempts the scan and shows guidance if access is denied; the permission path was not exercised.
14. **Cross-origin iframe interiors on a live third-party page.**
    The scanner intentionally reads only the top document; iframe `src`/`data-src` detection is covered.
15. **Toolbar popup size and close behavior on Edge/Brave.**
    The CSS is fixed at 400 × 588; only Chrome rendering was inspected.
16. **Screen-reader announcements and high-contrast mode.**
    ARIA attributes, live regions, labels, and focus styles are implemented, but no screen reader was run.

### Real-install attempt (2026-10-25)

A real unpacked load was attempted in headless Chrome **156.0.8078.48** with:

```text
--disable-extensions-except="D:\Google Antigravity\YT Extractor\yt-link-extractor"
--load-extension="D:\Google Antigravity\YT Extractor\yt-link-extractor"
```

The browser started and DevTools was reachable, but `chrome.developerPrivate.getExtensionsInfo()` on `chrome://extensions/` returned `[]`. Opening the derived `chrome-extension://.../popup.html` URL produced `ERR_BLOCKED_BY_CLIENT`. The extension was therefore **not registered** by this launch method in this environment.

A matching headless Microsoft Edge **156.0.4314.42** probe with the same flags did not expose a DevTools endpoint within 60 seconds; the process was stopped. Edge unpacked loading remains unverified.

These observations are environment-specific. They do not prove that the extension fails to load manually from the extensions page. The manual checks below are still required.

A failed or not-run item above should not be described as verified elsewhere.

---

## 7. Manual test plan for a real installation

Run these after loading the unpacked extension. Record pass/fail and the browser version.

| ID | Check | Steps | Expected |
| --- | --- | --- | --- |
| M1 | Install | Load the folder on the extensions page | No manifest, service-worker, or icon errors; the Clipfox fox icon appears |
| M2 | Default scan | Open a page with video, Short, live, playlist, channel, and embed links; click the action | Video/Short/live links appear with titles; playlist and channel counts are visible; **All** reveals every readable link; duplicates collapse |
| M3 | Real Copy All | Click Copy All / Copy N, paste into a text editor | One YouTube URL per line, no blank line, count matches the visible set |
| M4 | Filtered copy | Select **All** or **Channels**, click Copy N, paste | Only visible/filtered URLs are copied |
| M5 | Search + no match | Search a known title, then `zzzz` | Matching card remains; **No matching videos** appears; **Clear search** restores results |
| M6 | Per-link actions | Copy one card, copy its `#` ID, then open another | Clipboard receives that URL, then the 11-character ID; a new tab opens the YouTube URL |
| M7 | Protected page | Open `chrome://settings/`, click the action | "This page can't be read"; no scan attempt; no retry button; diagnostics available |
| M8 | Empty page | Open a page with no YouTube links | Empty state and disabled Copy All |
| M9 | Stale hint | On an auto-refreshing page, keep the popup open through a reload | Footer warns that the page changed; Rescan refreshes |
| M10 | Large page | Scan a page with 150+ links | First 100 render; Show more works; Copy All copies the full filtered set |
| M11 | File URL | Enable file access, open a local HTML file with a YouTube link | Link is extracted; if access is off, the guidance message appears |
| M12 | Keyboard | Use `/`, `Ctrl+K`, `Escape`, Tab, Enter | Search focuses/clears; focus is visible; controls activate |
| M13 | Console | Open the popup and DevTools for it | No uncaught exceptions or unexpected errors |
| M14 | Edge/Brave | Repeat M2, M3, M7 on Edge and Brave | Same behavior and sizing |
| M15 | No-video page | Open a page with only channel, playlist, or other YouTube links | **No video links found**; **Show all links** reveals the non-video results |
| M16 | Copy formats | Select each format, click Copy all, paste into a text editor | URLs, Title + URL, Markdown, CSV, JSON, and IDs match the table in the README; IDs skip playlists/channels |
| M17 | Export | Select JSON, click Export; repeat with Markdown and CSV | A file downloads with a `host-clipfox-YYYY-MM-DD.ext` or `clipfox-YYYY-MM-DD.ext` name and the expected extension/content; no download permission prompt |
| M18 | Watch mode | On a page whose embedded player changes, press Watch; change the player; keep the popup open | Results update within a few seconds; the old video disappears; footer starts with `Watching ·`; closing the popup stops polling |
| M19 | Badge | Scan a page, check the toolbar icon; navigate the tab; close the tab | Violet badge shows the link count; clears on navigation; no stale badge on the next page |
| M20 | Settings | Change format, auto-watch, and badge; reopen the popup; reload the extension; click Reset | Choices persist and apply; Reset restores URLs/off/on; badge-off clears open-tab badges |
| M21 | Shortcut | Press `Ctrl+Shift+Y` / `Cmd+Shift+Y` | The popup opens; the shortcut can be changed on the browser's shortcuts page |
| M22 | Udvash main video | Open the exact Udvash class page, click the action | The embedded class player is the first card, shows the violet **Main** badge, and copies as a normal `https://www.youtube.com/watch?v=...` link |
| M23 | Diagnostics | On a restricted or error page, click **Copy diagnostics** and paste | Valid JSON with `extension: "Clipfox"`, extension version `1.4.0`, scanner version `1.1.0`, page context, scan state, watch state, settings, and browser string |
| M24 | Brand and font | Check the toolbar icon, popup header, Settings page, and DevTools network log | Clipfox mark and wordmark render; Space Grotesk loads from the extension; no remote font or brand request |

For M9: Chrome popups normally close when the page loses focus, so the stale hint is most useful for pages that reload themselves while the popup remains open. The harness verifies the listener logic directly.

For M18: Watch mode is intentionally popup-scoped. Verify that closing the popup stops the 3-second probes; it is not a background downloader or notifier.

---

## 8. Reproduce the automated runs

```powershell
cd "D:\Google Antigravity\YT Extractor\yt-link-extractor"
python -m http.server 8123
```

Then open:

1. `http://127.0.0.1:8123/tests/test-runner.html` — expect **All 10 test groups passed**.
2. `http://127.0.0.1:8123/tests/options-harness.html` — expect **5/5 checks passed**.
3. `http://127.0.0.1:8123/tests/background-harness.html` — expect **8/8 checks passed**.
4. `http://127.0.0.1:8123/tests/ui-harness.html?scenario=idle` — expect the ready screen, **Scan this page**, and 0 scan calls.
5. `http://127.0.0.1:8123/tests/ui-harness.html?scenario=default` — the harness clicks Scan and expects 5 video cards, 5 chips/counts, the first card marked **Main**, badge `8`, and no harness error.
6. Switch scenarios with the links at the top: `Ready - not scanned yet`, `No links`, `No videos - 3 other links`, `Restricted page`, `Injection error`, `Large page - 240 links`, `Slow scan - loading state`, `Main video pinned`, `Watch - player changes`, `Auto-watch setting`, `Saved settings - Markdown, no badge`.
7. Add `&plain=1` to hide the harness chrome and inspect the popup at 400 × 588.
8. Open `http://127.0.0.1:8123/brand/preview.html` to inspect the mark and wordmark at scale.

The UI harness cache-busts its popup assets so edits to `popup.js`/`popup.css` are picked up after a refresh. `tests/test-runner.html` version-queries the test scripts. The Watch scenarios intentionally wait about 3.9 seconds for one 3-second polling cycle.

The 2026-10-25 results in this document were recorded in headless Chrome 156.0.8078.48 over the DevTools Protocol. The same pages also run in a normal browser tab.

---

## 9. Known limitations that affect verification

- The harness browser is Chrome 156 headless, while the extension targets Chrome, Edge, and Brave 102+. A harness iframe is also not identical to a toolbar popup.
- The earlier harness loaded its scripts without `defer`, so it did not reproduce a real-popup startup bug where a loading-panel reference was reset after initialization. The harness now uses `defer`; the fixed popup renders results instead of leaving skeleton cards stuck.
- Clipboard, storage, badge, download, and tab APIs are mocked; only argument values, captured file contents, and UI feedback are verified.
- The serialization tests approximate Chrome's function injection by rebuilding the scanner and probe from source. They do not prove every `chrome.scripting` edge case.
- The background harness calls listeners directly; it does not prove the real service worker wakes for navigation events or that badge pixels update.
- Extraction is DOM-based: cross-origin frames, canvas, closed shadow roots, and content not yet in the DOM are outside its reach.
- Watch mode is a polling heuristic, not a media-event listener. A player change that does not alter the page URL or embed URL will not be detected.
- Results are capped; tests verify both normal and truncated paths, but extremely hostile pages can still hit timeouts.
- The error and Watch-failure scenarios intentionally log errors to the console for diagnostics.
- Chrome stable 156 in this environment did not register the unpacked extension when launched with `--load-extension`; a manual extensions-page load is still required. Edge headless probing also did not complete.
- The automated visual checks inspect rendered screenshots; they do not replace a real toolbar popup on Edge or Brave, and they do not cover high-contrast mode, forced colours, 200% zoom, or macOS.

---

## 10. Bottom line

- **Extraction logic:** verified across 10 automated groups, including malformed input, dedupe, canonical URLs, plain text, large pages, embed-source precedence, and scanner/probe serialization.
- **Popup behavior:** verified across all 12 harness scenarios and required states using the real popup assets with mocked browser APIs, including the Clipfox header, main-video pinning, copy formats, Clipfox export filenames, badge suppression, diagnostics version `1.4.0`, and Watch success/failure paths.
- **Settings page:** 5/5 checks pass with the real settings assets, including the Clipfox lockup and version `1.4.0`.
- **Background worker:** 8/8 checks pass, including navigation/close badge clearing, the `#6f5df0` badge colour, and a no-network API source scan.
- **Brand:** the final fox mark, wordmark variants, local Space Grotesk font, PNG icons, popup, and Settings page were visually inspected.
- **Real extension installation and OS-level side effects:** still require the manual checks in section 7. They should be completed before publishing, especially M18 (Watch), M19 (badge), M22 (Udvash), and M24 (brand/font).
