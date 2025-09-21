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
const wechatMonitor = require('./wechatMonitor');
const { registerAimodelsHandlers } = require('./main/aimodels');
const { registerAiHandlers } = require('./main/ai-coze');
const { exec } = require('child_process');
const { windowManager } = require('node-window-manager');
const sendKeys = require('./utils/send-keys');

// 禁用后台节流，避免隐藏/未聚焦时降频导致首屏慢
try {
  app.commandLine.appendSwitch('disable-renderer-backgrounding');
  app.commandLine.appendSwitch('disable-background-timer-throttling');
  app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
} catch {}

let mainWindow = null;
let miniWindow = null;

let animationTimer = null;
const LERP_SPEED = 0.22;
const ANIMATION_INTERVAL = 16;

const ASSISTANT_MIN_W = 260;
const ASSISTANT_MAX_W = 1400;
let assistWidth = 350;

const DOCK_GAP_FIX_DIPS = 2;

let current = { x: 0, y: 0, w: assistWidth, h: 600 };
let target  = { x: 0, y: 0, w: assistWidth, h: 600 };

let userHidden = false;
let wechatFound = false;
let wechatHWND = null;
let quitting = false;
let pinnedAlwaysOnTop = false;

let fgFollowTimer = null;
const FG_CHECK_INTERVAL = 250;

let lastAppliedBounds = null;
let lastConstraintH = null;

// 贴靠兜底轮询
let pollDockTimer = null;

// 拖动结束误判保护：记录最近一次 position 事件时间
let lastPositionAt = 0;

function lerp(a, b, t) { return a + (b - a) * t; }

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

function dockToWeChatRightOrLeftPx(pxRect) {
  const display = findDisplayForPhysicalRect(pxRect);
  const s = display.scaleFactor || 1;
  const wa = display.workArea;

  const wechatLeftDip  = Math.floor(pxRect.x / s);
  const wechatRightDip = Math.floor((pxRect.x + pxRect.width) / s);
  const nextY = Math.floor(pxRect.y / s);
  const nextH = Math.round(pxRect.height / s);

  let nextX;
  if (wechatRightDip + assistWidth <= wa.x + wa.width) {
    nextX = wechatRightDip - DOCK_GAP_FIX_DIPS;
  } else {
    nextX = wechatLeftDip - assistWidth;
  }

  if (nextX < wa.x) nextX = wa.x;
  const maxX = wa.x + wa.width - assistWidth;
  if (nextX > maxX) nextX = maxX;

  return { x: nextX, y: nextY, w: assistWidth, h: nextH };
}

function syncHeightConstraint(h) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const hh = Math.max(1, Math.round(h));
  if (lastConstraintH === hh) return;
  lastConstraintH = hh;
  mainWindow.setMinimumSize(ASSISTANT_MIN_W, hh);
  mainWindow.setMaximumSize(ASSISTANT_MAX_W, hh);
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: current.w,
    height: current.h,
    frame: false,
    resizable: true,
    show: true,                 // 立即显示主窗
    transparent: false,
    titleBarStyle: 'hidden',
    hasShadow: false,
    roundedCorners: false,
    backgroundColor: '#ffffff',
    minWidth: ASSISTANT_MIN_W,
    maxWidth: ASSISTANT_MAX_W,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      backgroundThrottling: false
    }
  });
  mainWindow.loadFile('renderer/index.html');
  registerAimodelsHandlers(mainWindow);
  registerAiHandlers(mainWindow);

  syncHeightConstraint(current.h);

  mainWindow.on('resize', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const b = mainWindow.getBounds();
    const newW = Math.max(ASSISTANT_MIN_W, Math.min(ASSISTANT_MAX_W, b.width));
    if (newW !== assistWidth) {
      assistWidth = newW;
      target.w = newW;
      current.w = newW;
    }
  });

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.alt && !input.control && !input.shift && String(input.key || '').toLowerCase() === 'd') {
      event.preventDefault();
      const wc = mainWindow.webContents;
      if (wc.isDevToolsOpened()) wc.closeDevTools(); else wc.openDevTools({ mode: 'detach' });
    }
  });

  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.send('toolbar:pin-state', pinnedAlwaysOnTop);
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
    width: 160,
    height: 40,
    x: width - 180,
    y: 20,
    frame: false,
    resizable: false,
    show: false,                // 启动不显示迷你窗
    alwaysOnTop: true,
    skipTaskbar: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      backgroundThrottling: false
    }
  });
  miniWindow.loadFile('renderer/mini.html');
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
  syncHeightConstraint(current.h);
  const b = {
    x: Math.round(current.x),
    y: Math.round(current.y),
    width: Math.round(current.w),
    height: Math.round(current.h)
  };
  try {
    if (
      !lastAppliedBounds ||
      b.x !== lastAppliedBounds.x ||
      b.y !== lastAppliedBounds.y ||
      b.width !== lastAppliedBounds.width ||
      b.height !== lastAppliedBounds.height
    ) {
      mainWindow.setBounds(b);
      lastAppliedBounds = b;
    }
  } catch {}
}

function updateZOrder() {
  if (quitting) return;
  if (!mainWindow || mainWindow.isDestroyed() || !wechatHWND) return;
  if (pinnedAlwaysOnTop) return;
  try {
    const hwndBuf = mainWindow.getNativeWindowHandle();
    wechatMonitor.setZOrder(hwndBuf, wechatHWND);
  } catch {}
}

function startForegroundFollow() {
  if (fgFollowTimer) clearInterval(fgFollowTimer);
  fgFollowTimer = setInterval(() => {
    if (quitting || userHidden || pinnedAlwaysOnTop) return;
    if (!wechatFound || !wechatHWND) return;
    try {
      const active = windowManager.getActiveWindow();
      if (!active) return;
      const isWechatActive =
        Number(active.handle) === Number(wechatHWND) ||
        /微信|wechat/i.test(active.getTitle() || '');
      if (isWechatActive) updateZOrder();
    } catch {}
  }, FG_CHECK_INTERVAL);
}

function startDockPoller() {
  if (pollDockTimer) clearInterval(pollDockTimer);
  pollDockTimer = setInterval(() => {
    if (quitting || userHidden) return;
    try {
      const wins = windowManager.getWindows();
      const wx = wins.find(w => /微信|wechat/i.test(w.getTitle() || ''));
      if (!wx) return;
      const b = wx.getBounds();
      const next = dockToWeChatRightOrLeftPx({ x: b.x, y: b.y, width: b.width, height: b.height });
      const moved =
        Math.abs(next.x - target.x) >= 1 ||
        Math.abs(next.y - target.y) >= 1 ||
        Math.abs(next.w - target.w) >= 1 ||
        Math.abs(next.h - target.h) >= 1;
      if (moved) {
        target = next;
        applyTargetImmediate();
        if (!userHidden) { showMain(); updateZOrder(); }
      }
    } catch {}
  }, 400);
}

function handleEvent(evt) {
  if (quitting) return;
  const { type, x, y, width, height, hwnd } = evt;
  switch (type) {
    case 'found':
      wechatFound = true;
      wechatHWND = hwnd;
      target = dockToWeChatRightOrLeftPx({ x, y, width, height });
      applyTargetImmediate();
      if (!userHidden) { showMain(); updateZOrder(); }
      break;
    case 'position':
      wechatFound = true;
      target = dockToWeChatRightOrLeftPx({ x, y, width, height });
      applyTargetImmediate();
      if (!userHidden) { showMain(); updateZOrder(); }
      lastPositionAt = Date.now(); // 记录拖动事件
      break;
    case 'minimized':
      // 拖动结束误判保护：position 后 800ms 内的 minimized 忽略
      if (Date.now() - lastPositionAt < 800) break;
      if (!userHidden) showMini();
      break;
    case 'foreground':
      if (!userHidden) { showMain(); updateZOrder(); }
      break;
    case 'restored':
      if (!userHidden) { showMain(); updateZOrder(); }
      break;
    case 'destroyed':
      wechatFound = false;
      wechatHWND = null;
      if (!userHidden) showMini();
      break;
  }
}

function startAnimationLoop() {
  if (animationTimer) clearInterval(animationTimer);
  const EPS = 0.6;
  const APPLY_DELTA = 1;

  animationTimer = setInterval(() => {
    if (quitting) return;
    if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible()) return;

    const needMove =
      Math.abs(current.x - target.x) > EPS ||
      Math.abs(current.y - target.y) > EPS ||
      Math.abs(current.w - target.w) > EPS ||
      Math.abs(current.h - target.h) > EPS;

    if (!needMove) {
      current = { ...target };
      const finalB = {
        x: Math.round(current.x),
        y: Math.round(current.y),
        width: Math.round(current.w),
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

    current.x = lerp(current.x, target.x, LERP_SPEED);
    current.y = lerp(current.y, target.y, LERP_SPEED);
    current.w = lerp(current.w, target.w, LERP_SPEED);
    current.h = lerp(current.h, target.h, LERP_SPEED);

    syncHeightConstraint(current.h);

    const newB = {
      x: Math.round(current.x),
      y: Math.round(current.y),
      width: Math.round(current.w),
      height: Math.round(current.h)
    };

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
  createMainWindow();
  createMiniWindow();
  wechatMonitor.start({ keywords: [] }, handleEvent);

  startAnimationLoop();
  startForegroundFollow();
  startDockPoller();

  const menu = Menu.buildFromTemplate([{
    label: 'Debug',
    submenu: [
      { label: 'Toggle DevTools', accelerator: 'Alt+D', click: toggleDevTools },
      { role: 'toggleDevTools', accelerator: 'Ctrl+Shift+I' }
    ]
  }]);
  Menu.setApplicationMenu(menu);
});

ipcMain.on('close-main-window', () => { userHidden = true; showMini(); });
ipcMain.on('restore-main-window', () => {
  userHidden = false;
  if (wechatFound) { showMain(); updateZOrder(); }
  else { showMini(); }
});
ipcMain.on('exit-app', () => { cleanupAndQuit(); });

ipcMain.on('devtools:toggle', () => { toggleDevTools(); });

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
      exec('explorer.exe ms-screenclip:', (err) => { if (err) exec('snippingtool /clip'); });
      break;
    case 'search':   mainWindow?.webContents.send('app:search'); break;
    case 'clear':    mainWindow?.webContents.send('app:clear-chat'); break;
    case 'export':   await handleExport(); break;
    case 'settings': openSettingsWindow(); break;
    case 'about':    showAbout(); break;
    case 'minimize': userHidden = true; showMini(); break;
    case 'exit':     cleanupAndQuit(); break;
  }
});

ipcMain.handle('window:get-bounds', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return null;
  return mainWindow.getBounds();
});
ipcMain.on('window:resize-width', (_e, newWidth) => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const clamped = Math.max(ASSISTANT_MIN_W, Math.min(ASSISTANT_MAX_W, Math.round(newWidth || 0)));
  assistWidth = clamped;
  target.w = clamped;
  current.w = clamped;
  try {
    const b = mainWindow.getBounds();
    const bb = { x: b.x, y: b.y, width: clamped, height: b.height };
    mainWindow.setBounds(bb);
    lastAppliedBounds = bb;
  } catch {}
});

ipcMain.on('phrase:paste', async (_e, text) => {
  try {
    if (!text) return;
    clipboard.writeText(String(text));
    let toFocus = null;
    if (wechatHWND) {
      const wins = windowManager.getWindows();
      toFocus = wins.find(w => Number(w.handle) === Number(wechatHWND));
    }
    if (!toFocus) {
      const wins = windowManager.getWindows();
      toFocus = wins.find(w => /微信|wechat/i.test(w.getTitle() || ''));
    }
    if (toFocus) { try { toFocus.bringToTop(); } catch {}; try { toFocus.focus(); } catch {}; }
    setTimeout(() => {
      sendKeys.sendCtrlV();
      if (!pinnedAlwaysOnTop) updateZOrder();
    }, 120);
  } catch (err) {
    console.error('phrase paste failed:', err);
  }
});

ipcMain.on('phrase:paste-send', async (_e, text) => {
  try {
    if (!text) return;
    clipboard.writeText(String(text));
    let toFocus = null;
    if (wechatHWND) {
      const wins = windowManager.getWindows();
      toFocus = wins.find(w => Number(w.handle) === Number(wechatHWND));
    }
    if (!toFocus) {
      const wins = windowManager.getWindows();
      toFocus = wins.find(w => /微信|wechat/i.test(w.getTitle() || ''));
    }
    if (toFocus) { try { toFocus.bringToTop(); } catch {}; try { toFocus.focus(); } catch {}; }
    setTimeout(() => {
      try { require('./utils/send-keys').sendCtrlV(); } catch {}
      setTimeout(() => {
        try { require('./utils/send-keys').sendEnter(); } catch {}
        if (!pinnedAlwaysOnTop) updateZOrder();
      }, 80);
    }, 120);
  } catch (err) {
    console.error('phrase paste-send failed:', err);
  }
});

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
    let toFocus = null;
    if (wechatHWND) {
      const wins = windowManager.getWindows();
      toFocus = wins.find(w => Number(w.handle) === Number(wechatHWND));
    }
    if (!toFocus) {
      const wins = windowManager.getWindows();
      toFocus = wins.find(w => /微信|wechat/i.test(w.getTitle() || ''));
    }
    if (toFocus) { try { toFocus.bringToTop(); } catch {}; try { toFocus.focus(); } catch {}; }
    setTimeout(() => {
      try { require('./utils/send-keys').sendCtrlV(); } catch {}
      if (!pinnedAlwaysOnTop) updateZOrder();
    }, 120);
  } catch (err) {
    console.error('image paste failed:', err);
  }
});

async function handleExport() {
  try {
    let data = null;
    if (mainWindow && !mainWindow.isDestroyed()) {
      try {
        data = await mainWindow.webContents.executeJavaScript(
          'window.__exportChatData ? window.__exportChatData() : null',
          true
        );
      } catch {}
    }
    if (!data) {
      data = '# 导出内容\n\n当前页面未提供导出实现（__exportChatData）。\n请在渲染进程定义 window.__exportChatData() 返回 Markdown 文本。';
    }
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: '导出聊天为 Markdown',
      defaultPath: 'chat-export.md',
      filters: [{ name: 'Markdown', extensions: ['md'] }]
    });
    if (!canceled && filePath) {
      const fs = require('fs');
      fs.writeFileSync(filePath, data, 'utf8');
    }
  } catch (e) {
    console.error('export failed:', e);
  }
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
  if (pollDockTimer) { clearInterval(pollDockTimer); pollDockTimer = null; }
  try { wechatMonitor.stop(); } catch {}
  try { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.destroy(); } catch {}
  try { if (miniWindow && !miniWindow.isDestroyed()) miniWindow.destroy(); } catch {}
  app.quit();
}

app.on('window-all-closed', () => { cleanupAndQuit(); });