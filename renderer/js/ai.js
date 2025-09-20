(function() {
  const {
    ipcRenderer
  } = require('electron');
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  // 7 种风格
  const STYLES = ['正式', '简短', '友好', '幽默', '致歉', '专业', '文艺'];
  // 与本地短语存储一致
  const STORAGE_KEY = 'phrases.data.v1';
  // 单击/双击判定窗口
  const SINGLE_CLICK_DELAY = 300;

  // 组装提示词（接口请求参数）
  function buildPrompt(ctx) {
    const context = (ctx || '').trim();
    return `
你是一个中文写作助手。基于以下上下文生成 7 条不同风格的简短中文回复，风格为：${STYLES.join('、')}。
要求：
- 直击要点，避免冗余，简洁但完整
- 用词自然，不要出现风格名本身
- 输出 JSON 对象，不要包含任何额外文字
- JSON 的键必须是：${STYLES.map(s => `"${s}"`).join(', ')}
- 每个键的值是一条字符串回复

上下文：
${context || '（无）'}
`.trim();
  }

  // 占位本地生成（接口未接好时的回退）
  function localFallbackGenerate(ctx) {
    const base = (ctx || '').trim() || '（示例上下文：客户咨询发货时间）';
    return {
      '正式': `您好，关于“${base}”，我们已受理并将尽快跟进处理，稍后会向您同步进展。感谢理解与支持。`,
      '简短': `收到“${base}”，我们马上处理，有结果第一时间回复。`,
      '友好': `收到啦～关于“${base}”，我们这边已经安排处理，有进展会及时告诉您～`,
      '幽默': `关于“${base}”，小助手已火速出击（比外卖还快）🚀，很快带回好消息！`,
      '致歉': `抱歉让您久等了。关于“${base}”，我们已在加急处理中，会尽快给到明确反馈。`,
      '专业': `针对“${base}”已提交至相关流程处理，预计需完成确认和复核后反馈，届时会第一时间与您同步。`,
      '文艺': `“${base}”，已被置于待办清单的醒目一行。很快便有回响，敬请期待。`
    };
  }

  // 调用接口（若主进程实现了 ai:generate），否则回退
  async function requestAiSuggestions(ctx) {
    const prompt = buildPrompt(ctx);
    try {
      const res = await ipcRenderer.invoke('ai:generate', {
        prompt,
        context: ctx || '',
        styles: STYLES,
        expect: 'json'
      });
      if (!res) throw new Error('empty response');
      let obj = null;
      if (typeof res === 'object' && !Array.isArray(res)) {
        if (res.data && typeof res.data === 'object') obj = res.data;
        else if (typeof res.text === 'string') {
          try {
            obj = JSON.parse(res.text);
          } catch {}
        } else {
          obj = res;
        }
      } else if (typeof res === 'string') {
        try {
          obj = JSON.parse(res);
        } catch {}
      }
      return sanitizeResult(obj) || localFallbackGenerate(ctx);
    } catch (e) {
      console.warn('ai:generate fallback:', e && e.message);
      return localFallbackGenerate(ctx);
    }
  }

  function sanitizeResult(obj) {
    const out = {};
    STYLES.forEach(s => {
      out[s] = (obj && (obj[s] || obj[String(s)])) || '';
    });
    return out;
  }

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function renderList(map) {
    const list = document.getElementById('ai-suggestions');
    if (!list) return;

    const html = STYLES.map(style => {
      const text = (map && map[style]) || '';
      return `
        <li class="ai-sug" data-style="${style}">
          <div class="title">${style}</div>
          <div class="body" title="单击：粘贴到微信；双击：粘贴并发送">${escapeHtml(text)}</div>
          <div class="editor" hidden>
            <textarea>${escapeHtml(text)}</textarea>
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

  // 规范化文本用于查重
  function normalizeText(s) {
    return String(s || '').replace(/\r\n/g, '\n').trim();
  }

  // 保存到本地短语：类别=风格；存在则不保存并返回 exists
  function savePhraseToLocal(style, text) {
    const content = normalizeText(text);
    if (!content) return {
      saved: false,
      reason: 'empty'
    };

    let data = null;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      data = raw ? JSON.parse(raw) : null;
    } catch {
      data = null;
    }
    if (!data || !Array.isArray(data.cats)) data = {
      cats: []
    };

    let cat = data.cats.find(c => c.name === style);
    if (!cat) {
      cat = {
        name: style,
        items: []
      };
      data.cats.push(cat);
    }

    const exists = cat.items.some(it => normalizeText(it) === content);
    if (exists) return {
      saved: false,
      reason: 'exists'
    };

    cat.items.push(content);

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {}

    // 通知“本地短语”刷新（并携带风格）
    try {
      window.dispatchEvent(new CustomEvent('ai:saved-phrase', {
        detail: {
          style,
          text: content
        }
      }));
    } catch {}
    return {
      saved: true
    };
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
        const result = await requestAiSuggestions(ta.value);
        renderList(result);
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
      const style = li.dataset.style;
      const bodyEl = li.querySelector('.body');
      const editor = li.querySelector('.editor');
      const textarea = li.querySelector('.editor textarea');
      const op = opBtn.dataset.op;

      // 当前文本（编辑中取 textarea，否则取 body）
      const currentText = !editor.hasAttribute('hidden') ? (textarea.value || '') : (bodyEl.textContent || '');

      if (op === 'edit') {
        // 切换为编辑态（或保存修改）
        if (editor.hasAttribute('hidden')) {
          editor.removeAttribute('hidden');
          textarea.value = bodyEl.textContent || '';
          bodyEl.setAttribute('hidden', 'hidden');
          opBtn.dataset.op = 'commit';
          opBtn.textContent = '保存修改';
          textarea.focus();
          textarea.setSelectionRange(textarea.value.length, textarea.value.length);
        } else {
          // 保存修改，回到展示态
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
        // 保存修改，回到展示态
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
        // 简单提示（非阻塞）
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

    // 单击/双击：仅对正文区域（.body）生效，避免与按钮、编辑器互相干扰
    let singleTimer = null;

    list.addEventListener('click', (e) => {
      const body = e.target.closest('.ai-sug .body');
      if (!body) return;
      // 正在编辑时不处理
      const li = body.closest('li.ai-sug');
      if (!li) return;
      const editor = li.querySelector('.editor');
      if (editor && !editor.hasAttribute('hidden')) return;

      const text = body.textContent || '';
      if (!normalizeText(text)) return;

      clearTimeout(singleTimer);
      singleTimer = setTimeout(() => {
        ipcRenderer.send('phrase:paste', text); // 单击：只粘贴
        singleTimer = null;
      }, SINGLE_CLICK_DELAY);
    });

    list.addEventListener('dblclick', (e) => {
      const body = e.target.closest('.ai-sug .body');
      if (!body) return;
      const li = body.closest('li.ai-sug');
      if (!li) return;
      const editor = li.querySelector('.editor');
      if (editor && !editor.hasAttribute('hidden')) return;

      const text = body.textContent || '';
      if (!normalizeText(text)) return;

      if (singleTimer) {
        clearTimeout(singleTimer);
        singleTimer = null;
      }
      ipcRenderer.send('phrase:paste-send', text); // 双击：粘贴并发送（仅一次）
    });
  }

  window.addEventListener('DOMContentLoaded', () => {
    bindEventsOnce();
    // 初始渲染一组本地占位建议
    renderList(localFallbackGenerate(''));
  });
})();