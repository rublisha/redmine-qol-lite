(() => {
  'use strict';
  const root = globalThis.RedmineSmallQol = globalThis.RedmineSmallQol || {};
  root.contentScriptsLoaded = true;

  root.normalizeBaseUrl = (value) => String(value || '').trim().replace(/\/+$/, '');
  root.getSettings = async () => {
    const { settings } = await chrome.storage.local.get('settings');
    return {
      baseUrl: '', apiKey: '', pollMinutes: 15, eventButtonPlacement: 'sidebar',
      eventSound: true, eventFilters: [], ...(settings || {}),
    };
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

  // Небольшой разбор Textile для показа комментариев Redmine вне самой страницы задачи.
  // Узлы собираются через createElement и textContent: разметка из Redmine никогда
  // не попадает в innerHTML, поэтому вставить свой HTML через комментарий нельзя.
  // Поддерживается практичное подмножество; незнакомая разметка остаётся текстом.
  const LEAD = '(^|[\\s(\\[{«"\'])';
  const TAIL = '(?=$|[\\s).,;:!?\\]}»"\'])';
  const URL_TAIL = /[.,;:!?)\]}»"']+$/;

  function textNode(value) { return document.createTextNode(value); }
  function tagNode(tag, className, value) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (value !== undefined) node.textContent = value;
    return node;
  }
  function safeUrl(value, baseUrl) {
    const raw = String(value || '').trim();
    if (/^https?:\/\//i.test(raw)) return raw;
    if (raw.startsWith('/')) return `${baseUrl}${raw}`;
    return '';
  }
  function linkNode(url, label, baseUrl) {
    const href = safeUrl(url, baseUrl);
    if (!href) return textNode(label);
    const node = tagNode('a', 'rsq-md-link', label);
    node.href = href;
    node.rel = 'noreferrer';
    return node;
  }
  function inlineRules(baseUrl) {
    return [
      {
        pattern: new RegExp(`${LEAD}@([^@\\n]+)@${TAIL}`, 'g'),
        build: (match) => [textNode(match[1]), tagNode('code', 'rsq-md-code', match[2])],
      },
      {
        pattern: new RegExp(`${LEAD}"([^"\\n]+)":((?:https?://|/)[^\\s<>"]+)`, 'g'),
        build: (match) => [textNode(match[1]), linkNode(match[3], match[2], baseUrl)],
      },
      {
        pattern: new RegExp(`${LEAD}(https?://[^\\s<>"]+)`, 'g'),
        build: (match) => {
          const trailing = match[2].match(URL_TAIL)?.[0] || '';
          const url = trailing ? match[2].slice(0, -trailing.length) : match[2];
          return [textNode(match[1]), linkNode(url, url, baseUrl), textNode(trailing)];
        },
      },
      {
        pattern: new RegExp(`${LEAD}#(\\d+)\\b`, 'g'),
        build: (match) => [textNode(match[1]), linkNode(`${baseUrl}/issues/${match[2]}`, `#${match[2]}`, baseUrl)],
      },
      {
        pattern: new RegExp(`${LEAD}\\*([^*\\n]+)\\*${TAIL}`, 'g'),
        build: (match) => [textNode(match[1]), tagNode('strong', '', match[2])],
      },
      {
        pattern: new RegExp(`${LEAD}_([^_\\n]+)_${TAIL}`, 'g'),
        build: (match) => [textNode(match[1]), tagNode('em', '', match[2])],
      },
    ];
  }
  function applyInlineRule(container, rule) {
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    const targets = [];
    while (walker.nextNode()) {
      const node = walker.currentNode;
      // Внутри уже собранной ссылки или кода разметку второй раз не разбираем.
      if (node.parentElement?.closest('a, code')) continue;
      targets.push(node);
    }
    for (const node of targets) {
      const text = node.textContent;
      const pieces = [];
      let cursor = 0;
      let match;
      rule.pattern.lastIndex = 0;
      while ((match = rule.pattern.exec(text))) {
        if (match.index > cursor) pieces.push(textNode(text.slice(cursor, match.index)));
        pieces.push(...rule.build(match));
        cursor = match.index + match[0].length;
      }
      if (!pieces.length) continue;
      if (cursor < text.length) pieces.push(textNode(text.slice(cursor)));
      node.replaceWith(...pieces);
    }
  }
  function inlineFragment(value, baseUrl) {
    const fragment = document.createDocumentFragment();
    fragment.appendChild(textNode(String(value || '')));
    for (const rule of inlineRules(baseUrl)) applyInlineRule(fragment, rule);
    return fragment;
  }
  function multilineInto(node, lines, baseUrl) {
    lines.forEach((line, index) => {
      if (index) node.appendChild(document.createElement('br'));
      node.appendChild(inlineFragment(line, baseUrl));
    });
  }

  const BLOCK_START = /^\s*(?:<pre>|bc\.|h[1-6]\.|bq\.|>|[*#]+\s|\||-{3,}\s*$|\*{3,}\s*$)/i;
  function isBlockStart(line) { return BLOCK_START.test(line); }

  function appendCode(parent, lines, start) {
    const first = lines[start];
    const fenced = /^\s*<pre>/i.test(first);
    const collected = [];
    let index = start;
    if (fenced) {
      const head = first.replace(/^\s*<pre>/i, '');
      if (/<\/pre>/i.test(head)) { collected.push(head.replace(/<\/pre>.*$/i, '')); index += 1; }
      else {
        if (head.trim()) collected.push(head);
        index += 1;
        while (index < lines.length && !/<\/pre>/i.test(lines[index])) { collected.push(lines[index]); index += 1; }
        if (index < lines.length) {
          const tail = lines[index].replace(/<\/pre>.*$/i, '');
          if (tail.trim()) collected.push(tail);
          index += 1;
        }
      }
    } else {
      collected.push(first.replace(/^\s*bc\.+\s?/i, ''));
      index += 1;
      while (index < lines.length && lines[index].trim()) { collected.push(lines[index]); index += 1; }
    }
    parent.appendChild(tagNode('pre', 'rsq-md-pre', collected.join('\n').replace(/^\n+|\n+$/g, '')));
    return index;
  }
  function appendQuote(parent, lines, start, baseUrl) {
    const collected = [];
    let index = start;
    while (index < lines.length && /^\s*(?:bq\.|>)/.test(lines[index])) {
      collected.push(lines[index].replace(/^\s*(?:bq\.\s?|>+\s?)/, ''));
      index += 1;
    }
    const quote = tagNode('blockquote', 'rsq-md-quote');
    multilineInto(quote, collected, baseUrl);
    parent.appendChild(quote);
    return index;
  }
  function appendList(parent, lines, start, baseUrl) {
    const items = [];
    let index = start;
    while (index < lines.length) {
      const match = lines[index].match(/^\s*([*#]+)\s+(.*)$/);
      if (!match) break;
      const item = { depth: match[1].length, ordered: match[1].endsWith('#'), text: match[2] };
      // Смена вида маркера на верхнем уровне начинает новый список, а не продолжает старый.
      if (items.length && item.depth === items[0].depth && item.ordered !== items[0].ordered) break;
      items.push(item);
      index += 1;
    }
    const list = tagNode(items[0].ordered ? 'ol' : 'ul', 'rsq-md-list');
    const stack = [{ depth: items[0].depth, node: list }];
    for (const item of items) {
      while (stack.length > 1 && item.depth < stack[stack.length - 1].depth) stack.pop();
      let current = stack[stack.length - 1];
      if (item.depth > current.depth) {
        const nested = tagNode(item.ordered ? 'ol' : 'ul', 'rsq-md-list');
        const host = current.node.lastElementChild || current.node.appendChild(document.createElement('li'));
        host.appendChild(nested);
        stack.push({ depth: item.depth, node: nested });
        current = stack[stack.length - 1];
      }
      const entry = document.createElement('li');
      entry.appendChild(inlineFragment(item.text, baseUrl));
      current.node.appendChild(entry);
    }
    parent.appendChild(list);
    return index;
  }
  function appendTable(parent, lines, start, baseUrl) {
    const table = tagNode('table', 'rsq-md-table');
    let index = start;
    while (index < lines.length && /^\s*\|.*\|\s*$/.test(lines[index])) {
      const row = document.createElement('tr');
      const cells = lines[index].trim().replace(/^\||\|$/g, '').split('|');
      for (const cell of cells) {
        const header = /^\s*_\./.test(cell);
        const node = document.createElement(header ? 'th' : 'td');
        node.appendChild(inlineFragment(cell.replace(/^\s*_\.\s?/, '').trim(), baseUrl));
        row.appendChild(node);
      }
      table.appendChild(row);
      index += 1;
    }
    parent.appendChild(table);
    return index;
  }
  function appendParagraph(parent, lines, start, baseUrl) {
    const collected = [lines[start].replace(/^\s*p\.\s?/, '')];
    let index = start + 1;
    while (index < lines.length && lines[index].trim() && !isBlockStart(lines[index])) {
      collected.push(lines[index]);
      index += 1;
    }
    const paragraph = tagNode('p', 'rsq-md-p');
    multilineInto(paragraph, collected, baseUrl);
    parent.appendChild(paragraph);
    return index;
  }

  root.renderTextile = (value, options = {}) => {
    const baseUrl = root.normalizeBaseUrl(options.baseUrl || '');
    const fragment = document.createDocumentFragment();
    const lines = String(value || '').replace(/\r\n?/g, '\n').replace(/<br\s*\/?>/gi, '\n').split('\n');
    let index = 0;
    while (index < lines.length) {
      const line = lines[index];
      if (!line.trim()) { index += 1; continue; }
      if (/^\s*(?:<pre>|bc\.)/i.test(line)) { index = appendCode(fragment, lines, index); continue; }
      if (/^\s*(?:-{3,}|\*{3,})\s*$/.test(line)) { fragment.appendChild(tagNode('hr', 'rsq-md-hr')); index += 1; continue; }
      const heading = line.match(/^\s*h([1-6])\.\s*(.*)$/i);
      if (heading) {
        const node = tagNode('div', 'rsq-md-h');
        node.dataset.level = heading[1];
        node.appendChild(inlineFragment(heading[2], baseUrl));
        fragment.appendChild(node);
        index += 1;
        continue;
      }
      if (/^\s*(?:bq\.|>)/.test(line)) { index = appendQuote(fragment, lines, index, baseUrl); continue; }
      if (/^\s*[*#]+\s+/.test(line)) { index = appendList(fragment, lines, index, baseUrl); continue; }
      if (/^\s*\|.*\|\s*$/.test(line)) { index = appendTable(fragment, lines, index, baseUrl); continue; }
      index = appendParagraph(fragment, lines, index, baseUrl);
    }
    return fragment;
  };
})();
