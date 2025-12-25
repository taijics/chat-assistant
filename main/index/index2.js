
// >>> ADDED or CHANGED: 统一恢复后吸附逻辑
function restoreDockIfNeeded(source) {
  try {
    userHidden = false;
    let activeNow = false;
    try {
      activeNow = computeIsWechatActive();
    } catch {}
    if (!wechatFound) {
      const info = getWechatWindowViaWM();
      if (info && info.rect && info.rect.width > 300 && info.rect.height > 300) {
        wechatFound = true;
        wechatHWND = info.hwnd || wechatHWND;
        lastWechatPxRect = info.rect;
        acceptAsBaseline(info.rect);
      }
    }
    if (wechatFound && lastWechatPxRect) {
      // 不再要求 activeNow；先贴靠
      dockToWechatNow(true);
      applyTargetImmediate();
      if (activeNow) updateZOrder(); // 仅在企业微信前台才调整层级
    } else {}
  } catch (e) {
    console.warn('[restoreDock] fail:', e.message);
  }
}

function createMainWindow() {
  if (!wechatFound && !lastWechatPxRect) {
    const waH = screen.getPrimaryDisplay().workAreaSize.height;
    const desired = clamp(600 + 200, MIN_HEIGHT, Math.max(MIN_HEIGHT, waH - 40));
    current.h = desired;
    target.h = desired;
    lastStableAssistantHeight = desired;
    console.log('[startup] no wechat window, enlarge assistant height to', desired);
  }

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
    }
  });

  // >>> CHANGED: 去掉 preventDefault，让系统真实最小化；仍显示 mini
  mainWindow.on('minimize', (e) => {
    if (quitting) return;
    // 不再阻止默认行为
    try {
      isWechatActive = computeIsWechatActive();
    } catch {}
    userHidden = true;
    showMini();
  });

  mainWindow.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();
    enableQuit();
    cleanupAndQuit();
  });

  mainWindow.on('show', () => {
    userHidden = false; // >>> ensure restore from taskbar sets visible state
    try {
      if (miniWindow && !miniWindow.isDestroyed() && miniWindow.isVisible()) miniWindow.hide();
    } catch {}
  });
  mainWindow.on('restore', () => {
    userHidden = false; // >>> ADDED
    try {
      if (miniWindow && !miniWindow.isDestroyed() && miniWindow.isVisible()) miniWindow.hide();
    } catch {}
    restoreDockIfNeeded('restore-event'); // >>> ADDED
  });
  mainWindow.on('focus', () => {
    userHidden = false; // >>> ADDED
    try {
      if (miniWindow && !miniWindow.isDestroyed() && miniWindow.isVisible()) miniWindow.hide();
    } catch {}
  });

  try {
    mainWindow.setHasShadow(false);
  } catch {}

  const template = [{
      label: '话术',
      click: () => mainWindow.webContents.send('menu:switch-tab', 'phrases')
    },
    {
      label: '浏览器',
      click: () => mainWindow.webContents.send('menu:switch-tab', 'models')
    },
    {
      label: '智能体',
      click: () => mainWindow.webContents.send('menu:switch-tab', 'ai')
    },
    {
      label: '表情/图片',
      click: () => mainWindow.webContents.send('menu:switch-tab', 'emojis')
    },
    /* {
      label: 'Help',
      submenu: [
        { label: 'Homepage', click: () => shell.openExternal('https://github.com/') },
        { label: '识别聊天用户列表', click: () => {
            const win = require('electron').BrowserWindow.getFocusedWindow();
            win.webContents.send('menu:recognize-wechat-users');
          }
        },
        { label: '百度token', click: () => {
            const win = require('electron').BrowserWindow.getFocusedWindow();
            win.webContents.send('menu:baidu-token');
          }
        }
      ]
    } */
  ];
  try {
    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);
  } catch {}
  try {
    mainWindow.setMenuBarVisibility(false);
  } catch {}

  mainWindow.loadFile(pathJoin(__dirname, '../renderer/index.html'));

  try {
    registerAimodelsHandlers(mainWindow);
  } catch {}
  try {
    registerAiHandlers(mainWindow);
  } catch {}

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.alt && !input.control && !input.shift &&
      String(input.key || '').toLowerCase() === 'd') {
      event.preventDefault();
      toggleDevTools();
    }
  });

  mainWindow.webContents.on('did-finish-load', () => {
    try {
      mainWindow.webContents.send('toolbar:pin-state', pinnedAlwaysOnTop);
    } catch {}
  });
}

function toggleDevTools() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const wc = mainWindow.webContents;
  if (wc.isDevToolsOpened()) wc.closeDevTools();
  else wc.openDevTools({
    mode: 'detach'
  });
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
  miniWindow.loadFile(pathJoin(__dirname, '../renderer/mini.html'));
  miniWindow.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();
    miniWindow.hide();
  });
  miniWindow.webContents.on('did-finish-load', () => {
    try {
      miniWindow.webContents.executeJavaScript(
        `document.addEventListener('click', () => { try { require('electron').ipcRenderer.send('restore-main-window'); } catch(e){} });`
      );
    } catch {}
  });
  miniWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'mouseDown') {
      if (miniWindow && miniWindow.isVisible()) {
        try {
          ipcMain.emit('restore-main-window');
        } catch (e) {
          console.warn('[mini restore] failed:', e && e.message);
        }
      }
    }
  });
}

function createKeeperWindow() {
  if (keeperWindow && !keeperWindow.isDestroyed()) return;
  keeperWindow = new BrowserWindow({
    show: false,
    width: 1,
    height: 1,
    x: -10000,
    y: -10000,
    frame: false,
    transparent: true,
    skipTaskbar: true
  });
  try {
    keeperWindow.loadURL('about:blank');
  } catch {}
}

function showMini() {
  if (quitting) return;
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) {
    try {
      mainWindow.hide();
    } catch {}
  }
  if (miniWindow && !miniWindow.isDestroyed()) {
    if (!miniWindow.isVisible()) {
      try {
        miniWindow.show();
      } catch {}
    }
    positionMiniWindow();
  }
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
  try {
    mainWindow.setBounds({
      x: Math.round(current.x),
      y: Math.round(current.y),
      width: Math.round(assistWidth),
      height: Math.round(current.h)
    });
  } catch {}
}

function updateZOrder(chatType) {
  if (quitting) return;
  if (!mainWindow || mainWindow.isDestroyed() || !wechatHWND) return;
  if (pinnedAlwaysOnTop) return;
  try {
    wechatMonitor.setZOrder(mainWindow.getNativeWindowHandle(), wechatHWND, chatType);
  } catch {}
}

function isNearFull(pxRect) {
  if (!pxRect) return false;
  const dip = pxToDipRect(pxRect);
  const wa = dip.display.workArea;
  if (!wa) return false;
  return dip.width >= wa.width * 0.9 && dip.height >= wa.height * 0.9;
}

function shouldIgnoreEphemeral(incomingRect) {
  if (!incomingRect || !incomingRect.width || !incomingRect.height) return true;
  if (!baselineArea || !lastBaselineRect) return false;
  const area = incomingRect.width * incomingRect.height;
  // 只按相对面积过滤“比之前明显小很多”的临时窗口
  const tooSmall = area < baselineArea * 0.45;
  if (!tooSmall) return false;
  const now = Date.now();
  if (now < ignoreEphemeralUntil) return true;
  return true;
}

let lastChatType = null;

function handleEvent(evt) {
  if (quitting) return;
   // 记录当前聊天窗口的进程名（wechat.exe / qq.exe 等，wechat_monitor 已经转小写）
    if (evt && typeof evt.procName === 'string') {
      lastProcName = String(evt.procName || '').toLowerCase();
    }
  const {
    type,
    x,
    y,
    width,
    height,
    hwnd
  } = evt;
  const incomingRect = {
    x,
    y,
    width,
    height
  };

  switch (type) {
    case 'found': {
      lastFoundAt = Date.now();
      if (screenshotInProgress || freezePosition) break;
      if (shouldIgnoreEphemeral(incomingRect)) break;
      wechatFound = true;
      wechatHWND = hwnd;
      lastWechatPxRect = incomingRect;
      acceptAsBaseline(incomingRect);
      console.log('[evt:found] set lastWechatPxRect', {
        rect: lastWechatPxRect,
        hwnd: wechatHWND
      });
      const dockX = computeDockX(lastWechatPxRect, assistWidth);
      lastDockX = dockX;
      const dip = pxToDipRect(lastWechatPxRect);
      const h = computeAssistantHeightFromWechatRect(lastWechatPxRect);
      target = {
        x: dockX,
        y: dip.y,
        w: assistWidth,
        h
      };
      if (shouldFollowNow()) applyTargetImmediate();
      firstDirectPosition = true;
      if (!userHidden && isWechatActive) updateZOrder(lastChatType);
      break;
    }
    case 'position': {
      lastFoundAt = Date.now();
      if (!wechatFound) {
        if (screenshotInProgress || freezePosition) break;
        if (shouldIgnoreEphemeral(incomingRect)) break;
        wechatFound = true;
        wechatHWND = hwnd;
      }
      if (freezePosition) {
        applyFrozen();
        break;
      }
      if (screenshotPhase === 2 && isNearFull(incomingRect)) break;
      if (shouldIgnoreEphemeral(incomingRect)) break;
      lastWechatPxRect = incomingRect;
      acceptAsBaseline(incomingRect);
      console.log('[evt:position] update lastWechatPxRect', {
        rect: lastWechatPxRect,
        hwnd: wechatHWND
      });
      const dockX = computeDockX(lastWechatPxRect, assistWidth);
      lastDockX = dockX;
      const dip = pxToDipRect(lastWechatPxRect);
      const h = computeAssistantHeightFromWechatRect(lastWechatPxRect);
      target = {
        x: dockX,
        y: dip.y,
        w: assistWidth,
        h
      };
      if (!firstDirectPosition && shouldFollowNow()) {
        applyTargetImmediate();
        firstDirectPosition = true;
      }
      if (!userHidden && isWechatActive) updateZOrder();
      break;
    }
    case 'foreground': {
      isWechatActive = true;
      dockToWechatNow(true);
      applyTargetImmediate();
      if (screenshotInProgress) {
        screenshotInProgress = false;
        screenshotPhase = 2;
        freezePosition = false;
        screenshotEndedAt = Date.now();
        ignoreEphemeralUntil = screenshotEndedAt + 3000;
        if (lastBaselineRect) {
          lastWechatPxRect = {
            ...lastBaselineRect
          };
          if (shouldFollowNow()) applyFrozen();
          wechatFound = true;
        } else if (preShotWechatRect) {
          lastWechatPxRect = {
            ...preShotWechatRect
          };
          acceptAsBaseline(lastWechatPxRect);
          if (shouldFollowNow()) applyFrozen();
          wechatFound = true;
        }
      } else if (screenshotPhase === 2 && Date.now() > ignoreEphemeralUntil) {
        screenshotPhase = 0;
      }
      if (!userHidden && isWechatActive) updateZOrder(lastChatType);
      break;
    }
    case 'minimized': {
      isWechatActive = false;
      if (screenshotInProgress || freezePosition) break;
      if (!userHidden) showMini();
      break;
    }
    case 'restored': {
      isWechatActive = true;
      if (screenshotInProgress) {
        screenshotInProgress = false;
        screenshotPhase = 2;
        freezePosition = false;
        screenshotEndedAt = Date.now();
        ignoreEphemeralUntil = screenshotEndedAt + 3000;
        if (lastBaselineRect) {
          lastWechatPxRect = {
            ...lastBaselineRect
          };
          if (shouldFollowNow()) applyFrozen();
          wechatFound = true;
        } else if (preShotWechatRect) {
          lastWechatPxRect = {
            ...preShotWechatRect
          };
          acceptAsBaseline(lastWechatPxRect);
          if (shouldFollowNow()) applyFrozen();
          wechatFound = true;
        }
      } else if (screenshotPhase === 2 && Date.now() > ignoreEphemeralUntil) {
        screenshotPhase = 0;
      }
      dockToWechatNow(true);
      applyTargetImmediate();
      showMain();
      if (wechatFound) updateZOrder();
      break;
    }
    case 'destroyed': {
      const dt = Date.now() - (lastFoundAt || 0);
      if (screenshotInProgress || freezePosition || Date.now() < ignoreEphemeralUntil) break;
      if (dt >= 0 && dt < TRANSIENT_DESTROY_MS) break;
      const wmInfo = getWechatWindowViaWM();
      if (wmInfo && wmInfo.rect && wmInfo.rect.width > 300 && wmInfo.rect.height > 300) {
        wechatFound = true;
        wechatHWND = wmInfo.hwnd || wechatHWND;
        lastWechatPxRect = wmInfo.rect;
        if (!shouldIgnoreEphemeral(wmInfo.rect)) acceptAsBaseline(wmInfo.rect);
        const dockX = computeDockX(lastWechatPxRect, assistWidth);
        lastDockX = dockX;
        const dip = pxToDipRect(lastWechatPxRect);
        const h = computeAssistantHeightFromWechatRect(lastWechatPxRect);
        target = {
          x: dockX,
          y: dip.y,
          w: assistWidth,
          h
        };
        if (shouldFollowNow()) applyTargetImmediate();
        if (!userHidden && isWechatActive) updateZOrder(lastChatType);
        break;
      }
      wechatFound = false;
      wechatHWND = null;
      firstDirectPosition = false;
      break;
    }
  }
}

function acceptAsBaseline(rect) {
  if (!rect) return;
  lastBaselineRect = {
    ...rect
  };
  baselineArea = rect.width * rect.height;
}

function startAnimationLoop() {
  if (animationTimer) clearInterval(animationTimer);
  animationTimer = setInterval(() => {
    if (quitting) return;
    if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible()) return;
    if (!shouldFollowNow()) return;
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

app.whenReady().then(async () => {
  try {
    if (windowManager && windowManager.getWindows) {
      const wins = windowManager.getWindows() || [];
      console.log('========== Chat window candidates on startup ==========');
      wins.forEach((w, idx) => {
        const type = classifyWindowType(w, 'startup:' + idx);
        if (!type) return;
        const b = w.getBounds?.();
        console.log('[startup-chat]', idx, {
          type,
          title: String(w.getTitle?.() || ''),
          proc: String(w.process?.name || ''),
          path: String(w.process?.path || ''),
          bounds: b ? {
            x: Math.round(b.x),
            y: Math.round(b.y),
            width: Math.round(b.width),
            height: Math.round(b.height)
          } : null
        });
      });
      console.log('======================================================');
    }
  } catch (e) {
    console.warn('[startup-chat] inspect error:', e.message);
  }
  createKeeperWindow();
  createMainWindow();
  createMiniWindow();
  showMain();
  try {
    wechatMonitor.start({
      keywords: ["微信", "企业微信", "Telegram", "WhatsApp", "QQ"]
    }, handleEvent);
  } catch (e) {
    console.warn('[wechatMonitor] start failed:', e.message);
  }
  setTimeout(() => {
    // ★ 仅在已经找到明确的聊天主窗时才尝试贴靠
    if (wechatFound && lastWechatPxRect && lastWechatPxRect.width > 300 && lastWechatPxRect.height > 300) {
      if (dockToWechatNow(true)) {
        if (computeIsWechatActive()) updateZOrder(); // 层级仍只在微信/企业微信前台
      }
    } else {
      // 启动阶段未找到聊天窗，不动窗口位置和高度
      console.log('[startup] no chat window found, skip initial dock');
    }
  }, 200);
  startAnimationLoop();
  startForegroundFollow();
  try {
    ocr.registerIpc();
    await ocr.start();
  } catch (e) {
    console.warn('[ocr] failed to start:', e && e.message);
  }
});

process.on('uncaughtException', (e) => {
  console.error('[uncaughtException]', e && e.stack || e);
});
process.on('unhandledRejection', (r) => {
  console.error('[unhandledRejection]', r && r.stack || r);
});
app.on('before-quit', (e) => {
  if (!allowQuit) {
    e.preventDefault();
    try {
      ocr.stop();
    } catch {}
    console.log('[before-quit] blocked');
  } else {
    console.log('[before-quit] allowed');
  }
});
app.on('will-quit', () => console.log('[will-quit]'));
app.on('quit', (_e, code) => console.log('[quit] code=', code));
process.on('exit', (code) => console.log('[process.exit] code=', code));

ipcMain.handle('get-baidu-ocr-token', () => getBaiduOcrToken());
ipcMain.handle('set-baidu-ocr-token', (_event, token) => {
  setBaiduOcrToken(token);
  return true;
});