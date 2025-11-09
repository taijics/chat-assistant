(function() {
  const { ipcRenderer } = require('electron');
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function getUseScopeForCurrent() {
    // group=1（小组），private=2（私人），公司禁用
    if (currentTab === 'group') return 1;
    if (currentTab === 'private') return 2;
    return 0;
  }

  // 记录“类别名称 -> 后端类别ID”的映射，给新增短语用
  let allTypeIdMap = {
    corp: {},
    group: {},
    private: {}
  };

  function currentUserIsAdmin() {
    try {
      const u = (window.API && API.getUser && API.getUser()) || null;
      return !!(u && Number(u.isAdmin) === 1);
    } catch {
      return false;
    }
  }

  function canShowOps(tab) {
    if (tab === 'corp') return false; // 公司：不显示“＋”
    if (tab === 'group') return currentUserIsAdmin(); // 小组：组长才显示
    if (tab === 'private') return true; // 私人：总是显示
    return false;
  }

  const TAB_KEYS = {
    corp: "公司话术",
    group: "小组话术",
    private: "私人话术"
  };
  let currentTab = 'corp';

  // 本地缓存相关的方法改为“纯内存”，不再读写 localStorage
  function getStorageKeys(tab) {
    return {
      data: `phrases.data.${tab}.v1`,
      activeCat: `phrases.activeCat.${tab}`,
    };
  }

  // 不再读取 localStorage，直接返回空结构
  function loadData(/* tab */) {
    return { cats: [] };
  }
  // 不再写入 localStorage（改为空操作）
  function saveData(/* tab, data */) {}

  // 不再读取 localStorage，默认返回数据中的第一个类目名或空
  function loadActiveCat(tab, data) {
    return data && Array.isArray(data.cats) && data.cats.length ? data.cats[0].name : '';
  }
  // 不再写入 localStorage（改为空操作）
  function saveActiveCat(/* tab, name */) {}

  // 初始化为纯内存数据
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
  let listRenderSeq = { corp: 0, group: 0, private: 0 };

  function getData() {
    return allData[currentTab];
  }

  function getActiveCat() {
    return allActiveCat[currentTab];
  }

  function setActiveCat(name) {
    allActiveCat[currentTab] = name;
    saveActiveCat(currentTab, name); // 空操作（为兼容保留调用）
  }

  // 不再持久化，仅更新内存
  function updateAndSave(cb) {
    cb(allData[currentTab]);
    saveData(currentTab, allData[currentTab]); // 空操作（为兼容保留调用）
  }

  /* ------------------- 服务端不可用提示 Banner ------------------- */
  // 简单状态：false=隐藏，true=显示
  function ensurePhrasesUnavailableBanner() {
    const area = document.getElementById('phrases-area') || document.body;
    let el = document.getElementById('phrases-unavailable');
    if (!el) {
      el = document.createElement('div');
      el.id = 'phrases-unavailable';
      el.innerHTML = `
        <span class="msg-text">服务端不可用</span>
        <button type="button" class="retry-btn" style="margin-left:12px;padding:2px 10px;font-size:12px;cursor:pointer;border:1px solid #bbb;background:#fff;border-radius:4px;">重试</button>
      `;
      el.style.cssText = [
        'display:none',
        'color:#666',
        'font-size:13px',
        'padding:10px 12px',
        'border:1px dashed #c4c4c4',
        'border-radius:6px',
        'background:#f7f7f7',
        'text-align:center',
        'margin:8px 8px 12px',
        'user-select:none',
        'line-height:1.4',
        'font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif'
      ].join(';');
      // 插到话术区域最前
      area.insertBefore(el, area.firstChild);
      const retryBtn = el.querySelector('.retry-btn');
      retryBtn.addEventListener('click', () => {
        setPhrasesUnavailable(false);
        // 强制重新加载当前 tab 数据
        loadRemotePhrasesText(true);
      });
    }
    return el;
  }

  function setPhrasesUnavailable(show, msg) {
    const el = ensurePhrasesUnavailableBanner();
    if (!el) return;
    if (msg) {
      const mt = el.querySelector('.msg-text');
      if (mt) mt.textContent = msg;
    }
    el.style.display = show ? '' : 'none';
  }

  // 根据错误对象判断是否要显示“服务端不可用”
  function isServerUnavailableError(err) {
    if (!err) return true;
    if (err.name === 'AbortError') return true;
    if (typeof err.status === 'number') {
      // 网络层无响应时往往没有 status，或 fetch 抛异常；若有 5xx 也认为不可用
      if (err.status >= 500) return true;
    }
    const msg = (err.message || '').toLowerCase();
    if (msg.includes('failed to fetch') || msg.includes('timeout') || msg.includes('network')) return true;
    return false;
  }
  /* ------------------------------------------------------------- */

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
    // 避免残留：切换 tab 时先隐藏不可用 Banner（等请求失败再显示）
    setPhrasesUnavailable(false);
    // 切到某个页签时，在线请求一次该页签的数据
    loadRemotePhrasesText();
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
    const showOps = canShowOps(currentTab);
    const opsHtml = showOps ? `
      <button class="add-btn" id="btn-cat-ops-${currentTab}" title="添加"><span>＋</span></button>
      <div class="add-dropdown" id="cat-add-dropdown-${currentTab}" aria-hidden="true">
        <button class="item" data-action="add-cat" type="button">添加类别</button>
        <button class="item" data-action="add-phrase" type="button">添加短语</button>
      </div>
    ` : '';

    wrap.innerHTML = `
      <div class="phrase-cats-bar">
        <div class="phrase-cats-list">${catsHtml}</div>
        <div class="phrase-cats-ops">${opsHtml}</div>
      </div>
    `;

    // 类别切换
    const list = $('.phrase-cats-list', wrap);
    list && list.addEventListener('click', async (e) => {
      const btn = e.target.closest('.cat');
      if (!btn) return;
      const name = btn.dataset.cat;
      if (!name) return;

      setActiveCat(name);
      $$('.cat', list).forEach(b => b.classList.toggle('active', b === btn));

      // 懒加载当前被点击类别的内容（只在未加载过时请求一次）
      await loadCatItemsByName(name);

      renderList();
    });

    // “＋”按钮下拉
    const opsBtn = $(`#btn-cat-ops-${currentTab}`, wrap);
    const dd = $(`#cat-add-dropdown-${currentTab}`, wrap);

    function openDropdown() {
      dd && dd.classList.add('open');
      dd && dd.setAttribute('aria-hidden', 'false');
    }

    function closeDropdown() {
      if (!dd) return;
      dd.classList.remove('open');
      dd.setAttribute('aria-hidden', 'true');
    }
    opsBtn && opsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (dd && dd.classList.contains('open')) closeDropdown();
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
    }, { capture: true });

    // 下拉只绑定一次（每次渲染解绑旧事件）——这里保持行为，仅判空以防错误
    document.body.addEventListener('click', closeDropdown);

    wrap.querySelector('.phrase-cats-bar').addEventListener('click', e => e.stopPropagation());
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeDropdown();
    });
  }

  function renderList() {
    const listWrap = document.getElementById('phrase-list-' + currentTab);
    if (!listWrap) return;

    const seq = ++listRenderSeq[currentTab];

    const data = getData();
    const activeCat = getActiveCat();
    const cat = data.cats.find(c => c.name === activeCat);
    const items = cat ? cat.items : [];

    listWrap.innerHTML = '';
    const BATCH = 120;
    let i = 0;

    function appendBatch() {
      if (seq !== listRenderSeq[currentTab]) return;

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

  // 添加类别：成功后直接刷新远端数据（不做本地写入）
  async function addCategory() {
    const useScope = getUseScopeForCurrent();
    if (useScope === 0) {
      window.alert('公司话术不支持前端添加');
      return;
    }
    const name = await uiPrompt({
      title: `请输入新类别名称（${TAB_KEYS[currentTab]}）：`,
      placeholder: '类别名称'
    });
    if (!name) return;

    const TYPE_CLASS_TEXT = 2;
    try {
      const resp = await API.content.addByMe({
        useScope,
        title: name.trim(),
        typeClass: TYPE_CLASS_TEXT
      });
      if (!resp || resp.status !== 'success') {
        window.alert('创建类别失败');
        return;
      }

      await loadRemotePhrasesText(true); // 强制刷新当前tab数据
      setActiveCat(name);
      renderCats();
      renderList();
    } catch (e) {
      console.warn('创建类别失败：', e);
      if (isServerUnavailableError(e)) setPhrasesUnavailable(true);
      window.alert((e && e.message) || '创建类别失败');
    }
  }

  // 添加短语：不做本地 push，成功后刷新远端数据
  async function addPhrase() {
    const useScope = getUseScopeForCurrent();
    if (useScope === 0) {
      window.alert('公司话术不支持前端添加');
      return;
    }
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

    let typeId = allTypeIdMap[currentTab][activeCat];
    const TYPE_CLASS_TEXT = 2;
    try {
      if (!typeId) {
        await API.content.addByMe({
          useScope,
            title: activeCat,
            content: text,
            typeClass: TYPE_CLASS_TEXT,
        });
      } else {
        await API.content.addByMe({
          useScope,
            contentTypeId: typeId,
            content: text,
            typeClass: TYPE_CLASS_TEXT,
        });
      }
      await loadRemotePhrasesText(true); // 强制刷新当前tab数据
    } catch (e) {
      console.warn('添加短语失败：', e);
      if (isServerUnavailableError(e)) setPhrasesUnavailable(true);
      window.alert((e && e.message) || '添加短语失败');
    }
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
            <textarea class="prompt-input" placeholder="${opts.placeholder || ''}" rows="6" style="height: 160px; min-height: 120px; resize: vertical; line-height: 1.5;"></textarea></div>
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
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
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
    // 已登录时拉远端数据
    try {
      const tk = (window.API && API.getToken && API.getToken()) || '';
      if (tk) loadRemotePhrasesText();
    } catch {}
  }

  // 之前这里会“从本地缓存重载”，现改为“直接拉远端”
  window.addEventListener('ai:saved-phrase', async () => {
    await loadRemotePhrasesText(true);
  });

  // 监听登录完成事件，拉取公司/小组/私人（当前tab）
  window.addEventListener('auth:login', () => {
    setPhrasesUnavailable(false);
    loadRemotePhrasesText(true);
    renderCats(); // 刷新按钮显隐
  });
  // 登出也刷新一次显隐（无需清数据）
  window.addEventListener('auth:logout', () => {
    renderCats();
  });

  // 登录后从后端拉取当前页签的类别与话术（typeClass=2：文字）
  async function loadRemotePhrasesText(force = false) {
    const TYPE_CLASS_TEXT = 2;
    try {
      // 开始请求前隐藏不可用提示
      setPhrasesUnavailable(false);

      const resp = await API.content.types({ typeClass: TYPE_CLASS_TEXT });
      const grouped = (resp && resp.data) || {};

      // 只处理当前tab的类别列表
      let typesArr = [];
      const tabKey = currentTab;
      if (tabKey === 'corp') typesArr = grouped.company || grouped.corp || grouped['公司'] || [];
      else if (tabKey === 'group') typesArr = grouped.team || grouped.group || grouped['小组'] || [];
      else if (tabKey === 'private') typesArr = grouped.personal || grouped.private || grouped['私人'] || [];

      // 重置映射和本tab的类别（先不请求内容）
      allTypeIdMap[tabKey] = {};
      const cats = [];
      (typesArr || []).forEach((t) => {
        const typeId = t.id || t.typeId || t.contentTypeId;
        const title = t.title || t.name || ('分类-' + (typeId ?? ''));
        if (!typeId) return;
        cats.push({
          name: title,
          id: typeId,
          items: [],
          _loaded: false
        }); // 标记未加载
        allTypeIdMap[tabKey][title] = typeId;
      });

      // 覆盖当前tab的数据
      allData[tabKey] = { cats };

      // 选择激活类别：优先沿用之前的；没有则选第一个
      let active = getActiveCat();
      if (!active || !cats.find(c => c.name === active)) {
        active = cats[0]?.name || '';
        if (active) setActiveCat(active);
      }

      renderCats(); // 先渲染类别按钮

      // 只为“激活类别”请求内容
      if (active) {
        await loadCatItemsByName(active);
      }

      renderList(); // 渲染列表（此时只会有激活类别的内容）

      // 若有类别成功加载，视为成功隐藏不可用提示
      if (cats.length > 0) setPhrasesUnavailable(false);
      else {
        // 没有任何类别也算一种异常（可能后端返回空）——按需可提示，这里保持隐藏
      }
    } catch (e) {
      console.warn('加载类别和话术失败：', e);
      if (isServerUnavailableError(e)) setPhrasesUnavailable(true);
    }
  }

  async function loadCatItemsByName(catName) {
    const TYPE_CLASS_TEXT = 2;
    const data = getData();
    if (!data || !data.cats || !data.cats.length) return;

    const cat = data.cats.find(c => c.name === catName);
    if (!cat || cat._loaded) return; // 已加载过则跳过

    const typeId = cat.id;
    if (!typeId) return;
    try {
      const listResp = await API.content.list({
        typeClass: TYPE_CLASS_TEXT,
        typeId
      });
      const list = (listResp && listResp.data) || [];
      cat.items = list.map(i => i.content || i.text || '').filter(Boolean);
      cat._loaded = true;
      // 成功加载某个类别内容后隐藏不可用提示（可能之前失败过）
      setPhrasesUnavailable(false);
    } catch (e) {
      console.warn('加载类别话术列表失败：', e);
      if (isServerUnavailableError(e)) setPhrasesUnavailable(true);
    }
  }

  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();