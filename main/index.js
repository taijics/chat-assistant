const { app } = require('electron');
const ocr = require('./python-ocr');
app.setPath('userData', 'D:\\chat-assistant-userdata');

const electron = require('electron');
const { BrowserWindow, ipcMain, screen, dialog, shell, clipboard, Menu, nativeImage } = electron;

const os = require('os');
const fs = require('fs');
const path = require('path');
const { exec, spawnSync } = require('child_process');

const { createState } = require('./util/state');
const { initWindows } = require('./util/windows');
const { initChat } = require('./util/chat');
const { initFollow } = require('./util/follow');
const { initClipboard } = require('./util/clipboard');
const { registerIpc } = require('./util/ipc');
const { registerFeatures } = require('./util/features');

function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
function lerp(a, b, t) { return a + (b - a) * t; }

// wechatMonitor 自动探测（保持原逻辑）
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
    try { wechatMonitor = require(p); return; } catch {}
  }
  console.warn('[wechatMonitor] module not found. Using stub.');
  wechatMonitor = { start: () => {}, stop: () => {}, setZOrder: () => {} };
})();

let registerAimodelsHandlers = () => {};
try { ({ registerAimodelsHandlers } = require('./aimodels')); } catch {}
let registerAiHandlers = () => {};
try { ({ registerAiHandlers } = require('./ai-coze')); } catch {}

let sendKeys = { sendCtrlV() {}, sendEnter() {} };
try { sendKeys = require('../utils/send-keys'); } catch {
  try { sendKeys = require('./utils/send-keys'); } catch {}
  console.log('[BOOT] sendKeys keys=', Object.keys(sendKeys), 'sendCtrlV=', typeof sendKeys.sendCtrlV);
}

let windowManager = null;
try { ({ windowManager } = require('node-window-manager')); } catch (e) {
  console.warn('[deps] node-window-manager not loaded:', e && e.message);
  windowManager = { getActiveWindow() { return null; }, getWindows() { return []; } };
}

// ===== state center =====
const state = createState(app);
state.current.w = state.assistWidth;
state.target.w = state.assistWidth;

// ===== quit guard (保持原逻辑) =====
const realAppQuit = app.quit.bind(app);
const realAppExit = (app.exit ? app.exit.bind(app) : (code) => {});
const realProcExit = process.exit.bind(process);

function enableQuit() { state.allowQuit = true; }
app.quit = () => { if (state.allowQuit) return realAppQuit(); };
app.exit = (code) => { if (state.allowQuit) return realAppExit(code); };
process.exit = (code) => { if (state.allowQuit) return realProcExit(code); };

// ===== ctx (dependency injection) =====
const ctx = {
  state,
  util: { clamp, lerp },
  deps: {
    electron,
    electronApp: { app },
    wechatMonitor,
    windowManager,
    sendKeys,
    exec,
    registerAimodelsHandlers,
    registerAiHandlers
  },
  windows: null,
  chat: null,
  follow: null,
  clipboard: null,
  lifecycle: null,
  misc: null
};

// init modules
initChat(ctx);
initFollow(ctx);
initClipboard(ctx);
initWindows(ctx);

// ===== misc functions kept in index.js (no extra files) =====
ctx.lifecycle = {
  enableQuit,
  cleanupAndQuit() {
    if (state.quitting) return;
    state.quitting = true;
    if (state.animationTimer) { clearInterval(state.animationTimer); state.animationTimer = null; }
    if (state.fgFollowTimer) { clearInterval(state.fgFollowTimer); state.fgFollowTimer = null; }
    try { wechatMonitor.stop && wechatMonitor.stop(); } catch {}
    try { if (state.mainWindow && !state.mainWindow.isDestroyed()) state.mainWindow.destroy(); } catch {}
    try { if (state.miniWindow && !state.miniWindow.isDestroyed()) state.miniWindow.destroy(); } catch {}
    try { if (state.keeperWindow && !state.keeperWindow.isDestroyed()) state.keeperWindow.destroy(); } catch {}
    realAppQuit();
  }
};

ctx.misc = {
  async handleExport() {
    try {
      let data = null;
      if (state.mainWindow && !state.mainWindow.isDestroyed()) {
        try {
          data = await state.mainWindow.webContents.executeJavaScript(
            'window.__exportChatData ? window.__exportChatData() : null', true
          );
        } catch {}
      }
      if (!data) data = '# 导出内容\n\n当前页面未提供导出实现（__exportChatData）。\n请在渲染进程定义 window.__exportChatData() 返回 Markdown 文本。';
      const { canceled, filePath } = await dialog.showSaveDialog({
        title: '导出聊天为 Markdown',
        defaultPath: 'chat-export.md',
        filters: [{ name: 'Markdown', extensions: ['md'] }]
      });
      if (!canceled && filePath) fs.writeFileSync(filePath, data, 'utf8');
    } catch (e) {
      console.error('export failed:', e);
    }
  },

  openSettingsWindow() {
    if (!state.mainWindow || state.mainWindow.isDestroyed()) return;
    const win = new BrowserWindow({
      parent: state.mainWindow,
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
          const ok  = document.getElementById('btn-ok');
          ipcRenderer.invoke('settings:get').then(state => { chk.checked = !!state.pinned; });
          ok.onclick = () => { ipcRenderer.send('settings:set', { pinned: chk.checked }); window.close(); };
        </script>
      </body></html>
    `));
  },

  showAbout() {
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
  },

  isAssistantDocked() {
    try {
      if (!state.wechatFound || !state.lastWechatPxRect || !state.mainWindow || state.mainWindow.isDestroyed()) return false;
      if (!state.mainWindow.isVisible()) return false;
      const assistant = state.mainWindow.getBounds();
      if (!assistant || assistant.width < 50 || assistant.height < 50) return false;
      const dipWechat = ctx.follow.pxToDipRect(state.lastWechatPxRect);
      const wx = dipWechat.x, wy = dipWechat.y, ww = dipWechat.width, wh = dipWechat.height;
      if (ww < 200 || wh < 200) return false;
      const AX = assistant.x, AY = assistant.y, AW = assistant.width, AH = assistant.height;
      const H_TOLERANCE = 40;
      const SIDE_TOLERANCE = 40;
      const MIN_OVERLAP_HEIGHT_RATIO = 0.65;
      const topAligned = Math.abs(AY - wy) <= H_TOLERANCE;
      const overlapTop = Math.max(AY, wy);
      const overlapBottom = Math.min(AY + AH, wy + wh);
      const overlapHeight = Math.max(0, overlapBottom - overlapTop);
      const overlapEnough = overlapHeight >= wh * MIN_OVERLAP_HEIGHT_RATIO;
      const rightEdgeAssistant = AX + AW;
      const leftDock = Math.abs(rightEdgeAssistant - wx) <= SIDE_TOLERANCE;
      const rightDock = Math.abs(AX - (wx + ww)) <= SIDE_TOLERANCE;
      return (leftDock || rightDock) && topAligned && overlapEnough;
    } catch {
      return false;
    }
  },

  detectEnterpriseForegroundFallback() {
    const ENTERPRISE_PROC_NAMES = new Set(['WXWork.exe','WeCom.exe','WeChatAppEx.exe','WXWorkWeb.exe','WeMail.exe','WXDrive.exe']);
    try {
      if (!windowManager || !windowManager.getActiveWindow) return false;
      const active = windowManager.getActiveWindow();
      if (active) {
        const title = active.getTitle?.() || '';
        const proc = active.process?.name || '';
        if (/企业微信|wxwork|wecom/i.test(title)) return true;
        if (ENTERPRISE_PROC_NAMES.has(proc)) return true;
      }
      const wins = windowManager.getWindows();
      if (!Array.isArray(wins) || !wins.length) return false;
      const activeHandle = active ? Number(active.handle) : null;
      for (const w of wins) {
        const t = w.getTitle?.() || '';
        const p = w.process?.name || '';
        const h = Number(w.handle);
        if (/企业微信|wxwork|wecom/i.test(t) || ENTERPRISE_PROC_NAMES.has(p)) {
          if (activeHandle && h === activeHandle) return true;
        }
      }
      return false;
    } catch {
      return false;
    }
  }
};

// ===== register ipc/features =====
registerIpc(ctx);
console.log('[BOOT] before registerFeatures');
registerFeatures(ctx);
console.log('[BOOT] after registerFeatures');

// ===== warm up helpers =====
app.whenReady().then(() => {
  try { ctx.clipboard.ensureGifStoreDir(); } catch {}
  try { ctx.clipboard.ensureFileDropHelperReady(); } catch {}
});

// ===== handleEvent (保持原逻辑，不拆) =====
function handleEvent(evt) {
  if (state.quitting) return;
  if (evt && typeof evt.procName === 'string') state.lastProcName = String(evt.procName || '').toLowerCase();

  const { type, x, y, width, height, hwnd } = evt;
  const incomingRect = { x, y, width, height };

  switch (type) {
    case 'found': {
      state.lastFoundAt = Date.now();
      if (state.screenshotInProgress || state.freezePosition) break;
      if (ctx.follow.shouldIgnoreEphemeral(incomingRect)) break;
      state.wechatFound = true;
      state.wechatHWND = hwnd;
      state.lastWechatPxRect = incomingRect;
      ctx.follow.acceptAsBaseline(incomingRect);

      const dockX = ctx.follow.computeDockX(state.lastWechatPxRect, state.assistWidth);
      state.lastDockX = dockX;
      const dip = ctx.follow.pxToDipRect(state.lastWechatPxRect);
      const h = ctx.follow.computeAssistantHeightFromWechatRect(state.lastWechatPxRect);
      state.target = { x: dockX, y: dip.y, w: state.assistWidth, h };
      if (ctx.follow.shouldFollowNow()) ctx.follow.applyTargetImmediate();
      state.firstDirectPosition = true;
      if (!state.userHidden && state.isWechatActive) ctx.follow.updateZOrder(null);
      break;
    }
    case 'position': {
      state.lastFoundAt = Date.now();
      if (!state.wechatFound) {
        if (state.screenshotInProgress || state.freezePosition) break;
        if (ctx.follow.shouldIgnoreEphemeral(incomingRect)) break;
        state.wechatFound = true;
        state.wechatHWND = hwnd;
      }
      if (state.freezePosition) {
        ctx.follow.applyFrozen();
        break;
      }
      if (state.screenshotPhase === 2 && ctx.follow.isNearFull(incomingRect)) break;
      if (ctx.follow.shouldIgnoreEphemeral(incomingRect)) break;

      state.lastWechatPxRect = incomingRect;
      ctx.follow.acceptAsBaseline(incomingRect);

      const dockX = ctx.follow.computeDockX(state.lastWechatPxRect, state.assistWidth);
      state.lastDockX = dockX;
      const dip = ctx.follow.pxToDipRect(state.lastWechatPxRect);
      const h = ctx.follow.computeAssistantHeightFromWechatRect(state.lastWechatPxRect);
      state.target = { x: dockX, y: dip.y, w: state.assistWidth, h };

      if (!state.firstDirectPosition && ctx.follow.shouldFollowNow()) {
        ctx.follow.applyTargetImmediate();
        state.firstDirectPosition = true;
      }
      if (!state.userHidden && state.isWechatActive) ctx.follow.updateZOrder();
      break;
    }
    case 'foreground': {
      state.isWechatActive = true;
      ctx.follow.dockToWechatNow(true);
      ctx.follow.applyTargetImmediate();

      if (state.screenshotInProgress) {
        state.screenshotInProgress = false;
        state.screenshotPhase = 2;
        state.freezePosition = false;
        state.screenshotEndedAt = Date.now();
        state.ignoreEphemeralUntil = state.screenshotEndedAt + 3000;

        if (state.lastBaselineRect) {
          state.lastWechatPxRect = { ...state.lastBaselineRect };
          if (ctx.follow.shouldFollowNow()) ctx.follow.applyFrozen();
          state.wechatFound = true;
        } else if (state.preShotWechatRect) {
          state.lastWechatPxRect = { ...state.preShotWechatRect };
          ctx.follow.acceptAsBaseline(state.lastWechatPxRect);
          if (ctx.follow.shouldFollowNow()) ctx.follow.applyFrozen();
          state.wechatFound = true;
        }
      } else if (state.screenshotPhase === 2 && Date.now() > state.ignoreEphemeralUntil) {
        state.screenshotPhase = 0;
      }

      if (!state.userHidden && state.isWechatActive) ctx.follow.updateZOrder();
      break;
    }
    case 'minimized': {
      state.isWechatActive = false;
      if (state.screenshotInProgress || state.freezePosition) break;
      if (!state.userHidden) ctx.windows.showMini();
      break;
    }
    case 'restored': {
      state.isWechatActive = true;
      if (state.screenshotInProgress) {
        state.screenshotInProgress = false;
        state.screenshotPhase = 2;
        state.freezePosition = false;
        state.screenshotEndedAt = Date.now();
        state.ignoreEphemeralUntil = state.screenshotEndedAt + 3000;
        if (state.lastBaselineRect) {
          state.lastWechatPxRect = { ...state.lastBaselineRect };
          if (ctx.follow.shouldFollowNow()) ctx.follow.applyFrozen();
          state.wechatFound = true;
        } else if (state.preShotWechatRect) {
          state.lastWechatPxRect = { ...state.preShotWechatRect };
          ctx.follow.acceptAsBaseline(state.lastWechatPxRect);
          if (ctx.follow.shouldFollowNow()) ctx.follow.applyFrozen();
          state.wechatFound = true;
        }
      } else if (state.screenshotPhase === 2 && Date.now() > state.ignoreEphemeralUntil) {
        state.screenshotPhase = 0;
      }
      ctx.follow.dockToWechatNow(true);
      ctx.follow.applyTargetImmediate();
      ctx.windows.showMain();
      if (state.wechatFound) ctx.follow.updateZOrder();
      break;
    }
    case 'destroyed': {
      const dt = Date.now() - (state.lastFoundAt || 0);
      if (state.screenshotInProgress || state.freezePosition || Date.now() < state.ignoreEphemeralUntil) break;
      if (dt >= 0 && dt < state.TRANSIENT_DESTROY_MS) break;

      const wmInfo = ctx.follow.getWechatWindowViaWM();
      if (wmInfo && wmInfo.rect && wmInfo.rect.width > 300 && wmInfo.rect.height > 300) {
        state.wechatFound = true;
        state.wechatHWND = wmInfo.hwnd || state.wechatHWND;
        state.lastWechatPxRect = wmInfo.rect;
        if (!ctx.follow.shouldIgnoreEphemeral(wmInfo.rect)) ctx.follow.acceptAsBaseline(wmInfo.rect);

        const dockX = ctx.follow.computeDockX(state.lastWechatPxRect, state.assistWidth);
        state.lastDockX = dockX;
        const dip = ctx.follow.pxToDipRect(state.lastWechatPxRect);
        const h = ctx.follow.computeAssistantHeightFromWechatRect(state.lastWechatPxRect);
        state.target = { x: dockX, y: dip.y, w: state.assistWidth, h };

        if (ctx.follow.shouldFollowNow()) ctx.follow.applyTargetImmediate();
        if (!state.userHidden && state.isWechatActive) ctx.follow.updateZOrder();
        break;
      }

      state.wechatFound = false;
      state.wechatHWND = null;
      state.firstDirectPosition = false;
      break;
    }
  }
}

// ===== app boot (保持原逻辑) =====
app.whenReady().then(async () => {
  try {
    if (windowManager && windowManager.getWindows) {
      const wins = windowManager.getWindows() || [];
      console.log('========== Chat window candidates on startup ==========');
      wins.forEach((w, idx) => {
        const type = ctx.chat.classifyWindowType(w, 'startup:' + idx);
        if (!type) return;
        const b = w.getBounds?.();
        console.log('[startup-chat]', idx, {
          type,
          title: String(w.getTitle?.() || ''),
          proc: String(w.process?.name || ''),
          path: String(w.process?.path || ''),
          bounds: b ? { x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) } : null
        });
      });
      console.log('======================================================');
    }
  } catch (e) {
    console.warn('[startup-chat] inspect error:', e.message);
  }

  ctx.windows.createKeeperWindow();
  ctx.windows.createMainWindow();
  ctx.windows.createMiniWindow();
  ctx.windows.showMain();

  try {
    wechatMonitor.start({ keywords: ["微信", "企业微信", "Telegram", "WhatsApp", "QQ"] }, handleEvent);
  } catch (e) {
    console.warn('[wechatMonitor] start failed:', e.message);
  }

  setTimeout(() => {
    if (state.wechatFound && state.lastWechatPxRect && state.lastWechatPxRect.width > 300 && state.lastWechatPxRect.height > 300) {
      if (ctx.follow.dockToWechatNow(true)) {
        if (ctx.follow.computeIsWechatActive()) ctx.follow.updateZOrder();
      }
    } else {
      console.log('[startup] no chat window found, skip initial dock');
    }
  }, 200);

  ctx.follow.startAnimationLoop();
  ctx.follow.startForegroundFollow();

  try {
    ocr.registerIpc();
    await ocr.start();
  } catch (e) {
    console.warn('[ocr] failed to start:', e && e.message);
  }
});

// ===== process/app events (保持原逻辑) =====
process.on('uncaughtException', (e) => console.error('[uncaughtException]', e && e.stack || e));
process.on('unhandledRejection', (r) => console.error('[unhandledRejection]', r && r.stack || r));

app.on('before-quit', (e) => {
  if (!state.allowQuit) {
    e.preventDefault();
    try { ocr.stop(); } catch {}
    console.log('[before-quit] blocked');
  } else {
    console.log('[before-quit] allowed');
  }
});
app.on('will-quit', () => console.log('[will-quit]'));
app.on('quit', (_e, code) => console.log('[quit] code=', code));
process.on('exit', (code) => console.log('[process.exit] code=', code));

app.on('window-all-closed', (e) => {
  console.log('[all-closed] quitting=', state.quitting, 'allowQuit=', state.allowQuit);
  if (!state.allowQuit) {
    e.preventDefault();
    ctx.windows.createKeeperWindow();
    return;
  }
  ctx.lifecycle.cleanupAndQuit();
});

// settings ipc (保持原逻辑)
ipcMain.handle('settings:get', () => ({ pinned: state.pinnedAlwaysOnTop }));
ipcMain.on('settings:set', (_e, payload) => {
  const v = !!(payload && payload.pinned);
  if (v !== state.pinnedAlwaysOnTop) {
    state.pinnedAlwaysOnTop = v;
    if (state.mainWindow && !state.mainWindow.isDestroyed()) {
      state.mainWindow.setAlwaysOnTop(state.pinnedAlwaysOnTop, 'screen-saver');
      state.mainWindow.webContents.send('toolbar:pin-state', state.pinnedAlwaysOnTop);
    }
    if (!state.pinnedAlwaysOnTop) ctx.follow.updateZOrder();
  }
});