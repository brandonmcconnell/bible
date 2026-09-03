/*
 * The Bible on Mintlify — reader script.
 *
 * Mintlify injects every .js file in the content directory into every page, so
 * this file runs site-wide. It only does work when a `.bible-chapter` element
 * is present. Features:
 *   - a toolbar with a translation switcher (same book/chapter in another
 *     translation), text size controls and toggles for verse numbers,
 *     footnotes, headings, cross references, red-letter text and serif font;
 *   - verse selection with copy-with-reference and a cross-reference panel;
 *   - #v5 / #v5-8 deep links and ←/→ keyboard chapter navigation.
 * Settings persist in localStorage and are applied as classes on <html> so the
 * stylesheet does the actual work.
 */
(function bibleReader() {
  'use strict';

  var STORAGE_KEY = 'bible.reader.settings.v1';
  var DEFAULTS = {
    fontScale: 1,
    verseNumbers: true,
    footnotes: true,
    headings: true,
    xrefs: false,
    redLetter: true,
    serif: true
  };
  var CLASS_FOR = {
    verseNumbers: { off: 'bible-hide-verse-numbers' },
    footnotes: { off: 'bible-hide-footnotes' },
    headings: { off: 'bible-hide-headings' },
    xrefs: { on: 'bible-show-xrefs' },
    redLetter: { off: 'bible-no-red-letter' },
    serif: { off: 'bible-sans' }
  };
  var FONT_MIN = 0.8;
  var FONT_MAX = 1.7;
  var FONT_STEP = 0.1;

  var settings = loadSettings();
  var xrefCache = {};
  var scheduled = 0;

  applySettings();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', schedule);
  } else {
    schedule();
  }
  document.addEventListener('bible:manifest', schedule);
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('hashchange', function () {
    var chapter = currentChapter();
    if (chapter) applyHash(chapter);
  });
  document.addEventListener('keydown', onKeyDown);

  // -------------------------------------------------------------------------
  // Settings
  // -------------------------------------------------------------------------

  function loadSettings() {
    var result = {};
    for (var key in DEFAULTS) result[key] = DEFAULTS[key];
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        for (var k in DEFAULTS) {
          if (typeof parsed[k] === typeof DEFAULTS[k]) result[k] = parsed[k];
        }
      }
    } catch (error) {
      /* localStorage unavailable (private mode, etc.) — keep defaults */
    }
    return result;
  }

  function saveSettings() {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch (error) {
      /* ignore */
    }
  }

  function applySettings() {
    var root = document.documentElement;
    root.style.setProperty('--bible-font-scale', String(settings.fontScale));
    for (var key in CLASS_FOR) {
      var spec = CLASS_FOR[key];
      if (spec.on) root.classList.toggle(spec.on, settings[key]);
      if (spec.off) root.classList.toggle(spec.off, !settings[key]);
    }
    var toolbar = document.querySelector('.bible-toolbar');
    if (toolbar) refreshToolbar(toolbar);
  }

  function setSetting(key, value) {
    settings[key] = value;
    saveSettings();
    applySettings();
  }

  // -------------------------------------------------------------------------
  // Bootstrapping per page
  // -------------------------------------------------------------------------

  function schedule() {
    if (scheduled) return;
    scheduled = window.requestAnimationFrame(function () {
      scheduled = 0;
      init();
    });
  }

  function currentChapter() {
    return document.querySelector('.bible-chapter');
  }

  function init() {
    var chapter = currentChapter();
    var actions = document.getElementById('bible-actions');
    if (!chapter) {
      if (actions) actions.hidden = true;
      hidePanel();
      return;
    }
    if (chapter.getAttribute('data-bible-ready') === '1') return;
    chapter.setAttribute('data-bible-ready', '1');
    if (actions) {
      actions.hidden = true;
      hidePanel();
    }
    buildToolbar(chapter);
    wireVerses(chapter);
    applyHash(chapter);
  }

  function manifest() {
    return window.BIBLE_MANIFEST || null;
  }

  function context(chapter) {
    var lang = chapter.getAttribute('data-lang') || 'en';
    var m = manifest();
    var language = m && m.languages ? m.languages[lang] : null;
    var translationSlug = chapter.getAttribute('data-translation') || '';
    return {
      lang: lang,
      language: language,
      ui: language ? language.ui : {},
      translationSlug: translationSlug,
      translation: language && language.translations ? language.translations[translationSlug] : null,
      translationLabel: chapter.getAttribute('data-translation-label') || translationSlug.toUpperCase(),
      bookId: chapter.getAttribute('data-book') || '',
      bookSlug: chapter.getAttribute('data-book-slug') || '',
      bookName: chapter.getAttribute('data-book-name') || '',
      chapter: Number(chapter.getAttribute('data-chapter') || '0'),
      manifest: m
    };
  }

  function t(ui, key, fallback) {
    return ui && typeof ui[key] === 'string' ? ui[key] : fallback;
  }

  // -------------------------------------------------------------------------
  // Toolbar
  // -------------------------------------------------------------------------

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      for (var name in attrs) {
        if (name === 'text') node.textContent = attrs[name];
        else if (name === 'html') node.innerHTML = attrs[name];
        else node.setAttribute(name, attrs[name]);
      }
    }
    if (children) {
      for (var i = 0; i < children.length; i += 1) node.appendChild(children[i]);
    }
    return node;
  }

  function buildToolbar(chapter) {
    var ctx = context(chapter);
    var ui = ctx.ui;
    var toolbar = el('div', { class: 'bible-toolbar', role: 'toolbar', 'aria-label': t(ui, 'readingTools', 'Reading tools') });

    // Translation switcher
    if (ctx.language && ctx.language.translations) {
      var select = el('select', { 'aria-label': t(ui, 'translation', 'Translation'), class: 'bt-translation' });
      var slugs = Object.keys(ctx.language.translations);
      for (var i = 0; i < slugs.length; i += 1) {
        var tr = ctx.language.translations[slugs[i]];
        var option = el('option', { value: slugs[i], text: tr.label + ' — ' + tr.name });
        if (slugs[i] === ctx.translationSlug) option.selected = true;
        select.appendChild(option);
      }
      select.addEventListener('change', function () {
        switchTranslation(ctx, select.value);
      });
      toolbar.appendChild(el('div', { class: 'bt-group' }, [select]));
    }

    // Font size
    var smaller = el('button', { type: 'button', text: 'A', 'aria-label': t(ui, 'fontSize', 'Text size') + ' −', title: t(ui, 'fontSize', 'Text size') + ' −' });
    var larger = el('button', { type: 'button', text: 'A', 'aria-label': t(ui, 'fontSize', 'Text size') + ' +', title: t(ui, 'fontSize', 'Text size') + ' +' });
    smaller.addEventListener('click', function () {
      setSetting('fontScale', clamp(round1(settings.fontScale - FONT_STEP), FONT_MIN, FONT_MAX));
    });
    larger.addEventListener('click', function () {
      setSetting('fontScale', clamp(round1(settings.fontScale + FONT_STEP), FONT_MIN, FONT_MAX));
    });
    toolbar.appendChild(el('div', { class: 'bt-group bt-font' }, [smaller, larger]));

    // Toggles
    var toggles = el('div', { class: 'bt-group bt-toggles' });
    toggles.appendChild(toggleButton('verseNumbers', t(ui, 'verseNumbers', 'Verse numbers')));
    toggles.appendChild(toggleButton('footnotes', t(ui, 'footnotes', 'Footnotes')));
    toggles.appendChild(toggleButton('headings', t(ui, 'headings', 'Headings')));
    if (ctx.manifest && ctx.manifest.xrefBaseUrls && ctx.manifest.xrefBaseUrls.length > 0) {
      toggles.appendChild(toggleButton('xrefs', t(ui, 'crossReferences', 'Cross references')));
    }
    if (chapter.querySelector('.woj')) {
      toggles.appendChild(toggleButton('redLetter', t(ui, 'redLetter', 'Words of Jesus in red')));
    }
    toggles.appendChild(toggleButton('serif', t(ui, 'serifFont', 'Serif font')));
    toolbar.appendChild(toggles);

    toolbar.appendChild(el('div', { class: 'bt-spacer' }));

    var reset = el('button', { type: 'button', class: 'bt-icon', text: '↺', title: t(ui, 'resetSettings', 'Reset reading settings'), 'aria-label': t(ui, 'resetSettings', 'Reset reading settings') });
    reset.addEventListener('click', function () {
      for (var key in DEFAULTS) settings[key] = DEFAULTS[key];
      saveSettings();
      applySettings();
    });
    toolbar.appendChild(reset);

    chapter.insertBefore(toolbar, chapter.firstChild);
    refreshToolbar(toolbar);
  }

  function toggleButton(key, label) {
    var button = el('button', { type: 'button', text: label, 'data-setting': key, 'aria-pressed': String(Boolean(settings[key])) });
    button.addEventListener('click', function () {
      setSetting(key, !settings[key]);
    });
    return button;
  }

  function refreshToolbar(toolbar) {
    var buttons = toolbar.querySelectorAll('button[data-setting]');
    for (var i = 0; i < buttons.length; i += 1) {
      var key = buttons[i].getAttribute('data-setting');
      buttons[i].setAttribute('aria-pressed', String(Boolean(settings[key])));
    }
  }

  function switchTranslation(ctx, targetSlug) {
    if (!ctx.language || targetSlug === ctx.translationSlug) return;
    var target = ctx.language.translations[targetSlug];
    if (!target) return;
    var base = '/' + ctx.lang + '/' + targetSlug;
    var book = target.books ? target.books[ctx.bookId] : null;
    var url = base;
    if (book) {
      url = base + '/' + ctx.bookSlug;
      if (hasChapter(chapterSpec(ctx, ctx.bookId, book), ctx.chapter)) url += '/' + ctx.chapter + window.location.hash;
    }
    window.location.assign(url);
  }

  /** Resolves a book's chapter spec: the translation's own, or the shared default. */
  function chapterSpec(ctx, bookId, book) {
    if (book && book.c !== undefined) return book.c;
    if (ctx.manifest && ctx.manifest.bookChapters) return ctx.manifest.bookChapters[bookId];
    return undefined;
  }

  function hasChapter(spec, chapter) {
    if (typeof spec === 'number') return chapter >= 1 && chapter <= spec;
    return Array.isArray(spec) && spec.indexOf(chapter) !== -1;
  }

  // -------------------------------------------------------------------------
  // Verse selection, copy, cross references
  // -------------------------------------------------------------------------

  function wireVerses(chapter) {
    chapter.addEventListener('click', function (event) {
      var target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest('a, button, select, sup.fn')) return;
      var verse = target.closest('.v');
      if (!verse || !chapter.contains(verse)) return;
      var number = verse.getAttribute('data-v');
      var selected = !verse.classList.contains('is-selected');
      var all = chapter.querySelectorAll('.v[data-v="' + number + '"]');
      for (var i = 0; i < all.length; i += 1) all[i].classList.toggle('is-selected', selected);
      updateActions(chapter);
    });
  }

  function selectedVerseNumbers(chapter) {
    var nodes = chapter.querySelectorAll('.v.is-selected:not(.vc)');
    var numbers = [];
    for (var i = 0; i < nodes.length; i += 1) numbers.push(Number(nodes[i].getAttribute('data-v')));
    numbers.sort(function (a, b) {
      return a - b;
    });
    return numbers;
  }

  function formatRange(numbers) {
    if (numbers.length === 0) return '';
    var parts = [];
    var start = numbers[0];
    var prev = numbers[0];
    for (var i = 1; i <= numbers.length; i += 1) {
      var n = numbers[i];
      if (n === prev + 1) {
        prev = n;
        continue;
      }
      parts.push(start === prev ? String(start) : start + '–' + prev);
      start = n;
      prev = n;
    }
    return parts.join(', ');
  }

  function reference(ctx, numbers) {
    return ctx.bookName + ' ' + ctx.chapter + (numbers.length ? ':' + formatRange(numbers) : '');
  }

  function verseText(chapter, number) {
    var nodes = chapter.querySelectorAll('.v[data-v="' + number + '"]');
    var text = '';
    for (var i = 0; i < nodes.length; i += 1) {
      var clone = nodes[i].cloneNode(true);
      var notes = clone.querySelectorAll('sup.fn');
      for (var j = 0; j < notes.length; j += 1) notes[j].parentNode.removeChild(notes[j]);
      var breaks = clone.querySelectorAll('br');
      for (var k = 0; k < breaks.length; k += 1) breaks[k].replaceWith(document.createTextNode(' '));
      text += ' ' + clone.textContent;
    }
    return text.replace(/\s+/g, ' ').trim();
  }

  function ensureActions() {
    var actions = document.getElementById('bible-actions');
    if (actions) return actions;
    actions = el('div', { id: 'bible-actions', class: 'bible-actions', role: 'region' });
    actions.hidden = true;
    document.body.appendChild(actions);
    return actions;
  }

  function updateActions(chapter) {
    var ctx = context(chapter);
    var ui = ctx.ui;
    var numbers = selectedVerseNumbers(chapter);
    var actions = ensureActions();
    if (numbers.length === 0) {
      actions.hidden = true;
      hidePanel();
      return;
    }
    actions.innerHTML = '';
    var ref = reference(ctx, numbers);
    actions.appendChild(el('span', { class: 'ba-ref', text: ref + ' · ' + ctx.translationLabel }));

    var copy = el('button', { type: 'button', class: 'ba-primary', text: t(ui, 'copy', 'Copy') });
    copy.addEventListener('click', function () {
      var lines = [];
      for (var i = 0; i < numbers.length; i += 1) lines.push(numbers[i] + ' ' + verseText(chapter, numbers[i]));
      var url = window.location.origin + window.location.pathname + '#v' + numbers[0] + (numbers.length > 1 ? '-' + numbers[numbers.length - 1] : '');
      var payload = lines.join('\n') + '\n— ' + ref + ' (' + ctx.translationLabel + ')\n' + url;
      copyText(payload).then(function () {
        copy.textContent = t(ui, 'copied', 'Copied');
        window.setTimeout(function () {
          copy.textContent = t(ui, 'copy', 'Copy');
        }, 1400);
      });
    });
    actions.appendChild(copy);

    if (ctx.manifest && ctx.manifest.xrefBaseUrls && ctx.manifest.xrefBaseUrls.length > 0 && numbers.length === 1) {
      var xrefButton = el('button', { type: 'button', text: t(ui, 'crossReferences', 'Cross references') });
      xrefButton.addEventListener('click', function () {
        showCrossReferences(ctx, numbers[0]);
      });
      actions.appendChild(xrefButton);
    }

    var link = el('button', { type: 'button', text: '#' });
    link.setAttribute('aria-label', 'Link');
    link.addEventListener('click', function () {
      var hash = '#v' + numbers[0] + (numbers.length > 1 ? '-' + numbers[numbers.length - 1] : '');
      window.history.replaceState(null, '', hash);
      copyText(window.location.href);
    });
    actions.appendChild(link);

    var clear = el('button', { type: 'button', text: '✕' });
    clear.setAttribute('aria-label', 'Clear');
    clear.addEventListener('click', function () {
      clearSelection(chapter);
    });
    actions.appendChild(clear);
    actions.hidden = false;
  }

  function clearSelection(chapter) {
    var nodes = chapter.querySelectorAll('.v.is-selected');
    for (var i = 0; i < nodes.length; i += 1) nodes[i].classList.remove('is-selected');
    updateActions(chapter);
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).catch(function () {
        return legacyCopy(text);
      });
    }
    return Promise.resolve(legacyCopy(text));
  }

  function legacyCopy(text) {
    var area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    try {
      document.execCommand('copy');
    } catch (error) {
      /* ignore */
    }
    document.body.removeChild(area);
  }

  function ensurePanel() {
    var panel = document.getElementById('bible-panel');
    if (panel) return panel;
    panel = el('div', { id: 'bible-panel', class: 'bible-panel', role: 'dialog' });
    panel.hidden = true;
    document.body.appendChild(panel);
    document.addEventListener('click', function (event) {
      if (panel.hidden) return;
      var target = event.target;
      if (!(target instanceof Element)) return;
      if (panel.contains(target) || target.closest('#bible-actions')) return;
      hidePanel();
    });
    return panel;
  }

  function hidePanel() {
    var panel = document.getElementById('bible-panel');
    if (panel) panel.hidden = true;
  }

  function showCrossReferences(ctx, verse) {
    var panel = ensurePanel();
    var ui = ctx.ui;
    panel.innerHTML = '';
    panel.appendChild(el('h3', { text: t(ui, 'crossReferences', 'Cross references') + ' · ' + reference(ctx, [verse]) }));
    var status = el('p', { class: 'bp-empty', text: '…' });
    panel.appendChild(status);
    panel.hidden = false;

    loadCrossReferences(ctx, ctx.bookId, ctx.chapter).then(function (data) {
      var refs = data && data[String(verse)] ? data[String(verse)] : [];
      panel.removeChild(status);
      if (refs.length === 0) {
        panel.appendChild(el('p', { class: 'bp-empty', text: '—' }));
        return;
      }
      var list = el('ul');
      for (var i = 0; i < refs.length; i += 1) {
        var ref = refs[i];
        var label = bookName(ctx, ref[0]) + ' ' + ref[1] + ':' + ref[2] + (ref[3] && ref[3] !== ref[2] ? '–' + ref[3] : '');
        var href = referenceUrl(ctx, ref[0], ref[1], ref[2]);
        var anchor = href ? el('a', { href: href, text: label }) : el('span', { text: label });
        var item = el('li');
        item.appendChild(anchor);
        list.appendChild(item);
      }
      panel.appendChild(list);
    });
  }

  function bookName(ctx, bookId) {
    if (ctx.translation && ctx.translation.books && ctx.translation.books[bookId] && ctx.translation.books[bookId].n) {
      return ctx.translation.books[bookId].n;
    }
    if (ctx.manifest && ctx.manifest.bookNames && ctx.manifest.bookNames[bookId]) return ctx.manifest.bookNames[bookId];
    return bookId;
  }

  function referenceUrl(ctx, bookId, chapter, verse) {
    if (!ctx.manifest || !ctx.language) return null;
    var slug = ctx.manifest.bookSlugs ? ctx.manifest.bookSlugs[bookId] : null;
    if (!slug) return null;
    var translationSlug = ctx.translationSlug;
    var translation = ctx.translation;
    if (!translation || !translation.books[bookId]) {
      // Fall back to the language's default translation when this one lacks the book.
      translationSlug = ctx.language.default;
      translation = ctx.language.translations[translationSlug];
      if (!translation || !translation.books[bookId]) return null;
    }
    if (!hasChapter(chapterSpec(ctx, bookId, translation.books[bookId]), chapter)) return null;
    return '/' + ctx.lang + '/' + translationSlug + '/' + slug + '/' + chapter + '#v' + verse;
  }

  function loadCrossReferences(ctx, bookId, chapter) {
    var key = bookId + '/' + chapter;
    if (xrefCache[key]) return xrefCache[key];
    var bases = ctx.manifest && ctx.manifest.xrefBaseUrls ? ctx.manifest.xrefBaseUrls : [];
    var attempt = function (index) {
      if (index >= bases.length) return Promise.resolve(null);
      return fetch(bases[index] + '/' + key + '.json', { headers: { accept: 'application/json' } })
        .then(function (response) {
          if (!response.ok) throw new Error('HTTP ' + response.status);
          var type = response.headers.get('content-type') || '';
          if (type.indexOf('json') === -1 && type.indexOf('javascript') === -1 && type.indexOf('text/plain') === -1) {
            throw new Error('Unexpected content type ' + type);
          }
          return response.json();
        })
        .catch(function () {
          return attempt(index + 1);
        });
    };
    xrefCache[key] = attempt(0);
    return xrefCache[key];
  }

  // -------------------------------------------------------------------------
  // Deep links and keyboard navigation
  // -------------------------------------------------------------------------

  function applyHash(chapter) {
    var match = /^#v(\d+)(?:-(\d+))?$/.exec(window.location.hash);
    if (!match) return;
    var start = Number(match[1]);
    var end = match[2] ? Number(match[2]) : start;
    if (end < start) {
      var swap = start;
      start = end;
      end = swap;
    }
    var nodes = chapter.querySelectorAll('.v.is-selected');
    for (var i = 0; i < nodes.length; i += 1) nodes[i].classList.remove('is-selected');
    var first = null;
    for (var n = start; n <= end; n += 1) {
      var verses = chapter.querySelectorAll('.v[data-v="' + n + '"]');
      for (var j = 0; j < verses.length; j += 1) {
        verses[j].classList.add('is-selected');
        if (!first) first = verses[j];
      }
    }
    if (first) {
      first.scrollIntoView({ block: 'center' });
      updateActions(chapter);
    }
  }

  function onKeyDown(event) {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
    var target = event.target;
    if (target instanceof Element && target.closest('input, textarea, select, [contenteditable="true"]')) return;
    var chapter = currentChapter();
    if (!chapter) return;
    if (event.key === 'Escape') {
      clearSelection(chapter);
      return;
    }
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    var rtl = chapter.getAttribute('dir') === 'rtl';
    var forward = event.key === (rtl ? 'ArrowLeft' : 'ArrowRight');
    var url = adjacentChapterUrl(context(chapter), forward ? 1 : -1);
    if (url) {
      event.preventDefault();
      window.location.assign(url);
    }
  }

  function chapterList(ctx, bookId, book) {
    var spec = chapterSpec(ctx, bookId, book);
    if (typeof spec === 'number') {
      var list = [];
      for (var i = 1; i <= spec; i += 1) list.push(i);
      return list;
    }
    return Array.isArray(spec) ? spec : [];
  }

  function adjacentChapterUrl(ctx, direction) {
    if (!ctx.translation || !ctx.manifest) return null;
    var bookIds = Object.keys(ctx.translation.books);
    var bookIndex = bookIds.indexOf(ctx.bookId);
    if (bookIndex === -1) return null;
    var chapters = chapterList(ctx, ctx.bookId, ctx.translation.books[ctx.bookId]);
    var chapterIndex = chapters.indexOf(ctx.chapter);
    var targetBook = ctx.bookId;
    var targetChapter = null;
    if (chapterIndex !== -1 && chapters[chapterIndex + direction] !== undefined) {
      targetChapter = chapters[chapterIndex + direction];
    } else {
      var nextBookId = bookIds[bookIndex + direction];
      if (!nextBookId) return null;
      var nextChapters = chapterList(ctx, nextBookId, ctx.translation.books[nextBookId]);
      if (nextChapters.length === 0) return null;
      targetBook = nextBookId;
      targetChapter = direction > 0 ? nextChapters[0] : nextChapters[nextChapters.length - 1];
    }
    var slug = ctx.manifest.bookSlugs ? ctx.manifest.bookSlugs[targetBook] : null;
    if (!slug) return null;
    return '/' + ctx.lang + '/' + ctx.translationSlug + '/' + slug + '/' + targetChapter;
  }

  // -------------------------------------------------------------------------
  // Utilities
  // -------------------------------------------------------------------------

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function round1(value) {
    return Math.round(value * 10) / 10;
  }
})();
