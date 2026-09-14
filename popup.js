(() => {
  'use strict';

  const DRAFT_KEY = 'settingsDraft';
  const MAX_FILTERS = 6;
  const form = document.getElementById('settings-form');
  const baseUrl = document.getElementById('base-url');
  const apiKey = document.getElementById('api-key');
  const pollMinutes = document.getElementById('poll-minutes');
  const eventButtonPlacement = document.getElementById('event-button-placement');
  const showBadge = document.getElementById('show-badge');
  const eventSound = document.getElementById('event-sound');
  const filtersList = document.getElementById('filters-list');
  const addFilter = document.getElementById('add-filter');
  const save = document.getElementById('save');
  const status = document.getElementById('status');
  let previousBaseUrl = '';
  let statusRun = 0;
  let filterRows = [];

  function readFilters(settings) {
    return (Array.isArray(settings?.eventFilters) ? settings.eventFilters : [])
      .map((filter) => ({
        id: String(filter?.id || ''),
        label: String(filter?.label || ''),
        issueId: String(Number(filter?.issueId) || ''),
      }))
      .filter((filter) => filter.id && filter.issueId)
      .slice(0, MAX_FILTERS);
  }
  function newFilterId() {
    return `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  }
  function renderFilters() {
    filtersList.replaceChildren();
    if (!filterRows.length) {
      const empty = document.createElement('div'); empty.className = 'filters-empty';
      empty.textContent = 'Вкладок нет — окно событий покажет общую ленту.';
      filtersList.appendChild(empty);
    }
    filterRows.forEach((row, index) => {
      const line = document.createElement('div'); line.className = 'filter-row';
      const issueId = document.createElement('input');
      issueId.type = 'text'; issueId.inputMode = 'numeric'; issueId.placeholder = '№'; issueId.value = row.issueId;
      issueId.setAttribute('aria-label', 'Номер задачи');
      issueId.addEventListener('input', () => {
        issueId.value = issueId.value.replace(/\D+/g, '');
        filterRows[index].issueId = issueId.value;
      });
      const label = document.createElement('input');
      label.type = 'text'; label.placeholder = 'Название вкладки'; label.value = row.label; label.maxLength = 40;
      label.setAttribute('aria-label', 'Название вкладки');
      label.addEventListener('input', () => { filterRows[index].label = label.value; });
      const remove = document.createElement('button');
      remove.type = 'button'; remove.className = 'filter-remove'; remove.textContent = '×'; remove.title = 'Удалить вкладку';
      remove.addEventListener('click', () => { filterRows.splice(index, 1); renderFilters(); });
      line.append(issueId, label, remove);
      filtersList.appendChild(line);
    });
    addFilter.disabled = filterRows.length >= MAX_FILTERS;
  }
  function collectFilters() {
    const filled = filterRows.filter((row) => row.issueId.trim() || row.label.trim());
    if (filled.some((row) => !(Number(row.issueId) > 0))) throw new Error('У каждой вкладки должен быть номер задачи.');
    return filled.map((row) => ({
      id: row.id || newFilterId(),
      label: row.label.trim(),
      issueId: Number(row.issueId),
    }));
  }

  addFilter.addEventListener('click', () => {
    if (filterRows.length >= MAX_FILTERS) return;
    filterRows.push({ id: newFilterId(), label: '', issueId: '' });
    renderFilters();
  });

  function normalized(value) { return String(value || '').trim().replace(/\/+$/, ''); }
  function pattern(value) {
    const url = new URL(normalized(value));
    if (url.protocol !== 'https:') throw new Error('Redmine должен быть доступен по защищённому адресу https://.');
    return `${url.origin}/*`;
  }
  function setStatus(text, tone = '') {
    status.textContent = text;
    status.className = tone;
  }
  function contentScriptsError(result) {
    const message = String(result?.error || '');
    if (/cannot access contents of the page|manifest must request permission|missing host permission/i.test(message)) {
      return 'API доступен, но Chrome запретил функции на странице. На вкладке Redmine откройте меню расширения, выберите «Может читать и изменять данные сайта» → «На этом сайте» и обновите страницу.';
    }
    return `API доступен, но функции на странице не запустились: ${message || 'обновите вкладку Redmine.'}`;
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
  function saveInputDraft() {
    void chrome.storage.local.set({
      [DRAFT_KEY]: {
        baseUrl: baseUrl.value,
        apiKey: apiKey.value,
      },
    }).catch(() => {});
  }

  baseUrl.addEventListener('input', saveInputDraft);
  apiKey.addEventListener('input', saveInputDraft);

  chrome.storage.local.get(['settings', DRAFT_KEY]).then(async ({ settings, [DRAFT_KEY]: storedDraft }) => {
    previousBaseUrl = settings?.baseUrl || '';
    const savedApiKey = settings?.apiKey || '';
    const draft = storedDraft && typeof storedDraft === 'object' ? storedDraft : null;
    const hasDraft = Boolean(draft
      && (Object.prototype.hasOwnProperty.call(draft, 'baseUrl')
        || Object.prototype.hasOwnProperty.call(draft, 'apiKey')));
    const draftBaseUrl = hasDraft && Object.prototype.hasOwnProperty.call(draft, 'baseUrl')
      ? String(draft.baseUrl ?? '')
      : previousBaseUrl;
    const draftApiKey = hasDraft && Object.prototype.hasOwnProperty.call(draft, 'apiKey')
      ? String(draft.apiKey ?? '')
      : savedApiKey;
    const draftDiffers = hasDraft && (draftBaseUrl !== previousBaseUrl || draftApiKey !== savedApiKey);
    baseUrl.value = draftBaseUrl;
    apiKey.value = draftApiKey;
    pollMinutes.value = String(settings?.pollMinutes ?? 15);
    eventButtonPlacement.value = ['sidebar', 'floating', 'both'].includes(settings?.eventButtonPlacement)
      ? settings.eventButtonPlacement
      : 'sidebar';
    showBadge.checked = settings?.showBadge !== false;
    eventSound.checked = settings?.eventSound !== false;
    filterRows = readFilters(settings);
    renderFilters();
    if (hasDraft && !draftDiffers) void chrome.storage.local.remove(DRAFT_KEY);
    if (draftDiffers) {
      setStatus('Восстановлены несохранённые поля подключения.', 'checking');
      return;
    }
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
      const contentScripts = await chrome.runtime.sendMessage({ type: 'content.ensure' });
      if (run === statusRun) {
        if (contentScripts?.ok) setStatus(`✓ Подключение и функции работают · проверено ${checkedNow()}`, 'ok');
        else setStatus(contentScriptsError(contentScripts), 'warning');
      }
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
        eventButtonPlacement: eventButtonPlacement.value,
        showBadge: showBadge.checked,
        eventSound: eventSound.checked,
        eventFilters: collectFilters(),
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
      await chrome.storage.local.set({ settings: next, [DRAFT_KEY]: null });
      await chrome.storage.local.remove(DRAFT_KEY);
      if (previousBaseUrl && pattern(previousBaseUrl) !== originPattern) {
        await chrome.permissions.remove({ origins: [pattern(previousBaseUrl)] });
      }
      previousBaseUrl = next.baseUrl;
      baseUrl.value = next.baseUrl;
      apiKey.value = next.apiKey;
      filterRows = readFilters(next);
      renderFilters();
      // Первичная лента может загружать журналы десятков задач. Она строится в фоне
      // и не должна удерживать popup в состоянии «Сохраняю».
      const contentScripts = await chrome.runtime.sendMessage({ type: 'settings.saved' });
      if (contentScripts?.ok) setStatus(`✓ Подключение и функции работают · проверено ${checkedNow()}`, 'ok');
      else setStatus(contentScriptsError(contentScripts), 'warning');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Не удалось сохранить настройки.', 'error');
    } finally {
      save.disabled = false;
    }
  });
})();
