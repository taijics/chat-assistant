

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