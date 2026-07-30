(() => {
  'use strict';

  if (document.documentElement.dataset.rsqScreenshotMode === '1') return;
  document.documentElement.dataset.rsqScreenshotMode = '1';

  const subjects = [
    'Подготовить демонстрационный макет',
    'Проверить интеграцию с уведомлениями',
    'Обновить документацию проекта',
    'Согласовать план следующего релиза',
    'Исправить отображение списка задач',
  ];
  const people = ['Анна Тестова', 'Иван Демо', 'Мария Примерова', 'Алексей Тестов'];
  const projects = ['Демонстрационный проект', 'Тестовый портал'];
  const descriptions = [
    'Демонстрационное описание задачи. Здесь показан пример работы расширения без реальных данных.',
    'Тестовый комментарий для иллюстрации ленты изменений и превью задачи.',
  ];

  function visible(element) {
    return element instanceof HTMLElement && element.getClientRects().length > 0;
  }

  function replaceText(element, value) {
    if (!visible(element)) return;
    element.textContent = value;
  }

  function replaceAll(selector, values) {
    [...document.querySelectorAll(selector)].filter(visible).forEach((element, index) => {
      replaceText(element, values[index % values.length]);
    });
  }

  replaceAll('td.subject a, a.issue.subject, .rsq-event-subject, .rsq-preview-subject', subjects);
  replaceAll('td.assigned_to, td.author, .author .user, .user.active, .rsq-event-action strong, .rsq-preview-meta span:not(.rsq-preview-label), .rsq-watcher-members li, #users_for_watcher label', people);
  replaceAll('td.project, .rsq-event-tags', projects);
  replaceAll('.rsq-preview-excerpt-text, .rsq-event-comment, .description .wiki, .issue .description, div.journal .wiki', descriptions);
  [...document.querySelectorAll('.rsq-favorite-link')].filter(visible).forEach((element, index) => {
    element.textContent = `#${1001 + index} ${subjects[index % subjects.length]}`;
  });

  const issueLinks = [...document.querySelectorAll('a[href*="/issues/"]')].filter(visible);
  const issueIds = new Map();
  issueLinks.forEach((link, index) => {
    const original = link.getAttribute('href') || '';
    const originalId = original.match(/\/issues\/(\d+)/)?.[1];
    if (originalId && !issueIds.has(originalId)) issueIds.set(originalId, String(1001 + issueIds.size));
    const demoId = issueIds.get(originalId) || String(1001 + index);
    for (const node of [...link.childNodes]) {
      if (node.nodeType === Node.TEXT_NODE) node.nodeValue = node.nodeValue.replace(/#?\d{2,}/g, `#${demoId}`);
    }
    link.href = '#';
    link.removeAttribute('title');
  });

  for (const element of document.querySelectorAll('.rsq-favorite-link, .rsq-event-id, td.id a, #content > h2')) {
    for (const node of [...element.childNodes]) {
      if (node.nodeType === Node.TEXT_NODE) node.nodeValue = node.nodeValue.replace(/#?\d{2,}/g, '#1001');
    }
  }

  const issueHeading = document.querySelector('.subject h3');
  if (issueHeading) replaceText(issueHeading, subjects[0]);

  const account = document.querySelector('#account, #loggedas');
  if (account) account.textContent = 'Демо-пользователь';

  const projectHeading = document.querySelector('#header h1, #header h1 a');
  if (projectHeading) projectHeading.textContent = projects[0];

  for (const input of document.querySelectorAll('input:not([type="checkbox"]):not([type="radio"]), textarea')) {
    if (!visible(input)) continue;
    input.value = input.type === 'password' ? '' : 'Демонстрационные данные';
    input.placeholder = '';
  }

  for (const element of document.querySelectorAll('[title]')) {
    const title = element.getAttribute('title') || '';
    if (/https?:\/\/|\/issues\/|\b\d{3,}\b/i.test(title)) element.removeAttribute('title');
  }

  const style = document.createElement('style');
  style.id = 'rsq-screenshot-mode-style';
  style.textContent = `
    #footer, #quick-search, .flash.notice, .flash.warning, .flash.error { display:none!important; }
  `;
  document.head.appendChild(style);

  console.info('[Redmine QOL Lite] Screenshot mode enabled. Reload the page to restore original content.');
})();
