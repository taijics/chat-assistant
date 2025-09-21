const {
  app,
  BrowserWindow,
  ipcMain,
  screen,
  dialog,
  shell,
  clipboard,
  Menu,
  nativeImage
} = require('electron');

const fs = require('fs');
const path = require('path');

let lastAppliedBounds = null;

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

let sendKeys = { sendCtrlV() {}, sendEnter() {} };
try { sendKeys = require('../utils/send-keys'); } catch { try { sendKeys = require('./utils/send-keys'); } catch {} }

const { exec } = require('child_process');

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

const ASSISTANT_MIN_W = 260;
const ASSISTANT_MAX_W = 1400;
let assistWidth = 350;

const MIN_HEIGHT = 200;
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

let lastWechatPxRect = null;

let fgFollowTimer = null;
const FG_CHECK_INTERVAL = 250;

/* ---- 宽度持久化（settings.json） ---- */
const CONFIG_FILE_NAME = 'settings.json';
let saveTimer = null;

function getConfigPath() {
  return path.join(app.getPath('userData'), CONFIG_FILE_NAME);
}
function loadConfig() {
  try {
    const p = getConfigPath();
    if (!fs.existsSync(p)) return;
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (typeof data.assistWidth === 'number') {
      assistWidth = clamp(Math.round(data.assistWidth), ASSISTANT_MIN_W, ASSISTANT_MAX_W);
      current.w = assistWidth;
      target.w  = assistWidth;
      console.log('[config] assistWidth restored:', assistWidth);
    }
  } catch (e) {
    console.warn('[config] load failed:', e.message);
  }
}
function saveConfig() {
  try {
    const p = getConfigPath();
    const payload = { assistWidth };
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(payload, null, 2), 'utf8');
  } catch (e) {
    console.warn('[config] save failed:', e.message);
  }
}
function scheduleSaveConfig() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { saveTimer = null; saveConfig(); }, 250);
}
/* ------------------------------------ */

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

function computeDockX(pxRect, width) {
  const display = findDisplayForPhysicalRect(pxRect);
  const s = display.scaleFactor || 1;
  const wa = display.workArea;

  const wechatLeftDip  = Math.floor(pxRect.x / s);
  const wechatRightDip = Math.floor((pxRect.x + pxRect.width) / s);

  let nextX;
  if (wechatRightDip + width <= wa.x + wa.width) {
    nextX = wechatRightDip - DOCK_GAP_FIX_DIPS;
  } else {
    nextX = wechatLeftDip - width;
  }

  if (nextX < wa.x) nextX = wa.x;
  const maxX = wa.x + wa.width - width;
  if (nextX > maxX) nextX = maxX;
  return nextX;
}

/* function createMainWindow() {
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

  try { mainWindow.setHasShadow(false); } catch {}

  // 中文菜单（含设置与常用功能）
  buildAppMenu();

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
 */
function buildAppMenu() {
  const template = [
    {
      label: '文件',
      submenu: [
        { label: '新建聊天', click: () => mainWindow?.webContents.send('app:new-chat') },
        { label: '历史', click: () => mainWindow?.webContents.send('app:show-history') },
        { type: 'separator' },
        { label: '导出', click: async () => { await handleExport(); } },
        { type: 'separator' },
        { role: 'minimize', label: '最小化' },
        { role: 'close', label: '关闭窗口' },
        { role: 'quit', label: '退出' }
      ]
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' }
      ]
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '重新加载' },
        { role: 'forceReload', label: '强制重新加载' },
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '切换全屏' },
        { type: 'separator' },
        { label: '开发者工具', accelerator: 'Alt+D', click: toggleDevTools }
      ]
    },
    {
      label: '工具',
      submenu: [
        { label: '截图', click: () => exec('explorer.exe ms-screenclip:', (err) => { if (err) exec('snippingtool /clip'); }) },
        { label: '搜索', click: () => mainWindow?.webContents.send('app:search') },
        { label: '清空', click: () => mainWindow?.webContents.send('app:clear-chat') },
        { type: 'separator' },
        { label: '设置', click: () => openSettingsWindow() }
      ]
    },
    {
      label: '窗口',
      submenu: [
        {
          label: '置顶',
          type: 'checkbox',
          checked: !!pinnedAlwaysOnTop,
          click: () => {
            pinnedAlwaysOnTop = !pinnedAlwaysOnTop;
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.setAlwaysOnTop(pinnedAlwaysOnTop, 'screen-saver');
              mainWindow.webContents.send('toolbar:pin-state', pinnedAlwaysOnTop);
            }
            if (!pinnedAlwaysOnTop) updateZOrder();
            buildAppMenu();
          }
        },
        { type: 'separator' },
        { role: 'minimize', label: '最小化' },
        { role: 'close', label: '关闭窗口' }
      ]
    },
    {
      label: '帮助',
      submenu: [
        { label: '关于', click: () => showAbout() },
        { label: '开源主页', click: () => shell.openExternal('https://github.com/') }
      ]
    }
  ];
  try {
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
    mainWindow && mainWindow.setMenuBarVisibility(true);
  } catch {}
}

function toggleDevTools() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    const wc = mainWindow.webContents;
    if (wc.isDevToolsOpened()) wc.closeDevTools(); else wc.openDevTools({ mode: 'detach' });
  }
}

// REPLACE the whole createMainWindow function with this:
function createMainWindow() {
   mainWindow = new BrowserWindow({
      width: assistWidth,
      height: current.h,
      frame: true,
      autoHideMenuBar: false,
      resizable: false,
      show: false,
      transparent: false,
      backgroundColor: '#ffffff',     // 新增：减少黑屏/白屏闪烁
      useContentSize: true,           // 可选：按内容计算尺寸，避免非必要的往返
      minWidth: ASSISTANT_MIN_W,
      minHeight: MIN_HEIGHT,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false
      }
    });

  try { mainWindow.setHasShadow(false); } catch {}

  // 中文菜单（含设置与常用功能）
  buildAppMenu();

  // 让原生右上角按钮具备“最小化到迷你窗”和“退出”的行为
  // 注意：minimize 事件不可阻止，这里在触发后隐藏主窗并显示迷你窗
  mainWindow.on('minimize', () => {
    if (quitting) return;
    userHidden = true;
    // 在下一轮事件循环隐藏主窗，避免闪烁
    setImmediate(() => {
      try { mainWindow.hide(); } catch {}
      showMini();
    });
  });

  mainWindow.on('close', (e) => {
    if (quitting) return;     // 若已进入退出流程，放行
    e.preventDefault();       // 拦截系统关闭
    cleanupAndQuit();         // 你的统一退出逻辑
  });

  mainWindow.loadFile(pathJoin(__dirname, '../renderer/index.html'));

  try { registerAimodelsHandlers(mainWindow); } catch {}
  try { registerAiHandlers(mainWindow); } catch {}

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.alt && !input.control && !input.shift && String(input.key || '').toLowerCase() === 'd') {
      event.preventDefault();
      toggleDevTools();
    }
  });

  mainWindow.webContents.on('did-finish-load', () => {
    try { mainWindow.webContents.send('toolbar:pin-state', pinnedAlwaysOnTop); } catch {}
  });
}

// REPLACE the whole createMiniWindow function with this (注意：不要在里面再定义 createMainWindow 了):
function createMiniWindow() {
  const { width } = screen.getPrimaryDisplay().workAreaSize;
  miniWindow = new BrowserWindow({
    width: 160,
    height: 40,
    x: width - 180,
    y: 20,
    frame: false,
    resizable: false,
    show: true,
    alwaysOnTop: true,
    skipTaskbar: true,
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
  const b = {
    x: Math.round(current.x),
    y: Math.round(current.y),
    width: Math.round(assistWidth),
    height: Math.round(current.h)
  };
  try {
    mainWindow.setBounds(b);
    lastAppliedBounds = b;
  } catch {}
}

function updateZOrder() {
  if (quitting) return;
  if (!mainWindow || mainWindow.isDestroyed() || !wechatHWND) return;
  if (pinnedAlwaysOnTop) return;
  try { wechatMonitor.setZOrder(mainWindow.getNativeWindowHandle(), wechatHWND); } catch {}
}

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

// 用这个替换原来的 startAnimationLoop 实现
function startAnimationLoop() {
  // 若已有循环，先停掉
  if (animationTimer) clearInterval(animationTimer);

  const EPS = 0.6; // 到目标小于 0.6px 视为到位
  const APPLY_DELTA = 1; // 只有在>=1px 变化时才 setBounds

  animationTimer = setInterval(() => {
    if (quitting) return;
    if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible()) return;

    // 是否还有要移动/缩放
    const needMove =
      Math.abs(current.x - target.x) > EPS ||
      Math.abs(current.y - target.y) > EPS ||
      Math.abs(current.h - target.h) > EPS;

    if (!needMove) {
      // 对齐到目标，最后 set 一次后停止循环
      current = { ...target };
      const finalB = {
        x: Math.round(current.x),
        y: Math.round(current.y),
        width: Math.round(assistWidth),
        height: Math.round(current.h)
      };
      const changed =
        !lastAppliedBounds ||
        finalB.x !== lastAppliedBounds.x ||
        finalB.y !== lastAppliedBounds.y ||
        finalB.width !== lastAppliedBounds.width ||
        finalB.height !== lastAppliedBounds.height;
      if (changed) {
        try { mainWindow.setBounds(finalB); lastAppliedBounds = finalB; } catch {}
      }

      clearInterval(animationTimer);
      animationTimer = null;
      return;
    }

    // 插值推进
    current.x = lerp(current.x, target.x, LERP_SPEED);
    current.y = lerp(current.y, target.y, LERP_SPEED);
    current.w = assistWidth;
    current.h = lerp(current.h, target.h, LERP_SPEED);

    const newB = {
      x: Math.round(current.x),
      y: Math.round(current.y),
      width: Math.round(assistWidth),
      height: Math.round(current.h)
    };

    // 仅当与上次应用的值有明显变化时才 setBounds，避免高频无效调用
    const deltaBigEnough =
      !lastAppliedBounds ||
      Math.abs(newB.x - lastAppliedBounds.x) >= APPLY_DELTA ||
      Math.abs(newB.y - lastAppliedBounds.y) >= APPLY_DELTA ||
      Math.abs(newB.width - lastAppliedBounds.width) >= APPLY_DELTA ||
      Math.abs(newB.height - lastAppliedBounds.height) >= APPLY_DELTA;

    if (deltaBigEnough) {
      try { mainWindow.setBounds(newB); lastAppliedBounds = newB; } catch {}
    }
  }, ANIMATION_INTERVAL);
}

app.whenReady().then(() => {
  loadConfig();

  createMainWindow();
  createMiniWindow();

  try { wechatMonitor.start({ keywords: [] }, handleEvent); } catch (e) { console.warn('[wechatMonitor] start failed:', e.message); }

  startAnimationLoop();
  startForegroundFollow();
});

ipcMain.on('close-main-window', () => { userHidden = true; showMini(); });
ipcMain.on('restore-main-window', () => {
  userHidden = false;
  if (wechatFound) { showMain(); updateZOrder(); } else { showMini(); }
});
ipcMain.on('exit-app', () => { cleanupAndQuit(); });

ipcMain.on('devtools:toggle', () => toggleDevTools());

// 来自渲染端旧“菜单”的动作仍保留兼容
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
      buildAppMenu();
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

  if (lastWechatPxRect) {
    target.x = computeDockX(lastWechatPxRect, assistWidth);
  }

  try {
    const b = mainWindow.getBounds();
    mainWindow.setBounds({
      x: Math.round(target.x ?? b.x),
      y: b.y,
      width: clamped,
      height: b.height
    });
  } catch {}

  scheduleSaveConfig();
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

ipcMain.handle('media:choose-dir', async (_e, payload) => {
  const title = (payload && payload.title) || '选择文件夹';
  const { canceled, filePaths } = await dialog.showOpenDialog({ title, properties: ['openDirectory'] });
  if (canceled || !filePaths || !filePaths[0]) return null;
  return filePaths[0];
});

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
    if (!canceled && filePath) { const fs2 = require('fs'); fs2.writeFileSync(filePath, data, 'utf8'); }
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
    buildAppMenu();
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
  try { saveConfig(); } catch {}
  try { wechatMonitor.stop && wechatMonitor.stop(); } catch {}
  try { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.destroy(); } catch {}
  try { if (miniWindow && !miniWindow.isDestroyed()) miniWindow.destroy(); } catch {}
  app.quit();
}

app.on('window-all-closed', () => { cleanupAndQuit(); });

function pathJoin(...args) { try { return require('path').join(...args); } catch { return args.join('/'); } }