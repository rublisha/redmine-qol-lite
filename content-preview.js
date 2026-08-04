(() => {
  'use strict';

  const qol = globalThis.RedmineSmallQol;
  if (!qol || qol.previewActive) return;
  qol.previewActive = true;
  const STYLE_ID = 'rsq-preview-style';
  const SHOW_DELAY = 350;
  const HIDE_DELAY = 180;
  const BELOW_OFFSET = 26;
  const cache = new Map();
  let card = null;
  let activeLink = null;
  let activeId = '';
  let showTimer = 0;
  let hideTimer = 0;

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style'); style.id = STYLE_ID;
    style.textContent = `
      .rsq-preview { position:fixed; z-index:10010; box-sizing:border-box; width:360px; max-width:calc(100vw - 20px); padding:11px 12px; border:1px solid #bdc9d3; border-radius:5px; background:#fff; box-shadow:0 5px 18px rgba(25,45,65,.18); color:#26313d; font:12px/1.42 Arial,sans-serif; }
      .rsq-preview-head { display:flex; flex-wrap:wrap; align-items:center; gap:5px; margin-bottom:6px; }
      .rsq-preview-id { color:#3f6f99; font-size:11px; font-weight:700; }
      .rsq-preview-chip { padding:1px 5px; border:1px solid #d1dae2; border-radius:3px; background:#f3f6f8; color:#4d6173; font-size:10px; }
      .rsq-preview-subject { margin:0 0 7px; color:#202a33; font-weight:700; }
      .rsq-preview-meta { display:grid; grid-template-columns:max-content 1fr; gap:3px 8px; color:#657480; font-size:11px; }
      .rsq-preview-label { color:#84919b; }
      .rsq-preview-excerpt { margin-top:9px; padding-top:7px; border-top:1px solid #e0e6eb; }
      .rsq-preview-excerpt-title { margin-bottom:3px; color:#526675; font-size:10px; font-weight:700; text-transform:uppercase; }
      .rsq-preview-excerpt-text { display:-webkit-box; overflow:hidden; color:#4f5f6b; font-size:11px; white-space:pre-line; -webkit-box-orient:vertical; -webkit-line-clamp:5; line-clamp:5; }
      .rsq-preview-error { color:#a33e2f; }
    `;
    document.head.appendChild(style);
  }

  function ensureCard() {
    if (card) return card;
    card = document.createElement('aside'); card.className = 'rsq-preview'; card.style.display = 'none';
    card.addEventListener('mouseenter', () => clearTimeout(hideTimer));
    card.addEventListener('mouseleave', scheduleHide);
    document.body.appendChild(card);
    return card;
  }
  function place(link) {
    const box = ensureCard();
    if (!link?.isConnected) return hide();
    const rect = link.getBoundingClientRect();
    box.style.visibility = 'hidden'; box.style.display = 'block';
    const height = box.offsetHeight; const width = box.offsetWidth;
    const below = rect.bottom + BELOW_OFFSET;
    const top = below + height > innerHeight - 8 ? Math.max(8, rect.top - height - 7) : below;
    box.style.top = `${top}px`;
    box.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - width - 8))}px`;
    box.style.visibility = 'visible';
  }
  function row(container, label, value) {
    if (value === undefined || value === null || value === '') return;
    const key = document.createElement('span'); key.className = 'rsq-preview-label'; key.textContent = label;
    const text = document.createElement('span'); text.textContent = String(value);
    container.append(key, text);
  }
  function plainExcerpt(value) {
    return String(value || '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/"([^"]+)":\S+/g, '$1')
      .replace(/^\s*[*#-]+\s+/gm, '')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }
  function noteFromIssue(issue, noteNumber) {
    if (!noteNumber) return null;
    const journals = [...(issue.journals || [])].sort((a, b) => String(a.created_on || '').localeCompare(String(b.created_on || '')));
    return journals.find((journal) => String(journal.id) === String(noteNumber)) || journals[Number(noteNumber) - 1] || null;
  }
  function excerptNode(title, value) {
    const text = plainExcerpt(value); if (!text) return null;
    const block = document.createElement('div'); block.className = 'rsq-preview-excerpt';
    const heading = document.createElement('div'); heading.className = 'rsq-preview-excerpt-title'; heading.textContent = title;
    const body = document.createElement('div'); body.className = 'rsq-preview-excerpt-text'; body.textContent = text;
    block.append(heading, body); return block;
  }
  function renderIssue(issue, noteNumber = '') {
    const box = ensureCard(); box.replaceChildren();
    const head = document.createElement('div'); head.className = 'rsq-preview-head';
    const id = document.createElement('span'); id.className = 'rsq-preview-id'; id.textContent = `#${issue.id}`; head.appendChild(id);
    for (const value of [issue.tracker?.name, issue.status?.name, issue.fixed_version?.name]) {
      if (!value) continue;
      const chip = document.createElement('span'); chip.className = 'rsq-preview-chip'; chip.textContent = value; head.appendChild(chip);
    }
    const subject = document.createElement('p'); subject.className = 'rsq-preview-subject'; subject.textContent = issue.subject || '';
    const meta = document.createElement('div'); meta.className = 'rsq-preview-meta';
    row(meta, 'Проект', issue.project?.name);
    row(meta, 'Исполнитель', issue.assigned_to?.name || 'не назначен');
    row(meta, 'Автор', issue.author?.name);
    row(meta, 'Приоритет', issue.priority?.name);
    row(meta, 'Срок', issue.due_date);
    row(meta, 'Готовность', issue.done_ratio !== undefined ? `${issue.done_ratio}%` : '');
    box.append(head, subject, meta);
    if (noteNumber) {
      const journal = noteFromIssue(issue, noteNumber);
      const excerpt = excerptNode(`Комментарий #${noteNumber}`, journal?.notes);
      if (excerpt) box.appendChild(excerpt);
      else {
        const empty = excerptNode(`Комментарий #${noteNumber}`, 'В этой записи нет текста комментария.');
        if (empty) box.appendChild(empty);
      }
    } else {
      const excerpt = excerptNode('Описание', issue.description);
      if (excerpt) box.appendChild(excerpt);
    }
  }
  function renderMessage(text, error = false) {
    const box = ensureCard(); box.replaceChildren();
    const node = document.createElement('div'); if (error) node.className = 'rsq-preview-error'; node.textContent = text; box.appendChild(node);
  }
  function hide() { activeId = ''; activeLink = null; if (card) card.style.display = 'none'; }
  function scheduleHide() { clearTimeout(hideTimer); hideTimer = setTimeout(hide, HIDE_DELAY); }
  function loadIssue(id) {
    if (!cache.has(id)) cache.set(id, qol.fetchJson(`/issues/${id}.json?include=journals`).then((data) => data.issue));
    return cache.get(id);
  }
  async function show(link, id, noteNumber = '') {
    activeLink = link; activeId = id; renderMessage('Загружаю…'); place(link);
    try {
      const issue = await loadIssue(id);
      if (activeId !== id || activeLink !== link) return;
      renderIssue(issue, noteNumber); place(link);
    } catch (error) {
      if (activeId !== id) return;
      cache.delete(id); renderMessage(error instanceof Error ? error.message : 'Не удалось загрузить задачу.', true); place(link);
    }
  }
  function candidate(target) {
    const link = target.closest?.('a[href*="/issues/"]');
    if (!link) return null;
    // Список событий уже содержит всю нужную сводку. Его строки тоже являются
    // ссылками на задачи, но второе hover-окно поверх popover только мешает.
    if (link.closest('.rsq-events-popover')) return null;
    const id = qol.issueIdFromHref(link.getAttribute('href'));
    if (!id) return null;
    // В старых темах Redmine у колонки с названием нет стабильного класса `subject`.
    // Поэтому не отбрасываем ссылки внутри таблицы: это ломало превью у ссылок вида
    // `#15118-3`, хотя href у них корректно указывает на задачу.
    const noteNumber = String(link.hash || link.getAttribute('href') || '').match(/#note-(\d+)/)?.[1] || '';
    return { link, id, noteNumber };
  }

  ensureStyles();
  document.addEventListener('mouseover', (event) => {
    const found = candidate(event.target); if (!found) return;
    if (event.relatedTarget && found.link.contains(event.relatedTarget)) return;
    clearTimeout(showTimer); clearTimeout(hideTimer);
    if (activeLink === found.link && activeId === found.id) return;
    showTimer = setTimeout(() => show(found.link, found.id, found.noteNumber), SHOW_DELAY);
  });
  document.addEventListener('mouseout', (event) => {
    const found = candidate(event.target); if (!found) return;
    if (event.relatedTarget && found.link.contains(event.relatedTarget)) return;
    clearTimeout(showTimer); scheduleHide();
  });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') hide(); });
  addEventListener('scroll', hide, { passive: true });
  addEventListener('resize', hide, { passive: true });
})();
