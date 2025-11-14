(function() {
  const {
    ipcRenderer
  } = require('electron');
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
  }; // 名称->图片URL数组
  const remoteLoaded = {
    corp: {},
    group: {},
    private: {}
  };
  // --- 自定义类别存取 ---
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

  // --- 渲染tab栏 ---
  function renderTabBar() {
    document.querySelectorAll('.emo-tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === currentTab);
    });
    // 显示对应panel
    document.querySelectorAll('.tabpane').forEach(pane => {
      pane.classList.toggle('active', pane.id === `emo-tab-${currentTab}`);
      pane.setAttribute('aria-hidden', pane.id !== `emo-tab-${currentTab}` ? "true" : "false");
    });
  }

  // --- 渲染所有类别栏，只刷新当前tab，其它tab类别栏清空 ---
  function renderAllEmojiCatsBar() {
    ['net', 'corp', 'group', 'private'].forEach(tab => {
      const catsBar = document.getElementById(`emoji-cats-${tab}`);
      if (tab !== currentTab) {
        catsBar.innerHTML = ""; // 其它tab类别栏清空
        return;
      }
      let html = '';
      if (tab === 'net') {
        html = NET_CATEGORIES.map(cat =>
          `<button class="emo-cat-btn${cat === currentCat ? ' active' : ''}" data-cat="${cat}">${cat}</button>`
        ).join('');
      } else {
        // 用远端类别；group/private 显示“＋”
        const cats = remoteCats[tab] || [];
        const cur = (tab === currentTab) ? currentCat : '';
        let html = cats.map(cat =>
          `<button class="emo-cat-btn${cat === cur ? ' active' : ''}" data-cat="${cat}">${cat}</button>`
        ).join('');
        if (tab === 'group' || tab === 'private') {
          html += `<button class="emo-cat-add-btn" title="添加类别">＋</button>`;
        }
        catsBar.innerHTML = html; // 别漏了这行
      }
    });
  }

  // --- 渲染所有emoji图片区，只刷新当前tab，其它tab图片区清空 ---
  function renderAllEmojiLists() {
    ['net', 'corp', 'group', 'private'].forEach(tab => {
      const grid = document.getElementById(`emoji-list-${tab}`);
      if (tab !== currentTab) {
        grid.innerHTML = ""; // 其它tab图片区清空
        return;
      }
      renderEmojiList(tab, currentCat);
    });
  }

  // --- 渲染当前tab的emoji图片区 ---
  // 替换整个 renderEmojiList 函数
  function renderEmojiList(tab, cat) {
    const grid = document.getElementById(`emoji-list-${tab}`);
    grid.innerHTML = '';
    if (!cat) {
      grid.innerHTML = `<div style="padding:20px;color:#999;">请选择类别</div>`;
      return;
    }

    // 80×80 的自适应网格：容器越宽，每行越多
    grid.style.display = 'grid';
    grid.style.gridTemplateColumns = 'repeat(auto-fill, 80px)'; // 每格 80px 自动填充
    // 注意：不要设置 gridAutoRows，避免额外的竖向滚动条
    grid.style.gap = '10px';
    grid.style.alignContent = 'start';
    grid.style.justifyContent = 'start';

    if (tab !== 'net') {
      // 远端（公司/小组/私人）
      if (!remoteLoaded[tab][cat]) {
        grid.innerHTML = `<div style="padding:20px;color:#999;">加载中...</div>`;
        loadRemoteItems(tab, cat).then(() => {
          if (tab === currentTab && currentCat === cat) renderEmojiList(tab, cat);
        });
        return;
      }

      const items = remoteItems[tab][cat] || [];
      // 只有在“没有图片 且 也没有上传权限”时显示暂无
      if (!items.length && !canUploadTo(tab)) {
        grid.innerHTML = `<div style="padding:20px;color:#999;">暂无表情图片</div>`;
        return;
      }

      const frag = document.createDocumentFragment();

      // 图片缩略图（固定 80×80）
      // 替换远端 items 渲染循环
      items.forEach(obj => {
        const url = obj.url;
        const div = document.createElement('div');
        div.className = 'media-thumb';
        div.title = "点击粘贴";
        div.style.width = '80px';
        div.style.height = '80px';
        div.style.display = 'flex';
        div.style.alignItems = 'center';
        div.style.justifyContent = 'center';
        div.style.overflow = 'hidden';
        div.style.borderRadius = '6px';

        const img = document.createElement('img');
        img.className = 'emoji-img';
        img.src = url;
        img.dataset.path = url; // 粘贴复用
        if (obj.id != null) img.dataset.id = obj.id;
        // 存下所属记录的“全部URL”，供编辑/删除时重构
        try {
          img.dataset.all = JSON.stringify(obj._all || [url]);
        } catch {}
        img.style.width = '80px';
        img.style.height = '80px';
        img.style.objectFit = 'contain';

        div.appendChild(img);
        frag.appendChild(div);
      });

      // 小组(组长)与私人显示“+ 上传”（固定 80×80）
      if (canUploadTo(tab)) {
        const add = document.createElement('div');
        add.className = 'media-thumb';
        add.title = '上传图片（可多选）';
        add.style.width = '80px';
        add.style.height = '80px';
        add.style.display = 'flex';
        add.style.alignItems = 'center';
        add.style.justifyContent = 'center';
        add.style.border = '1px dashed #d0d0d0';
        add.style.borderRadius = '6px';
        add.style.cursor = 'pointer';
        add.style.userSelect = 'none';
        add.style.fontSize = '24px';
        add.textContent = '+';

        const inp = document.createElement('input');
        inp.type = 'file';
        inp.accept = 'image/*';
        inp.multiple = true;
        inp.style.display = 'none';
        add.appendChild(inp);

        add.addEventListener('click', () => inp.click());
        inp.addEventListener('change', (e) => {
          const files = Array.from(e.target.files || []);
          handleUploadFiles(files, tab, cat);
          inp.value = ''; // 清空，允许再次选择
        });

        frag.appendChild(add);
      }

      grid.appendChild(frag);
      return;
    }

    // 本地（net）分支
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
      div.style.width = '80px';
      div.style.height = '80px';
      div.style.display = 'flex';
      div.style.alignItems = 'center';
      div.style.justifyContent = 'center';
      div.style.overflow = 'hidden';
      div.style.borderRadius = '6px';

      const img = document.createElement('img');
      img.className = 'emoji-img';
      img.src = "file:///" + file.replace(/\\/g, "/");
      img.dataset.path = file;
      img.style.width = '80px';
      img.style.height = '80px';
      img.style.objectFit = 'contain';

      div.appendChild(img);
      frag.appendChild(div);
    });
    grid.appendChild(frag);
  }
  ['net'].forEach(tab => {
    const grid = document.getElementById(`emoji-list-${tab}`);
    if (!grid) return;
    // 原有 dragover / drop 逻辑保持
  });

  // 右键菜单删除（仅 net）
  // 在 window.addEventListener('DOMContentLoaded', function() { init(); ... } 里面，init(); 后面紧跟添加这一段
  ['net', 'corp', 'group', 'private'].forEach(tab => {
    const grid = document.getElementById(`emoji-list-${tab}`);
    if (!grid) return;

    // 单击：只粘贴到企业微信输入框；双击：粘贴并发送
    

    // 右键菜单：仅 net 绑定删除；corp/group/private 不在此处绑定（避免覆盖前面“编辑/删除”菜单）
    if (tab === 'net') {
      grid.oncontextmenu = function(e) {
        e.preventDefault();
        const img = e.target.closest('.emoji-img');
        if (img) {
          showContextMenu(e.pageX, e.pageY, [{
            label: "删除",
            click: () => deleteEmoji(img.dataset.path, tab, currentCat)
          }]);
        }
      };
    } else {
      grid.oncontextmenu = null;
    }
  });
  // --- 切换tab ---
  async function switchTab(tab) {
    currentTab = tab;

    if (tab === 'net') {
      currentCat = NET_CATEGORIES[0];
    } else {
      // 在线拉取类别列表（只拉本tab的列表，不拉内容）
      await loadRemoteCats(tab);
      // 选择激活类别：无就留空，有就选第一个
      currentCat = remoteCats[tab][0] || "";
    }

    renderTabBar();
    renderAllEmojiCatsBar();
    renderAllEmojiLists(); // 列表渲染时对非net会按需拉取内容
  }

  function canUploadTo(tab) {
    if (tab === 'private') return true;
    if (tab === 'group') {
      const u = (window.API && API.getUser && API.getUser()) || {};
      // 兼容多种后端字段
      return !!(u.isGroupLeader || u.teamLeader || u.isAdmin ||
        (Array.isArray(u.roles) && (u.roles.includes('GROUP_LEADER') || u.roles.includes('TEAM_LEADER'))));
    }
    return false; // corp 默认不可上传
  }

  async function handleUploadFiles(files, tab, cat) {
    if (!files || !files.length) return;
    const typeId = remoteTypeIdMap[tab][cat];
    const useScope = (tab === 'group') ? 1 : 2; // group=1, private=2

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
    if (!urls.length) return;

    try {
      // 每张图一条记录，便于后续单图编辑/删除
      for (const u of urls) {
        await API.content.addByMe({
          useScope,
          contentTypeId: typeId,
          content: u,
          typeClass: TYPE_CLASS_EMOJI
        });
      }
      // 刷新
      remoteLoaded[tab][cat] = false;
      await loadRemoteItems(tab, cat);
      renderAllEmojiLists();
      if (window.showToast) showToast('上传成功', {
        type: 'success'
      });
    } catch (e) {
      console.warn('addByMe 提交失败：', e);
      if (window.showToast) showToast('上传失败', {
        type: 'error',
        duration: 1500
      });
    }
  }

  // --- 切换类别 ---
  async function switchCat(tab, cat) {
    currentCat = cat;
    renderAllEmojiCatsBar();
    if (tab === 'net') {
      renderAllEmojiLists();
      return;
    }
    // 非net：懒加载该类别
    await loadRemoteItems(tab, cat);
    renderAllEmojiLists();
  }

  // --- 初始化 ---
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
    // 单击：仅粘贴；双击：粘贴并发送（当前窗口）
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
            ipcRenderer.send('emoji:paste', url);      // 放入企业微信输入框
            singleTimer = null;
          }, 250);
        });
    
        grid.addEventListener('dblclick', (e) => {
          
          const img = e.target.closest('.emoji-img');
          if (!img) return;
          const url = img.dataset.path;
          if (!url) return;
    console.log('emoji click', url) 
          if (singleTimer) {
            clearTimeout(singleTimer);
            singleTimer = null;
          }
          ipcRenderer.send('emoji:paste-send', url);   // 粘贴并立即发送（当前窗口）
        });
    
        grid._clickBound = true;
      }
    
      // 右键菜单：仅 net 绑定；其他 tab 在此不绑定（避免覆盖上面自定义菜单）
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
    // 新增：远端图片右键菜单（公司不弹，小组需组长，私人都弹）
    ['corp', 'group', 'private'].forEach(tab => {
      const grid = document.getElementById(`emoji-list-${tab}`);
      if (!grid) return;
      grid.oncontextmenu = async function(e) {
        const img = e.target.closest('.emoji-img');
        if (!img) return;
        if (!canEditDeleteEmoji(tab)) return; // 权限
        e.preventDefault();

        const url = img.dataset.path || '';
        const cid = img.dataset.id ? Number(img.dataset.id) : null;
        let all = [];
        try {
          all = JSON.parse(img.dataset.all || '[]');
        } catch {}

        const items = [{
            label: '编辑',
            click: async () => {
              const newUrl = await promptEditValue(url, {
                title: '编辑图片URL',
                placeholder: '请输入图片URL'
              });
              if (!newUrl || newUrl === url) return;

              // 如果该记录包含多张图，替换其中一张；否则直接改为新URL
              const next = (all && all.length > 0 ? all.map(u => u === url ? newUrl : u) : [newUrl])
                .join(',');

              try {
                if (!cid) throw new Error('缺少内容ID，无法编辑');
                const resp = await API.post('/api/front/content/updateContent', {
                  id: cid,
                  img: next,
                  content: next
                });
                if (!resp || resp.status !== 'success') {
                  if (window.showToast) showToast(resp?.message || '修改失败', {
                    type: 'error',
                    duration: 1500
                  });
                  return;
                }
                // 本地更新：替换当前图的 URL
                const arr = remoteItems[tab][currentCat] || [];
                const it = arr.find(o => String(o.id) === String(cid) && o.url === url);
                if (it) {
                  it.url = newUrl;
                  it._all = next.split(',').map(s => s.trim()).filter(Boolean);
                  // 更新 DOM 节点 dataset
                  img.dataset.path = newUrl;
                  img.src = newUrl;
                  img.dataset.all = JSON.stringify(it._all);
                }
                if (window.showToast) showToast('修改成功', {
                  type: 'success'
                });
              } catch (err) {
                if (window.showToast) showToast(err.message || '修改失败', {
                  type: 'error',
                  duration: 1500
                });
              }
            }
          },
          {
            label: '删除',
            click: async () => {
              if (!cid) {
                if (window.showToast) showToast('缺少内容ID，无法删除', {
                  type: 'error',
                  duration: 1500
                });
                return;
              }

              // 先确认
              const ok = await uiConfirm({
                title: '删除图片',
                message: '确定删除该图片吗？（不可恢复）',
                okText: '删除',
                danger: true
              });
              if (!ok) return;

              // 如果一条记录中有多张图，仅删掉该 URL：更新内容；否则直接删记录
              const remains = (all || []).filter(u => u !== url);
              try {
                if (remains.length > 0) {
                  const resp = await API.post('/api/front/content/updateContent', {
                    id: cid,
                    img: remains.join(','),
                    content: remains.join(',')
                  });
                  if (!resp || resp.status !== 'success') {
                    if (window.showToast) showToast(resp?.message || '删除失败', {
                      type: 'error',
                      duration: 1500
                    });
                    return;
                  }
                } else {
                  const resp = await API.post('/api/front/content/delContent', {
                    id: cid
                  });
                  if (!resp || resp.status !== 'success') {
                    if (window.showToast) showToast(resp?.message || '删除失败', {
                      type: 'error',
                      duration: 1500
                    });
                    return;
                  }
                }
                // 本地移除该项并刷新
                const arr = remoteItems[tab][currentCat] || [];
                const idx = arr.findIndex(o => String(o.id) === String(cid) && o.url === url);
                if (idx >= 0) arr.splice(idx, 1);
                renderEmojiList(tab, currentCat);
                if (window.showToast) showToast('删除成功', {
                  type: 'success'
                });
              } catch (err) {
                if (window.showToast) showToast(err.message || '删除失败', {
                  type: 'error',
                  duration: 1500
                });
              }
            }
          }
        ];
        showContextMenu(e.pageX, e.pageY, items);
      };
    });
    // 绑定拖拽导入事件
    ['net', 'corp', 'group', 'private'].forEach(tab => {
      const grid = document.getElementById(`emoji-list-${tab}`);
      if (!grid) return;
      // 允许拖拽
      grid.ondragover = function(e) {
        e.preventDefault();
        grid.classList.add('dragover');
      };
      grid.ondragleave = function(e) {
        grid.classList.remove('dragover');
      };
      grid.ondrop = function(e) {
        e.preventDefault();
        grid.classList.remove('dragover');
        const files = Array.from(e.dataTransfer.files);
        if (!files.length) return;
        // 只处理图片类型
        files.forEach(file => {
          if (!/^image\//.test(file.type)) return;
          const reader = new FileReader();
          reader.onload = function(evt) {
            const buffer = Buffer.from(evt.target.result);
            const ext = file.name.split('.').pop().toLowerCase();
            // 目标目录
            const dir = path.join("D:/emojis", tab, currentCat || "默认");
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, {
              recursive: true
            });
            // 文件名：时间戳+原名
            const filename = `${Date.now()}_${file.name}`;
            fs.writeFileSync(path.join(dir, filename), buffer);
            // 刷新表情区
            renderEmojiList(tab, currentCat);
          };
          reader.readAsArrayBuffer(file);
        });
      };
    });
    // tab切换
    document.getElementById('emo-tabbar').onclick = async function(e) {
      const btn = e.target.closest('.emo-tab-btn');
      if (btn) {
        const tab = btn.dataset.tab;
        if (tab !== currentTab) {
          await switchTab(tab);
        }
      }
    };

    // 类别栏点击
    ['net', 'corp', 'group', 'private'].forEach(tab => {
      document.getElementById(`emoji-cats-${tab}`).onclick = async function(e) {
        if (e.target.classList.contains('emo-cat-btn')) {
          switchCat(tab, e.target.dataset.cat);
        }
        if (e.target.classList.contains('emo-cat-add-btn')) {
          const name = await promptCategoryName();
          const title = (name || '').trim();
          if (!title) return;

          if (tab === 'group' || tab === 'private') {
            const useScope = (tab === 'group') ? 1 : 2; // 小组=1，私人=2
            try {
              const resp = await API.content.addByMe({
                useScope,
                title,
                typeClass: TYPE_CLASS_EMOJI // 1 = 表情
              });
              if (!resp || resp.status !== 'success') {
                alert('创建类别失败');
                return;
              }
              // 重新拉取该tab的类别列表，并选中新建的类别
              await loadRemoteCats(tab);
              currentCat = title;
              renderAllEmojiCatsBar();
              renderAllEmojiLists(); // 首次渲染时会懒加载当前类别内容
            } catch (err) {
              console.warn('创建类别失败：', err);
              alert('创建类别失败');
            }
          } else if (tab === 'net') {
            // 保留 net 的本地创建逻辑（若以后需要）
            // ...（不做改动）
          }
        }
      };
    });
    // 新增：类别右键（公司不弹，小组需组长，私人都弹）
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

        // 计算当前类别图片数（若未加载先拉取一次）
        if (!remoteLoaded[tab]?.[catName]) {
          try {
            await loadRemoteItems(tab, catName);
          } catch {}
        }
        const count = (remoteItems[tab]?.[catName] || []).length;

        const items = [{
            label: '编辑类别',
            click: async () => {
              const newTitle = await promptEditValue(catName, {
                title: '编辑类别名称',
                placeholder: '类别名称'
              });
              if (!newTitle || newTitle === catName) return;
              try {
                const resp = await API.post('/api/front/content/updateType', {
                  id: Number(typeId),
                  title: newTitle
                });
                if (!resp || resp.status !== 'success') {
                  if (window.showToast) showToast(resp?.message || '修改失败', {
                    type: 'error',
                    duration: 1500
                  });
                  return;
                }
                // 本地改名：映射表与数组
                const i = (remoteCats[tab] || []).indexOf(catName);
                if (i >= 0) remoteCats[tab][i] = newTitle;
                remoteTypeIdMap[tab][newTitle] = typeId;
                delete remoteTypeIdMap[tab][catName];
                // 迁移 items/loaded
                remoteItems[tab][newTitle] = remoteItems[tab][catName] || [];
                remoteLoaded[tab][newTitle] = remoteLoaded[tab][catName] || false;
                delete remoteItems[tab][catName];
                delete remoteLoaded[tab][catName];

                if (currentCat === catName && currentTab === tab) currentCat = newTitle;
                renderAllEmojiCatsBar();
                renderAllEmojiLists();
                if (window.showToast) showToast('修改成功', {
                  type: 'success'
                });
              } catch (err) {
                if (window.showToast) showToast(err.message || '修改失败', {
                  type: 'error',
                  duration: 1500
                });
              }
            }
          },
          {
            label: count > 0 ? '删除类别（需先清空）' : '删除类别',
            click: async () => {
              if (count > 0) {
                if (window.showToast) showToast('该类别里面有内容，请先删除内容', {
                  type: 'error',
                  duration: 1500
                });
                return; // 不调用后端
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
                  id: Number(typeId)
                });
                if (!resp || resp.status !== 'success') {
                  if (window.showToast) showToast(resp?.message || '删除失败', {
                    type: 'error',
                    duration: 1500
                  });
                  return;
                }
                // 本地移除并刷新
                remoteCats[tab] = (remoteCats[tab] || []).filter(n => n !== catName);
                delete remoteTypeIdMap[tab][catName];
                delete remoteItems[tab][catName];
                delete remoteLoaded[tab][catName];
                if (currentTab === tab && currentCat === catName) {
                  currentCat = (remoteCats[tab] || [])[0] || '';
                }
                renderAllEmojiCatsBar();
                renderAllEmojiLists();
                if (window.showToast) showToast('删除成功', {
                  type: 'success'
                });
              } catch (err) {
                if (window.showToast) showToast(err.message || '删除失败', {
                  type: 'error',
                  duration: 1500
                });
              }
            }
          }
        ];

        showContextMenu(e.pageX, e.pageY, items);
      };
    });

    // 新增：远端图片右键菜单（公司不弹，小组需组长，私人都弹）
    ['corp', 'group', 'private'].forEach(tab => {
      const grid = document.getElementById(`emoji-list-${tab}`);
      if (!grid) return;

      // 关键：公司直接跳过不绑定；小组按组长权限，私人总是绑定
      if (!canEditDeleteEmoji(tab)) return;

      grid.oncontextmenu = async function(e) {
        const img = e.target.closest('.emoji-img');
        if (!img) return;
        e.preventDefault();

        const url = img.dataset.path || '';
        const cid = img.dataset.id ? Number(img.dataset.id) : null;
        let all = [];
        try {
          all = JSON.parse(img.dataset.all || '[]');
        } catch {}

        const items = [{
            label: '编辑',
            click: async () => {
              // 打开文件选择对话框，仅选一张图片
              const inp = document.createElement('input');
              inp.type = 'file';
              inp.accept = 'image/*';
              inp.style.display = 'none';
              document.body.appendChild(inp);

              inp.onchange = async (ev) => {
                const file = ev.target.files && ev.target.files[0];
                if (!file) {
                  inp.remove();
                  return;
                }

                try {
                  // 1) 上传图片，取回新 URL（兼容多种返回结构）
                  const up = await API.files.upload(file);
                  let newUrl = '';
                  if (typeof up?.data === 'string') newUrl = up.data;
                  else if (up?.data?.url) newUrl = up.data.url;
                  else if (up?.data?.href) newUrl = up.data.href;
                  else if (up?.data?.path) newUrl = up.data.path;
                  else if (up?.url) newUrl = up.url;

                  if (!newUrl) {
                    showToast('上传失败：未返回URL', {
                      type: 'error',
                      duration: 1500
                    });
                    inp.remove();
                    return;
                  }

                  // 2) 构造更新后的内容（多图记录只替换当前这张）
                  const nextArr = (all && all.length ? all.map(u => u === url ? newUrl : u) : [
                    newUrl
                  ]);
                  const next = nextArr.join(',');

                  if (!cid) throw new Error('缺少内容ID，无法编辑');

                  // 3) 更新后端记录（同时写 img 与 content，兼容老数据）
                  const resp = await API.post('/api/front/content/updateContent', {
                    id: cid,
                    img: next,
                    content: next
                  });
                  if (!resp || resp.status !== 'success') {
                    showToast(resp?.message || '修改失败', {
                      type: 'error',
                      duration: 1500
                    });
                    inp.remove();
                    return;
                  }

                  // 4) 本地与 DOM 立即更新
                  const arr = remoteItems[tab][currentCat] || [];
                  const it = arr.find(o => String(o.id) === String(cid) && o.url === url);
                  if (it) {
                    it.url = newUrl;
                    it._all = nextArr;
                  }
                  img.dataset.path = newUrl;
                  img.src = newUrl;
                  img.dataset.all = JSON.stringify(nextArr);

                  showToast('修改成功', {
                    type: 'success'
                  });
                } catch (err) {
                  showToast(err.message || '上传失败', {
                    type: 'error',
                    duration: 1500
                  });
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
              if (!cid) {
                showToast('缺少内容ID，无法删除', {
                  type: 'error',
                  duration: 1500
                });
                return;
              }
              const ok = await uiConfirm({
                title: '删除图片',
                message: '确定删除该图片吗？（不可恢复）',
                okText: '删除',
                danger: true
              });
              if (!ok) return;

              const remains = (all || []).filter(u => u !== url);
              try {
                if (remains.length > 0) {
                  const resp = await API.post('/api/front/content/updateContent', {
                    id: cid,
                    img: remains.join(','),
                    content: remains.join(',')
                  });
                  if (!resp || resp.status !== 'success') {
                    showToast(resp?.message || '删除失败', {
                      type: 'error',
                      duration: 1500
                    });
                    return;
                  }
                } else {
                  const resp = await API.post('/api/front/content/delContent', {
                    id: cid
                  });
                  if (!resp || resp.status !== 'success') {
                    showToast(resp?.message || '删除失败', {
                      type: 'error',
                      duration: 1500
                    });
                    return;
                  }
                }
                const arr = remoteItems[tab][currentCat] || [];
                const idx = arr.findIndex(o => String(o.id) === String(cid) && o.url === url);
                if (idx >= 0) arr.splice(idx, 1);
                renderEmojiList(tab, currentCat);
                showToast('删除成功', {
                  type: 'success'
                });
              } catch (err) {
                showToast(err.message || '删除失败', {
                  type: 'error',
                  duration: 1500
                });
              }
            }
          }
        ];
        showContextMenu(e.pageX, e.pageY, items);
      };
    });
  });

  // --- 删除表情图片 ---
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

  // --- 弹出类别添加输入 ---
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
      </div>
    `;
      document.body.appendChild(mask);
      const dialog = mask.querySelector('.prompt-dialog');
      const input = mask.querySelector('.prompt-input');
      const btnOk = mask.querySelector('.btn-ok');
      const btnCancel = mask.querySelector('.btn-cancel');
      input.value = '';
      setTimeout(() => {
        input.focus();
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
  // 拉取当前tab的类别列表（不拉内容）
  async function loadRemoteCats(tab) {
    const resp = await API.content.types({
      typeClass: TYPE_CLASS_EMOJI
    });
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
  }

  // 按需拉取某个类别下的图片列表
  // 替换：按需拉取某个类别下的图片列表（改为返回对象数组）
  async function loadRemoteItems(tab, cat) {
    if (!cat || remoteLoaded[tab][cat]) return;
    const typeId = remoteTypeIdMap[tab][cat];
    if (!typeId) {
      remoteLoaded[tab][cat] = true;
      return;
    }

    const listResp = await API.content.list({
      typeClass: TYPE_CLASS_EMOJI,
      typeId
    });
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
      parts.forEach(u => items.push({
        id: cid,
        url: u,
        _all: parts.slice()
      }));
    });

    remoteItems[tab][cat] = items; // [{id,url,_all:[...]}]
    remoteLoaded[tab][cat] = true;
  }

  function renderEmojiCatsBar(tab) {
    const catsList = document.getElementById(`emoji-cats-list-${tab}`);
    const catsOps = document.getElementById(`emoji-cats-ops-${tab}`);
    let html = '';
    if (tab === 'net') {
      html = NET_CATEGORIES.map(cat =>
        `<button class="emo-cat-btn${cat === currentCat ? ' active' : ''}" data-cat="${cat}">${cat}</button>`
      ).join('');
      catsList.innerHTML = html;
      catsOps.style.display = 'none';
    } else {
      const cats = customCats[tab] || [];
      html = cats.map(cat =>
        `<button class="emo-cat-btn${cat === currentCat ? ' active' : ''}" data-cat="${cat}">${cat}</button>`
      ).join('');
      catsList.innerHTML = html;
      catsOps.style.display = '';
    }
  }
  // --- 右键菜单 ---
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
    document.addEventListener('click', () => m.remove(), {
      once: true
    });
  }

  // 新增：权限判断（公司不可编辑，小组需组长，私人可编辑）
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
    if (tab === 'group') return canUploadTo('group'); // 组长/管理员可编辑删除
    if (tab === 'private') return true;
    return false;
  }

  // 新增：简易编辑输入（单行），未改内容禁用“确定”
  function promptEditValue(initial = '', {
    title = '编辑',
    placeholder = ''
  } = {}) {
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
      const close = (val) => {
        mask.remove();
        resolve(val);
      };
      btnCancel.onclick = () => close(null);
      btnOk.onclick = () => {
        if (!btnOk.disabled) close(input.value.trim());
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
})();