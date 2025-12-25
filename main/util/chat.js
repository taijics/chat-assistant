function initChat(ctx) {
  const { deps, state } = ctx;
  const { windowManager } = deps;

  function classifyWindowType(win, tag = '') {
    try {
      if (!win) return null;
      const title = String(win.getTitle?.() || '');
      const procRaw = String(win.process?.name || '');
      const proc = procRaw.replace(/\.exe$/i, '');
      const pth = String(win.process?.path || '');

      if (/(^|\s)QQ(\s|$)|QQNT|QQEX|TIM|腾讯QQ/i.test(title) ||
        /^(QQ|QQNT|QQEX|TIM)$/i.test(proc) ||
        /(\\|\/)(Tencent|QQ|QQNT|TIM)(\\|\/)/i.test(pth)) return 'qq';

      if (/企业微信|wxwork|wecom/i.test(title) ||
        /^(WXWork|WeCom|WeChatAppEx|WXWorkWeb|WeMail|WXDrive)$/i.test(proc) ||
        /wxwork|wecom/i.test(pth)) return 'enterprise';

      if (/微信|wechat|weixin/i.test(title) ||
        /^(WeChat|Weixin|WeChatAppEx)$/i.test(proc)) return 'wechat';

      return null;
    } catch (e) {
      console.warn('[classify] error:', e.message);
      return null;
    }
  }

  function focusWindow(targetWinOrHandle) {
    try {
      if (!windowManager || !windowManager.getWindows) return false;
      let win = null;
      if (typeof targetWinOrHandle === 'object' && targetWinOrHandle) win = targetWinOrHandle;
      else {
        const handle = Number(targetWinOrHandle);
        if (!handle) return false;
        const wins = windowManager.getWindows() || [];
        win = wins.find(w => Number(w.handle) === handle) || null;
      }
      if (!win) return false;
      try { win.bringToTop && win.bringToTop(); } catch {}
      try { win.focus && win.focus(); } catch {}
      return true;
    } catch {
      return false;
    }
  }

  function focusQQMainWindow() {
    try {
      if (!windowManager || !windowManager.getWindows) return false;
      const wins = windowManager.getWindows();
      if (!Array.isArray(wins) || !wins.length) return false;
      const qqTitleRe = /(^|\s)QQ(\s|$)|QQNT|TIM|腾讯QQ/i;
      let best = null, bestArea = -1;
      for (const w of wins) {
        const t = String(w.getTitle?.() || '');
        const p = String(w.process?.name || '').replace(/\.exe$/i, '');
        if (!(qqTitleRe.test(t) || /^(QQ|QQNT|TIM|QQEX)$/i.test(p))) continue;
        const b = w.getBounds?.();
        if (!b || !isFinite(b.width) || !isFinite(b.height)) continue;
        if (b.width < 460 || b.height < 320) continue;
        const area = Math.round(b.width) * Math.round(b.height);
        if (area > bestArea) { bestArea = area; best = w; }
      }
      if (best) {
        try { best.bringToTop(); } catch {}
        try { best.focus(); } catch {}
        return true;
      }
    } catch {}
    return false;
  }

  function focusWeChatWindow() {
    try {
      let toFocus = null;
      const wins = (windowManager && windowManager.getWindows) ? windowManager.getWindows() : [];

      if (state.wechatHWND && Array.isArray(wins) && wins.length) {
        toFocus = wins.find(w => Number(w.handle) === Number(state.wechatHWND));
      }
      if (!toFocus && Array.isArray(wins) && wins.length) {
        toFocus = wins.find(w => /微信|wechat/i.test(String(w.getTitle() || '')));
      }
      if (!toFocus && Array.isArray(wins) && wins.length) {
        toFocus = wins.find(w => {
          const t = String(w.getTitle?.() || '');
          const p = String(w.process?.name || '').replace(/\.exe$/i, '');
          return /企业微信|wxwork|wecom/i.test(t) || /WXWork|WeCom|WeChatAppEx|WXWorkWeb|WeMail|WXDrive/i.test(p);
        });
      }
      if (!toFocus && Array.isArray(wins) && wins.length) {
        toFocus = wins.find(w => {
          const t = String(w.getTitle?.() || '');
          const p = String(w.process?.name || '').replace(/\.exe$/i, '');
          return /qq|qqnt/i.test(t) || /qq|qqnt/i.test(p);
        });
      }

      if (toFocus) {
        try { toFocus.bringToTop(); } catch {}
        try { toFocus.focus(); } catch {}
      }
    } catch {}
  }

  function isChatMainBounds(bb) {
    try {
      if (!bb || !isFinite(bb.x) || !isFinite(bb.y) || !isFinite(bb.width) || !isFinite(bb.height)) return false;
      return true;
    } catch {
      return false;
    }
  }

  // 新增：统一把 target 写回 state（恢复旧版行为）
  function recordChatTargetAsBaseline(target) {
    try {
      if (!target || !target.rect) return;
      // 关键：提供后续吸附/兜底依据
      state.lastWechatPxRect = { ...target.rect };
      // 关键：提供 shouldIgnoreEphemeral 的 baselineArea
      ctx.follow.acceptAsBaseline(state.lastWechatPxRect);
    } catch {}
  }

  function resolveDockedChatTarget() {
    try {
      if (!windowManager || !windowManager.getActiveWindow) return null;

      const active = windowManager.getActiveWindow();
      if (active) {
        const type = classifyWindowType(active);
        const bb = active.getBounds?.();
        if ((type === 'qq' || type === 'wechat' || type === 'enterprise') && isChatMainBounds(bb)) {
          const rect = { x: Math.round(bb.x), y: Math.round(bb.y), width: Math.round(bb.width), height: Math.round(bb.height) };
          const hwnd = Number(active.handle) || NaN;
          const target = { type, hwnd, rect, win: active };
          recordChatTargetAsBaseline(target);
          return target;
        }
      }

      const wins = windowManager.getWindows?.() || [];
      for (const w of wins) {
        const t = classifyWindowType(w);
        if (t !== 'qq' && t !== 'wechat' && t !== 'enterprise') continue;
        const bb = w.getBounds?.();
        if (!isChatMainBounds(bb)) continue;
        const rect = { x: Math.round(bb.x), y: Math.round(bb.y), width: Math.round(bb.width), height: Math.round(bb.height) };
        const hwnd = Number(w.handle) || NaN;
        const target = { type: t, hwnd, rect, win: w };
        recordChatTargetAsBaseline(target);
        return target;
      }
      return null;
    } catch {
      return null;
    }
  }

  function getForegroundChatTarget() {
    try {
      if (!windowManager || !windowManager.getActiveWindow) return null;
      const active = windowManager.getActiveWindow();
      if (!active) return null;

      const type = classifyWindowType(active);
      if (type !== 'qq' && type !== 'wechat' && type !== 'enterprise') return null;

      const bb = active.getBounds?.();
      if (!bb || !isFinite(bb.x) || !isFinite(bb.y) || !isFinite(bb.width) || !isFinite(bb.height)) return null;

      const rect = { x: Math.round(bb.x), y: Math.round(bb.y), width: Math.round(bb.width), height: Math.round(bb.height) };
      const hwnd = Number(active.handle) || NaN;
      const target = { type, hwnd, rect, win: active };

      recordChatTargetAsBaseline(target);
      return target;
    } catch {
      return null;
    }
  }

  function getCurrentChatTarget() {
    // 这里保持原顺序
    return getForegroundChatTarget() || resolveDockedChatTarget?.() || null;
  }

  ctx.chat = {
    classifyWindowType,
    focusWindow,
    focusWeChatWindow,
    focusQQMainWindow,
    resolveDockedChatTarget,
    getForegroundChatTarget,
    getCurrentChatTarget
  };
}

module.exports = { initChat };