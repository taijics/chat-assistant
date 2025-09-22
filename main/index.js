const {
  app,
  BrowserWindow,
  ipcMain,
  screen,
  dialog,
  shell,
  clipboard,
  Menu,
  nativeImage,
  protocol
} = require('electron');
const fs = require('fs');
const path = require('path');

// 路径说明：此文件位于 main/index.js
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
    try {
      wechatMonitor = require(p);
      console.log('[wechatMonitor] resolved:', p);
      return;
    } catch {}
  }
  console.warn('[wechatMonitor] module not found. Using stub. Docking disabled until fixed.');
  wechatMonitor = {
    start: () => {},
    stop: () => {},
    setZOrder: () => {}
  };
})();

let registerAimodelsHandlers = () => {};
try {
  ({
    registerAimodelsHandlers
  } = require('./aimodels'));
} catch {}
let registerAiHandlers = () => {};
try {
  ({
    registerAiHandlers
  } = require('./ai-coze'));
} catch {}

let sendKeys = {
  sendCtrlV() {},
  sendEnter() {}
};
try {
  sendKeys = require('../utils/send-keys');
} catch {
  try {
    sendKeys = require('./utils/send-keys');
  } catch {}
}
const { exec } = require('child_process');

let windowManager = null;
try {
  ({
    windowManager
  } = require('node-window-manager'));
  console.log('[deps] node-window-manager loaded');
} catch (e) {
  console.warn('[deps] node-window-manager not loaded:', e && e.message);
  windowManager = {
    getActiveWindow() { return null; },
    getWindows() { return []; }
  };
}

// ---- PERF DEBUG ----
const PERF_T0 = Date.now();
function logt(...args) {
  try {
    console.log('[perf]', String(Date.now() - PERF_T0).padStart(6, ' '), 'ms |', ...args);
  } catch {}
}
try {
  if (String(process.env.DISABLE_GPU || '').trim() === '1') {
    app.disableHardwareAcceleration();
    logt('GPU disabled by env DISABLE_GPU=1');
  }
} catch {}
// ---- PERF DEBUG END ----

// 贴边/动画/窗口参数
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
let userHidden = false, wechatFound = false, wechatHWND = null, firstDirectPosition = false, quitting = false, pinnedAlwaysOnTop = false;
let lastWechatPxRect = null; let fgFollowTimer = null; const FG_CHECK_INTERVAL = 250;

function findDisplayForPhysicalRect(pxRect) {
  const displays = screen.getAllDisplays();
  let best = displays[0], bestArea = -1;
  for (const d of displays) {
    const db = d.bounds, s = d.scaleFactor || 1;
    const pb = {
      x: Math.round(db.x * s),
      y: Math.round(db.y * s),
      width: Math.round(db.width * s),
      height: Math.round(db.height * s)
    };
    const ix = Math.max(pb.x, pxRect.x);
    const iy = Math.max(pb.y, pxRect.y);
    const ax = Math.min(pb.x + pb.width, pxRect.x + pxRect.width);
    const ay = Math.min(pb.y + pb.height, pxRect.y + pxRect.height);
    const area = Math.max(0, ax - ix) * Math.max(0, ay - iy);
    if (area > bestArea) { bestArea = area; best = d; }
  }
  return best;
}
function pxToDipRect(pxRect) {
  const d = findDisplayForPhysicalRect(pxRect);
  const s = d.scaleFactor || 1;
  return {
    x: Math.round(pxRect.x / s),
    y: Math.round(pxRect.y / s),
    width: Math.round(pxRect.width / s),
    height: Math.round(pxRect.height / s),
    display: d
  };
}
function computeDockX(pxRect, width) {
  const display = findDisplayForPhysicalRect(pxRect);
  const s = display.scaleFactor || 1;
  const wa = display.workArea;
  const wechatLeftDip = Math.floor(pxRect.x / s);
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

// ------------- 主窗口创建（互斥加载分支/二次导航保护） -------------
function createMainWindow() {
  logt('createMainWindow() enter');
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
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      backgroundThrottling: false
    }
  });

  const wc = mainWindow.webContents;
  wc.on('did-start-loading',   () => logt('wc did-start-loading'));
  wc.on('dom-ready',           () => logt('wc dom-ready'));
  wc.on('did-finish-load',     () => logt('wc did-finish-load'));
  wc.on('did-stop-loading',    () => logt('wc did-stop-loading'));
  wc.on('will-navigate', (_e, url) => logt('wc will-navigate', url));
  wc.on('did-navigate',  (_e, url) => logt('wc did-navigate', url));

  // ---- 二次导航保护（如有再次load会打印堆栈） ----
  const origLoadFile = mainWindow.loadFile.bind(mainWindow);
  const origLoadURL  = wc.loadURL.bind(wc);
  let firstLoadDone = false;
  mainWindow.loadFile = (...args) => {
    if (firstLoadDone) {
      console.warn('[nav] loadFile called AGAIN:', args, '\n', new Error('loadFile stack').stack);
      return;
    }
    firstLoadDone = true;
    return origLoadFile(...args);
  };
  wc.loadURL = (...args) => {
    if (firstLoadDone) {
      console.warn('[nav] loadURL called AGAIN:', args, '\n', new Error('loadURL stack').stack);
      return Promise.resolve();
    }
    firstLoadDone = true;
    return origLoadURL(...args);
  };

  // ---- 互斥加载分支 ----
  const DBG_BLANK     = String(process.env.DEBUG_BLANK || '').trim();
  const USE_DATA_URL  = String(process.env.USE_DATA_URL || '').trim() === '1';
  const USE_APP_PROTO = String(process.env.USE_APP_PROTOCOL || '').trim() === '1';

  if (DBG_BLANK === '1') {
    logt('loadURL about:blank');
    wc.loadURL('about:blank');
  } else if (USE_DATA_URL) {
    const filePath = pathJoin(__dirname, '../renderer/index.html');
    logt('loadURL data:index.html from', filePath);
    let html = '';
    try { html = fs.readFileSync(filePath, 'utf8'); } catch (e) { html = '<!doctype html><meta charset="utf-8"><title>ERR</title><pre>read error</pre>'; }
    wc.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  } else if (USE_APP_PROTO) {
    logt('loadURL app://index.html');
    wc.loadURL('app://index.html');
  } else {
    logt('loadFile index.html');
    mainWindow.loadFile(pathJoin(__dirname, '../renderer/index.html'));
  }

  // FAST_SHOW=1 时，页面就绪就直接显示主窗（仅调试）
  if (String(process.env.FAST_SHOW || '').trim() === '1') {
    wc.once('dom-ready', () => {
      logt('FAST_SHOW dom-ready -> mainWindow.show()');
      try { mainWindow.show(); } catch {}
    });
  }
  try { mainWindow.setHasShadow(false); } catch {}

  // 标准菜单栏
  const template = [
    { label: 'File', submenu: [{role: 'close',label: 'Close'}, {role: 'quit',label: 'Quit'} ] },
    { label: 'Edit', submenu: [{role: 'undo'}, {role: 'redo'}, {type:'separator'}, {role:'cut'}, {role:'copy'}, {role:'paste'}, {role:'selectAll'} ] },
    { label: 'View', submenu: [{role:'reload'}, {role:'forceReload'}, {type:'separator'}, {role:'resetZoom'}, {role:'zoomIn'}, {role:'zoomOut'}, {type:'separator'}, {role:'togglefullscreen'}, {type:'separator'}, {label:'Toggle DevTools',accelerator:'Alt+D',click:toggleDevTools}] },
    { label: 'Window', submenu: [{role:'minimize'}, {role:'close'}] },
    { label: 'Help', submenu: [{label:'Homepage', click:()=>shell.openExternal('https://github.com/')}] }
  ];
  try { Menu.setApplicationMenu(Menu.buildFromTemplate(template)); } catch {}
  try { mainWindow.setMenuBarVisibility(true); } catch {}

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
    if (wc.isDevToolsOpened()) wc.closeDevTools();
    else wc.openDevTools({mode:'detach'});
  }
}
function createMiniWindow() {
  const {width} = screen.getPrimaryDisplay().workAreaSize;
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
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });
  miniWindow.loadFile(pathJoin(__dirname, '../renderer/mini.html'));
}
function showMini() {
  logt('showMini() called');
  if (quitting) return;
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) mainWindow.hide();
  if (miniWindow && !miniWindow.isDestroyed() && !miniWindow.isVisible()) miniWindow.show();
}
function showMain() {
  logt('showMain() called');
  if (quitting) return;
  if (miniWindow && !miniWindow.isDestroyed() && miniWindow.isVisible()) miniWindow.hide();
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) mainWindow.show();
}
function applyTargetImmediate() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  current = {...target};
  try {
    mainWindow.setBounds({
      x: Math.round(current.x),
      y: Math.round(current.y),
      width: Math.round(assistWidth),
      height: Math.round(current.h)
    });
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
      const active = windowManager.getActiveWindow();
      if (!active) return;
      const isWechatActive = Number(active.handle) === Number(wechatHWND) || /微信|wechat/i.test(active.getTitle() || '');
      if (isWechatActive) updateZOrder();
    } catch {}
  }, FG_CHECK_INTERVAL);
}
function handleEvent(evt) {
  logt('wechat event:', evt && evt.type);
  if (quitting) return;
  const { type, x, y, width, height, hwnd } = evt;
  switch (type) {
    case 'found': {
      wechatFound = true; wechatHWND = hwnd; lastWechatPxRect = { x, y, width, height };
      const dockX = computeDockX(lastWechatPxRect, assistWidth);
      const dip = pxToDipRect(lastWechatPxRect);
      target = { x: dockX, y: dip.y, w: assistWidth, h: Math.max(dip.height, MIN_HEIGHT) };
      applyTargetImmediate(); firstDirectPosition = true;
      if (!userHidden) { showMain(); updateZOrder(); }
      break;
    }
    case 'position': {
      if (!wechatFound) return;
      lastWechatPxRect = { x, y, width, height };
      const dockX = computeDockX(lastWechatPxRect, assistWidth);
      const dip = pxToDipRect(lastWechatPxRect);
      target.x = dockX; target.y = dip.y; target.h = Math.max(dip.height, MIN_HEIGHT); target.w = assistWidth;
      if (!firstDirectPosition) { applyTargetImmediate(); firstDirectPosition = true; }
      if (!userHidden) { showMain(); updateZOrder(); }
      break;
    }
    case 'foreground': if (!userHidden) { showMain(); updateZOrder(); } break;
    case 'minimized': if (!userHidden) showMini(); break;
    case 'restored': if (!userHidden) { showMain(); updateZOrder(); } break;
    case 'destroyed': wechatFound = false; wechatHWND = null; lastWechatPxRect = null; firstDirectPosition = false; if (!userHidden) showMini(); break;
  }
}
function startAnimationLoop() {
  if (animationTimer) clearInterval(animationTimer);
  animationTimer = setInterval(() => {
    if (quitting) return;
    if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible()) return;
    current.x = lerp(current.x, target.x, LERP_SPEED);
    current.y = lerp(current.y, target.y, LERP_SPEED);
    current.w = assistWidth;
    current.h = lerp(current.h, target.h, LERP_SPEED);
    try {
      mainWindow.setBounds({
        x: Math.round(current.x),
        y: Math.round(current.y),
        width: Math.round(assistWidth),
        height: Math.round(current.h)
      });
    } catch {}
  }, ANIMATION_INTERVAL);
}

// Electron启动参数优化
try {
  app.commandLine.appendSwitch('disable-renderer-backgrounding');
  app.commandLine.appendSwitch('disable-background-timer-throttling');
  app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
  app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
} catch {}
try {
  protocol.registerSchemesAsPrivileged([{
    scheme: 'app',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true }
  }]);
} catch {}
app.whenReady().then(() => {
  logt('app ready');
  try {
    const root = pathJoin(__dirname, '../renderer');
    protocol.registerFileProtocol('app', (request, callback) => {
      try {
        const url = new URL(request.url);
        const pathname = decodeURIComponent(url.pathname || '/index.html');
        const filePath = path.join(root, pathname === '/' ? 'index.html' : pathname.replace(/^\//, ''));
        callback({ path: filePath });
      } catch (e) {
        callback({ error: -6 });
      }
    });
  } catch {}
  createMainWindow();
  createMiniWindow();
  logt('windows created (main+mini)');
  try {
    logt('wechatMonitor.start begin');
    wechatMonitor.start({ keywords: [] }, handleEvent);
    logt('wechatMonitor.start returned');
  } catch (e) {
    console.warn('[wechatMonitor] start failed:', e.message);
  }
  startAnimationLoop();
  startForegroundFollow();
});

// 后续业务逻辑（IPC、导出、设置窗口等）保持原样
ipcMain.on('close-main-window', () => { userHidden = true; showMini(); });
ipcMain.on('restore-main-window', () => {
  userHidden = false;
  if (wechatFound) { showMain(); updateZOrder(); } else { showMini(); }
});
ipcMain.on('exit-app', () => { cleanupAndQuit(); });
ipcMain.on('devtools:toggle', () => toggleDevTools());
ipcMain.on('toolbar:click', async (_e, action) => {
  switch (action) {
    case 'new': mainWindow?.webContents.send('app:new-chat'); break;
    case 'history': mainWindow?.webContents.send('app:show-history'); break;
    case 'pin':
      pinnedAlwaysOnTop = !pinnedAlwaysOnTop;
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setAlwaysOnTop(pinnedAlwaysOnTop, 'screen-saver');
        mainWindow.webContents.send('toolbar:pin-state', pinnedAlwaysOnTop);
      }
      if (!pinnedAlwaysOnTop) updateZOrder();
      break;
    case 'screenshot':
      exec('explorer.exe ms-screenclip:', (err) => { if (err) exec('snippingtool /clip'); });
      break;
    case 'search': mainWindow?.webContents.send('app:search'); break;
    case 'clear': mainWindow?.webContents.send('app:clear-chat'); break;
    case 'export': await handleExport(); break;
    case 'settings': openSettingsWindow(); break;
    case 'about': showAbout(); break;
    case 'minimize': userHidden = true; showMini(); break;
    case 'exit': cleanupAndQuit(); break;
  }
});
ipcMain.handle('window:get-bounds', () => { if (!mainWindow || mainWindow.isDestroyed()) return null; return mainWindow.getBounds(); });
ipcMain.on('window:resize-width', (_e, newWidth) => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const clamped = clamp(Math.round(newWidth || 0), ASSISTANT_MIN_W, ASSISTANT_MAX_W);
  if (clamped === assistWidth) return;
  assistWidth = clamped; target.w = clamped;
  if (lastWechatPxRect) { target.x = computeDockX(lastWechatPxRect, assistWidth); }
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
ipcMain.on('phrase:paste', async (_e, text) => {
  try {
    if (!text) return;
    clipboard.writeText(String(text));
    focusWeChatWindow();
    setTimeout(() => {
      try { sendKeys.sendCtrlV(); } catch {}
      if (!pinnedAlwaysOnTop) updateZOrder();
    }, 120);
  } catch (err) { console.error('phrase paste failed:', err); }
});
ipcMain.on('phrase:paste-send', async (_e, text) => {
  try {
    if (!text) return;
    clipboard.writeText(String(text));
    focusWeChatWindow();
    setTimeout(() => {
      try { sendKeys.sendCtrlV(); } catch {}
      setTimeout(() => {
        try { sendKeys.sendEnter(); } catch {}
        if (!pinnedAlwaysOnTop) updateZOrder();
      }, 80);
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
    if (toFocus) {
      try { toFocus.bringToTop(); } catch {}
      try { toFocus.focus(); } catch {}
    }
  } catch {}
}
ipcMain.handle('media:choose-dir', async (_e, payload) => {
  const title = (payload && payload.title) || '选择文件夹';
  const { canceled, filePaths } = await dialog.showOpenDialog({ title, properties: ['openDirectory'] });
  if (canceled || !filePaths || !filePaths[0]) return null; return filePaths[0];
});
ipcMain.on('media:image-paste', async (_e, filePath) => {
  try {
    if (!filePath) return;
    const img = nativeImage.createFromPath(String(filePath));
    if (!img || (typeof img.isEmpty === 'function' && img.isEmpty())) return;
    clipboard.writeImage(img);
    focusWeChatWindow();
    setTimeout(() => {
      try { require('../utils/send-keys').sendCtrlV(); } catch {}
      if (!pinnedAlwaysOnTop) updateZOrder();
    }, 120);
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
      title: '导出聊天为 Markdown',
      defaultPath: 'chat-export.md',
      filters: [{ name: 'Markdown', extensions: ['md'] }]
    });
    if (!canceled && filePath) {
      const fs = require('fs');
      fs.writeFileSync(filePath, data, 'utf8');
    }
  } catch (e) { console.error('export failed:', e); }
}
function openSettingsWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const win = new BrowserWindow({
    parent: mainWindow,
    modal: true,
    width: 420,
    height: 320,
    resizable: false,
    title: '设置',
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
    type: 'info',
    title: '关于',
    message: '聊天助手',
    detail: `Electron ${v.electron}\nChromium ${v.chrome}\nNode ${v.node}\nV8 ${v.v8}`,
    buttons: ['确定', '开源主页']
  }).then(res => {
    if (res.response === 1) shell.openExternal('https://github.com/');
  });
}
function cleanupAndQuit() {
  if (quitting) return;
  quitting = true;
  if (animationTimer) { clearInterval(animationTimer); animationTimer = null; }
  if (fgFollowTimer) { clearInterval(fgFollowTimer); fgFollowTimer = null; }
  try { wechatMonitor.stop && wechatMonitor.stop(); } catch {}
  try { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.destroy(); } catch {}
  try { if (miniWindow && !miniWindow.isDestroyed()) miniWindow.destroy(); } catch {}
  app.quit();
}
app.on('window-all-closed', () => { cleanupAndQuit(); });
function pathJoin(...args) {
  try { return require('path').join(...args); } catch { return args.join('/'); }
}