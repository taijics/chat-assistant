const fs = require('fs');
const os = require('os');
const path = require('path');
const { URL } = require('url');

function initClipboard(ctx) {
  const { deps, state } = ctx;
  const { app } = deps.electronApp;
  const { nativeImage, clipboard } = deps.electron;

  function ensureGifStoreDir() {
    try {
      fs.mkdirSync(state.gifStoreDir, { recursive: true });
      const testFile = path.join(state.gifStoreDir, '__test_' + Date.now() + '.tmp');
      fs.writeFileSync(testFile, 'ok');
      fs.unlinkSync(testFile);
      return state.gifStoreDir;
    } catch (e) {
      console.warn('[gif-cache] primary dir fail -> fallback tmp:', e.message);
      state.gifStoreDir = path.join(os.tmpdir(), 'chat-assistant-gif-cache');
      try { fs.mkdirSync(state.gifStoreDir, { recursive: true }); } catch {}
      return state.gifStoreDir;
    }
  }

  function locateFileDropHelper() {
    try {
      if (app.isPackaged) {
        const p1 = path.join(process.resourcesPath, 'set-clipboard-files.exe');
        if (fs.existsSync(p1)) return p1;
        const p2 = path.join(process.resourcesPath, 'app.asar.unpacked', 'main', 'set-clipboard-files.exe');
        if (fs.existsSync(p2)) return p2;
        const p3 = path.join(process.resourcesPath, 'extra', 'set-clipboard-files.exe');
        if (fs.existsSync(p3)) return p3;
        return null;
      } else {
        const local = path.join(__dirname, '..', 'set-clipboard-files.exe');
        if (fs.existsSync(local)) return local;
        return null;
      }
    } catch (e) {
      console.warn('[filedrop] locate helper fail:', e.message);
      return null;
    }
  }

  function findCscForFileDrop() {
    const { spawnSync } = require('child_process');
    const candidates = [
      'csc',
      'C:\\Program Files (x86)\\Microsoft Visual Studio\\2022\\BuildTools\\MSBuild\\Current\\Bin\\Roslyn\\csc.exe',
      'C:\\Program Files\\Microsoft Visual Studio\\2022\\Community\\MSBuild\\Current\\Bin\\Roslyn\\csc.exe',
      'C:\\Program Files (x86)\\Microsoft Visual Studio\\2019\\BuildTools\\MSBuild\\Current\\Bin\\Roslyn\\csc.exe'
    ];
    for (const p of candidates) {
      try {
        if (p === 'csc') {
          const trial = spawnSync('csc', ['/nologo'], { windowsHide: true });
          if (trial.status === 0 || trial.stderr) return 'csc';
        } else if (fs.existsSync(p)) return p;
      } catch {}
    }
    return null;
  }

  function ensureFileDropHelperReady() {
    const { spawnSync } = require('child_process');
    state.fileDropHelperPath = locateFileDropHelper();
    if (app.isPackaged) return !!state.fileDropHelperPath;
    if (state.fileDropHelperPath) return true;

    const src = path.join(__dirname, '..', 'set-clipboard-files.cs');
    if (!fs.existsSync(src)) return false;
    const csc = findCscForFileDrop();
    if (!csc) {
      console.warn('[filedrop] csc not found (dev compile skipped)');
      return false;
    }
    const out = path.join(__dirname, '..', 'set-clipboard-files.exe');
    const r = spawnSync(csc, ['/nologo', '/optimize+', '/platform:x64', '/out:' + out, src], { windowsHide: true, encoding: 'utf8' });
    if (r.status === 0 && fs.existsSync(out)) {
      state.fileDropHelperPath = out;
      return true;
    }
    return false;
  }

  function setClipboardFiles(pathsArr) {
    const { spawnSync } = require('child_process');
    if (!Array.isArray(pathsArr) || !pathsArr.length) return false;
    if (!ensureFileDropHelperReady()) return false;
    try {
      const res = spawnSync(state.fileDropHelperPath, pathsArr, { windowsHide: true, encoding: 'utf8' });
      return res.status === 0;
    } catch (e) {
      console.warn('[filedrop] exec error:', e.message);
      return false;
    }
  }

  // ===== qq-focus-paste.exe =====
  function locateQqFocusHelper() {
    try {
      if (app.isPackaged) {
        const p1 = path.join(process.resourcesPath, 'qq-focus-paste.exe');
        if (fs.existsSync(p1)) return p1;
        const p2 = path.join(process.resourcesPath, 'app.asar.unpacked', 'main', 'qq-focus-paste.exe');
        if (fs.existsSync(p2)) return p2;
        const p3 = path.join(process.resourcesPath, 'extra', 'qq-focus-paste.exe');
        if (fs.existsSync(p3)) return p3;
        return null;
      } else {
        const local = path.join(__dirname, '..', 'qq-focus-paste.exe');
        if (fs.existsSync(local)) return local;
        return null;
      }
    } catch (e) {
      console.warn('[qqpaste] locate helper fail:', e.message);
      return null;
    }
  }

  function ensureQqFocusHelperReady() {
    if (state.qqFocusHelperPath && fs.existsSync(state.qqFocusHelperPath)) return true;
    state.qqFocusHelperPath = locateQqFocusHelper();
    console.log('[qqpaste] helper path:', state.qqFocusHelperPath || '(missing)');
    return !!state.qqFocusHelperPath;
  }

  function runQqFocusPaste(mode) {
    if (!ensureQqFocusHelperReady()) {
      console.warn('[qqpaste] helper missing');
      return false;
    }
    try {
      const { spawn } = require('child_process');
      return new Promise((resolve) => {
        let resolved = false;
        const proc = spawn(state.qqFocusHelperPath, [String(mode || 'paste')], { windowsHide: true });
        const timer = setTimeout(() => {
          if (!resolved) {
            resolved = true;
            try { proc.kill('SIGTERM'); } catch {}
            console.warn('[qqpaste] timeout -> fallback');
            resolve(false);
          }
        }, 180);
        proc.on('exit', (code) => {
          if (resolved) return;
          resolved = true;
          clearTimeout(timer);
          resolve(code === 0);
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

  // ===== image clipboard =====
  function detectImageExtByMagic(buf) {
    if (!buf || buf.length < 12) return '';
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return 'png';
    if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return 'jpg';
    if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return 'gif';
    if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
        buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return 'webp';
    if (buf[0] === 0x42 && buf[1] === 0x4D) return 'bmp';
    return '';
  }

  function downloadWithRedirect(url, depth = 0) {
    return new Promise((resolve, reject) => {
      if (depth > 5) return reject(new Error('Too many redirects'));
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
          if ([301,302,303,307,308].includes(res.statusCode)) {
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
            let ext = '';
            if (/png/.test(ct)) ext = '.png';
            else if (/jpe?g/.test(ct)) ext = '.jpg';
            else if (/gif/.test(ct)) ext = '.gif';
            else if (/webp/.test(ct)) ext = '.webp';
            else if (/bmp/.test(ct)) ext = '.bmp';
            else if (/svg/.test(ct)) ext = '.svg';
            resolve({ buffer: buf, ext });
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
    const finalExt = normExt === 'jpeg' ? 'jpg' : normExt || 'png';
    const tmpPath = path.join(tmpDir, 'emoji_' + Date.now() + '_' + Math.random().toString(16).slice(2) + '.' + finalExt);
    try { fs.writeFileSync(tmpPath, buffer); } catch {}

    let img = nativeImage.createFromPath(tmpPath);
    if (!img || (img.isEmpty && img.isEmpty())) img = nativeImage.createFromBuffer(buffer);

    if (img && !(img.isEmpty && img.isEmpty())) {
      clipboard.writeImage(img);
      return { type: 'image', path: tmpPath, ext: finalExt };
    }

    try {
      const sharp = require('sharp');
      const pngBuf = await sharp(buffer).png().toBuffer();
      const pngPath = path.join(tmpDir, 'emoji_' + Date.now() + '_' + Math.random().toString(16).slice(2) + '.png');
      fs.writeFileSync(pngPath, pngBuf);
      let pngImg = nativeImage.createFromPath(pngPath);
      if (!pngImg || (pngImg.isEmpty && pngImg.isEmpty())) pngImg = nativeImage.createFromBuffer(pngBuf);
      if (pngImg && !(pngImg.isEmpty && pngImg.isEmpty())) {
        clipboard.writeImage(pngImg);
        return { type: 'image', path: pngPath, ext: 'png', converted: true };
      }
    } catch (e) {
      console.warn('[ensureImageInClipboard] PNG convert fail:', e.message);
    }

    return { type: 'fail' };
  }

  function isRemoteImage(src) {
    return /^https?:\/\//i.test(src);
  }
  function normalizeLocalPath(p) {
    return /^file:\/\//i.test(p) ? decodeURI(p.replace(/^file:\/+/, '')) : p;
  }
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

  async function putImageToClipboard(src) {
    try {
      if (isRemoteImage(src)) {
        const result = await downloadWithRedirect(src).catch(() => null);
        if (!result || !result.buffer || result.buffer.length < 64) return { type: 'fallback-static', reason: 'download-fail' };

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
          let fname = sanitizeFilename(safeRandomGifName());
          let full = path.join(state.gifStoreDir, fname);
          try {
            fs.writeFileSync(full, result.buffer);
            return { type: 'gif-file', path: full, animated: true };
          } catch (e1) {
            try {
              const tmpFull = path.join(os.tmpdir(), safeRandomGifName());
              fs.writeFileSync(tmpFull, result.buffer);
              return { type: 'gif-file', path: tmpFull, animated: true };
            } catch {
              return { type: 'fallback-static', reason: 'gif-write-fail' };
            }
          }
        }

        const placed = await ensureImageInClipboard(result.buffer, ext);
        if (placed.type === 'image') return placed;
        clipboard.writeText(src);
        return { type: 'text' };
      }

      // local
      const local = normalizeLocalPath(src);
      if (!local || !fs.existsSync(local)) return { type: 'fail' };
      const ext = (local.match(/\.(png|jpe?g|gif|webp|bmp)$/i)?.[1] || '').toLowerCase();

      if (ext === 'gif') return { type: 'gif-file', path: local, animated: true };

      let buf = null;
      try { buf = fs.readFileSync(local); } catch {}
      if (buf && buf.length > 64) {
        const realExt = ext || detectImageExtByMagic(buf) || 'png';
        const placed = await ensureImageInClipboard(buf, realExt);
        if (placed.type === 'image') return placed;
      }

      const img = nativeImage.createFromPath(local);
      if (img && !(img.isEmpty && img.isEmpty())) {
        clipboard.writeImage(img);
        return { type: 'image', path: local };
      }
      return { type: 'fail' };
    } catch (e) {
      return { type: 'fail' };
    }
  }

  ctx.clipboard = {
    ensureGifStoreDir,
    ensureFileDropHelperReady,
    setClipboardFiles,
    runQqFocusPaste,
    downloadWithRedirect,
    ensureImageInClipboard,
    putImageToClipboard,
  };
}

module.exports = { initClipboard };