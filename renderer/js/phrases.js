(function() {
  const {
    ipcRenderer
  } = require('electron');
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const TAB_KEYS = {
    corp: "公司话术",
    group: "小组话术",
    private: "私人话术"
  };
  let currentTab = 'corp';

  function getStorageKeys(tab) {
    return {
      data: `phrases.data.${tab}.v1`,
      activeCat: `phrases.activeCat.${tab}`,
    };
  }

  function loadData(tab) {
    const storageKey = getStorageKeys(tab).data;
    let raw = null;
    try {
      raw = localStorage.getItem(storageKey) || '';
    } catch {}
    if (!raw) return {
      cats: []
    };
    try {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.cats)) return parsed;
    } catch {}
    return {
      cats: []
    };
  }

  function saveData(tab, data) {
    const storageKey = getStorageKeys(tab).data;
    try {
      localStorage.setItem(storageKey, JSON.stringify(data));
    } catch {}
  }

  function loadActiveCat(tab, data) {
    const key = getStorageKeys(tab).activeCat;
    let last = '';
    try {
      last = localStorage.getItem(key);
    } catch {}
    if (last && data.cats.find(c => c.name === last)) return last;
    return data.cats[0]?.name || '';
  }

  function saveActiveCat(tab, name) {
    const key = getStorageKeys(tab).activeCat;
    try {
      localStorage.setItem(key, name);
    } catch {}
  }

  let allData = {
    corp: loadData('corp'),
    group: loadData('group'),
    private: loadData('private')
  };
  let allActiveCat = {
    corp: loadActiveCat('corp', allData.corp),
    group: loadActiveCat('group', allData.group),
    private: loadActiveCat('private', allData.private)
  };

  function getData() {
    return allData[currentTab];
  }

  function getActiveCat() {
    return allActiveCat[currentTab];
  }

  function setActiveCat(name) {
    allActiveCat[currentTab] = name;
    saveActiveCat(currentTab, name);
  }

  function updateAndSave(cb) {
    cb(allData[currentTab]);
    saveData(currentTab, allData[currentTab]);
  }

  function switchTab(tab) {
    if (!TAB_KEYS[tab]) return;
    currentTab = tab;
    // 显示/隐藏类别栏和短语栏
    ['corp', 'group', 'private'].forEach(t => {
      const cwrap = document.getElementById('phrase-cats-' + t);
      if (cwrap) cwrap.style.display = (t === currentTab ? '' : 'none');
      const lwrap = document.getElementById('phrase-list-' + t);
      if (lwrap) lwrap.style.display = (t === currentTab ? '' : 'none');
    });
    renderCats();
    renderList();
    // 高亮tab按钮
    $$('.tab-btn', $('#tabbar')).forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tab);
      btn.setAttribute('aria-selected', btn.dataset.tab === tab ? 'true' : 'false');
    });
    // 切换内容面板
    $$('.tabpane', $('.tabpanes')).forEach(sec => {
      sec.classList.toggle('active', sec.id === `tab-${tab}`);
      sec.setAttribute('aria-hidden', sec.id === `tab-${tab}` ? "false" : "true");
    });
  }

  function renderCats() {
    // 只渲染当前栏
    const wrap = document.getElementById('phrase-cats-' + currentTab);
    if (!wrap) return;
    const data = getData();
    const activeCat = getActiveCat();
    const catsHtml = data.cats.map(c =>
      `<button class="cat ${c.name === activeCat ? 'active' : ''}" data-cat="${c.name}">${c.name}</button>`
    ).join('');
    wrap.innerHTML = `
      <div class="phrase-cats-bar">
        <div class="phrase-cats-list">${catsHtml}</div>
        <div class="phrase-cats-ops">
          <button class="add-btn" id="btn-cat-ops-${currentTab}" title="添加"><span>＋</span></button>
          <div class="add-dropdown" id="cat-add-dropdown-${currentTab}" aria-hidden="true">
            <button class="item" data-action="add-cat" type="button">添加类别</button>
            <button class="item" data-action="add-phrase" type="button">添加短语</button>
          </div>
        </div>
      </div>
    `;

    // 类别切换
    const list = $('.phrase-cats-list', wrap);
    list && list.addEventListener('click', (e) => {
      const btn = e.target.closest('.cat');
      if (!btn) return;
      const name = btn.dataset.cat;
      if (!name) return;
      setActiveCat(name);
      $$('.cat', list).forEach(b => b.classList.toggle('active', b === btn));
      renderList();
    });

    // “＋”按钮下拉
    const opsBtn = $(`#btn-cat-ops-${currentTab}`, wrap);
    const dd = $(`#cat-add-dropdown-${currentTab}`, wrap);

    function openDropdown() {
      dd.classList.add('open');
      dd.setAttribute('aria-hidden', 'false');
    }

    function closeDropdown() {
      dd.classList.remove('open');
      dd.setAttribute('aria-hidden', 'true');
    }
    opsBtn && opsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (dd.classList.contains('open')) closeDropdown();
      else openDropdown();
    });
    dd && dd.addEventListener('click', (e) => {
      const item = e.target.closest('.item');
      if (!item) return;
      e.stopPropagation();
      const act = item.dataset.action;
      closeDropdown();
      setTimeout(async () => {
        if (act === 'add-cat') await addCategory();
        if (act === 'add-phrase') await addPhrase();
      }, 0);
    }, {
      capture: true
    });

    // 下拉只绑定一次（每次渲染解绑旧事件）
    document.body.addEventListener('click', closeDropdown);

    wrap.querySelector('.phrase-cats-bar').addEventListener('click', e => e.stopPropagation());
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeDropdown();
    });
  }

  function renderList() {
    const listWrap = document.getElementById('phrase-list-' + currentTab);
    if (!listWrap) return;
    const data = getData();
    const activeCat = getActiveCat();
    const cat = data.cats.find(c => c.name === activeCat);
    const items = cat ? cat.items : [];

    listWrap.innerHTML = '';
    const BATCH = 120;
    let i = 0;

    function appendBatch() {
      const frag = document.createDocumentFragment();
      for (let n = 0; n < BATCH && i < items.length; n++, i++) {
        const t = items[i];
        const el = document.createElement('div');
        el.className = 'phrase-item';
        el.setAttribute('data-text', String(t).replace(/"/g, '&quot;'));
        el.title = '单击：粘贴到微信；双击：粘贴并发送';
        const textDiv = document.createElement('div');
        textDiv.className = 'text';
        textDiv.textContent = t;
        const metaDiv = document.createElement('div');
        metaDiv.className = 'meta';
        metaDiv.textContent = activeCat;
        el.appendChild(textDiv);
       // el.appendChild(metaDiv);
        frag.appendChild(el);
      }
      listWrap.appendChild(frag);
      if (i < items.length) requestAnimationFrame(appendBatch);
    }
    requestAnimationFrame(appendBatch);

    // 点击/双击事件
    if (!listWrap._eventsBound) {
      let singleTimer = null;
      listWrap.addEventListener('click', (e) => {
        const item = e.target.closest('.phrase-item');
        if (!item) return;
        const text = item.dataset.text || '';
        if (!text) return;
        clearTimeout(singleTimer);
        singleTimer = setTimeout(() => {
          ipcRenderer.send('phrase:paste', text);
          singleTimer = null;
        }, 300);
      });
      listWrap.addEventListener('dblclick', (e) => {
        const item = e.target.closest('.phrase-item');
        if (!item) return;
        const text = item.dataset.text || '';
        if (!text) return;
        if (singleTimer) {
          clearTimeout(singleTimer);
          singleTimer = null;
        }
        ipcRenderer.send('phrase:paste-send', text);
      });
      listWrap._eventsBound = true;
    }
  }

  async function addCategory() {
    const name = await uiPrompt({
      title: '请输入新类别名称：',
      placeholder: '类别名称'
    });
    if (!name) return;
    const norm = name.toLowerCase();
    const data = getData();
    if (data.cats.find(c => (c.name || '').trim().toLowerCase() === norm)) {
      window.alert('类目已存在');
      return;
    }
    updateAndSave(data => {
      data.cats.push({
        name,
        items: []
      });
    });
    setActiveCat(name);
    renderCats();
    renderList();
  }

  async function addPhrase() {
    const activeCat = getActiveCat();
    if (!activeCat) {
      window.alert('请先选择一个类别再添加短语');
      return;
    }
    const text = await uiPrompt({
      title: `请输入要添加到【${activeCat}】的短语：`,
      placeholder: '短语内容'
    });
    if (!text) return;
    updateAndSave(data => {
      const cat = data.cats.find(c => c.name === activeCat);
      if (cat) cat.items.push(text);
    });
    renderList();
  }

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
        </div>`;
      mask.style.webkitAppRegion = 'no-drag';
      document.body.appendChild(mask);
      const dialog = mask.querySelector('.prompt-dialog');
      const input = mask.querySelector('.prompt-input');
      const btnOk = mask.querySelector('.btn-ok');
      const btnCancel = mask.querySelector('.btn-cancel');
      input.value = opts.defaultValue || '';
      setTimeout(() => {
        input.focus();
        input.select();
      }, 0);
      const close = (val) => {
        if (mask && mask.parentNode) mask.parentNode.removeChild(mask);
        resolve(val);
      };
      btnOk.addEventListener('click', () => close(input.value.trim()));
      btnCancel.addEventListener('click', () => close(null));
      mask.addEventListener('click', (e) => {
        if (e.target === mask) close(null);
      });
      dialog.addEventListener('click', (e) => e.stopPropagation());
      mask.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          btnOk.click();
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          btnCancel.click();
        }
      });
      input.addEventListener('keydown', (e) => {
        e.stopPropagation();
      });
    });
  }

  $('#tabbar')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.tab-btn');
    if (!btn) return;
    const tab = btn.dataset.tab;
    if (!tab || tab === currentTab) return;
    switchTab(tab);
  });

  function init() {
    // 显示公司tab
    switchTab(currentTab);
  }

  window.addEventListener('ai:saved-phrase', (e) => {
    allData[currentTab] = loadData(currentTab);
    allActiveCat[currentTab] = loadActiveCat(currentTab, allData[currentTab]);
    renderCats();
    renderList();
  });

  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();