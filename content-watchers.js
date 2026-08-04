(() => {
  'use strict';

  const qol = globalThis.RedmineSmallQol;
  if (!qol || qol.watchersActive) return;
  qol.watchersActive = true;
  const GROUPS_KEY = 'watcherGroups';
  const LAST_KEY = 'watcherGroupsLast';
  const GROUPS_FILE_FORMAT = 'redmine-qol-watcher-groups';
  const GROUPS_FILE_VERSION = 1;
  const STYLE_ID = 'rsq-watchers-style';
  let groups = {};
  let lastGroup = '';
  let scheduled = false;
  const dialogStates = new Map();

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
      .rsq-watcher-filter button.clear { min-height:auto; padding:3px 2px; border-color:transparent; background:transparent; color:#8a5555; text-decoration:underline; text-underline-offset:2px; }
      .rsq-watcher-filter button.clear:hover { color:#a33e2f; }
      .rsq-watcher-filter .count { margin-left:auto; color:#6c7b87; }
      .rsq-watcher-panel { box-sizing:border-box; display:grid; align-self:start; align-content:start; gap:8px; max-height:100%; overflow:auto; padding:11px; border:1px solid #c2cfdb; border-radius:5px; background:#f7f9fb; color:#33485c; box-shadow:0 1px 2px rgba(40,65,85,.08); }
      .rsq-watcher-panel h3 { margin:0 0 1px; color:#33485c; font-size:14px; }
      .rsq-group-list { display:grid; gap:4px; max-height:205px; overflow:auto; padding-right:2px; }
      .rsq-watcher-panel .rsq-group-option { display:flex; align-items:center; justify-content:space-between; gap:8px; width:100%; min-height:30px; padding:4px 8px; border-color:#c8d3dc; border-radius:4px; background:#fff; text-align:left; }
      .rsq-watcher-panel .rsq-group-option:hover { border-color:#829fbb; background:#f8fbfe; }
      .rsq-watcher-panel .rsq-group-option:focus { outline:none; }
      .rsq-watcher-panel .rsq-group-option:focus-visible { outline:2px solid #8ab5d8; outline-offset:1px; }
      .rsq-watcher-panel .rsq-group-option.active { border-color:#9bb7cd; background:#edf5fb; color:#315d84; font-weight:600; box-shadow:none; }
      .rsq-group-option .group-count { flex:none; min-width:18px; padding:0; background:transparent; color:#82909c; font-size:10px; font-variant-numeric:tabular-nums; line-height:16px; text-align:right; }
      .rsq-group-option.active .group-count { background:transparent; color:#60798d; font-weight:normal; }
      .rsq-group-empty { padding:8px; border:1px solid #d5dee7; background:#fff; color:#738291; font-size:11px; text-align:center; }
      .rsq-watcher-members { max-height:130px; overflow:auto; margin:0; padding:7px 7px 7px 24px; border:1px solid #d5dee7; border-radius:3px; background:#fff; font-size:11px; line-height:1.4; }
      .rsq-watcher-actions { display:grid; grid-template-columns:1fr 1fr; gap:5px; }
      .rsq-watcher-actions .primary { grid-column:1/-1; border-color:#3f78aa; background:#4f86b8; color:#fff; }
      .rsq-watcher-actions .danger { grid-column:1/-1; min-height:25px; border-color:transparent; background:transparent; color:#8a5555; font-weight:normal; }
      .rsq-watcher-actions .danger:hover { background:#fff2ef; color:#a33e2f; }
      .rsq-watcher-actions .cancel { grid-column:1/-1; background:#fff; }
      .rsq-watcher-panel.editing .rsq-watcher-actions [data-action="save"] { grid-column:1/-1; }
      .rsq-watcher-actions button[hidden] { display:none; }
      .rsq-watcher-status { color:#536577; font-size:11px; }
      .rsq-watcher-status:empty { display:none; }
      .rsq-watcher-status.error { color:#a33e2f; }
      .rsq-group-transfer { padding-top:7px; border-top:1px solid #d5dee7; color:#687783; font-size:11px; }
      .rsq-group-transfer summary { cursor:pointer; user-select:none; }
      .rsq-group-transfer[open] summary { margin-bottom:7px; color:#50606d; }
      .rsq-group-transfer-body { padding-left:14px; }
      .rsq-group-transfer-body p { margin:0 0 7px; }
      .rsq-group-transfer-actions { display:flex; gap:6px; }
      .rsq-watcher-panel .rsq-group-transfer-actions button { min-height:25px; padding:2px 7px; background:#fff; font-size:11px; }
      .rsq-group-transfer input[type=file] { display:none; }
      .rsq-group-transfer-status { margin-top:6px; color:#536577; }
      .rsq-group-transfer-status:empty { display:none; }
      .rsq-group-transfer-status.error { color:#a33e2f; }
      .rsq-group-transfer-status.ok { color:#1c6b41; }
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
  function dialogScope(host) { return host.closest('#ajax-modal') || host.closest('.ui-dialog') || host; }
  function stateFor(host) {
    const scope = dialogScope(host);
    let state = dialogStates.get(scope);
    if (!state || state.host !== host) {
      const selected = new Map();
      for (const box of checkboxes(host)) {
        if (!box.checked) continue;
        const member = memberOf(box);
        if (member.id) selected.set(member.id, member);
      }
      state = { host, selected, filter: 'all' };
      dialogStates.set(scope, state);
    }
    return state;
  }
  function rememberSelection(host, box) {
    const member = memberOf(box);
    if (!member.id) return;
    const selected = stateFor(host).selected;
    if (box.checked) selected.set(member.id, member);
    else selected.delete(member.id);
  }
  function restoreSelection(host, state) {
    for (const box of checkboxes(host)) {
      const member = memberOf(box);
      box.checked = state.selected.has(member.id);
      if (box.checked) state.selected.set(member.id, member);
    }
  }
  function pruneDialogStates() {
    for (const scope of dialogStates.keys()) {
      const hasHost = scope.id === 'users_for_watcher' || Boolean(scope.querySelector?.('#users_for_watcher'));
      if (!scope.isConnected || !hasHost) dialogStates.delete(scope);
    }
  }
  async function persist() { await chrome.storage.local.set({ [GROUPS_KEY]: groups, [LAST_KEY]: lastGroup }); }
  function selectedName(panel) { return panel.dataset.selectedGroup || ''; }
  function editingName(panel) { return panel.dataset.editingGroup || ''; }

  function setEditingMode(panel, name = '') {
    panel.dataset.editingGroup = name;
    panel.classList.toggle('editing', Boolean(name));
    const edit = panel.querySelector('[data-action="edit"]');
    const save = panel.querySelector('[data-action="save"]');
    const cancel = panel.querySelector('[data-action="cancel-edit"]');
    edit.hidden = Boolean(name);
    save.textContent = name ? 'Сохранить изменения…' : 'Новая группа…';
    cancel.hidden = !name;
  }

  function fillGroupUi(panel, preferred = '') {
    const list = panel.querySelector('.rsq-group-list');
    const members = panel.querySelector('.rsq-watcher-members');
    if (!list || !members) return;
    const names = Object.keys(groups).sort((a, b) => a.localeCompare(b, 'ru'));
    const selected = groups[preferred] ? preferred : (groups[lastGroup] ? lastGroup : names[0] || '');
    panel.dataset.selectedGroup = selected;
    list.replaceChildren();
    for (const name of names) {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'rsq-group-option'; button.dataset.groupName = name;
      button.classList.toggle('active', name === selected); button.setAttribute('aria-selected', String(name === selected));
      const title = document.createElement('span'); title.textContent = name;
      const count = document.createElement('span'); count.className = 'group-count'; count.textContent = groups[name].length;
      button.append(title, count); list.appendChild(button);
    }
    if (!names.length) {
      const empty = document.createElement('div'); empty.className = 'rsq-group-empty'; empty.textContent = 'Групп пока нет'; list.appendChild(empty);
    }
    members.replaceChildren();
    for (const member of groups[selected] || []) {
      const item = document.createElement('li'); item.textContent = member.name || `Пользователь ${member.id}`; members.appendChild(item);
    }
    if (!members.children.length) { const item = document.createElement('li'); item.textContent = 'Состав группы пуст'; members.appendChild(item); }
    panel.querySelector('[data-action="apply"]').disabled = !selected;
    panel.querySelector('[data-action="edit"]').disabled = !selected;
    panel.querySelector('[data-action="delete"]').disabled = !selected;
  }

  function applyFilter(root) {
    const mode = root.dataset.filter || 'all';
    const panel = root.querySelector('.rsq-watcher-panel');
    const selected = selectedName(panel);
    const groupIds = new Set((groups[selected] || []).map((member) => String(member.id)));
    const boxes = checkboxes(root.querySelector('.rsq-watcher-users'));
    for (const box of boxes) {
      const row = box.closest('label,li,tr,p') || box.parentElement;
      const show = mode === 'all' || (mode === 'checked' && box.checked) || (mode === 'group' && groupIds.has(memberOf(box).id));
      if (row) row.style.display = show ? '' : 'none';
    }
    for (const button of root.querySelectorAll('[data-filter]')) button.classList.toggle('active', button.dataset.filter === mode);
    root.querySelector('.rsq-watcher-filter .count').textContent = `Выбрано: ${boxes.filter((box) => box.checked).length}`;
  }

  function setPanelStatus(panel, text, error = false) {
    const node = panel.querySelector('.rsq-watcher-status');
    node.textContent = text; node.classList.toggle('error', error);
  }

  function setTransferStatus(panel, text, tone = '') {
    const node = panel.querySelector('.rsq-group-transfer-status');
    node.textContent = text; node.className = `rsq-group-transfer-status${tone ? ` ${tone}` : ''}`;
  }

  function normalizedGroups(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('В файле нет корректного списка групп.');
    }
    const result = {};
    for (const [rawName, rawMembers] of Object.entries(value)) {
      const name = rawName.trim();
      if (!name || !Array.isArray(rawMembers)) throw new Error('Одна из групп имеет неверный формат.');
      const members = new Map();
      for (const rawMember of rawMembers) {
        if (!rawMember || typeof rawMember !== 'object' || Array.isArray(rawMember)) {
          throw new Error(`В группе «${name}» есть некорректный участник.`);
        }
        const id = String(rawMember.id ?? '').trim();
        if (!id) throw new Error(`В группе «${name}» есть участник без ID.`);
        members.set(id, {
          id,
          name: String(rawMember.name ?? '').trim().replace(/\s+/g, ' '),
        });
      }
      Object.defineProperty(result, name, {
        value: [...members.values()], enumerable: true, configurable: true, writable: true,
      });
    }
    return result;
  }

  function mergedGroups(current, imported) {
    const result = {};
    for (const [name, members] of [...Object.entries(current), ...Object.entries(imported)]) {
      Object.defineProperty(result, name, { value: members, enumerable: true, configurable: true, writable: true });
    }
    return result;
  }

  function groupWord(count) {
    const mod100 = count % 100;
    const mod10 = count % 10;
    if (mod100 >= 11 && mod100 <= 14) return 'групп';
    if (mod10 === 1) return 'группа';
    if (mod10 >= 2 && mod10 <= 4) return 'группы';
    return 'групп';
  }

  function downloadGroups(panel) {
    const exported = normalizedGroups(groups);
    const count = Object.keys(exported).length;
    if (!count) {
      setTransferStatus(panel, 'Групп для экспорта пока нет.');
      return;
    }
    const contents = JSON.stringify({
      format: GROUPS_FILE_FORMAT,
      version: GROUPS_FILE_VERSION,
      exportedAt: new Date().toISOString(),
      groups: exported,
    }, null, 2);
    const blobUrl = URL.createObjectURL(new Blob([contents], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = `redmine-qol-groups-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
    setTransferStatus(panel, `Экспортировано: ${count} ${groupWord(count)}.`, 'ok');
  }

  async function importGroupsFromFile(panel, root, file) {
    if (file.size > 1024 * 1024) throw new Error('Файл слишком большой для списка групп.');
    const payload = JSON.parse(await file.text());
    if (payload?.format !== GROUPS_FILE_FORMAT || payload?.version !== GROUPS_FILE_VERSION) {
      throw new Error('Это не файл групп Redmine QOL Lite или его версия не поддерживается.');
    }
    const imported = normalizedGroups(payload.groups);
    const importedNames = Object.keys(imported);
    if (!importedNames.length) throw new Error('В выбранном файле нет групп.');

    const current = normalizedGroups(groups);
    const conflicts = importedNames.filter((name) => Object.prototype.hasOwnProperty.call(current, name));
    if (conflicts.length) {
      const shown = conflicts.slice(0, 3).map((name) => `«${name}»`).join(', ');
      const more = conflicts.length > 3 ? ` и ещё ${conflicts.length - 3}` : '';
      if (!confirm(`Уже существуют: ${shown}${more}. Заменить их данными из файла?`)) {
        setTransferStatus(panel, 'Импорт отменён.');
        return;
      }
    }

    groups = mergedGroups(current, imported);
    await persist();
    fillGroupUi(panel, lastGroup);
    applyFilter(root);
    setTransferStatus(panel, `Импортировано: ${importedNames.length} ${groupWord(importedNames.length)}.`, 'ok');
  }

  function createPanel(root, state) {
    const panel = document.createElement('section');
    panel.className = 'rsq-watcher-panel';
    panel.innerHTML = `
      <h3>Группы наблюдателей</h3>
      <div class="rsq-group-list" role="listbox" aria-label="Группы наблюдателей"></div>
      <ol class="rsq-watcher-members"></ol>
      <div class="rsq-watcher-actions">
        <button type="button" class="primary" data-action="apply">Отметить всю группу</button>
        <button type="button" data-action="edit">Изменить…</button>
        <button type="button" data-action="save">Новая группа…</button>
        <button type="button" class="cancel" data-action="cancel-edit" hidden>Отменить редактирование</button>
        <button type="button" class="danger" data-action="delete">Удалить выбранную группу</button>
      </div>
      <div class="rsq-watcher-status" aria-live="polite"></div>
      <details class="rsq-group-transfer">
        <summary>Импорт и экспорт</summary>
        <div class="rsq-group-transfer-body">
          <p>Только названия групп и их участники.</p>
          <div class="rsq-group-transfer-actions">
            <button type="button" data-action="export">Экспорт</button>
            <button type="button" data-action="import">Импорт</button>
            <input type="file" accept=".json,application/json" data-import-file>
          </div>
          <div class="rsq-group-transfer-status" aria-live="polite"></div>
        </div>
      </details>`;
    fillGroupUi(panel);
    const importFile = panel.querySelector('[data-import-file]');
    importFile.addEventListener('change', async () => {
      const [file] = importFile.files || [];
      if (!file) return;
      setTransferStatus(panel, '');
      try {
        await importGroupsFromFile(panel, root, file);
      } catch (error) {
        const message = error instanceof SyntaxError
          ? 'Не удалось прочитать JSON-файл.'
          : (error instanceof Error ? error.message : 'Не удалось импортировать группы.');
        setTransferStatus(panel, message, 'error');
      } finally {
        importFile.value = '';
      }
    });
    panel.addEventListener('click', async (event) => {
      const groupButton = event.target.closest('button[data-group-name]');
      if (groupButton) {
        event.preventDefault(); event.stopPropagation();
        lastGroup = groupButton.dataset.groupName;
        setEditingMode(panel); await persist(); fillGroupUi(panel, lastGroup); applyFilter(root);
        return;
      }
      const button = event.target.closest('button[data-action]');
      if (!button) return;
      event.preventDefault(); event.stopPropagation();
      const boxes = checkboxes(root.querySelector('.rsq-watcher-users'));
      const action = button.dataset.action;
      if (action === 'export') {
        setTransferStatus(panel, '');
        try { downloadGroups(panel); }
        catch (error) { setTransferStatus(panel, error instanceof Error ? error.message : 'Не удалось экспортировать группы.', 'error'); }
        return;
      }
      if (action === 'import') {
        setTransferStatus(panel, '');
        importFile.click();
        return;
      }
      if (action === 'edit') {
        const name = selectedName(panel);
        if (!name) return;
        state.selected.clear();
        for (const member of groups[name] || []) {
          const id = String(member.id);
          state.selected.set(id, { id, name: member.name || '' });
        }
        restoreSelection(root.querySelector('.rsq-watcher-users'), state);
        setEditingMode(panel, name);
        root.dataset.filter = 'all'; state.filter = 'all';
        setPanelStatus(panel, `Редактирование группы «${name}»: измените отметки и сохраните.`);
      }
      if (action === 'apply') {
        const name = selectedName(panel);
        const byId = new Map(boxes.map((box) => [memberOf(box).id, box]));
        const missing = [];
        for (const member of groups[name] || []) {
          const id = String(member.id);
          state.selected.set(id, { id, name: member.name || '' });
          const box = byId.get(id);
          if (box) { box.checked = true; box.dispatchEvent(new Event('change', { bubbles: true })); }
          else missing.push(member.name || member.id);
        }
        setPanelStatus(panel, missing.length ? `Не найдены: ${missing.join(', ')}` : `Группа «${name}» отмечена.`, missing.length > 0);
      }
      if (action === 'save') {
        const chosen = [...state.selected.values()];
        if (!chosen.length) { setPanelStatus(panel, 'Сначала отметьте пользователей.', true); return; }
        const oldName = editingName(panel);
        const raw = prompt(oldName ? 'Название группы:' : 'Название новой группы:', oldName);
        if (raw === null) return;
        const name = raw.trim();
        if (!name) { setPanelStatus(panel, 'Название не может быть пустым.', true); return; }
        if (name !== oldName && groups[name] && !confirm(`Заменить группу «${name}»?`)) return;
        if (oldName && oldName !== name) delete groups[oldName];
        groups[name] = chosen; lastGroup = name; setEditingMode(panel); await persist(); fillGroupUi(panel, name);
        setPanelStatus(panel, oldName ? `Группа «${name}» обновлена: ${chosen.length} чел.` : `Сохранено: ${chosen.length} чел.`);
      }
      if (action === 'cancel-edit') {
        const name = editingName(panel);
        setEditingMode(panel);
        setPanelStatus(panel, name ? `Редактирование группы «${name}» отменено.` : '');
      }
      if (action === 'delete') {
        const name = selectedName(panel);
        if (!name || !confirm(`Удалить группу «${name}»?`)) return;
        delete groups[name]; lastGroup = ''; setEditingMode(panel); await persist(); fillGroupUi(panel);
        setPanelStatus(panel, `Группа «${name}» удалена.`);
      }
      applyFilter(root);
    });
    return panel;
  }

  function mountDialog() {
    for (const host of document.querySelectorAll('#users_for_watcher')) {
      if (host.querySelector('.rsq-watcher-root') || !checkboxes(host).length) continue;
      const state = stateFor(host);
      restoreSelection(host, state);
      host.dataset.rsqMounted = '1';
      host.classList.add('rsq-watcher-host');
      const root = document.createElement('div'); root.className = 'rsq-watcher-root'; root.dataset.filter = state.filter;
      const layout = document.createElement('div'); layout.className = 'rsq-watcher-layout';
      const left = document.createElement('div');
      const filter = document.createElement('div'); filter.className = 'rsq-watcher-filter';
      filter.innerHTML = '<button type="button" data-filter="all">Все</button><button type="button" data-filter="checked">Выбранные</button><button type="button" data-filter="group">Группа</button><span class="count"></span><button type="button" class="clear" data-clear>Очистить</button>';
      const users = document.createElement('div'); users.className = 'rsq-watcher-users';
      while (host.firstChild) users.appendChild(host.firstChild);
      left.append(filter, users); layout.append(left); root.append(layout); host.append(root);
      layout.append(createPanel(root, state));
      filter.addEventListener('click', (event) => {
        const clear = event.target.closest('button[data-clear]');
        if (clear) {
          state.selected.clear();
          for (const box of checkboxes(users)) {
            if (!box.checked) continue;
            box.checked = false;
            box.dispatchEvent(new Event('change', { bubbles: true }));
          }
          applyFilter(root);
          return;
        }
        const button = event.target.closest('button[data-filter]'); if (!button) return;
        state.filter = button.dataset.filter; root.dataset.filter = state.filter; applyFilter(root);
      });
      users.addEventListener('change', (event) => {
        if (event.target.matches('input[type="checkbox"]')) rememberSelection(host, event.target);
        applyFilter(root);
      });
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

  function run() { scheduled = false; pruneDialogStates(); mountDialog(); mountIssueQuickAdd(); }
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
