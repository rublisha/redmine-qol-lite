(() => {
  'use strict';

  const qol = globalThis.RedmineSmallQol;
  if (!qol || qol.eventsActive) return;
  qol.eventsActive = true;
  const FEED_KEY = 'eventFeed';
  const SCOPE_KEY = 'eventFilterScopes';
  const UI_KEY = 'eventPanelUi';
  const STYLE_ID = 'rsq-events-style';
  const VISIBLE_CHANGES = 6;
  const LONG_COMMENT_CHARS = 260;
  const LONG_COMMENT_LINES = 7;
  // Лента держит до 150 событий, но карточка с разбором Textile стоит дорого,
  // поэтому в DOM попадает только то, до чего человек реально долистал.
  const RENDER_BATCH = 24;
  const MIN_WIDTH = 360;
  const MIN_HEIGHT = 240;
  const DEFAULT_WIDTH = 560;
  const DEFAULT_HEIGHT = 680;
  let feed = { events: [], readKeys: {}, checkedAt: '' };
  let filters = [];
  let scopes = {};
  let activeTab = 'all';
  let buttons = [];
  let anchorButton = null;
  let popover = null;
  let list = null;
  let tabsRow = null;
  let unreadPill = null;
  let unreadOnly = false;
  let open = false;
  let refreshing = false;
  let redmineBaseUrl = location.origin;
  let soundEnabled = true;
  let audioContext = null;
  let geometry = { left: null, top: null, width: null, height: null };
  let geometryReady = false;
  let geometrySaveTimer = 0;
  let sizeObserver = null;
  let queue = [];
  let queueIndex = 0;
  let sentinel = null;
  let listDirty = true;
  let scrollFrame = 0;

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style'); style.id = STYLE_ID;
    style.textContent = `
      .rsq-events-host { display:inline-flex!important; align-items:center; }
      .rsq-events-button { position:relative; box-sizing:border-box; min-height:24px; padding:3px 8px!important; border:1px solid rgba(255,255,255,.28)!important; border-radius:3px; background:rgba(255,255,255,.09)!important; color:inherit!important; font:inherit; cursor:pointer; }
      .rsq-events-button:hover { background:rgba(255,255,255,.18)!important; }
      .rsq-events-sidebar { margin:4px 0 10px; }
      .rsq-events-sidebar .rsq-events-button { min-height:0; padding:0!important; border:0!important; background:none!important; color:#169!important; font:inherit; text-align:left; }
      .rsq-events-sidebar .rsq-events-button:hover { background:none!important; color:#c61a1a!important; text-decoration:underline; }
      .rsq-events-count { display:none; min-width:16px; margin-left:5px; padding:0 4px; border-radius:8px; background:#c54638; color:#fff; font-size:10px; line-height:16px; text-align:center; }
      .rsq-events-button.has-unread .rsq-events-count { display:inline-block; }
      .rsq-events-fallback { position:fixed!important; right:16px; bottom:16px; z-index:10000; color:#fff!important; background:#326b9b!important; border-color:#28597f!important; box-shadow:0 2px 9px rgba(0,0,0,.22); }
      .rsq-events-fallback:hover { color:#fff!important; background:#28597f!important; border-color:#204966!important; }

      .rsq-events-popover { position:fixed; z-index:10020; box-sizing:border-box; width:560px; min-width:min(360px,calc(100vw - 20px)); min-height:min(240px,calc(100vh - 24px)); max-width:calc(100vw - 20px); max-height:calc(100vh - 24px); display:grid; grid-template-rows:auto auto auto minmax(110px,1fr) auto; overflow:hidden; resize:both; border:1px solid #b4c1cc; border-radius:7px; background:#fff; box-shadow:0 12px 34px rgba(18,38,58,.26); color:#1f2a35; font:13px/1.5 -apple-system,"Segoe UI",Arial,sans-serif; opacity:0; transform:translateY(-4px); transition:opacity .11s ease-out, transform .11s ease-out; }
      .rsq-events-popover.is-open { opacity:1; transform:none; }
      .rsq-events-popover.is-dragging { user-select:none; transition:none; box-shadow:0 18px 44px rgba(18,38,58,.34); }
      .rsq-events-popover *, .rsq-events-popover *::before, .rsq-events-popover *::after { box-sizing:border-box; }
      .rsq-events-head { display:flex; align-items:center; gap:8px; padding:11px 12px; border-bottom:1px solid #dae1e7; background:linear-gradient(#f9fbfc,#eef3f7); cursor:move; user-select:none; }
      .rsq-events-head strong { font-size:15px; font-weight:700; letter-spacing:.1px; }
      .rsq-events-pill { display:none; padding:1px 8px; border-radius:9px; background:#c54638; color:#fff; font-size:11px; font-weight:600; line-height:17px; white-space:nowrap; }
      .rsq-events-pill.is-on { display:inline-block; }
      .rsq-events-head .spacer { flex:1; }
      .rsq-events-icon { display:inline-flex; align-items:center; justify-content:center; min-width:29px; min-height:28px; padding:2px 7px; border:1px solid #c0ccd6; border-radius:4px; background:#fff; color:#3d5568; font-size:14px; line-height:1; cursor:pointer; }
      .rsq-events-icon:hover:not(:disabled) { border-color:#9fb1c1; background:#f2f7fb; color:#20344a; }
      .rsq-events-icon:disabled { opacity:.55; cursor:default; }
      .rsq-events-tabs { display:none; gap:4px; overflow-x:auto; padding:7px 10px 0; border-bottom:1px solid #e4e9ee; background:#f8fafc; scrollbar-width:thin; }
      .rsq-events-tabs.is-on { display:flex; }
      .rsq-events-tab { display:inline-flex; align-items:center; gap:5px; flex:0 0 auto; max-width:200px; padding:5px 10px; border:1px solid transparent; border-bottom:0; border-radius:4px 4px 0 0; background:none; color:#5b6b7a; font:inherit; font-size:12px; line-height:1.3; white-space:nowrap; cursor:pointer; }
      .rsq-events-tab span { overflow:hidden; text-overflow:ellipsis; }
      .rsq-events-tab:hover { color:#24384a; background:#eef3f7; }
      .rsq-events-tab.is-active { border-color:#dae1e7; background:#fff; color:#16212c; font-weight:600; }
      .rsq-events-tab-count { flex:0 0 auto; min-width:16px; padding:0 4px; border-radius:8px; background:#c54638; color:#fff; font-size:10px; font-weight:600; line-height:16px; text-align:center; }
      .rsq-events-controls { display:flex; align-items:center; gap:10px; padding:8px 12px; border-bottom:1px solid #e4e9ee; color:#5b6b7a; font-size:12px; }
      .rsq-events-controls label { display:flex; align-items:center; gap:5px; cursor:pointer; }
      .rsq-events-controls input { margin:0; }
      .rsq-events-read-hint { margin-left:auto; color:#8b97a1; font-size:11px; }
      .rsq-events-list { overflow-y:auto; overflow-x:hidden; padding:7px; background:#f5f8fa; scrollbar-width:thin; }
      .rsq-events-list::-webkit-scrollbar { width:10px; }
      .rsq-events-list::-webkit-scrollbar-thumb { border:3px solid #f5f8fa; border-radius:6px; background:#c2ced8; }

      .rsq-event-card { margin-bottom:7px; border:1px solid #d7dfe6; border-left:3px solid #d7dfe6; border-radius:5px; background:#fff; }
      .rsq-event-card:last-child { margin-bottom:0; }
      .rsq-event-card:hover { border-color:#a8bac8; border-left-color:#a8bac8; box-shadow:0 1px 4px rgba(24,49,73,.09); }
      .rsq-event-card.unread { border-left-color:#377fb8; }
      .rsq-event-card.unread:hover { border-left-color:#2c6b9d; }
      .rsq-event { display:grid; gap:6px; padding:10px 12px; color:inherit; cursor:pointer; }
      .rsq-event > * { min-width:0; }
      .rsq-event-top { display:flex; flex-wrap:wrap; align-items:center; gap:6px; min-width:0; }
      .rsq-event-id { color:#2c6b9d; font-size:13px; font-weight:700; }
      .rsq-event-version { padding:1px 6px; border:1px solid #a9c7df; border-radius:3px; background:#eaf3fa; color:#2c5a80; font-size:11px; font-weight:600; }
      .rsq-event-status { padding:1px 6px; border:1px solid #d3dbe2; border-radius:3px; background:#f2f5f8; color:#4d6173; font-size:11px; }
      .rsq-event-time { margin-left:auto; white-space:nowrap; color:#8b97a1; font-size:11px; }
      .rsq-event-subject { display:-webkit-box; overflow:hidden; overflow-wrap:anywhere; color:#16212c!important; font-size:14px; font-weight:600; line-height:1.35; text-decoration:none!important; -webkit-box-orient:vertical; -webkit-line-clamp:3; line-clamp:3; }
      .rsq-event-subject:hover { color:#2c6b9d!important; text-decoration:underline!important; }
      .rsq-event-card.expanded .rsq-event-subject { display:block; -webkit-line-clamp:none; line-clamp:none; }
      .rsq-event-actor { color:#44586a; font-size:12px; overflow-wrap:anywhere; }
      .rsq-event-actor strong { color:#243441; font-weight:600; }

      .rsq-event-changes { display:grid; gap:3px; padding:7px 9px; border-radius:4px; background:#f6f9fb; }
      .rsq-event-change { display:flex; flex-wrap:wrap; align-items:baseline; gap:5px; font-size:12px; line-height:1.45; overflow-wrap:anywhere; }
      .rsq-event-change .k { color:#7a8794; font-size:11px; }
      .rsq-event-change .k::after { content:":"; }
      .rsq-event-change .old { color:#8e9aa5; text-decoration:line-through; }
      .rsq-event-change .arrow { color:#9aa6b1; }
      .rsq-event-change .new { color:#1f2a35; font-weight:600; }
      .rsq-event-change .note { color:#4f6273; }

      .rsq-event-comment { display:block; padding:8px 10px; border-left:2px solid #cfdce6; border-radius:0 4px 4px 0; background:#fbfcfd; color:#37474f; font-size:12.5px; line-height:1.55; }
      .rsq-event-comment-text { position:relative; overflow-wrap:anywhere; }
      .rsq-event-comment-text.is-clamped { max-height:10.9em; overflow:hidden; }
      .rsq-event-comment-text.is-clamped::after { content:""; position:absolute; right:0; bottom:0; left:0; height:2.2em; background:linear-gradient(rgba(251,252,253,0),#fbfcfd); }
      .rsq-event-card.expanded .rsq-event-comment { max-height:320px; overflow-y:auto; }
      .rsq-event-card.expanded .rsq-event-comment-text.is-clamped { max-height:none; overflow:visible; }
      .rsq-event-card.expanded .rsq-event-comment-text.is-clamped::after { content:none; }

      .rsq-md-p { margin:0 0 6px; }
      .rsq-event-comment-text > :last-child { margin-bottom:0; }
      .rsq-md-h { margin:7px 0 3px; color:#26313d; font-size:13px; font-weight:700; }
      .rsq-md-h[data-level="1"] { font-size:14px; }
      .rsq-md-h[data-level="2"] { font-size:13.5px; }
      .rsq-md-list { margin:4px 0; padding-left:20px; }
      .rsq-md-list li { margin:1px 0; }
      .rsq-md-quote { margin:5px 0; padding:1px 0 1px 9px; border-left:2px solid #c9d6e0; color:#6d7d8a; }
      .rsq-md-pre { margin:5px 0; padding:6px 8px; overflow-x:auto; border-radius:3px; background:#eef2f5; color:#33414d; font:11.5px/1.45 Consolas,"Courier New",monospace; white-space:pre-wrap; }
      .rsq-md-code { padding:0 3px; border-radius:2px; background:#eef2f5; color:#33414d; font:11.5px Consolas,"Courier New",monospace; }
      .rsq-md-link { color:#2c6b9d!important; text-decoration:underline; }
      .rsq-md-link:hover { color:#c61a1a!important; }
      .rsq-md-table { margin:5px 0; border-collapse:collapse; }
      .rsq-md-table td, .rsq-md-table th { padding:2px 7px; border:1px solid #d7dfe6; text-align:left; }
      .rsq-md-table th { background:#f1f5f8; }
      .rsq-md-hr { margin:7px 0; border:0; border-top:1px solid #dde4ea; }
      .rsq-event-tags { display:flex; flex-wrap:wrap; align-items:center; gap:6px; color:#8b97a1; font-size:11px; }
      .rsq-event-project { padding:1px 6px; border-radius:3px; background:#eef2f5; color:#63737f; }
      .rsq-event-card:not(.expanded) .rsq-is-extra { display:none; }
      .rsq-event-more { display:block; width:100%; padding:4px 12px 9px; border:0; background:none; color:#2c6b9d; font:inherit; font-size:11.5px; text-align:left; cursor:pointer; }
      .rsq-event-more:hover { color:#c61a1a; text-decoration:underline; }

      .rsq-events-empty { padding:34px 16px; color:#74828d; text-align:center; }
      .rsq-events-sentinel { padding:9px 12px; color:#8b97a1; font-size:11px; text-align:center; }
      .rsq-events-foot { display:flex; align-items:center; gap:10px; padding:7px 22px 7px 12px; border-top:1px solid #dfe5ea; background:#fafcfd; color:#8b97a1; font-size:11px; }
      .rsq-events-foot span:last-child { margin-left:auto; }
      @media(max-width:600px){.rsq-events-popover{width:calc(100vw - 16px)}}
    `;
    document.head.appendChild(style);
  }

  function relativeTime(value) {
    const time = new Date(value).getTime(); if (!Number.isFinite(time)) return '';
    const minutes = Math.max(0, Math.round((Date.now() - time) / 60000));
    if (minutes < 1) return 'только что';
    if (minutes < 60) return `${minutes} мин`;
    const hours = Math.round(minutes / 60); if (hours < 24) return `${hours} ч`;
    const days = Math.round(hours / 24); if (days < 30) return `${days} дн`;
    return new Date(value).toLocaleDateString('ru');
  }
  function shortTime(value) {
    const time = new Date(value);
    if (!Number.isFinite(time.getTime())) return '';
    return time.toDateString() === new Date().toDateString()
      ? time.toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })
      : time.toLocaleString('ru', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  }
  function unreadEvents() { return (feed.events || []).filter((event) => !feed.readKeys?.[event.key]); }
  function correctChangeGrammar(value) {
    return value === 'описание изменена' ? 'описание изменено' : value;
  }
  function normalizeComment(value) {
    return String(value || '').replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }
  function updateButton() {
    const count = unreadEvents().length;
    for (const button of buttons) {
      button.classList.toggle('has-unread', count > 0);
      button.querySelector('.rsq-events-count').textContent = count > 99 ? '99+' : String(count);
      button.setAttribute('aria-label', count ? `События: ${count} непрочитанных` : 'События');
    }
    if (unreadPill) {
      unreadPill.classList.toggle('is-on', count > 0);
      unreadPill.textContent = count === 1 ? '1 новое' : `${count} новых`;
    }
  }

  function createButton(className = '') {
    const button = document.createElement('button'); button.type = 'button'; button.className = `rsq-events-button${className ? ` ${className}` : ''}`;
    const title = document.createElement('span'); title.textContent = 'События';
    const count = document.createElement('span'); count.className = 'rsq-events-count';
    button.append(title, count);
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      anchorButton = button;
      toggle();
    });
    buttons.push(button);
    return button;
  }

  function taskSection() {
    const sidebar = document.querySelector('#sidebar');
    const taskHeading = sidebar ? [...sidebar.querySelectorAll('h2,h3,h4')].find((node) => node.textContent.trim().toLocaleLowerCase('ru') === 'задачи') : null;
    if (!taskHeading) return null;
    let nextSection = taskHeading.nextElementSibling;
    while (nextSection && !/^H[2-4]$/.test(nextSection.tagName)) nextSection = nextSection.nextElementSibling;
    return { heading: taskHeading, nextSection };
  }

  function mountButtons(placement = 'sidebar') {
    document.querySelectorAll('.rsq-events-sidebar, .rsq-events-fallback').forEach((node) => node.remove());
    buttons = [];
    anchorButton = null;
    const mode = ['sidebar', 'floating', 'both'].includes(placement) ? placement : 'sidebar';
    const section = taskSection();
    if (section && mode !== 'floating') {
      const host = document.createElement('div'); host.className = 'rsq-events-sidebar';
      host.appendChild(createButton());
      section.heading.parentElement.insertBefore(host, section.nextSection);
    }
    if (mode === 'floating' || mode === 'both' || !section) {
      document.body.appendChild(createButton('rsq-events-fallback'));
    }
    anchorButton = buttons[0] || null;
    updateButton();
    if (open) place();
  }

  function createPopover() {
    popover = document.createElement('section'); popover.className = 'rsq-events-popover'; popover.style.display = 'none';
    const head = document.createElement('div'); head.className = 'rsq-events-head';
    const title = document.createElement('strong'); title.textContent = 'Актуальные изменения';
    unreadPill = document.createElement('span'); unreadPill.className = 'rsq-events-pill';
    const spacer = document.createElement('span'); spacer.className = 'spacer';
    const refresh = document.createElement('button'); refresh.type = 'button'; refresh.className = 'rsq-events-icon'; refresh.textContent = '↻'; refresh.title = 'Обновить';
    refresh.addEventListener('click', async () => {
      if (refreshing) return;
      refreshing = true; refresh.disabled = true; refresh.textContent = '…';
      try { await chrome.runtime.sendMessage({ type: 'events.refresh', forceRecent: true }); }
      finally { refreshing = false; refresh.disabled = false; refresh.textContent = '↻'; }
    });
    const close = document.createElement('button'); close.type = 'button'; close.className = 'rsq-events-icon'; close.textContent = '×'; close.title = 'Закрыть'; close.addEventListener('click', hide);
    head.append(title, unreadPill, spacer, refresh, close);
    head.title = 'Перетащите за заголовок · двойной клик вернёт окно на место';
    makeDraggable(head);

    const controls = document.createElement('div'); controls.className = 'rsq-events-controls';
    const filterLabel = document.createElement('label');
    const filter = document.createElement('input'); filter.type = 'checkbox';
    const filterText = document.createElement('span'); filterText.textContent = 'Только непрочитанные';
    filter.addEventListener('change', () => { unreadOnly = filter.checked; render(); });
    filterLabel.append(filter, filterText);
    const readHint = document.createElement('span'); readHint.className = 'rsq-events-read-hint'; readHint.textContent = 'Сброс при закрытии';
    controls.append(filterLabel, readHint);
    tabsRow = document.createElement('div'); tabsRow.className = 'rsq-events-tabs';
    list = document.createElement('div'); list.className = 'rsq-events-list';
    const foot = document.createElement('div'); foot.className = 'rsq-events-foot';
    popover.append(head, tabsRow, controls, list, foot); document.body.appendChild(popover);
    watchListScroll();
    watchSize();
    applySize();
    return popover;
  }

  // --- размер и положение ---------------------------------------------------

  function detached() { return Number.isFinite(geometry.left) && Number.isFinite(geometry.top); }
  function saveGeometry() {
    geometryReady = true;
    clearTimeout(geometrySaveTimer);
    geometrySaveTimer = setTimeout(() => {
      void chrome.storage.local.set({ [UI_KEY]: { ...geometry } }).catch(() => {});
    }, 300);
  }
  // Высоту задаём явно: иначе список из полутора сотен карточек растянет окно
  // на весь экран, и тянуть его за угол будет уже некуда.
  function targetSize() {
    const width = Number.isFinite(geometry.width) ? geometry.width : DEFAULT_WIDTH;
    const height = Number.isFinite(geometry.height) ? geometry.height : DEFAULT_HEIGHT;
    return {
      width: Math.round(Math.max(MIN_WIDTH, Math.min(width, innerWidth - 20))),
      height: Math.round(Math.max(MIN_HEIGHT, Math.min(height, innerHeight - 24))),
    };
  }
  function applySize() {
    if (!popover) return;
    const size = targetSize();
    popover.style.width = `${size.width}px`;
    popover.style.height = `${size.height}px`;
  }
  function watchSize() {
    if (sizeObserver || typeof ResizeObserver !== 'function') return;
    sizeObserver = new ResizeObserver(() => {
      // До чтения хранилища окно стоит на размере по умолчанию — сохранять его рано.
      if (!geometryReady) return;
      // Ручку тянет только человек: браузер пишет размер в инлайн-стиль.
      const width = Math.round(parseFloat(popover.style.width));
      const height = Math.round(parseFloat(popover.style.height));
      if (!Number.isFinite(width) || !Number.isFinite(height)) return;
      // Размер, выставленный самим applySize, ничего не меняет: иначе окно
      // браузера, ужатое на время, навсегда ужало бы и сохранённый размер.
      const size = targetSize();
      if (width === size.width && height === size.height) return;
      geometry = { ...geometry, width, height };
      if (open) place();
      saveGeometry();
    });
    sizeObserver.observe(popover);
  }
  function makeDraggable(handle) {
    handle.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || event.target.closest('button, input, a')) return;
      const rect = popover.getBoundingClientRect();
      const startX = event.clientX; const startY = event.clientY;
      let moved = false;
      const move = (moveEvent) => {
        const dx = moveEvent.clientX - startX; const dy = moveEvent.clientY - startY;
        if (!moved && Math.abs(dx) + Math.abs(dy) < 3) return;
        if (!moved) { moved = true; popover.classList.add('is-dragging'); handle.setPointerCapture(event.pointerId); }
        geometry = { ...geometry, left: rect.left + dx, top: rect.top + dy };
        place();
      };
      const up = () => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        handle.removeEventListener('pointercancel', up);
        popover.classList.remove('is-dragging');
        if (moved) saveGeometry();
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
      handle.addEventListener('pointercancel', up);
    });
    handle.addEventListener('dblclick', (event) => {
      if (event.target.closest('button, input, a')) return;
      geometry = { left: null, top: null, width: null, height: null };
      applySize(); place(); saveGeometry();
    });
  }

  function place() {
    if (!popover) return;
    const width = popover.offsetWidth; const height = popover.offsetHeight;
    let left; let top;
    if (detached()) {
      left = geometry.left; top = geometry.top;
    } else {
      const button = anchorButton?.isConnected ? anchorButton : buttons.find((node) => node.isConnected);
      if (!button) return;
      anchorButton = button;
      const rect = button.getBoundingClientRect();
      left = rect.right - width;
      top = rect.bottom + 7;
      if (top + height > innerHeight - 8) top = rect.top - height - 7;
    }
    left = Math.max(8, Math.min(left, innerWidth - width - 8));
    top = Math.max(8, Math.min(top, innerHeight - height - 8));
    if (detached()) geometry = { ...geometry, left, top };
    popover.style.left = `${left}px`; popover.style.top = `${top}px`;
  }

  function part(className, text) {
    const node = document.createElement('span');
    if (className) node.className = className;
    node.textContent = text;
    return node;
  }
  // Новые события приходят со структурой поля, старые из кэша — только строкой.
  function changeFields(event) {
    if (Array.isArray(event.fields) && event.fields.length) return event.fields;
    return (event.changes || []).map((text) => ({ text: correctChangeGrammar(text) }));
  }
  function changeRow(field) {
    const row = document.createElement('span'); row.className = 'rsq-event-change';
    if (field.label) row.appendChild(part('k', field.label));
    if (field.from && field.to) row.append(part('old', field.from), part('arrow', '→'), part('new', field.to));
    else if (field.to) row.appendChild(part('new', field.to));
    else if (field.from) row.append(part('old', field.from), part('note', field.text || 'очищено'));
    else row.appendChild(part('note', field.text || 'изменено'));
    return row;
  }

  function eventNode(event) {
    const unread = !feed.readKeys?.[event.key];
    const card = document.createElement('article'); card.className = `rsq-event-card${unread ? ' unread' : ''}`;
    const noteTarget = event.noteNumber || event.journalId;
    const href = `${redmineBaseUrl}/issues/${event.issueId}${noteTarget ? `#note-${noteTarget}` : ''}`;
    // Карточка перестала быть одной большой ссылкой: в комментарии встречается
    // своя разметка со ссылками, а вложенные <a> внутри <a> недопустимы.
    const link = document.createElement('div'); link.className = 'rsq-event';

    const top = document.createElement('span'); top.className = 'rsq-event-top';
    if (event.version) top.appendChild(part('rsq-event-version', event.version));
    top.append(part('rsq-event-id', `#${event.issueId}`), part('rsq-event-status', event.status || 'задача'));
    const time = part('rsq-event-time', relativeTime(event.at)); time.title = new Date(event.at).toLocaleString('ru');
    top.appendChild(time);
    const subject = document.createElement('a'); subject.className = 'rsq-event-subject'; subject.href = href; subject.textContent = event.subject || '';
    link.append(top, subject);

    const fields = changeFields(event);
    const comment = normalizeComment(event.comment);
    const summary = event.summary || (!fields.length && !comment ? 'обновил задачу' : '');
    if (event.actor || summary) {
      const actor = document.createElement('span'); actor.className = 'rsq-event-actor';
      if (event.actor) {
        const name = document.createElement('strong'); name.textContent = event.actor;
        actor.appendChild(name);
        if (summary) actor.appendChild(document.createTextNode(` · ${summary}`));
      } else actor.textContent = summary;
      link.appendChild(actor);
    }

    if (fields.length) {
      const changes = document.createElement('span'); changes.className = 'rsq-event-changes';
      fields.forEach((field, index) => {
        const row = changeRow(field);
        if (index >= VISIBLE_CHANGES) row.classList.add('rsq-is-extra');
        changes.appendChild(row);
      });
      link.appendChild(changes);
    }
    const hiddenChanges = Math.max(0, fields.length - VISIBLE_CHANGES);
    const longComment = comment.length > LONG_COMMENT_CHARS || comment.split('\n').length > LONG_COMMENT_LINES;
    if (comment) {
      const box = document.createElement('span'); box.className = 'rsq-event-comment';
      const text = document.createElement('div'); text.className = `rsq-event-comment-text${longComment ? ' is-clamped' : ''}`;
      const markup = globalThis.RedmineSmallQol.renderTextile;
      if (markup) text.appendChild(markup(comment, { baseUrl: redmineBaseUrl }));
      else { text.style.whiteSpace = 'pre-wrap'; text.textContent = comment; }
      box.appendChild(text);
      link.appendChild(box);
    }

    const tags = document.createElement('span'); tags.className = 'rsq-event-tags';
    if (event.project) tags.appendChild(part('rsq-event-project', event.project));
    const reasons = (event.reasons || []).filter(Boolean);
    if (reasons.length) tags.appendChild(part('', reasons.join(' · ')));
    if (tags.childElementCount) link.appendChild(tags);

    link.addEventListener('click', (clickEvent) => {
      markCurrentRead();
      // Собственные ссылки комментария и кнопки ведут себя сами по себе.
      if (clickEvent.target.closest('a, button')) return;
      if (clickEvent.button === 0 && !clickEvent.ctrlKey && !clickEvent.metaKey && !clickEvent.shiftKey) location.href = href;
    });
    card.appendChild(link);

    if (hiddenChanges || longComment) {
      const collapsedLabel = hiddenChanges ? `Показать полностью · ещё ${hiddenChanges}` : 'Показать полностью';
      const more = document.createElement('button'); more.type = 'button'; more.className = 'rsq-event-more'; more.textContent = collapsedLabel;
      more.addEventListener('click', (clickEvent) => {
        clickEvent.stopPropagation();
        const expanded = card.classList.toggle('expanded');
        more.textContent = expanded ? 'Свернуть' : collapsedLabel;
        if (open) place();
      });
      card.appendChild(more);
    }
    return card;
  }

  function tabScope(tabId) {
    const scope = scopes?.[tabId];
    return Array.isArray(scope?.issueIds) && scope.issueIds.length ? scope : null;
  }
  function tabEvents(tabId) {
    const events = feed.events || [];
    if (tabId === 'all') return events;
    const scope = tabScope(tabId);
    if (!scope) return [];
    const ids = new Set(scope.issueIds.map(String));
    return events.filter((event) => ids.has(String(event.issueId)));
  }
  function tabLabel(filter) { return filter.label || `#${filter.issueId}`; }
  function renderTabs() {
    if (!tabsRow) return;
    tabsRow.replaceChildren();
    tabsRow.classList.toggle('is-on', filters.length > 0);
    if (!filters.length) { activeTab = 'all'; return; }
    if (activeTab !== 'all' && !filters.some((filter) => filter.id === activeTab)) activeTab = 'all';
    const options = [{ id: 'all', label: 'Все' }, ...filters.map((filter) => ({ id: filter.id, label: tabLabel(filter) }))];
    for (const option of options) {
      const tab = document.createElement('button'); tab.type = 'button';
      tab.className = `rsq-events-tab${option.id === activeTab ? ' is-active' : ''}`;
      tab.appendChild(part('', option.label));
      const unread = tabEvents(option.id).filter((event) => !feed.readKeys?.[event.key]).length;
      if (unread) tab.appendChild(part('rsq-events-tab-count', unread > 99 ? '99+' : String(unread)));
      tab.addEventListener('click', () => { activeTab = option.id; render(); });
      tabsRow.appendChild(tab);
    }
  }
  function emptyText() {
    if (activeTab !== 'all' && !tabScope(activeTab)) return 'Задачи этой вкладки ещё не загружены — нажмите ↻.';
    if (unreadOnly) return 'Непрочитанных изменений нет.';
    return activeTab === 'all' ? 'Событий пока нет.' : 'В этой вкладке пока нет событий.';
  }
  function appendBatch() {
    if (!list || queueIndex >= queue.length) return;
    const fragment = document.createDocumentFragment();
    const end = Math.min(queue.length, queueIndex + RENDER_BATCH);
    for (; queueIndex < end; queueIndex += 1) fragment.appendChild(eventNode(queue[queueIndex]));
    sentinel?.remove();
    list.appendChild(fragment);
    const rest = queue.length - queueIndex;
    renderFoot(queueIndex, queue.length);
    if (!rest) return;
    if (!sentinel) { sentinel = document.createElement('div'); sentinel.className = 'rsq-events-sentinel'; }
    sentinel.textContent = `Ещё ${rest}…`;
    list.appendChild(sentinel);
    // Порция могла не заполнить видимую часть — тогда прокрутки не будет и
    // подгружать придётся сразу.
    requestAnimationFrame(() => {
      if (open && sentinel?.isConnected && list.scrollHeight <= list.clientHeight + 4) appendBatch();
    });
  }
  function watchListScroll() {
    list.addEventListener('scroll', () => {
      if (!open || queueIndex >= queue.length) return;
      if (list.scrollTop + list.clientHeight >= list.scrollHeight - 400) appendBatch();
    }, { passive: true });
  }
  function renderFoot(shown, total) {
    const foot = popover?.querySelector('.rsq-events-foot');
    if (!foot) return;
    const scope = activeTab === 'all' ? null : tabScope(activeTab);
    const counts = [
      total ? (shown < total ? `Событий: ${shown} из ${total}` : `Событий: ${total}`) : '',
      scope ? `задач в области: ${scope.issueIds.length}` : '',
    ].filter(Boolean).join(' · ');
    foot.replaceChildren(
      part('', counts),
      part('', feed.checkedAt ? `Проверено ${shortTime(feed.checkedAt)}` : 'Ещё не проверялось'),
    );
  }
  function renderList() {
    if (!list) return;
    listDirty = false;
    sentinel?.remove();
    list.replaceChildren();
    list.scrollTop = 0;
    queue = tabEvents(activeTab).filter((event) => !unreadOnly || !feed.readKeys?.[event.key]);
    queueIndex = 0;
    if (!queue.length) {
      const empty = document.createElement('div'); empty.className = 'rsq-events-empty';
      empty.textContent = emptyText(); list.appendChild(empty);
    } else appendBatch();
    renderFoot(queueIndex, queue.length);
  }
  function render() {
    updateButton(); renderTabs();
    // Пока окно закрыто, карточки не строим: лента обновляется каждые несколько
    // минут, а перерисовка всего списка в фоне ничего не даёт.
    if (!open) { listDirty = true; return; }
    renderList();
    place();
  }
  async function show() {
    open = true;
    (popover || createPopover()).style.display = 'grid';
    renderTabs(); updateButton();
    if (listDirty || !list.childElementCount) renderList();
    place();
    requestAnimationFrame(() => { if (open) popover.classList.add('is-open'); });
    if (!refreshing) {
      refreshing = true;
      try { await chrome.runtime.sendMessage({ type: 'events.refresh' }); }
      finally { refreshing = false; }
    }
  }
  function markCurrentRead() {
    // Прочитанными считаем только то, что человек действительно видел: события
    // открытой вкладки, а не всю ленту целиком.
    const keys = tabEvents(activeTab).filter((event) => !feed.readKeys?.[event.key]).map((event) => event.key);
    if (!keys.length) return;
    const readKeys = { ...(feed.readKeys || {}) };
    for (const key of keys) readKeys[key] = true;
    feed = { ...feed, readKeys };
    updateButton();
    void chrome.runtime.sendMessage({ type: 'events.read', keys }).catch(() => {});
  }
  function hide() {
    if (!open) return;
    open = false;
    if (popover) { popover.classList.remove('is-open'); popover.style.display = 'none'; }
    // Карточки в скрытом окне только занимают память и тормозят следующий рендер.
    if (list) { sentinel?.remove(); list.replaceChildren(); }
    queue = []; queueIndex = 0; listDirty = true;
    markCurrentRead();
  }
  function toggle() { if (open) hide(); else void show(); }

  // Сигнал синтезируется на месте: бинарный звук в расширении не нужен, а громкость
  // остаётся заведомо тихой и не зависит от системной схемы уведомлений.
  function audio() {
    if (audioContext) return audioContext;
    const Ctor = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Ctor) return null;
    try { audioContext = new Ctor(); } catch { audioContext = null; }
    return audioContext;
  }
  function primeAudio() {
    const context = audio();
    if (context?.state === 'suspended') void context.resume().catch(() => {});
  }
  async function playChime() {
    if (!soundEnabled) return false;
    const context = audio();
    if (!context) return false;
    // Без пользовательского жеста на вкладке браузер держит контекст выключенным.
    if (context.state === 'suspended') { try { await context.resume(); } catch { return false; } }
    if (context.state !== 'running') return false;
    const now = context.currentTime;
    const soft = context.createBiquadFilter(); soft.type = 'lowpass'; soft.frequency.value = 2400;
    const master = context.createGain(); master.gain.value = 1;
    master.connect(soft); soft.connect(context.destination);
    const tone = (frequency, delay, peak) => {
      const start = now + delay;
      const oscillator = context.createOscillator(); oscillator.type = 'sine'; oscillator.frequency.value = frequency;
      const gain = context.createGain();
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(peak, start + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.42);
      oscillator.connect(gain); gain.connect(master);
      oscillator.start(start); oscillator.stop(start + 0.45);
    };
    tone(784, 0, 0.05);
    tone(1046.5, 0.12, 0.035);
    return true;
  }

  function readFilters(settings) {
    return (Array.isArray(settings?.eventFilters) ? settings.eventFilters : [])
      .map((filter) => ({ id: String(filter?.id || ''), label: String(filter?.label || '').trim(), issueId: Number(filter?.issueId) || 0 }))
      .filter((filter) => filter.id && filter.issueId > 0);
  }
  function applySettings(settings) {
    redmineBaseUrl = globalThis.RedmineSmallQol.normalizeBaseUrl(settings.baseUrl) || location.origin;
    soundEnabled = settings.eventSound !== false;
    filters = readFilters(settings);
  }

  ensureStyles();
  globalThis.RedmineSmallQol.getSettings().then((settings) => {
    applySettings(settings);
    mountButtons(settings.eventButtonPlacement);
    render();
  }).catch(() => mountButtons());
  function readGeometry(stored) {
    // Сброшенное положение хранится как null, а Number(null) — это ноль,
    // из-за которого окно уехало бы в левый верхний угол.
    const number = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);
    const size = (value, min) => {
      const parsed = number(value);
      return parsed === null ? null : Math.max(min, Math.round(parsed));
    };
    return {
      left: number(stored?.left), top: number(stored?.top),
      width: size(stored?.width, MIN_WIDTH), height: size(stored?.height, MIN_HEIGHT),
    };
  }
  chrome.storage.local.get([FEED_KEY, SCOPE_KEY, UI_KEY]).then((data) => {
    feed = data[FEED_KEY] || feed;
    scopes = data[SCOPE_KEY] || scopes;
    // Если человек успел подвинуть окно раньше ответа хранилища, его выбор главнее.
    if (!geometryReady) {
      geometry = readGeometry(data[UI_KEY]);
      geometryReady = true;
      if (popover) { applySize(); if (open) place(); }
    }
    render();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes[FEED_KEY]) feed = changes[FEED_KEY].newValue || feed;
    if (changes[SCOPE_KEY]) scopes = changes[SCOPE_KEY].newValue || {};
    if (changes.settings) {
      const settings = changes.settings.newValue || {};
      applySettings(settings);
      mountButtons(settings.eventButtonPlacement);
    }
    if (changes[FEED_KEY] || changes[SCOPE_KEY] || changes.settings) render();
  });
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== 'events.chime') return false;
    playChime().then((played) => sendResponse({ ok: played })).catch(() => sendResponse({ ok: false }));
    return true;
  });
  document.addEventListener('pointerdown', primeAudio, { capture: true, once: true, passive: true });
  document.addEventListener('keydown', primeAudio, { capture: true, once: true });
  document.addEventListener('click', (event) => {
    if (!open) return;
    // Путь события берём на момент отправки: переключение вкладки перерисовывает
    // их прямо в обработчике, и к этому моменту сама кнопка уже вне документа.
    const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
    const inside = path.length
      ? path.includes(popover) || buttons.some((button) => path.includes(button))
      : Boolean(popover?.contains(event.target)) || buttons.some((button) => button.contains(event.target));
    if (!inside) hide();
  });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') hide(); });
  addEventListener('resize', () => { if (!open) return; applySize(); place(); }, { passive: true });
  // Пока окно висит у кнопки, оно едет вместе со страницей; перетащенное окно
  // человек поставил сам — прокрутка его не трогает.
  addEventListener('scroll', () => {
    if (!open || detached() || scrollFrame) return;
    scrollFrame = requestAnimationFrame(() => {
      scrollFrame = 0;
      if (!open || detached()) return;
      // Кнопка уехала за край — окно остаётся там, где стояло, а не прилипает к краю.
      const rect = anchorButton?.getBoundingClientRect();
      if (rect && (rect.bottom < 0 || rect.top > innerHeight)) return;
      place();
    });
  }, { passive: true });
})();
