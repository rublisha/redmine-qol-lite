(() => {
  'use strict';

  const qol = globalThis.RedmineSmallQol;
  if (!qol || qol.newCommentsActive) return;

  const issueId = location.pathname.match(/\/issues\/(\d+)(?:$|[/?#])/)?.[1];
  if (!issueId) return;
  qol.newCommentsActive = true;

  const STORAGE_KEY = 'journalReadPositions';
  const STYLE_ID = 'rsq-new-comments-style';
  const MARKER_CLASS = 'rsq-new-comments-marker';
  const MAX_POSITIONS = 500;
  const SAVE_DELAY = 500;
  const pageKey = `${location.origin}:${issueId}`;
  let positions = {};
  let displayBaseline = null;
  let currentPosition = null;
  let pendingPosition = null;
  let pendingForce = false;
  let comments = [];
  let commentSignature = '';
  let intersectionObserver = null;
  let saveTimer = 0;
  let mountScheduled = false;
  let visibilityScheduled = false;
  let started = false;

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style'); style.id = STYLE_ID;
    style.textContent = `
      .${MARKER_CLASS} { display:flex; align-items:center; gap:8px; margin:14px 0 10px; color:#527796; font:600 11px/1.3 Arial,sans-serif; }
      .${MARKER_CLASS}::before, .${MARKER_CLASS}::after { content:""; flex:1 1 auto; height:1px; background:#a9c6dc; }
      .${MARKER_CLASS}-label { flex:0 1 auto; text-align:center; }
      .${MARKER_CLASS}-count { display:inline-flex; align-items:center; justify-content:center; min-width:18px; height:18px; padding:0 5px; border-radius:9px; background:#e4f1fa; color:#315d84; font-size:10px; }
    `;
    document.head.appendChild(style);
  }

  function hasComment(journal) {
    return journal.classList.contains('has-notes') || Boolean(journal.querySelector('.wiki'));
  }

  function numberFrom(value, pattern) {
    return String(value || '').match(pattern)?.[1] || '';
  }

  function numeric(value) {
    if (value === '' || value === null || value === undefined) return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function metaFor(journal) {
    const journalId = String(journal.dataset.journalId || '')
      || numberFrom(journal.id, /(?:change|journal)-(\d+)/);
    let noteNumber = String(journal.dataset.noteNumber || '');
    if (!noteNumber) {
      for (const link of journal.querySelectorAll('a[href*="#note-"]')) {
        noteNumber = numberFrom(link.getAttribute('href'), /#note-(\d+)/);
        if (noteNumber) break;
      }
    }
    if (!journalId && !noteNumber) return null;
    return {
      journalId,
      noteNumber,
      key: journalId ? `journal:${journalId}` : `note:${noteNumber}`,
    };
  }

  function entryFor(meta) {
    return {
      journalId: meta.journalId,
      noteNumber: meta.noteNumber,
      seenAt: new Date().toISOString(),
    };
  }

  function exactIndex(list, entry) {
    if (!entry) return -1;
    if (entry.journalId) {
      const index = list.findIndex((item) => item.meta.journalId === String(entry.journalId));
      if (index >= 0) return index;
    }
    if (entry.noteNumber) return list.findIndex((item) => item.meta.noteNumber === String(entry.noteNumber));
    return -1;
  }

  function readIndex(list, entry) {
    const exact = exactIndex(list, entry);
    if (exact >= 0) return exact;

    const journalId = numeric(entry?.journalId);
    if (journalId !== null && list.some((item) => item.meta.journalId)) {
      let index = -1;
      for (let i = 0; i < list.length; i += 1) {
        const candidate = numeric(list[i].meta.journalId);
        if (candidate !== null && candidate <= journalId) index = i;
      }
      return index;
    }

    const noteNumber = numeric(entry?.noteNumber);
    if (noteNumber !== null && list.some((item) => item.meta.noteNumber)) {
      let index = -1;
      for (let i = 0; i < list.length; i += 1) {
        const candidate = numeric(list[i].meta.noteNumber);
        if (candidate !== null && candidate <= noteNumber) index = i;
      }
      return index;
    }
    return null;
  }

  function isLater(candidate, current, list = comments) {
    if (!current) return true;
    const candidateIndex = exactIndex(list, candidate);
    const currentIndex = readIndex(list, current);
    if (candidateIndex >= 0 && currentIndex !== null) return candidateIndex > currentIndex;
    const candidateJournal = numeric(candidate.journalId);
    const currentJournal = numeric(current.journalId);
    if (candidateJournal !== null && currentJournal !== null) return candidateJournal > currentJournal;
    const candidateNote = numeric(candidate.noteNumber);
    const currentNote = numeric(current.noteNumber);
    return candidateNote !== null && currentNote !== null && candidateNote > currentNote;
  }

  function prunedPositions(value) {
    return Object.fromEntries(Object.entries(value)
      .sort((a, b) => String(b[1]?.seenAt || '').localeCompare(String(a[1]?.seenAt || '')))
      .slice(0, MAX_POSITIONS));
  }

  async function persistPending() {
    clearTimeout(saveTimer);
    saveTimer = 0;
    const candidate = pendingPosition;
    const force = pendingForce;
    pendingPosition = null;
    pendingForce = false;
    if (!candidate) return;
    const data = await chrome.storage.local.get(STORAGE_KEY);
    const latest = data[STORAGE_KEY] && typeof data[STORAGE_KEY] === 'object' ? data[STORAGE_KEY] : {};
    if (!force && latest[pageKey] && !isLater(candidate, latest[pageKey])
      && exactIndex(comments, candidate) !== exactIndex(comments, latest[pageKey])) {
      currentPosition = latest[pageKey];
      positions = latest;
      return;
    }
    const next = prunedPositions({ ...latest, [pageKey]: candidate });
    positions = next;
    currentPosition = candidate;
    await chrome.storage.local.set({ [STORAGE_KEY]: next });
  }

  function remember(meta, immediate = false, force = false) {
    if (!meta) return;
    const candidate = entryFor(meta);
    if (!force && !isLater(candidate, currentPosition) && currentPosition) return;
    currentPosition = candidate;
    pendingPosition = candidate;
    pendingForce = pendingForce || force;
    clearTimeout(saveTimer);
    if (immediate) void persistPending();
    else saveTimer = setTimeout(() => void persistPending(), SAVE_DELAY);
  }

  function visibleEnough(node) {
    if (document.visibilityState !== 'visible' || !node.isConnected || getComputedStyle(node).display === 'none') return false;
    const rect = node.getBoundingClientRect();
    const visibleHeight = Math.min(rect.bottom, innerHeight) - Math.max(rect.top, 0);
    const required = Math.min(rect.height, Math.max(24, Math.min(120, rect.height * 0.3)));
    return rect.width > 0 && rect.height > 0 && visibleHeight >= required;
  }

  function recordVisibleComments() {
    visibilityScheduled = false;
    if (document.visibilityState !== 'visible') return;
    let latest = null;
    for (const item of comments) if (visibleEnough(item.node)) latest = item.meta;
    if (latest) remember(latest);
  }

  function scheduleVisibilityScan() {
    if (visibilityScheduled) return;
    visibilityScheduled = true;
    requestAnimationFrame(recordVisibleComments);
  }

  function observeComments() {
    intersectionObserver?.disconnect();
    intersectionObserver = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) recordVisibleComments();
    }, { threshold: [0, 0.3, 0.6] });
    for (const item of comments) intersectionObserver.observe(item.node);
    scheduleVisibilityScan();
  }

  function removeMarker() {
    document.querySelector(`#history .${MARKER_CLASS}`)?.remove();
  }

  function renderMarker() {
    removeMarker();
    if (!displayBaseline || !comments.length) return;
    const lastReadIndex = readIndex(comments, displayBaseline);
    if (lastReadIndex === null) {
      displayBaseline = entryFor(comments[comments.length - 1].meta);
      currentPosition = displayBaseline;
      remember(comments[comments.length - 1].meta, true, true);
      return;
    }
    const firstNewIndex = lastReadIndex + 1;
    if (firstNewIndex >= comments.length) return;
    const firstNew = comments[firstNewIndex].node;
    const marker = document.createElement('div'); marker.className = MARKER_CLASS;
    marker.setAttribute('role', 'separator');
    marker.setAttribute('aria-label', `Новых комментариев: ${comments.length - firstNewIndex}`);
    const label = document.createElement('span'); label.className = `${MARKER_CLASS}-label`; label.textContent = 'Новые с прошлого просмотра';
    const count = document.createElement('span'); count.className = `${MARKER_CLASS}-count`; count.textContent = String(comments.length - firstNewIndex);
    marker.append(label, count);
    firstNew.parentElement?.insertBefore(marker, firstNew);
  }

  function collectComments() {
    const history = document.querySelector('#history');
    if (!history) return [];
    return [...history.querySelectorAll('div.journal')]
      .filter(hasComment)
      .map((node) => ({ node, meta: metaFor(node) }))
      .filter((item) => item.meta);
  }

  function mount() {
    mountScheduled = false;
    if (!started) return;
    const next = collectComments();
    const signature = next.map((item) => item.meta.key).join('|');
    if (signature === commentSignature) {
      if (!document.querySelector(`#history .${MARKER_CLASS}`)) renderMarker();
      return;
    }
    commentSignature = signature;
    comments = next;
    if (!comments.length) { removeMarker(); intersectionObserver?.disconnect(); return; }

    if (!displayBaseline) {
      displayBaseline = entryFor(comments[comments.length - 1].meta);
      currentPosition = displayBaseline;
      remember(comments[comments.length - 1].meta, true, true);
    }
    renderMarker();
    observeComments();
  }

  function scheduleMount() {
    if (mountScheduled) return;
    mountScheduled = true;
    queueMicrotask(mount);
  }

  async function start() {
    const data = await chrome.storage.local.get(STORAGE_KEY);
    positions = data[STORAGE_KEY] && typeof data[STORAGE_KEY] === 'object' ? data[STORAGE_KEY] : {};
    displayBaseline = positions[pageKey] || null;
    currentPosition = displayBaseline;
    started = true;
    ensureStyles();
    mount();
    new MutationObserver(scheduleMount).observe(document.body, { childList: true, subtree: true });
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') scheduleVisibilityScan();
    else {
      visibilityScheduled = false;
      void persistPending();
    }
  });
  addEventListener('scroll', scheduleVisibilityScan, true);
  addEventListener('resize', scheduleVisibilityScan);
  addEventListener('pagehide', () => void persistPending());

  void start();
})();
