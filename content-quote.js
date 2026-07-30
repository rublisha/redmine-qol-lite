(() => {
  'use strict';

  const qol = globalThis.RedmineSmallQol;
  if (!qol || qol.quoteSelectionActive) return;
  qol.quoteSelectionActive = true;

  const BUTTON_ID = 'rsq-quote-button';
  const INSTANCE_ATTRIBUTE = 'data-rsq-quote-instance';
  const INSERT_LOCK_ATTRIBUTE = 'data-rsq-quote-inserting';
  const STYLE_ID = 'rsq-quote-style';
  const SOURCE_SELECTOR = '#content .issue .description, #history .journal .wiki';
  const NOTES_SELECTOR = 'textarea[name="issue[notes]"], textarea#issue_notes';
  const SHOW_DELAY = 250;
  let button = null;
  let selectedText = '';
  let selectedUserId = '';
  let selectedRange = null;
  let updateTimer = 0;
  const noteSelections = new WeakMap();
  const instanceId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  document.documentElement.setAttribute(INSTANCE_ATTRIBUTE, instanceId);
  for (const staleButton of document.querySelectorAll('.rsq-quote-button')) staleButton.remove();

  function isCurrentInstance() {
    return document.documentElement.getAttribute(INSTANCE_ATTRIBUTE) === instanceId;
  }

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style'); style.id = STYLE_ID;
    style.textContent = `
      .rsq-quote-button { position:fixed; z-index:10000; display:inline-flex; align-items:center; min-height:28px; padding:4px 10px; border:1px solid #4f86b8; border-radius:4px; box-shadow:0 2px 8px rgba(35,55,75,.22); background:#fff; color:#315d84; cursor:pointer; font:600 11px/1.3 Arial,sans-serif; white-space:nowrap; }
      .rsq-quote-button[hidden] { display:none; }
      .rsq-quote-button:hover { border-color:#326b9b; background:#edf6fc; color:#234f74; }
      .rsq-quote-button:focus-visible { outline:2px solid #8bb8dc; outline-offset:2px; }
      .rsq-quote-button.rsq-quote-error { border-color:#c87567; background:#fff2ef; color:#9b3c2f; cursor:default; }
    `;
    document.head.appendChild(style);
  }

  function sourceFor(node) {
    const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
    if (!element || element.closest('textarea, input, [contenteditable="true"], .rsq-quote-button')) return null;
    const source = element.closest(SOURCE_SELECTOR);
    if (!source) return null;
    if (source.matches('#content .issue .description')) {
      const wiki = source.querySelector('.wiki');
      if (wiki && !wiki.contains(element)) return null;
    }
    return source;
  }

  function userIdFor(source) {
    const journal = source.closest('.journal');
    const scope = journal || source.closest('.issue');
    if (!scope) return '';
    const selectors = journal
      ? ['h4 a.user[href*="/users/"]', 'h4 a[href*="/users/"]', '.author a.user[href*="/users/"]']
      : ['p.author a.user[href*="/users/"]', '.author a[href*="/users/"]'];
    for (const selector of selectors) {
      const id = scope.querySelector(selector)?.getAttribute('href')?.match(/\/users\/(\d+)(?:$|[/?#])/)?.[1];
      if (id) return id;
    }
    return '';
  }

  function cleanSelection(value) {
    return String(value || '')
      .replace(/\u00a0/g, ' ')
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map((line) => line.replace(/[ \t]+$/g, ''))
      .join('\n')
      .trim();
  }

  function selectionState() {
    const selection = getSelection();
    if (!selection || selection.rangeCount !== 1 || selection.isCollapsed) return null;
    const startSource = sourceFor(selection.anchorNode);
    const endSource = sourceFor(selection.focusNode);
    if (!startSource || startSource !== endSource) return null;
    const text = cleanSelection(selection.toString());
    if (!text) return null;
    const range = selection.getRangeAt(0).cloneRange();
    const rects = [...range.getClientRects()].filter((rect) => rect.width || rect.height);
    const rect = rects[rects.length - 1] || range.getBoundingClientRect();
    if (!rect.width && !rect.height) return null;
    return { text, userId: userIdFor(startSource), range, rect };
  }

  function hideButton() {
    if (button) button.hidden = true;
  }

  function positionButton(rect) {
    if (!button) return;
    button.hidden = false;
    button.classList.remove('rsq-quote-error');
    button.textContent = 'Цитировать';
    const gap = 7;
    const width = button.offsetWidth;
    const height = button.offsetHeight;
    const left = Math.min(Math.max(8, rect.right - width), innerWidth - width - 8);
    const top = rect.top >= height + gap + 8 ? rect.top - height - gap : rect.bottom + gap;
    button.style.left = `${left}px`;
    button.style.top = `${Math.min(top, innerHeight - height - 8)}px`;
  }

  function updateButton() {
    if (!isCurrentInstance()) return;
    updateTimer = 0;
    const state = selectionState();
    if (!state) { hideButton(); return; }
    selectedText = state.text;
    selectedUserId = state.userId;
    selectedRange = state.range;
    positionButton(state.rect);
  }

  function scheduleUpdate() {
    if (!isCurrentInstance()) return;
    clearTimeout(updateTimer);
    const state = selectionState();
    if (!state) {
      selectedText = '';
      selectedUserId = '';
      selectedRange = null;
      hideButton();
      return;
    }
    if (!button.hidden && state.text !== selectedText) hideButton();
    updateTimer = setTimeout(updateButton, SHOW_DELAY);
  }

  function quoteText(value, userId) {
    const body = value.split('\n').map((line) => line ? `> ${line}` : '>').join('\n');
    return userId ? `user#${userId} писал(а):\n\n${body}` : body;
  }

  function paddedQuote(textarea, quote) {
    const saved = noteSelections.get(textarea);
    const start = saved?.start ?? textarea.value.length;
    const end = saved?.end ?? start;
    const before = textarea.value.slice(0, start);
    const after = textarea.value.slice(end);
    const prefix = before && !before.endsWith('\n\n') ? (before.endsWith('\n') ? '\n' : '\n\n') : '';
    const suffix = after ? (after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : '\n\n') : '\n\n';
    return { start, end, value: `${prefix}${quote}${suffix}` };
  }

  function revealNotes(textarea) {
    if (textarea.offsetParent !== null) return;
    const trigger = document.querySelector('a[onclick*="showAndScrollTo"][onclick*="issue_notes"], a[onclick*="showAndScrollTo"][onclick*="update"]');
    if (trigger) trigger.click();
    const details = textarea.closest('details');
    if (details) details.open = true;
    const update = textarea.closest('#update');
    if (update && update.offsetParent === null) {
      update.hidden = false;
      if (getComputedStyle(update).display === 'none') update.style.display = 'block';
    }
  }

  function rememberNotesSelection(event) {
    const textarea = event.target?.closest?.(NOTES_SELECTOR);
    if (!textarea) return;
    noteSelections.set(textarea, { start: textarea.selectionStart, end: textarea.selectionEnd });
  }

  function insertQuote() {
    if (!isCurrentInstance()) return;
    const textarea = document.querySelector(NOTES_SELECTOR);
    if (!textarea) {
      button.classList.add('rsq-quote-error');
      button.textContent = 'Поле комментария не найдено';
      setTimeout(hideButton, 1800);
      return;
    }
    if (textarea.hasAttribute(INSERT_LOCK_ATTRIBUTE)) return;
    textarea.setAttribute(INSERT_LOCK_ATTRIBUTE, instanceId);
    button.disabled = true;
    hideButton();

    try {
      revealNotes(textarea);
      const insertion = paddedQuote(textarea, quoteText(selectedText, selectedUserId));
      textarea.setRangeText(insertion.value, insertion.start, insertion.end, 'end');
      noteSelections.set(textarea, { start: textarea.selectionStart, end: textarea.selectionEnd });
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      textarea.focus({ preventScroll: true });
      textarea.scrollIntoView({ behavior: 'smooth', block: 'center' });
      getSelection()?.removeAllRanges();
      selectedText = '';
      selectedUserId = '';
      selectedRange = null;
    } finally {
      button.disabled = false;
      setTimeout(() => {
        if (textarea.getAttribute(INSERT_LOCK_ATTRIBUTE) === instanceId) textarea.removeAttribute(INSERT_LOCK_ATTRIBUTE);
      }, 500);
    }
  }

  function createButton() {
    button = document.createElement('button');
    button.id = BUTTON_ID;
    button.type = 'button';
    button.className = 'rsq-quote-button';
    button.textContent = 'Цитировать';
    button.hidden = true;
    button.setAttribute('aria-label', 'Цитировать выделенный текст');
    button.addEventListener('pointerdown', (event) => event.preventDefault());
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (selectedText && selectedRange) insertQuote();
    });
    document.body.appendChild(button);
  }

  ensureStyles();
  createButton();
  document.addEventListener('selectionchange', scheduleUpdate);
  document.addEventListener('mouseup', scheduleUpdate);
  document.addEventListener('keyup', scheduleUpdate);
  document.addEventListener('focusout', rememberNotesSelection, true);
  document.addEventListener('select', rememberNotesSelection, true);
  addEventListener('scroll', scheduleUpdate, true);
  addEventListener('resize', scheduleUpdate);
})();
