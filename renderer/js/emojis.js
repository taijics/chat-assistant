// 完整可用的 emojis.js（适用于 Electron 渲染进程）
// 功能：网络tab显示固定类别、公司/小组/私人tab支持类别自定义及加号、类别下显示图片、支持右键删除、点击粘贴（需主进程支持）
// 存储目录 D:/emojis/[tab]/[cat]/，图片文件

const { ipcRenderer, shell } = require('electron');
const path = require('path');
const fs = require('fs');

const NET_CATEGORIES = ["热门", "邀好评图", "售中", "砍价", "客服", "包邮", "有趣", "招呼", "爱你", "抱歉", "纠结", "可爱", "哭", "亲", "稍等", "生气", "笑", "谢谢"];
const EMOJIS_BASE = "D:/emojis/";

let currentTab = "net";
let currentCat = NET_CATEGORIES[0];
let customCats = {
  corp: [],
  group: [],
  private: []
};

const storageKey = (tab) => `emojis.cats.${tab}.v1`;

// ----- 加载/保存自定义类别 -----
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

// ----- 渲染Tab栏 -----
function renderTabBar() {
  document.querySelectorAll('.emo-tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === currentTab);
  });
}

// ----- 渲染类别栏 -----
function renderCatsBar() {
  const bar = document.getElementById('emo-cats-bar');
  let cats = [];
  let showAdd = false;
  if (currentTab === "net") {
    cats = NET_CATEGORIES;
  } else {
    cats = customCats[currentTab];
    showAdd = true;
  }
  // 若无类别，默认选第一个
  if (cats.length === 0 && currentTab !== "net") {
    currentCat = "";
  }
  // 若切换类别后当前cat已不存在，自动切到第一个
  if (!cats.includes(currentCat)) currentCat = cats[0] || "";

  let html = cats.map(c =>
    `<button class="emo-cat-btn${c === currentCat ? ' active' : ''}" data-cat="${c}">${c}</button>`
  ).join('');
  if (showAdd) html += `<button class="emo-cat-add-btn" id="emo-cat-add-btn" title="添加类别">＋</button>`;
  bar.innerHTML = html;
}

// ----- 渲染表情图片 -----
function renderEmojis() {
  const grid = document.getElementById('emo-grid');
  grid.innerHTML = '';
  if (!currentCat) {
    grid.innerHTML = `<div style="padding:20px;color:#999;">请选择类别</div>`;
    return;
  }
  const dir = path.join(EMOJIS_BASE, currentTab, currentCat);
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

// ----- 绑定Tab栏点击 -----
document.getElementById('emo-tabbar').onclick = function(e) {
  const btn = e.target.closest('.emo-tab-btn');
  // 保证点击只作用于表情tab
  if (btn && btn.parentElement.id === 'emo-tabbar') {
    currentTab = btn.dataset.tab;
    if (currentTab === "net") {
      currentCat = NET_CATEGORIES[0];
    } else {
      // 加载自定义类别
      customCats[currentTab] = loadCustomCats(currentTab);
      currentCat = customCats[currentTab][0] || "";
    }
    renderTabBar();
    renderCatsBar();
    renderEmojis();
  }
};

// ----- 绑定类别栏点击 -----
document.getElementById('emo-cats-bar').onclick = async function(e) {
  if (e.target.classList.contains('emo-cat-btn')) {
    currentCat = e.target.dataset.cat;
    renderCatsBar();
    renderEmojis();
  }
  if (e.target.classList.contains('emo-cat-add-btn')) {
    const name = await promptCategoryName();
    if (name && !customCats[currentTab].includes(name)) {
      customCats[currentTab].push(name);
      saveCustomCats(currentTab);
      currentCat = name;
      renderCatsBar();
      renderEmojis();
      // 自动创建目录
      const dir = path.join(EMOJIS_BASE, currentTab, name);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    }
  }
};

// ----- 绑定图片点击（粘贴表情） -----
document.getElementById('emo-grid').onclick = function(e) {
  const img = e.target.closest('.emoji-img');
  if (img) {
    // 通知主进程粘贴图片到剪贴板
    ipcRenderer.send('emoji:paste', img.dataset.path);
  }
};

// ----- 右键菜单删除 -----
document.getElementById('emo-grid').oncontextmenu = function(e) {
  e.preventDefault();
  const img = e.target.closest('.emoji-img');
  if (img) {
    showContextMenu(e.pageX, e.pageY, [
      { label: "删除", click: () => deleteEmoji(img.dataset.path) }
    ]);
  }
};

// ----- 删除表情图片 -----
function deleteEmoji(filePath) {
  if (!filePath) return;
  if (confirm("确定要删除此表情图片吗？")) {
    try {
      fs.unlinkSync(filePath);
      renderEmojis();
    } catch (e) {
      alert("删除失败：" + e.message);
    }
  }
}

// ----- 弹出类别添加输入 -----
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
    setTimeout(() => { input.focus(); }, 0);
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

// ----- 右键菜单 -----
function showContextMenu(x, y, items) {
  // 简易右键菜单，仅渲染在页面（可换为 Electron 的Menu）
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

// ----- 初始化 -----
function init() {
  // 载入本地自定义类别
  ["corp", "group", "private"].forEach(tab => {
    customCats[tab] = loadCustomCats(tab);
  });
  renderTabBar();
  renderCatsBar();
  renderEmojis();
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', init);
} else {
  init();
}