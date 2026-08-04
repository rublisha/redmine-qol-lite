(() => {
  'use strict';

  const qol = globalThis.RedmineSmallQol;
  if (!qol || qol.favoritesActive) return;
  qol.favoritesActive = true;
  const FAVORITES_KEY = 'favoriteIssues';
  const COLLAPSED_KEY = 'favoriteIssuesCollapsed';
  const STYLE_ID = 'rsq-favorites-style';
  const MAX_FAVORITES = 100;
  let favorites = [];
  let collapsed = false;
  let scheduled = false;

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style'); style.id = STYLE_ID;
    style.textContent = `
      .rsq-favorite-toggle { display:inline-flex; align-items:center; justify-content:center; width:18px; min-width:18px; height:18px; margin:0 2px 0 4px; padding:0; border:0; background:transparent; color:#9aa4ad; cursor:pointer; font:16px/1 Arial,sans-serif; vertical-align:middle; }
      .rsq-favorite-toggle:hover { color:#c58a12; }
      .rsq-favorite-toggle.active { color:#d69b1d; }
      .rsq-favorites { margin:10px 0; }
      .rsq-favorites-head { display:flex; align-items:center; width:100%; margin:0 0 5px; padding:0; border:0; background:transparent; color:#444; cursor:pointer; font:700 13px/1.35 Arial,sans-serif; text-align:left; }
      .rsq-favorites-head:hover { color:#169; }
      .rsq-favorites-chevron { width:14px; color:#7a8995; font-size:10px; }
      .rsq-favorites-count { margin-left:4px; color:#7a8995; font-size:11px; font-weight:400; }
      .rsq-favorites-list { display:grid; gap:2px; max-height:190px; overflow-y:auto; padding-right:3px; }
      .rsq-favorites-list[hidden] { display:none; }
      .rsq-favorite-item { display:grid; grid-template-columns:minmax(0,1fr) 18px; align-items:start; gap:3px; }
      .rsq-favorite-link { display:block; min-width:0; overflow:hidden; color:#169; font-size:11px; line-height:1.35; text-decoration:none; text-overflow:ellipsis; white-space:nowrap; }
      .rsq-favorite-link:hover { color:#c61a1a; text-decoration:underline; }
      .rsq-favorite-remove { width:18px; height:18px; padding:0; border:0; background:transparent; color:#d69b1d; cursor:pointer; font:14px/1 Arial,sans-serif; }
      .rsq-favorites-empty { color:#84919b; font-size:11px; font-style:italic; }
    `;
    document.head.appendChild(style);
  }

  function issueId(href) { return globalThis.RedmineSmallQol.issueIdFromHref(href); }
  function isFavorite(id) { return favorites.some((item) => String(item.id) === String(id)); }
  function cleanIssueUrl(value, id) {
    try {
      const url = new URL(value || `/issues/${id}`, location.href);
      url.hash = ''; url.search = '';
      return url.href;
    } catch { return `${location.origin}/issues/${id}`; }
  }
  async function saveFavorites() { await chrome.storage.local.set({ [FAVORITES_KEY]: favorites }); }

  async function toggleFavorite(issue) {
    const id = String(issue.id);
    if (isFavorite(id)) favorites = favorites.filter((item) => String(item.id) !== id);
    else {
      favorites = [{
        id,
        subject: String(issue.subject || `Задача #${id}`).trim(),
        url: cleanIssueUrl(issue.url, id),
      }, ...favorites].slice(0, MAX_FAVORITES);
    }
    updateStars(); renderSidebar();
    await saveFavorites();
  }

  function starButton(issue) {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'rsq-favorite-toggle'; button.dataset.issueId = String(issue.id);
    button.addEventListener('click', (event) => {
      event.preventDefault(); event.stopPropagation(); void toggleFavorite(issue);
    });
    return button;
  }
  function updateStars() {
    for (const button of document.querySelectorAll('.rsq-favorite-toggle[data-issue-id]')) {
      const active = isFavorite(button.dataset.issueId);
      const symbol = active ? '★' : '☆';
      button.classList.toggle('active', active); if (button.textContent !== symbol) button.textContent = symbol;
      button.title = active ? 'Убрать из избранного' : 'Добавить в избранное';
      button.setAttribute('aria-label', button.title);
      button.setAttribute('aria-pressed', String(active));
    }
  }

  function mountListStars() {
    for (const row of document.querySelectorAll('tr.issue, tr[id^="issue-"]')) {
      if (row.querySelector('.rsq-favorite-toggle')) continue;
      const idLink = row.querySelector('td.id a[href*="/issues/"]');
      const subjectLink = row.querySelector('td.subject a[href*="/issues/"]') || row.querySelector('a.issue[href*="/issues/"]');
      const link = idLink || subjectLink;
      const id = issueId(link?.getAttribute('href')) || row.id.match(/issue-(\d+)/)?.[1];
      if (!id || !link) continue;
      const subject = subjectLink?.textContent?.trim() || link.title?.trim() || `Задача #${id}`;
      link.insertAdjacentElement('afterend', starButton({ id, subject, url: link.href }));
    }
  }

  function mountIssueStar() {
    const id = location.pathname.match(/\/issues\/(\d+)(?:$|[/?#])/)?.[1];
    const heading = document.querySelector('#content > h2');
    if (!id || !heading || heading.querySelector('.rsq-favorite-toggle')) return;
    const subject = document.querySelector('.subject h3')?.textContent?.trim()
      || heading.textContent.replace(new RegExp(`#?${id}`), '').trim()
      || `Задача #${id}`;
    heading.appendChild(starButton({ id, subject, url: location.href }));
  }

  function sidebarInsertPoint(sidebar) {
    const headings = [...sidebar.querySelectorAll('h2,h3,h4')];
    const saved = headings.find((node) => /сохран[её]нн/i.test(node.textContent));
    const tasks = headings.find((node) => node.textContent.trim().toLocaleLowerCase('ru') === 'задачи');
    const anchor = saved || tasks;
    if (!anchor) return { parent: sidebar, before: null };
    let next = anchor.nextElementSibling;
    while (next && !/^H[2-4]$/.test(next.tagName)) next = next.nextElementSibling;
    return { parent: anchor.parentElement, before: next };
  }

  function ensureSidebar() {
    const sidebar = document.querySelector('#sidebar');
    if (!sidebar) return null;
    let section = sidebar.querySelector('.rsq-favorites');
    if (section) return section;
    section = document.createElement('section'); section.className = 'rsq-favorites';
    const head = document.createElement('button'); head.type = 'button'; head.className = 'rsq-favorites-head';
    head.addEventListener('click', async () => {
      collapsed = !collapsed; renderSidebar();
      await chrome.storage.local.set({ [COLLAPSED_KEY]: collapsed });
    });
    const list = document.createElement('div'); list.className = 'rsq-favorites-list';
    section.append(head, list);
    const point = sidebarInsertPoint(sidebar); point.parent.insertBefore(section, point.before);
    return section;
  }

  function renderSidebar() {
    const section = ensureSidebar(); if (!section) return;
    const head = section.querySelector('.rsq-favorites-head');
    const list = section.querySelector('.rsq-favorites-list');
    head.replaceChildren();
    const chevron = document.createElement('span'); chevron.className = 'rsq-favorites-chevron'; chevron.textContent = collapsed ? '▶' : '▼';
    const title = document.createElement('span'); title.textContent = 'Избранные задачи';
    const count = document.createElement('span'); count.className = 'rsq-favorites-count'; count.textContent = `(${favorites.length})`;
    head.append(chevron, title, count); head.setAttribute('aria-expanded', String(!collapsed));
    list.hidden = collapsed; list.replaceChildren();
    if (!favorites.length) {
      const empty = document.createElement('div'); empty.className = 'rsq-favorites-empty'; empty.textContent = 'Нет отмеченных задач'; list.appendChild(empty);
      return;
    }
    for (const issue of favorites) {
      const item = document.createElement('div'); item.className = 'rsq-favorite-item';
      const link = document.createElement('a'); link.className = 'rsq-favorite-link'; link.href = issue.url; link.textContent = `#${issue.id} ${issue.subject}`; link.title = link.textContent;
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'rsq-favorite-remove'; remove.textContent = '★'; remove.title = 'Убрать из избранного';
      remove.addEventListener('click', () => void toggleFavorite(issue));
      item.append(link, remove); list.appendChild(item);
    }
  }

  function run() {
    scheduled = false; mountListStars(); mountIssueStar();
    if (!document.querySelector('.rsq-favorites')) renderSidebar();
    updateStars();
  }
  function schedule() { if (!scheduled) { scheduled = true; queueMicrotask(run); } }

  chrome.storage.local.get([FAVORITES_KEY, COLLAPSED_KEY]).then((data) => {
    favorites = Array.isArray(data[FAVORITES_KEY]) ? data[FAVORITES_KEY] : [];
    collapsed = data[COLLAPSED_KEY] === true;
    ensureStyles(); run();
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes[FAVORITES_KEY]) favorites = Array.isArray(changes[FAVORITES_KEY].newValue) ? changes[FAVORITES_KEY].newValue : [];
    if (changes[COLLAPSED_KEY]) collapsed = changes[COLLAPSED_KEY].newValue === true;
    if (changes[FAVORITES_KEY] || changes[COLLAPSED_KEY]) { updateStars(); renderSidebar(); }
  });
})();
