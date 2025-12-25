const {
  app
} = require('electron');
const ocr = require('./python-ocr');
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
const os = require('os');
const fs = require('fs');
const path = require('path');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const {
  exec,
  spawnSync
} = require('child_process'); // 新增 spawnSync，合并 exec
let qqFocusHelperPath = null;
// === 退出防护：仅显式允许退出（NEW） ===
const realAppQuit = app.quit.bind(app);
const realAppExit = (app.exit ? app.exit.bind(app) : (code) => {});
const realProcExit = process.exit.bind(process);
let allowQuit = false;

let gifStoreDir = path.join(app.getPath('userData'), 'gif-cache');
let lastProcName = '';  // 记录最近一次监控到的聊天进程名（小写）
function ensureGifStoreDir() {
  try {
    fs.mkdirSync(gifStoreDir, {
      recursive: true
    });
    // 简单写权限测试
    const testFile = path.join(gifStoreDir, '__test_' + Date.now() + '.tmp');
    fs.writeFileSync(testFile, 'ok');
    fs.unlinkSync(testFile);
    return gifStoreDir;
  } catch (e) {
    console.warn('[gif-cache] primary dir fail -> fallback tmp:', e.message);
    gifStoreDir = path.join(os.tmpdir(), 'chat-assistant-gif-cache');
    try {
      fs.mkdirSync(gifStoreDir, {
        recursive: true
      });
    } catch {}
    return gifStoreDir;
  }
}
let fileDropHelperPath = null;

function locateFileDropHelper() {
  try {
    if (app.isPackaged) {
      // extraResources -> resources 根
      const p1 = path.join(process.resourcesPath, 'set-clipboard-files.exe');
      if (fs.existsSync(p1)) return p1;
      // 兼容 asarUnpack 路径
      const p2 = path.join(process.resourcesPath, 'app.asar.unpacked', 'main', 'set-clipboard-files.exe');
      if (fs.existsSync(p2)) return p2;
      // 兼容被放到 extra 子目录的情况
      const p3 = path.join(process.resourcesPath, 'extra', 'set-clipboard-files.exe');
      if (fs.existsSync(p3)) return p3;
      return null;
    } else {
      // 开发模式：直接 main 目录
      const local = path.join(__dirname, 'set-clipboard-files.exe');
      if (fs.existsSync(local)) return local;
      return null;
    }
  } catch (e) {
    console.warn('[filedrop] locate helper fail:', e.message);
    return null;
  }
}

function focusQQMainWindow() {
  try {
    if (!windowManager || !windowManager.getWindows) return false;
    const wins = windowManager.getWindows();
    if (!Array.isArray(wins) || !wins.length) return false;
    // 选同显示器、面积最大的 QQ 候选
    const qqTitleRe = /(^|\s)QQ(\s|$)|QQNT|TIM|腾讯QQ/i;
    let best = null,
      bestArea = -1;
    for (const w of wins) {
      const t = String(w.getTitle?.() || '');
      const p = String(w.process?.name || '').replace(/\.exe$/i, '');
      if (!(qqTitleRe.test(t) || /^(QQ|QQNT|TIM|QQEX)$/i.test(p))) continue;
      const b = w.getBounds?.();
      if (!b || !isFinite(b.width) || !isFinite(b.height)) continue;
      if (b.width < 460 || b.height < 320) continue;
      const area = Math.round(b.width) * Math.round(b.height);
      if (area > bestArea) {
        bestArea = area;
        best = w;
      }
    }
    if (best) {
      try {
        best.bringToTop();
      } catch {}
      try {
        best.focus();
      } catch {}
      return true;
    }
  } catch {}
  return false;
}

function ensureFileDropHelperReady() {
  fileDropHelperPath = locateFileDropHelper();
  if (app.isPackaged) {
    if (fileDropHelperPath) {
      return true;
    }
    return false;
  }
  // 开发模式：如已有 exe 直接用
  if (fileDropHelperPath) {
    return true;
  }
  // 尝试编译（仅开发）
  const src = path.join(__dirname, 'set-clipboard-files.cs');
  if (!fs.existsSync(src)) {
    return false;
  }
  const csc = findCscForFileDrop();
  if (!csc) {
    console.warn('[filedrop] csc not found (dev compile skipped)');
    return false;
  }
  const out = path.join(__dirname, 'set-clipboard-files.exe');
  const r = spawnSync(csc, ['/nologo', '/optimize+', '/platform:x64', '/out:' + out, src], {
    windowsHide: true,
    encoding: 'utf8'
  });
  if (r.status === 0 && fs.existsSync(out)) {
    fileDropHelperPath = out;
    return true;
  }
  return false;
}

function setClipboardFiles(paths) {
  if (!Array.isArray(paths) || !paths.length) return false;
  if (!ensureFileDropHelperReady()) return false;
  try {
    const res = spawnSync(fileDropHelperPath, paths, {
      windowsHide: true,
      encoding: 'utf8'
    });
    if (res.status !== 0) {
      return false;
    }
    return true;
  } catch (e) {
    console.warn('[filedrop] exec error:', e.message);
    return false;
  }
}
// 启动后预热
app.whenReady().then(() => {
  ensureGifStoreDir();
  try {
    ensureFileDropHelperReady();
  } catch {}
});

function safeRandomGifName() {
  return 'gif_' + Date.now() + '_' + Math.random().toString(16).slice(2) + '.gif';
}

function sanitizeFilename(name) {
  let n = (name || '').replace(/[\r\n\t]/g, '');
  if (!n.endsWith('.gif')) n += '.gif';
  n = n.replace(/[^A-Za-z0-9._-]/g, '_');
  if (n.length > 80) n = n.slice(0, 80);
  return n;
}

function findCscForFileDrop() {
  const candidates = [
    'csc',
    'C:\\Program Files (x86)\\Microsoft Visual Studio\\2022\\BuildTools\\MSBuild\\Current\\Bin\\Roslyn\\csc.exe',
    'C:\\Program Files\\Microsoft Visual Studio\\2022\\Community\\MSBuild\\Current\\Bin\\Roslyn\\csc.exe',
    'C:\\Program Files (x86)\\Microsoft Visual Studio\\2019\\BuildTools\\MSBuild\\Current\\Bin\\Roslyn\\csc.exe'
  ];
  for (const p of candidates) {
    try {
      if (p === 'csc') {
        const trial = spawnSync('csc', ['/nologo'], {
          windowsHide: true
        });
        if (trial.status === 0 || trial.stderr) return 'csc';
      } else if (fs.existsSync(p)) return p;
    } catch {}
  }
  return null;
}

function enableQuit() {
  allowQuit = true;
}
app.quit = () => {
  if (allowQuit) return realAppQuit();
  try {} catch {}
};
app.exit = (code) => {
  if (allowQuit) return realAppExit(code);
  try {} catch {}
};
process.exit = (code) => {
  if (allowQuit) return realProcExit(code);
  try {} catch {}
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


// node-window-manager
let windowManager = null;
try {
  ({
    windowManager
  } = require('node-window-manager'));
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
let keeperWindow = null; // 哨兵窗口

let animationTimer = null;
const LERP_SPEED = 0.22;
const ANIMATION_INTERVAL = 16;

const ASSISTANT_MIN_W = 260;
const ASSISTANT_MAX_W = 1400;
let assistWidth = 350;
const MIN_HEIGHT = 200;
const DOCK_GAP_FIX_DIPS = 2;
const EXTRA_NUDGE_PHYSICAL_PX = 6;
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

let fgFollowTimer = null;
const FG_CHECK_INTERVAL = 250;
let lastStableAssistantHeight = 600;
let dockSide = null;
const MAX_ASSISTANT_HEIGHT_MARGIN = 40;
let screenshotInProgress = false;
let preShotWechatRect = null;
let lastFoundAt = 0;
const TRANSIENT_DESTROY_MS = 3000;

let freezePosition = false;
let screenshotPhase = 0;
let lastValidWechatRect = null;
let lastDockX = null;
let lastBaselineRect = null;
let baselineArea = null;
let screenshotEndedAt = 0;
let ignoreEphemeralUntil = 0;





function computeIsWechatActive() {
  try {
    if (!windowManager || !windowManager.getActiveWindow) {
      return false;
    }
    const active = windowManager.getActiveWindow();
    if (!active) {
      return false;
    }

    const title = String(active.getTitle?.() || '');
    const procRaw = String(active.process?.name || '');
    const procName = procRaw.replace(/\.exe$/i, '');
    const procPath = String(active.process?.path || '');

    // 用统一的 classifyWindowType 判断类型
    const type = classifyWindowType(active, 'computeIsWechatActive:active'); // qq/wechat/enterprise/null

    // “是否视为聊天前台”的结果
    let result = false;

    // 企微：走原来的 ENTERPRISE_PROC_SET 判定
    const ENTERPRISE_PROC_SET = new Set(['WXWork', 'WeCom', 'WeChatAppEx', 'WXWorkWeb', 'WeMail', 'WXDrive']);
    if (/企业微信|wxwork|wecom/i.test(title)) result = true;
    if (ENTERPRISE_PROC_SET.has(procName)) result = true;
    if (/WXWork|WeCom/i.test(procPath)) result = true;

    // 绑定 wechatHWND 的窗口
    if (wechatHWND && Number(active.handle) === Number(wechatHWND)) {
      result = true;
    }

    // 普通微信
    if (/微信|wechat|weixin/i.test(title)) result = true;
    if (/wechat|weixin/i.test(procName)) result = true;

    // QQ：是否也算“激活聊天窗”，你可以按需求改
    const isQQ =
      /(^|\s)qq(\s|$)|qqnt|qqex|tim|腾讯qq/i.test(title) ||
      /^(QQ|QQNT|QQEX|TIM)$/i.test(procName) ||
      /(\\|\/)(Tencent|QQ|QQNT|TIM)(\\|\/)/i.test(procPath);
    if (isQQ) {
      // 这里如果你希望 QQ 也驱动贴靠，就保留；否则可以注释掉
      result = true;
    }


    return result;
  } catch (e) {
    return false;
  }
}

function shouldFollowNow() {
  return wechatFound && isWechatActive && !userHidden && !pinnedAlwaysOnTop;
}


function applyFrozen() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (lastDockX == null || !lastValidWechatRect) return;
  if (!shouldFollowNow()) return;
  const dip = pxToDipRect(lastValidWechatRect);
  const h = computeAssistantHeightFromWechatRect(lastValidWechatRect);
  target.x = lastDockX;
  target.y = dip.y;
  target.h = h;
  applyTargetImmediate();
}

function getWechatWindowViaWM() {
  try {
    if (!windowManager || !windowManager.getWindows) return null;
    const wins = windowManager.getWindows();
    if (!Array.isArray(wins) || !wins.length) return null;
    const enterpriseRe = /企业微信|wxwork|wecom|WeChatAppEx|WXWorkWeb|WeMail|WXDrive/i;
    const genericRe = /微信|wechat|weixin/i;
    const qqRe = /(^|\s)QQ(\s|$)|QQNT/i; // 标题含 QQ/QQNT

    const pick = (re, procList) => wins.find(w => {
      const t = String(w.getTitle?.() || '');
      const p = String(w.process?.name || '').replace(/\.exe$/i, '');
      return re.test(t) || (procList && procList.includes(p));
    });

    // 先企业微信，再微信，最后 QQ
    let w = pick(enterpriseRe, ['WXWork', 'WeCom', 'WeChatAppEx', 'WXWorkWeb', 'WeMail', 'WXDrive']) ||
      pick(genericRe, ['WeChat', 'Weixin', 'WeChatAppEx']) ||
      pick(qqRe, ['QQ', 'QQNT']); // 进程名为 QQ/QQNT

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
  const display = findDisplayForPhysicalRect(pxRect);
  const s = display.scaleFactor || 1;
  const wa = display.workArea;
  const wechatLeftDip = Math.floor(pxRect.x / s);
  const wechatRightDip = Math.floor((pxRect.x + pxRect.width) / s);
  const extraDip = Math.max(1, Math.round(EXTRA_NUDGE_PHYSICAL_PX / s));
  const gapDip = DOCK_GAP_FIX_DIPS + extraDip;
  if (!dockSide) {
    dockSide = (wechatRightDip + width <= wa.x + wa.width) ? 'right' : 'left';
  }
  let nextX;
  if (dockSide === 'right') {
    if (wechatRightDip + width <= wa.x + wa.width) {
      nextX = wechatRightDip - gapDip;
    } else {
      dockSide = 'left';
      nextX = wechatLeftDip - width + gapDip;
    }
  } else {
    if (wechatLeftDip - width >= wa.x) {
      nextX = wechatLeftDip - width + gapDip;
    } else {
      dockSide = 'right';
      nextX = wechatRightDip - gapDip;
    }
  }
  if (nextX < wa.x) nextX = wa.x;
  const maxX = wa.x + wa.width - width;
  if (nextX > maxX) nextX = maxX;
  
   // ★ 统一向左再挪 7 像素，让贴靠更紧（所有微信跟随都会受这个偏移）
    if(isCurrentChatWeChat()){
      nextX -= 7;
    }

  
  return nextX;
}

function computeAssistantHeightFromWechatRect(pxRect) {
  if (!pxRect || !pxRect.width || !pxRect.height) return lastStableAssistantHeight;
  const dip = pxToDipRect(pxRect);
  const rawHeight = dip.height;
  const maxAllowed = Math.max(MIN_HEIGHT, (dip.display.workArea?.height || rawHeight) - MAX_ASSISTANT_HEIGHT_MARGIN);
  if (rawHeight > maxAllowed * 1.25) return lastStableAssistantHeight;
  const h = clamp(rawHeight, MIN_HEIGHT, maxAllowed);
  lastStableAssistantHeight = h;
  return h;
}

function reDockFromLastRect() {
  if (!lastWechatPxRect) return false;
  const r = lastWechatPxRect;
  if (!r.width || !r.height) return false;
  const dockX = computeDockX(r, assistWidth);
  const dip = pxToDipRect(r);
  const h = computeAssistantHeightFromWechatRect(r);
  target = {
    x: dockX,
    y: dip.y,
    w: assistWidth,
    h
  };
  if (shouldFollowNow()) applyTargetImmediate();
  return true;
}



// >>> ADDED or CHANGED: 定位迷你窗到对应显示器右上角
function positionMiniWindow() {
  if (!miniWindow || miniWindow.isDestroyed()) return;
  try {
    let display = null;
    if (lastWechatPxRect) display = findDisplayForPhysicalRect(lastWechatPxRect);
    if (!display) display = screen.getPrimaryDisplay();
    const wa = display.workArea;
    const W = 160,
      H = 40;
    const targetX = Math.round(wa.x + wa.width - 20 - W);
    const targetY = Math.round(wa.y + 20);
    miniWindow.setBounds({
      x: targetX,
      y: targetY,
      width: W,
      height: H
    });
  } catch (e) {
    console.warn('[mini position] fail:', e.message);
  }
}

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

ipcMain.on('close-main-window', () => {
  userHidden = true;
  showMini();
});

// >>> CHANGED: 使用统一恢复逻辑
ipcMain.on('restore-main-window', () => {
  showMain();
  // 临时置顶与聚焦（保持原行为）
  if (mainWindow && !mainWindow.isDestroyed()) {
    const wasPinned = pinnedAlwaysOnTop;
    try {
      mainWindow.setAlwaysOnTop(true, 'screen-saver');
      mainWindow.show();
      mainWindow.focus();
    } catch {}
    if (!wasPinned) {
      setTimeout(() => {
        try {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.setAlwaysOnTop(false);
          }
        } catch {}
      }, 80);
    }
  }
  restoreDockIfNeeded('ipc');
});

ipcMain.on('exit-app', () => {
  enableQuit();
  cleanupAndQuit();
});

ipcMain.on('devtools:toggle', () => toggleDevTools());

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
    case 'screenshot': {
      screenshotInProgress = true;
      screenshotPhase = 1;
      freezePosition = true;
      preShotWechatRect = lastWechatPxRect ? {
        ...lastWechatPxRect
      } : null;
      if (lastWechatPxRect && (!baselineArea || (lastWechatPxRect.width * lastWechatPxRect.height) >=
          baselineArea * 0.7)) {
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
      try {
        isWechatActive = computeIsWechatActive();
      } catch {}
      userHidden = true;
      showMini();
      break;
    case 'exit':
      quitting = true;
      enableQuit();
      cleanupAndQuit();
      break;
  }
});

ipcMain.handle('window:get-bounds', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return null;
  return mainWindow.getBounds();
});
ipcMain.on('window:resize-width', (_e, newWidth) => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const clamped = clamp(Math.round(newWidth || 0), ASSISTANT_MIN_W, ASSISTANT_MAX_W);
  if (clamped === assistWidth) return;

  assistWidth = clamped;
  // 不再在拖动时自动改 target / x，只改当前窗口宽度
  try {
    const b = mainWindow.getBounds();
    mainWindow.setBounds({
      x: b.x,
      y: b.y,
      width: clamped,
      height: b.height
    });
    // 同步一下 target/current 的 w，保持动画后续正常
    target.w = clamped;
    current.w = clamped;
  } catch {}
});


function frontIsQQ() {
  try {
    const w = windowManager?.getActiveWindow?.();
    if (!w) return false;
    const title = String(w.getTitle?.() || '');
    const proc = String(w.process?.name || '').replace(/\.exe$/i, '');
    const path = String(w.process?.path || '');
    return /(^|\s)QQ(\s|$)|QQNT|QQEX|TIM|腾讯QQ/i.test(title) ||
      /^(QQ|QQNT|QQEX|TIM)$/i.test(proc) ||
      /(\\|\/)(Tencent|QQ|QQNT|TIM)(\\|\/)/i.test(path);
  } catch {
    return false;
  }
}



function hasQQWindowOpen() {
  try {
    const wins = windowManager?.getWindows?.() || [];
    return wins.some(w => {
      const t = String(w.getTitle?.() || '');
      const p = String(w.process?.name || '').replace(/\.exe$/i, '');
      return /(^|\s)QQ(\s|$)|QQNT|QQEX|TIM|腾讯QQ/i.test(t) || /^(QQ|QQNT|QQEX|TIM)$/i.test(p);
    });
  } catch {
    return false;
  }
}

function hasWeChatWindowOpen() {
  try {
    const wins = windowManager?.getWindows?.() || [];
    return wins.some(w => {
      const t = String(w.getTitle?.() || '');
      const p = String(w.process?.name || '').replace(/\.exe$/i, '');
      return /企业微信|wxwork|wecom/i.test(t) ||
        /^(WXWork|WeCom|WeChatAppEx|WXWorkWeb|WeMail|WXDrive)$/i.test(p) ||
        /微信|wechat|weixin/i.test(t) ||
        /^(WeChat|Weixin|WeChatAppEx)$/i.test(p);
    });
  } catch {
    return false;
  }
}
// 新增：判断窗口是否为助手（排除助手）
function isAssistantWindow(win) {
  try {
    if (!mainWindow || mainWindow.isDestroyed()) return false;
    const ab = win?.getBounds?.();
    const aw = mainWindow.getBounds();
    if (!ab || !aw) return false;
    const sameSize = Math.abs(ab.width - aw.width) <= 4 && Math.abs(ab.height - aw.height) <= 4;
    const t = String(win.getTitle?.() || '');
    return sameSize && !/(qq|wechat|wecom|wxwork)/i.test(t);
  } catch {
    return false;
  }
}

// 新增：窗口类型识别
// 是否打印 classifyWindowType 的详细日志
const LOG_CLASSIFY = true;

// 新增：窗口类型识别（qq / wechat / enterprise / null），带可控日志
function classifyWindowType(win, tag = '') {
  try {
    if (!win) {
      return null;
    }
    const title = String(win.getTitle?.() || '');
    const procRaw = String(win.process?.name || '');
    const proc = procRaw.replace(/\.exe$/i, '');
    const path = String(win.process?.path || '');
    let type = null;

    if (/(^|\s)QQ(\s|$)|QQNT|QQEX|TIM|腾讯QQ/i.test(title) ||
      /^(QQ|QQNT|QQEX|TIM)$/i.test(proc) ||
      /(\\|\/)(Tencent|QQ|QQNT|TIM)(\\|\/)/i.test(path)) {
      type = 'qq';
    } else if (/企业微信|wxwork|wecom/i.test(title) ||
      /^(WXWork|WeCom|WeChatAppEx|WXWorkWeb|WeMail|WXDrive)$/i.test(proc) ||
      /wxwork|wecom/i.test(path)) {
      type = 'enterprise';
    } else if (/微信|wechat|weixin/i.test(title) ||
      /^(WeChat|Weixin|WeChatAppEx)$/i.test(proc)) {
      type = 'wechat';
    } else {
      type = null;
    }


    return type;
  } catch (e) {
    console.warn('[classify] error:', e.message);
    return null;
  }
}

// 新增：矩形近似
function rectClose(a, b, tol = 24) {
  try {
    if (!a || !b) return false;
    return Math.abs(a.x - b.x) <= tol &&
      Math.abs(a.y - b.y) <= tol &&
      Math.abs(a.width - b.width) <= tol &&
      Math.abs(a.height - b.height) <= tol;
  } catch {
    return false;
  }
}

// 新增：聚焦（支持 win 或 handle）
function focusWindow(targetWinOrHandle) {
  try {
    if (!windowManager || !windowManager.getWindows) return false;
    let win = null;
    if (typeof targetWinOrHandle === 'object' && targetWinOrHandle) {
      win = targetWinOrHandle;
    } else {
      const handle = Number(targetWinOrHandle);
      if (!handle) return false;
      const wins = windowManager.getWindows() || [];
      win = wins.find(w => Number(w.handle) === handle) || null;
    }
    if (!win) return false;
    try {
      win.bringToTop && win.bringToTop();
    } catch {}
    try {
      win.focus && win.focus();
    } catch {}
    return true;
  } catch {
    return false;
  }
}

// 替换：解析吸附目标，直接返回 win
// 1) 过滤小矩形并稳定解析目标
function isChatMainBounds(bb) {
  try {
    if (!bb || !isFinite(bb.x) || !isFinite(bb.y) || !isFinite(bb.width) || !isFinite(bb.height)) return false;
    // ★ 不再用 width/height 过滤，单纯认为：任何有正常矩形的 qq/微信/企微主进程窗口都是候选
    return true;
  } catch {
    return false;
  }
}

function resolveDockedChatTarget() {
  try {
    if (!windowManager || !windowManager.getActiveWindow) {
      console.warn('[dockTarget] skip: windowManager unavailable');
      return null;
    }

    // 1. 前台优先：当前前台是聊天窗就直接用它
    const active = windowManager.getActiveWindow();
    if (active) {
      const type = classifyWindowType(active);
      const bb = active.getBounds?.();
      if ((type === 'qq' || type === 'wechat' || type === 'enterprise') && isChatMainBounds(bb)) {
        const rect = {
          x: Math.round(bb.x),
          y: Math.round(bb.y),
          width: Math.round(bb.width),
          height: Math.round(bb.height)
        };
        const hwnd = Number(active.handle) || NaN;
        lastWechatPxRect = rect;
        acceptAsBaseline(rect);
        console.log('[dockTarget] use active chat ->', {
          type,
          hwnd,
          rect
        });
        return {
          type,
          hwnd,
          rect,
          win: active
        };
      }
    }

    // 2. 兜底：在所有窗口中找任一聊天窗（不按优先级，只要识别到就是）
    const wins = windowManager.getWindows?.() || [];
    for (const w of wins) {
      const t = classifyWindowType(w);
      if (t !== 'qq' && t !== 'wechat' && t !== 'enterprise') continue;
      const bb = w.getBounds?.();
      if (!isChatMainBounds(bb)) continue;

      const rect = {
        x: Math.round(bb.x),
        y: Math.round(bb.y),
        width: Math.round(bb.width),
        height: Math.round(bb.height)
      };
      const hwnd = Number(w.handle) || NaN;

      console.log('[dockTarget] fallback ->', {
        type: t,
        hwnd,
        rect
      });
      return {
        type: t,
        hwnd,
        rect,
        win: w
      };
    }

    console.warn('[dockTarget] no chat window found');
    return null;
  } catch (e) {
    console.warn('[dockTarget] error:', e && e.message);
    return null;
  }
}
// 新增：将吸附目标置前（多策略），并返回是否成功
function bringDockedTargetToFront(target) {
  try {
    if (!target) return false;

    let ok = false;

    // 优先使用窗口对象
    if (target.win) {
      try {
        target.win.bringToTop && target.win.bringToTop();
      } catch {}
      try {
        target.win.focus && target.win.focus();
        ok = true;
      } catch {}
    }

    // 句柄兜底
    if (!ok && isFinite(target.hwnd)) {
      ok = focusWindow(target.hwnd);
    }

    // 类型兜底
    if (!ok) {
      if (target.type === 'enterprise' || target.type === 'wechat') {
        try {
          focusWeChatWindow();
          ok = true;
        } catch {}
      } else if (target.type === 'qq') {
        try {
          ok = focusQQMainWindow();
        } catch {}
      }
    }

    // 关键：只让助手失焦，不隐藏，不改置顶，避免闪烁
    try {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.blur();
    } catch {}

    return !!ok;
  } catch (e) {
    console.warn('[bringDockedTargetToFront] error:', e && e.message);
    return false;
  }
}
// 将 QQ 放前台并确保输入框焦点（仅在 qq-focus-paste.exe 失败时使用）
async function bringQQFrontAndFocusInput() {
  // 把 QQ 主窗置前
  let okFront = false;
  try {
    okFront = frontIsQQ();
  } catch {}
  if (!okFront) {
    try {
      okFront = focusQQMainWindow();
    } catch {}
    await sleep(140);
  }
  // 焦点序列：Tab x3 + Shift+Tab 兜底
  try {
    sendKeys.sendTab && sendKeys.sendTab();
  } catch {}
  await sleep(90);
  try {
    sendKeys.sendTab && sendKeys.sendTab();
  } catch {}
  await sleep(90);
  try {
    sendKeys.sendTab && sendKeys.sendTab();
  } catch {}
  await sleep(120);
  // 部分主题需要多一次
  try {
    sendKeys.sendTab && sendKeys.sendTab();
  } catch {}
  await sleep(100);
  // 兜底回退一格
  try {
    sendKeys.sendShiftTab && sendKeys.sendShiftTab();
  } catch {}
  await sleep(100);
}
// 小兜底：把目标窗体放前台（你已有 bringDockedTargetToFront，可直接用）
// 这里在调用前轻微失焦助手，避免两者一起下沉
// 修正：前台确认，优先使用 target.win；避免 hwnd 为 NaN 时失败
async function ensureTargetForeground(target) {
  // 不主动 blur，先把目标置前
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  let ok = false;
  try {
    if (target?.win) {
      try {
        target.win.bringToTop && target.win.bringToTop();
      } catch {}
      try {
        target.win.focus && target.win.focus();
        ok = true;
      } catch {}
    }
    if (!ok && isFinite(target?.hwnd)) {
      ok = focusWindow(target.hwnd);
    }
    if (!ok) {
      // 类型兜底
      if (target?.type === 'qq') ok = !!focusQQMainWindow();
      else if (target?.type === 'wechat' || target?.type === 'enterprise') {
        try {
          focusWeChatWindow();
          ok = true;
        } catch {}
      }
    }
  } catch {}
  await sleep(140);
  return !!ok;
}
// 新增：轻量前台确认（用于qq超时后判断是否已置前成功）
function isForegroundType(type) {
  try {
    if (!windowManager || !windowManager.getActiveWindow) return false;
    const w = windowManager.getActiveWindow();
    const t = classifyWindowType(w);
    return t === type;
  } catch {
    return false;
  }
}
// 单击插入（只粘贴）
// 单击：只粘贴
// 单击：只粘贴（统一兼容 QQ / 微信 / 企业微信）
// 单击：只粘贴（严格避免 QQ 重复）
// 3) 单击/双击插入：稳定前台、避免 QQ 回退重复
// 单击插入：始终以当前前台聊天窗为准
ipcMain.on('phrase:paste', async (_e, text) => {
  if (!text) return;
  if (!canStartInsert()) return;

  try {
    clipboard.writeText(String(text));

    // 前台优先，其次兜底历史吸附
    let target = getForegroundChatTarget() || resolveDockedChatTarget?.();
    if (!target || !target.type) return;

    if (target.type === 'qq') {
      // 1) 把 QQ 放前台（简单版）
      await ensureQQForegroundSimple();

      // 2) 尝试使用 qq-focus-paste.exe 加速（可选）
      let okExe = false;
      try {
        okExe = await runQqFocusPaste('paste');
      } catch {}

      // 3) 无论 exe 成功与否，都在短延时后兜底一次 Ctrl+V
      await sleep(80);
      try {
        sendKeys.sendCtrlV();
      } catch {}

    } else {
      // 微信 / 企业微信：只要当前目标窗体前台，直接 Ctrl+V
      await ensureTargetForeground(target);
      try {
        sendKeys.sendCtrlV();
      } catch {}
    }

    setTimeout(() => {
      if (!pinnedAlwaysOnTop) updateZOrder(target.type);
    }, 140);
  } catch (err) {
    console.error('phrase paste failed:', err);
  } finally {
    endInsert();
  }
});
ipcMain.on('phrase:paste-send', async (_e, text) => {
  if (!text) return;
  if (!canStartInsert()) return;

  try {
    clipboard.writeText(String(text));

    let target = getForegroundChatTarget() || resolveDockedChatTarget?.();
    if (!target || !target.type) return;

    if (target.type === 'qq') {
      // 1) 把 QQ 放前台（简单版）
      await ensureQQForegroundSimple();

      // 2) 尝试使用 qq-focus-paste.exe
      let okExe = false;
      try {
        okExe = await runQqFocusPaste('paste-send');
      } catch {}

      // 3) 兜底逻辑：Ctrl+V + Enter
      //    即使 exe 已经发过一次，也不太会有大问题，最多重复一次发送
      await sleep(80);
      try {
        sendKeys.sendCtrlV();
      } catch {}

      await sleep(110);
      try {
        sendKeys.sendEnter();
      } catch {}

    } else {
      // 微信 / 企业微信
      await ensureTargetForeground(target);
      try {
        sendKeys.sendCtrlV();
      } catch {}
      await sleep(100);
      try {
        sendKeys.sendEnter();
      } catch {}
    }

    setTimeout(() => {
      if (!pinnedAlwaysOnTop) updateZOrder(target.type);
    }, 160);
  } catch (err) {
    console.error('phrase paste-send failed:', err);
  } finally {
    endInsert();
  }
});
// 2) 插入互斥与节流，避免重复触发
let insertBusy = false;
let lastInsertAt = 0;
const INSERT_DEBOUNCE_MS = 220;

function canStartInsert() {
  const now = Date.now();
  if (insertBusy) return false;
  if (now - lastInsertAt < INSERT_DEBOUNCE_MS) return false;
  lastInsertAt = now;
  insertBusy = true;
  return true;
}
async function ensureQQForegroundSimple() {
  try {
    // 如果当前已经是 QQ，就不用再切一次
    if (isActiveQQ && isActiveQQ()) {
      await sleep(80);
      return true;
    }
  } catch {}
  // 否则尝试聚焦 QQ 主窗
  let ok = false;
  try {
    ok = focusQQMainWindow();
  } catch {}
  await sleep(140);
  return ok;
}

function endInsert() {
  insertBusy = false;
}












// 新增：获取当前前台的聊天窗口（QQ/微信/企业微信），只看最上层
// 获取当前前台的聊天窗口（QQ/微信/企业微信），只看最上层，不再用尺寸判断
function getForegroundChatTarget() {
  try {
    if (!windowManager || !windowManager.getActiveWindow) return null;
    const active = windowManager.getActiveWindow();
    if (!active) return null;

    const type = classifyWindowType(active);
    if (type !== 'qq' && type !== 'wechat' && type !== 'enterprise') return null;

    const bb = active.getBounds?.();
    const hasRect =
      bb &&
      isFinite(bb.x) && isFinite(bb.y) &&
      isFinite(bb.width) && isFinite(bb.height);

    if (!hasRect) return null;

    const rect = {
      x: Math.round(bb.x),
      y: Math.round(bb.y),
      width: Math.round(bb.width),
      height: Math.round(bb.height)
    };
    const hwnd = Number(active.handle) || NaN;

    // 记录最新基准，用于后续吸附和兜底
    try {
      lastWechatPxRect = rect;
      acceptAsBaseline(rect);
    } catch {}

    return {
      type,
      hwnd,
      rect,
      win: active
    };
  } catch {
    return null;
  }
}
let lastFgLogAt = 0; // 放在 fgFollowTimer 旁边即可
const FG_CHATTYPE_LOG_INTERVAL = 10000; // 10 秒
function startForegroundFollow() {
  if (fgFollowTimer) clearInterval(fgFollowTimer);
  fgFollowTimer = setInterval(() => {
    if (quitting) return;

    const wasActive = isWechatActive;
    isWechatActive = computeIsWechatActive();

    if (wasActive !== isWechatActive) {
      console.log('[fgFollow] isWechatActive ->', isWechatActive);
    }

    // 每 10 秒最多打一次“当前前台类型”的日志
    try {
      const now = Date.now();
      if (now - lastFgLogAt >= FG_CHATTYPE_LOG_INTERVAL) {
        lastFgLogAt = now;
        if (windowManager && windowManager.getActiveWindow) {
          const active = windowManager.getActiveWindow();
          const t = classifyWindowType(active, 'fgFollow:active');
          if (t) {
            console.log('[fgFollow] active chatType =', t);
          } else {
            console.log('[fgFollow] active chatType =', t, '(non-chat)');
          }
        }
      }
    } catch (e) {
      console.warn('[fgFollow] active inspect error:', e.message);
    }

    if (isWechatActive) {
      // 只维护层级，不再在这里改位置/高度
      updateZOrder();
    }
  }, FG_CHECK_INTERVAL);
}

function isCurrentChatWeChat() {
  const p = (lastProcName || '').toLowerCase();
  // wechat.exe / wechatapp.exe / wechatappex.exe / weixin.exe
  return p === 'wechat.exe' ||
         p === 'wechatapp.exe' ||
         p === 'wechatappex.exe' ||
         p === 'weixin.exe';
}

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
        console.log('[dock] getWechatWindowViaWM used', {
          rect,
          hwnd: info.hwnd
        });
      }
    }
    if (!rect || !rect.width || !rect.height) {
      console.log('[dock] skip: no valid rect');
      return false;
    }

    // 新增：调用前打印一下当前 rect
    console.log('[dock] using lastWechatPxRect', {
      rect,
      hwnd: wechatHWND
    });

    const dockX = computeDockX(rect, assistWidth);
    lastDockX = dockX;
    const dip = pxToDipRect(rect);
    const h = computeAssistantHeightFromWechatRect(rect);
    target = {
      x: dockX,
      y: dip.y,
      w: assistWidth,
      h
    };
    if (force || shouldFollowNow()) applyTargetImmediate();
    return true;
  } catch (e) {
    console.warn('[dock] error', e && e.message);
    return false;
  }
}

function getCurrentChatTarget() {
  try {
    return getForegroundChatTarget() || resolveDockedChatTarget?.() || null;
  } catch {
    return null;
  }
}

function isActiveQQ() {
  try {
    if (!windowManager || !windowManager.getActiveWindow) {
      console.log('[isActiveQQ] windowManager missing');
      return false;
    }
    const active = windowManager.getActiveWindow();
    if (!active) {
      console.log('[isActiveQQ] no active');
      return false;
    }

    const titleRaw = active.getTitle?.();
    const procRaw = active.process?.name || '';
    const pathRaw = active.process?.path || '';
    const b = active.getBounds?.();
    const rectOk = b && isFinite(b.x) && isFinite(b.y) && isFinite(b.width) && isFinite(b.height);
    const rect = rectOk ? {
      x: Math.round(b.x),
      y: Math.round(b.y),
      width: Math.round(b.width),
      height: Math.round(b.height)
    } : null;

    const title = String(titleRaw || '').trim();
    const procName = String(procRaw || '').replace(/\.exe$/i, '');
    const procPath = String(pathRaw || '');

    const qqTitleRe = /(^|\s)qq(\s|$)|qqnt|qqex|tim|腾讯qq/i;
    const qqProcRe = /^(QQ|QQNT|QQEX|TIM)$/i;
    const qqPathRe = /(\\|\/)(Tencent|QQ|QQNT|TIM)(\\|\/)/i;

    // 仅以活动窗口判断当前是否 QQ
    const ok = qqTitleRe.test(title) || qqProcRe.test(procName) || qqPathRe.test(procPath);

    console.log('[isActiveQQ:active]', {
      title,
      procName,
      procPath,
      rect,
      ok
    });

    // 只打印候选用于调试，不改变 ok
    if (!ok && windowManager.getWindows) {
      const wins = windowManager.getWindows() || [];
      const candidates = wins
        .map(w => {
          const bt = w.getBounds?.();
          return {
            title: String(w.getTitle?.() || '').trim(),
            proc: String(w.process?.name || ''),
            path: String(w.process?.path || ''),
            bounds: bt ? {
              x: Math.round(bt.x),
              y: Math.round(bt.y),
              width: Math.round(bt.width),
              height: Math.round(bt.height)
            } : null
          };
        })
        .filter(info => {
          const t = info.title;
          const p = info.proc.replace(/\.exe$/i, '');
          return /(^|\s)QQ(\s|$)|QQNT|QQEX|TIM|腾讯QQ/i.test(t) || /^(QQ|QQNT|QQEX|TIM)$/i.test(p);
        });
      console.log('[isActiveQQ:candidates]', candidates);
    }

    console.log('[isActiveQQ:final]', {
      ok
    });
    return ok;
  } catch (e) {
    console.warn('[isActiveQQ] error:', e.message);
    return false;
  }
}
const https = require('https');
const http = require('http');

function locateQqFocusHelper() {
  try {
    if (app.isPackaged) {
      // 常见打包路径
      const p1 = path.join(process.resourcesPath, 'qq-focus-paste.exe');
      if (fs.existsSync(p1)) return p1;
      const p2 = path.join(process.resourcesPath, 'app.asar.unpacked', 'main', 'qq-focus-paste.exe');
      if (fs.existsSync(p2)) return p2;
      const p3 = path.join(process.resourcesPath, 'extra', 'qq-focus-paste.exe');
      if (fs.existsSync(p3)) return p3;
      return null;
    } else {
      // 开发模式：main 目录
      const local = path.join(__dirname, 'qq-focus-paste.exe');
      if (fs.existsSync(local)) return local;
      return null;
    }
  } catch (e) {
    console.warn('[qqpaste] locate helper fail:', e.message);
    return null;
  }
}

function ensureQqFocusHelperReady() {
  if (qqFocusHelperPath && fs.existsSync(qqFocusHelperPath)) return true;
  qqFocusHelperPath = locateQqFocusHelper();
  console.log('[qqpaste] helper path:', qqFocusHelperPath || '(missing)');
  return !!qqFocusHelperPath;
}

/**
 * 运行 qq-focus-paste.exe
 * mode: 'paste' | 'paste-send'
 * 返回 true 表示执行成功，false 表示未找到/执行失败（将触发 Ctrl+V/Enter 回退）
 */
function runQqFocusPaste(mode) {
  if (!ensureQqFocusHelperReady()) {
    console.warn('[qqpaste] helper missing');
    return false;
  }
  try {
    const {
      spawn
    } = require('child_process');
    return new Promise((resolve) => {
      let resolved = false;
      const proc = spawn(qqFocusHelperPath, [String(mode || 'paste')], {
        windowsHide: true
      });
      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          try {
            proc.kill('SIGTERM');
          } catch {}
          console.warn('[qqpaste] timeout -> fallback');
          resolve(false);
        }
      }, 180); // 给最多 ~180ms，超时立即回退

      proc.on('exit', (code) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timer);
        if (code === 0) resolve(true);
        else {
          console.warn('[qqpaste] exit code', code, '-> fallback');
          resolve(false);
        }
      });
      proc.on('error', (err) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timer);
        console.warn('[qqpaste] spawn error:', err && err.message);
        resolve(false);
      });
    });
  } catch (e) {
    console.warn('[qqpaste] run error:', e.message);
    return false;
  }
}

function isRemoteImage(src) {
  return /^https?:\/\//i.test(src);
}

function normalizeLocalPath(p) {
  if (!p) return '';
  if (/^file:\/\//i.test(p)) {
    return decodeURI(p.replace(/^file:\/+/, ''));
  }
  return p;
}


// === 新增：可跟随重定向下载（最多 5 次），返回 Buffer + 最终扩展名 ===
const {
  URL
} = require('url');

function downloadWithRedirect(url, depth = 0) {
  return new Promise((resolve, reject) => {
    if (depth > 5) {
      return reject(new Error('Too many redirects'));
    }
    try {
      const u = new URL(url);
      const lib = u.protocol === 'https:' ? require('https') : require('http');
      const req = lib.get({
        hostname: u.hostname,
        path: u.pathname + u.search,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) EmojiDownloader/1.0',
          'Accept': 'image/*,*/*;q=0.8'
        },
        timeout: 15000
      }, (res) => {
        // 重定向
        if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
          const loc = res.headers.location;
          if (!loc) return reject(new Error('Redirect without location'));
          const nextUrl = loc.startsWith('http') ? loc : (u.origin + loc);
          res.resume();
          return resolve(downloadWithRedirect(nextUrl, depth + 1));
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error('HTTP ' + res.statusCode));
        }
        const ct = (res.headers['content-type'] || '').toLowerCase();
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          const buf = Buffer.concat(chunks);
          // 推测扩展名
          let ext = '';
          if (/png/.test(ct)) ext = '.png';
          else if (/jpe?g/.test(ct)) ext = '.jpg';
          else if (/gif/.test(ct)) ext = '.gif';
          else if (/webp/.test(ct)) ext = '.webp';
          else if (/bmp/.test(ct)) ext = '.bmp';
          else if (/svg/.test(ct)) ext = '.svg';
          resolve({
            buffer: buf,
            ext
          });
        });
      });
      req.on('error', reject);
    } catch (err) {
      reject(err);
    }
  });
}
async function ensureImageInClipboard(buffer, ext) {
  const tmpDir = os.tmpdir();
  const normExt = ext ? ext.toLowerCase() : '';
  // 统一 jpg/jpeg => jpg
  const finalExt = normExt === 'jpeg' ? 'jpg' : normExt || 'png';
  const tmpPath = require('path').join(
    tmpDir,
    'emoji_' + Date.now() + '_' + Math.random().toString(16).slice(2) + '.' + finalExt
  );
  try {
    require('fs').writeFileSync(tmpPath, buffer);
  } catch (e) {
    console.warn('[ensureImageInClipboard] write temp fail, fallback createFromBuffer:', e.message);
  }

  let img = nativeImage.createFromPath(tmpPath);
  if (!img || (img.isEmpty && img.isEmpty())) {
    // 尝试直接 buffer
    img = nativeImage.createFromBuffer(buffer);
  }

  if (img && !(img.isEmpty && img.isEmpty())) {
    clipboard.writeImage(img);
    return {
      type: 'image',
      path: tmpPath,
      ext: finalExt
    };
  }

  // 转换为 PNG（需要 sharp，可选）
  try {
    const sharp = require('sharp');
    const pngBuf = await sharp(buffer).png().toBuffer();
    const pngPath = require('path').join(
      tmpDir,
      'emoji_' + Date.now() + '_' + Math.random().toString(16).slice(2) + '.png'
    );
    require('fs').writeFileSync(pngPath, pngBuf);
    let pngImg = nativeImage.createFromPath(pngPath);
    if (!pngImg || (pngImg.isEmpty && pngImg.isEmpty())) {
      pngImg = nativeImage.createFromBuffer(pngBuf);
    }
    if (pngImg && !(pngImg.isEmpty && pngImg.isEmpty())) {
      clipboard.writeImage(pngImg);
      return {
        type: 'image',
        path: pngPath,
        ext: 'png',
        converted: true
      };
    }
  } catch (convErr) {
    console.warn('[ensureImageInClipboard] PNG convert fail (sharp missing or error):', convErr.message);
  }

  return {
    type: 'fail'
  };
}

function detectImageExtByMagic(buf) {
  if (!buf || buf.length < 12) return '';
  // PNG
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return 'png';
  // JPG
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return 'jpg';
  // GIF
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return 'gif';
  // WEBP (RIFF....WEBP)
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return 'webp';
  // BMP
  if (buf[0] === 0x42 && buf[1] === 0x4D) return 'bmp';
  return '';
}

// === 是否远程图片 ===
function isRemoteImage(src) {
  return /^https?:\/\//i.test(src);
}

function normalizeLocalPath(p) {
  return /^file:\/\//i.test(p) ? decodeURI(p.replace(/^file:\/+/, '')) : p;
}

// === 修改：putImageToClipboard 逻辑 ===
// 改进的 putImageToClipboard：全面识别、支持 gif/jpg/jpeg/png/webp/bmp
// putImageToClipboard 片段（仅 GIF 分支&失败回退处）
// ===== 替换 putImageToClipboard 中 GIF 分支与失败回退部分 =====
async function putImageToClipboard(src) {
  try {
    const isRemote = isRemoteImage(src);
    if (isRemote) {
      const result = await downloadWithRedirect(src).catch(e => {
        console.warn('[putImage] download fail:', e.message);
        return null;
      });
      if (!result || !result.buffer || result.buffer.length < 64) {
        // 远程彻底失败：回退静态（不发地址）
        return {
          type: 'fallback-static',
          reason: 'download-fail'
        };
      }
      let ext = '';
      const ct = (result.ext || '').toLowerCase();
      if (/gif/.test(ct)) ext = 'gif';
      else if (/png/.test(ct)) ext = 'png';
      else if (/jpe?g/.test(ct)) ext = 'jpg';
      else if (/webp/.test(ct)) ext = 'webp';
      else if (/bmp/.test(ct)) ext = 'bmp';
      if (!ext) {
        const m = src.match(/\.(png|jpe?g|gif|webp|bmp)(?:\?|#|$)/i);
        if (m) ext = m[1].toLowerCase();
      }
      if (!ext) ext = detectImageExtByMagic(result.buffer) || 'png';

      if (ext === 'gif') {
        ensureGifStoreDir();
        // 始终使用安全随机名，避免 URL 异常字符
        let fname = safeRandomGifName();
        fname = sanitizeFilename(fname);
        let full = path.join(gifStoreDir, fname);
        let wrote = false;
        try {
          fs.writeFileSync(full, result.buffer);
          wrote = true;
        } catch (e1) {
          console.warn('[putImage] write gif primary fail:', e1.message);
          // 回退到 os.tmpdir 再试一次
          try {
            const tmpFull = path.join(os.tmpdir(), safeRandomGifName());
            fs.writeFileSync(tmpFull, result.buffer);
            full = tmpFull;
            wrote = true;
            console.log('[putImage] gif wrote to tmp fallback');
          } catch (e2) {
            console.warn('[putImage] write gif fallback fail:', e2.message);
            // 最终失败 → 回退静态
            return {
              type: 'fallback-static',
              reason: 'gif-write-fail'
            };
          }
        }
        if (wrote) {
          return {
            type: 'gif-file',
            path: full,
            animated: true
          };
        }
      }

      // 非 GIF
      const placed = await ensureImageInClipboard(result.buffer, ext);
      if (placed.type === 'image') return placed;
      // 位图失败，回退文本（仅非 GIF）
      clipboard.writeText(src);
      return {
        type: 'text'
      };
    } else {
      // 本地
      const local = normalizeLocalPath(src);
      if (!local || !fs.existsSync(local)) {
        return {
          type: 'fail'
        };
      }
      const ext = (local.match(/\.(png|jpe?g|gif|webp|bmp)$/i)?.[1] || '').toLowerCase();
      if (ext === 'gif') {
        return {
          type: 'gif-file',
          path: local,
          animated: true
        };
      }
      let buf = null;
      try {
        buf = fs.readFileSync(local);
      } catch (e) {
        console.warn('[putImage] read local fail:', e.message);
      }
      if (buf && buf.length > 64) {
        const realExt = ext || detectImageExtByMagic(buf) || 'png';
        const placed = await ensureImageInClipboard(buf, realExt);
        if (placed.type === 'image') return placed;
      }
      const img = nativeImage.createFromPath(local);
      if (img && !(img.isEmpty && img.isEmpty())) {
        clipboard.writeImage(img);
        return {
          type: 'image',
          path: local
        };
      }
      return {
        type: 'fail'
      };
    }
  } catch (err) {
    console.warn('[putImageToClipboard] unexpected fail:', err.message);
    return {
      type: 'fail'
    };
  }
}
let lastGifPasteAt = 0;
const GIF_PASTE_THROTTLE_MS = 600;
// pasteEmojiInternal 片段（仅 GIF 分支与延时）
function pasteEmojiInternal(src, sendNow) {
  if (!src) return;
  (async () => {
    const result = await putImageToClipboard(src);

    // 节流：短时间多次 GIF 请求只允许一次，防止重复插入或写文件竞争
    if (result.type === 'gif-file') {
      const now = Date.now();
      if (now - lastGifPasteAt < GIF_PASTE_THROTTLE_MS) {
        console.warn('[gif] throttled');
        return;
      }
      lastGifPasteAt = now;
    }

    // ★ 统一获取当前聊天窗口类型：qq / wechat / enterprise
    const target = getCurrentChatTarget();
    const chatType = target?.type || null;

    // ========== GIF 文件分支 ==========
    if (result.type === 'gif-file' && result.path) {
      const okFile = setClipboardFiles([result.path]);

      console.log('[emojiPaste] setClipboardFiles ok=', okFile);
      // 之后 before Ctrl+V:
      console.log('[emojiPaste] before Ctrl+V, chatType=', chatType, 'lastWechatPxRect=', lastWechatPxRect);
      if (!okFile) {
        console.warn('[gif-filedrop] setClipboardFiles failed -> fallback static frame');
        try {
          const buf = fs.readFileSync(result.path);
          const placed = await ensureImageInClipboard(buf, 'gif');
          if (placed.type !== 'image') return;
        } catch {
          return;
        }
      }

      if (chatType === 'qq') {
        // QQ：和文字逻辑一致
        await ensureQQForegroundSimple();
      } else {
        // 默认仍按微信逻辑
        focusWeChatWindow();
      }

      setTimeout(() => {
        try {
          sendKeys.sendCtrlV();
        } catch (e) {
          console.warn('[gif-filedrop] ctrl+v fail:', e.message);
        }
        if (sendNow) {
          setTimeout(() => {
            try {
              sendKeys.sendEnter();
            } catch (e2) {
              console.warn('[gif-filedrop] enter fail:', e2.message);
            }
            if (!pinnedAlwaysOnTop) updateZOrder(chatType);
          }, 340);
        } else {
          if (!pinnedAlwaysOnTop) updateZOrder(chatType);
        }
      }, 240);
      return;
    }

    // ========== GIF 失败静态回退分支 ==========
    if (result.type === 'fallback-static') {
      try {
        const again = await downloadWithRedirect(src);
        if (again && again.buffer) {
          const placed = await ensureImageInClipboard(again.buffer, 'png');
          if (placed.type === 'image') {
            if (chatType === 'qq') {
              await ensureQQForegroundSimple();
            } else {
              focusWeChatWindow();
            }
            setTimeout(() => {
              try {
                sendKeys.sendCtrlV();
              } catch {}
              if (sendNow) {
                setTimeout(() => {
                  try {
                    sendKeys.sendEnter();
                  } catch {}
                  if (!pinnedAlwaysOnTop) updateZOrder(chatType);
                }, 120);
              } else if (!pinnedAlwaysOnTop) {
                updateZOrder(chatType);
              }
            }, 160);
          }
        }
      } catch {}
      return;
    }

    // ========== 普通图片 / 文本 分支 ==========
    if (result.type === 'image' || result.type === 'text') {
      if (chatType === 'qq') {
        // 与文字发送逻辑对齐：QQ 前台 + Ctrl+V + 可选 Enter
        await ensureQQForegroundSimple();
      } else {
        // 微信 / 企微 / 其它仍旧
        focusWeChatWindow();
      }

      setTimeout(() => {
        try {
          sendKeys.sendCtrlV();
        } catch (e) {
          console.warn('ctrl+v fail:', e.message);
        }
        if (sendNow) {
          setTimeout(() => {
            try {
              sendKeys.sendEnter();
            } catch (e2) {
              console.warn('enter fail:', e2.message);
            }
            if (!pinnedAlwaysOnTop) updateZOrder(chatType);
          }, 100);
        } else if (!pinnedAlwaysOnTop) {
          updateZOrder(chatType);
        }
      }, 160);
      return;
    }

    // 其它 fail：不做地址回退
  })().catch(e => console.error('emoji paste error:', e));
}

ipcMain.on('emoji:paste', (_e, src) => pasteEmojiInternal(src, false));
ipcMain.on('emoji:paste-send', (_e, src) => pasteEmojiInternal(src, true));

function focusWeChatWindow() {
  try {
    let toFocus = null;
    const wins = (windowManager && windowManager.getWindows) ? windowManager.getWindows() : [];

    // If we already have a tracked handle, try that first
    if (wechatHWND && Array.isArray(wins) && wins.length) {
      toFocus = wins.find(w => Number(w.handle) === Number(wechatHWND));
    }

    // Fallback 1: WeChat by title
    if (!toFocus && Array.isArray(wins) && wins.length) {
      toFocus = wins.find(w => /微信|wechat/i.test(String(w.getTitle() || '')));
    }

    // NEW Fallback 2: Enterprise WeChat by title or process
    if (!toFocus && Array.isArray(wins) && wins.length) {
      toFocus = wins.find(w => {
        const t = String(w.getTitle?.() || '');
        const p = String(w.process?.name || '').replace(/\.exe$/i, '');
        return /企业微信|wxwork|wecom/i.test(t) || /WXWork|WeCom|WeChatAppEx|WXWorkWeb|WeMail|WXDrive/i.test(p);
      });
    }

    // NEW Fallback 3: QQ/QQNT by title or process
    if (!toFocus && Array.isArray(wins) && wins.length) {
      toFocus = wins.find(w => {
        const t = String(w.getTitle?.() || '');
        const p = String(w.process?.name || '').replace(/\.exe$/i, '');
        return /qq|qqnt/i.test(t) || /qq|qqnt/i.test(p);
      });
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

function isAssistantDocked() {
  try {
    if (!wechatFound || !lastWechatPxRect || !mainWindow || mainWindow.isDestroyed()) return false;
    if (!mainWindow.isVisible()) return false;
    const assistant = mainWindow.getBounds();
    if (!assistant || assistant.width < 50 || assistant.height < 50) return false;
    const dipWechat = pxToDipRect(lastWechatPxRect);
    const wx = dipWechat.x,
      wy = dipWechat.y,
      ww = dipWechat.width,
      wh = dipWechat.height;
    if (ww < 200 || wh < 200) return false;
    const AX = assistant.x,
      AY = assistant.y,
      AW = assistant.width,
      AH = assistant.height;
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
}

ipcMain.handle('wechat:is-docked', () => isAssistantDocked());

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

const ENTERPRISE_PROC_NAMES = new Set([
  'WXWork.exe', 'WeCom.exe', 'WeChatAppEx.exe', 'WXWorkWeb.exe', 'WeMail.exe', 'WXDrive.exe'
]);

function detectEnterpriseForegroundFallback() {
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

ipcMain.handle('wechat:is-foreground', () => {
  try {
    return !!(isWechatActive || detectEnterpriseForegroundFallback());
  } catch {
    return false;
  }
});

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
  realAppQuit();
}

app.on('window-all-closed', (e) => {
  console.log('[all-closed] quitting=', quitting, 'allowQuit=', allowQuit);
  if (!allowQuit) {
    e.preventDefault();
    createKeeperWindow();
    return;
  }
  cleanupAndQuit();
});

function pathJoin(...args) {
  try {
    return require('path').join(...args);
  } catch {
    return args.join('/');
  }
}