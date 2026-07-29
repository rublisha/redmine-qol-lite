(() => {
  'use strict';

  const FILTER_KEY = 'journalFilter';
  const STYLE_ID = 'rsq-history-style';

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style'); style.id = STYLE_ID;
    style.textContent = `
      .rsq-journal-filter { display:flex; align-items:center; gap:6px; margin:0 0 10px; color:#647484; font-size:11px; }
      .rsq-journal-filter .label { margin-right:2px; }
      .rsq-journal-filter button { min-height:25px; padding:2px 9px; border:1px solid #c8d2dc; border-radius:3px; background:#f7f9fb; color:#4b6074; cursor:pointer; font-size:11px; }
      .rsq-journal-filter button:hover { border-color:#829fbb; background:#fff; }
      .rsq-journal-filter button.active { border-color:#4f86b8; background:#dfeefa; color:#315d84; font-weight:bold; }
      .rsq-journal-filter .count { color:#8493a2; font-size:10px; }
    `;
    document.head.appendChild(style);
  }
  function hasComment(journal) {
    return journal.classList.contains('has-notes') || Boolean(journal.querySelector('.wiki'));
  }
  function setup() {
    const history = document.querySelector('#history');
    if (!history || history.querySelector('.rsq-journal-filter')) return;
    // Новые Redmine уже имеют собственные вкладки истории.
    if (history.querySelector('.tabs, #history-tabs, .tab-content')) return;
    const journals = [...history.querySelectorAll('div.journal')];
    const commentCount = journals.filter(hasComment).length;
    if (journals.length < 3 || commentCount === 0 || commentCount === journals.length) return;

    const bar = document.createElement('div'); bar.className = 'rsq-journal-filter';
    const label = document.createElement('span'); label.className = 'label'; label.textContent = 'Показывать:';
    const all = document.createElement('button'); all.type = 'button'; all.dataset.mode = 'all';
    all.append(document.createTextNode('Всю историю '));
    const allCount = document.createElement('span'); allCount.className = 'count'; allCount.textContent = journals.length; all.appendChild(allCount);
    const notes = document.createElement('button'); notes.type = 'button'; notes.dataset.mode = 'notes';
    notes.append(document.createTextNode('Только комментарии '));
    const notesCount = document.createElement('span'); notesCount.className = 'count'; notesCount.textContent = commentCount; notes.appendChild(notesCount);
    bar.append(label, all, notes);

    const setMode = (mode) => {
      for (const journal of journals) journal.style.display = mode === 'notes' && !hasComment(journal) ? 'none' : '';
      for (const button of bar.querySelectorAll('button')) button.classList.toggle('active', button.dataset.mode === mode);
    };
    bar.addEventListener('click', (event) => {
      const target = event.target.closest('button[data-mode]'); if (!target) return;
      event.preventDefault(); setMode(target.dataset.mode); void chrome.storage.local.set({ [FILTER_KEY]: target.dataset.mode });
    });
    history.insertBefore(bar, history.firstChild);
    chrome.storage.local.get(FILTER_KEY).then((data) => setMode(data[FILTER_KEY] === 'notes' ? 'notes' : 'all'));
  }

  ensureStyles(); setup();
  new MutationObserver(setup).observe(document.body, { childList: true, subtree: true });
})();
