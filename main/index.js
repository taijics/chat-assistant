const { app } = require('electron');
app.setPath('userData', 'D:\\chat-assistant-userdata'); // 确保该目录你有完全读写权限

const {
  BrowserWindow,
  ipcMain,
  screen,
  dialog,
  shell,
  clipboard,
  Menu,
  nativeImage
} = require('electron');

// 路径说明：此文件位于 main/index.js
// wechatMonitor 位置自动探测（找不到则用 stub 不中断运行）
let wechatMonitor;
(function resolveWechatMonitor() {
  const tryPaths = [
    './wechatMonitor',
    '../wechatMonitor',
    './utils/wechatMonitor',
    '../utils/wechatMonitor',
    './wechat/wechatMonitor',
    '../wechat/wechatMonitor'
  ];
  for (const p of tryPaths) {
    try { wechatMonitor = require(p); console.log('[wechatMonitor] resolved:', p); return; } catch {}
  }
  console.warn('[wechatMonitor] module not found. Using stub. Docking disabled until fixed.');
  wechatMonitor = { start: () => {}, stop: () => {}, setZOrder: () => {} };
})();

let registerAimodelsHandlers = () => {};
try { ({ registerAimodelsHandlers } = require('./aimodels')); } catch {}

let registerAiHandlers = () => {};
try { ({ registerAiHandlers } = require('./ai-coze')); } catch {}

// send-keys 兼容路径
let sendKeys = { sendCtrlV() {}, sendEnter() {} };
try { sendKeys = require('../utils/send-keys'); } catch { try { sendKeys = require('./utils/send-keys'); } catch {} }

const { exec } = require('child_process');

// node-window-manager（安全引入）
let windowManager = null;
try {
  ({ windowManager } = require('node-window-manager'));
  console.log('[deps] node-window-manager loaded');
} catch (e) {
  console.warn('[deps] node-window-manager not loaded:', e && e.message);
  windowManager = { getActiveWindow() { return null; }, getWindows() { return []; } };
}

let mainWindow = null;
let miniWindow = null;

let animationTimer = null;
const LERP_SPEED = 0.22;
const ANIMATION_INTERVAL = 16;

// 宽度改为可调（仅水平），不再用固定常量
const ASSISTANT_MIN_W = 260;
const ASSISTANT_MAX_W = 1400;
let assistWidth = 350;

// 高度仍由微信决定，最低保护
const MIN_HEIGHT = 200;

// 右侧贴边时向左收一点，处理高 DPI/取整缝隙
const DOCK_GAP_FIX_DIPS = 2;

function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
function lerp(a, b, t) { return a + (b - a) * t; }

let current = { x: 0, y: 0, w: assistWidth, h: 600 };
let target  = { x: 0, y: 0, w: assistWidth, h: 600 };

let userHidden = false;
let wechatFound = false;
let wechatHWND = null;
let firstDirectPosition = false;
let quitting = false;
let pinnedAlwaysOnTop = false;

// 保存最近一次微信窗口的“物理像素矩形”
let lastWechatPxRect = null;

// 前台跟随层级
let fgFollowTimer = null;
const FG_CHECK_INTERVAL = 250;

// 工具：根据物理像素矩形找到对应显示器并换算为 DIP
function findDisplayForPhysicalRect(pxRect) {
  const displays = screen.getAllDisplays();
  let best = displays[0], bestArea = -1;
  for (const d of displays) {
    const db = d.bounds, s = d.scaleFactor || 1;
    const pb = { x: Math.round(db.x*s), y: Math.round(db.y*s), width: Math.round(db.width*s), height: Math.round(db.height*s) };
    const ix = Math.max(pb.x, pxRect.x);
    const iy = Math.max(pb.y, pxRect.y);
    const ax = Math.min(pb.x + pb.width,  pxRect.x + pxRect.width);
    const ay = Math.min(pb.y + pb.height, pxRect.y + pxRect.height);
    const area = Math.max(0, ax - ix) * Math.max(0, ay - iy);
    if (area > bestArea) { bestArea = area; best = d; }
  }
  return best;
}
function pxToDipRect(pxRect) {
  const d = findDisplayForPhysicalRect(pxRect);
  const s = d.scaleFactor || 1;
  return { x: Math.round(pxRect.x / s), y: Math.round(pxRect.y / s), width: Math.round(pxRect.width / s), height: Math.round(pxRect.height / s), display: d };
}

// 仅计算“贴右（不够则左）”的 X，不改变高度
// 右贴边时向左收 DOCK_GAP_FIX_DIPS
function computeDockX(pxRect, width) {
  const display = findDisplayForPhysicalRect(pxRect);
  const s = display.scaleFactor || 1;
  const wa = display.workArea; // DIP

  const wechatLeftDip  = Math.floor(pxRect.x / s);
  const wechatRightDip = Math.floor((pxRect.x + pxRect.width) / s);

  let nextX;
  if (wechatRightDip + width <= wa.x + wa.width) {
    nextX = wechatRightDip - DOCK_GAP_FIX_DIPS;    // 右贴边，消缝
  } else {
    nextX = wechatLeftDip - width;                  // 左贴边
  }

  if (nextX < wa.x) nextX = wa.x;
  const maxX = wa.x + wa.width - width;
  if (nextX > maxX) nextX = maxX;
  return nextX;
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: assistWidth,
    height: current.h,
    frame: true,
    autoHideMenuBar: false,
    resizable: false,
    show: false,
    transparent: false,
    minWidth: ASSISTANT_MIN_W,
    minHeight: MIN_HEIGHT,
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  });

  // 系统原生最小化/关闭按钮事件，重定向到你原来的逻辑
  mainWindow.on('minimize', (e) => {
    if (quitting) return;
    e.preventDefault();
    userHidden = true;
    showMini();
  });
  mainWindow.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();
    cleanupAndQuit();
  });

  try { mainWindow.setHasShadow(false); } catch {}

  // 标准菜单栏（File/Edit/View/Window/Help）
  const template = [
    {
      label: 'File',
      submenu: [
        { role: 'close', label: 'Close' },
        { role: 'quit',  label: 'Quit'  }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' }, { role: 'forceReload' }, { type: 'separator' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' },
        { role: 'togglefullscreen' }, { type: 'separator' },
        { label: 'Toggle DevTools', accelerator: 'Alt+D', click: toggleDevTools }
      ]
    },
    {
      label: 'Window',
      submenu: [ { role: 'minimize' }, { role: 'close' } ]
    },
    {
      label: 'Help',
      submenu: [
        { label: 'Homepage', click: () => shell.openExternal('https://github.com/') }
      ]
    }
  ];
  try { Menu.setApplicationMenu(Menu.buildFromTemplate(template)); } catch {}
  try { mainWindow.setMenuBarVisibility(true); } catch {}

  mainWindow.loadFile(pathJoin(__dirname, '../renderer/index.html'));

  try { registerAimodelsHandlers(mainWindow); } catch {}
  try { registerAiHandlers(mainWindow); } catch {}

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.alt && !input.control && !input.shift && String(input.key || '').toLowerCase() === 'd') {
      event.preventDefault(); toggleDevTools();
    }
  });

  mainWindow.webContents.on('did-finish-load', () => {
    try { mainWindow.webContents.send('toolbar:pin-state', pinnedAlwaysOnTop); } catch {}
  });
}

function toggleDevTools() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    const wc = mainWindow.webContents;
    if (wc.isDevToolsOpened()) wc.closeDevTools(); else wc.openDevTools({ mode: 'detach' });
  }
}

function createMiniWindow() {
  const { width } = screen.getPrimaryDisplay().workAreaSize;
  miniWindow = new BrowserWindow({
    width: 160, height: 40, x: width - 180, y: 20,
    frame: false, resizable: false, show: true, alwaysOnTop: true, skipTaskbar: true,
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  });
  miniWindow.loadFile(pathJoin(__dirname, '../renderer/mini.html'));
}

function showMini() {
  if (quitting) return;
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) mainWindow.hide();
  if (miniWindow && !miniWindow.isDestroyed() && !miniWindow.isVisible()) miniWindow.show();
}
function showMain() {
  if (quitting) return;
  if (miniWindow && !miniWindow.isDestroyed() && miniWindow.isVisible()) miniWindow.hide();
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) mainWindow.show();
}

function applyTargetImmediate() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  current = { ...target };
  try {
    mainWindow.setBounds({
      x: Math.round(current.x), y: Math.round(current.y),
      width: Math.round(assistWidth), height: Math.round(current.h)
    });
  } catch {}
}

function updateZOrder() {
  if (quitting) return;
  if (!mainWindow || mainWindow.isDestroyed() || !wechatHWND) return;
  if (pinnedAlwaysOnTop) return;
  try { wechatMonitor.setZOrder(mainWindow.getNativeWindowHandle(), wechatHWND); } catch {}
}

// 前台跟随层级
function startForegroundFollow() {
  if (fgFollowTimer) clearInterval(fgFollowTimer);
  fgFollowTimer = setInterval(() => {
    if (quitting || userHidden || pinnedAlwaysOnTop) return;
    if (!wechatFound || !wechatHWND) return;
    try {
      const active = windowManager.getActiveWindow(); if (!active) return;
      const isWechatActive = Number(active.handle) === Number(wechatHWND) || /微信|wechat/i.test(active.getTitle() || '');
      if (isWechatActive) updateZOrder();
    } catch {}
  }, FG_CHECK_INTERVAL);
}

function handleEvent(evt) {
  if (quitting) return;
  const { type, x, y, width, height, hwnd } = evt;

  switch (type) {
    case 'found': {
      wechatFound = true; wechatHWND = hwnd;
      lastWechatPxRect = { x, y, width, height };

      const dockX = computeDockX(lastWechatPxRect, assistWidth);
      const dip   = pxToDipRect(lastWechatPxRect);
      target = {
        x: dockX,
        y: dip.y,
        w: assistWidth,
        h: Math.max(dip.height, MIN_HEIGHT)
      };
      applyTargetImmediate();
      firstDirectPosition = true;
      if (!userHidden) { showMain(); updateZOrder(); }
      break;
    }
    case 'position': {
      if (!wechatFound) return;
      lastWechatPxRect = { x, y, width, height };

      const dockX = computeDockX(lastWechatPxRect, assistWidth);
      const dip   = pxToDipRect(lastWechatPxRect);
      target.x = dockX;
      target.y = dip.y;
      target.h = Math.max(dip.height, MIN_HEIGHT);
      target.w = assistWidth;

      if (!firstDirectPosition) { applyTargetImmediate(); firstDirectPosition = true; }
      if (!userHidden) { showMain(); updateZOrder(); }
      break;
    }
    case 'foreground':
      if (!userHidden) { showMain(); updateZOrder(); }
      break;
    case 'minimized':
      if (!userHidden) showMini();
      break;
    case 'restored':
      if (!userHidden) { showMain(); updateZOrder(); }
      break;
    case 'destroyed':
      wechatFound = false; wechatHWND = null; lastWechatPxRect = null; firstDirectPosition = false;
      if (!userHidden) showMini();
      break;
  }
}

function startAnimationLoop() {
  if (animationTimer) clearInterval(animationTimer);
  animationTimer = setInterval(() => {
    if (quitting) return;
    if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible()) return;

    current.x = lerp(current.x, target.x, LERP_SPEED);
    current.y = lerp(current.y, target.y, LERP_SPEED);
    current.w = assistWidth; // 宽度始终以当前 assistWidth 为准
    current.h = lerp(current.h, target.h, LERP_SPEED);

    try {
      mainWindow.setBounds({
        x: Math.round(current.x), y: Math.round(current.y),
        width: Math.round(assistWidth), height: Math.round(current.h)
      });
    } catch {}
  }, ANIMATION_INTERVAL);
}

// ---- 应用生命周期 ----
app.whenReady().then(() => {
  createMainWindow();
  createMiniWindow();

  try { wechatMonitor.start({ keywords: [] }, handleEvent); } catch (e) { console.warn('[wechatMonitor] start failed:', e.message); }

  startAnimationLoop();
  startForegroundFollow();
});

// 最小化/恢复/退出
ipcMain.on('close-main-window', () => { userHidden = true; showMini(); });
ipcMain.on('restore-main-window', () => {
  userHidden = false;
  if (wechatFound) { showMain(); updateZOrder(); } else { showMini(); }
});
ipcMain.on('exit-app', () => { cleanupAndQuit(); });

// 渲染端也可以触发 DevTools
ipcMain.on('devtools:toggle', () => toggleDevTools());

// 顶栏菜单动作（从渲染进程 header 发来）
ipcMain.on('toolbar:click', async (_e, action) => {
  switch (action) {
    case 'new':      mainWindow?.webContents.send('app:new-chat'); break;
    case 'history':  mainWindow?.webContents.send('app:show-history'); break;
    case 'pin':
      pinnedAlwaysOnTop = !pinnedAlwaysOnTop;
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setAlwaysOnTop(pinnedAlwaysOnTop, 'screen-saver');
        mainWindow.webContents.send('toolbar:pin-state', pinnedAlwaysOnTop);
      }
      if (!pinnedAlwaysOnTop) updateZOrder();
      break;
    case 'screenshot':
      exec('explorer.exe ms-screenclip:', (err) => { if (err) exec('snippingtool /clip'); }); break;
    case 'search':   mainWindow?.webContents.send('app:search'); break;
    case 'clear':    mainWindow?.webContents.send('app:clear-chat'); break;
    case 'export':   await handleExport(); break;
    case 'settings': openSettingsWindow(); break;
    case 'about':    showAbout(); break;
    case 'minimize': userHidden = true; showMini(); break;
    case 'exit':     cleanupAndQuit(); break;
  }
});

// 自定义右侧缩放：渲染进程把新宽度传上来
ipcMain.handle('window:get-bounds', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return null;
  return mainWindow.getBounds();
});
ipcMain.on('window:resize-width', (_e, newWidth) => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const clamped = clamp(Math.round(newWidth || 0), ASSISTANT_MIN_W, ASSISTANT_MAX_W);
  if (clamped === assistWidth) return;

  assistWidth = clamped;
  target.w = clamped;

  // 保持“贴微信”的对齐
  if (lastWechatPxRect) {
    target.x = computeDockX(lastWechatPxRect, assistWidth);
  }

  // 立即应用，避免动画回弹感
  try {
    const b = mainWindow.getBounds();
    mainWindow.setBounds({
      x: Math.round(target.x ?? b.x),
      y: b.y,
      width: clamped,
      height: b.height
    });
  } catch {}
});

// 话术：粘贴（单击）
ipcMain.on('phrase:paste', async (_e, text) => {
  try {
    if (!text) return;
    clipboard.writeText(String(text));
    focusWeChatWindow();
    setTimeout(() => { try { sendKeys.sendCtrlV(); } catch {} if (!pinnedAlwaysOnTop) updateZOrder(); }, 120);
  } catch (err) { console.error('phrase paste failed:', err); }
});

// 粘贴并发送（双击）
ipcMain.on('phrase:paste-send', async (_e, text) => {
  try {
    if (!text) return;
    clipboard.writeText(String(text));
    focusWeChatWindow();
    setTimeout(() => {
      try { sendKeys.sendCtrlV(); } catch {}
      setTimeout(() => { try { sendKeys.sendEnter(); } catch {} if (!pinnedAlwaysOnTop) updateZOrder(); }, 80);
    }, 120);
  } catch (err) { console.error('phrase paste-send failed:', err); }
});

function focusWeChatWindow() {
  try {
    let toFocus = null;
    if (wechatHWND) {
      const wins = windowManager.getWindows();
      toFocus = wins.find(w => Number(w.handle) === Number(wechatHWND));
    }
    if (!toFocus) {
      const wins = windowManager.getWindows();
      toFocus = wins.find(w => /微信|wechat/i.test(w.getTitle() || ''));
    }
    if (toFocus) { try { toFocus.bringToTop(); } catch {} try { toFocus.focus(); } catch {} }
  } catch {}
}

// 选择目录（返回单个路径或 null）
ipcMain.handle('media:choose-dir', async (_e, payload) => {
  const title = (payload && payload.title) || '选择文件夹';
  const { canceled, filePaths } = await dialog.showOpenDialog({ title, properties: ['openDirectory'] });
  if (canceled || !filePaths || !filePaths[0]) return null;
  return filePaths[0];
});

// 粘贴图片到微信：写入剪贴板图片 -> 聚焦微信 -> Ctrl+V
ipcMain.on('media:image-paste', async (_e, filePath) => {
  try {
    if (!filePath) return;
    const img = nativeImage.createFromPath(String(filePath));
    if (!img || (typeof img.isEmpty === 'function' && img.isEmpty())) return;
    clipboard.writeImage(img);
    focusWeChatWindow();
    setTimeout(() => { try { require('../utils/send-keys').sendCtrlV(); } catch {} if (!pinnedAlwaysOnTop) updateZOrder(); }, 120);
  } catch (err) { console.error('image paste failed:', err); }
});

async function handleExport() {
  try {
    let data = null;
    if (mainWindow && !mainWindow.isDestroyed()) {
      try { data = await mainWindow.webContents.executeJavaScript('window.__exportChatData ? window.__exportChatData() : null', true); } catch {}
    }
    if (!data) data = '# 导出内容\n\n当前页面未提供导出实现（__exportChatData）。\n请在渲染进程定义 window.__exportChatData() 返回 Markdown 文本。';
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: '导出聊天为 Markdown', defaultPath: 'chat-export.md', filters: [{ name: 'Markdown', extensions: ['md'] }]
    });
    if (!canceled && filePath) { const fs = require('fs'); fs.writeFileSync(filePath, data, 'utf8'); }
  } catch (e) { console.error('export failed:', e); }
}

function openSettingsWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const win = new BrowserWindow({
    parent: mainWindow, modal: true, width: 420, height: 320, resizable: false, title: '设置',
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  });
  win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`
    <!doctype html><html><head><meta charset="utf-8"><title>设置</title>
    <style>body{font-family:Segoe UI,Arial;margin:0;padding:16px}h3{margin:0 0 12px}
    label{display:flex;align-items:center;gap:8px;margin:8px 0}</style></head>
    <body>
      <h3>设置</h3>
      <label><input type="checkbox" id="chk-pin"> 启用临时置顶（与微信叠放）</label>
      <p style="color:#666">提示：勾选后助手将置顶于所有窗口之上；关闭则恢复跟随微信的层级。</p>
      <div style="margin-top:16px"><button id="btn-ok">确定</button></div>
      <script>
        const { ipcRenderer } = require('electron');
        const chk = document.getElementById('chk-pin');
        const ok = document.getElementById('btn-ok');
        ipcRenderer.invoke('settings:get').then(state => { chk.checked = !!state.pinned; });
        ok.onclick = () => { ipcRenderer.send('settings:set', { pinned: chk.checked }); window.close(); };
      </script>
    </body></html>
  `));
}

ipcMain.handle('settings:get', () => ({ pinned: pinnedAlwaysOnTop }));
ipcMain.on('settings:set', (_e, payload) => {
  const v = !!(payload && payload.pinned);
  if (v !== pinnedAlwaysOnTop) {
    pinnedAlwaysOnTop = v;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setAlwaysOnTop(pinnedAlwaysOnTop, 'screen-saver');
      mainWindow.webContents.send('toolbar:pin-state', pinnedAlwaysOnTop);
    }
    if (!pinnedAlwaysOnTop) updateZOrder();
  }
});

function showAbout() {
  const v = process.versions;
  dialog.showMessageBox({
    type: 'info', title: '关于', message: '聊天助手',
    detail: `Electron ${v.electron}\nChromium ${v.chrome}\nNode ${v.node}\nV8 ${v.v8}`,
    buttons: ['确定', '开源主页']
  }).then(res => { if (res.response === 1) shell.openExternal('https://github.com/'); });
}

function cleanupAndQuit() {
  if (quitting) return; quitting = true;
  if (animationTimer) { clearInterval(animationTimer); animationTimer = null; }
  if (fgFollowTimer) { clearInterval(fgFollowTimer); fgFollowTimer = null; }
  try { wechatMonitor.stop && wechatMonitor.stop(); } catch {}
  try { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.destroy(); } catch {}
  try { if (miniWindow && !miniWindow.isDestroyed()) miniWindow.destroy(); } catch {}
  app.quit();
}

app.on('window-all-closed', () => { cleanupAndQuit(); });

// 小工具：兼容 node < 20 的 path.join 传参误写
function pathJoin(...args) { try { return require('path').join(...args); } catch { return args.join('/'); } }