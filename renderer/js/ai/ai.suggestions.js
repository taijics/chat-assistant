(function () {
  window.AIApp = window.AIApp || {};
  const { escapeHtml, stripMarkdown, normalizeText } = window.AIApp.utils;

  function parseSuggestionsFromText(raw) {
    if (!raw) return [];
    const s = String(raw).replace(/\r\n/g, '\n');
    const re = /^(\s*)(\d+)\.\s+(.+)$/gm;
    let m, matches = [];
    while ((m = re.exec(s)) !== null) matches.push({ index: m.index, title: m[3] || '' });

    if (matches.length) {
      for (let i = 0; i < matches.length; i++) {
        const start = matches[i].index;
        const end = i + 1 < matches.length ? matches[i + 1].index : s.length;
        const seg = s.slice(start, end).trim();
        const nl = seg.indexOf('\n');
        const title = matches[i].title.trim();
        const body = nl >= 0 ? seg.slice(nl + 1) : '';
        const quoteLines = body.split('\n').filter(l => l.trim().startsWith('>'));
        const content = quoteLines.length
          ? quoteLines.map(l => l.replace(/^\s*>\s?/, '')).join('\n')
          : title + (body ? '\n' + body : '');
        const cleaned = stripMarkdown(content);
        if (cleaned) matches[i].text = cleaned;
      }
      return matches.map(x => x.text).filter(Boolean);
    }

    let body = s;
    const idx = s.indexOf('回复话术');
    if (idx >= 0) body = s.slice(idx + '回复话术'.length);
    return body.split(/\n{2,}/)
      .map(p => stripMarkdown(p).trim())
      .filter(p => p && !/^客户问[:：]/.test(p))
      .slice(0, 10);
  }

  function renderSuggestions(items) {
    const list = document.getElementById('ai-suggestions');
    if (!list) return;
    const arr = Array.isArray(items) && items.length ? items : ['（无内容）'];
    list.innerHTML = arr.map((text, i) => {
      const safe = escapeHtml(text);
      return `<li class="ai-sug" data-idx="${i}">
        <div class="title">建议 ${i + 1}</div>
        <div class="body" title="单击：粘贴；双击：粘贴并发送">${safe}</div>
        <div class="editor" hidden><textarea>${safe}</textarea></div>
        <div class="ops"><button data-op="edit">编辑</button></div>
      </li>`;
    }).join('');
  }

  function bindSuggestionEvents(ipcRenderer) {
    const list = document.getElementById('ai-suggestions');
    if (!list || bindSuggestionEvents.bound) return;
    bindSuggestionEvents.bound = true;

    list.addEventListener('click', (e) => {
      const opBtn = e.target.closest('button[data-op]');
      if (!opBtn) return;
      const li = e.target.closest('li.ai-sug');
      if (!li) return;

      const bodyEl = li.querySelector('.body');
      const editor = li.querySelector('.editor');
      const textarea = editor.querySelector('textarea');
      const op = opBtn.dataset.op;

      if (op === 'edit') {
        editor.removeAttribute('hidden');
        textarea.value = bodyEl.textContent || '';
        bodyEl.setAttribute('hidden', 'hidden');
        opBtn.dataset.op = 'commit';
        opBtn.textContent = '保存修改';
        textarea.focus();
        textarea.setSelectionRange(textarea.value.length, textarea.value.length);
      } else if (op === 'commit') {
        const val = normalizeText(textarea.value);
        bodyEl.textContent = val;
        bodyEl.removeAttribute('hidden');
        editor.setAttribute('hidden', 'hidden');
        opBtn.dataset.op = 'edit';
        opBtn.textContent = '编辑';
      }
    });

    let singleTimer = null;
    list.addEventListener('click', (e) => {
      const body = e.target.closest('.ai-sug .body');
      if (!body) return;
      const editor = body.parentElement.querySelector('.editor');
      if (editor && !editor.hasAttribute('hidden')) return;

      const text = body.textContent || '';
      if (!normalizeText(text)) return;

      clearTimeout(singleTimer);
      singleTimer = setTimeout(() => {
        ipcRenderer.send('phrase:paste', text);
        singleTimer = null;
      }, window.AIApp.constants.SINGLE_CLICK_DELAY);
    });

    list.addEventListener('dblclick', (e) => {
      const body = e.target.closest('.ai-sug .body');
      if (!body) return;
      const editor = body.parentElement.querySelector('.editor');
      if (editor && !editor.hasAttribute('hidden')) return;

      const text = body.textContent || '';
      if (!normalizeText(text)) return;

      if (singleTimer) {
        clearTimeout(singleTimer);
        singleTimer = null;
      }
      ipcRenderer.send('phrase:paste-send', text);
    });
  }

  window.AIApp.suggestions = { parseSuggestionsFromText, renderSuggestions, bindSuggestionEvents };
})();