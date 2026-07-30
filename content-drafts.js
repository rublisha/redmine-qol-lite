(() => {
  'use strict';

  const qol = globalThis.RedmineSmallQol;
  if (qol.issueDraftsActive) return;

  const issueId = location.pathname.match(/\/issues\/(\d+)(?:$|[/?#])/)?.[1];
  if (!issueId) return;
  qol.issueDraftsActive = true;

  const STYLE_ID = 'rsq-drafts-style';
  const SAVE_DELAY = 800;
  const MAX_AGE = 30 * 24 * 60 * 60 * 1000;
  const STORAGE_KEY = `rsqIssueDraft:${location.origin}:${issueId}`;
  const fields = new Map();
  const forms = new WeakSet();
  let draft = { fields: {}, updatedAt: '' };
  let saveTimer = 0;
  let scheduled = false;
  let submitting = false;

  const definitions = [
    { name: 'notes', selector: 'textarea[name="issue[notes]"], textarea#issue_notes' },
    { name: 'description', selector: 'textarea[name="issue[description]"], textarea#issue_description' },
  ];

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style'); style.id = STYLE_ID;
    style.textContent = `
      .rsq-draft-status { display:flex; align-items:center; gap:8px; min-height:18px; margin:4px 0 7px; color:#687988; font-size:11px; }
      .rsq-draft-status[hidden] { display:none; }
      .rsq-draft-status button { padding:0; border:0; background:transparent; color:#8a5555; cursor:pointer; font:inherit; text-decoration:underline; text-underline-offset:2px; }
      .rsq-draft-status button:hover { color:#a33e2f; }
    `;
    document.head.appendChild(style);
  }

  function statusFor(form, near) {
    let status = form.querySelector('.rsq-draft-status');
    if (status) return status;
    status = document.createElement('div'); status.className = 'rsq-draft-status'; status.hidden = true;
    status.setAttribute('aria-live', 'polite');
    const text = document.createElement('span'); text.className = 'rsq-draft-status-text';
    const discard = document.createElement('button'); discard.type = 'button'; discard.textContent = 'Удалить черновик';
    discard.addEventListener('click', () => void discardDraft());
    status.append(text, discard);
    near.insertAdjacentElement('afterend', status);
    return status;
  }

  function showStatus(text) {
    for (const state of fields.values()) {
      if (!state.node.isConnected) continue;
      const status = statusFor(state.form, state.node);
      status.querySelector('.rsq-draft-status-text').textContent = text;
      status.hidden = false;
    }
  }

  function hideStatus() {
    for (const status of document.querySelectorAll('.rsq-draft-status')) status.hidden = true;
  }

  function savedTime(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
  }

  function applyDraft(state) {
    if (!Object.prototype.hasOwnProperty.call(draft.fields, state.name) || state.dirty) return false;
    state.node.value = String(draft.fields[state.name] ?? '');
    return true;
  }

  function attachForm(form) {
    if (forms.has(form)) return;
    forms.add(form);
    form.addEventListener('submit', () => {
      submitting = true;
      clearTimeout(saveTimer);
      draft = { fields: {}, updatedAt: '' };
      hideStatus();
      void chrome.storage.local.remove(STORAGE_KEY);
      setTimeout(() => { submitting = false; }, 2000);
    });
  }

  function mount() {
    scheduled = false;
    let restored = false;
    for (const definition of definitions) {
      const node = document.querySelector(definition.selector);
      if (!node || node.dataset.rsqDraftMounted === '1') continue;
      const form = node.closest('form');
      if (!form) continue;
      node.dataset.rsqDraftMounted = '1';
      const state = { name: definition.name, node, form, baseline: node.value, dirty: false };
      fields.set(definition.name, state);
      restored = applyDraft(state) || restored;
      node.addEventListener('input', () => {
        state.dirty = true;
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => void saveDraft(), SAVE_DELAY);
      });
      attachForm(form);
    }
    if (restored) showStatus(`Восстановлен черновик${savedTime(draft.updatedAt) ? ` от ${savedTime(draft.updatedAt)}` : ''}.`);
  }

  async function saveDraft() {
    if (submitting) return;
    clearTimeout(saveTimer);
    const nextFields = { ...(draft.fields || {}) };
    for (const [name, state] of fields) {
      if (!state.node.isConnected) continue;
      if (state.node.value === state.baseline) delete nextFields[name];
      else nextFields[name] = state.node.value;
    }
    if (!Object.keys(nextFields).length) {
      draft = { fields: {}, updatedAt: '' };
      hideStatus();
      await chrome.storage.local.remove(STORAGE_KEY);
      return;
    }
    draft = { issueId, origin: location.origin, fields: nextFields, updatedAt: new Date().toISOString() };
    await chrome.storage.local.set({ [STORAGE_KEY]: draft });
    showStatus(`Черновик сохранён в ${savedTime(draft.updatedAt)}.`);
  }

  async function discardDraft() {
    clearTimeout(saveTimer);
    draft = { fields: {}, updatedAt: '' };
    for (const state of fields.values()) {
      if (!state.node.isConnected) continue;
      state.node.value = state.baseline;
      state.dirty = false;
    }
    hideStatus();
    await chrome.storage.local.remove(STORAGE_KEY);
  }

  function scheduleMount() {
    if (scheduled) return;
    scheduled = true; queueMicrotask(mount);
  }

  async function start() {
    const data = await chrome.storage.local.get(STORAGE_KEY);
    const stored = data[STORAGE_KEY];
    const storedAt = new Date(stored?.updatedAt || '').getTime();
    if (stored?.origin === location.origin && String(stored?.issueId) === issueId && stored?.fields && Date.now() - storedAt <= MAX_AGE) {
      draft = stored;
    } else if (stored) {
      await chrome.storage.local.remove(STORAGE_KEY);
    }
    ensureStyles(); mount();
    new MutationObserver(scheduleMount).observe(document.body, { childList: true, subtree: true });
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[STORAGE_KEY]) return;
    const incoming = changes[STORAGE_KEY].newValue;
    if (!incoming) {
      draft = { fields: {}, updatedAt: '' };
      for (const state of fields.values()) {
        if (!state.dirty && state.node.isConnected) state.node.value = state.baseline;
      }
      hideStatus();
      return;
    }
    if (incoming.origin !== location.origin || String(incoming.issueId) !== issueId) return;
    draft = incoming;
    let restored = false;
    for (const state of fields.values()) restored = applyDraft(state) || restored;
    if (restored) showStatus(`Восстановлен черновик${savedTime(draft.updatedAt) ? ` от ${savedTime(draft.updatedAt)}` : ''}.`);
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) void saveDraft(); });
  addEventListener('pagehide', () => void saveDraft());

  void start();
})();
