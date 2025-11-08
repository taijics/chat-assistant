// 运行在子进程：包装 ../wechatMonitor
const path = require('path');

let wm = null;
function loadMonitor() {
  if (wm) return;
  const tryPaths = [
    '../wechatMonitor',
    '../../wechatMonitor',
    '../utils/wechatMonitor',
    '../../utils/wechatMonitor',
    '../wechat/wechatMonitor',
    '../../wechat/wechatMonitor'
  ];
  for (const p of tryPaths) {
    try {
      wm = require(path.join(__dirname, p));
      process.send && process.send({ kind: 'log', text: `[child] wechatMonitor resolved: ${p}` });
      return;
    } catch (e) {}
  }
  wm = { start: () => {}, stop: () => {}, setZOrder: () => {} };
  process.send && process.send({ kind: 'log', text: '[child] wechatMonitor stubbed' });
}

let started = false;

process.on('message', (msg) => {
  if (!msg || !msg.cmd) return;
  try {
    if (msg.cmd === 'start') {
      loadMonitor();
      if (started) return;
      const cbWrapped = (evt) => {
        try { process.send && process.send({ kind: 'evt', evt }); } catch {}
      };
      wm.start(msg.opts || {}, cbWrapped);
      started = true;
      process.send && process.send({ kind: 'log', text: '[child] started' });
    } else if (msg.cmd === 'stop') {
      if (!started) return;
      try { wm.stop && wm.stop(); } catch {}
      started = false;
      process.send && process.send({ kind: 'log', text: '[child] stopped' });
    } else if (msg.cmd === 'setZOrder') {
      loadMonitor();
      const handle = msg.handle && Buffer.isBuffer(msg.handle)
        ? msg.handle
        : (msg.handle && msg.handle.type === 'Buffer' ? Buffer.from(msg.handle.data || []) : null);
      try { wm.setZOrder && handle && wm.setZOrder(handle, msg.hwnd, msg.chatType); } catch {}
    }
  } catch (e) {
    process.send && process.send({ kind: 'err', err: e && (e.stack || e.message || String(e)) });
  }
});

process.on('uncaughtException', (e) => {
  try { process.send && process.send({ kind: 'err', err: e && (e.stack || e.message || String(e)) }); } catch {}
});
process.on('unhandledRejection', (r) => {
  try { process.send && process.send({ kind: 'err', err: r && (r.stack || r.message || String(r)) }); } catch {}
});