(function() {
  const {
    ipcRenderer
  } = require('electron');
  const STORAGE_KEY = 'phrases.data.v1';
  const SINGLE_CLICK_DELAY = 300;

  // 调试信息
  ipcRenderer.on('ai:debug-log', (_e, payload) => {
    try {
      const tag = payload && payload.tag ? `[${payload.tag}]` : '';
      console.groupCollapsed(`%cAI 调试 ${tag}`, 'color:#0a84ff');
      console.log(payload);
      if (payload && typeof payload.prompt === 'string') {
        console.log('提交给 AI 的最终 Prompt（原文）:\n', payload.prompt);
      }
      if (payload && typeof payload.rawText === 'string') {
        console.log('AI 原始返回 length:', payload.rawText.length, '\n', payload.rawText);
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

  function parseSuggestionsFromText(rawText) {
    if (!rawText) return [];
    const s = String(rawText).replace(/\r\n/g, '\n');
    const re = /^(\s*)(\d+)\.\s+(.+)$/gm;
    const matches = [];
    let m;
    while ((m = re.exec(s)) !== null) {
      matches.push({
        index: m.index,
        title: m[3] || ''
      });
    }
    if (matches.length) {
      for (let i = 0; i < matches.length; i++) {
        const start = matches[i].index;
        const end = i + 1 < matches.length ? matches[i + 1].index : s.length;
        const seg = s.slice(start, end).trim();
        const nl = seg.indexOf('\n');
        const title = matches[i].title.trim();
        const body = nl >= 0 ? seg.slice(nl + 1) : '';
        const quoteLines = body.split('\n').filter(l => l.trim().startsWith('>'));
        const content = quoteLines.length ?
          quoteLines.map(l => l.replace(/^\s*>\s?/, '')).join('\n') :
          (title + (body ? '\n' + body : ''));
        const cleaned = stripMarkdown(content);
        if (cleaned) matches[i].text = cleaned;
      }
      return matches.map(x => x.text).filter(Boolean);
    }
    let body = s;
    const idx = s.indexOf('回复话术');
    if (idx >= 0) body = s.slice(idx + '回复话术'.length);
    const parts = body
      .split(/\n{2,}/)
      .map(p => stripMarkdown(p))
      .map(p => p.trim())
      .filter(p => p && !/^客户问[:：]/.test(p));
    return parts.slice(0, 10);
  }

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function renderSuggestions(items) {
    const list = document.getElementById('ai-suggestions');
    if (!list) return;
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

  async function requestAiRaw(ctx, agentConfig) {
    const prompt = String(ctx || '');
    try {
      const res = await ipcRenderer.invoke('ai:generate', {
        prompt,
        agentConfig
      });
      if (!res) throw new Error('empty response');
      const text = String(res.text || res.debug?.finalText || '');
      return normalizeText(text);
    } catch (e) {
      console.warn('ai:generate error:', e && e.message);
      return '';
    }
  }

  function getSelectedAgentConfig() {
    if (typeof selectedAgentIdx === 'number' && aiAgents[selectedAgentIdx]) {
      const agent = aiAgents[selectedAgentIdx];
      return {
        token: agent.token,
        botId: agent.botid,
        userId: '123456789'
      };
    }
    return null;
  }

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
        const agentConfig = getSelectedAgentConfig();
        const finalText = await requestAiRaw(ta.value, agentConfig);
        const items = parseSuggestionsFromText(finalText);
        renderSuggestions(items);
        ta.value = '';
        try {
          ta.dispatchEvent(new Event('input', {
            bubbles: true
          }));
        } catch {}
      } finally {
        btn.disabled = false;
        btn.textContent = orig;
      }
    });

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

  // AI分类客户
  const categoryBar = document.getElementById('ai-category-bar');
  const customerPopup = document.getElementById('ai-customer-list-popup');
  const customerList = document.getElementById('ai-customer-list');
  const customerSearch = document.getElementById('ai-customer-search');
  const chatHistory = document.getElementById('ai-chat-history');
  const aiContext = document.getElementById('ai-context');

  const customers = [{
      id: '1',
      nickname: '张三',
      category: '咨询中'
    },
    {
      id: '2',
      nickname: '李四',
      category: '已成交'
    },
    {
      id: '3',
      nickname: '王五',
      category: '已结束'
    },
    {
      id: '4',
      nickname: '赵六',
      category: '退款中'
    },
    {
      id: '5',
      nickname: '小明',
      category: '咨询中'
    },
  ];
  const messages = {
    '1': [{
        sender: '张三',
        time: '2025-09-21 13:23',
        content: '你好，请问……'
      },
      {
        sender: '我',
        time: '2025-09-21 13:24',
        content: '欢迎咨询'
      }
    ],
    '2': [{
        sender: '李四',
        time: '2025-09-20 11:01',
        content: '付款已完成'
      },
      {
        sender: '我',
        time: '2025-09-20 11:03',
        content: '感谢您的支持'
      }
    ]
    // ...
  };

  let selectedCategory = '';
  let filteredCustomerList = [];
  let selectedCustomerId = '';

  categoryBar.addEventListener('click', (e) => {
    const btn = e.target.closest('.ai-cat-btn');
    if (!btn) return;
    [...categoryBar.querySelectorAll('.ai-cat-btn')].forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedCategory = btn.dataset.cat;
    filteredCustomerList = customers.filter(c => c.category === selectedCategory);
    renderCustomerList(filteredCustomerList);
    customerPopup.style.display = 'block';
    selectedCustomerId = '';
    chatHistory.innerHTML = '';
  });

  customerSearch.addEventListener('input', () => {
    const kw = customerSearch.value.trim();
    let list = filteredCustomerList;
    if (kw) list = list.filter(c => c.nickname.includes(kw));
    renderCustomerList(list);
  });

  function renderCustomerList(list) {
    const categories = [{
        label: "咨询中",
        text: "询"
      },
      {
        label: "已成交",
        text: "成"
      },
      {
        label: "退款中",
        text: "退"
      },
      {
        label: "已结束",
        text: "完"
      }
    ];
    customerList.innerHTML = list.map(c => {
      const icons = categories
        .filter(cat => cat.label !== selectedCategory)
        .map(cat =>
          `<button class="circle-btn" data-action="set-cat" data-cat="${cat.label}" title="设为${cat.text}">${cat.text}</button>`
        ).join('');
      return `<li data-id="${c.id}">${c.nickname}<span class="circle-btns">${icons}</span></li>`;
    }).join('');
  }

  function renderChatHistory(customerId) {
    const msgs = messages[customerId] || [];
    chatHistory.innerHTML = msgs.map(m =>
      `<div><span style="color:#0078ff">${m.sender}</span> <span style="color:#aaa">${m.time}</span><br>${m.content}</div>`
    ).join('');
  }

  document.addEventListener('click', function(e) {
    const popup = document.getElementById('ai-customer-list-popup');
    const categoryBar = document.getElementById('ai-category-bar');
    if (!popup || popup.style.display === 'none') return;
    const isInPopup = popup.contains(e.target);
    const isInBar = categoryBar.contains(e.target);
    if (!isInPopup && !isInBar) {
      popup.style.display = 'none';
    }
  });

  document.getElementById('ai-generate').addEventListener('click', async () => {
    const ctxMsgs = messages[selectedCustomerId] || [];
    const context = ctxMsgs.map(m => `${m.sender}: ${m.content}`).join('\n');
    aiContext.value = context + '\n' + (aiContext.value || '');
    // 触发已有AI生成流程...
  });

  customerPopup.style.display = 'none';

  customerList.addEventListener('click', (e) => {
    const btn = e.target.closest('.circle-btn');
    if (btn) {
      const li = btn.closest('li');
      if (!li) return;
      const customerId = li.dataset.id;
      const newCat = btn.dataset.cat;
      const customer = customers.find(c => c.id === customerId);
      if (customer) {
        customer.category = newCat;
        filteredCustomerList = customers.filter(c => c.category === selectedCategory);
        renderCustomerList(filteredCustomerList);
      }
      return;
    }
    const li = e.target.closest('li');
    if (!li) return;
    [...customerList.children].forEach(n => n.classList.remove('active'));
    li.classList.add('active');
    selectedCustomerId = li.dataset.id;
    const customer = customers.find(c => c.id === selectedCustomerId);
    if (customer) {
      chatHistory.innerHTML = `<div style="font-size:16px;font-weight:bold;">当前聊天对象：${customer.nickname}</div>`;
    } else {
      chatHistory.innerHTML = '';
    }
    customerPopup.style.display = 'none';
  });

  // 智能体管理
  let aiAgents = [];
  let selectedAgentIdx = null;
  let deleteAgentIdx = null;

  function renderAIAgentDropdown() {
    const list = document.getElementById('ai-agent-dropdown-list');
    if (!list) return;
    const today = new Date().toISOString().slice(0, 10);
    list.innerHTML = aiAgents.map((agent, idx) => {
      const expired = agent.expire && agent.expire < today;
      const selected = selectedAgentIdx == idx ? "selected" : "";
      return `
        <li class="${selected} ${expired ? 'expired' : ''}" data-idx="${idx}">
          <span class="agent-name">${agent.name}</span>
          <span class="agent-actions">
            <button class="agent-edit-btn" title="编辑">✎</button>
            <button class="agent-delete-btn" title="删除">×</button>
          </span>
        </li>`;
    }).join('');
  }

  function updateAgentSelectedBtn() {
    const btn = document.getElementById('ai-agent-selected-btn');
    if (!btn) return;
    if (selectedAgentIdx == null || !aiAgents[selectedAgentIdx]) {
      btn.textContent = "智能体";
    } else {
      btn.textContent = aiAgents[selectedAgentIdx].name;
    }
  }

  function showAgentDropdown() {
    document.getElementById('ai-agent-dropdown').style.display = "block";
    renderAIAgentDropdown();
  }

  function hideAgentDropdown() {
    document.getElementById('ai-agent-dropdown').style.display = "none";
  }

  function showAgentModal(mode, idx = null) {
    const modal = document.getElementById('ai-agent-modal');
    const title = document.getElementById('ai-agent-modal-title');
    const inputName = document.getElementById('ai-agent-input-name');
    const inputToken = document.getElementById('ai-agent-input-token');
    const inputBotId = document.getElementById('ai-agent-input-botid');
    const inputExpire = document.getElementById('ai-agent-input-expire');
    if (mode === 'add') {
      title.textContent = '添加智能体';
      inputName.value = '';
      inputToken.value = '';
      inputBotId.value = '';
      inputExpire.value = '';
      modal.dataset.mode = 'add';
      modal.dataset.idx = '';
    } else if (mode === 'edit') {
      const agent = aiAgents[idx];
      title.textContent = '编辑智能体';
      inputName.value = agent.name || '';
      inputToken.value = agent.token || '';
      inputBotId.value = agent.botid || '';
      inputExpire.value = agent.expire || '';
      modal.dataset.mode = 'edit';
      modal.dataset.idx = idx;
    }
    modal.style.display = 'flex';
  }

  function hideAgentModal() {
    const modal = document.getElementById('ai-agent-modal');
    modal.style.display = 'none';
    modal.dataset.mode = '';
    modal.dataset.idx = '';
  }

  function showAgentConfirmModal(idx) {
    deleteAgentIdx = idx;
    document.getElementById('ai-agent-confirm-modal').style.display = 'flex';
  }

  function hideAgentConfirmModal() {
    deleteAgentIdx = null;
    document.getElementById('ai-agent-confirm-modal').style.display = 'none';
  }

  document.getElementById('ai-agent-selected-btn').onclick = function() {
    const dropdown = document.getElementById('ai-agent-dropdown');
    dropdown.style.display === "block" ? hideAgentDropdown() : showAgentDropdown();
  };

  document.addEventListener('click', function(e) {
    const dropdown = document.getElementById('ai-agent-dropdown');
    const btn = document.getElementById('ai-agent-selected-btn');
    if (!dropdown || dropdown.style.display !== "block") return;
    if (dropdown.contains(e.target) || btn.contains(e.target)) return;
    hideAgentDropdown();
  }, true);

  document.getElementById('ai-agent-dropdown-list').onclick = function(e) {
    const li = e.target.closest('li[data-idx]');
    if (!li) return;
    const idx = li.dataset.idx;
    if (e.target.classList.contains('agent-edit-btn')) {
      hideAgentDropdown();
      showAgentModal('edit', idx);
      return;
    }
    if (e.target.classList.contains('agent-delete-btn')) {
      showAgentConfirmModal(idx);
      return;
    }
    selectedAgentIdx = Number(idx);
    updateAgentSelectedBtn();
    hideAgentDropdown();
  };

  document.getElementById('ai-agent-add-btn').onclick = function() {
    hideAgentDropdown();
    showAgentModal('add');
  };

  document.getElementById('ai-agent-modal-ok').onclick = function() {
    const modal = document.getElementById('ai-agent-modal');
    const mode = modal.dataset.mode;
    const idx = modal.dataset.idx;
    const name = document.getElementById('ai-agent-input-name').value.trim();
    const token = document.getElementById('ai-agent-input-token').value.trim();
    const botid = document.getElementById('ai-agent-input-botid').value.trim();
    const expire = document.getElementById('ai-agent-input-expire').value;
    if (!name || !token || !botid || !expire) {
      alert('请填写完整信息');
      return;
    }
    if (mode === 'add') {
      aiAgents.push({
        name,
        token,
        botid,
        expire
      });
      selectedAgentIdx = aiAgents.length - 1;
    } else if (mode === 'edit' && idx !== '') {
      aiAgents[idx] = {
        name,
        token,
        botid,
        expire
      };
      selectedAgentIdx = Number(idx);
    }
    localStorage.setItem('aiAgents', JSON.stringify(aiAgents));
    updateAgentSelectedBtn();
    hideAgentModal();
  };

  document.getElementById('ai-agent-modal-cancel').onclick = hideAgentModal;

  document.getElementById('ai-agent-confirm-ok').onclick = function() {
    if (deleteAgentIdx != null) {
      aiAgents.splice(deleteAgentIdx, 1);
      if (selectedAgentIdx == deleteAgentIdx) selectedAgentIdx = null;
      else if (selectedAgentIdx > deleteAgentIdx) selectedAgentIdx--;
      localStorage.setItem('aiAgents', JSON.stringify(aiAgents));
      updateAgentSelectedBtn();
      renderAIAgentDropdown();
    }
    hideAgentConfirmModal();
  };

  document.getElementById('ai-agent-confirm-cancel').onclick = hideAgentConfirmModal;

  window.addEventListener('DOMContentLoaded', () => {
    const agents = localStorage.getItem('aiAgents');
    if (agents) aiAgents = JSON.parse(agents);
    updateAgentSelectedBtn();
    renderAIAgentDropdown();
    bindEventsOnce();
    renderSuggestions(['（这里将显示 AI 的原样回复，自动按 1. 2. 3. 等编号或段落拆分为多条）']);
  });
})();