/* Automated extraction tests for Clipfox.
 * Serve the project over HTTP (python -m http.server 8123) and open
 * http://localhost:8123/tests/test-runner.html
 */
(function () {
  'use strict';

  var tests = [];
  var results = [];
  var summaryEl = document.getElementById('summary');
  var listEl = document.getElementById('test-list');
  var metaEl = document.getElementById('run-meta');

  function test(name, fn) {
    tests.push({ name: name, fn: fn });
  }

  function assert(condition, message) {
    if (!condition) throw new Error(message);
  }

  function equal(actual, expected, label) {
    if (actual !== expected) {
      throw new Error(label + ': expected ' + JSON.stringify(expected) + ', received ' + JSON.stringify(actual));
    }
  }

  function includes(array, value, label) {
    if (array.indexOf(value) === -1) {
      throw new Error(label + ': missing ' + JSON.stringify(value));
    }
  }

  async function loadFixture(name) {
    var response = await fetch(name, { cache: 'no-store' });
    if (!response.ok) throw new Error('Could not fetch ' + name + ' (HTTP ' + response.status + ')');
    return response.text();
  }

  async function scanHtml(html, options, scanner) {
    var frame = document.createElement('iframe');
    frame.title = 'Test fixture';
    frame.style.cssText =
      'position:fixed;left:-14000px;top:0;width:1200px;height:900px;border:0;';
    var loaded = new Promise(function (resolve, reject) {
      var timer = setTimeout(function () {
        reject(new Error('Fixture did not finish loading within 5 seconds.'));
      }, 5000);
      frame.addEventListener('load', function () {
        clearTimeout(timer);
        resolve();
      }, { once: true });
    });
    frame.srcdoc = html;
    document.body.appendChild(frame);
    try {
      await loaded;
      var scanOptions = Object.assign({ document: frame.contentDocument }, options || {});
      return (scanner || YTExtractor.scan)(scanOptions);
    } finally {
      frame.remove();
    }
  }

  function urlsOf(scan) {
    return scan.links.map(function (link) { return link.url; });
  }

  function mapByUrl(scan) {
    var map = new Map();
    scan.links.forEach(function (link) { map.set(link.url, link); });
    return map;
  }

  function categoryCounts(scan) {
    var counts = { video: 0, short: 0, live: 0, playlist: 0, channel: 0, other: 0 };
    scan.links.forEach(function (link) {
      if (counts[link.category] !== undefined) counts[link.category]++;
    });
    return counts;
  }

  function makeLargeFixture(count) {
    var items = [];
    for (var i = 0; i < count; i++) {
      var id = 'L' + String(i).padStart(10, '0');
      items.push('<li><a href="https://www.youtube.com/watch?v=' + id + '">Large test video ' + i + '</a></li>');
    }
    return '<!doctype html><html><head><title>Large fixture</title></head><body><ul>' +
      items.join('') + '</ul></body></html>';
  }

  // ------------------------------------------------------------------ tests

  test('Rich fixture: every supported link shape, dedupe, and titles', async function () {
    var html = await loadFixture('fixtures.html');
    var scan = await scanHtml(html);

    assert(scan.ok, 'scan.ok should be true');
    equal(scan.links.length, 21, 'unique link count');

    var counts = categoryCounts(scan);
    equal(JSON.stringify(counts), JSON.stringify({
      video: 12, short: 1, live: 1, playlist: 3, channel: 4, other: 0
    }), 'category counts');

    var urls = urlsOf(scan);
    equal(new Set(urls).size, urls.length, 'all result URLs are unique');

    var expected = [
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://www.youtube.com/watch?v=WithParams1',
      'https://www.youtube.com/watch?v=Redirect123',
      'https://www.youtube.com/watch?v=EncodedID01',
      'https://www.youtube.com/watch?v=ProtoRel001',
      'https://www.youtube.com/watch?v=ImgTitle001',
      'https://www.youtube.com/shorts/aBcDeFgHiJk',
      'https://www.youtube.com/live/LiveStream1',
      'https://www.youtube.com/watch?v=Privacy1234',
      'https://www.youtube.com/playlist?list=PL1234567890abcdef',
      'https://www.youtube.com/playlist?list=PL9988776655443322',
      'https://www.youtube.com/playlist?list=PLtextplaylist123',
      'https://www.youtube.com/@GoogleDevelopers',
      'https://www.youtube.com/channel/UC_x5XG1OV2P6uZZ5FSM9Ttw',
      'https://www.youtube.com/c/SomeCreator',
      'https://www.youtube.com/user/oldschoolcreator',
      'https://www.youtube.com/watch?v=PlainText01',
      'https://www.youtube.com/watch?v=MetaVideo01',
      'https://www.youtube.com/watch?v=MetaVideo02',
      'https://www.youtube.com/watch?v=Canonical01',
      'https://www.youtube.com/watch?v=Structured1'
    ];
    expected.forEach(function (url) { includes(urls, url, 'fixture URL'); });

    var map = mapByUrl(scan);
    equal(map.get('https://www.youtube.com/watch?v=dQw4w9WgXcQ').title,
      'Never Gonna Give You Up (official video)', 'anchor title');
    equal(map.get('https://www.youtube.com/shorts/aBcDeFgHiJk').title,
      'Thumbnail for the test Short', 'image alt title');
    equal(map.get('https://www.youtube.com/live/LiveStream1').title,
      'Community live stream', 'aria-label title');
    equal(map.get('https://www.youtube.com/watch?v=ImgTitle001').title,
      'Image-only link title', 'image-only anchor title');
    equal(map.get('https://www.youtube.com/watch?v=Privacy1234').title,
      'Privacy-enhanced player', 'iframe title');
    equal(map.get('https://www.youtube.com/watch?v=Structured1').title,
      'Structured video title', 'JSON-LD title');
    equal(map.get('https://www.youtube.com/watch?v=Canonical01').title,
      'Fixture article: the best videos', 'Open Graph page title');
    equal(map.get('https://www.youtube.com/watch?v=PlainText01').title,
      'YouTube video \u00b7 PlainText01', 'plain-text fallback title');

    assert(!urls.some(function (url) { return url.indexOf('Injected01') !== -1; }),
      'javascript: link must not be extracted');
    assert(!urls.some(function (url) { return url.indexOf('PLshouldnotwin') !== -1; }),
      'playlist parameter on a watch link must not become a playlist');
    assert(!urls.some(function (url) { return url.indexOf('evil.example') !== -1; }),
      'lookalike hosts must be rejected');
    assert(scan.stats.duplicateCandidates >= 4, 'duplicates should be counted');
  });

  test('Page with no YouTube links returns an empty, successful scan', async function () {
    var scan = await scanHtml(await loadFixture('fixtures-empty.html'));
    assert(scan.ok, 'scan.ok should be true');
    equal(scan.links.length, 0, 'link count');
    equal(scan.stats.detected, 0, 'detected candidate count');
    equal(scan.stats.unique, 0, 'unique count');
  });

  test('Malformed and dangerous URLs are ignored safely', async function () {
    var html = '<!doctype html><html><body>' +
      '<a href="javascript:alert(1)">js</a>' +
      '<a href="https://www.youtube.com/watch?v=">empty v</a>' +
      '<a href="https://youtu.be/">empty short</a>' +
      '<a href="https://youtu.be/short">short id</a>' +
      '<a href="https://www.youtube.com/shorts/%">bad escape</a>' +
      '<a href="https://www.youtube.com/watch?v=%E0%A4%A">broken encoding</a>' +
      '<a href="https://www.youtube.com/watch?v=tooShort">short id</a>' +
      '<a href="https://www.youtube.com/channel/">empty channel</a>' +
      '<a href="https://www.youtube.com/watch?v=SpaceWrap01"> valid after trim </a>' +
      '<a href="https://www.youtube.com/watch?v=OkVideo0001&amp;t=10">query</a>' +
      '</body></html>';

    var scan = await scanHtml(html);
    equal(scan.links.length, 2, 'valid links after malformed input');
    var urls = urlsOf(scan);
    includes(urls, 'https://www.youtube.com/watch?v=SpaceWrap01', 'whitespace-trimmed link');
    includes(urls, 'https://www.youtube.com/watch?v=OkVideo0001', 'valid link with params');
    assert(!urls.some(function (url) { return url.indexOf('tooShort') !== -1; }), 'invalid ID');
    assert(!urls.some(function (url) { return url.indexOf('short') !== -1 && url.indexOf('youtu.be/short') !== -1; }), 'short path ID');
  });

  test('Title precedence and fallbacks are predictable', async function () {
    var pixel = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
    var html = '<!doctype html><html><body>' +
      '<a href="https://www.youtube.com/watch?v=TitleTest01" aria-label="Aria label" title="Title attribute">Visible anchor title</a>' +
      '<a href="https://www.youtube.com/watch?v=TitleTest02" aria-label="Aria label only" title="Title attr"></a>' +
      '<a href="https://www.youtube.com/watch?v=TitleTest03" title="Title attribute only"></a>' +
      '<a href="https://www.youtube.com/watch?v=TitleTest04"><img alt="Image alt only" src="' + pixel + '"></a>' +
      '<a href="https://www.youtube.com/watch?v=TitleTest05">Watch</a>' +
      '</body></html>';

    var scan = await scanHtml(html);
    equal(scan.links.length, 5, 'title test link count');
    var map = mapByUrl(scan);
    equal(map.get('https://www.youtube.com/watch?v=TitleTest01').title, 'Visible anchor title', 'visible text wins');
    equal(map.get('https://www.youtube.com/watch?v=TitleTest02').title, 'Aria label only', 'aria-label fallback');
    equal(map.get('https://www.youtube.com/watch?v=TitleTest03').title, 'Title attribute only', 'title attribute fallback');
    equal(map.get('https://www.youtube.com/watch?v=TitleTest04').title, 'Image alt only', 'image alt fallback');
    equal(map.get('https://www.youtube.com/watch?v=TitleTest05').title, 'YouTube video \u00b7 TitleTest05', 'generic text is replaced by a clean fallback');
  });

  test('Duplicates merge by video ID without merging different videos', async function () {
    var html = '<!doctype html><html><body>' +
      '<a href="https://youtu.be/MergeVid001">Stronger anchor title</a>' +
      '<iframe src="about:blank" data-src="https://www.youtube.com/embed/MergeVid001" title="Embedded title"></iframe>' +
      '<a href="https://www.youtube.com/watch?v=KeepVid0001">A genuinely separate video</a>' +
      '</body></html>';

    var scan = await scanHtml(html);
    equal(scan.links.length, 2, 'merged link count');
    var map = mapByUrl(scan);
    var merged = map.get('https://www.youtube.com/watch?v=MergeVid001');
    assert(merged, 'embed and youtu.be forms must share one canonical URL');
    equal(merged.title, 'Stronger anchor title', 'better title wins');
    equal(merged.source, 'embed', 'embed source overrides an earlier anchor for main-video detection');
    assert(map.get('https://www.youtube.com/watch?v=KeepVid0001'), 'different video remains');
    equal(map.get('https://www.youtube.com/watch?v=KeepVid0001').source, 'link', 'plain anchor keeps the link source');
  });

  test('Large pages are capped and reported as truncated', async function () {
    var scan = await scanHtml(makeLargeFixture(650), { maxLinks: 500, includeText: false });
    equal(scan.links.length, 500, 'stored link cap');
    equal(scan.stats.unique, 650, 'detected unique count');
    equal(scan.stats.truncated, true, 'truncation flag');
    equal(new Set(urlsOf(scan)).size, 500, 'stored URLs are unique');
    assert(scan.stats.elapsedMs >= 0, 'elapsed time is reported');
  });

  test('Visible plain-text URLs respect host boundaries and punctuation', async function () {
    var html = '<!doctype html><html><body><p>' +
      'See (https://youtu.be/TextBound01). Also https://notyoutube.com/watch?v=TextBound02 ' +
      'and https://youtube.com.evil.example/watch?v=TextBound03.' +
      '</p></body></html>';

    var scan = await scanHtml(html);
    equal(scan.links.length, 1, 'only the real YouTube URL is found');
    equal(scan.links[0].url, 'https://www.youtube.com/watch?v=TextBound01', 'canonical plain-text URL');
    equal(scan.links[0].category, 'video', 'plain-text category');
  });

  test('URL shapes map to the right categories and canonical URLs', async function () {
    var html = '<!doctype html><html><body>' +
      '<a href="https://youtu.be/ShapeVideo1">short url</a>' +
      '<a href="https://www.youtube.com/embed/ShapeEmbed1">embed</a>' +
      '<a href="https://www.youtube.com/v/ShapeVee001">old embed</a>' +
      '<a href="https://m.youtube.com/watch?v=MobileVid01">mobile</a>' +
      '<a href="https://music.youtube.com/watch?v=MusicVid001">music</a>' +
      '<a href="https://www.youtube.com/watch?v=WatchList01&amp;list=PLabc123">video in playlist</a>' +
      '<a href="https://www.youtube.com/playlist?list=PLabc123">playlist</a>' +
      '<a href="https://www.youtube.com/@channelhandle/videos">channel tab</a>' +
      '<a href="https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv/videos">channel tab ID</a>' +
      '<a href="https://www.youtube.com/results?search_query=test">search</a>' +
      '<a href="https://www.youtube.com/hashtag/test">hashtag</a>' +
      '<a href="https://www.youtube.com/">home</a>' +
      '</body></html>';

    var scan = await scanHtml(html);
    equal(scan.links.length, 12, 'shape link count');
    var map = mapByUrl(scan);
    assert(map.get('https://www.youtube.com/watch?v=ShapeVideo1'), 'youtu.be canonicalizes to watch');
    assert(map.get('https://www.youtube.com/watch?v=ShapeEmbed1'), '/embed/ canonicalizes to watch');
    assert(map.get('https://www.youtube.com/watch?v=ShapeVee001'), '/v/ canonicalizes to watch');
    assert(map.get('https://www.youtube.com/watch?v=MobileVid01'), 'mobile host');
    assert(map.get('https://www.youtube.com/watch?v=MusicVid001'), 'music host');
    assert(map.get('https://www.youtube.com/watch?v=WatchList01'), 'video keeps watch form');
    assert(!map.get('https://www.youtube.com/watch?v=WatchList01&list=PLabc123'), 'playlist context is stripped');
    assert(map.get('https://www.youtube.com/playlist?list=PLabc123'), 'playlist preserved');
    assert(map.get('https://www.youtube.com/@channelhandle'), 'channel tab uses the channel root');
    assert(map.get('https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv'), 'channel ID tab uses the channel root');
    equal(map.get('https://www.youtube.com/results?search_query=test').category, 'other', 'search category');
    equal(map.get('https://www.youtube.com/hashtag/test').category, 'other', 'hashtag category');
    equal(map.get('https://www.youtube.com/').category, 'other', 'home category');
  });

  test('Scanner source is self-contained and survives function serialization', async function () {
    var source = YTExtractor.scan.toString();
    assert(source.indexOf('function scan(') !== -1, 'scan function source should be available');

    var rebuilt;
    try {
      rebuilt = new Function('return (' + source + ');')();
    } catch (error) {
      throw new Error('The scanner source could not be re-evaluated: ' + error.message);
    }
    equal(typeof rebuilt, 'function', 'rebuilt scanner type');

    var html = '<!doctype html><html><head><title>Serialization fixture</title></head><body>' +
      '<a href="https://youtu.be/Serialize01">Serialized video</a>' +
      '<iframe src="about:blank" data-src="https://www.youtube.com/embed/Serialize02" title="Serialized embed"></iframe>' +
      '</body></html>';

    var scan = await scanHtml(html, { includeText: false }, rebuilt);
    assert(scan.ok, 'serialized scan should succeed');
    equal(scan.links.length, 2, 'serialized scan link count');
    var map = mapByUrl(scan);
    equal(map.get('https://www.youtube.com/watch?v=Serialize01').title,
      'Serialized video', 'serialized anchor title');
    equal(map.get('https://www.youtube.com/watch?v=Serialize02').title,
      'Serialized embed', 'serialized embed title');
  });

  test('Embed probe detects player changes and survives serialization', async function () {
    var htmlA = '<!doctype html><html><head><title>Player probe</title></head><body>' +
      '<a href="https://www.youtube.com/watch?v=AnchorOnly1">A normal anchor</a>' +
      '<a href="https://www.youtube.com/watch?v=ProbeVid002">An earlier anchor for the second player</a>' +
      '<iframe src="about:blank" data-src="https://www.youtube.com/embed/ProbeVid001" title="First player"></iframe>' +
      '<iframe src="about:blank" data-src="https://www.youtube-nocookie.com/embed/ProbeVid002" title="Second player"></iframe>' +
      '</body></html>';

    var scan = await scanHtml(htmlA, { includeText: false });
    equal(scan.links.length, 3, 'scan link count');
    var map = mapByUrl(scan);
    var firstEmbed = map.get('https://www.youtube.com/watch?v=ProbeVid001');
    var secondEmbed = map.get('https://www.youtube.com/watch?v=ProbeVid002');
    equal(firstEmbed.source, 'embed', 'embed source is preserved');
    equal(firstEmbed.embedOrder, 0, 'first embed order');
    equal(secondEmbed.source, 'embed', 'an earlier anchor is upgraded to the embed source');
    equal(secondEmbed.embedOrder, 1, 'second embed order survives deduplication');

    var probe = await scanHtml(htmlA, { maxEmbeds: 10 }, YTExtractor.probeEmbeds);
    assert(probe.ok, 'probe.ok should be true');
    equal(probe.count, 2, 'probe embed count');
    equal(probe.embeds[0].videoId, 'ProbeVid001', 'first embed ID');
    equal(probe.embeds[0].url, 'https://www.youtube.com/watch?v=ProbeVid001', 'first embed URL');
    equal(probe.embeds[0].title, 'First player', 'first embed title');
    equal(probe.embeds[1].videoId, 'ProbeVid002', 'privacy-enhanced embed ID');
    assert(probe.signature.indexOf('ProbeVid001') !== -1, 'signature includes the first player');
    assert(probe.signature.indexOf('ProbeVid002') !== -1, 'signature includes the second player');

    var htmlB = htmlA.replace('embed/ProbeVid002', 'embed/ProbeVid003');
    var probeB = await scanHtml(htmlB, { maxEmbeds: 10 }, YTExtractor.probeEmbeds);
    assert(probeB.signature !== probe.signature, 'signature changes when the player changes');

    var source = YTExtractor.probeEmbeds.toString();
    var rebuilt;
    try {
      rebuilt = new Function('return (' + source + ');')();
    } catch (error) {
      throw new Error('The probe source could not be re-evaluated: ' + error.message);
    }
    var rebuiltProbe = await scanHtml(htmlA, { maxEmbeds: 10 }, rebuilt);
    equal(rebuiltProbe.count, 2, 'serialized probe embed count');
    equal(rebuiltProbe.signature, probe.signature, 'serialized probe signature');
  });

  // ------------------------------------------------------------------ runner

  async function run() {
    var started = Date.now();
    for (var i = 0; i < tests.length; i++) {
      var item = tests[i];
      var row;
      try {
        await item.fn();
        row = { name: item.name, status: 'pass', detail: 'All assertions passed.' };
      } catch (error) {
        row = { name: item.name, status: 'fail', detail: error && error.message ? error.message : String(error) };
        console.error('[test] ' + item.name, error);
      }
      results.push(row);
      renderRow(row, results.length);
    }

    var passed = results.filter(function (row) { return row.status === 'pass'; }).length;
    var failed = results.length - passed;
    var elapsed = Date.now() - started;

    summaryEl.textContent = failed === 0
      ? 'All ' + passed + ' test groups passed'
      : failed + ' of ' + results.length + ' test groups failed';
    summaryEl.className = 'summary ' + (failed === 0 ? 'pass' : 'fail');
    metaEl.textContent = results.length + ' groups \u00b7 ' + elapsed + ' ms';

    window.__YT_TEST_RESULTS__ = {
      passed: passed,
      failed: failed,
      total: results.length,
      elapsedMs: elapsed,
      tests: results
    };
  }

  function renderRow(row, index) {
    var wrapper = document.createElement('li');
    wrapper.className = 'test ' + row.status;

    var badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = row.status === 'pass' ? 'PASS' : 'FAIL';

    var body = document.createElement('div');
    body.className = 'test-body';
    var title = document.createElement('h2');
    title.textContent = (index < 10 ? '0' : '') + index + '  ' + row.name;
    var detail = document.createElement('p');
    detail.textContent = row.detail;
    body.appendChild(title);
    body.appendChild(detail);

    wrapper.appendChild(badge);
    wrapper.appendChild(body);
    listEl.appendChild(wrapper);
  }

  window.addEventListener('DOMContentLoaded', function () {
    run().catch(function (error) {
      summaryEl.textContent = 'Test runner crashed: ' + (error && error.message ? error.message : String(error));
      summaryEl.className = 'summary fail';
      window.__YT_TEST_RESULTS__ = { passed: 0, failed: 1, total: 1, tests: [], error: String(error) };
    });
  });
})();
