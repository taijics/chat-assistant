function initFollow(ctx) {
  const { deps, state } = ctx;
  const { screen } = deps.electron;

  function findDisplayForPhysicalRect(pxRect) {
    const displays = screen.getAllDisplays();
    let best = displays[0], bestArea = -1;
    for (const d of displays) {
      const db = d.bounds, s = d.scaleFactor || 1;
      const pb = { x: Math.round(db.x * s), y: Math.round(db.y * s), width: Math.round(db.width * s), height: Math.round(db.height * s) };
      const ix = Math.max(pb.x, pxRect.x);
      const iy = Math.max(pb.y, pxRect.y);
      const ax = Math.min(pb.x + pb.width, pxRect.x + pxRect.width);
      const ay = Math.min(pb.y + pb.height, pxRect.y + pxRect.height);
      const area = Math.max(0, ax - ix) * Math.max(0, ay - iy);
      if (area > bestArea) { bestArea = area; best = d; }
    }
    return best;
  }

  function pxToDipRect(pxRect) {
    const d = findDisplayForPhysicalRect(pxRect);
    const s = d.scaleFactor || 1;
    return { x: Math.round(pxRect.x / s), y: Math.round(pxRect.y / s), width: Math.round(pxRect.width / s), height: Math.round(pxRect.height / s), display: d };
  }

  function computeIsWechatActive() {
    try {
      const { windowManager } = deps;
      if (!windowManager || !windowManager.getActiveWindow) return false;
      const active = windowManager.getActiveWindow();
      if (!active) return false;

      const title = String(active.getTitle?.() || '');
      const procRaw = String(active.process?.name || '');
      const procName = procRaw.replace(/\.exe$/i, '');
      const procPath = String(active.process?.path || '');

      let result = false;

      const ENTERPRISE_PROC_SET = new Set(['WXWork', 'WeCom', 'WeChatAppEx', 'WXWorkWeb', 'WeMail', 'WXDrive']);
      if (/企业微信|wxwork|wecom/i.test(title)) result = true;
      if (ENTERPRISE_PROC_SET.has(procName)) result = true;
      if (/WXWork|WeCom/i.test(procPath)) result = true;

      if (state.wechatHWND && Number(active.handle) === Number(state.wechatHWND)) result = true;

      if (/微信|wechat|weixin/i.test(title)) result = true;
      if (/wechat|weixin/i.test(procName)) result = true;

      const isQQ =
        /(^|\s)qq(\s|$)|qqnt|qqex|tim|腾讯qq/i.test(title) ||
        /^(QQ|QQNT|QQEX|TIM)$/i.test(procName) ||
        /(\\|\/)(Tencent|QQ|QQNT|TIM)(\\|\/)/i.test(procPath);
      if (isQQ) result = true;

      return result;
    } catch {
      return false;
    }
  }

  function shouldFollowNow() {
    return state.wechatFound && state.isWechatActive && !state.userHidden && !state.pinnedAlwaysOnTop;
  }

  function isCurrentChatWeChat() {
    const p = (state.lastProcName || '').toLowerCase();
    return p === 'wechat.exe' || p === 'wechatapp.exe' || p === 'wechatappex.exe' || p === 'weixin.exe';
  }

  function computeDockX(pxRect, width) {
    const display = findDisplayForPhysicalRect(pxRect);
    const s = display.scaleFactor || 1;
    const wa = display.workArea;
    const wechatLeftDip = Math.floor(pxRect.x / s);
    const wechatRightDip = Math.floor((pxRect.x + pxRect.width) / s);
    const extraDip = Math.max(1, Math.round(state.EXTRA_NUDGE_PHYSICAL_PX / s));
    const gapDip = state.DOCK_GAP_FIX_DIPS + extraDip;

    if (!state.dockSide) state.dockSide = (wechatRightDip + width <= wa.x + wa.width) ? 'right' : 'left';

    let nextX;
    if (state.dockSide === 'right') {
      if (wechatRightDip + width <= wa.x + wa.width) nextX = wechatRightDip - gapDip;
      else { state.dockSide = 'left'; nextX = wechatLeftDip - width + gapDip; }
    } else {
      if (wechatLeftDip - width >= wa.x) nextX = wechatLeftDip - width + gapDip;
      else { state.dockSide = 'right'; nextX = wechatRightDip - gapDip; }
    }

    if (nextX < wa.x) nextX = wa.x;
    const maxX = wa.x + wa.width - width;
    if (nextX > maxX) nextX = maxX;

    if (isCurrentChatWeChat()) nextX -= 7;
    // DEBUG: computeDockX details (throttle)
    state.__dbgDockAt = state.__dbgDockAt || 0;
    const now2 = Date.now();
    if (now2 - state.__dbgDockAt > 800) {
      state.__dbgDockAt = now2;
      try {
        console.log('[follow.computeDockX]', {
          pxRect,
          width,
          dockSide: state.dockSide,
          wechatLeftDip,
          wechatRightDip,
          wa: { x: wa.x, y: wa.y, w: wa.width, h: wa.height },
          s,
          gapDip,
          nextX
        });
      } catch {}
    }
    return nextX;
  }

  function computeAssistantHeightFromWechatRect(pxRect) {
    if (!pxRect || !pxRect.width || !pxRect.height) return state.lastStableAssistantHeight;
    const dip = pxToDipRect(pxRect);
    const rawHeight = dip.height;
    const maxAllowed = Math.max(state.MIN_HEIGHT, (dip.display.workArea?.height || rawHeight) - state.MAX_ASSISTANT_HEIGHT_MARGIN);
    if (rawHeight > maxAllowed * 1.25) return state.lastStableAssistantHeight;
    const h = ctx.util.clamp(rawHeight, state.MIN_HEIGHT, maxAllowed);
    // DEBUG: height calc (throttle)
    state.__dbgHAt = state.__dbgHAt || 0;
    const now3 = Date.now();
    if (now3 - state.__dbgHAt > 800) {
      state.__dbgHAt = now3;
      try {
        console.log('[follow.height]', {
          pxRect,
          dipH: dip.height,
          min: state.MIN_HEIGHT,
          maxAllowed,
          chosen: h,
          lastStable: state.lastStableAssistantHeight
        });
      } catch {}
    }
    state.lastStableAssistantHeight = h;
    return h;
  }

  function applyTargetImmediate() {
    if (!state.mainWindow || state.mainWindow.isDestroyed()) return;
    state.current = { ...state.target };
    try {
      state.mainWindow.setBounds({
        x: Math.round(state.current.x),
        y: Math.round(state.current.y),
        width: Math.round(state.assistWidth),
        height: Math.round(state.current.h)
      });
    } catch {}
  }

  function updateZOrder(chatType) {
    if (state.quitting) return;
    if (!state.mainWindow || state.mainWindow.isDestroyed() || !state.wechatHWND) return;
    if (state.pinnedAlwaysOnTop) return;
    try {
      deps.wechatMonitor.setZOrder(state.mainWindow.getNativeWindowHandle(), state.wechatHWND, chatType);
    } catch {}
  }

  function acceptAsBaseline(rect) {
    if (!rect) return;
    state.lastBaselineRect = { ...rect };
    state.baselineArea = rect.width * rect.height;
  }

  function isNearFull(pxRect) {
    if (!pxRect) return false;
    const dip = pxToDipRect(pxRect);
    const wa = dip.display.workArea;
    if (!wa) return false;
    // DEBUG: isNearFull details (throttle)
    state.__dbgNearFullAt = state.__dbgNearFullAt || 0;
    const now = Date.now();
    if (now - state.__dbgNearFullAt > 800) {
      state.__dbgNearFullAt = now;
      try {
        console.log('[follow.isNearFull]', {
          pxRect,
          dip: { x: dip.x, y: dip.y, w: dip.width, h: dip.height },
          wa: { x: wa.x, y: wa.y, w: wa.width, h: wa.height },
          scale: dip.display.scaleFactor
        });
      } catch {}
    }
    return dip.width >= wa.width * 0.9 && dip.height >= wa.height * 0.9;
  }

  function shouldIgnoreEphemeral(incomingRect) {
    if (!incomingRect || !incomingRect.width || !incomingRect.height) return true;
    if (!state.baselineArea || !state.lastBaselineRect) return false;
    const area = incomingRect.width * incomingRect.height;
    const tooSmall = area < state.baselineArea * 0.45;
    if (!tooSmall) return false;
    const now = Date.now();
    if (now < state.ignoreEphemeralUntil) return true;
    return true;
  }

  function getWechatWindowViaWM() {
    try {
      const { windowManager } = deps;
      if (!windowManager || !windowManager.getWindows) return null;
      const wins = windowManager.getWindows();
      if (!Array.isArray(wins) || !wins.length) return null;

      const enterpriseRe = /企业微信|wxwork|wecom|WeChatAppEx|WXWorkWeb|WeMail|WXDrive/i;
      const genericRe = /微信|wechat|weixin/i;
      const qqRe = /(^|\s)QQ(\s|$)|QQNT/i;

      const pick = (re, procList) => wins.find(w => {
        const t = String(w.getTitle?.() || '');
        const p = String(w.process?.name || '').replace(/\.exe$/i, '');
        return re.test(t) || (procList && procList.includes(p));
      });

      const w =
        pick(enterpriseRe, ['WXWork', 'WeCom', 'WeChatAppEx', 'WXWorkWeb', 'WeMail', 'WXDrive']) ||
        pick(genericRe, ['WeChat', 'Weixin', 'WeChatAppEx']) ||
        pick(qqRe, ['QQ', 'QQNT']);

      if (!w) return null;
      const b = w.getBounds?.();
      if (!b || !isFinite(b.x) || !isFinite(b.y) || !isFinite(b.width) || !isFinite(b.height)) return null;

      return { hwnd: Number(w.handle), rect: { x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) } };
    } catch {
      return null;
    }
  }

  function applyFrozen() {
    if (!state.mainWindow || state.mainWindow.isDestroyed()) return;
    if (state.lastDockX == null || !state.lastValidWechatRect) return;
    if (!shouldFollowNow()) return;
    const dip = pxToDipRect(state.lastValidWechatRect);
    const h = computeAssistantHeightFromWechatRect(state.lastValidWechatRect);
    state.target.x = state.lastDockX;
    state.target.y = dip.y;
    state.target.h = h;
    applyTargetImmediate();
  }

  function dockToWechatNow(force = false) {
    try {
      let rect = state.lastWechatPxRect;
      if (!rect) {
        const info = getWechatWindowViaWM();
        if (info && info.rect && info.rect.width > 300 && info.rect.height > 300) {
          state.wechatFound = true;
          state.wechatHWND = info.hwnd || state.wechatHWND;
          rect = info.rect;
          state.lastWechatPxRect = rect;
          acceptAsBaseline(rect);
          console.log('[dock] getWechatWindowViaWM used', { rect, hwnd: info.hwnd });
        }
      }
      if (!rect || !rect.width || !rect.height) return false;

      const dockX = computeDockX(rect, state.assistWidth);
      state.lastDockX = dockX;
      const dip = pxToDipRect(rect);
      const h = computeAssistantHeightFromWechatRect(rect);
      state.target = { x: dockX, y: dip.y, w: state.assistWidth, h };
      if (force || shouldFollowNow()) applyTargetImmediate();
      return true;
    } catch {
      return false;
    }
  }

  function restoreDockIfNeeded(source) {
    try {
      state.userHidden = false;
      let activeNow = false;
      try { activeNow = computeIsWechatActive(); } catch {}

      if (!state.wechatFound) {
        const info = getWechatWindowViaWM();
        if (info && info.rect && info.rect.width > 300 && info.rect.height > 300) {
          state.wechatFound = true;
          state.wechatHWND = info.hwnd || state.wechatHWND;
          state.lastWechatPxRect = info.rect;
          acceptAsBaseline(info.rect);
        }
      }

      if (state.wechatFound && state.lastWechatPxRect) {
        dockToWechatNow(true);
        applyTargetImmediate();
        if (activeNow) updateZOrder();
      }
    } catch (e) {
      console.warn('[restoreDock] fail:', e.message);
    }
  }

  function startAnimationLoop() {
    if (state.animationTimer) clearInterval(state.animationTimer);
    state.animationTimer = setInterval(() => {
      if (state.quitting) return;
      if (!state.mainWindow || state.mainWindow.isDestroyed() || !state.mainWindow.isVisible()) return;
      if (!shouldFollowNow()) return;
      state.current.x = ctx.util.lerp(state.current.x, state.target.x, state.LERP_SPEED);
      state.current.y = ctx.util.lerp(state.current.y, state.target.y, state.LERP_SPEED);
      state.current.w = state.assistWidth;
      state.current.h = ctx.util.lerp(state.current.h, state.target.h, state.LERP_SPEED);
      try {
        state.mainWindow.setBounds({
          x: Math.round(state.current.x),
          y: Math.round(state.current.y),
          width: Math.round(state.assistWidth),
          height: Math.round(state.current.h)
        });
      } catch {}
    }, state.ANIMATION_INTERVAL);
  }
function startForegroundFollow() {
  if (state.fgFollowTimer) clearInterval(state.fgFollowTimer);

  state.fgFollowTimer = setInterval(() => {
    if (state.quitting) return;

    // 计算当前前台是否是聊天窗（微信/QQ/企微）
    const activeIsChat = computeIsWechatActive();
    state.isWechatActive = activeIsChat;

    // DEBUG：每 1 秒打印一次状态（避免刷屏）
    state.__dbgFgAt = state.__dbgFgAt || 0;
    const now = Date.now();
    if (now - state.__dbgFgAt > 1000) {
      state.__dbgFgAt = now;
      let activeHwnd = null;
      let activeTitle = '';
      let activeProc = '';
      try {
        const aw = deps.windowManager?.getActiveWindow?.();
        if (aw) {
          activeHwnd = Number(aw.handle);
          activeTitle = String(aw.getTitle?.() || '');
          activeProc = String(aw.process?.name || '');
        }
      } catch {}

      console.log('[fgFollow]', {
        activeIsChat,
        activeHwnd,
        activeTitle,
        activeProc,
        trackedHWND: state.wechatHWND,
        wechatFound: state.wechatFound,
        pinnedAlwaysOnTop: state.pinnedAlwaysOnTop
      });
    }

    // 关键改动：
    // 只要当前前台是聊天窗，并且我们有 trackedHWND，就尝试把助手插到聊天窗后面
    // 这样“聊天窗在最上层 -> 助手也到最上层（紧贴其后）”
    if (activeIsChat && state.wechatFound && state.wechatHWND && !state.pinnedAlwaysOnTop) {
      updateZOrder(); // chatType 可留空
    }
  }, state.FG_CHECK_INTERVAL);
}

  ctx.follow = {
    findDisplayForPhysicalRect,
    pxToDipRect,
    computeDockX,
    computeAssistantHeightFromWechatRect,
    computeIsWechatActive,
    shouldFollowNow,
    updateZOrder,
    acceptAsBaseline,
    isNearFull,
    shouldIgnoreEphemeral,
    getWechatWindowViaWM,
    dockToWechatNow,
    restoreDockIfNeeded,
    applyFrozen,
    applyTargetImmediate,
    startAnimationLoop,
    startForegroundFollow,
    isCurrentChatWeChat
  };
}

module.exports = { initFollow };