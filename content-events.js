(() => {
  'use strict';

  const FEED_KEY = 'eventFeed';
  const STYLE_ID = 'rsq-events-style';
  let feed = { events: [], readKeys: {}, checkedAt: '' };
  let buttons = [];
  let anchorButton = null;
  let popover = null;
  let list = null;
  let unreadOnly = false;
  let open = false;
  let refreshing = false;
  let redmineBaseUrl = location.origin;

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
      .rsq-events-popover { position:fixed; z-index:10020; box-sizing:border-box; width:430px; max-width:calc(100vw - 20px); max-height:min(560px,calc(100vh - 20px)); display:grid; grid-template-rows:auto auto minmax(90px,1fr) auto; overflow:hidden; border:1px solid #b9c5cf; border-radius:5px; background:#fff; box-shadow:0 7px 24px rgba(20,40,60,.24); color:#26313d; font:12px/1.4 Arial,sans-serif; }
      .rsq-events-head { display:flex; align-items:center; gap:8px; padding:10px 11px; border-bottom:1px solid #d5dde4; background:#f3f6f8; }
      .rsq-events-head strong { font-size:14px; }
      .rsq-events-head .spacer { flex:1; }
      .rsq-events-icon { min-width:28px; min-height:27px; padding:2px 7px; border:1px solid #bdc9d3; border-radius:3px; background:#fff; color:#40566a; cursor:pointer; }
      .rsq-events-icon:disabled { opacity:.55; cursor:default; }
      .rsq-events-controls { display:flex; align-items:center; gap:10px; padding:7px 11px; border-bottom:1px solid #e0e6eb; color:#647484; font-size:11px; }
      .rsq-events-controls label { display:flex; align-items:center; gap:4px; cursor:pointer; }
      .rsq-events-controls input { margin:0; }
      .rsq-events-read-hint { margin-left:auto; color:#89959e; font-size:10px; }
      .rsq-events-list { overflow-y:auto; padding:5px; background:#f8fafb; }
      .rsq-event { position:relative; display:grid; gap:4px; margin-bottom:5px; padding:9px 10px 9px 12px; border:1px solid #d4dce3; border-left:3px solid #d4dce3; border-radius:4px; background:#fff; color:inherit; text-decoration:none!important; }
      .rsq-event:hover { border-color:#aebcc8; background:#fbfdff; }
      .rsq-event.unread { border-left-color:#377fb8; }
      .rsq-event-head { display:flex; align-items:center; gap:6px; min-width:0; }
      .rsq-event-id { color:#326b9b; font-weight:700; }
      .rsq-event-version { padding:0 5px; border:1px solid #a9c7df; border-radius:3px; background:#eaf3fa; color:#315d84; font-size:10px; font-weight:600; }
      .rsq-event-status { padding:0 5px; border:1px solid #d1dae2; border-radius:3px; background:#f3f6f8; color:#526675; font-size:10px; }
      .rsq-event-time { margin-left:auto; white-space:nowrap; color:#89959e; font-size:10px; }
      .rsq-event-subject { overflow:hidden; color:#26313d; font-weight:600; text-overflow:ellipsis; white-space:nowrap; }
      .rsq-event-action { color:#576977; font-size:11px; }
      .rsq-event-action strong { color:#33495b; }
      .rsq-event-comment { display:-webkit-box; overflow:hidden; color:#71808b; font-size:11px; font-style:italic; -webkit-box-orient:vertical; -webkit-line-clamp:2; line-clamp:2; }
      .rsq-event-tags { color:#909ba3; font-size:10px; }
      .rsq-events-empty { padding:28px 16px; color:#74828d; text-align:center; }
      .rsq-events-foot { padding:6px 11px; border-top:1px solid #dce3e8; color:#8a969f; font-size:10px; text-align:right; }
      @media(max-width:520px){.rsq-events-popover{width:calc(100vw - 16px)}}
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
  function unreadEvents() { return (feed.events || []).filter((event) => !feed.readKeys?.[event.key]); }
  function correctChangeGrammar(value) {
    return value === 'описание изменена' ? 'описание изменено' : value;
  }
  function updateButton() {
    const count = unreadEvents().length;
    for (const button of buttons) {
      button.classList.toggle('has-unread', count > 0);
      button.querySelector('.rsq-events-count').textContent = count > 99 ? '99+' : String(count);
      button.setAttribute('aria-label', count ? `События: ${count} непрочитанных` : 'События');
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
    const spacer = document.createElement('span'); spacer.className = 'spacer';
    const refresh = document.createElement('button'); refresh.type = 'button'; refresh.className = 'rsq-events-icon'; refresh.textContent = '↻'; refresh.title = 'Обновить';
    refresh.addEventListener('click', async () => {
      if (refreshing) return;
      refreshing = true; refresh.disabled = true; refresh.textContent = '…';
      try { await chrome.runtime.sendMessage({ type: 'events.refresh', forceRecent: true }); }
      finally { refreshing = false; refresh.disabled = false; refresh.textContent = '↻'; }
    });
    const close = document.createElement('button'); close.type = 'button'; close.className = 'rsq-events-icon'; close.textContent = '×'; close.title = 'Закрыть'; close.addEventListener('click', hide);
    head.append(title, spacer, refresh, close);

    const controls = document.createElement('div'); controls.className = 'rsq-events-controls';
    const filterLabel = document.createElement('label');
    const filter = document.createElement('input'); filter.type = 'checkbox';
    const filterText = document.createElement('span'); filterText.textContent = 'Только непрочитанные';
    filter.addEventListener('change', () => { unreadOnly = filter.checked; render(); });
    filterLabel.append(filter, filterText);
    const readHint = document.createElement('span'); readHint.className = 'rsq-events-read-hint'; readHint.textContent = 'Сброс при закрытии';
    controls.append(filterLabel, readHint);
    list = document.createElement('div'); list.className = 'rsq-events-list';
    const foot = document.createElement('div'); foot.className = 'rsq-events-foot';
    popover.append(head, controls, list, foot); document.body.appendChild(popover);
    return popover;
  }

  function place() {
    const button = anchorButton?.isConnected ? anchorButton : buttons.find((node) => node.isConnected);
    if (!button || !popover) return;
    anchorButton = button;
    const rect = button.getBoundingClientRect();
    popover.style.display = 'grid'; popover.style.visibility = 'hidden';
    const width = popover.offsetWidth; const height = popover.offsetHeight;
    let left = Math.min(innerWidth - width - 8, Math.max(8, rect.right - width));
    let top = rect.bottom + 7;
    if (top + height > innerHeight - 8) top = Math.max(8, rect.top - height - 7);
    popover.style.left = `${left}px`; popover.style.top = `${top}px`; popover.style.visibility = 'visible';
  }

  function eventNode(event) {
    const unread = !feed.readKeys?.[event.key];
    const link = document.createElement('a'); link.className = `rsq-event${unread ? ' unread' : ''}`;
    const noteTarget = event.noteNumber || event.journalId;
    link.href = `${redmineBaseUrl}/issues/${event.issueId}${noteTarget ? `#note-${noteTarget}` : ''}`;
    const head = document.createElement('span'); head.className = 'rsq-event-head';
    const id = document.createElement('span'); id.className = 'rsq-event-id'; id.textContent = `#${event.issueId}`;
    const status = document.createElement('span'); status.className = 'rsq-event-status'; status.textContent = event.status || 'задача';
    const time = document.createElement('span'); time.className = 'rsq-event-time'; time.textContent = relativeTime(event.at); time.title = new Date(event.at).toLocaleString('ru');
    if (event.version) { const version = document.createElement('span'); version.className = 'rsq-event-version'; version.textContent = event.version; head.appendChild(version); }
    head.append(id, status, time);
    const subject = document.createElement('span'); subject.className = 'rsq-event-subject'; subject.textContent = event.subject || '';
    const action = document.createElement('span'); action.className = 'rsq-event-action';
    const summary = event.summary || (event.changes?.length
      ? event.changes.slice(0, 2).map(correctChangeGrammar).join(', ')
      : (event.comment ? 'добавил комментарий' : 'обновил задачу'));
    if (event.actor) {
      const actor = document.createElement('strong'); actor.textContent = event.actor;
      action.append(actor, document.createTextNode(` · ${summary}`));
    } else action.textContent = summary;
    link.append(head, subject, action);
    if (event.comment) { const comment = document.createElement('span'); comment.className = 'rsq-event-comment'; comment.textContent = event.comment; link.appendChild(comment); }
    const tags = [event.project, ...(event.reasons || [])].filter(Boolean);
    if (tags.length) { const node = document.createElement('span'); node.className = 'rsq-event-tags'; node.textContent = tags.join(' · '); link.appendChild(node); }
    link.addEventListener('click', markCurrentRead);
    return link;
  }

  function render() {
    updateButton(); if (!list) return;
    list.replaceChildren();
    const events = (feed.events || []).filter((event) => !unreadOnly || !feed.readKeys?.[event.key]);
    if (!events.length) {
      const empty = document.createElement('div'); empty.className = 'rsq-events-empty';
      empty.textContent = unreadOnly ? 'Непрочитанных изменений нет.' : 'Событий пока нет.'; list.appendChild(empty);
    } else for (const event of events) list.appendChild(eventNode(event));
    const foot = popover?.querySelector('.rsq-events-foot');
    if (foot) foot.textContent = feed.checkedAt ? `Проверено ${new Date(feed.checkedAt).toLocaleString('ru')}` : 'Ещё не проверялось';
    if (open) place();
  }
  async function show() {
    open = true; (popover || createPopover()).style.display = 'grid'; render(); place();
    if (!refreshing) {
      refreshing = true;
      try { await chrome.runtime.sendMessage({ type: 'events.refresh' }); }
      finally { refreshing = false; }
    }
  }
  function markCurrentRead() {
    const keys = (feed.events || []).filter((event) => !feed.readKeys?.[event.key]).map((event) => event.key);
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
    if (popover) popover.style.display = 'none';
    markCurrentRead();
  }
  function toggle() { if (open) hide(); else void show(); }

  ensureStyles();
  globalThis.RedmineSmallQol.getSettings().then((settings) => {
    redmineBaseUrl = globalThis.RedmineSmallQol.normalizeBaseUrl(settings.baseUrl) || location.origin;
    mountButtons(settings.eventButtonPlacement);
    if (list) render();
  }).catch(() => mountButtons());
  chrome.storage.local.get(FEED_KEY).then((data) => { feed = data[FEED_KEY] || feed; render(); });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes[FEED_KEY]) { feed = changes[FEED_KEY].newValue || feed; render(); }
    if (changes.settings) {
      const settings = changes.settings.newValue || {};
      redmineBaseUrl = globalThis.RedmineSmallQol.normalizeBaseUrl(settings.baseUrl) || location.origin;
      mountButtons(settings.eventButtonPlacement);
    }
  });
  document.addEventListener('click', (event) => {
    if (open && !popover?.contains(event.target) && !buttons.some((button) => button.contains(event.target))) hide();
  });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') hide(); });
  addEventListener('resize', () => { if (open) place(); }, { passive: true });
  addEventListener('scroll', hide, { passive: true });
})();
