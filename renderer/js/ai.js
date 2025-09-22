(function() {
  const {
    ipcRenderer
  } = require('electron');

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
      .replace(/```[\s\S]*?```/g, '') // 三引号代码块
      .replace(/^#{1,6}\s+/gm, '') // 标题
      .replace(/\*\*(.*?)\*\*/g, '$1') // 粗体
      .replace(/\*(.*?)\*/g, '$1') // 斜体
      .replace(/^>\s?/gm, '') // 引用前缀
      .replace(/!\[[^\]]*\]\([^)]+\)/g, '') // 图片
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // 链接
      .replace(/`([^`]+)`/g, '$1') // 行内代码
      .replace(/[ \t]+\n/g, '\n') // 尾随空格
      .replace(/\u00A0/g, ' ') // 不间断空格
      .replace(/\n{3,}/g, '\n\n') // 多个空行压缩
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

        // 去掉首行的 "N. 标题"
        const nl = seg.indexOf('\n');
        const title = matches[i].title.trim();
        const body = nl >= 0 ? seg.slice(nl + 1) : '';

        // 优先取引用块（> 开头的行），否则用“标题 + 正文”
        const quoteLines = body.split('\n').filter(l => l.trim().startsWith('>'));
        const content = quoteLines.length ?
          quoteLines.map(l => l.replace(/^\s*>\s?/, '')).join('\n') :
          (title + (body ? '\n' + body : ''));

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
          ta.dispatchEvent(new Event('input', {
            bubbles: true
          }));
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

  // 新增交互
  const categoryBar = document.getElementById('ai-category-bar');
  const customerPopup = document.getElementById('ai-customer-list-popup');
  const customerList = document.getElementById('ai-customer-list');
  const customerSearch = document.getElementById('ai-customer-search');
  const chatHistory = document.getElementById('ai-chat-history');
  const aiContext = document.getElementById('ai-context');

  // 假数据：可替换为数据库读取
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
    // 其它略...
  };

  let selectedCategory = '';
  let filteredCustomerList = [];
  let selectedCustomerId = '';

  // 类别栏点击
  categoryBar.addEventListener('click', (e) => {
    const btn = e.target.closest('.ai-cat-btn');
    if (!btn) return;

    // 激活按钮
    [...categoryBar.querySelectorAll('.ai-cat-btn')].forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedCategory = btn.dataset.cat;

    // 筛选客户
    filteredCustomerList = customers.filter(c => c.category === selectedCategory);
    renderCustomerList(filteredCustomerList);
    customerPopup.style.display = 'block';
    selectedCustomerId = '';
    chatHistory.innerHTML = '';
  });

  // 客户模糊搜索
  customerSearch.addEventListener('input', () => {
    const kw = customerSearch.value.trim();
    let list = filteredCustomerList;
    if (kw) list = list.filter(c => c.nickname.includes(kw));
    renderCustomerList(list);
  });

  // 客户列表点击
  customerList.addEventListener('click', (e) => {
    const li = e.target.closest('li');
    if (!li) return;
    [...customerList.children].forEach(n => n.classList.remove('active'));
    li.classList.add('active');
    selectedCustomerId = li.dataset.id;

    // 展示聊天历史
    renderChatHistory(selectedCustomerId);
    customerPopup.style.display = 'none';
  });

  function renderCustomerList(list) {
    // 先定义所有类别和圈字
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
      // 只显示不属于当前类别的三个圈
      const icons = categories
        .filter(cat => cat.label !== selectedCategory)
        .map(cat =>
          `<button class="circle-btn" data-action="set-cat" data-cat="${cat.label}" title="设为${cat.text}">${cat.text}</button>`
        ).join('');
      return `<li data-id="${c.id}">
      ${c.nickname}
      <span class="circle-btns">${icons}</span>
    </li>`;
    }).join('');
  }

  function renderChatHistory(customerId) {
    const msgs = messages[customerId] || [];
    chatHistory.innerHTML = msgs.map(m =>
      `<div><span style="color:#0078ff">${m.sender}</span> <span style="color:#aaa">${m.time}</span><br>${m.content}</div>`
    ).join('');
  }
  // 监听全局点击事件，自动收起弹窗
  document.addEventListener('click', function(e) {
    const popup = document.getElementById('ai-customer-list-popup');
    const categoryBar = document.getElementById('ai-category-bar');
    // 如果弹窗未显示，忽略
    if (!popup || popup.style.display === 'none') return;

    // 判断点击是否在弹窗或类别栏内
    const isInPopup = popup.contains(e.target);
    const isInBar = categoryBar.contains(e.target);

    if (!isInPopup && !isInBar) {
      popup.style.display = 'none';
    }
  });
  // AI请求时拼接上下文
  document.getElementById('ai-generate').addEventListener('click', async () => {
    if (!selectedCustomerId) {
      alert('请先选择客户！');
      return;
    }
    const ctxMsgs = messages[selectedCustomerId] || [];
    const context = ctxMsgs.map(m => `${m.sender}: ${m.content}`).join('\n');
    aiContext.value = context + '\n' + (aiContext.value || '');
    // 触发已有AI生成流程...
    // 这里可进一步集成你的AI接口
  });

  // 初始渲染（可选）
  customerPopup.style.display = 'none';




  // 客户列表点击（加类别切换）
  customerList.addEventListener('click', (e) => {
    const btn = e.target.closest('.circle-btn');
    if (btn) {
      const li = btn.closest('li');
      if (!li) return;
      const customerId = li.dataset.id;
      const newCat = btn.dataset.cat;
      // 假数据，实际应更新数据库
      const customer = customers.find(c => c.id === customerId);
      if (customer) {
        customer.category = newCat;
        // 重新筛选并渲染
        filteredCustomerList = customers.filter(c => c.category === selectedCategory);
        renderCustomerList(filteredCustomerList);
      }
      return;
    }

    // 选中客户昵称
    const li = e.target.closest('li');
    if (!li) return;
    // 选中样式
    [...customerList.children].forEach(n => n.classList.remove('active'));
    li.classList.add('active');
    selectedCustomerId = li.dataset.id;

    // 只显示当前聊天对象昵称，不展示聊天历史
    const customer = customers.find(c => c.id === selectedCustomerId);
    if (customer) {
      chatHistory.innerHTML = `<div style="font-size:16px;font-weight:bold;">当前聊天对象：${customer.nickname}</div>`;
    } else {
      chatHistory.innerHTML = '';
    }

    // 关闭弹窗
    customerPopup.style.display = 'none';
  });


  window.addEventListener('DOMContentLoaded', () => {
    bindEventsOnce();
    // 初始占位，避免空白
    renderSuggestions(['（这里将显示 AI 的原样回复，自动按 1. 2. 3. 等编号或段落拆分为多条）']);
  });
})();