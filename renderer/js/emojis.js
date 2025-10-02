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

  let currentTab = "net"; // net/corp/group/private
  let currentCat = NET_CATEGORIES[0];
  let customCats = {
    corp: [],
    group: [],
    private: []
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
        const cats = customCats[tab] || [];
        html = cats.map(cat =>
          `<button class="emo-cat-btn${cat === currentCat ? ' active' : ''}" data-cat="${cat}">${cat}</button>`
        ).join('');
        html += `<button class="emo-cat-add-btn" title="添加类别">＋</button>`;
      }
      catsBar.innerHTML = html;
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
  function renderEmojiList(tab, cat) {
    const grid = document.getElementById(`emoji-list-${tab}`);
    grid.innerHTML = '';
    if (!cat) {
      grid.innerHTML = `<div style="padding:20px;color:#999;">请选择类别</div>`;
      return;
    }
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
      const img = document.createElement('img');
      img.className = 'emoji-img';
      img.src = "file:///" + file.replace(/\\/g, "/");
      img.dataset.path = file;
      div.appendChild(img);
      frag.appendChild(div);
    });
    grid.appendChild(frag);
  }

  // --- 切换tab ---
  function switchTab(tab) {
    currentTab = tab;
    if (tab === 'net') {
      currentCat = NET_CATEGORIES[0];
    } else {
      customCats[tab] = loadCustomCats(tab);
      currentCat = customCats[tab][0] || "";
    }
    renderTabBar();
    renderAllEmojiCatsBar();
    renderAllEmojiLists();
  }

  // --- 切换类别 ---
  function switchCat(tab, cat) {
    currentCat = cat;
    renderAllEmojiCatsBar();
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
    document.getElementById('emo-tabbar').onclick = function(e) {
      const btn = e.target.closest('.emo-tab-btn');
      if (btn) {
        const tab = btn.dataset.tab;
        if (tab !== currentTab) {
          switchTab(tab);
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
          if (name && !customCats[tab].includes(name)) {
            customCats[tab].push(name);
            saveCustomCats(tab);
            currentCat = name;
            renderAllEmojiCatsBar();
            renderAllEmojiLists();
            // 自动创建目录
            const dir = path.join(EMOJIS_BASE, tab, name);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, {
              recursive: true
            });
          }
        }
      };
    });

    // 图片点击（粘贴）
    ['net', 'corp', 'group', 'private'].forEach(tab => {
      document.getElementById(`emoji-list-${tab}`).onclick = function(e) {
        const img = e.target.closest('.emoji-img');
        if (img) {
          ipcRenderer.send('emoji:paste', img.dataset.path);
        }
      };
      // 右键菜单删除
      document.getElementById(`emoji-list-${tab}`).oncontextmenu = function(e) {
        e.preventDefault();
        const img = e.target.closest('.emoji-img');
        if (img) {
          showContextMenu(e.pageX, e.pageY, [{
            label: "删除",
            click: () => deleteEmoji(img.dataset.path, tab, currentCat)
          }]);
        }
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
})();