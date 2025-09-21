(function() {
  const { ipcRenderer } = require('electron');

  const STORAGE_KEY = 'phrases.data.v1';
  const SINGLE_CLICK_DELAY = 300;

  // 接收主进程调试信息，在渲染端 DevTools 打印（UTF-8 正常）
  ipcRenderer.on('ai:debug-log', (_e, payload) => {
    try {
      const tag = payload && payload.tag ? `[${payload.tag}]` : '';
      console.groupCollapsed(`%cAI 调试 ${tag}`, 'color:#0a84ff');
      console.log(payload);
      if (payload && typeof payload.prompt === 'string') {
        console.log('提交给 AI 的最终 Prompt（原文）:\n', payload.prompt);
      }
      if (payload && typeof payload.rawText === 'string') {
        console.log('AI 原始返回(assistant 全部拼接) length:', payload.rawText.length, '\n', payload.rawText);
      }
      if (payload && typeof payload.finalText === 'string') {
        console.log('用于展示的最终回答文本:\n', payload.finalText);
      }
      console.groupEnd();
    } catch {}
  });

  function normalizeText(s) {
    return String(s || '').replace(/\r\n/g, '\n').trim();
  }

  // 基础的 Markdown 清洗（保留换行，去掉强调/引用/链接标记等）
  function stripMarkdown(s) {
    return String(s || '')
      .replace(/```[\s\S]*?```/g, '')                // 三引号代码块
      .replace(/^#{1,6}\s+/gm, '')                   // 标题
      .replace(/\*\*(.*?)\*\*/g, '$1')               // 粗体
      .replace(/\*(.*?)\*/g, '$1')                   // 斜体
      .replace(/^>\s?/gm, '')                        // 引用前缀
      .replace(/!\[[^\]]*\]\([^)]+\)/g, '')          // 图片
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')       // 链接
      .replace(/`([^`]+)`/g, '$1')                   // 行内代码
      .replace(/[ \t]+\n/g, '\n')                    // 尾随空格
      .replace(/\u00A0/g, ' ')                       // 不间断空格
      .replace(/\n{3,}/g, '\n\n')                    // 多个空行压缩
      .trim();
  }

  // 从“最终回答文本”中尽量解析出多条建议
  function parseSuggestionsFromText(rawText) {
    if (!rawText) return [];
    const s = String(rawText).replace(/\r\n/g, '\n');

    // 首选：识别编号列表  1. xxx\n> yyy\n...(直到下一个编号或文本结束)
    const re = /^(\s*)(\d+)\.\s+(.+)$/gm;
    const matches = [];
    let m;
    while ((m = re.exec(s)) !== null) {
      matches.push({ index: m.index, title: m[3] || '' });
    }
    if (matches.length) {
      for (let i = 0; i < matches.length; i++) {
        const start = matches[i].index;
        const end = i + 1 < matches.length ? matches[i + 1].index : s.length;
        const seg = s.slice(start, end).trim();

        // 去掉首行的 "N. 标题"
        const nl = seg.indexOf('\n');
        const title = matches[i].title.trim();
        const body = nl >= 0 ? seg.slice(nl + 1) : '';

        // 优先取引用块（> 开头的行），否则用“标题 + 正文”
        const quoteLines = body.split('\n').filter(l => l.trim().startsWith('>'));
        const content = quoteLines.length
          ? quoteLines.map(l => l.replace(/^\s*>\s?/, '')).join('\n')
          : (title + (body ? '\n' + body : ''));

        const cleaned = stripMarkdown(content);
        if (cleaned) matches[i].text = cleaned;
      }
      return matches.map(x => x.text).filter(Boolean);
    }

    // 次选：如果存在“回复话术”标题，取其后的段落
    let body = s;
    const idx = s.indexOf('回复话术');
    if (idx >= 0) body = s.slice(idx + '回复话术'.length);

    // 按空行分段，过滤掉“客户问”
    const parts = body
      .split(/\n{2,}/)
      .map(p => stripMarkdown(p))
      .map(p => p.trim())
      .filter(p => p && !/^客户问[:：]/.test(p));

    // 合理限制最多 10 条
    return parts.slice(0, 10);
  }

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // 把多条建议渲染为多张卡片
  function renderSuggestions(items) {
    const list = document.getElementById('ai-suggestions');
    if (!list) return;

    // 如果没有可分段的内容，就给一条占位
    const arr = Array.isArray(items) && items.length ? items : ['（无内容）'];

    const html = arr.map((text, i) => {
      const safe = escapeHtml(text);
      return `
        <li class="ai-sug" data-style="默认" data-idx="${i}">
          <div class="title">建议 ${i + 1}</div>
          <div class="body" title="单击：粘贴到微信；双击：粘贴并发送">${safe}</div>
          <div class="editor" hidden>
            <textarea>${safe}</textarea>
          </div>
          <div class="ops">
            <button data-op="edit">编辑</button>
            <button data-op="save">保存到本地</button>
          </div>
        </li>
      `;
    }).join('');

    list.innerHTML = html;
  }

  // 保存到本地短语：归类到“默认”
  function savePhraseToLocal(style, text) {
    const content = normalizeText(text);
    if (!content) return { saved: false, reason: 'empty' };

    let data = null;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      data = raw ? JSON.parse(raw) : null;
    } catch {
      data = null;
    }
    if (!data || !Array.isArray(data.cats)) data = { cats: [] };

    let cat = data.cats.find(c => c.name === style);
    if (!cat) {
      cat = { name: style, items: [] };
      data.cats.push(cat);
    }

    const exists = cat.items.some(it => normalizeText(it) === content);
    if (exists) return { saved: false, reason: 'exists' };

    cat.items.push(content);

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {}

    try {
      window.dispatchEvent(new CustomEvent('ai:saved-phrase', {
        detail: { style, text: content }
      }));
    } catch {}
    return { saved: true };
  }

  async function requestAiRaw(ctx) {
    const prompt = String(ctx || '');
    try {
      const res = await ipcRenderer.invoke('ai:generate', {
        prompt // 原文直发，不附加任何提示词
      });
      if (!res) throw new Error('empty response');

      // 调试打印（渲染端）
      console.groupCollapsed('[AI] 调试（渲染端）');
      if (res.debug && res.debug.prompt) {
        console.log('提交给AI的最终 Prompt（原文）:\n', res.debug.prompt);
      } else {
        console.log('提交给AI的 Prompt（原文-渲染端）:\n', prompt);
      }
      if (res.debug && typeof res.debug.rawText === 'string') {
        console.log('AI 原始返回(assistant 全部拼接) length:', res.debug.rawText.length, '\n', res.debug.rawText);
      }
      if (res.debug && typeof res.debug.finalText === 'string') {
        console.log('最终用于展示的文本:\n', res.debug.finalText);
      }
      console.groupEnd();

      // 优先使用主进程给的最终文本
      const text = String(res.text || res.debug?.finalText || '');
      return normalizeText(text);
    } catch (e) {
      console.warn('ai:generate error:', e && e.message);
      return '';
    }
  }

  // 绑定交互（一次）
  function bindEventsOnce() {
    const btn = document.getElementById('ai-generate');
    const ta = document.getElementById('ai-context');
    const list = document.getElementById('ai-suggestions');
    if (!btn || !ta || !list) return;
    if (bindEventsOnce.bound) return;
    bindEventsOnce.bound = true;

    btn.addEventListener('click', async () => {
      const orig = btn.textContent;
      btn.disabled = true;
      btn.textContent = '生成中…';
      try {
        const finalText = await requestAiRaw(ta.value);

        // 解析为多条建议并渲染
        const items = parseSuggestionsFromText(finalText);
        renderSuggestions(items);

        // 成功返回并渲染后，清空输入框
        ta.value = '';
        try {
          ta.dispatchEvent(new Event('input', { bubbles: true }));
        } catch {}
      } finally {
        btn.disabled = false;
        btn.textContent = orig;
      }
    });

    // 操作按钮：编辑/保存修改、保存到本地
    list.addEventListener('click', (e) => {
      const opBtn = e.target.closest('button[data-op]');
      if (!opBtn) return;
      const li = e.target.closest('li.ai-sug');
      if (!li) return;
      const style = li.getAttribute('data-style') || '默认';
      const bodyEl = li.querySelector('.body');
      const editor = li.querySelector('.editor');
      const textarea = li.querySelector('.editor textarea');
      const op = opBtn.dataset.op;

      const currentText = !editor.hasAttribute('hidden') ? (textarea.value || '') : (bodyEl.textContent || '');

      if (op === 'edit') {
        if (editor.hasAttribute('hidden')) {
          editor.removeAttribute('hidden');
          textarea.value = bodyEl.textContent || '';
          bodyEl.setAttribute('hidden', 'hidden');
          opBtn.dataset.op = 'commit';
          opBtn.textContent = '保存修改';
          textarea.focus();
          textarea.setSelectionRange(textarea.value.length, textarea.value.length);
        } else {
          const val = normalizeText(textarea.value);
          bodyEl.textContent = val;
          bodyEl.removeAttribute('hidden');
          editor.setAttribute('hidden', 'hidden');
          opBtn.dataset.op = 'edit';
          opBtn.textContent = '编辑';
        }
        return;
      }

      if (op === 'commit') {
        const val = normalizeText(textarea.value);
        bodyEl.textContent = val;
        bodyEl.removeAttribute('hidden');
        editor.setAttribute('hidden', 'hidden');
        opBtn.dataset.op = 'edit';
        opBtn.textContent = '编辑';
        return;
      }

      if (op === 'save') {
        const result = savePhraseToLocal(style, currentText);
        opBtn.disabled = true;
        const txt = opBtn.textContent;
        opBtn.textContent = result.saved ? '已保存' : (result.reason === 'exists' ? '已存在' : '未保存');
        setTimeout(() => {
          opBtn.textContent = txt;
          opBtn.disabled = false;
        }, 900);
        return;
      }
    });

    // 单击/双击：正文区域（.body）
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
        ipcRenderer.send('phrase:paste', text); // 单击：粘贴
        singleTimer = null;
      }, SINGLE_CLICK_DELAY);
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
      ipcRenderer.send('phrase:paste-send', text); // 双击：粘贴并发送
    });
  }

  window.addEventListener('DOMContentLoaded', () => {
    bindEventsOnce();
    // 初始占位，避免空白
    renderSuggestions(['（这里将显示 AI 的原样回复，自动按 1. 2. 3. 等编号或段落拆分为多条）']);
  });
})();