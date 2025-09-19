(function () {
  const { ipcRenderer } = require('electron');
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const STORAGE_KEY = 'phrases.data.v1';

  function loadData() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.cats)) return parsed;
      }
    } catch {}
    // 默认示例数据
    return {
      cats: [
        { name: '问候', items: ['您好，请问有什么可以帮您？', '在的，看到消息会尽快回复～'] },
        { name: '跟进', items: ['想跟您确认下，前面的问题是否已经解决？', '我们这边可以安排在今天内处理完，您看可以吗？'] },
        { name: '致谢', items: ['收到，感谢反馈！', '谢谢支持，有需要随时联系～'] }
      ]
    };
  }
  function saveData(data) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch {}
  }

  let data = loadData();
  let activeCat = data.cats[0]?.name || '';

  function setActiveCat(name) {
    activeCat = name;
    try { localStorage.setItem('phrases.activeCat', name); } catch {}
  }
  // 恢复上次激活分类
  (function restoreActive() {
    const last = localStorage.getItem('phrases.activeCat');
    if (last && data.cats.find(c => c.name === last)) activeCat = last;
  })();

  function renderCats() {
    const wrap = $('#phrase-cats');
    if (!wrap) return;

    // 构建结构：左侧类别、右侧操作（添加）
    const catsHtml = data.cats.map(c =>
      `<button class="cat ${c.name === activeCat ? 'active' : ''}" data-cat="${c.name}">${c.name}</button>`
    ).join('');

    wrap.innerHTML = `
      <div class="phrase-cats-bar">
        <div class="phrase-cats-list">${catsHtml}</div>
        <div class="phrase-cats-ops">
          <button class="add-btn" id="btn-cat-ops" title="添加"><span>＋</span></button>
          <div class="add-dropdown" id="cat-add-dropdown" aria-hidden="true">
            <button class="item" data-action="add-cat">添加类别</button>
            <button class="item" data-action="add-phrase">添加短语</button>
          </div>
        </div>
      </div>
    `;

    // 事件：切换类别
    const list = $('.phrase-cats-list', wrap);
    list.addEventListener('click', (e) => {
      const btn = e.target.closest('.cat');
      if (!btn) return;
      const name = btn.dataset.cat;
      if (!name) return;
      setActiveCat(name);
      // 更新激活态
      $$('.cat', list).forEach(b => b.classList.toggle('active', b === btn));
      renderList(); // 渲染右侧短语
    });

    // 添加按钮与下拉
    const opsBtn = $('#btn-cat-ops', wrap);
    const dd = $('#cat-add-dropdown', wrap);

    function closeDropdown() {
      dd.classList.remove('open');
      dd.setAttribute('aria-hidden', 'true');
    }
    function openDropdown() {
      dd.classList.add('open');
      dd.setAttribute('aria-hidden', 'false');
    }

    opsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (dd.classList.contains('open')) closeDropdown();
      else openDropdown();
    });

    document.addEventListener('click', (e) => {
      if (!wrap.contains(e.target)) closeDropdown();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeDropdown();
    });

    // 处理下拉项
    dd.addEventListener('click', (e) => {
      const item = e.target.closest('.item');
      if (!item) return;
      const act = item.dataset.action;
      closeDropdown();
      if (act === 'add-cat') {
        addCategory();
      } else if (act === 'add-phrase') {
        addPhrase();
      }
    });
  }

  function addCategory() {
    let name = (window.prompt('请输入新类别名称：') || '').trim();
    if (!name) return;
    if (data.cats.find(c => c.name === name)) {
      window.alert('类目已存在');
      return;
    }
    data.cats.push({ name, items: [] });
    setActiveCat(name);
    saveData(data);
    renderCats();
    renderList();
  }

  function addPhrase() {
    if (!activeCat) {
      window.alert('请先选择一个类别再添加短语');
      return;
    }
    const text = (window.prompt(`请输入要添加到【${activeCat}】的短语：`) || '').trim();
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

    // 单击与双击：双击会触发单击，因此用延迟消抖
    let clickTimer = null;
    const CLICK_DELAY = 220;

    listWrap.addEventListener('click', (e) => {
      const item = e.target.closest('.phrase-item');
      if (!item) return;
      const text = item.dataset.text || '';
      if (!text) return;

      clearTimeout(clickTimer);
      clickTimer = setTimeout(() => {
        ipcRenderer.send('phrase:paste', text); // 单击：只粘贴
      }, CLICK_DELAY);
    });

    listWrap.addEventListener('dblclick', (e) => {
      const item = e.target.closest('.phrase-item');
      if (!item) return;
      const text = item.dataset.text || '';
      if (!text) return;
      clearTimeout(clickTimer);
      ipcRenderer.send('phrase:paste-send', text); // 双击：粘贴并发送
    });
  }

  function render() {
    renderCats();
    renderList();
  }

  window.addEventListener('DOMContentLoaded', render);
})();