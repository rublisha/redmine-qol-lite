(() => {
  'use strict';
  const root = globalThis.RedmineSmallQol = globalThis.RedmineSmallQol || {};

  root.normalizeBaseUrl = (value) => String(value || '').trim().replace(/\/+$/, '');
  root.getSettings = async () => {
    const { settings } = await chrome.storage.local.get('settings');
    return settings || { baseUrl: '', apiKey: '', pollMinutes: 15 };
  };
  root.fetchJson = async (path, init = {}) => {
    const settings = await root.getSettings();
    if (!settings.baseUrl || !settings.apiKey) throw new Error('Настройте адрес Redmine и API key в расширении.');
    const response = await fetch(`${root.normalizeBaseUrl(settings.baseUrl)}${path}`, {
      ...init,
      headers: { 'X-Redmine-API-Key': settings.apiKey, ...(init.headers || {}) },
    });
    if (!response.ok) throw new Error(`Redmine вернул ${response.status}`);
    return response.status === 204 ? null : response.json();
  };
  root.issueIdFromHref = (href) => String(href || '').match(/\/issues\/(\d+)(?:$|[/?#])/)?.[1] || '';
})();
