(function() {
  const { ipcRenderer } = require('electron');
  const path = require('path');
  const fs = require('fs');

  const NET_CATEGORIES = [
    "热门", "邀好评图", "售中", "砍价", "客服", "包邮", "有趣", "招呼",
    "爱你", "抱歉", "纠结", "可爱", "哭", "亲", "稍等", "生气", "笑", "谢谢"
  ];
  const EMOJIS_BASE = "D:/emojis/";
  const TYPE_CLASS_EMOJI = 1;
  let currentTab = "net"; // net/corp/group/private
  let currentCat = NET_CATEGORIES[0];
  let customCats = {
    corp: [],
    group: [],
    private: []
  };
  const remoteCats = {
    corp: [],
    group: [],
    private: []
  }; // 类别名数组
  const remoteTypeIdMap = {
    corp: {},
    group: {},
    private: {}
  }; // 名称->typeId
  const remoteItems = {
    corp: {},
    group: {},
    private: {}
  }; // 名称->图片对象数组
  const remoteLoaded = {
    corp: {},
    group: {},
    private: {}
  };
  const uploadStatus = {
    group: {},
    private: {}
  };

  function storageKey(tab) {
    return `emojis.cats.${tab}.v1`;
  }
  function loadCustomCats(tab) {
    try {
      let raw = localStorage.getItem(storageKey(tab));
      if (!raw) return [];
      let arr = JSON.parse(raw);
      if (Array.isArray(arr)) return arr;
    } catch {}
    return [];
  }
  function saveCustomCats(tab) {
    try {
      localStorage.setItem(storageKey(tab), JSON.stringify(customCats[tab]));
    } catch {}
  }

  function renderTabBar() {
    document.querySelectorAll('.emo-tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === currentTab);
    });
    document.querySelectorAll('.tabpane').forEach(pane => {
      pane.classList.toggle('active', pane.id === `emo-tab-${currentTab}`);
      pane.setAttribute('aria-hidden', pane.id !== `emo-tab-${currentTab}` ? "true" : "false");
    });
  }

  function renderAllEmojiCatsBar() {
    ['net', 'corp', 'group', 'private'].forEach(tab => {
      const catsBar = document.getElementById(`emoji-cats-${tab}`);
      if (!catsBar) return;
      if (tab !== currentTab) {
        catsBar.innerHTML = "";
        return;
      }
      if (tab === 'net') {
        catsBar.innerHTML = NET_CATEGORIES.map(cat =>
          `<button class="emo-cat-btn${cat === currentCat ? ' active' : ''}" data-cat="${cat}">${cat}</button>`
        ).join('');
      } else {
        const cats = remoteCats[tab] || [];
        const cur = currentCat;
        let html = cats.map(cat =>
          `<button class="emo-cat-btn${cat === cur ? ' active' : ''}" data-cat="${cat}">${cat}</button>`
        ).join('');
        if (tab === 'group' || tab === 'private') {
          html += `<button class="emo-cat-add-btn" title="添加类别">＋</button>`;
        }
        catsBar.innerHTML = html;
      }
    });
  }

  function renderAllEmojiLists() {
    ['net', 'corp', 'group', 'private'].forEach(tab => {
      const grid = document.getElementById(`emoji-list-${tab}`);
      if (!grid) return;
      if (tab !== currentTab) {
        grid.innerHTML = "";
        return;
      }
      renderEmojiList(tab, currentCat);
    });
  }

  function renderEmojiList(tab, cat) {
    const grid = document.getElementById(`emoji-list-${tab}`);
    if (!grid) return;
    grid.innerHTML = '';
    if (!cat) {
      grid.innerHTML = `<div style="padding:20px;color:#999;">请选择类别</div>`;
      return;
    }
    grid.style.display = 'grid';
    grid.style.gridTemplateColumns = 'repeat(auto-fill, 80px)';
    grid.style.gap = '10px';
    grid.style.alignContent = 'start';
    grid.style.justifyContent = 'start';

    if (tab !== 'net') {
      if (!remoteLoaded[tab][cat]) {
        grid.innerHTML = `<div style="padding:20px;color:#999;">加载中...</div>`;
        loadRemoteItems(tab, cat).then(() => {
          if (tab === currentTab && currentCat === cat) renderEmojiList(tab, cat);
        });
        return;
      }
    
      const items = remoteItems[tab][cat] || [];
      if (!items.length && !canUploadTo(tab)) {
        grid.innerHTML = `<div style="padding:20px;color:#999;">暂无表情图片</div>`;
        return;
      }
    
      const frag = document.createDocumentFragment();
    
      // ==== 上传按钮放最前面 ====
      if (canUploadTo(tab)) {
        const uploading = uploadStatus[tab][cat] === 'uploading';
        const add = document.createElement('div');
        add.className = 'media-thumb';
        add.style.cssText = 'width:80px;height:80px;display:flex;flex-direction:column;align-items:center;justify-content:center;border:1px dashed #d0d0d0;border-radius:6px;cursor:pointer;user-select:none;font-size:24px;position:relative;';
        add.title = uploading ? '正在上传...' : '上传图片（可多选）';
    
        if (uploading) {
          add.innerHTML = `
            <div style="font-size:12px;color:#666;display:flex;flex-direction:column;align-items:center;gap:6px;">
              <div class="spinner" style="width:22px;height:22px;border:3px solid #ccc;border-top-color:#4aa;border-radius:50%;animation:emo-spin 0.8s linear infinite;"></div>
              <div>上传中...</div>
            </div>`;
          add.style.cursor = 'not-allowed';
        } else {
          add.textContent = '+';
        }
    
        const inp = document.createElement('input');
        inp.type = 'file';
        inp.accept = 'image/*';
        inp.multiple = true;
        inp.style.display = 'none';
        add.appendChild(inp);
    
        if (!uploading) {
          add.addEventListener('click', () => inp.click());
          inp.addEventListener('change', (e) => {
            const files = Array.from(e.target.files || []);
            if (!files.length) {
              inp.value = '';
              return;
            }
            // 标记上传中并重绘
            uploadStatus[tab][cat] = 'uploading';
            renderEmojiList(tab, cat);
            handleUploadFiles(files, tab, cat);
            inp.value = '';
          });
        }
    
        frag.appendChild(add);
      }
    
      // ==== 再渲染图片 ====
      items.forEach(obj => {
        const url = obj.url;
        const div = document.createElement('div');
        div.className = 'media-thumb';
        div.title = "点击粘贴";
        div.style.cssText = 'width:80px;height:80px;display:flex;align-items:center;justify-content:center;overflow:hidden;border-radius:6px;';
        const img = document.createElement('img');
        img.className = 'emoji-img';
        img.src = url;
        img.dataset.path = url;
        if (obj.id != null) img.dataset.id = obj.id;
        try { img.dataset.all = JSON.stringify(obj._all || [url]); } catch {}
        img.style.cssText = 'width:80px;height:80px;object-fit:contain;';
        div.appendChild(img);
        frag.appendChild(div);
      });
    
      grid.appendChild(frag);
      return;
    }
    // 本地 net
    const dir = path.join(EMOJIS_BASE, tab, cat);
    let files = [];
    try {
      if (fs.existsSync(dir)) {
        files = fs.readdirSync(dir)
          .filter(f => /\.(png|jpe?g|gif|webp|bmp)$/i.test(f))
          .map(f => path.join(dir, f));
      }
    } catch (e) {
      grid.innerHTML = `<div style="padding:20px;color:#f00;">无法读取表情目录：${dir}</div>`;
      return;
    }
    if (files.length === 0) {
      grid.innerHTML = `<div style="padding:20px;color:#999;">暂无表情图片</div>`;
      return;
    }
    const frag = document.createDocumentFragment();
    files.forEach(file => {
      const div = document.createElement('div');
      div.className = 'media-thumb';
      div.title = "点击粘贴，右键删除";
      div.style.cssText = 'width:80px;height:80px;display:flex;align-items:center;justify-content:center;overflow:hidden;border-radius:6px;';
      const img = document.createElement('img');
      img.className = 'emoji-img';
      img.src = "file:///" + file.replace(/\\/g, "/");
      img.dataset.path = file;
      img.style.cssText = 'width:80px;height:80px;object-fit:contain;';
      div.appendChild(img);
      frag.appendChild(div);
    });
    grid.appendChild(frag);
  }

  // 删除旧的提前绑定（保持空逻辑）
  ['net'].forEach(tab => {
    const grid = document.getElementById(`emoji-list-${tab}`);
    if (!grid) return;
  });

  // tab 切换
  async function switchTab(tab) {
    currentTab = tab;
    if (tab === 'net') {
      currentCat = NET_CATEGORIES[0];
    } else {
      await loadRemoteCats(tab); // 只拉类别
      currentCat = remoteCats[tab][0] || "";
    }
    renderTabBar();
    renderAllEmojiCatsBar();
    renderAllEmojiLists();
  }

  function canUploadTo(tab) {
    if (tab === 'private') return true;
    if (tab === 'group') {
      const u = (window.API && API.getUser && API.getUser()) || {};
      return !!(u.isGroupLeader || u.teamLeader || u.isAdmin ||
        (Array.isArray(u.roles) && (u.roles.includes('GROUP_LEADER') || u.roles.includes('TEAM_LEADER'))));
    }
    return false;
  }

  async function handleUploadFiles(files, tab, cat) {
    if (!files || !files.length) {
      // 没选文件也要清掉 “上传中” 状态（如果有）
      if (uploadStatus[tab] && uploadStatus[tab][cat]) {
        delete uploadStatus[tab][cat];
        renderEmojiList(tab, cat);
      }
      return;
    }
    const typeId = remoteTypeIdMap[tab][cat];
    const useScope = (tab === 'group') ? 1 : 2;
    const urls = [];
  
    for (const f of files) {
      if (!/^image\//.test(f.type)) continue;
      try {
        const resp = await API.files.upload(f);
        let url = '';
        if (typeof resp?.data === 'string') url = resp.data;
        else if (resp?.data?.url) url = resp.data.url;
        else if (resp?.data?.href) url = resp.data.href;
        else if (resp?.data?.path) url = resp.data.path;
        else if (resp?.url) url = resp.url;
        if (url) urls.push(url);
      } catch (err) {
        console.warn('上传失败：', err);
      }
    }
  
    if (!urls.length) {
      // 清除上传状态并重绘
      if (uploadStatus[tab] && uploadStatus[tab][cat]) {
        delete uploadStatus[tab][cat];
        renderEmojiList(tab, cat);
      }
      if (window.showToast) showToast('没有有效图片', { type: 'error', duration: 1500 });
      return;
    }
  
    try {
      for (const u of urls) {
        await API.content.addByMe({
          useScope,
          contentTypeId: typeId,
          content: u,
          typeClass: TYPE_CLASS_EMOJI
        });
      }
      // 上传成功后刷新该类别内容
      remoteLoaded[tab][cat] = false;
      await loadRemoteItems(tab, cat);
      if (window.showToast) showToast('上传成功', { type: 'success' });
    } catch (e) {
      console.warn('addByMe 提交失败：', e);
      if (window.showToast) showToast('上传失败', { type: 'error', duration: 1500 });
    } finally {
      // 清除上传状态并重绘
      if (uploadStatus[tab] && uploadStatus[tab][cat]) {
        delete uploadStatus[tab][cat];
      }
      renderEmojiList(tab, cat);
    }
  }

  async function switchCat(tab, cat) {
    currentCat = cat;
    renderAllEmojiCatsBar();
    if (tab === 'net') {
      renderAllEmojiLists();
      return;
    }
    await loadRemoteItems(tab, cat);
    renderAllEmojiLists();
  }

  function init() {
    ["corp", "group", "private"].forEach(tab => {
      customCats[tab] = loadCustomCats(tab);
    });
    renderTabBar();
    renderAllEmojiCatsBar();
    renderAllEmojiLists();
  }

  window.addEventListener('DOMContentLoaded', function() {
    init();
    // 单击/双击粘贴与发送
    ['net', 'corp', 'group', 'private'].forEach(tab => {
      const grid = document.getElementById(`emoji-list-${tab}`);
      if (!grid) return;
      if (!grid._clickBound) {
        let singleTimer = null;
        grid.addEventListener('click', (e) => {
          const img = e.target.closest('.emoji-img');
          if (!img) return;
          const url = img.dataset.path;
          if (!url) return;
          clearTimeout(singleTimer);
          singleTimer = setTimeout(() => {
            ipcRenderer.send('emoji:paste', url);
            singleTimer = null;
          }, 250);
        });
        grid.addEventListener('dblclick', (e) => {
          const img = e.target.closest('.emoji-img');
          if (!img) return;
          const url = img.dataset.path;
          if (!url) return;
            if (singleTimer) {
              clearTimeout(singleTimer);
              singleTimer = null;
            }
          ipcRenderer.send('emoji:paste-send', url);
        });
        grid._clickBound = true;
      }
      if (tab === 'net') {
        grid.oncontextmenu = function(e) {
          e.preventDefault();
          const img = e.target.closest('.emoji-img');
          if (img) {
            showContextMenu(e.pageX, e.pageY, [{
              label: '删除',
              click: () => deleteEmoji(img.dataset.path, tab, currentCat)
            }]);
          }
        };
      } else {
        grid.oncontextmenu = null;
      }
    });

    // 添加类别（group/private）——本地立即插入再异步校准
    ['net', 'corp', 'group', 'private'].forEach(tab => {
      const bar = document.getElementById(`emoji-cats-${tab}`);
      if (!bar) return;
      bar.onclick = async function(e) {
        if (uploadStatus[currentTab] && uploadStatus[currentTab][currentCat]) {
          showToast && showToast('正在上传，请稍候...', { type: 'info', duration: 1200 });
          return;
        }
        if (e.target.classList.contains('emo-cat-btn')) {
          switchCat(tab, e.target.dataset.cat);
        }
        if (e.target.classList.contains('emo-cat-add-btn')) {
          const name = await promptCategoryName();
          const title = (name || '').trim();
          if (!title) return;
          if (tab === 'group' || tab === 'private') {
            const useScope = (tab === 'group') ? 1 : 2;
            try {
              const resp = await API.content.addByMe({
                useScope,
                title,
                typeClass: TYPE_CLASS_EMOJI
              });
              if (!resp || resp.status !== 'success') {
                alert('创建类别失败');
                return;
              }
              // 解析新类别 ID（兼容不同字段）
              const rawType = resp.data || {};
              const newTypeId =
                rawType.id ||
                rawType.typeId ||
                rawType.contentTypeId ||
                rawType.cid ||
                rawType.contentTypeID ||
                null;

              // 本地立即插入（如果不存在）
              if (!remoteCats[tab].includes(title)) {
                remoteCats[tab].push(title);
                remoteTypeIdMap[tab][title] = newTypeId || 0;
                remoteItems[tab][title] = [];
                remoteLoaded[tab][title] = false;
              } else if (newTypeId && !remoteTypeIdMap[tab][title]) {
                remoteTypeIdMap[tab][title] = newTypeId;
              }

              currentCat = title;
              renderAllEmojiCatsBar();
              renderAllEmojiLists(); // 此时新类别还没有内容，显示“加载中”或空

              // 延迟再拉一次远端校准（避免后端延迟导致看不到）
              setTimeout(async () => {
                await loadRemoteCats(tab, true); // 传递 true 以执行“保留当前激活类别”逻辑
                // 如果当前激活类别仍在，保持并渲染；否则回退第一个
                if (!remoteCats[tab].includes(currentCat)) {
                  currentCat = remoteCats[tab][0] || '';
                }
                renderAllEmojiCatsBar();
                renderAllEmojiLists();
              }, 300);
            } catch (err) {
              console.warn('创建类别失败：', err);
              alert('创建类别失败');
            }
          } else if (tab === 'net') {
            // net 暂不支持在线添加（保留原逻辑占位）
          }
        }
      };
    });

    // 类别右键（公司不弹，小组需组长，私人都弹）
    ['corp', 'group', 'private'].forEach(tab => {
      const bar = document.getElementById(`emoji-cats-${tab}`);
      if (!bar) return;
      bar.oncontextmenu = async function(e) {
        const btn = e.target.closest('.emo-cat-btn');
        if (!btn) return;
        if (!canEditDeleteEmoji(tab)) return;
        e.preventDefault();
        const catName = btn.dataset.cat || btn.textContent.trim();
        const typeId = remoteTypeIdMap[tab][catName];
        if (!remoteLoaded[tab]?.[catName]) {
          try { await loadRemoteItems(tab, catName); } catch {}
        }
        const count = (remoteItems[tab]?.[catName] || []).length;
        const items = [
          {
            label: '编辑类别',
            click: async () => {
              const newTitle = await promptEditValue(catName, { title: '编辑类别名称', placeholder: '类别名称' });
              if (!newTitle || newTitle === catName) return;
              try {
                const resp = await API.post('/api/front/content/updateType', { id: Number(typeId), title: newTitle });
                if (!resp || resp.status !== 'success') {
                  if (window.showToast) showToast(resp?.message || '修改失败', { type: 'error', duration: 1500 });
                  return;
                }
                const idx = remoteCats[tab].indexOf(catName);
                if (idx >= 0) remoteCats[tab][idx] = newTitle;
                remoteTypeIdMap[tab][newTitle] = typeId;
                delete remoteTypeIdMap[tab][catName];
                remoteItems[tab][newTitle] = remoteItems[tab][catName] || [];
                remoteLoaded[tab][newTitle] = remoteLoaded[tab][catName];
                delete remoteItems[tab][catName];
                delete remoteLoaded[tab][catName];
                if (currentCat === catName && currentTab === tab) currentCat = newTitle;
                renderAllEmojiCatsBar();
                renderAllEmojiLists();
                if (window.showToast) showToast('修改成功', { type: 'success' });
              } catch (err) {
                if (window.showToast) showToast(err.message || '修改失败', { type: 'error', duration: 1500 });
              }
            }
          },
          {
            label: count > 0 ? '删除类别' : '删除类别',
            click: async () => {
              if (count > 0) {
                if (window.showToast) showToast('该类别里面有内容，请先删除内容', { type: 'error', duration: 1500 });
                return;
              }
              const ok = await uiConfirm({ title: '删除类别', message: `确定删除类别【${catName}】吗？（不可恢复）`, okText: '删除', danger: true });
              if (!ok) return;
              try {
                const resp = await API.post('/api/front/content/delType', { id: Number(typeId) });
                if (!resp || resp.status !== 'success') {
                  if (window.showToast) showToast(resp?.message || '删除失败', { type: 'error', duration: 1500 });
                  return;
                }
                remoteCats[tab] = remoteCats[tab].filter(n => n !== catName);
                delete remoteTypeIdMap[tab][catName];
                delete remoteItems[tab][catName];
                delete remoteLoaded[tab][catName];
                if (currentTab === tab && currentCat === catName) {
                  currentCat = (remoteCats[tab] || [])[0] || '';
                }
                renderAllEmojiCatsBar();
                renderAllEmojiLists();
                if (window.showToast) showToast('删除成功', { type: 'success' });
              } catch (err) {
                if (window.showToast) showToast(err.message || '删除失败', { type: 'error', duration: 1500 });
              }
            }
          }
        ];
        showContextMenu(e.pageX, e.pageY, items);
      };
    });

    // 远端图片右键菜单（公司不弹，小组需组长，私人都弹）
    ['corp', 'group', 'private'].forEach(tab => {
      const grid = document.getElementById(`emoji-list-${tab}`);
      if (!grid) return;
      if (!canEditDeleteEmoji(tab)) return;
      grid.oncontextmenu = async function(e) {
        const img = e.target.closest('.emoji-img');
        if (!img) return;
        e.preventDefault();
        const url = img.dataset.path || '';
        const cid = img.dataset.id ? Number(img.dataset.id) : null;
        let all = [];
        try { all = JSON.parse(img.dataset.all || '[]'); } catch {}
        const items = [
          {
            label: '编辑',
            click: async () => {
              const inp = document.createElement('input');
              inp.type = 'file';
              inp.accept = 'image/*';
              inp.style.display = 'none';
              document.body.appendChild(inp);
              inp.onchange = async (ev) => {
                const file = ev.target.files && ev.target.files[0];
                if (!file) { inp.remove(); return; }
                try {
                  const up = await API.files.upload(file);
                  let newUrl = '';
                  if (typeof up?.data === 'string') newUrl = up.data;
                  else if (up?.data?.url) newUrl = up.data.url;
                  else if (up?.data?.href) newUrl = up.data.href;
                  else if (up?.data?.path) newUrl = up.data.path;
                  else if (up?.url) newUrl = up.url;
                  if (!newUrl) {
                    showToast('上传失败：未返回URL', { type: 'error', duration: 1500 });
                    inp.remove();
                    return;
                  }
                  const nextArr = (all && all.length ? all.map(u => u === url ? newUrl : u) : [newUrl]);
                  const next = nextArr.join(',');
                  if (!cid) throw new Error('缺少内容ID，无法编辑');
                  const resp = await API.post('/api/front/content/updateContent', { id: cid, img: next, content: next });
                  if (!resp || resp.status !== 'success') {
                    showToast(resp?.message || '修改失败', { type: 'error', duration: 1500 });
                    inp.remove();
                    return;
                  }
                  const arr = remoteItems[tab][currentCat] || [];
                  const it = arr.find(o => String(o.id) === String(cid) && o.url === url);
                  if (it) {
                    it.url = newUrl;
                    it._all = nextArr;
                  }
                  img.dataset.path = newUrl;
                  img.src = newUrl;
                  img.dataset.all = JSON.stringify(nextArr);
                  showToast('修改成功', { type: 'success' });
                } catch (err) {
                  showToast(err.message || '上传失败', { type: 'error', duration: 1500 });
                } finally {
                  inp.remove();
                }
              };
              inp.click();
            }
          },
            {
              label: '删除',
              click: async () => {
                if (!cid) { showToast('缺少内容ID，无法删除', { type: 'error', duration: 1500 }); return; }
                const ok = await uiConfirm({ title: '删除图片', message: '确定删除该图片吗？（不可恢复）', okText: '删除', danger: true });
                if (!ok) return;
                const remains = (all || []).filter(u => u !== url);
                try {
                  if (remains.length > 0) {
                    const resp = await API.post('/api/front/content/updateContent', { id: cid, img: remains.join(','), content: remains.join(',') });
                    if (!resp || resp.status !== 'success') {
                      showToast(resp?.message || '删除失败', { type: 'error', duration: 1500 });
                      return;
                    }
                  } else {
                    const resp = await API.post('/api/front/content/delContent', { id: cid });
                    if (!resp || resp.status !== 'success') {
                      showToast(resp?.message || '删除失败', { type: 'error', duration: 1500 });
                      return;
                    }
                  }
                  const arr = remoteItems[tab][currentCat] || [];
                  const idx = arr.findIndex(o => String(o.id) === String(cid) && o.url === url);
                  if (idx >= 0) arr.splice(idx, 1);
                  renderEmojiList(tab, currentCat);
                  showToast('删除成功', { type: 'success' });
                } catch (err) {
                  showToast(err.message || '删除失败', { type: 'error', duration: 1500 });
                }
              }
            }
        ];
        showContextMenu(e.pageX, e.pageY, items);
      };
    });

    // 绑定拖拽导入
    ['net', 'corp', 'group', 'private'].forEach(tab => {
      const grid = document.getElementById(`emoji-list-${tab}`);
      if (!grid) return;
      grid.ondragover = function(e) {
        e.preventDefault();
        grid.classList.add('dragover');
      };
      grid.ondragleave = function() {
        grid.classList.remove('dragover');
      };
      grid.ondrop = function(e) {
        e.preventDefault();
        grid.classList.remove('dragover');
        const files = Array.from(e.dataTransfer.files);
        if (!files.length) return;
        files.forEach(file => {
          if (!/^image\//.test(file.type)) return;
          const reader = new FileReader();
          reader.onload = function(evt) {
            const buffer = Buffer.from(evt.target.result);
            const dir = path.join("D:/emojis", tab, currentCat || "默认");
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            const filename = `${Date.now()}_${file.name}`;
            fs.writeFileSync(path.join(dir, filename), buffer);
            renderEmojiList(tab, currentCat);
          };
          reader.readAsArrayBuffer(file);
        });
      };
    });

    document.getElementById('emo-tabbar').onclick = async function(e) {
      const btn = e.target.closest('.emo-tab-btn');
      if (btn) {
        const tab = btn.dataset.tab;
        if (tab !== currentTab) {
          await switchTab(tab);
        }
      }
    };
  });

  async function loadRemoteCats(tab, preserveActive = false) {
    const prevActive = preserveActive ? currentCat : '';
    const resp = await API.content.types({ typeClass: TYPE_CLASS_EMOJI });
    const grouped = (resp && resp.data) || {};
    let typesArr = [];
    if (tab === 'corp') typesArr = grouped.company || grouped.corp || grouped['公司'] || [];
    else if (tab === 'group') typesArr = grouped.team || grouped.group || grouped['小组'] || [];
    else if (tab === 'private') typesArr = grouped.personal || grouped.private || grouped['私人'] || [];

    remoteCats[tab] = [];
    remoteTypeIdMap[tab] = {};
    remoteItems[tab] = {};
    remoteLoaded[tab] = {};

    (typesArr || []).forEach(t => {
      const typeId = t.id || t.typeId || t.contentTypeId;
      const title = t.title || t.name || ('分类-' + (typeId ?? ''));
      if (!typeId || !title) return;
      remoteCats[tab].push(title);
      remoteTypeIdMap[tab][title] = typeId;
      remoteItems[tab][title] = [];
      remoteLoaded[tab][title] = false;
    });

    // 如果保留激活且远端暂未返回，尝试合并本地临时类别
    if (prevActive && !remoteCats[tab].includes(prevActive)) {
      remoteCats[tab].push(prevActive);
      if (!remoteTypeIdMap[tab][prevActive]) {
        remoteTypeIdMap[tab][prevActive] = 0; // 占位
      }
      if (!remoteItems[tab][prevActive]) remoteItems[tab][prevActive] = [];
      if (remoteLoaded[tab][prevActive] == null) remoteLoaded[tab][prevActive] = false;
    }
  }

  async function loadRemoteItems(tab, cat) {
    if (!cat || remoteLoaded[tab][cat]) return;
    const typeId = remoteTypeIdMap[tab][cat];
    if (!typeId) {
      remoteLoaded[tab][cat] = true;
      return;
    }
    const listResp = await API.content.list({ typeClass: TYPE_CLASS_EMOJI, typeId });
    const list = (listResp && listResp.data) || [];
    const items = [];
    list.forEach(i => {
      const cid = i?.id || i?.contentId || i?.cid;
      let parts = [];
      if (i && typeof i.img === 'string' && i.img) {
        parts = i.img.split(',').map(s => s.trim()).filter(Boolean);
      } else if (i?.url) {
        parts = [i.url];
      } else if (i?.content) {
        parts = String(i.content).split(',').map(s => s.trim()).filter(Boolean);
      }
      parts.forEach(u => items.push({ id: cid, url: u, _all: parts.slice() }));
    });
    remoteItems[tab][cat] = items;
    remoteLoaded[tab][cat] = true;
  }

  function deleteEmoji(filePath, tab, cat) {
    if (!filePath) return;
    if (confirm("确定要删除此表情图片吗？")) {
      try {
        fs.unlinkSync(filePath);
        renderEmojiList(tab, cat);
      } catch (e) {
        alert("删除失败：" + e.message);
      }
    }
  }

  function promptCategoryName() {
    return new Promise(resolve => {
      const mask = document.createElement('div');
      mask.className = 'prompt-mask';
      mask.innerHTML = `
      <div class="prompt-dialog" role="dialog" aria-modal="true">
        <div class="prompt-title">请输入新类别名称</div>
        <div class="prompt-body">
          <input class="prompt-input" type="text" placeholder="类别名称">
        </div>
        <div class="prompt-actions">
          <button class="btn-cancel" type="button">取消</button>
          <button class="btn-ok" type="button">确定</button>
        </div>
      </div>`;
      document.body.appendChild(mask);
      const dialog = mask.querySelector('.prompt-dialog');
      const input = mask.querySelector('.prompt-input');
      const btnOk = mask.querySelector('.btn-ok');
      const btnCancel = mask.querySelector('.btn-cancel');
      input.value = '';
      setTimeout(() => { input.focus(); }, 0);
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
      input.addEventListener('keydown', (e) => { e.stopPropagation(); });
    });
  }

  function showContextMenu(x, y, items) {
    let m = document.getElementById('emo-context-menu');
    if (m) m.remove();
    m = document.createElement('div');
    m.id = 'emo-context-menu';
    m.style.position = 'absolute';
    m.style.left = x + 'px';
    m.style.top = y + 'px';
    m.style.background = '#fff';
    m.style.border = '1px solid #ccc';
    m.style.boxShadow = '0 2px 12px #0003';
    m.style.zIndex = 3000;
    m.innerHTML = items.map(item =>
      `<div class="emo-menu-item" style="padding:8px 24px;cursor:pointer;">${item.label}</div>`
    ).join('');
    document.body.appendChild(m);
    m.onclick = (e) => {
      const idx = Array.from(m.children).indexOf(e.target);
      if (items[idx] && typeof items[idx].click === 'function') items[idx].click();
      m.remove();
    };
    document.addEventListener('click', () => m.remove(), { once: true });
  }

  function currentUserIsAdmin() {
    try {
      const u = (window.API && API.getUser && API.getUser()) || {};
      return Number(u.isAdmin) === 1;
    } catch {
      return false;
    }
  }

  function canEditDeleteEmoji(tab) {
    if (tab === 'corp') return false;
    if (tab === 'group') return canUploadTo('group');
    if (tab === 'private') return true;
    return false;
  }

  function promptEditValue(initial = '', { title = '编辑', placeholder = '' } = {}) {
    return new Promise(resolve => {
      const mask = document.createElement('div');
      mask.className = 'prompt-mask';
      mask.innerHTML = `
        <div class="prompt-dialog" role="dialog" aria-modal="true" style="width:420px;max-width:90vw;">
          <div class="prompt-title" style="font-size:15px;margin-bottom:10px;">${title}</div>
          <div class="prompt-body">
            <input class="prompt-input" type="text" placeholder="${placeholder}" style="width:100%;box-sizing:border-box;line-height:1.5;padding:8px 10px;border:1px solid #ddd;border-radius:6px;">
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
      setTimeout(() => input.focus(), 0);
      const update = () => {
        const changed = input.value.trim() !== String(initial || '').trim();
        btnOk.disabled = !changed;
        btnOk.style.opacity = changed ? '1' : '.5';
        btnOk.style.cursor = changed ? 'pointer' : 'not-allowed';
      };
      input.addEventListener('input', update);
      update();
      const close = (val) => { mask.remove(); resolve(val); };
      btnCancel.onclick = () => close(null);
      btnOk.onclick = () => { if (!btnOk.disabled) close(input.value.trim()); };
      mask.addEventListener('click', e => { if (e.target === mask) close(null); });
      dialog.addEventListener('click', e => e.stopPropagation());
      mask.addEventListener('keydown', e => {
        if (e.key === 'Escape') close(null);
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !btnOk.disabled) btnOk.click();
      });
    });
  }
})();