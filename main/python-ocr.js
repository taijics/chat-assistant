// 与之前一致：打包后跑 resources/py/wechat_ocr.exe；开发期用 python 跑源码
const { app, ipcMain } = require('electron');
const { spawn, exec } = require('child_process');
const path = require('path');
const net = require('net');

let ocrProc = null;
const DEFAULT_PORT = Number(process.env.OCR_PORT || 5678);

function waitPort(port, { timeoutMs = 15000, intervalMs = 300 } = {}) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const socket = net.connect(port, '127.0.0.1');
      let done = false;
      socket.on('connect', () => { done = true; socket.end(); resolve(true); });
      socket.on('error', () => {
        socket.destroy();
        if (Date.now() - started > timeoutMs) return reject(new Error(`OCR port ${port} not ready`));
        setTimeout(tryOnce, intervalMs);
      });
      setTimeout(() => { if (!done) { try { socket.destroy(); } catch {} } }, 1000);
    };
    tryOnce();
  });
}

function resolveOcrBinary() {
  if (app.isPackaged) return path.join(process.resourcesPath, 'py', 'wechat_ocr.exe');
  return null;
}

async function start() {
  if (ocrProc && !ocrProc.killed) return true;
  const env = { ...process.env, OCR_PORT: String(DEFAULT_PORT) };
  const bin = resolveOcrBinary();

  if (bin) {
    ocrProc = spawn(bin, [], { env, windowsHide: true, cwd: path.dirname(bin) });
    console.log('[ocr] spawn exe:', bin);
  } else {
    const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
    const script = path.resolve(__dirname, '../py/new_wechat_ocr_baidu.py');
    ocrProc = spawn(pythonCmd, [script], { env, windowsHide: true, cwd: path.dirname(script) });
    console.log('[ocr] spawn dev python:', pythonCmd, script);
  }

  ocrProc.stdout?.on('data', b => console.log('[ocr]', String(b)));
  ocrProc.stderr?.on('data', b => console.warn('[ocr:err]', String(b)));
  ocrProc.on('exit', (code, signal) => { console.log('[ocr] exited', { code, signal }); ocrProc = null; });

  await waitPort(DEFAULT_PORT, { timeoutMs: 20000 });
  console.log('[ocr] ready at http://127.0.0.1:' + DEFAULT_PORT);
  return true;
}

async function stop() {
  if (!ocrProc) return;
  try {
    if (process.platform === 'win32') exec(`taskkill /pid ${ocrProc.pid} /T /F`, () => {});
    else {
      ocrProc.kill('SIGTERM');
      setTimeout(() => { try { ocrProc.kill('SIGKILL'); } catch {} }, 2000);
    }
  } catch {}
  ocrProc = null;
}

function registerIpc() {
  ipcMain.handle('ocr:is-alive', async () => {
    try { await waitPort(DEFAULT_PORT, { timeoutMs: 600, intervalMs: 200 }); return { ok: true, port: DEFAULT_PORT }; }
    catch { return { ok: false, port: DEFAULT_PORT }; }
  });
  ipcMain.handle('ocr:get-url', () => ({ url: `http://127.0.0.1:${DEFAULT_PORT}` }));
}

module.exports = { start, stop, registerIpc };