(() => {
  'use strict';

  const qol = globalThis.RedmineSmallQol;
  const GROUPS_KEY = 'watcherGroups';
  const LAST_KEY = 'watcherGroupsLast';
  const STYLE_ID = 'rsq-watchers-style';
  let groups = {};
  let lastGroup = '';
  let scheduled = false;

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #users_for_watcher.rsq-watcher-host { height:auto!important; max-height:none!important; overflow:visible!important; }
      .rsq-watcher-layout { display:grid; grid-template-columns:minmax(330px,1fr) 280px; gap:14px; align-items:stretch; height:min(620px,calc(100vh - 180px)); min-height:280px; }
      .rsq-watcher-layout > div:first-child { display:flex; flex-direction:column; min-height:0; }
      .rsq-watcher-users { box-sizing:border-box; flex:1; min-height:0; overflow:auto; padding:8px; border:1px solid #ccd5dd; background:#fff; }
      .rsq-watcher-users label { display:block; float:none!important; width:auto!important; }
      .rsq-watcher-filter { display:flex; gap:4px; align-items:center; margin:0 0 7px; font-size:11px; }
      .rsq-watcher-filter button, .rsq-watcher-panel button, .rsq-issue-groups button { min-height:27px; padding:3px 8px; border:1px solid #bdc9d3; border-radius:3px; background:#f7f9fb; color:#40566a; cursor:pointer; }
      .rsq-watcher-filter button.active { border-color:#4f86b8; background:#dfeefa; color:#315d84; font-weight:bold; }
      .rsq-watcher-filter .count { margin-left:auto; color:#6c7b87; }
      .rsq-watcher-panel { box-sizing:border-box; display:grid; align-content:start; gap:9px; max-height:100%; overflow:auto; padding:12px; border:1px solid #b8c9db; border-radius:4px; background:#f3f7fb; color:#33485c; }
      .rsq-watcher-panel h3 { margin:0; font-size:14px; }
      .rsq-watcher-panel select { width:100%; min-height:32px; }
      .rsq-watcher-members { max-height:150px; overflow:auto; margin:0; padding:7px 7px 7px 24px; border:1px solid #d5dee7; background:#fff; font-size:11px; }
      .rsq-watcher-actions { display:grid; gap:6px; }
      .rsq-watcher-actions .primary { border-color:#3f78aa; background:#4f86b8; color:#fff; }
      .rsq-watcher-status { min-height:16px; color:#536577; font-size:11px; }
      .rsq-watcher-status.error { color:#a33e2f; }
      .rsq-dialog-wide { position:fixed!important; top:50%!important; left:50%!important; width:min(920px,calc(100vw - 20px))!important; max-width:calc(100vw - 20px)!important; max-height:calc(100vh - 16px)!important; margin:0!important; transform:translate(-50%,-50%)!important; }
      .rsq-dialog-wide .ui-dialog-content, .rsq-dialog-wide #ajax-modal { box-sizing:border-box; height:auto!important; max-height:calc(100vh - 86px)!important; overflow:auto!important; }
      .rsq-issue-groups { display:flex; flex-wrap:wrap; align-items:center; gap:5px; margin-top:7px; }
      .rsq-issue-groups select { max-width:170px; }
      .rsq-issue-group-status { width:100%; color:#647484; font-size:11px; }
      .rsq-issue-group-status.error { color:#a33e2f; }
      @media(max-width:720px){.rsq-watcher-layout{grid-template-columns:1fr;height:auto}.rsq-watcher-users{height:38vh;flex:none}}
    `;
    document.head.appendChild(style);
  }

  function checkboxes(scope) {
    return [...scope.querySelectorAll('input[type="checkbox"]')].filter((box) => {
      const name = box.getAttribute('name') || '';
      return /watcher|user_ids/i.test(name) || Boolean(box.closest('#users_for_watcher'));
    });
  }
  function memberOf(box) {
    const label = box.closest('label') || (box.id ? document.querySelector(`label[for="${CSS.escape(box.id)}"]`) : null);
    return { id: String(box.value || box.dataset.userId || box.id || '').trim(), name: (label?.textContent || '').trim().replace(/\s+/g, ' ') };
  }
  async function persist() { await chrome.storage.local.set({ [GROUPS_KEY]: groups, [LAST_KEY]: lastGroup }); }
  function selectedName(panel) { return panel.querySelector('.rsq-group-select')?.value || ''; }

  function fillGroupUi(panel, preferred = '') {
    const select = panel.querySelector('.rsq-group-select');
    const members = panel.querySelector('.rsq-watcher-members');
    if (!select || !members) return;
    const names = Object.keys(groups).sort((a, b) => a.localeCompare(b, 'ru'));
    const selected = groups[preferred] ? preferred : (groups[lastGroup] ? lastGroup : names[0] || '');
    select.replaceChildren();
    for (const name of names) {
      const option = document.createElement('option');
      option.value = name; option.textContent = `${name} (${groups[name].length})`; option.selected = name === selected;
      select.appendChild(option);
    }
    if (!names.length) {
      const option = document.createElement('option'); option.value = ''; option.textContent = 'Групп пока нет'; select.appendChild(option);
    }
    members.replaceChildren();
    for (const member of groups[selected] || []) {
      const item = document.createElement('li'); item.textContent = member.name || `Пользователь ${member.id}`; members.appendChild(item);
    }
    if (!members.children.length) { const item = document.createElement('li'); item.textContent = 'Состав группы пуст'; members.appendChild(item); }
    panel.querySelector('[data-action="apply"]').disabled = !selected;
    panel.querySelector('[data-action="delete"]').disabled = !selected;
  }

  function applyFilter(root) {
    const mode = root.dataset.filter || 'all';
    const panel = root.querySelector('.rsq-watcher-panel');
    const selected = selectedName(panel);
    const groupIds = new Set((groups[selected] || []).map((member) => String(member.id)));
    const boxes = checkboxes(root.querySelector('.rsq-watcher-users'));
    let visible = 0;
    for (const box of boxes) {
      const row = box.closest('label,li,tr,p') || box.parentElement;
      const show = mode === 'all' || (mode === 'checked' && box.checked) || (mode === 'group' && groupIds.has(memberOf(box).id));
      if (row) row.style.display = show ? '' : 'none';
      if (show) visible += 1;
    }
    for (const button of root.querySelectorAll('[data-filter]')) button.classList.toggle('active', button.dataset.filter === mode);
    root.querySelector('.rsq-watcher-filter .count').textContent = `${visible} из ${boxes.length}`;
  }

  function setPanelStatus(panel, text, error = false) {
    const node = panel.querySelector('.rsq-watcher-status');
    node.textContent = text; node.classList.toggle('error', error);
  }

  function createPanel(root) {
    const panel = document.createElement('section');
    panel.className = 'rsq-watcher-panel';
    panel.innerHTML = `
      <h3>Группы наблюдателей</h3>
      <select class="rsq-group-select" aria-label="Группа наблюдателей"></select>
      <ol class="rsq-watcher-members"></ol>
      <div class="rsq-watcher-actions">
        <button type="button" class="primary" data-action="apply">Отметить всю группу</button>
        <button type="button" data-action="save">Сохранить отмеченных…</button>
        <button type="button" data-action="delete">Удалить группу</button>
      </div>
      <div class="rsq-watcher-status" aria-live="polite"></div>`;
    fillGroupUi(panel);
    panel.querySelector('.rsq-group-select').addEventListener('change', () => {
      lastGroup = selectedName(panel); void persist(); fillGroupUi(panel, lastGroup); applyFilter(root);
    });
    panel.addEventListener('click', async (event) => {
      const button = event.target.closest('button[data-action]');
      if (!button) return;
      event.preventDefault(); event.stopPropagation();
      const boxes = checkboxes(root.querySelector('.rsq-watcher-users'));
      const action = button.dataset.action;
      if (action === 'apply') {
        const name = selectedName(panel);
        const byId = new Map(boxes.map((box) => [memberOf(box).id, box]));
        const missing = [];
        for (const member of groups[name] || []) {
          const box = byId.get(String(member.id));
          if (box) { box.checked = true; box.dispatchEvent(new Event('change', { bubbles: true })); }
          else missing.push(member.name || member.id);
        }
        setPanelStatus(panel, missing.length ? `Не найдены: ${missing.join(', ')}` : `Группа «${name}» отмечена.`, missing.length > 0);
      }
      if (action === 'save') {
        const chosen = boxes.filter((box) => box.checked).map(memberOf).filter((member) => member.id);
        if (!chosen.length) { setPanelStatus(panel, 'Сначала отметьте пользователей.', true); return; }
        const raw = prompt('Название группы:', selectedName(panel));
        if (raw === null) return;
        const name = raw.trim();
        if (!name) { setPanelStatus(panel, 'Название не может быть пустым.', true); return; }
        if (groups[name] && !confirm(`Заменить группу «${name}»?`)) return;
        groups[name] = chosen; lastGroup = name; await persist(); fillGroupUi(panel, name);
        setPanelStatus(panel, `Сохранено: ${chosen.length} чел.`);
      }
      if (action === 'delete') {
        const name = selectedName(panel);
        if (!name || !confirm(`Удалить группу «${name}»?`)) return;
        delete groups[name]; lastGroup = ''; await persist(); fillGroupUi(panel);
        setPanelStatus(panel, `Группа «${name}» удалена.`);
      }
      applyFilter(root);
    });
    return panel;
  }

  function mountDialog() {
    for (const host of document.querySelectorAll('#users_for_watcher')) {
      if (host.dataset.rsqMounted === '1' || !checkboxes(host).length) continue;
      host.dataset.rsqMounted = '1';
      host.classList.add('rsq-watcher-host');
      const root = document.createElement('div'); root.className = 'rsq-watcher-root'; root.dataset.filter = 'all';
      const layout = document.createElement('div'); layout.className = 'rsq-watcher-layout';
      const left = document.createElement('div');
      const filter = document.createElement('div'); filter.className = 'rsq-watcher-filter';
      filter.innerHTML = '<button type="button" data-filter="all">Все</button><button type="button" data-filter="checked">Отмеченные</button><button type="button" data-filter="group">Группа</button><span class="count"></span>';
      const users = document.createElement('div'); users.className = 'rsq-watcher-users';
      while (host.firstChild) users.appendChild(host.firstChild);
      left.append(filter, users); layout.append(left); root.append(layout); host.append(root);
      layout.append(createPanel(root));
      filter.addEventListener('click', (event) => {
        const button = event.target.closest('button[data-filter]'); if (!button) return;
        root.dataset.filter = button.dataset.filter; applyFilter(root);
      });
      users.addEventListener('change', () => applyFilter(root));
      const dialog = host.closest('.ui-dialog') || host.closest('#ajax-modal')?.closest('.ui-dialog');
      if (dialog) dialog.classList.add('rsq-dialog-wide');
      applyFilter(root);
    }
  }

  async function addWatcherGroup(issueId, members, status) {
    const settings = await qol.getSettings();
    let added = 0; const failed = [];
    for (const member of members) {
      status.textContent = `Добавляю ${added + failed.length + 1} из ${members.length}…`;
      const response = await fetch(`${qol.normalizeBaseUrl(settings.baseUrl)}/issues/${issueId}/watchers.json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Redmine-API-Key': settings.apiKey },
        body: JSON.stringify({ user_id: Number(member.id) }),
      });
      if (response.ok || response.status === 422) added += 1; else failed.push(member.name || member.id);
    }
    return { added, failed };
  }

  function mountIssueQuickAdd() {
    const issueId = location.pathname.match(/\/issues\/(\d+)(?:$|[/?#])/)?.[1];
    const box = document.querySelector('#watchers');
    if (!issueId || !box || box.querySelector('.rsq-issue-groups') || !box.querySelector('.contextual a')) return;
    const names = Object.keys(groups).sort((a, b) => a.localeCompare(b, 'ru'));
    if (!names.length) return;
    const row = document.createElement('div'); row.className = 'rsq-issue-groups';
    const select = document.createElement('select'); select.setAttribute('aria-label', 'Группа наблюдателей');
    for (const name of names) { const option = document.createElement('option'); option.value = name; option.textContent = `${name} (${groups[name].length})`; select.appendChild(option); }
    const button = document.createElement('button'); button.type = 'button'; button.textContent = 'Добавить группу';
    const status = document.createElement('div'); status.className = 'rsq-issue-group-status'; status.setAttribute('aria-live', 'polite');
    button.addEventListener('click', async () => {
      const members = groups[select.value] || []; if (!members.length) return;
      button.disabled = true; status.classList.remove('error');
      try {
        const result = await addWatcherGroup(issueId, members, status);
        if (result.failed.length) { status.textContent = `Добавлено ${result.added}. Не удалось: ${result.failed.join(', ')}.`; status.classList.add('error'); button.disabled = false; }
        else { status.textContent = `Добавлено ${result.added}. Обновляю страницу…`; location.reload(); }
      } catch (error) { status.textContent = error instanceof Error ? error.message : 'Не удалось добавить наблюдателей.'; status.classList.add('error'); button.disabled = false; }
    });
    row.append(select, button, status); box.appendChild(row);
  }

  function run() { scheduled = false; mountDialog(); mountIssueQuickAdd(); }
  function schedule() { if (!scheduled) { scheduled = true; queueMicrotask(run); } }

  chrome.storage.local.get([GROUPS_KEY, LAST_KEY]).then((data) => {
    groups = data[GROUPS_KEY] || {}; lastGroup = data[LAST_KEY] || '';
    ensureStyles(); run();
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes[GROUPS_KEY]) groups = changes[GROUPS_KEY].newValue || {};
    if (changes[LAST_KEY]) lastGroup = changes[LAST_KEY].newValue || '';
    if (changes[GROUPS_KEY] || changes[LAST_KEY]) {
      for (const panel of document.querySelectorAll('.rsq-watcher-panel')) fillGroupUi(panel, selectedName(panel));
      document.querySelectorAll('.rsq-issue-groups').forEach((node) => node.remove());
      schedule();
    }
  });
})();
