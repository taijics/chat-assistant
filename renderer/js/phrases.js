(function () {
  const { ipcRenderer } = require('electron');
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const STORAGE_KEY = 'phrases.data.v1';
  const ACTIVE_CAT_KEY = 'phrases.activeCat';

  // 单击/双击判定窗口：在该时间内若发生双击，则取消单击动作
  const SINGLE_CLICK_DELAY = 300; // ms

  // 只绑定一次的全局监听标记
  let docClosersBound = false;
  let listEventsBound = false;

  // 轻量内置 Prompt（替代 window.prompt）
  async function uiPrompt(options) {
    const opts = Object.assign({
      title: '请输入内容',
      placeholder: '',
      defaultValue: ''
    }, options || {});
    return new Promise((resolve) => {
      const mask = document.createElement('div');
      mask.className = 'prompt-mask';
      mask.innerHTML = `
        <div class="prompt-dialog" role="dialog" aria-modal="true">
          <div class="prompt-title">${opts.title}</div>
          <div class="prompt-body">
            <input class="prompt-input" type="text" placeholder="${opts.placeholder || ''}">
          </div>
          <div class="prompt-actions">
            <button class="btn-cancel" type="button">取消</button>
            <button class="btn-ok" type="button">确定</button>
          </div>
        </div>
      `;
      mask.style.webkitAppRegion = 'no-drag';

      document.body.appendChild(mask);
      const dialog = mask.querySelector('.prompt-dialog');
      const input = mask.querySelector('.prompt-input');
      const btnOk = mask.querySelector('.btn-ok');
      const btnCancel = mask.querySelector('.btn-cancel');

      input.value = opts.defaultValue || '';
      setTimeout(() => { input.focus(); input.select(); }, 0);

      const close = (val) => {
        if (mask && mask.parentNode) mask.parentNode.removeChild(mask);
        resolve(val);
      };

      btnOk.addEventListener('click', () => close(input.value.trim()));
      btnCancel.addEventListener('click', () => close(null));
      mask.addEventListener('click', (e) => { if (e.target === mask) close(null); });
      dialog.addEventListener('click', (e) => e.stopPropagation());
      mask.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); btnOk.click(); }
        if (e.key === 'Escape') { e.preventDefault(); btnCancel.click(); }
      });
      input.addEventListener('keydown', (e) => { e.stopPropagation(); });
    });
  }

  function loadData() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.cats)) return parsed;
      }
    } catch {}
    return {
      cats: [
        { name: '问候', items: ['您好，请问有什么可以帮您？', '在的，看到消息会尽快回复～'] },
        { name: '跟进', items: ['想跟您确认下，前面的问题是否已经解决？', '我们这边可以安排在今天内处理完，您看可以吗？'] },
        { name: '致谢', items: ['收到，感谢反馈！', '谢谢支持，有需要随时联系～'] }
      ]
    };
  }
  function saveData(data) { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch {} }

  let data = loadData();
  let activeCat = data.cats[0]?.name || '';

  function setActiveCat(name) {
    activeCat = name;
    try { localStorage.setItem(ACTIVE_CAT_KEY, name); } catch {}
  }
  (function restoreActive() {
    const last = localStorage.getItem(ACTIVE_CAT_KEY);
    if (last && data.cats.find(c => c.name === last)) activeCat = last;
  })();

  function renderCats() {
    const wrap = $('#phrase-cats');
    if (!wrap) return;

    const catsHtml = data.cats.map(c =>
      `<button class="cat ${c.name === activeCat ? 'active' : ''}" data-cat="${c.name}">${c.name}</button>`
    ).join('');

    wrap.innerHTML = `
      <div class="phrase-cats-bar">
        <div class="phrase-cats-list">${catsHtml}</div>
        <div class="phrase-cats-ops">
          <button class="add-btn" id="btn-cat-ops" title="添加"><span>＋</span></button>
          <div class="add-dropdown" id="cat-add-dropdown" aria-hidden="true">
            <button class="item" data-action="add-cat" type="button">添加类别</button>
            <button class="item" data-action="add-phrase" type="button">添加短语</button>
          </div>
        </div>
      </div>
    `;

    // 切换类别（事件委托）
    const list = $('.phrase-cats-list', wrap);
    list.addEventListener('click', (e) => {
      const btn = e.target.closest('.cat');
      if (!btn) return;
      const name = btn.dataset.cat;
      if (!name) return;
      setActiveCat(name);
      $$('.cat', list).forEach(b => b.classList.toggle('active', b === btn));
      renderList();
    });

    // “＋”按钮控制下拉显隐
    const opsBtn = $('#btn-cat-ops', wrap);
    const dd = $('#cat-add-dropdown', wrap);

    function openDropdown() { dd.classList.add('open'); dd.setAttribute('aria-hidden', 'false'); }
    function closeDropdown() { dd.classList.remove('open'); dd.setAttribute('aria-hidden', 'true'); }

    opsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (dd.classList.contains('open')) closeDropdown(); else openDropdown();
    });

    // 下拉项点击（捕获阶段 + stopPropagation）
    dd.addEventListener('click', (e) => {
      const item = e.target.closest('.item');
      if (!item) return;
      e.stopPropagation();
      const act = item.dataset.action;
      closeDropdown();
      setTimeout(async () => {
        if (act === 'add-cat') await addCategory();
        if (act === 'add-phrase') await addPhrase();
      }, 0);
    }, { capture: true });

    // 全局一次性绑定：点击其它位置或 ESC 关闭下拉
    if (!docClosersBound) {
      docClosersBound = true;
      document.addEventListener('click', (e) => {
        const catsWrap = $('#phrase-cats');
        if (!catsWrap) return;
        const ddEl = catsWrap.querySelector('#cat-add-dropdown');
        const btnEl = catsWrap.querySelector('#btn-cat-ops');
        if (!ddEl) return;
        const inside = ddEl.contains(e.target) || (btnEl && btnEl.contains(e.target));
        if (!inside) { ddEl.classList.remove('open'); ddEl.setAttribute('aria-hidden', 'true'); }
      });
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          const ddEl = document.querySelector('#phrase-cats #cat-add-dropdown');
          if (ddEl) { ddEl.classList.remove('open'); ddEl.setAttribute('aria-hidden', 'true'); }
        }
      });
    }
  }

  async function addCategory() {
    const name = await uiPrompt({ title: '请输入新类别名称：', placeholder: '类别名称' });
    if (!name) return;
    const norm = name.toLowerCase();
    if (data.cats.find(c => (c.name || '').trim().toLowerCase() === norm)) {
      window.alert('类目已存在');
      return;
    }
    data.cats.push({ name, items: [] });
    setActiveCat(name);
    saveData(data);
    renderCats();
    renderList();
  }

  async function addPhrase() {
    if (!activeCat) { window.alert('请先选择一个类别再添加短语'); return; }
    const text = await uiPrompt({ title: `请输入要添加到【${activeCat}】的短语：`, placeholder: '短语内容' });
    if (!text) return;
    const cat = data.cats.find(c => c.name === activeCat);
    if (!cat) return;
    cat.items.push(text);
    saveData(data);
    renderList();
  }

  function renderList() {
    const listWrap = $('#phrase-list');
    if (!listWrap) return;
    const cat = data.cats.find(c => c.name === activeCat);
    const items = cat ? cat.items : [];
    listWrap.innerHTML = items.map(t => `
      <div class="phrase-item" data-text="${t.replace(/"/g, '&quot;')}" title="单击：粘贴到微信；双击：粘贴并发送">
        <div class="text">${t}</div>
        <div class="meta">${activeCat}</div>
      </div>
    `).join('');
  }

  // 只给 #phrase-list 容器绑定一次事件，避免多次渲染导致重复绑定
  function bindListEventsOnce() {
    if (listEventsBound) return;
    listEventsBound = true;

    const listWrap = $('#phrase-list');
    if (!listWrap) return;

    let singleTimer = null;

    // 单一 click 监听 + dblclick 监听的经典组合
    listWrap.addEventListener('click', (e) => {
      const item = e.target.closest('.phrase-item');
      if (!item) return;
      const text = item.dataset.text || '';
      if (!text) return;

      // 延时执行单击，如果在延时内捕获到 dblclick，会被取消
      clearTimeout(singleTimer);
      singleTimer = setTimeout(() => {
        ipcRenderer.send('phrase:paste', text); // 单击：只粘贴
        singleTimer = null;
      }, SINGLE_CLICK_DELAY);
    });

    listWrap.addEventListener('dblclick', (e) => {
      const item = e.target.closest('.phrase-item');
      if (!item) return;
      const text = item.dataset.text || '';
      if (!text) return;

      // 取消待执行的单击，只执行一次双击行为
      if (singleTimer) { clearTimeout(singleTimer); singleTimer = null; }
      ipcRenderer.send('phrase:paste-send', text); // 双击：粘贴并发送（仅一次）
    });
  }

  function render() {
    renderCats();
    renderList();
    // 确保事件只绑定一次
    bindListEventsOnce();
  }

  window.addEventListener('DOMContentLoaded', render);
})();