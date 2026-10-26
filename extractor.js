/*
 * Clipfox - page scanner
 *
 * `YTExtractor.scan` is injected into the active tab with
 * chrome.scripting.executeScript({ func: YTExtractor.scan }). The function is
 * serialized, so it must stay completely self-contained: every helper and
 * constant it needs lives inside the function body.
 *
 * The scanner only reads the DOM. It never modifies the page, never makes
 * network requests, and only returns plain serializable data.
 */
(function (global) {
  'use strict';

  function scan(options) {
    'use strict';

    var opts = options || {};
    var doc = (opts.document && typeof opts.document.querySelectorAll === 'function')
      ? opts.document
      : (typeof document !== 'undefined' ? document : null);
    var maxLinks = clampInt(opts.maxLinks, 500, 1, 2000);
    var maxCandidates = clampInt(opts.maxCandidates, 8000, 100, 50000);
    var includeText = opts.includeText !== false;
    var includeMetadata = opts.includeMetadata !== false;
    var started = nowMs();

    var VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
    var PLAYLIST_ID = /^[A-Za-z0-9_-]{2,100}$/;
    var CHANNEL_ID = /^[A-Za-z0-9_-]{10,100}$/;
    var CHANNEL_NAME = /^[A-Za-z0-9._-]{2,100}$/;
    var GENERIC_TITLES = {
      'play': 1, 'watch': 1, 'video': 1, 'youtube': 1, 'link': 1, 'here': 1,
      'click here': 1, 'open': 1, 'open link': 1, 'view': 1, 'more': 1, 'go': 1,
      'this video': 1, 'youtube link': 1, 'youtube video': 1, 'youtube player': 1,
      'youtube video player': 1, 'video player': 1, 'embedded video': 1,
      'watch on youtube': 1, 'view on youtube': 1, 'youtube channel': 1,
      'untitled': 1, 'image': 1, 'thumbnail': 1, 'video thumbnail': 1,
      'watch video': 1, 'play video': 1, 'youtube video link': 1
    };

    var stats = {
      detected: 0,
      unique: 0,
      duplicateCandidates: 0,
      candidateCount: 0,
      anchors: 0,
      embeds: 0,
      metadata: 0,
      text: 0,
      scannedElements: 0,
      candidateLimitReached: false,
      truncated: false,
      plainTextEnabled: includeText,
      elapsedMs: 0
    };

    if (!doc) {
      return {
        ok: false,
        error: 'NO_DOCUMENT',
        links: [],
        stats: null,
        pageTitle: '',
        pageUrl: ''
      };
    }

    var entries = Object.create(null);
    var seenKeys = Object.create(null);
    var ordered = [];
    var candidateCount = 0;
    var stopCollecting = false;

    // ---------------------------------------------------------------- helpers

    function nowMs() {
      if (typeof performance !== 'undefined' && performance && typeof performance.now === 'function') {
        return performance.now();
      }
      return Date.now();
    }

    function clampInt(value, fallback, min, max) {
      var number = typeof value === 'number' ? value : parseInt(value, 10);
      if (!isFinite(number)) number = fallback;
      number = Math.floor(number);
      if (number < min) number = min;
      if (number > max) number = max;
      return number;
    }

    function cleanText(value) {
      if (value === null || value === undefined) return '';
      var text = String(value)
        .replace(/[\u0000-\u001F\u007F\u200B-\u200D\uFEFF]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (text.length > 300) text = text.slice(0, 300).trim();
      return text;
    }

    function decodeEntities(value) {
      return String(value).replace(/&(amp|lt|gt|quot|apos|nbsp|#39|#x27);/gi, function (match, entity) {
        var key = entity.toLowerCase();
        if (key === 'amp') return '&';
        if (key === 'lt') return '<';
        if (key === 'gt') return '>';
        if (key === 'quot') return '"';
        if (key === 'nbsp') return ' ';
        return "'";
      });
    }

    function isUsefulTitle(value, rawUrl) {
      var text = cleanText(value);
      if (!text || text.length < 2) return false;
      if (rawUrl && text === rawUrl) return false;
      if (/^(?:https?:\/\/|www\.)/i.test(text)) return false;
      if (GENERIC_TITLES[text.toLowerCase()]) return false;
      return true;
    }

    function pickTitle(values, rawUrl) {
      for (var i = 0; i < values.length; i++) {
        if (isUsefulTitle(values[i], rawUrl)) return cleanText(values[i]);
      }
      return '';
    }

    function queryAll(selector, fallbackSelector) {
      try {
        return doc.querySelectorAll(selector);
      } catch (error) {
        if (!fallbackSelector) return [];
        try {
          return doc.querySelectorAll(fallbackSelector);
        } catch (error2) {
          return [];
        }
      }
    }

    function hostMatches(host, base) {
      return host === base || host.slice(-(base.length + 1)) === '.' + base;
    }

    function parseSegments(url) {
      var source = url.pathname.split('/');
      var segments = [];
      for (var i = 0; i < source.length; i++) {
        if (!source[i]) continue;
        var segment = source[i];
        try {
          segment = decodeURIComponent(segment);
        } catch (error) {
          // Keep the raw segment when it contains malformed escapes.
        }
        segments.push(segment);
      }
      return segments;
    }

    function canonicalOtherUrl(url) {
      var clone;
      try {
        clone = new URL(url.href);
      } catch (error) {
        return url.href;
      }
      clone.hash = '';
      clone.protocol = 'https:';
      var kept = [];
      clone.searchParams.forEach(function (value, name) {
        if (/^(?:si|feature|pp|ab_channel|app|persist_gl|gl|hl|utm_.+)$/i.test(name)) return;
        kept.push([name, value]);
      });
      clone.search = '';
      for (var i = 0; i < kept.length; i++) {
        clone.searchParams.append(kept[i][0], kept[i][1]);
      }
      return clone.href;
    }

    function makeVideoEntry(id, kind) {
      var category = kind === 'short' ? 'short' : (kind === 'live' ? 'live' : 'video');
      var url;
      var fallback;
      if (category === 'short') {
        url = 'https://www.youtube.com/shorts/' + id;
        fallback = 'YouTube Short \u00b7 ' + id;
      } else if (category === 'live') {
        url = 'https://www.youtube.com/live/' + id;
        fallback = 'YouTube live stream \u00b7 ' + id;
      } else {
        url = 'https://www.youtube.com/watch?v=' + id;
        fallback = 'YouTube video \u00b7 ' + id;
      }
      return {
        key: 'v:' + id,
        category: category,
        url: url,
        fallback: fallback
      };
    }

    function makePlaylistEntry(id) {
      return {
        key: 'p:' + id,
        category: 'playlist',
        url: 'https://www.youtube.com/playlist?list=' + encodeURIComponent(id),
        fallback: 'YouTube playlist \u00b7 ' + id
      };
    }

    function makeChannelEntry(path, label) {
      return {
        key: 'c:' + path.toLowerCase(),
        category: 'channel',
        url: 'https://www.youtube.com' + path,
        fallback: 'YouTube channel \u00b7 ' + label
      };
    }

    function makeOtherEntry(url) {
      var href = canonicalOtherUrl(url);
      return {
        key: 'o:' + href,
        category: 'other',
        url: href,
        fallback: 'YouTube link'
      };
    }

    // ------------------------------------------------------------ URL parsing

    function parseYouTubeUrl(rawValue, depth) {
      if (typeof rawValue !== 'string') return null;
      var value = rawValue.trim();
      if (!value || value.length > 4096) return null;

      value = decodeEntities(value);
      value = value.replace(/^[\s"'`<>()[\]{}]+/, '');
      value = value.replace(/[\s"'`<>.,;:!?)\]}|\u00a0]+$/, '');
      if (!value) return null;

      if (/^(?:javascript|data|vbscript|file|chrome|edge|about|mailto|tel):/i.test(value)) {
        return null;
      }

      if (/^\/\//.test(value)) {
        value = (doc.location && doc.location.protocol === 'http:' ? 'http:' : 'https:') + value;
      } else if (/^(?:[a-z0-9-]+\.)*(?:youtube\.com|youtube-nocookie\.com|youtu\.be)(?::\d+)?(?:[\/?#]|$)/i.test(value)) {
        value = 'https://' + value;
      }

      var url;
      try {
        url = new URL(value, doc.baseURI || undefined);
      } catch (error) {
        return null;
      }

      if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
      if (url.username || url.password) return null;

      var host = url.hostname.toLowerCase().replace(/\.$/, '');
      var domain = '';
      if (hostMatches(host, 'youtube.com')) domain = 'youtube.com';
      else if (hostMatches(host, 'youtube-nocookie.com')) domain = 'youtube-nocookie.com';
      else if (hostMatches(host, 'youtu.be')) domain = 'youtu.be';
      if (!domain) return null;

      var segments = parseSegments(url);
      var rawFirst = segments.length ? segments[0] : '';
      var first = rawFirst.toLowerCase();

      if (domain === 'youtu.be') {
        if (segments.length && VIDEO_ID.test(segments[0])) {
          return makeVideoEntry(segments[0], 'video');
        }
        return null;
      }

      if (domain === 'youtube-nocookie.com') {
        if ((first === 'embed' || first === 'v') && segments[1] && VIDEO_ID.test(segments[1])) {
          return makeVideoEntry(segments[1], 'video');
        }
        return null;
      }

      if (first === 'watch') {
        var videoId = url.searchParams.get('v');
        if (videoId && VIDEO_ID.test(videoId.trim())) {
          return makeVideoEntry(videoId.trim(), 'video');
        }
        var watchList = url.searchParams.get('list');
        if (watchList && PLAYLIST_ID.test(watchList)) {
          return makePlaylistEntry(watchList);
        }
        return null;
      }

      if (first === 'shorts' || first === 'live' || first === 'embed' || first === 'v') {
        var id = segments[1] || '';
        if (VIDEO_ID.test(id)) {
          var kind = first === 'shorts' ? 'short' : (first === 'live' ? 'live' : 'video');
          return makeVideoEntry(id, kind);
        }
        if ((first === 'shorts' || first === 'live') && segments.length === 1) {
          return makeOtherEntry(url);
        }
        return null;
      }

      if (first === 'playlist') {
        var list = url.searchParams.get('list');
        if (list && PLAYLIST_ID.test(list)) return makePlaylistEntry(list);
        return null;
      }

      if (first === 'channel') {
        var channelId = segments[1] || '';
        if (CHANNEL_ID.test(channelId)) {
          return makeChannelEntry('/channel/' + encodeURIComponent(channelId), channelId);
        }
        return null;
      }

      if (first === 'c' || first === 'user') {
        var channelName = segments[1] || '';
        if (CHANNEL_NAME.test(channelName)) {
          return makeChannelEntry('/' + first + '/' + encodeURIComponent(channelName), channelName);
        }
        return null;
      }

      if (rawFirst.charAt(0) === '@' && CHANNEL_NAME.test(rawFirst.slice(1))) {
        return makeChannelEntry('/' + rawFirst, rawFirst);
      }

      if (first === 'redirect' && depth < 2) {
        var target = url.searchParams.get('q');
        if (target) return parseYouTubeUrl(target, depth + 1);
        return null;
      }

      if (first === 'attribution_link' && depth < 2) {
        var attributeUrl = url.searchParams.get('u');
        if (attributeUrl) {
          var absolute = attributeUrl.charAt(0) === '/'
            ? 'https://www.youtube.com' + attributeUrl
            : attributeUrl;
          return parseYouTubeUrl(absolute, depth + 1);
        }
        return null;
      }

      return makeOtherEntry(url);
    }

    // -------------------------------------------------------------- collection

    function addCandidate(rawValue, meta) {
      if (stopCollecting) return;
      if (candidateCount >= maxCandidates) {
        stopCollecting = true;
        stats.candidateLimitReached = true;
        return;
      }
      candidateCount++;
      stats.candidateCount++;

      var parsed = parseYouTubeUrl(rawValue, 0);
      if (!parsed) return;

      stats.detected++;

      var rank = typeof meta.rank === 'number' ? meta.rank : 1;
      var title = meta.title && isUsefulTitle(meta.title, parsed.url) ? cleanText(meta.title) : '';
      var embedOrder = typeof meta.embedOrder === 'number' ? meta.embedOrder : null;
      var existing = entries[parsed.key];

      if (seenKeys[parsed.key]) {
        stats.duplicateCandidates++;
        if (existing) {
          if (title && rank > existing.titleRank) {
            existing.title = title;
            existing.titleRank = rank;
          }
          // An embedded player is the strongest signal that this is the page's
          // main video, even when a plain anchor for the same video was seen
          // first. The popup uses the source flag and the embed order to pin
          // the first player in the document, not merely the first duplicate.
          if (meta.source === 'embed') {
            existing.source = 'embed';
            if (embedOrder !== null &&
                (existing.embedOrder === null || embedOrder < existing.embedOrder)) {
              existing.embedOrder = embedOrder;
            }
          }
        }
        return;
      }

      seenKeys[parsed.key] = true;
      stats.unique++;
      if (ordered.length >= maxLinks) {
        stats.truncated = true;
        return;
      }

      var entry = {
        key: parsed.key,
        url: parsed.url,
        category: parsed.category,
        title: title || parsed.fallback,
        titleRank: title ? rank : -1,
        source: meta.source || 'page',
        embedOrder: embedOrder
      };
      entries[parsed.key] = entry;
      ordered.push(entry);
    }

    function pickElementTitle(element) {
      var values = [];
      try {
        values.push(element.textContent);
      } catch (error) {
        // Ignore hostile/broken elements.
      }
      values.push(element.getAttribute('aria-label'));
      values.push(element.getAttribute('title'));
      try {
        var image = element.querySelector ? element.querySelector('img[alt]') : null;
        if (image) values.push(image.getAttribute('alt'));
      } catch (error) {
        // Ignore.
      }
      return pickTitle(values);
    }

    // Anchors and image-map areas.
    var anchorNodes = queryAll(
      'a[href*="youtu" i], area[href*="youtu" i]',
      'a[href], area[href]'
    );
    for (var a = 0; a < anchorNodes.length && !stopCollecting; a++) {
      var anchor = anchorNodes[a];
      var href = anchor.getAttribute('href');
      if (!href || !/youtu/i.test(href)) continue;
      stats.anchors++;
      stats.scannedElements++;
      addCandidate(href, {
        title: pickElementTitle(anchor),
        rank: 3,
        source: 'link'
      });
    }

    // Anchors that keep their destination in a data attribute (SPA patterns).
    var dataNodes = queryAll('a[data-href*="youtu" i]', null);
    for (var d = 0; d < dataNodes.length && !stopCollecting; d++) {
      var dataAnchor = dataNodes[d];
      var dataHref = dataAnchor.getAttribute('data-href');
      if (!dataHref || !/youtu/i.test(dataHref)) continue;
      stats.anchors++;
      stats.scannedElements++;
      addCandidate(dataHref, {
        title: pickElementTitle(dataAnchor),
        rank: 3,
        source: 'link'
      });
    }

    // Embedded players and media elements.
    var embedNodes = queryAll(
      'iframe[src*="youtu" i], iframe[data-src*="youtu" i], embed[src*="youtu" i], object[data*="youtu" i], video[src*="youtu" i], source[src*="youtu" i]',
      'iframe, embed, object, video, source'
    );
    for (var e = 0; e < embedNodes.length && !stopCollecting; e++) {
      var embed = embedNodes[e];
      var embedUrl = '';
      var embedAttributes = ['src', 'data-src', 'data'];
      for (var ea = 0; ea < embedAttributes.length; ea++) {
        var attributeValue = embed.getAttribute(embedAttributes[ea]);
        if (attributeValue && /youtu/i.test(attributeValue)) {
          embedUrl = attributeValue;
          break;
        }
      }
      if (!embedUrl) continue;
      stats.embeds++;
      stats.scannedElements++;
      addCandidate(embedUrl, {
        title: pickTitle([
          embed.getAttribute('title'),
          embed.getAttribute('aria-label'),
          embed.getAttribute('name')
        ]),
        rank: 2,
        source: 'embed',
        embedOrder: e
      });
    }

    // Metadata and structured data.
    if (includeMetadata) {
      var pageTitle = pickTitle([
        metaByName('property', 'og:title'),
        metaByName('name', 'twitter:title'),
        cleanText(doc.title)
      ]);

      var metaNodes = queryAll('meta[content*="youtu" i]', 'meta[content]');
      for (var m = 0; m < metaNodes.length && !stopCollecting; m++) {
        var metaTag = metaNodes[m];
        var content = metaTag.getAttribute('content');
        if (!content || !/youtu/i.test(content)) continue;
        stats.metadata++;
        stats.scannedElements++;
        addCandidate(content, {
          title: pageTitle,
          rank: 2,
          source: 'meta'
        });
      }

      var linkNodes = queryAll('link[href*="youtu" i]', 'link[href]');
      for (var l = 0; l < linkNodes.length && !stopCollecting; l++) {
        var linkTag = linkNodes[l];
        var rel = (linkTag.getAttribute('rel') || '').toLowerCase();
        if (!/(^|\s)(canonical|alternate|shortlink|me|author|video_src)(\s|$)/.test(rel)) continue;
        var linkHref = linkTag.getAttribute('href');
        if (!linkHref || !/youtu/i.test(linkHref)) continue;
        stats.metadata++;
        stats.scannedElements++;
        addCandidate(linkHref, {
          title: pageTitle,
          rank: 2,
          source: 'meta'
        });
      }

      scanJsonLd(pageTitle);

      function metaByName(attribute, name) {
        var nodes = queryAll('meta[' + attribute + '="' + name + '"]', null);
        return nodes.length ? cleanText(nodes[0].getAttribute('content')) : '';
      }

      function scanJsonLd(fallbackTitle) {
        var scripts = queryAll('script[type="application/ld+json"]', null);
        var budget = 700;
        for (var s = 0; s < scripts.length && budget > 0 && !stopCollecting; s++) {
          var raw = scripts[s].textContent || '';
          if (!raw || raw.length > 500000) continue;
          if (raw.toLowerCase().indexOf('youtu') === -1) continue;

          var data;
          try {
            data = JSON.parse(raw);
          } catch (error) {
            continue;
          }

          walk(data, 0);

          function walk(node, depth) {
            if (!node || depth > 8 || budget <= 0 || stopCollecting) return;
            budget--;

            if (Array.isArray(node)) {
              for (var index = 0; index < node.length && budget > 0 && !stopCollecting; index++) {
                walk(node[index], depth + 1);
              }
              return;
            }
            if (typeof node !== 'object') return;

            var itemTitle = pickTitle([node.name, node.headline]) || fallbackTitle;
            var urlKeys = ['url', 'contentUrl', 'embedUrl', 'sameAs', '@id'];
            for (var u = 0; u < urlKeys.length; u++) {
              var candidate = node[urlKeys[u]];
              if (typeof candidate === 'string' && /youtu/i.test(candidate)) {
                addCandidate(candidate, { title: itemTitle, rank: 2, source: 'meta' });
              }
            }

            if (typeof node.videoID === 'string' && VIDEO_ID.test(node.videoID.trim())) {
              addCandidate('https://www.youtube.com/watch?v=' + node.videoID.trim(), {
                title: itemTitle,
                rank: 2,
                source: 'meta'
              });
            }

            var keys = Object.keys(node);
            for (var keyIndex = 0; keyIndex < keys.length && !stopCollecting; keyIndex++) {
              var keyName = keys[keyIndex];
              if (keyName === 'thumbnailUrl') continue;
              var child = node[keyName];
              if (child && typeof child === 'object') walk(child, depth + 1);
            }
          }
        }
      }
    }

    // Visible plain-text URLs. This is intentionally a best-effort pass.
    if (includeText && !stopCollecting) {
      var pageText = '';
      try {
        if (doc.body) {
          pageText = doc.body.innerText || doc.body.textContent || '';
        } else if (doc.documentElement) {
          pageText = doc.documentElement.textContent || '';
        }
      } catch (error) {
        pageText = '';
      }

      if (pageText) {
        if (pageText.length > 600000) pageText = pageText.slice(0, 600000);
        var textPattern = /(?<![\w.-])(?:https?:\/\/)?(?:[a-z0-9-]+\.)*(?:youtube\.com|youtube-nocookie\.com|youtu\.be)(?::\d+)?\/[^\s<>"'`|\\]*/gi;
        var matches = 0;
        var match;
        while ((match = textPattern.exec(pageText)) !== null && matches < 1500 && !stopCollecting) {
          matches++;
          stats.text++;
          addCandidate(match[0], {
            title: '',
            rank: 0,
            source: 'text'
          });
        }
      }
    }

    stats.unique = Math.max(stats.unique, Object.keys(entries).length);
    stats.truncated = stats.truncated ||
      stats.unique > ordered.length ||
      stats.candidateLimitReached;
    stats.elapsedMs = Math.round((nowMs() - started) * 10) / 10;

    var links = [];
    for (var i = 0; i < ordered.length; i++) {
      var entry = ordered[i];
      links.push({
        key: entry.key,
        url: entry.url,
        title: entry.title,
        category: entry.category,
        source: entry.source,
        embedOrder: entry.embedOrder
      });
    }

    return {
      ok: true,
      links: links,
      stats: stats,
      pageTitle: cleanText(doc.title),
      pageUrl: String(doc.URL || (doc.location && doc.location.href) || ''),
      limit: maxLinks
    };
  }

  /*
   * Lightweight player probe used by Watch mode. It only looks at embedded
   * player elements, so it can run every few seconds without re-reading the
   * whole page. Like `scan`, this function is serialized for injection and
   * must stay completely self-contained.
   */
  function probeEmbeds(options) {
    'use strict';

    var opts = options || {};
    var doc = (opts.document && typeof opts.document.querySelectorAll === 'function')
      ? opts.document
      : (typeof document !== 'undefined' ? document : null);
    var maxEmbeds = clampProbeInt(opts.maxEmbeds, 50, 1, 200);

    if (!doc) {
      return {
        ok: false,
        error: 'NO_DOCUMENT',
        embeds: [],
        count: 0,
        signature: '',
        pageTitle: '',
        pageUrl: ''
      };
    }

    var VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
    var embeds = [];
    var scanned = 0;

    function clampProbeInt(value, fallback, min, max) {
      var number = typeof value === 'number' ? value : parseInt(value, 10);
      if (!isFinite(number)) number = fallback;
      number = Math.floor(number);
      if (number < min) number = min;
      if (number > max) number = max;
      return number;
    }

    function cleanProbeText(value) {
      if (value === null || value === undefined) return '';
      var text = String(value)
        .replace(/[\u0000-\u001F\u007F\u200B-\u200D\uFEFF]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      return text.length > 300 ? text.slice(0, 300).trim() : text;
    }

    function probeHostMatches(host, base) {
      return host === base || host.slice(-(base.length + 1)) === '.' + base;
    }

    function probeDecode(value) {
      return String(value).replace(/&(amp|quot|#39|#x27);/gi, function (match, entity) {
        var key = entity.toLowerCase();
        if (key === 'amp') return '&';
        if (key === 'quot') return '"';
        return "'";
      });
    }

    function parsePlayerUrl(rawValue) {
      if (typeof rawValue !== 'string') return null;
      var value = probeDecode(rawValue).trim();
      if (!value || value.length > 4096) return null;
      if (/^(?:javascript|data|vbscript|file|chrome|edge|about|mailto|tel):/i.test(value)) return null;

      if (/^\/\//.test(value)) {
        value = 'https:' + value;
      } else if (/^(?:[a-z0-9-]+\.)*(?:youtube\.com|youtube-nocookie\.com|youtu\.be)(?::\d+)?(?:[\/?#]|$)/i.test(value)) {
        value = 'https://' + value;
      }

      var url;
      try {
        url = new URL(value, doc.baseURI || undefined);
      } catch (error) {
        return null;
      }
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
      if (url.username || url.password) return null;

      var host = url.hostname.toLowerCase().replace(/\.$/, '');
      var domain = '';
      if (probeHostMatches(host, 'youtube.com')) domain = 'youtube.com';
      else if (probeHostMatches(host, 'youtube-nocookie.com')) domain = 'youtube-nocookie.com';
      else if (probeHostMatches(host, 'youtu.be')) domain = 'youtu.be';
      if (!domain) return null;

      var segments = [];
      var rawSegments = url.pathname.split('/');
      for (var i = 0; i < rawSegments.length; i++) {
        if (!rawSegments[i]) continue;
        var segment = rawSegments[i];
        try {
          segment = decodeURIComponent(segment);
        } catch (error) {
          // Keep the raw segment.
        }
        segments.push(segment);
      }

      var id = '';
      var first = segments.length ? segments[0].toLowerCase() : '';
      var category = 'video';

      if (domain === 'youtu.be') {
        id = segments[0] || '';
      } else if (domain === 'youtube-nocookie.com') {
        if (first === 'embed' || first === 'v') id = segments[1] || '';
      } else if (first === 'watch') {
        id = (url.searchParams.get('v') || '').trim();
      } else if (first === 'embed' || first === 'v' || first === 'shorts' || first === 'live') {
        id = segments[1] || '';
        if (first === 'shorts') category = 'short';
        else if (first === 'live') category = 'live';
      }

      if (!VIDEO_ID.test(id)) return null;

      var canonical = category === 'short'
        ? 'https://www.youtube.com/shorts/' + id
        : (category === 'live'
          ? 'https://www.youtube.com/live/' + id
          : 'https://www.youtube.com/watch?v=' + id);

      return {
        key: 'v:' + id,
        videoId: id,
        category: category,
        url: canonical
      };
    }

    var nodes = [];
    try {
      nodes = doc.querySelectorAll(
        'iframe[src*="youtu" i], iframe[data-src*="youtu" i], embed[src*="youtu" i], object[data*="youtu" i], video[src*="youtu" i], source[src*="youtu" i]'
      );
    } catch (error) {
      nodes = [];
    }

    for (var n = 0; n < nodes.length && embeds.length < maxEmbeds; n++) {
      var node = nodes[n];
      scanned++;
      var attributes = ['src', 'data-src', 'data'];
      var raw = '';
      var attributeName = '';
      for (var a = 0; a < attributes.length; a++) {
        var candidate = node.getAttribute(attributes[a]);
        if (candidate && /youtu/i.test(candidate)) {
          raw = candidate;
          attributeName = attributes[a];
          break;
        }
      }
      if (!raw) continue;

      var parsed = parsePlayerUrl(raw);
      if (!parsed) continue;

      var title = '';
      try {
        title = cleanProbeText(node.getAttribute('title')) ||
          cleanProbeText(node.getAttribute('aria-label')) ||
          cleanProbeText(node.getAttribute('name'));
      } catch (error) {
        title = '';
      }

      embeds.push({
        key: parsed.key,
        videoId: parsed.videoId,
        category: parsed.category,
        url: parsed.url,
        title: title,
        attribute: attributeName
      });
    }

    var pageUrl = String(doc.URL || (doc.location && doc.location.href) || '');
    var signatureParts = [pageUrl];
    for (var e = 0; e < embeds.length; e++) {
      signatureParts.push(embeds[e].category + ':' + embeds[e].videoId);
    }

    return {
      ok: true,
      embeds: embeds,
      count: embeds.length,
      signature: signatureParts.join('|'),
      pageTitle: cleanProbeText(doc.title),
      pageUrl: pageUrl
    };
  }

  var api = {
    scan: scan,
    probeEmbeds: probeEmbeds,
    version: '1.1.0'
  };

  global.YTExtractor = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
