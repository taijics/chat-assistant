const path = require('path');

function createState(app) {
  const state = {};

  // ===== quit guard =====
  state.realAppQuit = app.quit.bind(app);
  state.realAppExit = (app.exit ? app.exit.bind(app) : (code) => {});
  state.realProcExit = process.exit.bind(process);
  state.allowQuit = false;

  // ===== helpers =====
  state.sleep = (ms) => new Promise(r => setTimeout(r, ms));

  // ===== gif cache =====
  state.gifStoreDir = path.join(app.getPath('userData'), 'gif-cache');
  state.fileDropHelperPath = null;
  state.qqFocusHelperPath = null;

  // ===== windows =====
  state.mainWindow = null;
  state.miniWindow = null;
  state.keeperWindow = null;

  // ===== animation =====
  state.animationTimer = null;
  state.LERP_SPEED = 0.22;
  state.ANIMATION_INTERVAL = 16;

  // ===== sizing =====
  state.ASSISTANT_MIN_W = 260;
  state.ASSISTANT_MAX_W = 1400;
  state.assistWidth = 350;
  state.MIN_HEIGHT = 200;
  state.DOCK_GAP_FIX_DIPS = 2;
  state.EXTRA_NUDGE_PHYSICAL_PX = 6;
  state.MAX_ASSISTANT_HEIGHT_MARGIN = 40;

  state.current = { x: 0, y: 0, w: state.assistWidth, h: 600 };
  state.target = { x: 0, y: 0, w: state.assistWidth, h: 600 };

  // ===== follow state =====
  state.userHidden = false;
  state.wechatFound = false;
  state.wechatHWND = null;
  state.firstDirectPosition = false;
  state.quitting = false;
  state.pinnedAlwaysOnTop = false;
  state.lastWechatPxRect = null;

  state.isWechatActive = false;

  state.fgFollowTimer = null;
  state.FG_CHECK_INTERVAL = 250;
 // ✅ settings window
  state.settingsWindow = null;
  state.lastStableAssistantHeight = 600;
  state.dockSide = null;

  // screenshot + stability
  state.screenshotInProgress = false;
  state.preShotWechatRect = null;
  state.lastFoundAt = 0;
  state.TRANSIENT_DESTROY_MS = 3000;

  state.freezePosition = false;
  state.screenshotPhase = 0;
  state.lastValidWechatRect = null;
  state.lastDockX = null;
  state.lastBaselineRect = null;
  state.baselineArea = null;
  state.screenshotEndedAt = 0;
  state.ignoreEphemeralUntil = 0;

  // process name tracking
  state.lastProcName = '';

  // insert throttle
  state.insertBusy = false;
  state.lastInsertAt = 0;
  state.INSERT_DEBOUNCE_MS = 220;

  // gif throttle
  state.lastGifPasteAt = 0;
  state.GIF_PASTE_THROTTLE_MS = 600;

  // token
  state.baiduOcrToken = '';

  return state;
}

module.exports = { createState };