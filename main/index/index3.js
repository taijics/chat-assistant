
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
