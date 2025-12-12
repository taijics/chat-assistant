(function() {
  const {
    ipcRenderer
  } = require('electron');
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
  function loadData( /* tab */ ) {
    return {
      cats: []
    };
  }
  // 不再写入 localStorage（改为空操作）
  function saveData( /* tab, data */ ) {}

  // 不再读取 localStorage，默认返回数据中的第一个类目名或空
  function loadActiveCat(tab, data) {
    return data && Array.isArray(data.cats) && data.cats.length ? data.cats[0].name : '';
  }
  // 不再写入 localStorage（改为空操作）
  function saveActiveCat( /* tab, name */ ) {}

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
  let listRenderSeq = {
    corp: 0,
    group: 0,
    private: 0
  };

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

  /* ------------------- 服务端不可用提示 Banner（居中显示） ------------------- */
  // 放到主页面正中（覆盖居中），只在话术模块触发时显示
  function ensurePhrasesUnavailableBanner() {
    let el = document.getElementById('phrases-unavailable');
    if (!el) {
      el = document.createElement('div');
      el.id = 'phrases-unavailable';
      // 全屏覆盖，居中摆放
      el.style.cssText = [
        'position:fixed',
        'inset:0',
        'display:none',
        'z-index:2147483000',
        'pointer-events:none',
        'display:flex',
        'align-items:center',
        'justify-content:center'
      ].join(';');

      // 内层卡片
      const card = document.createElement('div');
      card.style.cssText = [
        'pointer-events:auto',
        'background:#fff',
        'color:#333',
        'border:1px solid #ddd',
        'box-shadow:0 8px 28px rgba(0,0,0,.15)',
        'border-radius:10px',
        'padding:16px 20px',
        'font-size:14px',
        'line-height:1.6',
        'max-width:80vw',
        'text-align:center'
      ].join(';');
      card.innerHTML = `
        <span class="msg-text" style="color:#444;">服务端不可用</span>
        <button type="button" class="retry-btn"
          style="margin-left:14px;padding:6px 14px;font-size:13px;cursor:pointer;border:1px solid #bbb;background:#fff;border-radius:6px;">
          重试
        </button>
      `;
      el.appendChild(card);
      document.body.appendChild(el);

      const retryBtn = card.querySelector('.retry-btn');
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
    el.style.display = show ? 'flex' : 'none';
  }

  // 根据错误对象判断是否要显示“服务端不可用”
  function isServerUnavailableError(err) {
    if (!err) return true;
    if (err.name === 'AbortError') return true;
    if (typeof err.status === 'number') {
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

    // 新增：最多显示 5 个，超出的放到“更多...”下拉
    const MAX_SHOW = 5;
    const catsAll = Array.isArray(data.cats) ? data.cats : [];
    const visibleCats = catsAll.slice(0, MAX_SHOW);
    const moreCats = catsAll.slice(MAX_SHOW);

    const catsHtml = visibleCats.map(c =>
      `<button class="cat ${c.name === activeCat ? 'active' : ''}" data-id="${c.id}" data-cat="${c.name}" data-count="${c.items.length}">${c.name}</button>`
    ).join('');

    // “更多...”按钮与下拉（只有当有折叠项时显示）
    const moreHtml = moreCats.length ? `
      <div class="more-wrap" style="position:relative;display:inline-block;">
        <button class="cat more-btn" id="cat-more-btn-${currentTab}" title="更多类别">更多...</button>
        <div class="more-dropdown" id="cat-more-dd-${currentTab}" aria-hidden="true"
             style="position:absolute;top:100%;left:0;background:#fff;border:1px solid #ddd;box-shadow:0 6px 16px rgba(0,0,0,.12);border-radius:6px;min-width:160px;padding:6px;display:none;z-index:2000;">
          ${moreCats.map(mc => `
            <div class="more-item" data-id="${mc.id}" data-cat="${mc.name}"
                 style="padding:6px 10px;cursor:pointer;font-size:13px;white-space:nowrap;">
              ${mc.name}
            </div>`).join('')}
        </div>
      </div>
    ` : '';

    const showOps = canShowOps(currentTab);
    const opsHtml = showOps ? `
      <button class="add-btn" id="btn-cat-ops-${currentTab}" title="添加"><span>＋</span></button>
      <div class="add-dropdown" id="cat-add-dropdown-${currentTab}" aria-hidden="true">
        <button class="item" data-action="add-cat" type="button">添加类别</button>
        <button class="item" data-action="add-phrase" type="button">添加短语</button>
      </div>
    ` : '';

    wrap.innerHTML = `
      <div class="phrase-cats-bar" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
        <div class="phrase-cats-list">${catsHtml}${moreHtml}</div>
        <div class="phrase-cats-ops">${opsHtml}</div>
      </div>
    `;

    // 类别切换（可见的前 5 个）
    const list = $('.phrase-cats-list', wrap);
    list && list.addEventListener('click', async (e) => {
      const btn = e.target.closest('.cat');
      if (!btn) return;
      // 排除“更多...”按钮的点击（它有专属事件）
      if (btn.classList.contains('more-btn')) return;

      const name = btn.dataset.cat;
      if (!name) return;

      setActiveCat(name);
      $$('.cat', list).forEach(b => b.classList.toggle('active', b === btn));

      await loadCatItemsByName(name);
      renderList();
    });

    // “更多...”下拉事件
    const moreBtn = $(`#cat-more-btn-${currentTab}`, wrap);
    const moreDd = $(`#cat-more-dd-${currentTab}`, wrap);

    function openMore() {
      if (!moreDd) return;
      moreDd.style.display = 'block';
      moreDd.setAttribute('aria-hidden', 'false');
    }

    function closeMore() {
      if (!moreDd) return;
      moreDd.style.display = 'none';
      moreDd.setAttribute('aria-hidden', 'true');
    }
    moreBtn && moreBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!moreDd) return;
      if (moreDd.style.display === 'block') closeMore();
      else openMore();
    });
    moreDd && moreDd.addEventListener('click', async (e) => {
      const item = e.target.closest('.more-item');
      if (!item) return;
      e.stopPropagation();
      const selName = item.dataset.cat;
      const selId = item.dataset.id;

      // 1) 把选择的类别移动到第一个位置（如已存在则先移除再插入头部）
      const idx = catsAll.findIndex(c => String(c.id) === String(selId));
      if (idx >= 0) {
        const [picked] = catsAll.splice(idx, 1);
        catsAll.unshift(picked);
      }
      // 2) 设为选中
      setActiveCat(selName);
      // 3) 重新渲染（使其显示为第一并高亮）
      renderCats();
      await loadCatItemsByName(selName);
      renderList();
      closeMore();
    }, {
      capture: true
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
    }, {
      capture: true
    });

    // 全局点击关闭两个下拉
    document.body.addEventListener('click', () => {
      closeDropdown();
      closeMore();
    });

    wrap.querySelector('.phrase-cats-bar').addEventListener('click', e => e.stopPropagation());
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeDropdown();
        closeMore();
      }
    });
  }

 // 覆盖：renderList（显示标题在上、内容在下；点击/双击仅粘贴内容）
 // 覆盖 renderList：为每个短语项增加 dataset.title，便于右键编辑时回显标题
 function renderList() {
   const listWrap = document.getElementById('phrase-list-' + currentTab);
   if (!listWrap) return;
 
   const seq = ++listRenderSeq[currentTab];
 
   const data = getData();
   const activeCat = getActiveCat();
   const cat = data.cats.find(c => c.name === activeCat);
   const items = cat ? cat.items : [];
   console.log('[phrases] renderList activeCat=', activeCat, 'items.len=', items.length);
 
   listWrap.innerHTML = '';
   const BATCH = 120;
   let i = 0;
 
   function appendBatch() {
     if (seq !== listRenderSeq[currentTab]) return;
 
     const frag = document.createDocumentFragment();
     for (let n = 0; n < BATCH && i < items.length; n++, i++) {
       const t = items[i]; // { id, title, text }
       const el = document.createElement('div');
       el.className = 'phrase-item';
       el.dataset.content = String(t.text || '').replace(/"/g, '&quot;'); // 仅粘贴内容
       el.dataset.title = String(t.title || '').replace(/"/g, '&quot;');   // 供编辑弹框回显
       if (t.id) el.dataset.id = t.id;
       el.title = '单击：粘贴内容；双击：粘贴并发送；右键：操作';
 
       const titleDiv = document.createElement('div');
       titleDiv.className = 'title';
       titleDiv.textContent = (t.title || '').trim();
 
       const textDiv = document.createElement('div');
       textDiv.className = 'text';
       textDiv.textContent = (t.text || '').trim();
 
       el.appendChild(titleDiv);
       el.appendChild(textDiv);
       frag.appendChild(el);
     }
     listWrap.appendChild(frag);
     if (i < items.length) requestAnimationFrame(appendBatch);
   }
   requestAnimationFrame(appendBatch);
 
   // 点击/双击事件：仅使用 dataset.content
   if (!listWrap._eventsBound) {
     let singleTimer = null;
     listWrap.addEventListener('click', (e) => {
       const item = e.target.closest('.phrase-item');
       if (!item) return;
       const content = item.dataset.content || '';
       console.log('[phrases] paste click content=', content);
       if (!content) return;
       clearTimeout(singleTimer);
       singleTimer = setTimeout(() => {
         ipcRenderer.send('phrase:paste', content);
         singleTimer = null;
       }, 300);
     });
     listWrap.addEventListener('dblclick', (e) => {
       const item = e.target.closest('.phrase-item');
       if (!item) return;
       const content = item.dataset.content || '';
       console.log('[phrases] paste dblclick content=', content);
       if (!content) return;
       if (singleTimer) {
         clearTimeout(singleTimer);
         singleTimer = null;
       }
       ipcRenderer.send('phrase:paste-send', content);
     });
     listWrap._eventsBound = true;
   }
 }
// 新增：编辑短语弹框（标题 + 内容），回显初始值，返回 { title, content } 或 null
async function uiEditPhraseDialog(initialTitle, initialContent) {
  return new Promise(resolve => {
    const mask = document.createElement('div');
    mask.className = 'prompt-mask';
    mask.innerHTML = `
      <div class="prompt-dialog" role="dialog" aria-modal="true" style="width:480px;max-width:90vw;">
        <div class="prompt-title" style="font-size:15px;margin-bottom:10px;">编辑短语</div>
        <div class="prompt-body" style="display:flex;flex-direction:column;gap:10px;">
          <div class="field">
            <label style="display:block;font-size:13px;color:#555;margin-bottom:6px;">标题</label>
            <input type="text" class="phrase-title" placeholder="请输入标题（可选）" style="width:100%;padding:8px;border:1px solid #ccc;border-radius:6px;font-size:13px;" />
          </div>
          <div class="field">
            <label style="display:block;font-size:13px;color:#555;margin-bottom:6px;">内容</label>
            <textarea class="phrase-content" rows="6" placeholder="请输入短语内容" style="width:100%;box-sizing:border-box;line-height:1.5;min-height:120px;resize:vertical;"></textarea>
          </div>
        </div>
        <div class="prompt-actions" style="margin-top:12px;display:flex;justify-content:flex-end;gap:8px;">
          <button class="btn-cancel" type="button">取消</button>
          <button class="btn-ok" type="button" disabled style="opacity:.5;cursor:not-allowed;">确定</button>
        </div>
      </div>`;
    document.body.appendChild(mask);

    const dialog = mask.querySelector('.prompt-dialog');
    const inputTitle = mask.querySelector('.phrase-title');
    const inputContent = mask.querySelector('.phrase-content');
    const btnOk = mask.querySelector('.btn-ok');
    const btnCancel = mask.querySelector('.btn-cancel');

    inputTitle.value = initialTitle || '';
    inputContent.value = initialContent || '';

    function updateState() {
      const content = (inputContent.value || '').trim();
      const changed = content !== (initialContent || '').trim() || (inputTitle.value || '').trim() !== (initialTitle || '').trim();
      btnOk.disabled = !changed || !content; // 内容必填，且有改动才可提交
      btnOk.style.opacity = (!btnOk.disabled ? '1' : '.5');
      btnOk.style.cursor = (!btnOk.disabled ? 'pointer' : 'not-allowed');
    }
    inputTitle.addEventListener('input', updateState);
    inputContent.addEventListener('input', updateState);
    setTimeout(() => { inputContent.focus(); }, 0);
    updateState();

    function close(val) {
      if (mask && mask.parentNode) mask.parentNode.removeChild(mask);
      resolve(val);
    }
    btnCancel.onclick = () => close(null);
    btnOk.onclick = () => {
      if (btnOk.disabled) return;
      const title = (inputTitle.value || '').trim();
      const content = (inputContent.value || '').trim();
      close({ title, content });
    };
    mask.addEventListener('click', e => { if (e.target === mask) close(null); });
    dialog.addEventListener('click', e => e.stopPropagation());
    mask.addEventListener('keydown', e => {
      if (e.key === 'Escape') close(null);
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !btnOk.disabled) btnOk.click();
    });
  });
}
  // 添加类别：成功后直接刷新远端数据（不做本地写入）
// 如果选择创建一级类别（parentId=0）且已存在同名顶级类别，则错误提示并阻止提交
async function addCategory() {
  const useScope = getUseScopeForCurrent();
  if (useScope === 0) { window.alert('公司话术不支持前端添加'); return; }

  // 准备父类列表（小组取顶级；私人默认一级）
  let parents = [];
  if (useScope === 1) {
    try {
      const tops = await API.get('/api/front/content/teamTopTypes'); // [{id,title,...}]
      parents = Array.isArray(tops?.data) ? tops.data.map(x => ({ id: Number(x.id), title: x.title })) : [];
    } catch (e) {
      console.warn('获取小组顶级类别失败：', e);
      parents = [];
    }
  }
  // 默认加一个“无（创建一级）”选项
  parents.unshift({ id: 0, title: '无（创建一级）' });

  // 弹框：父类选择 + 单行名称
  const formRes = await uiAddCategoryDialog({
    parents,
    tabLabel: TAB_KEYS[currentTab]
  });
  if (!formRes) return;
  const { parentId, name } = formRes;
  const finalName = (name || '').trim();
  if (!finalName) return;

  // 新增校验：当选择创建一级类别（parentId=0）时，检查当前 tab 的顶级类别是否已有同名，若有则报错并阻止提交
  if (Number(parentId) === 0) {
    const data = getData();
    const cats = Array.isArray(data?.cats) ? data.cats : [];
    const existedTopSame = cats.some(c => (c?.name || '').trim() === finalName);
    if (existedTopSame) {
      // 使用错误提示 toast（项目内已有 showToast）
      showToast('已有相同的一级类别名称', { type: 'error', duration: 1500 });
      return;
    }
  }

  const TYPE_CLASS_TEXT = 2;
  try {
    const payload = { useScope, title: finalName, typeClass: TYPE_CLASS_TEXT };
    payload.pid = Number(parentId); // 有父类则创建二级；0 表示创建一级
    await API.content.addByMe(payload);

    // 不再本地 cats.push / setActiveCat，直接强制从远端刷新（让后端数据为准）
    await loadRemotePhrasesText(true);
    renderCats();
    renderList();
  } catch (e) {
    console.warn('创建类别失败：', e);
    if (isServerUnavailableError(e)) setPhrasesUnavailable(true);
    showToast((e && e.message) || '创建类别失败', { type: 'error', duration: 1500 });
  }
}

  // 添加短语：不做本地 push，成功后刷新远端数据
// 覆盖 addPhrase：新增“标题”输入框，提交时携带 { title, content } 两个字段
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

  // 弹框：标题 + 内容
  const phrase = await uiAddPhraseDialog({
    catName: activeCat
  });
  if (!phrase) return;
  const { title, content } = phrase;
  const finalTitle = (title || '').trim();
  const finalContent = (content || '').trim();
  if (!finalContent) {
    showToast('内容不能为空', { type: 'error', duration: 1500 });
    return;
  }

  let typeId = allTypeIdMap[currentTab][activeCat];
  const TYPE_CLASS_TEXT = 2;
  try {
    if (!typeId) {
      // 若本地未缓存到该类别的 id，则走创建（后端会按 useScope+title 识别/创建类别）
      await API.content.addByMe({
        useScope,
        title: finalTitle,       // 短语标题
        content: finalContent,   // 短语内容
        typeClass: TYPE_CLASS_TEXT,
        // 注意：这里没有 contentTypeId，后端将根据 activeCat 创建或匹配类别（如你的后端需要 pid 或类别名，请相应扩展）
      });
    } else {
      // 已知类别 id，直接向该类别添加短语
      await API.content.addByMe({
        useScope,
        contentTypeId: typeId,   // 目标类别
        title: finalTitle,       // 短语标题
        content: finalContent,   // 短语内容
        typeClass: TYPE_CLASS_TEXT,
      });
    }
    await loadRemotePhrasesText(true); // 强制刷新当前tab数据
  } catch (e) {
    console.warn('添加短语失败：', e);
    if (isServerUnavailableError(e)) setPhrasesUnavailable(true);
    showToast((e && e.message) || '添加短语失败', { type: 'error', duration: 1500 });
  }
}

// 新增：添加短语弹框（标题 + 内容），返回 { title, content } 或 null
async function uiAddPhraseDialog(opts) {
  const options = Object.assign({ catName: '' }, opts || {});
  return new Promise(resolve => {
    const mask = document.createElement('div');
    mask.className = 'prompt-mask';
    mask.innerHTML = `
      <div class="prompt-dialog" role="dialog" aria-modal="true" style="width:480px;max-width:90vw;">
        <div class="prompt-title" style="font-size:15px;margin-bottom:10px;">添加短语（${options.catName || ''}）</div>
        <div class="prompt-body" style="display:flex;flex-direction:column;gap:10px;">
          <div class="field">
            <label style="display:block;font-size:13px;color:#555;margin-bottom:6px;">标题</label>
            <input type="text" class="phrase-title" placeholder="请输入标题（可选）" style="width:100%;padding:8px;border:1px solid #ccc;border-radius:6px;font-size:13px;" />
          </div>
          <div class="field">
            <label style="display:block;font-size:13px;color:#555;margin-bottom:6px;">内容</label>
            <textarea class="phrase-content" rows="6" placeholder="请输入短语内容" style="width:100%;box-sizing:border-box;line-height:1.5;min-height:120px;resize:vertical;"></textarea>
          </div>
        </div>
        <div class="prompt-actions" style="margin-top:12px;display:flex;justify-content:flex-end;gap:8px;">
          <button class="btn-cancel" type="button">取消</button>
          <button class="btn-ok" type="button" disabled style="opacity:.5;cursor:not-allowed;">确定</button>
        </div>
      </div>`;
    document.body.appendChild(mask);

    const dialog = mask.querySelector('.prompt-dialog');
    const inputTitle = mask.querySelector('.phrase-title');
    const inputContent = mask.querySelector('.phrase-content');
    const btnOk = mask.querySelector('.btn-ok');
    const btnCancel = mask.querySelector('.btn-cancel');

    function updateState() {
      const content = (inputContent.value || '').trim();
      btnOk.disabled = !content;
      btnOk.style.opacity = content ? '1' : '.5';
      btnOk.style.cursor = content ? 'pointer' : 'not-allowed';
    }
    inputContent.addEventListener('input', updateState);
    inputTitle.addEventListener('input', updateState);
    updateState();
    setTimeout(() => { inputContent.focus(); }, 0);

    function close(val) {
      if (mask && mask.parentNode) mask.parentNode.removeChild(mask);
      resolve(val);
    }
    btnCancel.onclick = () => close(null);
    btnOk.onclick = () => {
      if (btnOk.disabled) return;
      const title = (inputTitle.value || '').trim();
      const content = (inputContent.value || '').trim();
      close({ title, content });
    };
    mask.addEventListener('click', e => { if (e.target === mask) close(null); });
    dialog.addEventListener('click', e => e.stopPropagation());
    mask.addEventListener('keydown', e => {
      if (e.key === 'Escape') close(null);
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !btnOk.disabled) btnOk.click();
    });
  });
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
  // 右键菜单通用创建函数（添加到文件靠后位置，init 之前即可）
  function showContextMenu(x, y, items) {
    let m = document.getElementById('phrases-context-menu');
    if (m) m.remove();
    m = document.createElement('div');
    m.id = 'phrases-context-menu';
    m.style.cssText =
      'position:fixed;z-index:3000;min-width:120px;background:#fff;border:1px solid #ccc;box-shadow:0 4px 16px rgba(0,0,0,.15);';
    m.style.left = x + 'px';
    m.style.top = y + 'px';
    m.innerHTML = items.map(it =>
      `<div class="ctx-item" data-act="${it.act}" style="padding:6px 12px;cursor:pointer;font-size:13px;white-space:nowrap;">${it.label}</div>`
    ).join('');
    document.body.appendChild(m);
    m.addEventListener('click', e => {
      const item = e.target.closest('.ctx-item');
      if (!item) return;
      const act = item.dataset.act;
      const def = items.find(i => i.act === act);
      if (def && typeof def.onClick === 'function') def.onClick();
      m.remove();
    });
    document.addEventListener('click', () => m.remove(), {
      once: true
    });
  }

  function init() {
    // 显示公司tab
    switchTab(currentTab);
    // 已登录时拉远端数据
    try {
      const tk = (window.API && API.getToken && API.getToken()) || '';
      if (tk) loadRemotePhrasesText();
    } catch {}
    bindContextMenus();
  }
  // 新增：添加类别弹框（父类下拉 + 单行文本），返回 { parentId, name } 或 null
  async function uiAddCategoryDialog(opts) {
    const options = Object.assign({ parents: [], tabLabel: '' }, opts || {});
    return new Promise(resolve => {
      const mask = document.createElement('div');
      mask.className = 'prompt-mask';
      mask.innerHTML = `
        <div class="prompt-dialog" role="dialog" aria-modal="true" style="width:420px;max-width:90vw;">
          <div class="prompt-title" style="font-size:15px;margin-bottom:10px;">添加类别（${options.tabLabel || ''}）</div>
          <div class="prompt-body" style="display:flex;flex-direction:column;gap:10px;">
            <div class="field">
              <label style="display:block;font-size:13px;color:#555;margin-bottom:6px;">父类</label>
              <select class="parent-select" style="width:100%;padding:8px;border:1px solid #ccc;border-radius:6px;font-size:13px;">
                ${options.parents.map(p => `<option value="${p.id}">${p.title}</option>`).join('')}
              </select>
            </div>
            <div class="field">
              <label style="display:block;font-size:13px;color:#555;margin-bottom:6px;">类别名称</label>
              <input type="text" class="cat-input" placeholder="请输入类别名称" style="width:100%;padding:8px;border:1px solid #ccc;border-radius:6px;font-size:13px;" />
            </div>
          </div>
          <div class="prompt-actions" style="margin-top:12px;display:flex;justify-content:flex-end;gap:8px;">
            <button class="btn-cancel" type="button">取消</button>
            <button class="btn-ok" type="button" disabled style="opacity:.5;cursor:not-allowed;">确定</button>
          </div>
        </div>`;
      document.body.appendChild(mask);
  
      const dialog = mask.querySelector('.prompt-dialog');
      const sel = mask.querySelector('.parent-select');
      const input = mask.querySelector('.cat-input');
      const btnOk = mask.querySelector('.btn-ok');
      const btnCancel = mask.querySelector('.btn-cancel');
  
      function updateState() {
        const name = (input.value || '').trim();
        btnOk.disabled = !name;
        btnOk.style.opacity = name ? '1' : '.5';
        btnOk.style.cursor = name ? 'pointer' : 'not-allowed';
      }
      input.addEventListener('input', updateState);
      updateState();
      setTimeout(() => { input.focus(); }, 0);
  
      function close(val) {
        if (mask && mask.parentNode) mask.parentNode.removeChild(mask);
        resolve(val);
      }
      btnCancel.onclick = () => close(null);
      btnOk.onclick = () => {
        if (btnOk.disabled) return;
        const parentId = Number(sel.value || 0);
        const name = (input.value || '').trim();
        close({ parentId, name });
      };
      mask.addEventListener('click', e => { if (e.target === mask) close(null); });
      dialog.addEventListener('click', e => e.stopPropagation());
      mask.addEventListener('keydown', e => {
        if (e.key === 'Escape') close(null);
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !btnOk.disabled) btnOk.click();
      });
    });
  }
  // 编辑弹框（带禁用确定逻辑）
  async function uiEditPrompt(initial, title) {
    const mask = document.createElement('div');
    mask.className = 'prompt-mask';
    mask.innerHTML = `
  <div class="prompt-dialog" role="dialog" aria-modal="true" style="width:420px;max-width:90vw;">
    <div class="prompt-title" style="font-size:15px;margin-bottom:10px;">${title || '编辑'}</div>
    <div class="prompt-body">
      <textarea class="prompt-input" rows="6" style="width:100%;box-sizing:border-box;line-height:1.5;"></textarea>
    </div>
    <div class="prompt-actions" style="margin-top:12px;display:flex;justify-content:flex-end;gap:8px;">
      <button class="btn-cancel" type="button">取消</button>
      <button class="btn-ok" type="button" disabled style="opacity:.5;cursor:not-allowed;">确定</button>
    </div>
  </div>`;
    document.body.appendChild(mask);
    const dialog = mask.querySelector('.prompt-dialog');
    const input = mask.querySelector('.prompt-input');
    const btnOk = mask.querySelector('.btn-ok');
    const btnCancel = mask.querySelector('.btn-cancel');
    input.value = initial || '';
    input.focus();

    function updateState() {
      const changed = input.value.trim() !== (initial || '').trim();
      btnOk.disabled = !changed;
      btnOk.style.opacity = changed ? '1' : '.5';
      btnOk.style.cursor = changed ? 'pointer' : 'not-allowed';
    }
    input.addEventListener('input', updateState);
    updateState();
    return new Promise(resolve => {
      function close(val) {
        mask.remove();
        resolve(val);
      }
      btnCancel.onclick = () => close(null);
      btnOk.onclick = () => {
        if (btnOk.disabled) return;
        close(input.value.trim());
      };
      mask.addEventListener('click', e => {
        if (e.target === mask) close(null);
      });
      dialog.addEventListener('click', e => e.stopPropagation());
      mask.addEventListener('keydown', e => {
        if (e.key === 'Escape') close(null);
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !btnOk.disabled) btnOk.click();
      });
    });
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
// 覆盖：loadRemotePhrasesText（含日志 + 兼容 types 返回的嵌套 type.data）
async function loadRemotePhrasesText(force = false) {
  const TYPE_CLASS_TEXT = 2;
  try {
    setPhrasesUnavailable(false);
    const prevActive = getActiveCat(); // 记录当前激活
    const resp = await API.content.types({ typeClass: TYPE_CLASS_TEXT });
    const grouped = (resp && resp.data) || {};
    console.log('[phrases] types resp grouped=', grouped);

    let typesArr = [];
    const tabKey = currentTab;
    if (tabKey === 'corp') typesArr = grouped.company || grouped.corp || grouped['公司'] || [];
    else if (tabKey === 'group') typesArr = grouped.team || grouped.group || grouped['小组'] || [];
    else if (tabKey === 'private') typesArr = grouped.personal || grouped.private || grouped['私人'] || [];
    console.log('[phrases] tabKey=', tabKey, 'typesArr.len=', Array.isArray(typesArr) ? typesArr.length : -1);

    allTypeIdMap[tabKey] = {};
    const cats = [];
    (typesArr || []).forEach(t => {
      const typeId = t.id || t.typeId || t.contentTypeId;
      const title = t.title || t.name || ('分类-' + (typeId ?? ''));
      const hasNested = !!(t && t.type && Array.isArray(t.type.data));
      const nestedLen = hasNested ? t.type.data.length : 0;
      console.log('[phrases] type item title=', title, 'id=', typeId, 'has nested=', hasNested, 'nested.len=', nestedLen);

      if (!typeId) return;
      cats.push({ name: title, id: typeId, items: [], _loaded: false });

      // 兼容 types 返回的嵌套内容：t.type.data
      if (hasNested) {
        const last = cats[cats.length - 1]; // 刚 push 的类别
        last.items = t.type.data.map(i => ({
          id: i.id || i.contentId || i.cid,
          title: (i.title || i.contentTitle || '').trim(),
          text: (i.content || i.text || '').trim(), // 保持与 renderList 的 text 字段一致
        })).filter(o => o.text);
        last._loaded = true; // 已有内容，不再调用 list
        console.log('[phrases] filled from types nested ->', last.name, 'items.len=', last.items.length);
      }

      allTypeIdMap[tabKey][title] = typeId;
    });

    // 如果之前激活的类别不在远端返回（刚建还没刷新），把本地的插入进去
    if (prevActive && !cats.find(c => c.name === prevActive)) {
      const localExisting = allData[tabKey].cats.find(c => c.name === prevActive);
      if (localExisting) {
        cats.push({
          name: localExisting.name,
          id: localExisting.id || 0,
          items: localExisting.items || [],
          _loaded: localExisting._loaded || false
        });
      }
    }

    allData[tabKey] = { cats };

    // 选中：如果 prevActive 仍存在则保留，否则选第一个
    let active = prevActive && cats.find(c => c.name === prevActive) ? prevActive : (cats[0]?.name || '');
    if (active && active !== getActiveCat()) setActiveCat(active);

    renderCats();
    if (active) await loadCatItemsByName(active);
    renderList();
    bindContextMenus();
    if (cats.length > 0) setPhrasesUnavailable(false);
  } catch (e) {
    console.warn('加载类别和话术失败：', e);
    if (isServerUnavailableError(e)) setPhrasesUnavailable(true);
  }
}

// 覆盖：loadCatItemsByName（含日志 + 兼容 list 返回嵌套结构）
async function loadCatItemsByName(catName) {
  const TYPE_CLASS_TEXT = 2;
  const data = getData();
  if (!data || !data.cats || !data.cats.length) return;

  const cat = data.cats.find(c => c.name === catName);
  console.log('[phrases] loadCatItemsByName catName=', catName, 'cat.id=', cat?.id, 'alreadyLoaded=', !!cat?._loaded);
  if (!cat || cat._loaded) return; // 已加载过则跳过

  const typeId = cat.id;
  if (!typeId) return;
  try {
    const listResp = await API.content.list({ typeClass: TYPE_CLASS_TEXT, typeId });
   // 替换 loadCatItemsByName 里解析 listResp 的片段为以下内容：
   const raw = (listResp && listResp.data) || [];
   // 情况1：data 直接是内容数组
   let arr = Array.isArray(raw) ? raw : [];
   // 情况2：data 是数组，但元素里包着 { type: { data: [...] } }
   if (Array.isArray(raw) && raw.length === 1 && raw[0] && raw[0].type && Array.isArray(raw[0].type.data)) {
     arr = raw[0].type.data;
   }
   // 情况3：data 是对象，内部有 { type: { data: [...] } }
   if (!Array.isArray(raw) && raw && raw.type && Array.isArray(raw.type.data)) {
     arr = raw.type.data;
   }
   
   cat.items = arr.map(i => ({
     id: i.id || i.contentId || i.cid,
     title: (i.title || i.contentTitle || '').trim(),
     text: (i.content || i.text || '').trim(), // renderList 使用 text 字段
   })).filter(o => o.text);
   
   console.log('[phrases] cat.items.len=', cat.items.length, 'first=', cat.items[0]);
   cat._loaded = true;
   setPhrasesUnavailable(false);
  } catch (e) {
    console.warn('加载类别话术列表失败：', e);
    if (isServerUnavailableError(e)) setPhrasesUnavailable(true);
  }
}

  // 新增：根据当前激活类别获取对象
  function getCurrentCatObj() {
    const data = getData();
    const active = getActiveCat();
    if (!data || !active) return null;
    return data.cats.find(c => c.name === active);
  }
  // 权限判断复用
  function canEditDelete(tab) {
    if (tab === 'private') return true;
    if (tab === 'group') return currentUserIsAdmin();
    return false;
  }

  // 绑定右键事件（在 init() 最后或 renderCats/renderList 后调用一次）
  function bindContextMenus() {
    // 类别右键
    ['corp', 'group', 'private'].forEach(t => {
      const wrap = document.getElementById('phrase-cats-' + t);
      if (!wrap) return;
      // 在 bindContextMenus 内，替换“类别右键”里从获取 count 开始到 showContextMenu 之间的代码
      wrap.oncontextmenu = (e) => {
        const btn = e.target.closest('.cat');
        if (!btn) return;
        if (!canEditDelete(t)) return; // 权限
        e.preventDefault();

        const catName = btn.dataset.cat;
        const catId = btn.dataset.id;

        // 用当前内存数据计算条数，避免 dataset 不准
        const dataTab = getData();
        const catObj = dataTab?.cats?.find(c => c.name === catName);
        const count = Array.isArray(catObj?.items) ? catObj.items.length : 0;

        const items = [];

        // 编辑
        items.push({
          label: '编辑类别',
          act: 'edit',
          onClick: async () => {
            const newTitle = await uiEditPrompt(catName, '编辑类别名称');
            if (!newTitle || newTitle === catName) return;
            try {
              const resp = await API.post('/api/front/content/updateType', {
                id: Number(catId),
                title: newTitle
              });
              if (!resp || resp.status !== 'success') {
                showToast(resp?.message || '修改失败', {
                  type: 'error',
                  duration: 1500
                });
                return;
              }
              // 本地立即更新与重渲染
              if (catObj) catObj.name = newTitle;
              setActiveCat(newTitle);
              renderCats();
              renderList();
              showToast('修改成功');
              // 后台同步刷新
              loadRemotePhrasesText(true);
            } catch (err) {
              alert(err.message || '修改失败');
            }
          }
        });

        // 删除（始终显示；若有内容则提示先删除内容）
        items.push({
          label: count > 0 ? '删除类别' : '删除类别',
          act: 'del',
          onClick: async () => {
            if (count > 0) {
              showToast('该类别里面有内容，请先删除内容', {
                duration: 1500
              });
              return;
            }
            const ok = await uiConfirm({
              title: '删除类别',
              message: `确定删除类别【${catName}】吗？（不可恢复）`,
              okText: '删除',
              danger: true
            });
            if (!ok) return;

            try {
              const resp = await API.post('/api/front/content/delType', {
                id: Number(catId)
              });
              if (!resp || resp.status !== 'success') {
                showToast(resp?.message || '删除失败', {
                  type: 'error',
                  duration: 1500
                });
                return;
              }
              // 本地立即移除并重渲染
              if (dataTab?.cats) {
                dataTab.cats = dataTab.cats.filter(c => String(c.id) !== String(catId));
                const first = dataTab.cats[0]?.name || '';
                setActiveCat(first);
              }
              renderCats();
              renderList();
              showToast('删除成功');
              // 后台同步刷新
              loadRemotePhrasesText(true);
            } catch (err) {
              showToast(resp?.message || '删除失败', {
                type: 'error',
                duration: 1500
              });
            }
          }
        });

        showContextMenu(e.pageX, e.pageY, items);
      };
    });

    // 短语右键（仅 group/private）
    ['group', 'private'].forEach(t => {
      const listWrap = document.getElementById('phrase-list-' + t);
      if (!listWrap) return;
      listWrap.oncontextmenu = (e) => {
        const item = e.target.closest('.phrase-item');
        if (!item) return;
        if (!canEditDelete(t)) return;
        e.preventDefault();
    
        const id = item.dataset.id;
        const initialText = item.dataset.content || ''; // 内容
        const initialTitle = item.dataset.title || '';  // 标题
        if (!id) return;
    
        const items = [
          {
            label: '编辑短语',
            act: 'edit',
            onClick: async () => {
              const edited = await uiEditPhraseDialog(initialTitle, initialText);
              if (!edited) return;
              const { title, content } = edited;
              try {
                const resp = await API.post('/api/front/content/updateContent', {
                  id: Number(id),
                  content, // 新内容
                  title    // 新标题（确保后端 FrontUpdateContentReq 支持 title 字段）
                });
                if (!resp || resp.status !== 'success') {
                  showToast(resp?.message || '修改失败', { type: 'error', duration: 1500 });
                  return;
                }
                // 本地立即更新并重渲染
                const catObj = getCurrentCatObj();
                if (catObj && Array.isArray(catObj.items)) {
                  const it = catObj.items.find(x => String(x.id) === String(id));
                  if (it) {
                    it.text = content;
                    it.title = title;
                  }
                }
                renderList();
                showToast('修改成功', { type: 'success' });
                // 后台再拉一次该类别以校准（可选）
                loadCatItemsByName(getActiveCat());
              } catch (err) {
                showToast(err.message || '修改失败', { type: 'error', duration: 1500 });
              }
            }
          },
          {
            label: '删除短语',
            act: 'del',
            onClick: async () => {
              const ok = await uiConfirm({
                title: '删除短语',
                message: '确定删除该短语吗？（不可恢复）',
                okText: '删除',
                danger: true
              });
              if (!ok) return;
    
              // 本地先移除实现“立即消失”，失败再回滚
              const catObj = getCurrentCatObj();
              let backup = null, idx = -1;
              if (catObj && Array.isArray(catObj.items)) {
                idx = catObj.items.findIndex(x => String(x.id) === String(id));
                if (idx >= 0) {
                  backup = catObj.items[idx];
                  catObj.items.splice(idx, 1);
                  renderList();
                }
              }
              try {
                const resp = await API.post('/api/front/content/delContent', { id: Number(id) });
                if (!resp || resp.status !== 'success') {
                  if (backup && catObj && idx >= 0) {
                    catObj.items.splice(idx, 0, backup);
                    renderList();
                  }
                  showToast(resp?.message || '删除失败', { type: 'error', duration: 1500 });
                  return;
                }
                showToast('删除成功', { type: 'success' });
                // 可选：后台同步刷新该类别
                loadCatItemsByName(getActiveCat());
              } catch (err) {
                if (backup && catObj && idx >= 0) {
                  catObj.items.splice(idx, 0, backup);
                  renderList();
                }
                showToast(err.message || '删除失败', { type: 'error', duration: 1500 });
              }
            }
          }
        ];
        showContextMenu(e.pageX, e.pageY, items);
      };
    });
  }


  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  
  window.__openPhrasesPanel = function () {
    // 不改 currentTab，保持它是 corp / group / private 中上一次的值
    switchTab(currentTab);  // 这里会 render + loadRemotePhrasesText()
  };
})();