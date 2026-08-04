(() => {
  'use strict';

  const SCRIPT_ID = 'redmine-small-qol';
  const SCRIPT_FILES = ['content-common.js', 'content-watchers.js', 'content-preview.js', 'content-events.js', 'content-history.js', 'content-new-comments.js', 'content-favorites.js', 'content-drafts.js', 'content-quote.js'];
  const ALARM = 'redmine-events';
  const FEED_KEY = 'eventFeed';
  const FEED_SCHEMA = 3;
  const MAX_ISSUES = 60;
  const MAX_EVENTS = 150;
  const DETAIL_LIMIT = 10;
  const MAX_KNOWN_WATCHERS = 2000;

  const fieldLabels = {
    status_id: 'статус', priority_id: 'приоритет', tracker_id: 'трекер', fixed_version_id: 'версия',
    assigned_to_id: 'исполнитель', category_id: 'категория', project_id: 'проект', parent_id: 'родитель',
    subject: 'тема', description: 'описание', done_ratio: 'готовность', start_date: 'начало', due_date: 'срок',
    is_private: 'приватность', estimated_hours: 'оценка времени',
  };
  const lookupKinds = {
    status_id: 'status', priority_id: 'priority', tracker_id: 'tracker', fixed_version_id: 'version',
    assigned_to_id: 'user', category_id: 'category', project_id: 'project',
  };

  let refreshPromise = null;
  let refreshIsForced = false;
  let contentScriptSyncPromise = null;

  function normalize(value) { return String(value || '').trim().replace(/\/+$/, ''); }
  function permissionPattern(value) {
    const url = new URL(normalize(value));
    return `${url.origin}/*`;
  }
  async function getSettings() {
    const { settings } = await chrome.storage.local.get('settings');
    return settings || { baseUrl: '', apiKey: '', pollMinutes: 15 };
  }
  async function allowed(baseUrl) {
    if (!baseUrl) return false;
    try { return chrome.permissions.contains({ origins: [permissionPattern(baseUrl)] }); }
    catch { return false; }
  }

  async function injectContentScripts(tabId) {
    try {
      const [probe] = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => globalThis.RedmineSmallQol?.contentScriptsLoaded === true,
      });
      if (probe?.result) return { ok: true, injected: false };
      await chrome.scripting.executeScript({ target: { tabId }, files: SCRIPT_FILES });
      return { ok: true, injected: true };
    } catch (error) {
      // The tab may have navigated, closed, or become inaccessible between query and injection.
      return { ok: false, error: error instanceof Error ? error.message : 'Content scripts could not be injected.' };
    }
  }

  async function injectContentScriptsIntoOpenTabs(baseUrl) {
    if (!baseUrl || !await allowed(baseUrl)) return { ok: false, found: 0, injected: 0 };
    let tabs;
    try { tabs = await chrome.tabs.query({ url: permissionPattern(baseUrl) }); }
    catch (error) {
      return { ok: false, found: 0, injected: 0, error: error instanceof Error ? error.message : 'Redmine tabs could not be queried.' };
    }
    const results = await Promise.all(tabs.filter((tab) => tab.id !== undefined).map((tab) => injectContentScripts(tab.id)));
    return {
      ok: results.length === 0 || results.some((result) => result.ok),
      found: results.length,
      injected: results.filter((result) => result.injected).length,
      error: results.find((result) => !result.ok)?.error || '',
    };
  }

  async function injectContentScriptsIfConfigured(tabId, url) {
    const settings = await getSettings();
    if (!settings.baseUrl || !url || !await allowed(settings.baseUrl)) return;
    try {
      if (new URL(url).origin !== new URL(normalize(settings.baseUrl)).origin) return;
    } catch { return; }
    await injectContentScripts(tabId);
  }

  async function doSyncContentScripts() {
    const settings = await getSettings();
    const pattern = settings.baseUrl ? permissionPattern(settings.baseUrl) : '';
    const canRun = pattern && await allowed(settings.baseUrl);
    let registrationError = '';
    let current;
    try {
      [current] = await chrome.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] });
    } catch (error) {
      registrationError = error instanceof Error ? error.message : 'Dynamic content-script registration is unavailable.';
    }
    if (!canRun) {
      if (current) {
        try { await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] }); }
        catch { /* The permission is already unavailable, so there is nothing else to do. */ }
      }
      return { ok: false, error: 'Redmine access is not configured.' };
    }
    if (!registrationError) {
      try {
        const samePattern = current?.matches?.length === 1 && current.matches[0] === pattern;
        const sameFiles = current?.js?.length === SCRIPT_FILES.length && SCRIPT_FILES.every((file, i) => current.js[i] === file);
        if (!samePattern || !sameFiles) {
          if (current) await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
          await chrome.scripting.registerContentScripts([{
            id: SCRIPT_ID,
            matches: [pattern],
            js: SCRIPT_FILES,
            runAt: 'document_idle',
            persistAcrossSessions: true,
          }]);
        }
      } catch (error) {
        registrationError = error instanceof Error ? error.message : 'Dynamic content scripts could not be registered.';
      }
    }
    if (registrationError) console.warn('[Redmine QOL Lite] Dynamic content-script registration failed; using tab injection:', registrationError);
    const tabs = await injectContentScriptsIntoOpenTabs(settings.baseUrl);
    return {
      ok: tabs.ok && (!registrationError || tabs.found > 0),
      registrationOk: !registrationError,
      tabs,
      error: !tabs.ok ? tabs.error : (registrationError && tabs.found === 0 ? registrationError : ''),
    };
  }

  function syncContentScripts() {
    if (!contentScriptSyncPromise) {
      contentScriptSyncPromise = doSyncContentScripts().finally(() => { contentScriptSyncPromise = null; });
    }
    return contentScriptSyncPromise;
  }

  async function syncAlarm() {
    const { pollMinutes } = await getSettings();
    await chrome.alarms.clear(ALARM);
    if (pollMinutes > 0) await chrome.alarms.create(ALARM, { periodInMinutes: pollMinutes, delayInMinutes: pollMinutes });
  }

  async function requestJson(settings, path) {
    const response = await fetch(`${normalize(settings.baseUrl)}${path}`, {
      headers: { 'X-Redmine-API-Key': settings.apiKey },
    });
    if (!response.ok) throw new Error(`Redmine вернул ${response.status}`);
    return response.json();
  }

  async function queryIssues(settings, reason, params) {
    const query = new URLSearchParams({ status_id: '*', sort: 'updated_on:desc', limit: '50', ...params });
    try {
      const data = await requestJson(settings, `/issues.json?${query}`);
      return (data.issues || []).map((issue) => ({ issue, reason }));
    } catch (error) {
      console.warn(`[Redmine QOL Lite] Источник событий «${reason}» недоступен:`, error);
      return [];
    }
  }

  async function getFeedIssues(settings) {
    const parts = await Promise.all([
      queryIssues(settings, 'наблюдатель', { watcher_id: 'me' }),
      queryIssues(settings, 'автор', { author_id: 'me' }),
      queryIssues(settings, 'исполнитель', { assigned_to_id: 'me' }),
    ]);
    const merged = new Map();
    for (const part of parts) for (const { issue, reason } of part) {
      const current = merged.get(issue.id);
      if (current) { if (!current.reasons.includes(reason)) current.reasons.push(reason); }
      else merged.set(issue.id, { issue, reasons: [reason] });
    }
    return [...merged.values()]
      .sort((a, b) => String(b.issue.updated_on || '').localeCompare(String(a.issue.updated_on || '')))
      .slice(0, MAX_ISSUES);
  }

  async function mapLimit(items, limit, worker) {
    const output = new Array(items.length);
    let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (cursor < items.length) {
        const index = cursor++;
        output[index] = await worker(items[index]);
      }
    }));
    return output;
  }
  function uniqueCandidates(items, limit) {
    const seen = new Set();
    const output = [];
    for (const item of items) {
      const id = String(item.issue.id);
      if (seen.has(id)) continue;
      seen.add(id); output.push(item);
      if (output.length >= limit) break;
    }
    return output;
  }
  function rememberWatcherIds(previousIds, currentIds) {
    const ordered = new Map();
    for (const raw of previousIds || []) {
      const id = String(raw || '');
      if (id) ordered.set(id, true);
    }
    for (const raw of currentIds) {
      const id = String(raw || '');
      if (!id) continue;
      ordered.delete(id); ordered.set(id, true);
    }
    return [...ordered.keys()].slice(-MAX_KNOWN_WATCHERS);
  }

  function addName(names, kind, value) {
    if (value?.id !== undefined && value?.name) names[`${kind}:${value.id}`] = value.name;
  }
  function collectNames(feed, details) {
    const names = {};
    for (const { issue } of feed) {
      addName(names, 'project', issue.project); addName(names, 'status', issue.status);
      addName(names, 'priority', issue.priority); addName(names, 'tracker', issue.tracker);
      addName(names, 'version', issue.fixed_version); addName(names, 'category', issue.category);
      addName(names, 'user', issue.assigned_to); addName(names, 'user', issue.author);
    }
    for (const issue of details) for (const journal of issue?.journals || []) addName(names, 'user', journal.user);
    return names;
  }
  function resolveValue(names, field, value) {
    if (value === null || value === undefined || value === '') return '';
    if (field === 'done_ratio') return `${value}%`;
    if (field === 'is_private') return String(value) === '1' ? 'да' : 'нет';
    const kind = lookupKinds[field];
    return kind ? (names[`${kind}:${value}`] || `#${value}`) : String(value);
  }
  function describeDetail(detail, names) {
    if (detail.property === 'attachment') return detail.new_value ? `добавлено вложение: ${detail.new_value}` : 'удалено вложение';
    if (detail.property === 'relation') return 'изменены связи задачи';
    if (detail.property === 'cf') return 'изменено дополнительное поле';
    const label = fieldLabels[detail.name] || detail.name || 'поле';
    if (detail.name === 'description') return `${label} изменено`;
    if (detail.name === 'subject') return `${label} изменена`;
    const from = resolveValue(names, detail.name, detail.old_value);
    const to = resolveValue(names, detail.name, detail.new_value);
    if (!to) return `${label} очищен`;
    if (!from) return `${label}: ${to}`;
    return `${label}: ${from} → ${to}`;
  }
  function toEvent(issue, reasons, journal, names, noteNumber) {
    return {
      key: `${issue.id}:${journal.id}`,
      issueId: issue.id,
      journalId: journal.id,
      noteNumber,
      version: issue.fixed_version?.name || '',
      subject: issue.subject || '',
      project: issue.project?.name || '',
      status: issue.status?.name || '',
      actor: journal.user?.name || 'Неизвестный пользователь',
      at: journal.created_on || issue.updated_on || '',
      changes: (journal.details || []).map((detail) => describeDetail(detail, names)).filter(Boolean),
      comment: String(journal.notes || '').trim(),
      reasons,
    };
  }
  function toWatcherDiscoveryEvent(issue, reasons, discoveredAt, isNew) {
    return {
      key: `${issue.id}:watcher-discovered`,
      issueId: issue.id,
      journalId: 0,
      noteNumber: 0,
      version: issue.fixed_version?.name || '',
      subject: issue.subject || '',
      project: issue.project?.name || '',
      status: issue.status?.name || '',
      actor: isNew ? (issue.author?.name || '') : '',
      at: isNew ? (issue.created_on || discoveredAt) : discoveredAt,
      summary: isNew ? 'создал задачу' : 'задача появилась в наблюдаемых',
      changes: [],
      comment: '',
      reasons,
    };
  }
  function meaningful(journal) { return Boolean(String(journal?.notes || '').trim() || journal?.details?.length); }

  async function doRefreshEvents(forceRecent = false) {
    const settings = await getSettings();
    if (!settings.baseUrl || !settings.apiKey || !await allowed(settings.baseUrl)) return { ok: false, error: 'Расширение не настроено.' };

    const feed = await getFeedIssues(settings);
    const checkedAt = new Date().toISOString();
    const { [FEED_KEY]: stored } = await chrome.storage.local.get(FEED_KEY);
    const previous = stored?.schema === FEED_SCHEMA
      ? stored
      : { schema: FEED_SCHEMA, initialized: false, issueVersions: {}, lastJournalIds: {}, events: [], readKeys: {} };

    // Первый запуск — только точка отсчёта. Старые журналы не загружаем и не показываем:
    // следующая смена `updated_on` сама приведёт изменившуюся задачу в ленту.
    if (!previous.initialized) {
      const initial = {
        schema: FEED_SCHEMA,
        initialized: true,
        issueVersions: Object.fromEntries(feed.map(({ issue }) => [String(issue.id), issue.updated_on || ''])),
        lastJournalIds: {},
        knownWatcherIssueIds: feed
          .filter(({ reasons }) => reasons.includes('наблюдатель'))
          .map(({ issue }) => String(issue.id)),
        watcherDiscoveryReady: true,
        events: [],
        readKeys: {},
        checkedAt,
      };
      await chrome.storage.local.set({ [FEED_KEY]: initial });
      await updateBadge(initial);
      return { ok: true, added: 0, initialized: true };
    }
    const changed = feed.filter(({ issue }) => {
      const id = String(issue.id);
      const current = issue.updated_on || '';
      if (Object.prototype.hasOwnProperty.call(previous.issueVersions, id)) {
        return previous.issueVersions[id] !== current;
      }
      // Задача могла просто впервые попасть в один из источников из-за лимита,
      // временной ошибки watcher_id или смены состава выборки. Старую задачу
      // событием не считаем; новая должна быть обновлена после прошлой проверки.
      return Boolean(current && previous.checkedAt && current > previous.checkedAt);
    });
    const watched = feed.filter(({ reasons }) => reasons.includes('наблюдатель'));
    const discoveryHistory = previous.watcherDiscoveryReady === true
      ? (previous.knownWatcherIssueIds || [])
      : Object.keys(previous.issueVersions || {});
    const knownWatcherIds = new Set(discoveryHistory.map(String));
    const newlyWatched = watched.filter(({ issue }) => !knownWatcherIds.has(String(issue.id)));
    const candidates = forceRecent
      ? uniqueCandidates(feed, DETAIL_LIMIT)
      : uniqueCandidates([...newlyWatched, ...changed], DETAIL_LIMIT);
    const details = await mapLimit(candidates, 4, async ({ issue, reasons }) => {
      try {
        const data = await requestJson(settings, `/issues/${issue.id}.json?include=journals`);
        return { issue: data.issue, reasons };
      } catch (error) {
        console.warn(`[Redmine QOL Lite] Не удалось загрузить журнал #${issue.id}:`, error);
        return null;
      }
    });
    const loadedIssues = details.filter(Boolean).map((item) => item.issue);
    const names = collectNames(feed, loadedIssues);
    const freshEvents = [];
    const lastJournalIds = { ...(previous.lastJournalIds || {}) };

    for (const item of details.filter(Boolean)) {
      const issue = item.issue;
      const journals = (issue.journals || []).filter(meaningful).sort((a, b) => a.id - b.id);
      const known = Number(lastJournalIds[String(issue.id)] || 0);
      let additions;
      if (known) additions = journals.filter((journal) => journal.id > known);
      else {
        const baselineAt = previous.issueVersions[String(issue.id)] || previous.checkedAt || '';
        additions = journals.filter((journal) => String(journal.created_on || '') > baselineAt);
      }
      for (const journal of additions) {
        const noteNumber = journals.findIndex((candidate) => candidate.id === journal.id) + 1;
        freshEvents.push(toEvent(issue, item.reasons, journal, names, noteNumber));
      }
      if (journals.length) lastJournalIds[String(issue.id)] = journals[journals.length - 1].id;
    }
    const freshIssueIds = new Set(freshEvents.map((event) => String(event.issueId)));
    for (const item of newlyWatched) {
      const id = String(item.issue.id);
      if (freshIssueIds.has(id)) continue;
      const isNew = Boolean(item.issue.created_on && previous.checkedAt && item.issue.created_on > previous.checkedAt);
      freshEvents.push(toWatcherDiscoveryEvent(item.issue, item.reasons, checkedAt, isNew));
    }

    const byKey = new Map();
    for (const event of [...freshEvents, ...(previous.events || [])]) if (!byKey.has(event.key)) byKey.set(event.key, event);
    const events = [...byKey.values()].sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, MAX_EVENTS);
    const readKeys = { ...(previous.readKeys || {}) };
    if (!previous.initialized) for (const event of events) readKeys[event.key] = true;
    const valid = new Set(events.map((event) => event.key));
    for (const key of Object.keys(readKeys)) if (!valid.has(key)) delete readKeys[key];
    // Если за один цикл изменилось больше DETAIL_LIMIT задач или отдельный журнал
    // временно не загрузился, оставляем старую версию: такой хвост попадёт в следующий цикл.
    const loadedIds = new Set(details.filter(Boolean).map((item) => String(item.issue.id)));
    const changedIds = new Set(changed.map(({ issue }) => String(issue.id)));
    const issueVersions = Object.fromEntries(feed.map(({ issue }) => {
      const id = String(issue.id);
      const current = issue.updated_on || '';
      const needsRetry = changedIds.has(id) && !loadedIds.has(id);
      return [id, needsRetry ? (previous.issueVersions[id] || previous.checkedAt || '') : current];
    }));
    const knownWatcherIssueIds = rememberWatcherIds(
      previous.watcherDiscoveryReady === true ? previous.knownWatcherIssueIds : [],
      watched.map(({ issue }) => issue.id),
    );
    const next = {
      schema: FEED_SCHEMA,
      initialized: true,
      issueVersions,
      lastJournalIds,
      knownWatcherIssueIds,
      watcherDiscoveryReady: true,
      events,
      readKeys,
      checkedAt,
    };
    await chrome.storage.local.set({ [FEED_KEY]: next });
    await updateBadge(next);
    return { ok: true, added: freshEvents.length };
  }

  function refreshEvents(forceRecent = false) {
    if (refreshPromise) {
      if (forceRecent && !refreshIsForced) return refreshPromise.then(() => refreshEvents(true));
      return refreshPromise;
    }
    refreshIsForced = forceRecent;
    refreshPromise = doRefreshEvents(forceRecent).catch((error) => {
      console.warn('[Redmine QOL Lite] Обновление событий не удалось:', error);
      return { ok: false, error: error instanceof Error ? error.message : 'Ошибка обновления.' };
    }).finally(() => { refreshPromise = null; refreshIsForced = false; });
    return refreshPromise;
  }
  function unreadCount(feed) { return (feed?.events || []).filter((event) => !feed.readKeys?.[event.key]).length; }
  async function updateBadge(feed) {
    const { showBadge = true } = await getSettings();
    if (!showBadge) {
      await chrome.action.setBadgeText({ text: '' });
      return;
    }
    const count = unreadCount(feed);
    await chrome.action.setBadgeBackgroundColor({ color: '#326b9b' });
    await chrome.action.setBadgeText({ text: count ? (count > 99 ? '99+' : String(count)) : '' });
  }
  async function markRead(keys) {
    const { [FEED_KEY]: feed } = await chrome.storage.local.get(FEED_KEY);
    if (!feed) return;
    const readKeys = { ...(feed.readKeys || {}) };
    for (const key of keys) readKeys[key] = true;
    const next = { ...feed, readKeys };
    await chrome.storage.local.set({ [FEED_KEY]: next });
    await updateBadge(next);
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'settings.saved') {
      Promise.all([syncContentScripts(), syncAlarm()]).then(([contentScripts]) => {
        sendResponse(contentScripts);
        void refreshEvents();
      }).catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : 'Ошибка настройки.' }));
      return true;
    }
    if (message?.type === 'content.ensure') {
      syncContentScripts().then(sendResponse).catch((error) => sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : 'Не удалось запустить функции на странице.',
      }));
      return true;
    }
    if (message?.type === 'events.refresh') { refreshEvents(message.forceRecent === true).then(sendResponse); return true; }
    if (message?.type === 'events.read') { markRead(message.keys || []).then(() => sendResponse({ ok: true })); return true; }
    return false;
  });
  chrome.alarms.onAlarm.addListener((alarm) => { if (alarm.name === ALARM) void refreshEvents(); });
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete') void injectContentScriptsIfConfigured(tabId, tab.url);
  });
  chrome.permissions.onAdded.addListener(() => void syncContentScripts());
  chrome.permissions.onRemoved.addListener(() => void syncContentScripts());
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.settings) {
      void syncContentScripts();
      void syncAlarm();
      void chrome.storage.local.get(FEED_KEY).then((data) => updateBadge(data[FEED_KEY]));
    }
  });
  chrome.runtime.onInstalled.addListener(() => { void syncContentScripts(); void syncAlarm(); void refreshEvents(); });
  chrome.runtime.onStartup.addListener(() => { void syncContentScripts(); void syncAlarm(); void refreshEvents(); });

  void syncContentScripts();
  void syncAlarm();
  chrome.storage.local.get(FEED_KEY).then((data) => updateBadge(data[FEED_KEY]));
})();
