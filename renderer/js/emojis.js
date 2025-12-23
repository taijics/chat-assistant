(function() {
  const {
    ipcRenderer
  } = require('electron');
  // const path = require('path');  // 网络不再使用本地文件系统
  // const fs = require('fs');

  // === 移除本地硬编码 NET_CATEGORIES，改为远端获取 ===
  // const NET_CATEGORIES = [ ... ];

  const EMOJIS_BASE = "D:/emojis/"; // 仅本地 net 已废弃读取，可保留不影响
  const TYPE_CLASS_EMOJI = 1;

  // 四个 tab：net / corp / group / private
  let currentTab = "net";
  let currentCat = ""; // 初始不设定，等远端加载
  const customCats = {
    corp: [],
    group: [],
    private: []
  };

  // 统一 remote 结构，增加 net
  const remoteCats = {
    net: [],
    corp: [],
    group: [],
    private: []
  };
  const remoteTypeIdMap = {
    net: {},
    corp: {},
    group: {},
    private: {}
  };
  const remoteItems = {
    net: {},
    corp: {},
    group: {},
    private: {}
  };
  const remoteLoaded = {
    net: {},
    corp: {},
    group: {},
    private: {}
  };
  const uploadStatus = {
    group: {},
    private: {}
  };
  let singleTimer = null;

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
      const cats = remoteCats[tab] || [];
      const cur = currentCat;
      let html = cats.map(cat =>
        `<button class="emo-cat-btn${cat === cur ? ' active' : ''}" data-cat="${cat}">${cat}</button>`
      ).join('');
      // 只允许 group / private 添加类别
      if (tab === 'group' || tab === 'private') {
        html += `<button class="emo-cat-add-btn" title="添加类别">＋</button>`;
      }
      catsBar.innerHTML = html;
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

    // 统一：所有 tab 都远端加载
    if (!remoteLoaded[tab][cat]) {
      grid.innerHTML = `<div style="padding:20px;color:#999;">加载中...</div>`;
      loadRemoteItems(tab, cat).then(() => {
        if (tab === currentTab && currentCat === cat) renderEmojiList(tab, cat);
      });
      return;
    }

    const items = remoteItems[tab][cat] || [];
    const canUpload = canUploadTo(tab);

    if (!items.length && !canUpload) {
      grid.innerHTML = `<div style="padding:20px;color:#999;">暂无表情图片</div>`;
      return;
    }

    const frag = document.createDocumentFragment();

    // 上传按钮（group/private）
    if (canUpload) {
      const uploading = uploadStatus[tab][cat] === 'uploading';
      const add = document.createElement('div');
      add.className = 'media-thumb';
      add.style.cssText =
        'width:80px;height:80px;display:flex;flex-direction:column;align-items:center;justify-content:center;border:1px dashed #d0d0d0;border-radius:6px;cursor:pointer;user-select:none;font-size:24px;position:relative;';
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
          uploadStatus[tab][cat] = 'uploading';
          renderEmojiList(tab, cat);
          handleUploadFiles(files, tab, cat);
          inp.value = '';
        });
      }
      frag.appendChild(add);
    }

    items.forEach(obj => {
      const url = obj.url;
      const div = document.createElement('div');
      div.className = 'media-thumb';
      div.title = "点击粘贴";
      div.style.cssText =
        'width:80px;height:80px;display:flex;align-items:center;justify-content:center;overflow:hidden;border-radius:6px;';
      const img = document.createElement('img');
      img.className = 'emoji-img';
      img.src = url;
      img.dataset.path = url;
      if (obj.id != null) img.dataset.id = obj.id;
      try {
        img.dataset.all = JSON.stringify(obj._all || [url]);
      } catch {}
      img.style.cssText = 'width:80px;height:80px;object-fit:contain;';
      div.appendChild(img);
      frag.appendChild(div);
    });

    grid.appendChild(frag);
  }

  async function switchTab(tab) {
    currentTab = tab;
    await loadRemoteCats(tab); // 所有 tab 都远端
    currentCat = remoteCats[tab][0] || "";
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
    return false; // net / corp 不上传
  }

  async function handleUploadFiles(files, tab, cat) {
    if (!files || !files.length) {
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
      if (uploadStatus[tab] && uploadStatus[tab][cat]) {
        delete uploadStatus[tab][cat];
        renderEmojiList(tab, cat);
      }
      if (window.showToast) showToast('没有有效图片', {
        type: 'error',
        duration: 1500
      });
      return;
    }

    try {
      for (const u of urls) {
        await API.content.addByMe({
          useScope,
          contentTypeId: typeId,
          content: u,
          typeClass: TYPE_CLASS_EMOJI,
          title: '1'
        });
      }
      remoteLoaded[tab][cat] = false;
      await loadRemoteItems(tab, cat);
      if (window.showToast) showToast('上传成功', {
        type: 'success'
      });
    } catch (e) {
      console.warn('addByMe 提交失败：', e);
      if (window.showToast) showToast('上传失败', {
        type: 'error',
        duration: 1500
      });
    } finally {
      if (uploadStatus[tab] && uploadStatus[tab][cat]) delete uploadStatus[tab][cat];
      renderEmojiList(tab, cat);
    }
  }

  async function switchCat(tab, cat) {
    currentCat = cat;
    renderAllEmojiCatsBar();
    await loadRemoteItems(tab, cat);
    renderAllEmojiLists();
  }

  function init() {
    ["corp", "group", "private"].forEach(tab => {
      customCats[tab] = loadCustomCats(tab);
    });
    // 初次加载当前 tab 的类别（net 也远端）
    loadRemoteCats(currentTab).then(() => {
      currentCat = remoteCats[currentTab][0] || "";
      renderTabBar();
      renderAllEmojiCatsBar();
      renderAllEmojiLists();
    });
  }

  window.addEventListener('DOMContentLoaded', function() {
    init();

    // 单击/双击粘贴
    // 单击/双击粘贴
    ['net', 'corp', 'group', 'private'].forEach(tab => {
      const grid = document.getElementById(`emoji-list-${tab}`);
      if (!grid) return;
      if (!grid._clickBound) {
        async function ensureDockThenPaste(url, sendNow) {
          if (!url) return;
          try {
            const fg = await ipcRenderer.invoke('wechat:is-foreground');
            // 这里不再检查 is-docked，也不主动调用 restore-main-window
            if (!fg) {
              // 让聊天窗前台：主进程里的 emoji:paste 会自己用 getCurrentChatTarget/ensureQQForegroundSimple
              // 所以这里只负责发 IPC
            }
            console.log('[emojis] ensureDockThenPaste -> send', {
              sendNow,
              url
            });
            ipcRenderer.send(sendNow ? 'emoji:paste-send' : 'emoji:paste', url);
          } catch (e) {
            console.warn('[emojis] ensureDockThenPaste error:', e && e.message);
            ipcRenderer.send(sendNow ? 'emoji:paste-send' : 'emoji:paste', url);
          }
        }

        let singleTimer = null;

        grid.addEventListener('click', (e) => {
          const img = e.target.closest('.emoji-img');
          if (!img) {
            // console.log('[emojis] click: not on emoji-img, target=', e.target && e.target.tagName);
            return;
          }
          const url = img.dataset.path;
          console.log('[emojis] click on emoji-img url=', url);
          if (!url) return;
          if (singleTimer) {
            clearTimeout(singleTimer);
            singleTimer = null;
          }
          singleTimer = setTimeout(() => {
            console.log('[emojis] single-click -> ensureDockThenPaste(sendNow=false)');
            ensureDockThenPaste(url, false);
            singleTimer = null;
          }, 350);
        });

        grid.addEventListener('dblclick', (e) => {
          const img = e.target.closest('.emoji-img');
          if (!img) {
            // console.log('[emojis] dblclick: not on emoji-img, target=', e.target && e.target.tagName);
            return;
          }
          e.preventDefault();
          e.stopPropagation();
          const url = img.dataset.path;
          console.log('[emojis] dblclick on emoji-img url=', url);
          if (!url) return;

          if (singleTimer) {
            console.log('[emojis] dblclick: clear pending singleTimer');
            clearTimeout(singleTimer);
            singleTimer = null;
          }
          console.log('[emojis] dblclick -> ensureDockThenPaste(sendNow=true)');
          ensureDockThenPaste(url, true);
        });

        grid._clickBound = true;
        console.log('[emojis] bind click/dblclick handlers for tab=', tab);
      }
      // net 改为远端，不再支持本地删除；corp 不删；group/private 根据权限
      if (tab === 'group' || tab === 'private') {
        // 右键菜单在后面统一绑定
      } else {
        grid.oncontextmenu = null;
      }
    });

    // 添加类别（group/private）
    ['net', 'corp', 'group', 'private'].forEach(tab => {
      const bar = document.getElementById(`emoji-cats-${tab}`);
      if (!bar) return;
      bar.onclick = async function(e) {
        if (uploadStatus[currentTab] && uploadStatus[currentTab][currentCat]) {
          showToast && showToast('正在上传，请稍候...', {
            type: 'info',
            duration: 1200
          });
          return;
        }
        if (e.target.classList.contains('emo-cat-btn')) {
          switchCat(tab, e.target.dataset.cat);
        }
        if (e.target.classList.contains('emo-cat-add-btn')) {
          // 仅 group/private 支持添加
          if (!(tab === 'group' || tab === 'private')) return;

          // 1) 选择父类（顶级类别，pid=0 列表）
          let parentList = [{
            id: 0,
            title: '无（创建一级）'
          }];
          if (tab === 'group') {
            // remoteCats/remoteTypeIdMap 都是 emoji 的（type_class=1）
            const tops = (remoteCats.group || []).map(name => ({
              id: Number(remoteTypeIdMap.group[name] || 0), // 顶级父类ID
              title: name
            }));
            parentList = [{
              id: 0,
              title: '无（创建一级）'
            }].concat(tops);
          } else if (tab === 'private') {
            // 私人：默认一级；如需要也可用 remoteCats.private 构造
            const tops = (remoteCats.private || []).map(name => ({
              id: Number(remoteTypeIdMap.private[name] || 0),
              title: name
            }));
            parentList = [{
              id: 0,
              title: '无（创建一级）'
            }].concat(tops);
          }

          // 2) 弹框：父类选择 + 单行类别名称
          const choice = await uiSelectParentTypeForEmoji({
            parents: parentList,
            tabLabel: tab === 'group' ? '小组' : '私人'
          });
          if (!choice) return;
          const {
            parentId,
            name
          } = choice;
          const title = (name || '').trim();
          if (!title) return;

          // 3) 校验：若创建一级（pid=0），检查当前 tab 顶级是否存在重名
          if (Number(parentId) === 0) {
            const existedTopSame = (remoteCats[tab] || []).some(n => String(n || '').trim() === title);
            if (existedTopSame) {
              showToast && showToast('已有相同的一级类别名称', {
                type: 'error',
                duration: 1500
              });
              return;
            }
          }

          const useScope = (tab === 'group') ? 1 : 2;
          try {
            // 4) 提交：添加类别（emoji 类别 typeClass=1）
            const resp = await API.content.addByMe({
              useScope,
              title,
              typeClass: TYPE_CLASS_EMOJI,
              pid: Number(parentId) // 0=一级；>0=挂到所选父类下
            });
            if (!resp || resp.status !== 'success') {
              showToast && showToast(resp?.message || '创建类别失败', {
                type: 'error',
                duration: 1500
              });
              return;
            }

            // 5) 不再本地 push/激活；直接强制从后端刷新该 tab 的类别
            await loadRemoteCats(tab, true); // preserveActive 尽量保持当前选择
            if (!remoteCats[tab].includes(currentCat)) currentCat = remoteCats[tab][0] || '';
            renderAllEmojiCatsBar();
            renderAllEmojiLists();
            showToast && showToast('创建成功', {
              type: 'success'
            });
          } catch (err) {
            console.warn('创建类别失败：', err);
            showToast && showToast(err.message || '创建类别失败', {
              type: 'error',
              duration: 1500
            });
          }
        }
      };
    });

    // 类别右键（group/private）公司/net 不弹
    ['group', 'private'].forEach(tab => {
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
                  showToast && showToast(resp?.message || '修改失败', {
                    type: 'error',
                    duration: 1500
                  });
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
                showToast && showToast('修改成功', {
                  type: 'success'
                });
              } catch (err) {
                showToast && showToast(err.message || '修改失败', {
                  type: 'error',
                  duration: 1500
                });
              }
            }
          },
          {
            label: '删除类别',
            click: async () => {
              if (count > 0) {
                showToast && showToast('该类别里面有内容，请先删除内容', {
                  type: 'error',
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
                  id: Number(typeId)
                });
                if (!resp || resp.status !== 'success') {
                  showToast && showToast(resp?.message || '删除失败', {
                    type: 'error',
                    duration: 1500
                  });
                  return;
                }
                remoteCats[tab] = remoteCats[tab].filter(n => n !== catName);
                delete remoteTypeIdMap[tab][catName];
                delete remoteItems[tab][catName];
                delete remoteLoaded[tab][catName];
                if (currentTab === tab && currentCat === catName) currentCat = (remoteCats[tab] ||
                [])[0] || '';
                renderAllEmojiCatsBar();
                renderAllEmojiLists();
                showToast && showToast('删除成功', {
                  type: 'success'
                });
              } catch (err) {
                showToast && showToast(err.message || '删除失败', {
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

    // 远端图片右键菜单（group/private 可编辑；net/corp 不）
    ['group', 'private'].forEach(tab => {
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
        try {
          all = JSON.parse(img.dataset.all || '[]');
        } catch {}
        const items = [{
            label: '编辑',
            click: async () => {
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
                  const nextArr = (all && all.length ? all.map(u => u === url ? newUrl : u) : [
                    newUrl
                  ]);
                  const next = nextArr.join(',');
                  if (!cid) throw new Error('缺少内容ID，无法编辑');
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

    document.getElementById('emo-tabbar').onclick = async function(e) {
      const btn = e.target.closest('.emo-tab-btn');
      if (btn) {
        const tab = btn.dataset.tab;
        if (tab !== currentTab) {
          await switchTab(tab);
        }
      }
    };
    // 监听主界面切换到“表情/图片”页签时，强制刷新 net 类别和列表
    // 监听主界面切换到“表情/图片”页签时，确保一定请求一次网络表情类别和图片
    // 当主界面切换到“表情/图片”页签时，强制重新请求 net 类别和内容
    ipcRenderer.on('menu:switch-tab', async (_e, tabName) => {
      if (tabName !== 'emojis') return;

      console.log('[emojis] menu:switch-tab -> emojis, force reload cats & items');

      // 每次从 net 开始
      currentTab = 'net';
      currentCat = '';

      try {
        // 1) 重新请求 net 的类别列表
        await loadRemoteCats('net');
        console.log('[emojis] loadRemoteCats(net) done, cats =', remoteCats.net);

        // 2) 选中第一个类别
        currentCat = remoteCats.net[0] || '';
        console.log('[emojis] currentCat =', currentCat);

        // 3) 先渲染 tab & 分类条
        renderTabBar();
        renderAllEmojiCatsBar();

        // 4) 如果有类别，先清空列表，显示“加载中...”，再拉内容
        const grid = document.getElementById('emoji-list-net');
        if (grid) {
          grid.innerHTML = `<div style="padding:20px;color:#999;">加载中...</div>`;
        }

        if (currentCat) {
          // 标记为未加载，强制 list 请求
          remoteLoaded.net[currentCat] = false;
          await loadRemoteItems('net', currentCat);
          console.log('[emojis] loadRemoteItems(net,', currentCat, ') done, count =',
            (remoteItems.net[currentCat] || []).length);
        }

        // 5) 最终渲染所有列表（只会对 currentTab=net 生效）
        renderAllEmojiLists();
      } catch (err) {
        console.warn('[emojis] menu:switch-tab emojis reload fail:', err && err.message);
        // 失败时也至少把 UI 渲染出来，避免空白
        renderTabBar();
        renderAllEmojiCatsBar();
        renderAllEmojiLists();
      }
    });
  });
  // 新增：父类选择 + 类别名称 弹框，返回 { parentId, name } 或 null
  async function uiSelectParentTypeForEmoji(opts) {
    const options = Object.assign({
      parents: [],
      tabLabel: ''
    }, opts || {});
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
      setTimeout(() => {
        input.focus();
      }, 0);

      function close(val) {
        if (mask && mask.parentNode) mask.parentNode.removeChild(mask);
        resolve(val);
      }
      btnCancel.onclick = () => close(null);
      btnOk.onclick = () => {
        if (btnOk.disabled) return;
        const parentId = Number(sel.value || 0);
        const name = (input.value || '').trim();
        close({
          parentId,
          name
        });
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
  async function loadRemoteCats(tab, preserveActive = false) {
    const prevActive = preserveActive ? currentCat : '';
    const resp = await API.content.types({
      typeClass: TYPE_CLASS_EMOJI
    });
    const grouped = (resp && resp.data) || {};
    let typesArr = [];
    if (tab === 'net') typesArr = grouped.network || grouped['network'] || [];
    else if (tab === 'corp') typesArr = grouped.company || grouped.corp || grouped['公司'] || [];
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

    if (prevActive && !remoteCats[tab].includes(prevActive)) {
      remoteCats[tab].push(prevActive);
      if (!remoteTypeIdMap[tab][prevActive]) remoteTypeIdMap[tab][prevActive] = 0;
      if (!remoteItems[tab][prevActive]) remoteItems[tab][prevActive] = [];
      if (remoteLoaded[tab][prevActive] == null) remoteLoaded[tab][prevActive] = false;
    }
  }

  // 覆盖：loadRemoteItems，支持后端返回 data:[{ type:{ id,title,pid,data:[...] } }] 的嵌套格式
  async function loadRemoteItems(tab, cat) {
    if (!cat || remoteLoaded[tab][cat]) return;
    const typeId = remoteTypeIdMap[tab][cat];
    if (!typeId) {
      remoteLoaded[tab][cat] = true;
      return;
    }
    const listResp = await API.content.list({
      typeClass: TYPE_CLASS_EMOJI, // 1：图片/表情
      typeId
    });

    // 后端可能返回三种结构：
    // 1) 直接数组：data = [{ id, img/url/content }, ...]
    // 2) 数组元素包裹 type：data = [ { type: { id, title, pid, data:[...] } } ]
    // 3) 对象包裹 type：data = { type: { id, title, pid, data:[...] } }
    const raw = (listResp && listResp.data) || [];
    let arr = Array.isArray(raw) ? raw : [];

    // 情况2：数组但元素里有 type.data
    if (Array.isArray(raw) && raw.length >= 1 && raw[0] && raw[0].type && Array.isArray(raw[0].type.data)) {
      arr = raw[0].type.data;
    }
    // 情况3：对象且有 type.data
    if (!Array.isArray(raw) && raw && raw.type && Array.isArray(raw.type.data)) {
      arr = raw.type.data;
    }

    const items = [];
    arr.forEach(i => {
      const cid = i?.id || i?.contentId || i?.cid;
      // 图片 url 来源优先级：img(逗号拼接) > url > content
      let parts = [];
      if (i && typeof i.img === 'string' && i.img) {
        parts = i.img.split(',').map(s => s.trim()).filter(Boolean);
      } else if (i?.url) {
        parts = [String(i.url).trim()].filter(Boolean);
      } else if (i?.content) {
        // 你的返回示例用的是 content 字段
        parts = String(i.content).split(',').map(s => s.trim()).filter(Boolean);
      }
      parts.forEach(u => items.push({
        id: cid,
        url: u,
        _all: parts.slice()
      }));
    });

    remoteItems[tab][cat] = items;
    remoteLoaded[tab][cat] = true;
  }

  function canEditDeleteEmoji(tab) {
    if (tab === 'corp') return false;
    if (tab === 'net') return false; // 网络不编辑删除
    if (tab === 'group') return canUploadTo('group');
    if (tab === 'private') return true;
    return false;
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
      setTimeout(() => {
        input.focus();
      }, 0);
      const close = (val) => {
        if (mask.parentNode) mask.parentNode.removeChild(mask);
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
      input.addEventListener('keydown', (e) => e.stopPropagation());
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
    document.addEventListener('click', () => m.remove(), {
      once: true
    });
  }

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