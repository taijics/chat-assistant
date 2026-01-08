function pathJoin(...args) {
  try {
    return require('path').join(...args);
  } catch {
    return args.join('/');
  }
}

function initWindows(ctx) {
  const { deps, state } = ctx;
  const { BrowserWindow, Menu, screen, ipcMain } = deps.electron;

  function positionMiniWindow() {
    if (!state.miniWindow || state.miniWindow.isDestroyed()) return;
    try {
      let display = null;
      if (state.lastWechatPxRect) display = ctx.follow.findDisplayForPhysicalRect(state.lastWechatPxRect);
      if (!display) display = screen.getPrimaryDisplay();
      const wa = display.workArea;
      const W = 160, H = 40;
      const targetX = Math.round(wa.x + wa.width - 20 - W);
      const targetY = Math.round(wa.y + 20);
      state.miniWindow.setBounds({ x: targetX, y: targetY, width: W, height: H });
    } catch (e) {
      console.warn('[mini position] fail:', e.message);
    }
  }

  function createKeeperWindow() {
    if (state.keeperWindow && !state.keeperWindow.isDestroyed()) return;
    state.keeperWindow = new BrowserWindow({
      show: false,
      width: 1,
      height: 1,
      x: -10000,
      y: -10000,
      frame: false,
      transparent: true,
      skipTaskbar: true,
    });
    try { state.keeperWindow.loadURL('about:blank'); } catch {}
  }

  function toggleDevTools() {
    if (!state.mainWindow || state.mainWindow.isDestroyed()) return;
    const wc = state.mainWindow.webContents;
    if (wc.isDevToolsOpened()) wc.closeDevTools();
    else wc.openDevTools({ mode: 'detach' });
  }

  function createMainWindow() {
    if (!state.wechatFound && !state.lastWechatPxRect) {
      const waH = screen.getPrimaryDisplay().workAreaSize.height;
      const desired = ctx.util.clamp(600 + 200, state.MIN_HEIGHT, Math.max(state.MIN_HEIGHT, waH - 40));
      state.current.h = desired;
      state.target.h = desired;
      state.lastStableAssistantHeight = desired;
      console.log('[startup] no wechat window, enlarge assistant height to', desired);
    }

    state.mainWindow = new BrowserWindow({
      width: state.assistWidth,
      height: state.current.h,
      frame: true,
      autoHideMenuBar: false,
      resizable: false,
      show: false,
      transparent: false,
      minWidth: state.ASSISTANT_MIN_W,
      minHeight: state.MIN_HEIGHT,
      webPreferences: { nodeIntegration: true, contextIsolation: false }
    });

    state.mainWindow.on('minimize', () => {
      if (state.quitting) return;
      try { state.isWechatActive = ctx.follow.computeIsWechatActive(); } catch {}
      state.userHidden = true;
      showMini();
    });

    state.mainWindow.on('close', (e) => {
      if (state.quitting) return;
      e.preventDefault();
      ctx.lifecycle.enableQuit();
      ctx.lifecycle.cleanupAndQuit();
    });

    state.mainWindow.on('show', () => {
      state.userHidden = false;
      try { if (state.miniWindow && !state.miniWindow.isDestroyed() && state.miniWindow.isVisible()) state.miniWindow.hide(); } catch {}
    });

    state.mainWindow.on('restore', () => {
      state.userHidden = false;
      try { if (state.miniWindow && !state.miniWindow.isDestroyed() && state.miniWindow.isVisible()) state.miniWindow.hide(); } catch {}
      ctx.follow.restoreDockIfNeeded('restore-event');
    });

    state.mainWindow.on('focus', () => {
      state.userHidden = false;
      try { if (state.miniWindow && !state.miniWindow.isDestroyed() && state.miniWindow.isVisible()) state.miniWindow.hide(); } catch {}
    });

    try { state.mainWindow.setHasShadow(false); } catch {}

    const template = [
      { label: '话术', click: () => state.mainWindow.webContents.send('menu:switch-tab', 'phrases') },
      { label: '浏览器', click: () => state.mainWindow.webContents.send('menu:switch-tab', 'models') },
      { label: '智能体', click: () => state.mainWindow.webContents.send('menu:switch-tab', 'ai') },
      { label: '表情/图片', click: () => state.mainWindow.webContents.send('menu:switch-tab', 'emojis') },
    ];
    try { Menu.setApplicationMenu(Menu.buildFromTemplate(template)); } catch {}
    try { state.mainWindow.setMenuBarVisibility(false); } catch {}

    state.mainWindow.loadFile(pathJoin(__dirname, '../../renderer/index.html'));

   try {
     deps.registerAimodelsHandlers(state.mainWindow);
     console.log('[boot] registerAimodelsHandlers invoked');
   } catch (e) {
     console.error('[boot] registerAimodelsHandlers invoke failed:', e && (e.stack || e.message || e));
   }
    try { deps.registerAiHandlers(state.mainWindow); } catch {}

    state.mainWindow.webContents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && input.alt && !input.control && !input.shift && String(input.key || '').toLowerCase() === 'd') {
        event.preventDefault();
        toggleDevTools();
      }
    });

    state.mainWindow.webContents.on('did-finish-load', () => {
      try { state.mainWindow.webContents.send('toolbar:pin-state', state.pinnedAlwaysOnTop); } catch {}
    });
  }

  function createMiniWindow() {
    const { width } = screen.getPrimaryDisplay().workAreaSize;
    state.miniWindow = new BrowserWindow({
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

    state.miniWindow.loadFile(pathJoin(__dirname, '../../renderer/mini.html'));

    state.miniWindow.on('close', (e) => {
      if (state.quitting) return;
      e.preventDefault();
      state.miniWindow.hide();
    });

    state.miniWindow.webContents.on('did-finish-load', () => {
      try {
        state.miniWindow.webContents.executeJavaScript(
          `document.addEventListener('click', () => { try { require('electron').ipcRenderer.send('restore-main-window'); } catch(e){} });`
        );
      } catch {}
    });

    state.miniWindow.webContents.on('before-input-event', (_event, input) => {
      if (input.type === 'mouseDown') {
        if (state.miniWindow && state.miniWindow.isVisible()) {
          try { ipcMain.emit('restore-main-window'); } catch (e) { console.warn('[mini restore] failed:', e && e.message); }
        }
      }
    });
  }

  function showMini() {
    if (state.quitting) return;
    if (state.mainWindow && !state.mainWindow.isDestroyed() && state.mainWindow.isVisible()) {
      try { state.mainWindow.hide(); } catch {}
    }
    if (state.miniWindow && !state.miniWindow.isDestroyed()) {
      if (!state.miniWindow.isVisible()) {
        try { state.miniWindow.show(); } catch {}
      }
      positionMiniWindow();
    }
  }

  function showMain() {
    if (state.quitting) return;
    if (state.miniWindow && !state.miniWindow.isDestroyed() && state.miniWindow.isVisible()) state.miniWindow.hide();
    if (state.mainWindow && !state.mainWindow.isDestroyed() && !state.mainWindow.isVisible()) state.mainWindow.show();
  }

  ctx.windows = { createMainWindow, createMiniWindow, createKeeperWindow, showMini, showMain, toggleDevTools, positionMiniWindow };
}

module.exports = { initWindows };