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

  // ===== helpers =====
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

  async function ensureWeChatForegroundSimple(target) {
    // 目标是：尽量把“当前聊天窗”置前，然后给一点时间让输入框响应
    let ok = false;
    try {
      // 1) 直接用窗口对象（最可靠）
      if (target?.win) {
        try { target.win.bringToTop && target.win.bringToTop(); } catch {}
        try { target.win.focus && target.win.focus(); ok = true; } catch {}
      }

      // 2) 句柄兜底
      if (!ok && isFinite(target?.hwnd)) {
        try { ok = !!ctx.chat.focusWindow(target.hwnd); } catch {}
      }

      // 3) 类型兜底：直接找微信/企微窗
      if (!ok) {
        try { ctx.chat.focusWeChatWindow(); ok = true; } catch {}
      }
    } catch {}

    await state.sleep(140);
    return !!ok;
  }

  // QQ 输入框兜底（Tab 序列），保持你旧版 index3/index4 的风格
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

  function doCtrlV() {
    try { sendKeys.sendCtrlV(); } catch (e) { console.warn('[keys] ctrl+v fail:', e && e.message); }
  }
  function doEnter() {
    try { sendKeys.sendEnter(); } catch (e) { console.warn('[keys] enter fail:', e && e.message); }
  }

  function afterInsertUpdateZOrder(chatType) {
    setTimeout(() => {
      try {
        if (!state.pinnedAlwaysOnTop) ctx.follow.updateZOrder(chatType);
      } catch {}
    }, 160);
  }

  // 统一：更稳的 target 获取（避免助手窗口在前台导致拿不到聊天窗）
  function getBestChatTarget() {
    try {
      // 优先：当前前台聊天窗
      const fg = ctx.chat.getForegroundChatTarget?.();
      if (fg && fg.type) return fg;

      // 兜底：已识别/可吸附的聊天窗
      const docked = ctx.chat.resolveDockedChatTarget?.();
      if (docked && docked.type) return docked;

      return null;
    } catch {
      return null;
    }
  }

  // ===== phrase:paste (单击只粘贴) =====
  ipcMain.on('phrase:paste', async (_e, text) => {
    if (!text) return;
    if (!canStartInsert()) return;

    try {
      clipboard.writeText(String(text));

      const target = getBestChatTarget();
      if (!target || !target.type) {
        console.warn('[phrase] no chat target resolved');
        return;
      }

      if (target.type === 'qq') {
        await ensureQQForegroundSimple();

        // 先尝试 qq-focus-paste.exe（可选）
        try { await ctx.clipboard.runQqFocusPaste('paste'); } catch {}

        // 再做输入框聚焦兜底
        await focusQQInputFallback();
        await state.sleep(60);

        doCtrlV();
      } else {
        // 微信/企业微信：关键是要先确保微信在前台
        await ensureWeChatForegroundSimple(target);
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

  // ===== phrase:paste-send (双击粘贴+发送) =====
  ipcMain.on('phrase:paste-send', async (_e, text) => {
    if (!text) return;
    if (!canStartInsert()) return;

    try {
      clipboard.writeText(String(text));

      const target = getBestChatTarget();
      if (!target || !target.type) {
        console.warn('[phrase] no chat target resolved');
        return;
      }

      if (target.type === 'qq') {
        await ensureQQForegroundSimple();

        // 先尝试 qq-focus-paste.exe（可能已完成 paste+send）
        try { await ctx.clipboard.runQqFocusPaste('paste-send'); } catch {}

        // 保持旧版“宁可重复也要成功”的兜底：Ctrl+V + Enter
        await focusQQInputFallback();
        await state.sleep(60);

        doCtrlV();
        await state.sleep(110);
        doEnter();
      } else {
        // 微信/企业微信：先确保前台，再 Ctrl+V + Enter
        await ensureWeChatForegroundSimple(target);
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

  // ===== emoji paste =====
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

    const target = getBestChatTarget();
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
      else await ensureWeChatForegroundSimple(target);

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
            else await ensureWeChatForegroundSimple(target);

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
      else await ensureWeChatForegroundSimple(target);

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