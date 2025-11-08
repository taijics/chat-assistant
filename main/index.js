const {
  app
} = require('electron');
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

// === 退出防护：仅显式允许退出（NEW） ===
const realAppQuit = app.quit.bind(app);
const realAppExit = (app.exit ? app.exit.bind(app) : (code) => {});
const realProcExit = process.exit.bind(process);
let allowQuit = false;

function enableQuit() {
  allowQuit = true;
}
app.quit = () => {
  if (allowQuit) return realAppQuit();
  try {
    console.log('[guard] app.quit blocked');
  } catch {}
};
app.exit = (code) => {
  if (allowQuit) return realAppExit(code);
  try {
    console.log('[guard] app.exit blocked', code);
  } catch {}
};
process.exit = (code) => {
  if (allowQuit) return realProcExit(code);
  try {
    console.log('[guard] process.exit blocked', code);
  } catch {}
};
// ======================================

function setBaiduOcrToken(token) {
  global.baiduOcrToken = token;
}

function getBaiduOcrToken() {
  return global.baiduOcrToken || '';
}

// wechatMonitor 自动探测
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
  console.warn('[wechatMonitor] module not found. Using stub.');
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

// send-keys 兼容
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

const {
  exec
} = require('child_process');

// node-window-manager
let windowManager = null;
try {
  ({
    windowManager
  } = require('node-window-manager'));
  console.log('[deps] node-window-manager loaded');
} catch (e) {
  console.warn('[deps] node-window-manager not loaded:', e && e.message);
  windowManager = {
    getActiveWindow() {
      return null;
    },
    getWindows() {
      return [];
    }
  };
}

let mainWindow = null;
let miniWindow = null;
let keeperWindow = null; // 新增哨兵窗口

let animationTimer = null;
const LERP_SPEED = 0.22;
const ANIMATION_INTERVAL = 16;

const ASSISTANT_MIN_W = 260;
const ASSISTANT_MAX_W = 1400;
let assistWidth = 350;
const MIN_HEIGHT = 200;
const DOCK_GAP_FIX_DIPS = 2;
// 再靠近主窗体的物理像素（按显示器缩放换算到 DIP）
const EXTRA_NUDGE_PHYSICAL_PX = 6;
// 前台判定与跟随开关
let isWechatActive = false;
function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

let current = {
  x: 0,
  y: 0,
  w: assistWidth,
  h: 600
};
let target = {
  x: 0,
  y: 0,
  w: assistWidth,
  h: 600
};

let userHidden = false;
let wechatFound = false;
let wechatHWND = null;
let firstDirectPosition = false;
let quitting = false;
let pinnedAlwaysOnTop = false;
let lastWechatPxRect = null;

// 前台轮询
let fgFollowTimer = null;
const FG_CHECK_INTERVAL = 250;
// 新增状态与限制
let lastStableAssistantHeight = 600;
let dockSide = null; // 'right' 或 'left'
const MAX_ASSISTANT_HEIGHT_MARGIN = 40;
// 截图期状态（保留）
let screenshotInProgress = false;
let preShotWechatRect = null;

// 新增：用于判断 destroyed 是否为瞬时（截图/临时）
let lastFoundAt = 0;
const TRANSIENT_DESTROY_MS = 3000;

// ==== 新增辅助与状态（放在顶部已有常量附近） ====
let freezePosition = false; // 是否冻结位置更新
let screenshotPhase = 0; // 0=正常 1=截图中 2=截图刚结束等待首个正常 rect
let lastValidWechatRect = null; // 最近一次可信的微信矩形
let lastDockX = null; // 最近一次使用的 dock X（用于冻结时复用）
let lastBaselineRect = null;
let baselineArea = null;
let screenshotEndedAt = 0;
let ignoreEphemeralUntil = 0;
function isRectNearFull(pxRect) {
  if (!pxRect) return false;
  const dip = pxToDipRect(pxRect);
  const wa = dip.display.workArea;
  if (!wa) return false;
  return (dip.width >= wa.width * 0.95) && (dip.height >= wa.height * 0.95);
}

// 可能是临时（截图层、过渡动画、全屏虚假）条件：宽高异常或 X,Y 负得过大
function isRectSuspicious(pxRect) {
  if (!pxRect) return true;
  const dip = pxToDipRect(pxRect);
  const wa = dip.display.workArea;
  if (!wa) return true;
  if (dip.width <= 80 || dip.height <= 80) return true;
  if (dip.width >= wa.width * 1.1 || dip.height >= wa.height * 1.1) return true;
  if (dip.x < wa.x - wa.width * 0.3 || dip.y < wa.y - wa.height * 0.3) return true;
  return false;
}
function computeIsWechatActive() {
  try {
    const active = windowManager.getActiveWindow();
    if (!active) return false;
    return (
      Number(active.handle) === Number(wechatHWND) ||
      /微信|wechat/i.test(active.getTitle() || '')
    );
  } catch { return false; }
}
function shouldFollowNow() {
  return wechatFound && isWechatActive && !userHidden && !pinnedAlwaysOnTop;
}
// 冻结时强制保持窗口位置与大小
function applyFrozen() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (lastDockX == null || !lastValidWechatRect) return;
  if (!shouldFollowNow()) return; // 后台时不动
  const dip = pxToDipRect(lastValidWechatRect);
  const h  = computeAssistantHeightFromWechatRect(lastValidWechatRect);
  target.x = lastDockX;
  target.y = dip.y;
  target.h = h;
  applyTargetImmediate();
}


// 放在文件顶部 windowManager 可用之后
function getWechatWindowViaWM() {
  try {
    if (!windowManager || !windowManager.getWindows) return null;
    const wins = windowManager.getWindows();
    if (!Array.isArray(wins) || !wins.length) return null;
    // 优先企业微信/wxwork，其次微信/weixin
    const pick = (re) => wins.find(w => {
      const t = String(w.getTitle?.() || '');
      const p = String(w?.process?.name || '');
      return re.test(t) || re.test(p);
    });
    let w = pick(/企业微信|wxwork/i) || pick(/微信|wechat|weixin/i);
    if (!w) return null;
    const b = w.getBounds?.();
    if (!b || !isFinite(b.x) || !isFinite(b.y) || !isFinite(b.width) || !isFinite(b.height)) return null;
    return {
      hwnd: Number(w.handle),
      rect: {
        x: Math.round(b.x),
        y: Math.round(b.y),
        width: Math.round(b.width),
        height: Math.round(b.height)
      }
    };
  } catch {
    return null;
  }
}
// 工具：显示器与坐标换算
function findDisplayForPhysicalRect(pxRect) {
  const displays = screen.getAllDisplays();
  let best = displays[0],
    bestArea = -1;
  for (const d of displays) {
    const db = d.bounds,
      s = d.scaleFactor || 1;
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

function computeDockX(pxRect, width) {
  console.log(pxRect, width)
  const display = findDisplayForPhysicalRect(pxRect);
  const s = display.scaleFactor || 1;
  const wa = display.workArea;
  const wechatLeftDip = Math.floor(pxRect.x / s);
  const wechatRightDip = Math.floor((pxRect.x + pxRect.width) / s);

  // 把 3px 换算为 DIP，至少 1 DIP，叠加到原有修正
  const extraDip = Math.max(1, Math.round(EXTRA_NUDGE_PHYSICAL_PX / s));
  const gapDip = DOCK_GAP_FIX_DIPS + extraDip;

  // 初次确定 dockSide
  if (!dockSide) {
    if (wechatRightDip + width <= wa.x + wa.width) dockSide = 'right';
    else dockSide = 'left';
  }

  let nextX;
  if (dockSide === 'right') {
    if (wechatRightDip + width <= wa.x + wa.width) {
      // 再向主窗体靠近 gapDip（更贴）
      nextX = wechatRightDip - gapDip;
    } else {
      // 右侧放不下，切换一次到左侧
      dockSide = 'left';
      // 左侧也向右 nudged gapDip 让缝更小
      nextX = wechatLeftDip - width + gapDip;
    }
  } else { // left
    if (wechatLeftDip - width >= wa.x) {
      // 左侧同样靠近（右 nudged）
      nextX = wechatLeftDip - width + gapDip;
    } else {
      // 左侧放不下，切到右侧
      dockSide = 'right';
      nextX = wechatRightDip - gapDip;
    }
  }

  if (nextX < wa.x) nextX = wa.x;
  const maxX = wa.x + wa.width - width;
  if (nextX > maxX) nextX = maxX;
  return nextX;
}

function computeAssistantHeightFromWechatRect(pxRect) {
  if (!pxRect || !pxRect.width || !pxRect.height) return lastStableAssistantHeight;
  const dip = pxToDipRect(pxRect);
  const rawHeight = dip.height;
  const maxAllowed = Math.max(MIN_HEIGHT, (dip.display.workArea?.height || rawHeight) - MAX_ASSISTANT_HEIGHT_MARGIN);

  // 明显异常：超过最大允许高度 1.25 倍（可能是截屏层 / 虚假）
  if (rawHeight > maxAllowed * 1.25) {
    return lastStableAssistantHeight; // 回退
  }

  const h = clamp(rawHeight, MIN_HEIGHT, maxAllowed);
  lastStableAssistantHeight = h;
  return h;
}

// 复用贴边
function reDockFromLastRect() {
  if (!lastWechatPxRect) return false;
  const r = lastWechatPxRect;
  if (!r.width || !r.height) return false;
  const dockX = computeDockX(r, assistWidth);
  const dip = pxToDipRect(r);
  const h = computeAssistantHeightFromWechatRect(r);
  target = { x: dockX, y: dip.y, w: assistWidth, h };
  if (shouldFollowNow()) applyTargetImmediate(); // 仅前台时应用
  return true;
}
// 放在 reDockFromLastRect 后面，新增一个“立即贴靠”工具（可强制应用）
function dockToWechatNow(force = false) {
  try {
    let rect = lastWechatPxRect;
    if (!rect) {
      const info = getWechatWindowViaWM();
      if (info && info.rect && info.rect.width > 300 && info.rect.height > 300) {
        wechatFound = true;
        wechatHWND = info.hwnd || wechatHWND;
        rect = info.rect;
        lastWechatPxRect = rect;
        acceptAsBaseline(rect);
      }
    }
    if (!rect) return false;

    const dockX = computeDockX(rect, assistWidth);
    lastDockX = dockX;
    const dip = pxToDipRect(rect);
    const h = computeAssistantHeightFromWechatRect(rect);
    target = { x: dockX, y: dip.y, w: assistWidth, h };

    if (force || shouldFollowNow()) applyTargetImmediate();
    return true;
  } catch {
    return false;
  }
}

function createMainWindow() {
  // 如果启动时还没有检测到主窗体，则把初始高度拉大
  if (!wechatFound && !lastWechatPxRect) {
    const waH = screen.getPrimaryDisplay().workAreaSize.height;
    // 期望高度：基础 600 + 500 = 1100；但不超过工作区高度 - 40 边距
    const desired = clamp(600 + 200, MIN_HEIGHT, Math.max(MIN_HEIGHT, waH - 40));
    current.h = desired;
    target.h = desired;
    lastStableAssistantHeight = desired;
    console.log('[startup] no wechat window, enlarge assistant height to', desired);
  }

  mainWindow = new BrowserWindow({
    width: assistWidth,
    height: current.h,  // 不需要再用 initialH，直接用上面更新后的 current.h
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

  mainWindow.on('minimize', (e) => {
    if (quitting) return;
    e.preventDefault();
    userHidden = true;
    showMini();
  });
 mainWindow.on('close', (e) => {
   if (quitting) return;           // 已在退出流程中则放行
   e.preventDefault();             // 阻止默认关闭
   enableQuit();                   // 打开退出防护
   cleanupAndQuit();               // 走统一清理并退出
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
      label: '表情',
      click: () => mainWindow.webContents.send('menu:switch-tab', 'emojis')
    },
    {
      label: 'Help',
      submenu: [{
          label: 'Homepage',
          click: () => shell.openExternal('https://github.com/')
        },
        {
          label: '识别聊天用户列表',
          click: () => {
            const win = require('electron').BrowserWindow.getFocusedWindow();
            win.webContents.send('menu:recognize-wechat-users');
          }
        },
        {
          label: '百度token',
          click: () => {
            const win = require('electron').BrowserWindow.getFocusedWindow();
            win.webContents.send('menu:baidu-token');
          }
        }
      ]
    }
  ];
  try {
    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);
  } catch {}
  try {
    mainWindow.setMenuBarVisibility(true);
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
  if (!baselineArea || !lastBaselineRect) return false; // 没基线，不过滤
  const area = incomingRect.width * incomingRect.height;
  // 基线面积骤减、小宽/小高、并且不是 nearFull
  const tooSmall =
    area < baselineArea * 0.45 ||
    incomingRect.width < 480 ||
    incomingRect.height < 320;
  if (!tooSmall) return false;
  // 如果刚结束截图的 3 秒过渡期，更严格忽略
  const now = Date.now();
  if (now < ignoreEphemeralUntil) return true;
  // 非过渡期，只要是骤减/小窗也忽略
  return true;
}
// 前台跟随层级
function startForegroundFollow() {
  if (fgFollowTimer) clearInterval(fgFollowTimer);
  fgFollowTimer = setInterval(() => {
    if (quitting) return;
    const wasActive = isWechatActive;
    isWechatActive = computeIsWechatActive();
    // 只有当微信在前台时才更新层级；不在前台时不动助手
    if (isWechatActive) {
      updateZOrder();
      // 如果刚从后台回到前台且已有目标，立即一次贴靠，避免等待动画慢慢到位
      if (!wasActive && shouldFollowNow() && lastWechatPxRect) {
        try {
          const dockX = computeDockX(lastWechatPxRect, assistWidth);
          const dip   = pxToDipRect(lastWechatPxRect);
          const h     = computeAssistantHeightFromWechatRect(lastWechatPxRect);
          target = { x: dockX, y: dip.y, w: assistWidth, h };
          applyTargetImmediate();
        } catch {}
      }
    }
  }, FG_CHECK_INTERVAL);
}
let lastChatType = null;

// ==== 修改 handleEvent：found / position / foreground / restored / destroyed 的处理 ====
// 修改：handleEvent 内的立即贴靠调用，加上 shouldFollowNow() 条件
function handleEvent(evt) {
  console.log('[evt]', evt.type, 'shot=', screenshotInProgress, 'phase=', screenshotPhase);
  if (quitting) return;
  const { type, x, y, width, height, hwnd } = evt;
  const incomingRect = { x, y, width, height };

  switch (type) {
    case 'found': {
      lastFoundAt = Date.now();
      if (screenshotInProgress || freezePosition) break;
      if (shouldIgnoreEphemeral(incomingRect)) break;
      wechatFound = true;
      wechatHWND = hwnd;
      lastWechatPxRect = incomingRect;
      acceptAsBaseline(incomingRect);
      const dockX = computeDockX(lastWechatPxRect, assistWidth);
      lastDockX = dockX;
      const dip = pxToDipRect(lastWechatPxRect);
      const h = computeAssistantHeightFromWechatRect(lastWechatPxRect);
      target = { x: dockX, y: dip.y, w: assistWidth, h };
      if (shouldFollowNow()) applyTargetImmediate(); // 只有前台时才应用
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
      if (freezePosition) { applyFrozen(); break; }
      if (screenshotPhase === 2 && isNearFull(incomingRect)) break;
      if (shouldIgnoreEphemeral(incomingRect)) break;

      lastWechatPxRect = incomingRect;
      acceptAsBaseline(incomingRect);
      const dockX = computeDockX(lastWechatPxRect, assistWidth);
      lastDockX = dockX;
      const dip = pxToDipRect(lastWechatPxRect);
      const h = computeAssistantHeightFromWechatRect(lastWechatPxRect);
      target = { x: dockX, y: dip.y, w: assistWidth, h };
      if (!firstDirectPosition && shouldFollowNow()) {
        applyTargetImmediate();
        firstDirectPosition = true;
      }
      if (!userHidden && isWechatActive) updateZOrder();
      break;
    }
    case 'foreground': {
      isWechatActive = true; // 前台
      if (screenshotInProgress) {
        screenshotInProgress = false;
        screenshotPhase = 2;
        freezePosition = false;
        screenshotEndedAt = Date.now();
        ignoreEphemeralUntil = screenshotEndedAt + 3000;
        if (lastBaselineRect) {
          lastWechatPxRect = { ...lastBaselineRect };
          if (shouldFollowNow()) applyFrozen();
          wechatFound = true;
        } else if (preShotWechatRect) {
          lastWechatPxRect = { ...preShotWechatRect };
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
      // 最小化时一定视为不在前台
      isWechatActive = false;
      if (screenshotInProgress || freezePosition) break;
      if (!userHidden) showMini();
      break;
    }
   // 修改 restored 分支：恢复后立即尝试贴靠（强制应用一次）
   case 'restored': {
     // 恢复不一定前台，先处理截图态
     if (screenshotInProgress) {
       screenshotInProgress = false;
       screenshotPhase = 2;
       freezePosition = false;
       screenshotEndedAt = Date.now();
       ignoreEphemeralUntil = screenshotEndedAt + 3000;
       if (lastBaselineRect) {
         lastWechatPxRect = { ...lastBaselineRect };
         if (shouldFollowNow()) applyFrozen();
         wechatFound = true;
       } else if (preShotWechatRect) {
         lastWechatPxRect = { ...preShotWechatRect };
         acceptAsBaseline(lastWechatPxRect);
         if (shouldFollowNow()) applyFrozen();
         wechatFound = true;
       }
     } else if (screenshotPhase === 2 && Date.now() > ignoreEphemeralUntil) {
       screenshotPhase = 0;
     }
   
     // 关键：恢复时立刻强制贴靠一次（不用等 position/前台轮询）
     dockToWechatNow(true);
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
        target = { x: dockX, y: dip.y, w: assistWidth, h };
        if (shouldFollowNow()) applyTargetImmediate();
        if (!userHidden && isWechatActive) updateZOrder(lastChatType);
        break;
      }
      // 真正丢失
      wechatFound = false;
      wechatHWND = null;
      firstDirectPosition = false;
      break;
    }
  }
}
function acceptAsBaseline(rect) {
  if (!rect) return;
  lastBaselineRect = { ...rect };
  baselineArea = rect.width * rect.height;
}
function startAnimationLoop() {
  if (animationTimer) clearInterval(animationTimer);
  animationTimer = setInterval(() => {
    if (quitting) return;
    if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible()) return;
    if (!shouldFollowNow()) return; // 后台或无主窗体时，让用户自由拖动

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
// ---- 生命周期 ----
app.whenReady().then(() => {
  createKeeperWindow();
  createMainWindow();
  createMiniWindow();

  // 启动后默认显示助手主窗体（不缩小）
  showMain();

  try {
    wechatMonitor.start({ keywords: ["微信", "企业微信", "Telegram", "WhatsApp"] }, handleEvent);
  } catch (e) {
    console.warn('[wechatMonitor] start failed:', e.message);
  }

  // 冷启动：尝试立即找主窗体并贴靠（找到就贴，找不到就保持主窗体前台显示）
  setTimeout(() => {
    if (computeIsWechatActive()) {
      if (dockToWechatNow(true) && wechatFound) {
        updateZOrder();
      }
    }
  }, 200);

  startAnimationLoop();
  startForegroundFollow();
});

// 崩溃与退出日志（帮助继续排查非预期退出）
process.on('uncaughtException', (e) => {
  console.error('[uncaughtException]', e && e.stack || e);
});
process.on('unhandledRejection', (r) => {
  console.error('[unhandledRejection]', r && r.stack || r);
});
app.on('before-quit', (e) => {
  if (!allowQuit) {
    e.preventDefault();
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
  } else showMini();
});
ipcMain.on('exit-app', () => {
  enableQuit();
  cleanupAndQuit();
});

// DevTools
ipcMain.on('devtools:toggle', () => toggleDevTools());

// 顶栏菜单
ipcMain.on('toolbar:click', async (_e, action) => {
  switch (action) {
    case 'new':
      mainWindow?.webContents.send('app:new-chat');
      break;
    case 'history':
      mainWindow?.webContents.send('app:show-history');
      break;
    case 'pin':
      pinnedAlwaysOnTop = !pinnedAlwaysOnTop;
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setAlwaysOnTop(pinnedAlwaysOnTop, 'screen-saver');
        mainWindow.webContents.send('toolbar:pin-state', pinnedAlwaysOnTop);
      }
      if (!pinnedAlwaysOnTop) updateZOrder();
      break;
      // ==== 修改截图开始逻辑（在 toolbar:click 的 'screenshot' 分支替换原来那几行）====
    case 'screenshot': {
      screenshotInProgress = true;
      screenshotPhase = 1;
      freezePosition = true;
      preShotWechatRect = lastWechatPxRect ? { ...lastWechatPxRect } : null;
      // 记录当前可信主窗口作为基线
      if (lastWechatPxRect && (!baselineArea || (lastWechatPxRect.width * lastWechatPxRect.height) >= baselineArea * 0.7)) {
        acceptAsBaseline(lastWechatPxRect);
        const dockX = computeDockX(lastWechatPxRect, assistWidth);
        lastDockX = dockX;
      }
      exec('explorer.exe ms-screenclip:', (err) => {
        if (err) exec('snippingtool /clip');
      });
      break;
    }

    case 'search':
      mainWindow?.webContents.send('app:search');
      break;
    case 'clear':
      mainWindow?.webContents.send('app:clear-chat');
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
      quitting = true;
      enableQuit(); // NEW
      cleanupAndQuit();
      break;
  }
});

// 右侧自定义宽度
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
});

// 话术粘贴
ipcMain.on('phrase:paste', async (_e, text) => {
  try {
    if (!text) return;
    clipboard.writeText(String(text));
    focusWeChatWindow();
    setTimeout(() => {
      try {
        sendKeys.sendCtrlV();
      } catch {}
      if (!pinnedAlwaysOnTop) updateZOrder();
    }, 120);
  } catch (err) {
    console.error('phrase paste failed:', err);
  }
});

// 话术粘贴并发送
ipcMain.on('phrase:paste-send', async (_e, text) => {
  try {
    if (!text) return;
    clipboard.writeText(String(text));
    focusWeChatWindow();
    setTimeout(() => {
      try {
        sendKeys.sendCtrlV();
      } catch {}
      setTimeout(() => {
        try {
          sendKeys.sendEnter();
        } catch {}
        if (!pinnedAlwaysOnTop) updateZOrder();
      }, 80);
    }, 120);
  } catch (err) {
    console.error('phrase paste-send failed:', err);
  }
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
      try {
        toFocus.bringToTop();
      } catch {}
      try {
        toFocus.focus();
      } catch {}
    }
  } catch {}
}

// 选择目录
ipcMain.handle('media:choose-dir', async (_e, payload) => {
  const title = (payload && payload.title) || '选择文件夹';
  const {
    canceled,
    filePaths
  } = await dialog.showOpenDialog({
    title,
    properties: ['openDirectory']
  });
  if (canceled || !filePaths || !filePaths[0]) return null;
  return filePaths[0];
});

// 粘贴图片
ipcMain.on('media:image-paste', async (_e, filePath) => {
  try {
    if (!filePath) return;
    const img = nativeImage.createFromPath(String(filePath));
    if (!img || (typeof img.isEmpty === 'function' && img.isEmpty())) return;
    clipboard.writeImage(img);
    focusWeChatWindow();
    setTimeout(() => {
      try {
        require('../utils/send-keys').sendCtrlV();
      } catch {}
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
          'window.__exportChatData ? window.__exportChatData() : null', true);
      } catch {}
    }
    if (!data) data =
      '# 导出内容\n\n当前页面未提供导出实现（__exportChatData）。\n请在渲染进程定义 window.__exportChatData() 返回 Markdown 文本。';
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
        const ok  = document.getElementById('btn-ok');
        ipcRenderer.invoke('settings:get').then(state => { chk.checked = !!state.pinned; });
        ok.onclick = () => { ipcRenderer.send('settings:set', { pinned: chk.checked }); window.close(); };
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
    if (res.response === 1) shell.openExternal('https://github.com/');
  });
}

function cleanupAndQuit() {
  if (quitting) return;
  quitting = true;
  if (animationTimer) {
    clearInterval(animationTimer);
    animationTimer = null;
  }
  if (fgFollowTimer) {
    clearInterval(fgFollowTimer);
    fgFollowTimer = null;
  }
  try {
    wechatMonitor.stop && wechatMonitor.stop();
  } catch {}
  try {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.destroy();
  } catch {}
  try {
    if (miniWindow && !miniWindow.isDestroyed()) miniWindow.destroy();
  } catch {}
  try {
    if (keeperWindow && !keeperWindow.isDestroyed()) keeperWindow.destroy();
  } catch {}
  realAppQuit(); // 用真实 quit（允许退出已在 enableQuit 中打开）
}

// 拦截 window-all-closed：不显式 quitting 不退出
app.on('window-all-closed', (e) => {
  console.log('[all-closed] quitting=', quitting, 'allowQuit=', allowQuit);
  if (!allowQuit) {
    e.preventDefault();
    // 重新创建哨兵，保持进程
    createKeeperWindow();
    return;
  }
  cleanupAndQuit();
});

// 兼容 path.join 误写
function pathJoin(...args) {
  try {
    return require('path').join(...args);
  } catch {
    return args.join('/');
  }
}