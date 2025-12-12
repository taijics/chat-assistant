(function() {
  const {
    ipcRenderer
  } = require('electron');
  const SINGLE_CLICK_DELAY = 300;
  let reloadSpinStart = 0;

  /********* 宽限配置（新增） *********/
  const WECHAT_GRACE_MS = 6000; // 企业微信最近一次前台后，助手失去焦点的宽限
  let lastWechatForegroundAt = 0; // 最近一次确认企业微信前台的时间戳
  let lastOcrText = ''; // 上一次 OCR 结果（可选缓存，不做逻辑分支）

  /********* 简易 Toast *********/
  if (!window.showToast) {
    window.showToast = function(msg, {
      type = 'info',
      duration = 2000
    } = {}) {
      let box = document.getElementById('global-toast-box');
      if (!box) {
        box = document.createElement('div');
        box.id = 'global-toast-box';
        box.style.cssText =
          'position:fixed;bottom:28px;left:50%;transform:translateX(-50%);z-index:10000;display:flex;flex-direction:column;align-items:center;gap:10px;';
        document.body.appendChild(box);
      }
      const item = document.createElement('div');
      item.textContent = msg;
      item.style.cssText = `
        background:${type==='error'?'#e02424':'#333'};
        color:#fff;
        padding:8px 16px;
        border-radius:6px;
        font-size:13px;
        box-shadow:0 4px 16px rgba(0,0,0,.25);
        max-width:320px;
        word-break:break-word;
      `;
      box.appendChild(item);
      setTimeout(() => {
        item.style.opacity = '0';
        item.style.transition = 'opacity .3s';
        setTimeout(() => {
          item.remove();
          if (!box.childElementCount) box.remove();
        }, 320);
      }, duration);
    };
  }

  /********* 调试日志 *********/
  ipcRenderer.on('ai:debug-log', (_e, payload) => {
    try {
      const tag = payload && payload.tag ? `[${payload.tag}]` : '';
      console.groupCollapsed(`%cAI 调试 ${tag}`, 'color:#0a84ff');
      console.log(payload);
      console.groupEnd();
    } catch {}
  });

  /********* 工具 *********/
  function normalizeText(s) {
    return String(s || '').replace(/\r\n/g, '\n').trim();
  }

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /********* OCR（改：增加 _ts 避免缓存） *********/
  const http = require('http');

  function getWeChatOCRText(callback) {
    const url = "http://127.0.0.1:5678/screenshot_ocr?img=wecom.png&_ts=" + Date.now();
    http.get(url, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const obj = JSON.parse(data);
          callback(obj.status === "ok" ? obj.text : "截图或OCR失败");
        } catch (e) {
          callback("解析失败:" + e.message);
        }
      });
    }).on('error', err => callback('请求错误:' + err.message));
  }

  /********* 文本解析 *********/
  function stripMarkdown(s) {
    return String(s || '')
      .replace(/```[\s\S]*?```/g, '')
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/\*\*(.*?)\*\*/g, '$1')
      .replace(/\*(.*?)\*/g, '$1')
      .replace(/^>\s?/gm, '')
      .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\u00A0/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function parseSuggestionsFromText(raw) {
    if (!raw) return [];
    const s = String(raw).replace(/\r\n/g, '\n');
    const re = /^(\s*)(\d+)\.\s+(.+)$/gm;
    let m, matches = [];
    while ((m = re.exec(s)) !== null) matches.push({
      index: m.index,
      title: m[3] || ''
    });
    if (matches.length) {
      for (let i = 0; i < matches.length; i++) {
        const start = matches[i].index;
        const end = i + 1 < matches.length ? matches[i + 1].index : s.length;
        const seg = s.slice(start, end).trim();
        const nl = seg.indexOf('\n');
        const title = matches[i].title.trim();
        const body = nl >= 0 ? seg.slice(nl + 1) : '';
        const quoteLines = body.split('\n').filter(l => l.trim().startsWith('>'));
        const content = quoteLines.length ? quoteLines.map(l => l.replace(/^\s*>\s?/, '')).join('\n') :
          title + (body ? '\n' + body : '');
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

  /********* 渲染建议 *********/
  function renderSuggestions(items) {
    const list = document.getElementById('ai-suggestions');
    if (!list) return;
    const arr = Array.isArray(items) && items.length ? items : ['（无内容）'];
    list.innerHTML = arr.map((text, i) => {
      const safe = escapeHtml(text);
      return `<li class="ai-sug" data-idx="${i}">
        <div class="title">建议 ${i+1}</div>
        <div class="body" title="单击：粘贴；双击：粘贴并发送">${safe}</div>
        <div class="editor" hidden><textarea>${safe}</textarea></div>
        <div class="ops"><button data-op="edit">编辑</button></div>
      </li>`;
    }).join('');
  }

  /********* 请求 AI *********/
  // 请求 AI 前，在渲染端打印 prompt/ocrText 的长度，便于定位
   async function requestAiRaw(ctx, agentConfig) {
     try {
       const msg = String(ctx || '');
       try {
         console.log('[AI] requestAiRaw prompt_len=', msg.length, 'agentConfig(token masked)=', agentConfig ? { ...agentConfig, token: maskToken(agentConfig.token) } : null);
       } catch {}
       const res = await ipcRenderer.invoke('ai:generate', {
         prompt: msg,
         agentConfig
       });
       if (res?.debug?.error) {
         showToast && showToast('请求错误，请联系管理员', { type: 'error', duration: 1800 });
         return '';
       }
       const text = String(res?.text || res?.debug?.finalText || '');
       return normalizeText(text);
     } catch (e) {
       showToast && showToast('请求错误，请联系管理员', { type: 'error', duration: 1800 });
       return '';
     }
   }

  /********* 智能体相关（原样） *********/
  let aiAgents = [];
  let selectedAgentIdx = null;
  let loadingAgents = false;
  let agentInitialRequested = false;

  
// 新增：从登录态获取当前用户ID（按你后端实际字段名做多重兼容）

  // 新增：从登录态获取当前用户ID（按你后端实际字段名做多重兼容）
  function getCurrentUserId() {
    try {
      const u = (window.API && typeof API.getUser === 'function') ? API.getUser() : null;
      if (u) {
        const id = u.id || u.userId || u.uid || u.accountId || u.phone || u.username || u.name;
        if (id) return String(id).trim();
      }
    } catch {}
    try {
      const raw = localStorage.getItem('auth.user');
      if (raw) {
        const u = JSON.parse(raw);
        const id = u.id || u.userId || u.uid || u.accountId || u.phone || u.username || u.name;
        if (id) return String(id).trim();
      }
    } catch {}
    return '';
  }
  function isExpired(agent) {
    if (!agent || !agent.expire) return false;
    try {
      const today = new Date().toISOString().slice(0, 10);
      const expireStr = typeof agent.expire === 'string' ?
        agent.expire.slice(0, 10) :
        agent.expire.toISOString().slice(0, 10);
      return expireStr < today;
    } catch {
      return false;
    }
  }

  // 渲染端也打印一下将要发送的 agentConfig（打码 token）
  function maskToken(t='') { const s=String(t); return s ? (s.slice(0,4)+'…'+s.slice(-4)) : ''; }

  function getSelectedAgentConfig() {
    const a = aiAgents[selectedAgentIdx];
    if (!a) return null;
    const token = String(a.token || '').trim();
    const botId = String(a.botid || '').trim();
    const userId = getCurrentUserId();
    if (!userId) {
      showToast && showToast('未获取到用户ID，请先登录', { type: 'error', duration: 1500 });
      return null;
    }
    const cfg = { token, botId, userId };
    try {
      console.log('[AI] agentConfig ->', { ...cfg, token: maskToken(cfg.token) });
    } catch {}
    return cfg;
  }

  function updateAgentSelectedBtn() {
    const btn = document.getElementById('ai-agent-selected-btn');
    if (!btn) return;
    if (selectedAgentIdx == null || !aiAgents[selectedAgentIdx]) {
      btn.textContent = '智能体';
      btn.title = aiAgents.length ? '点击选择智能体' : '暂无智能体';
    } else {
      const ag = aiAgents[selectedAgentIdx];
      btn.textContent = ag.name;
      btn.title = (isExpired(ag) ? '已过期：' : '当前智能体：') + ag.name;
    }
  }

  function renderAIAgentDropdown() {
    const list = document.getElementById('ai-agent-dropdown-list');
    if (!list) return;
    if (loadingAgents) {
      list.innerHTML = '<li class="loading">加载中…</li>';
      return;
    }
    if (!aiAgents.length) {
      list.innerHTML = '<li class="empty">无智能体</li>';
      return;
    }
    list.innerHTML = aiAgents.map((a, i) => {
      const expired = isExpired(a);
      const sel = i === selectedAgentIdx ? 'selected' : '';
      return `<li class="${sel} ${expired?'expired':''}" data-idx="${i}" title="${expired?'已过期，无法选择':'点击选择'}">
        <span class="agent-name">${escapeHtml(a.name || ('智能体'+(i+1)))}</span>
        ${expired?'<span style="color:#e02424;font-size:12px;margin-left:6px;">已过期</span>':''}
      </li>`;
    }).join('');
  }

  function chooseDefaultAgent() {
    const idx = aiAgents.findIndex(a => !isExpired(a));
    selectedAgentIdx = idx >= 0 ? idx : null;
  }
  async function loadAgentsFromAPI() {
    if (loadingAgents) return;
    if (!window.API || !API.agent || typeof API.agent.listByMyTeam !== 'function') {
      console.log('[AI] API.agent.listByMyTeam 尚不可用，稍后再试');
      return;
    }
    loadingAgents = true;
    setReloadSpinning(true);
    renderAIAgentDropdown();
    console.log('[AI] 请求智能体列表 /api/front/agent/listByMyTeam');
    try {
      const resp = await API.agent.listByMyTeam();
      const list = (resp && resp.status === 'success' && Array.isArray(resp.data)) ? resp.data : [];
      aiAgents = (list || []).map(a => ({
        name: a.title || a.name || '智能体',
        token: a.kzToken || a.token || '',
        botid: a.botId || a.botid || '',
        expire: a.expireDate || a.expire || ''
      })).filter(x => x.token && x.botid);
      chooseDefaultAgent();
     
    } catch (e) {
      console.warn('[AI] 获取智能体失败:', e.message);
      aiAgents = [];
      selectedAgentIdx = null;
      showToast && showToast('刷新失败', {
        type: 'error',
        duration: 1000
      });
    } finally {
      loadingAgents = false;
      setReloadSpinning(false);
      updateAgentSelectedBtn();
      renderAIAgentDropdown();
    }
  }

  /********* 下拉交互 *********/
  let apiWaitCount = 0;

  function waitAPIThenLoad() {
    if (window.API && API.agent && typeof API.agent.listByMyTeam === 'function') {
      if (!agentInitialRequested) {
        agentInitialRequested = true;
        loadAgentsFromAPI();
      }
      return;
    }
    apiWaitCount++;
    if (apiWaitCount > 40) {
      console.warn('[AI] 等待 API 超时，无法请求智能体');
      updateAgentSelectedBtn();
      renderAIAgentDropdown();
      return;
    }
    setTimeout(waitAPIThenLoad, 50);
  }
  waitAPIThenLoad();

  document.getElementById('ai-agent-selected-btn')?.addEventListener('click', () => {
    const dd = document.getElementById('ai-agent-dropdown');
    if (!dd) return;
    dd.style.display = dd.style.display === 'block' ? 'none' : 'block';
    if (dd.style.display === 'block' && !aiAgents.length && !loadingAgents) loadAgentsFromAPI();
    renderAIAgentDropdown();
  });
  document.getElementById('ai-agent-reload-btn')?.addEventListener('click', () => {
    loadAgentsFromAPI();
    showToast && showToast('刷新成功', {
      type: 'success',
      duration: 1000
    });
  });

  document.addEventListener('click', (e) => {
    const dd = document.getElementById('ai-agent-dropdown');
    const btn = document.getElementById('ai-agent-selected-btn');
    if (!dd || dd.style.display !== 'block') return;
    if (dd.contains(e.target) || btn.contains(e.target)) return;
    dd.style.display = 'none';
  }, true);

  document.getElementById('ai-agent-dropdown-list')?.addEventListener('click', e => {
    const li = e.target.closest('li[data-idx]');
    if (!li) return;
    const idx = Number(li.dataset.idx);
    const ag = aiAgents[idx];
    if (!ag) return;
    if (isExpired(ag)) {
      showToast('智能体已过期，请联系管理员', {
        type: 'error',
        duration: 1800
      });
      return;
    }
    selectedAgentIdx = idx;
    updateAgentSelectedBtn();
    document.getElementById('ai-agent-dropdown').style.display = 'none';
  });

  /********* 建议区事件 *********/
  function bindSuggestionEvents() {
    const list = document.getElementById('ai-suggestions');
    if (!list || bindSuggestionEvents.bound) return;
    bindSuggestionEvents.bound = true;

    list.addEventListener('click', (e) => {
      const opBtn = e.target.closest('button[data-op]');
      if (opBtn) {
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
        return;
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
      ipcRenderer.send('phrase:paste-send', text);
    });
  }

  function setReloadSpinning(flag) {
    const btn = document.getElementById('ai-agent-reload-btn');
    if (!btn) return;
    if (flag) {
      reloadSpinStart = Date.now();
      btn.classList.add('spinning');
      btn.disabled = true;
    } else {
      const elapsed = Date.now() - reloadSpinStart;
      const remain = 300 - elapsed;
      const stop = () => {
        btn.classList.remove('spinning');
        btn.disabled = false;
      };
      if (remain > 0) setTimeout(stop, remain);
      else stop();
    }
  }

  /********* 生成按钮（改：前台宽限 + 截图重试） *********/
  function bindGenerate() {
    const btn = document.getElementById('ai-generate');
    const ta = document.getElementById('ai-context');
    if (!btn || !ta || bindGenerate.bound) return;
    bindGenerate.bound = true;

    function doScreenshotOCR() {
      return new Promise(resolve => {
        getWeChatOCRText(text => {
          const cleaned = normalizeText(text);
          if (
            cleaned &&
            !/^截图|OCR|解析失败|请求错误|OCR ERROR/i.test(cleaned) &&
            cleaned.replace(/\s+/g, '').length >= 4
          ) {
            resolve(cleaned);
          } else {
            resolve(null);
          }
        });
      });
    }

    btn.addEventListener('click', async () => {
      const orig = btn.textContent;
      btn.disabled = true;
      try {
        const agentConfig = getSelectedAgentConfig();
        if (!agentConfig) {
          showToast('未选择智能体', {
            type: 'error',
            duration: 1000
          });
          return;
        }

        // 精确吸附判定
        const isDocked = await ipcRenderer.invoke('wechat:is-docked').catch(() => false);
        console.log('[AI] isDocked =', isDocked);

        if (isDocked) {
          // 吸附 -> 截图
          btn.textContent = '截图中…';
          let ocrText = await doScreenshotOCR();
          if (!ocrText) {
            await new Promise(r => setTimeout(r, 250));
            ocrText = await doScreenshotOCR();
          }
          if (!ocrText) {
            showToast('截图/OCR失败', {
              type: 'error',
              duration: 1200
            });
            return;
          }
          ta.value = ocrText;
          try {
            ta.dispatchEvent(new Event('input', {
              bubbles: true
            }));
          } catch {}

          btn.textContent = '生成中…';
          const ans = await requestAiRaw(ocrText, agentConfig);
          renderSuggestions(parseSuggestionsFromText(ans));
        } else {
          // 未吸附 -> 输入框
          const ctx = normalizeText(ta.value);
          if (!ctx) {
            showToast('助手未吸附企业微信：请贴靠企业微信窗口或手动输入内容', {
              type: 'error',
              duration: 1400
            });
            return;
          }
          btn.textContent = '生成中…';
          const ans = await requestAiRaw(ctx, agentConfig);
          renderSuggestions(parseSuggestionsFromText(ans));
        }
      } finally {
        btn.disabled = false;
        btn.textContent = orig;
      }
    });
  }
  
  // 新增：直接生成按钮（不截图不判断吸附）
  function bindDirectGenerate() {
    const btn = document.getElementById('ai-zhijie-generate');
    const ta = document.getElementById('ai-context');
    if (!btn || !ta || bindDirectGenerate.bound) return;
    bindDirectGenerate.bound = true;
  
    btn.addEventListener('click', async () => {
      const orig = btn.textContent;
      btn.disabled = true;
      try {
        // 取智能体配置（与截图按钮一致）
        const agentConfig = getSelectedAgentConfig();
        if (!agentConfig) {
          showToast && showToast('未选择智能体', { type: 'error', duration: 1000 });
          return;
        }
  
        // 直接读取输入框内容
        const ctx = normalizeText(ta.value);
        if (!ctx) {
          showToast && showToast('请输入问题或聊天内容', { type: 'error', duration: 1200 });
          return;
        }
  
        btn.textContent = '生成中…';
        const ans = await requestAiRaw(ctx, agentConfig);
        renderSuggestions(parseSuggestionsFromText(ans));
      } finally {
        btn.disabled = false;
        btn.textContent = orig;
      }
    });
  }
  /********* 登录 / 菜单事件 *********/
  window.addEventListener('auth:login', () => {
    loadAgentsFromAPI();
  });
  window.addEventListener('auth:logout', () => {
    aiAgents = [];
    selectedAgentIdx = null;
    updateAgentSelectedBtn();
    renderAIAgentDropdown();
  });
  ipcRenderer.on('menu:switch-tab', (_e, tab) => {
    if (tab === 'ai') {
      if (!aiAgents.length && !loadingAgents) loadAgentsFromAPI();
    }
  });

  /********* 初始化 *********/
  window.addEventListener('DOMContentLoaded', () => {
    document.getElementById('ai-agent-add-btn')?.remove();
    document.querySelectorAll('.agent-edit-btn,.agent-delete-btn,#ai-agent-modal,#ai-agent-confirm-modal')
      .forEach(el => el.remove());

    bindGenerate();
    bindDirectGenerate();
    bindSuggestionEvents();
    renderSuggestions(['（这里将显示 AI 的原样回复，自动拆分）']);

    if (window.API && API.agent && typeof API.agent.listByMyTeam === 'function' && !agentInitialRequested) {
      agentInitialRequested = true;
      loadAgentsFromAPI();
    }
  });
})();