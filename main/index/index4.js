

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