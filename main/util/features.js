const fs = require('fs');

function registerFeatures(ctx) {
  const { deps, state } = ctx;
  const { ipcMain, clipboard } = deps.electron;
  const sendKeys = deps.sendKeys;

  // ===== insert throttle =====
  function canStartInsert() {
    const now = Date.now();
    if (state.insertBusy) return false;
    if (now - state.lastInsertAt < state.INSERT_DEBOUNCE_MS) return false;
    state.lastInsertAt = now;
    state.insertBusy = true;
    return true;
  }
  function endInsert() {
    state.insertBusy = false;
  }

  // ===== small debug helpers =====
  function logOnceSendKeys() {
    if (state.__loggedSendKeys) return;
    state.__loggedSendKeys = true;
    try {
      console.log('[BOOT] sendKeys keys=', Object.keys(sendKeys || {}));
    } catch {}
  }

  function doCtrlV() {
    try { sendKeys.sendCtrlV(); } catch (e) { console.warn('[insert] ctrl+v fail:', e && e.message); }
  }
  function doEnter() {
    try { sendKeys.sendEnter(); } catch (e) { console.warn('[insert] enter fail:', e && e.message); }
  }

  function afterInsertUpdateZOrder(chatType) {
    setTimeout(() => {
      try {
        if (!state.pinnedAlwaysOnTop) ctx.follow.updateZOrder(chatType);
      } catch {}
    }, 160);
  }

  // ===== foreground helpers (keep old behavior) =====
  async function ensureQQForegroundSimple() {
    try {
      if (deps.windowManager && deps.windowManager.getActiveWindow) {
        const active = deps.windowManager.getActiveWindow();
        const t = ctx.chat.classifyWindowType(active);
        if (t === 'qq') {
          await state.sleep(80);
          return true;
        }
      }
    } catch {}
    let ok = false;
    try { ok = ctx.chat.focusQQMainWindow(); } catch {}
    await state.sleep(140);
    return ok;
  }

  // QQ 输入框兜底（Tab 序列）：仅在 sendKeys 支持时启用
  async function focusQQInputFallback() {
    try {
      if (typeof sendKeys.sendTab !== 'function') return;

      try { sendKeys.sendTab(); } catch {}
      await state.sleep(90);
      try { sendKeys.sendTab(); } catch {}
      await state.sleep(90);
      try { sendKeys.sendTab(); } catch {}
      await state.sleep(120);
      try { sendKeys.sendTab(); } catch {}
      await state.sleep(100);

      if (typeof sendKeys.sendShiftTab === 'function') {
        try { sendKeys.sendShiftTab(); } catch {}
        await state.sleep(100);
      }
    } catch {}
  }

  async function ensureWeChatForegroundSimple() {
    // 旧版核心：不依赖 hwnd，直接用你已有的 focusWeChatWindow（内部有多层兜底）
    try { ctx.chat.focusWeChatWindow(); } catch {}
    await state.sleep(140);
    return true;
  }

  // ===== target resolve (IMPORTANT) =====
  function rectLooksLikeMainChat(rect) {
    if (!rect) return false;
    const w = Number(rect.width), h = Number(rect.height);
    if (!isFinite(w) || !isFinite(h)) return false;
    // 你旧版/cc 里主窗过滤是 w>=400 && h>=300，这里保持一致，不要把 256x110 这种小浮窗当目标
    return w >= 400 && h >= 300;
  }

  /**
   * 关键：优先“吸附目标”，其次“前台目标”，最后“扫描兜底”
   * - 吸附目标来自 state.wechatHWND/state.lastWechatPxRect/state.lastProcName（来自 wechat_monitor.cc 的 procName）
   */
function resolveInsertTarget() {
  // 1) 优先：吸附目标（以 wechatMonitor 跟踪的 hwnd 为准）
  try {
    if (state.wechatFound && state.wechatHWND && rectLooksLikeMainChat(state.lastWechatPxRect)) {
      // 用 hwnd 去 windowManager 里找窗口并分类，避免 lastProcName 被污染导致误判 qq
      const typeByHwnd = ctx.chat.classifyHwndType?.(state.wechatHWND);

      // 如果 hwnd 分类失败，再用 lastProcName 兜底（但优先级降低）
      let type = typeByHwnd;
      if (!type) {
        const p = String(state.lastProcName || '').toLowerCase();
        if (p.includes('qq')) type = 'qq';
        else if (p.includes('wxwork') || p.includes('wecom')) type = 'enterprise';
        else if (p.includes('wechat') || p.includes('weixin')) type = 'wechat';
      }

      // 最终兜底：当成 wechat（避免错误切去 QQ）
      if (!type) type = 'wechat';

      console.log('[resolveInsertTarget] docked', {
        hwnd: state.wechatHWND,
        typeByHwnd,
        lastProcName: state.lastProcName,
        finalType: type,
        rect: state.lastWechatPxRect
      });

      return { type, source: 'docked', hwnd: state.wechatHWND, rect: state.lastWechatPxRect };
    }
  } catch {}

  // 2) 其次：前台就是聊天窗（qq/wechat/enterprise）
  try {
    const fg = ctx.chat.getForegroundChatTarget?.();
    if (fg && fg.type) return { ...fg, source: 'foreground' };
  } catch {}

  // 3) 兜底：扫描一个聊天窗
  try {
    const any = ctx.chat.resolveDockedChatTarget?.();
    if (any && any.type) return { ...any, source: 'scan' };
  } catch {}

  return null;
}

  // ===== phrase:paste =====
  ipcMain.on('phrase:paste', async (_e, text) => {
    logOnceSendKeys();
    console.log('[IPC] phrase:paste received', { textType: typeof text, len: (text || '').length });

    if (!text) return;
    if (!canStartInsert()) return;

    try {
      clipboard.writeText(String(text));

      const target = resolveInsertTarget();
      if (!target || !target.type) {
        console.warn('[phrase:paste] no target resolved');
        return;
      }
      console.log('[phrase:paste] target=', { type: target.type, source: target.source });

      if (target.type === 'qq') {
        await ensureQQForegroundSimple();

        // 可选加速器（与旧版一致）
        try {
          const okExe = await ctx.clipboard.runQqFocusPaste('paste');
          console.log('[qqpaste] okExe=', okExe);
        } catch (e) {
          console.warn('[qqpaste] run error:', e && e.message);
        }

        // QQ 输入框兜底 + Ctrl+V
        await focusQQInputFallback();
        await state.sleep(60);
        doCtrlV();
      } else {
        // wechat / enterprise：严格按旧版策略 -> focusWeChatWindow + Ctrl+V
        await ensureWeChatForegroundSimple();
        await state.sleep(40);
        doCtrlV();
      }

      afterInsertUpdateZOrder(target.type);
    } catch (e) {
      console.error('phrase paste failed:', e);
    } finally {
      endInsert();
    }
  });

  // ===== phrase:paste-send =====
  ipcMain.on('phrase:paste-send', async (_e, text) => {
    logOnceSendKeys();
    console.log('[IPC] phrase:paste-send received', { textType: typeof text, len: (text || '').length });

    if (!text) return;
    if (!canStartInsert()) return;

    try {
      clipboard.writeText(String(text));

      const target = resolveInsertTarget();
      if (!target || !target.type) {
        console.warn('[phrase:paste-send] no target resolved');
        return;
      }
      console.log('[phrase:paste-send] target=', { type: target.type, source: target.source });

      if (target.type === 'qq') {
        await ensureQQForegroundSimple();

        // 可选：qq-focus-paste.exe（可能已经 paste+send）
        try {
          const okExe = await ctx.clipboard.runQqFocusPaste('paste-send');
          console.log('[qqpaste] okExe=', okExe);
        } catch (e) {
          console.warn('[qqpaste] run error:', e && e.message);
        }

        // 保持旧版“宁可重复也要成功”的策略：再 Ctrl+V + Enter
        await focusQQInputFallback();
        await state.sleep(60);
        doCtrlV();
        await state.sleep(110);
        doEnter();
      } else {
        // wechat / enterprise
        await ensureWeChatForegroundSimple();
        await state.sleep(40);
        doCtrlV();
        await state.sleep(100);
        doEnter();
      }

      afterInsertUpdateZOrder(target.type);
    } catch (e) {
      console.error('phrase paste-send failed:', e);
    } finally {
      endInsert();
    }
  });

  // ===== emoji paste (保持你现有逻辑，只把目标选择也改成“吸附优先”) =====
  async function pasteEmojiInternal(src, sendNow) {
    if (!src) return;

    const result = await ctx.clipboard.putImageToClipboard(src);

    if (result.type === 'gif-file') {
      const now = Date.now();
      if (now - state.lastGifPasteAt < state.GIF_PASTE_THROTTLE_MS) {
        console.warn('[gif] throttled');
        return;
      }
      state.lastGifPasteAt = now;
    }

    const target = resolveInsertTarget();
    const chatType = target?.type || null;

    // gif-file branch
    if (result.type === 'gif-file' && result.path) {
      const okFile = ctx.clipboard.setClipboardFiles([result.path]);
      if (!okFile) {
        try {
          const buf = fs.readFileSync(result.path);
          const placed = await ctx.clipboard.ensureImageInClipboard(buf, 'gif');
          if (placed.type !== 'image') return;
        } catch {
          return;
        }
      }

      if (chatType === 'qq') await ensureQQForegroundSimple();
      else await ensureWeChatForegroundSimple();

      setTimeout(() => {
        try { sendKeys.sendCtrlV(); } catch {}
        if (sendNow) {
          setTimeout(() => {
            try { sendKeys.sendEnter(); } catch {}
            if (!state.pinnedAlwaysOnTop) ctx.follow.updateZOrder(chatType);
          }, 340);
        } else {
          if (!state.pinnedAlwaysOnTop) ctx.follow.updateZOrder(chatType);
        }
      }, 240);
      return;
    }

    // fallback-static
    if (result.type === 'fallback-static') {
      try {
        const again = await ctx.clipboard.downloadWithRedirect(src);
        if (again && again.buffer) {
          const placed = await ctx.clipboard.ensureImageInClipboard(again.buffer, 'png');
          if (placed.type === 'image') {
            if (chatType === 'qq') await ensureQQForegroundSimple();
            else await ensureWeChatForegroundSimple();

            setTimeout(() => {
              try { sendKeys.sendCtrlV(); } catch {}
              if (sendNow) {
                setTimeout(() => {
                  try { sendKeys.sendEnter(); } catch {}
                  if (!state.pinnedAlwaysOnTop) ctx.follow.updateZOrder(chatType);
                }, 120);
              } else if (!state.pinnedAlwaysOnTop) {
                ctx.follow.updateZOrder(chatType);
              }
            }, 160);
          }
        }
      } catch {}
      return;
    }

    // image/text
    if (result.type === 'image' || result.type === 'text') {
      if (chatType === 'qq') await ensureQQForegroundSimple();
      else await ensureWeChatForegroundSimple();

      setTimeout(() => {
        try { sendKeys.sendCtrlV(); } catch {}
        if (sendNow) {
          setTimeout(() => {
            try { sendKeys.sendEnter(); } catch {}
            if (!state.pinnedAlwaysOnTop) ctx.follow.updateZOrder(chatType);
          }, 100);
        } else if (!state.pinnedAlwaysOnTop) {
          ctx.follow.updateZOrder(chatType);
        }
      }, 160);
    }
  }

  ipcMain.on('emoji:paste', (_e, src) => pasteEmojiInternal(src, false));
  ipcMain.on('emoji:paste-send', (_e, src) => pasteEmojiInternal(src, true));
}

module.exports = { registerFeatures };