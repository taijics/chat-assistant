(function() {
  const {
    ipcRenderer
  } = require('electron');
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const STORAGE_KEY = 'phrases.data.v1';
  const ACTIVE_CAT_KEY = 'phrases.activeCat';
  const SINGLE_CLICK_DELAY = 300;

  let docClosersBound = false;
  let listEventsBound = false;

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

  function loadData() {
    const DEFAULT = {
      cats: [{
          name: '问候',
          items: ['您好，请问有什么可以帮您？', '在的，看到消息会尽快回复～']
        },
        {
          name: '跟进',
          items: ['想跟您确认下，前面的问题是否已经解决？', '我们这边可以安排在今天内处理完，您看可以吗？']
        },
        {
          name: '致谢',
          items: ['收到，感谢反馈！', '谢谢支持，有需要随时联系～']
        }
      ]
    };
    let raw = null;
    try {
      raw = localStorage.getItem(STORAGE_KEY) || '';
    } catch {}
    if (!raw) return DEFAULT;

    // 超阈值先返回默认数据，让首屏“秒开”
    const TOO_LARGE = raw.length > 2_000_000; // 约 2MB，可按需调
    if (TOO_LARGE) {
      // 后台解析，解析成功后刷新 UI（不阻塞首屏）
      setTimeout(() => {
        try {
          const parsed = JSON.parse(raw);
          if (parsed && Array.isArray(parsed.cats)) {
            // 用解析结果替换内存数据并刷新
            data = parsed;
            if (!data.cats.find(c => c.name === activeCat)) {
              activeCat = data.cats[0]?.name || activeCat;
              try {
                localStorage.setItem(ACTIVE_CAT_KEY, activeCat);
              } catch {}
            }
            renderCats();
            renderList();
            bindListEventsOnce();
          }
        } catch (e) {
          console.warn('deferred parse failed:', e?.message);
        }
      }, 0);
      return DEFAULT;
    }

    try {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.cats)) return parsed;
    } catch {}
    return DEFAULT;
  }

  function saveData(data) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {}
  }

  let data = loadData();
  let activeCat = data.cats[0]?.name || '';

  function setActiveCat(name) {
    activeCat = name;
    try {
      localStorage.setItem(ACTIVE_CAT_KEY, name);
    } catch {}
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

    // 切换类别
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

    function openDropdown() {
      dd.classList.add('open');
      dd.setAttribute('aria-hidden', 'false');
    }

    function closeDropdown() {
      dd.classList.remove('open');
      dd.setAttribute('aria-hidden', 'true');
    }

    opsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (dd.classList.contains('open')) closeDropdown();
      else openDropdown();
    });

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
    }, {
      capture: true
    });

    if (!docClosersBound) {
      docClosersBound = true;
      document.addEventListener('click', (e) => {
        const catsWrap = $('#phrase-cats');
        if (!catsWrap) return;
        const ddEl = catsWrap.querySelector('#cat-add-dropdown');
        const btnEl = catsWrap.querySelector('#btn-cat-ops');
        if (!ddEl) return;
        const inside = ddEl.contains(e.target) || (btnEl && btnEl.contains(e.target));
        if (!inside) {
          ddEl.classList.remove('open');
          ddEl.setAttribute('aria-hidden', 'true');
        }
      });
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          const ddEl = document.querySelector('#phrase-cats #cat-add-dropdown');
          if (ddEl) {
            ddEl.classList.remove('open');
            ddEl.setAttribute('aria-hidden', 'true');
          }
        }
      });
    }
  }

  async function addCategory() {
    const name = await uiPrompt({
      title: '请输入新类别名称：',
      placeholder: '类别名称'
    });
    if (!name) return;
    const norm = name.toLowerCase();
    if (data.cats.find(c => (c.name || '').trim().toLowerCase() === norm)) {
      window.alert('类目已存在');
      return;
    }
    data.cats.push({
      name,
      items: []
    });
    setActiveCat(name);
    saveData(data);
    renderCats();
    renderList();
  }

  async function addPhrase() {
    if (!activeCat) {
      window.alert('请先选择一个类别再添加短语');
      return;
    }
    const text = await uiPrompt({
      title: `请输入要添加到【${activeCat}】的短语：`,
      placeholder: '短语内容'
    });
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

  listWrap.innerHTML = '';
  const BATCH = 120; // 每帧渲染 120 条，可按机器调
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
      el.appendChild(metaDiv);
      frag.appendChild(el);
    }
    listWrap.appendChild(frag);
    if (i < items.length) requestAnimationFrame(appendBatch);
  }

  requestAnimationFrame(appendBatch);
}

  function bindListEventsOnce() {
    if (listEventsBound) return;
    listEventsBound = true;

    const listWrap = $('#phrase-list');
    if (!listWrap) return;

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
      }, SINGLE_CLICK_DELAY);
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
  }

  // 接收 AI 保存后发出的刷新事件，立即从存储重载并刷新 UI
  function refreshFromStorage(savedStyle) {
    data = loadData();
    // 若当前激活分类已不存在或未设置，则优先切到刚保存的风格分类
    if (!activeCat || !data.cats.find(c => c.name === activeCat)) {
      activeCat = savedStyle || data.cats[0]?.name || '';
      try {
        localStorage.setItem(ACTIVE_CAT_KEY, activeCat);
      } catch {}
    }
    renderCats();
    renderList();
    bindListEventsOnce();
  }
  window.addEventListener('ai:saved-phrase', (e) => {
    const style = e && e.detail && e.detail.style;
    refreshFromStorage(style);
  });

  function render() {
    renderCats();
    renderList();
    bindListEventsOnce();
  }

  // 若 DOM 已就绪则立即渲染；否则等待 DOMContentLoaded
  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', render);
  } else {
    render();
  }
})();