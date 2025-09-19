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
const {
  exec
} = require('child_process');
const {
  windowManager
} = require('node-window-manager'); // 聚焦微信用
const sendKeys = require('./utils/send-keys'); // 发送按键

let mainWindow = null;
let miniWindow = null;

let animationTimer = null;
const LERP_SPEED = 0.22;
const ANIMATION_INTERVAL = 16;
const ASSISTANT_WIDTH = 350;

let current = {
  x: 0,
  y: 0,
  w: ASSISTANT_WIDTH,
  h: 600
};
let target = {
  x: 0,
  y: 0,
  w: ASSISTANT_WIDTH,
  h: 600
};

let userHidden = false;
let wechatFound = false;
let wechatHWND = null;
let firstDirectPosition = false;
let quitting = false;
let pinnedAlwaysOnTop = false; // 置顶状态（默认关闭，不影响你既有的层级行为）

// 新增：前台跟随定时器（仅此功能）
let fgFollowTimer = null;
const FG_CHECK_INTERVAL = 250;

function lerp(a, b, t) {
  return a + (b - a) * t;
}

// 以“物理像素”选择显示器，再换算成 DIP
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

// 贴右侧；右侧不够则贴左侧；高度与微信一致（DIP）
function dockToWeChatRightOrLeftPx(pxRect) {
  const dip = pxToDipRect(pxRect);
  const wa = dip.display.workArea;
  let xRight = dip.x + dip.width;
  let nextX = xRight + ASSISTANT_WIDTH <= wa.x + wa.width ? xRight : (dip.x - ASSISTANT_WIDTH);
  if (nextX < wa.x) nextX = wa.x;
  if (nextX + ASSISTANT_WIDTH > wa.x + wa.width) nextX = wa.x + wa.width - ASSISTANT_WIDTH;
  const nextY = dip.y;
  const nextH = dip.height;
  return {
    x: nextX,
    y: nextY,
    w: ASSISTANT_WIDTH,
    h: nextH
  };
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: current.w,
    height: current.h,
    frame: false,
    resizable: false,
    show: false,
    transparent: false,
    titleBarStyle: 'hidden',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });
  mainWindow.loadFile('renderer/index.html');

  // 仅在本窗口聚焦时有效：Alt + D 切换 DevTools（不注册全局快捷键）
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (
      input.type === 'keyDown' &&
      input.alt &&
      !input.control &&
      !input.shift &&
      String(input.key || '').toLowerCase() === 'd'
    ) {
      event.preventDefault();
      const wc = mainWindow.webContents;
      if (wc.isDevToolsOpened()) wc.closeDevTools();
      else wc.openDevTools({
        mode: 'detach'
      }); // 独立窗口，避免影响布局
    }
  });

  // 渲染完成后把置顶状态同步给内嵌标题栏（不再自动打开 DevTools）
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.send('toolbar:pin-state', pinnedAlwaysOnTop);
  });
}
// 复用的切换函数（供菜单/IPC/before-input-event 都可调用）
function toggleDevTools() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    const wc = mainWindow.webContents;
    if (wc.isDevToolsOpened()) wc.closeDevTools();
    else wc.openDevTools({
      mode: 'detach'
    }); // 或改成 { mode: 'right' } 方便你先看到
  }
}

function createMiniWindow() {
  const {
    width
  } = screen.getPrimaryDisplay().workAreaSize;
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
  current = {
    ...target
  };
  mainWindow.setBounds({
    x: Math.round(current.x),
    y: Math.round(current.y),
    width: Math.round(current.w),
    height: Math.round(current.h)
  });
}

function updateZOrder() {
  if (quitting) return;
  if (!mainWindow || mainWindow.isDestroyed() || !wechatHWND) return;
  if (pinnedAlwaysOnTop) return; // 置顶模式下不干预 Z 序
  try {
    const hwndBuf = mainWindow.getNativeWindowHandle();
    wechatMonitor.setZOrder(hwndBuf, wechatHWND);
  } catch {}
}

// 新增：前台跟随微信，把助手同步到顶层（不改其它逻辑）
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
        updateZOrder(); // 让助手立即与微信同层级
      }
    } catch {}
  }, FG_CHECK_INTERVAL);
}

function handleEvent(evt) {
  if (quitting) return;
  const {
    type,
    x,
    y,
    width,
    height,
    hwnd
  } = evt;
  switch (type) {
    case 'found':
      wechatFound = true;
      wechatHWND = hwnd;
      target = dockToWeChatRightOrLeftPx({
        x,
        y,
        width,
        height
      });
      applyTargetImmediate();
      firstDirectPosition = true;
      if (!userHidden) {
        showMain();
        updateZOrder();
      }
      break;
    case 'position':
      if (!wechatFound) return;
      target = dockToWeChatRightOrLeftPx({
        x,
        y,
        width,
        height
      });
      if (!firstDirectPosition) {
        applyTargetImmediate();
        firstDirectPosition = true;
      }
      if (!userHidden) {
        showMain();
        updateZOrder();
      }
      break;
    case 'foreground':
      if (!userHidden) {
        showMain();
        updateZOrder();
      }
      break;
    case 'minimized':
      if (!userHidden) {
        showMini();
      }
      break;
    case 'restored':
      if (!userHidden) {
        showMain();
        updateZOrder();
      }
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
  if (animationTimer) clearInterval(animationTimer);
  animationTimer = setInterval(() => {
    if (quitting) return;
    if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible()) return;
    current.x = lerp(current.x, target.x, LERP_SPEED);
    current.y = lerp(current.y, target.y, LERP_SPEED);
    current.w = lerp(current.w, target.w, LERP_SPEED);
    current.h = lerp(current.h, target.h, LERP_SPEED);
    try {
      mainWindow.setBounds({
        x: Math.round(current.x),
        y: Math.round(current.y),
        width: Math.round(current.w),
        height: Math.round(current.h)
      });
    } catch {}
  }, ANIMATION_INTERVAL);
}

app.whenReady().then(() => {
  createMainWindow();
  createMiniWindow();
  wechatMonitor.start({
    keywords: []
  }, handleEvent);
  startAnimationLoop();
  startForegroundFollow();

  // 新增：应用菜单加速键（frame:false 下菜单不可见，但 accelerator 生效）
  const menu = Menu.buildFromTemplate([{
    label: 'Debug',
    submenu: [{
        label: 'Toggle DevTools',
        accelerator: 'Alt+D',
        click: toggleDevTools
      },
      // 备用：保留 Electron 默认的切换快捷键
      {
        role: 'toggleDevTools',
        accelerator: 'Ctrl+Shift+I'
      }
    ]
  }]);
  Menu.setApplicationMenu(menu);
});

// 最小化/恢复/退出
ipcMain.on('close-main-window', () => {
  userHidden = true;
  showMini();
});
ipcMain.on('restore-main-window', () => {
  userHidden = false;
  if (wechatFound) {
    showMain();
    updateZOrder();
  } else {
    showMini();
  }
});
ipcMain.on('exit-app', () => {
  cleanupAndQuit();
});
// Alt + D 来自 renderer：切换 DevTools（不改变默认不开启的行为）
// IPC
ipcMain.on('devtools:toggle', () => {
  toggleDevTools();
});


// 顶栏菜单动作（从渲染进程 header 发来）
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
      // 同步置顶状态到渲染进程
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('toolbar:pin-state', pinnedAlwaysOnTop);
      }
      if (!pinnedAlwaysOnTop) updateZOrder();
      break;
    case 'screenshot':
      exec('explorer.exe ms-screenclip:', (err) => {
        if (err) exec('snippingtool /clip');
      });
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
      userHidden = true;
      showMini();
      break;
    case 'exit':
      cleanupAndQuit();
      break;
  }
});

// 话术双击：复制 -> 聚焦微信 -> 发送 Ctrl+V（纯 JS）
ipcMain.on('phrase:paste', async (_e, text) => {
  try {
    if (!text) return;
    clipboard.writeText(String(text));

    // 尝试用句柄聚焦
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
      try {
        toFocus.bringToTop();
      } catch {}
      try {
        toFocus.focus();
      } catch {}
    }

    setTimeout(() => {
      sendKeys.sendCtrlV();
      if (!pinnedAlwaysOnTop) updateZOrder();
    }, 120);
  } catch (err) {
    console.error('phrase paste failed:', err);
  }
});
// 粘贴并发送（双击）
ipcMain.on('phrase:paste-send', async (_e, text) => {
  try {
    if (!text) return;
    clipboard.writeText(String(text));

    // 聚焦微信（与你的 phrase:paste 相同逻辑）
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

    // 粘贴 -> 回车发送
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

// 选择目录（返回单个路径或 null）
ipcMain.handle('media:choose-dir', async (_e, payload) => {
  const title = (payload && payload.title) || '选择文件夹';
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title,
    properties: ['openDirectory']
  });
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

    // 复用你的聚焦逻辑
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
    const {
      canceled,
      filePath
    } = await dialog.showSaveDialog({
      title: '导出聊天为 Markdown',
      defaultPath: 'chat-export.md',
      filters: [{
        name: 'Markdown',
        extensions: ['md']
      }]
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
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
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
        ok.onclick = () => {
          ipcRenderer.send('settings:set', { pinned: chk.checked });
          window.close();
        };
      </script>
    </body></html>
  `));
}

ipcMain.handle('settings:get', () => ({
  pinned: pinnedAlwaysOnTop
}));
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
  if (animationTimer) {
    clearInterval(animationTimer);
    animationTimer = null;
  }
  // 新增：清理前台跟随定时器
  if (fgFollowTimer) {
    clearInterval(fgFollowTimer);
    fgFollowTimer = null;
  }
  try {
    wechatMonitor.stop();
  } catch {}
  try {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.destroy();
  } catch {}
  try {
    if (miniWindow && !miniWindow.isDestroyed()) miniWindow.destroy();
  } catch {}
  app.quit();
}

app.on('window-all-closed', () => {
  cleanupAndQuit();
});