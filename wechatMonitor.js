// 直接加载编译出的原生模块
const native = require('./build/Release/wechat_monitor.node');

function start(options, handler) {
  if (!options || !Array.isArray(options.keywords)) {
    throw new Error('options.keywords must be an array of strings');
  }
  if (typeof handler !== 'function') {
    throw new Error('handler must be a function');
  }
  native.start({ keywords: options.keywords }, handler);
}

function stop() {
  try { native.stop(); } catch {}
}

function isRunning() {
  try { return native.isRunning(); } catch { return false; }
}

function setZOrder(assistantHandleBuffer, wechatHandleNumber) {
  return native.setZOrder(assistantHandleBuffer, wechatHandleNumber);
}

module.exports = { start, stop, isRunning, setZOrder };