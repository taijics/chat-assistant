function registerIpc(ctx) {
  const { deps, state } = ctx;
  // ✅ 一定要把 BrowserWindow 解构出来
  const { BrowserWindow, ipcMain, dialog, shell, nativeImage, clipboard } = deps.electron;

  // token
  ipcMain.handle('get-baidu-ocr-token', () => state.baiduOcrToken || '');
  ipcMain.handle('set-baidu-ocr-token', (_event, token) => {
    state.baiduOcrToken = token;
    return true;
  });

  ipcMain.on('close-main-window', () => {
    state.userHidden = true;
    ctx.windows.showMini();
  });

  ipcMain.on('restore-main-window', () => {
    ctx.windows.showMain();
    if (state.mainWindow && !state.mainWindow.isDestroyed()) {
      const wasPinned = state.pinnedAlwaysOnTop;
      try {
        state.mainWindow.setAlwaysOnTop(true, 'screen-saver');
        state.mainWindow.show();
        state.mainWindow.focus();
      } catch {}
      if (!wasPinned) {
        setTimeout(() => {
          try { if (state.mainWindow && !state.mainWindow.isDestroyed()) state.mainWindow.setAlwaysOnTop(false); } catch {}
        }, 80);
      }
    }
    ctx.follow.restoreDockIfNeeded('ipc');
  });

  ipcMain.on('exit-app', () => {
    ctx.lifecycle.enableQuit();
    ctx.lifecycle.cleanupAndQuit();
  });

  ipcMain.on('devtools:toggle', () => ctx.windows.toggleDevTools());

  ipcMain.handle('window:get-bounds', () => {
    if (!state.mainWindow || state.mainWindow.isDestroyed()) return null;
    return state.mainWindow.getBounds();
  });

  ipcMain.on('window:resize-width', (_e, newWidth) => {
    if (!state.mainWindow || state.mainWindow.isDestroyed()) return;
    const clamped = ctx.util.clamp(Math.round(newWidth || 0), state.ASSISTANT_MIN_W, state.ASSISTANT_MAX_W);
    if (clamped === state.assistWidth) return;
    state.assistWidth = clamped;
    try {
      const b = state.mainWindow.getBounds();
      state.mainWindow.setBounds({ x: b.x, y: b.y, width: clamped, height: b.height });
      state.target.w = clamped;
      state.current.w = clamped;
    } catch {}
  });

  // toolbar
  ipcMain.on('toolbar:click', async (_e, action) => {
    switch (action) {
      case 'new': state.mainWindow?.webContents.send('app:new-chat'); break;
      case 'history': state.mainWindow?.webContents.send('app:show-history'); break;
      case 'pin':
        state.pinnedAlwaysOnTop = !state.pinnedAlwaysOnTop;
        if (state.mainWindow && !state.mainWindow.isDestroyed()) {
          state.mainWindow.setAlwaysOnTop(state.pinnedAlwaysOnTop, 'screen-saver');
          state.mainWindow.webContents.send('toolbar:pin-state', state.pinnedAlwaysOnTop);
        }
        if (!state.pinnedAlwaysOnTop) ctx.follow.updateZOrder();
        break;
      case 'screenshot': {
        state.screenshotInProgress = true;
        state.screenshotPhase = 1;
        state.freezePosition = true;
        state.preShotWechatRect = state.lastWechatPxRect ? { ...state.lastWechatPxRect } : null;
        if (state.lastWechatPxRect && (!state.baselineArea || (state.lastWechatPxRect.width * state.lastWechatPxRect.height) >= state.baselineArea * 0.7)) {
          ctx.follow.acceptAsBaseline(state.lastWechatPxRect);
          const dockX = ctx.follow.computeDockX(state.lastWechatPxRect, state.assistWidth);
          state.lastDockX = dockX;
        }
        deps.exec('explorer.exe ms-screenclip:', (err) => {
          if (err) deps.exec('snippingtool /clip');
        });
        break;
      }
      case 'search': state.mainWindow?.webContents.send('app:search'); break;
      case 'clear': state.mainWindow?.webContents.send('app:clear-chat'); break;
      case 'export': await ctx.misc.handleExport(); break;
      case 'settings': ctx.misc.openSettingsWindow(); break;
      case 'about': ctx.misc.showAbout(); break;
      case 'minimize':
        try { state.isWechatActive = ctx.follow.computeIsWechatActive(); } catch {}
        state.userHidden = true;
        ctx.windows.showMini();
        break;
      case 'exit':
        state.quitting = true;
        ctx.lifecycle.enableQuit();
        ctx.lifecycle.cleanupAndQuit();
        break;
    }
  });

  // media:choose-dir
  ipcMain.handle('media:choose-dir', async (_e, payload) => {
    const title = (payload && payload.title) || '选择文件夹';
    const { canceled, filePaths } = await dialog.showOpenDialog({ title, properties: ['openDirectory'] });
    if (canceled || !filePaths || !filePaths[0]) return null;
    return filePaths[0];
  });

  // media:image-paste
  ipcMain.on('media:image-paste', async (_e, filePath) => {
    try {
      if (!filePath) return;
      const img = nativeImage.createFromPath(String(filePath));
      if (!img || (typeof img.isEmpty === 'function' && img.isEmpty())) return;
      clipboard.writeImage(img);
      ctx.chat.focusWeChatWindow();
      setTimeout(() => {
        try { deps.sendKeys.sendCtrlV(); } catch {}
        if (!state.pinnedAlwaysOnTop) ctx.follow.updateZOrder();
      }, 120);
    } catch (err) {
      console.error('image paste failed:', err);
    }
  });

  // ✅ VIP/设置中心窗口
  ipcMain.on('vip:open-settings', () => {
     try {
       if (state.settingsWindow && !state.settingsWindow.isDestroyed()) {
         state.settingsWindow.show();
         state.settingsWindow.focus();
         return;
       }
 
       const win = new BrowserWindow({
         parent: state.mainWindow || undefined,
         width: 980,
         height: 640,
         minWidth: 860,
         minHeight: 560,
         show: false, // ✅ 先不 show，避免闪一下
         frame: true,
         autoHideMenuBar: true,
         webPreferences: { nodeIntegration: true, contextIsolation: false }
       });
 
       state.settingsWindow = win;
 
       win.on('closed', () => {
         state.settingsWindow = null;
       });
 
       win.loadFile(require('path').join(__dirname, '../../renderer/settings.html'));
 
       // ✅ 页面准备好后再居中+显示（更稳定）
       win.once('ready-to-show', () => {
         try { win.center(); } catch {}
         try { win.show(); } catch {}
         try { win.focus(); } catch {}
       });
     } catch (e) {
       console.warn('[vip:open-settings] failed:', e && e.message);
     }
   });
// ✅ settings 窗口 DevTools 快捷键（Alt + D）
ipcMain.on('settings:devtools-toggle', () => {
  try {
    const win = state.settingsWindow;
    if (!win || win.isDestroyed()) return;
    const wc = win.webContents;
    if (!wc) return;

    if (wc.isDevToolsOpened()) wc.closeDevTools();
    else wc.openDevTools({ mode: 'detach' });
  } catch (e) {
    console.warn('[settings:devtools-toggle] failed:', e && e.message);
  }
});
  // inspect
  ipcMain.handle('wechat:is-docked', () => ctx.misc.isAssistantDocked());
  ipcMain.handle('wechat:is-foreground', () => {
    try { return !!(state.isWechatActive || ctx.misc.detectEnterpriseForegroundFallback()); } catch { return false; }
  });
}

module.exports = { registerIpc };