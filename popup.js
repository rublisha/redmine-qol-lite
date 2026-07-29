(() => {
  'use strict';

  const form = document.getElementById('settings-form');
  const baseUrl = document.getElementById('base-url');
  const apiKey = document.getElementById('api-key');
  const pollMinutes = document.getElementById('poll-minutes');
  const save = document.getElementById('save');
  const status = document.getElementById('status');
  let previousBaseUrl = '';

  function normalized(value) { return String(value || '').trim().replace(/\/+$/, ''); }
  function pattern(value) {
    const url = new URL(normalized(value));
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Разрешены только http:// и https:// адреса.');
    return `${url.origin}/*`;
  }
  function setStatus(text, tone = '') {
    status.textContent = text;
    status.className = tone;
  }

  chrome.storage.local.get('settings').then(({ settings }) => {
    previousBaseUrl = settings?.baseUrl || '';
    baseUrl.value = previousBaseUrl;
    apiKey.value = settings?.apiKey || '';
    pollMinutes.value = String(settings?.pollMinutes ?? 15);
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    save.disabled = true;
    setStatus('Запрашиваю доступ к Redmine…');
    try {
      const next = {
        baseUrl: normalized(baseUrl.value),
        apiKey: apiKey.value.trim(),
        pollMinutes: Number(pollMinutes.value) || 0,
      };
      const originPattern = pattern(next.baseUrl);
      let granted = await chrome.permissions.contains({ origins: [originPattern] });
      if (!granted) {
        setStatus('Подтвердите доступ к указанному адресу…');
        granted = await chrome.permissions.request({ origins: [originPattern] });
      }
      if (!granted) throw new Error('Доступ к адресу Redmine не выдан.');

      setStatus('Проверяю адрес и API key…');
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      let response;
      try {
        response = await fetch(`${next.baseUrl}/users/current.json`, {
          headers: { 'X-Redmine-API-Key': next.apiKey },
          signal: controller.signal,
        });
      } catch (error) {
        if (error?.name === 'AbortError') throw new Error('Redmine не ответил за 15 секунд. Проверьте VPN и адрес.');
        throw error;
      } finally {
        clearTimeout(timeout);
      }
      if (!response.ok) throw new Error(`Redmine отклонил подключение (${response.status}).`);

      setStatus('Сохраняю настройки…');
      const serverChanged = previousBaseUrl && normalized(previousBaseUrl) !== next.baseUrl;
      if (serverChanged) await chrome.storage.local.remove('eventFeed');
      await chrome.storage.local.set({ settings: next });
      if (previousBaseUrl && pattern(previousBaseUrl) !== originPattern) {
        await chrome.permissions.remove({ origins: [pattern(previousBaseUrl)] });
      }
      previousBaseUrl = next.baseUrl;
      // Первичная лента может загружать журналы десятков задач. Она строится в фоне
      // и не должна удерживать popup в состоянии «Сохраняю».
      void chrome.runtime.sendMessage({ type: 'settings.saved' }).catch(() => {});
      setStatus('Готово. События загружаются в фоне; обновите страницу Redmine.', 'ok');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Не удалось сохранить настройки.', 'error');
    } finally {
      save.disabled = false;
    }
  });
})();
