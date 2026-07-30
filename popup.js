(() => {
  'use strict';

  const form = document.getElementById('settings-form');
  const baseUrl = document.getElementById('base-url');
  const apiKey = document.getElementById('api-key');
  const pollMinutes = document.getElementById('poll-minutes');
  const showBadge = document.getElementById('show-badge');
  const save = document.getElementById('save');
  const status = document.getElementById('status');
  let previousBaseUrl = '';
  let statusRun = 0;

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
  async function checkConnection(settings) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(`${settings.baseUrl}/users/current.json`, {
        headers: { 'X-Redmine-API-Key': settings.apiKey },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Redmine отклонил подключение (${response.status}).`);
    } catch (error) {
      if (error?.name === 'AbortError') throw new Error('Redmine не ответил за 15 секунд. Проверьте VPN и адрес.');
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
  function checkedNow() {
    return new Date().toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
  }

  chrome.storage.local.get('settings').then(async ({ settings }) => {
    previousBaseUrl = settings?.baseUrl || '';
    baseUrl.value = previousBaseUrl;
    apiKey.value = settings?.apiKey || '';
    pollMinutes.value = String(settings?.pollMinutes ?? 15);
    showBadge.checked = settings?.showBadge !== false;
    if (!settings?.baseUrl || !settings?.apiKey) {
      setStatus('Подключение ещё не настроено.', 'checking');
      return;
    }
    const run = ++statusRun;
    try {
      const granted = await chrome.permissions.contains({ origins: [pattern(settings.baseUrl)] });
      if (!granted) {
        if (run === statusRun) setStatus('Настройки сохранены, но доступ к адресу нужно подтвердить повторно.', 'warning');
        return;
      }
      if (run === statusRun) setStatus('Проверяю сохранённое подключение…', 'checking');
      await checkConnection(settings);
      if (run === statusRun) setStatus(`✓ Подключение работает · проверено ${checkedNow()}`, 'ok');
    } catch (error) {
      if (run === statusRun) setStatus(`Настройки сохранены, но проверка не прошла: ${error instanceof Error ? error.message : 'Redmine недоступен.'}`, 'error');
    }
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    statusRun += 1;
    save.disabled = true;
    setStatus('Запрашиваю доступ к Redmine…');
    try {
      const next = {
        baseUrl: normalized(baseUrl.value),
        apiKey: apiKey.value.trim(),
        pollMinutes: Number(pollMinutes.value) || 0,
        showBadge: showBadge.checked,
      };
      const originPattern = pattern(next.baseUrl);
      let granted = await chrome.permissions.contains({ origins: [originPattern] });
      if (!granted) {
        setStatus('Подтвердите доступ к указанному адресу…');
        granted = await chrome.permissions.request({ origins: [originPattern] });
      }
      if (!granted) throw new Error('Доступ к адресу Redmine не выдан.');

      setStatus('Проверяю адрес и API key…');
      await checkConnection(next);

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
      setStatus(`✓ Подключение работает · проверено ${checkedNow()}`, 'ok');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Не удалось сохранить настройки.', 'error');
    } finally {
      save.disabled = false;
    }
  });
})();
