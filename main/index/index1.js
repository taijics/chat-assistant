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