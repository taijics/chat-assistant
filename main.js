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
const { registerAiHandlers } = require('./main/ai-coze'); // 新增：Coze AI 接口
const { exec } = require('child_process');
const { windowManager } = require('node-window-manager'); // 聚焦微信用
const sendKeys = require('./utils/send-keys'); // 发送按键

let mainWindow = null;
let miniWindow = null;

let animationTimer = null;
const LERP_SPEED = 0.22;
const ANIMATION_INTERVAL = 16;

// 可调宽度：变量保存，支持拖动
const ASSISTANT_MIN_W = 260;
const ASSISTANT_MAX_W = 1400;
let assistWidth = 350;

// 右侧贴边的小幅负偏移，避免高 DPI 下出现 1px 缝隙
const DOCK_GAP_FIX_DIPS = 2;

let current = { x: 0, y: 0, w: assistWidth, h: 600 };
let target  = { x: 0, y: 0, w: assistWidth, h: 600 };

let userHidden = false;
let wechatFound = false;
let wechatHWND = null;
let firstDirectPosition = false;
let quitting = false;
let pinnedAlwaysOnTop = false; // 置顶状态（默认关闭）

// 前台跟随定时器
let fgFollowTimer = null;
const FG_CHECK_INTERVAL = 250;

// 记录最近一次实际应用到窗口的边界，避免重复 setBounds
let lastAppliedBounds = null;
// 记录最近一次同步的高度限制值，避免每帧 setMinimum/MaximumSize
let lastConstraintH = null;

// 贴靠兜底轮询（防止偶发丢事件时“脱钩”）
let pollDockTimer = null;

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function findDisplayForPhysicalRect(pxRect) {
  const displays = screen.getAllDisplays();
  let best = displays[0];
  let bestArea = -1;
  for (const d of displays) {
    const db = d.bounds;
    const s = d.scaleFactor || 1;
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
    const w = Math.max(0, ax - ix);
    const h = Math.max(0, ay - iy);
    const area = w * h;
    if (area > bestArea) {
      bestArea = area;
      best = d;
    }
  }
  return best;
}

// 贴右；不够则贴左；高度与微信一致（DIP）
// 右贴边时向左收 DOCK_GAP_FIX_DIPS 以消缝
function dockToWeChatRightOrLeftPx(pxRect) {
  const display = findDisplayForPhysicalRect(pxRect);
  const s = display.scaleFactor || 1;
  const wa = display.workArea; // DIP

  const wechatLeftDip  = Math.floor(pxRect.x / s);
  const wechatRightDip = Math.floor((pxRect.x + pxRect.width) / s);
  const nextY = Math.floor(pxRect.y / s);
  const nextH = Math.round(pxRect.height / s);

  let nextX;
  if (wechatRightDip + assistWidth <= wa.x + wa.width) {
    nextX = wechatRightDip - DOCK_GAP_FIX_DIPS; // 右贴
  } else {
    nextX = wechatLeftDip - assistWidth;        // 左贴
  }

  if (nextX < wa.x) nextX = wa.x;
  const maxX = wa.x + wa.width - assistWidth;
  if (nextX > maxX) nextX = maxX;

  return { x: nextX, y: nextY, w: assistWidth, h: nextH };
}

function syncHeightConstraint(h) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const hh = Math.max(1, Math.round(h));
  if (lastConstraintH === hh) return; // 仅在变化时同步，避免每帧刷新
  lastConstraintH = hh;
  mainWindow.setMinimumSize(ASSISTANT_MIN_W, hh);
  mainWindow.setMaximumSize(ASSISTANT_MAX_W, hh);
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: current.w,
    height: current.h,
    frame: false,
    resizable: true,          // 开启原生缩放
    show: false,
    transparent: false,
    titleBarStyle: 'hidden',
    hasShadow: false,         // 关闭阴影，避免与微信间出现视觉缝隙
    roundedCorners: false,    // Windows 11 圆角可能带来边缘空白
    backgroundColor: '#ffffff', // 减少首屏黑/白闪
    minWidth: ASSISTANT_MIN_W,
    maxWidth: ASSISTANT_MAX_W,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });
  mainWindow.loadFile('renderer/index.html');
  registerAimodelsHandlers(mainWindow);
  registerAiHandlers(mainWindow);

  // 初始同步一次高度限制
  syncHeightConstraint(current.h);

  // 记住用户拖动后的宽度
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

  // 键盘 Alt+D 开关 DevTools
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.alt && !input.control && !input.shift && String(input.key || '').toLowerCase() === 'd') {
      event.preventDefault();
      const wc = mainWindow.webContents;
      if (wc.isDevToolsOpened()) wc.closeDevTools();
      else wc.openDevTools({ mode: 'detach' });
    }
  });

  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.send('toolbar:pin-state', pinnedAlwaysOnTop);
  });
}

function toggleDevTools() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    const wc = mainWindow.webContents;
    if (wc.isDevToolsOpened()) wc.closeDevTools();
    else wc.openDevTools({ mode: 'detach' });
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
    show: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
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
  syncHeightConstraint(current.h); // 仅在高度变化时同步
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
      if (isWechatActive) {
        updateZOrder();
      }
    } catch {}
  }, FG_CHECK_INTERVAL);
}

// 兜底贴靠：每 400ms 主动对齐一次，避免偶发丢事件导致脱钩
function startDockPoller() {
  if (pollDockTimer) clearInterval(pollDockTimer);
  pollDockTimer = setInterval(() => {
    if (quitting || userHidden) return;
    try {
      const wins = windowManager.getWindows();
      const wx = wins.find(w => /微信|wechat/i.test(w.getTitle() || ''));
      if (!wx) return;
      const b = wx.getBounds(); // 物理像素
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
      applyTargetImmediate();                 // 立即贴靠
      firstDirectPosition = true;
      if (!userHidden) { showMain(); updateZOrder(); }
      break;
    case 'position':
      if (!wechatFound) return;
      target = dockToWeChatRightOrLeftPx({ x, y, width, height });
      applyTargetImmediate();                 // 每次位置变化都立即对齐，确保“吸附”
      if (!userHidden) { showMain(); updateZOrder(); }
      break;
    case 'foreground':
      if (!userHidden) { showMain(); updateZOrder(); }
      break;
    case 'minimized':
      if (!userHidden) { showMini(); }
      break;
    case 'restored':
      if (!userHidden) { showMain(); updateZOrder(); }
      break;
    case 'destroyed':
      wechatFound = false;
      wechatHWND = null;
      firstDirectPosition = false;
      if (!userHidden) showMini();
      break;
  }
}

function startAnimationLoop() {
  // 仅当确实有变化时 setBounds；达到目标后停止
  if (animationTimer) clearInterval(animationTimer);

  const EPS = 0.6;       // 小于此阈值视为到位
  const APPLY_DELTA = 1; // 边界变化达到 1px 才调用 setBounds

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

    // 插值推进
    current.x = lerp(current.x, target.x, LERP_SPEED);
    current.y = lerp(current.y, target.y, LERP_SPEED);
    current.w = lerp(current.w, target.w, LERP_SPEED);
    current.h = lerp(current.h, target.h, LERP_SPEED);

    // 仅在高度变化时同步约束，避免每帧刷新最小/最大尺寸
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

  // 动画循环满足条件时会很快自停；不再每帧强制刷新边界
  startAnimationLoop();
  startForegroundFollow();
  startDockPoller(); // 兜底贴靠，保证持续吸附

  const menu = Menu.buildFromTemplate([{
    label: 'Debug',
    submenu: [
      { label: 'Toggle DevTools', accelerator: 'Alt+D', click: toggleDevTools },
      { role: 'toggleDevTools', accelerator: 'Ctrl+Shift+I' }
    ]
  }]);
  Menu.setApplicationMenu(menu);
});

// 最小化/恢复/退出
ipcMain.on('close-main-window', () => { userHidden = true; showMini(); });
ipcMain.on('restore-main-window', () => {
  userHidden = false;
  if (wechatFound) { showMain(); updateZOrder(); }
  else { showMini(); }
});
ipcMain.on('exit-app', () => { cleanupAndQuit(); });

// DevTools 切换（来自渲染进程）
ipcMain.on('devtools:toggle', () => { toggleDevTools(); });

// 顶栏菜单动作
ipcMain.on('toolbar:click', async (_e, action) => {
  switch (action) {
    case 'new':
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('app:new-chat');
      break;
    case 'history':
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('app:show-history');
      break;
    case 'pin':
      pinnedAlwaysOnTop = !pinnedAlwaysOnTop;
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setAlwaysOnTop(pinnedAlwaysOnTop, 'screen-saver');
      }
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('toolbar:pin-state', pinnedAlwaysOnTop);
      }
      if (!pinnedAlwaysOnTop) updateZOrder();
      break;
    case 'screenshot':
      exec('explorer.exe ms-screenclip:', (err) => { if (err) exec('snippingtool /clip'); });
      break;
    case 'search':
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('app:search');
      break;
    case 'clear':
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('app:clear-chat');
      break;
    case 'export':
      await handleExport();
      break;
    case 'settings':
      openSettingsWindow();
      break;
    case 'about':
      showAbout();
      break;
    case 'minimize':
      userHidden = true; showMini();
      break;
    case 'exit':
      cleanupAndQuit();
      break;
  }
});

// 右侧自定义缩放：渲染进程把新宽度传上来
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

// 话术粘贴
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
    if (res.response === 1) {
      shell.openExternal('https://github.com/');
    }
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