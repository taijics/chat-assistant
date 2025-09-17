const ffi = require('ffi-napi');
const ref = require('ref-napi');

const user32 = ffi.Library('user32', {
  SetWindowPos: ['bool', ['pointer', 'pointer', 'int', 'int', 'int', 'int', 'uint']],
});

const SWP_NOSIZE = 0x0001;
const SWP_NOMOVE = 0x0002;
const SWP_NOACTIVATE = 0x0010;
const SWP_NOOWNERZORDER = 0x0200;
const SWP_NOSENDCHANGING = 0x0400;

const COMMON_FLAGS = SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE | SWP_NOOWNERZORDER | SWP_NOSENDCHANGING;

function ptrFromHandle(h) {
  if (!h) return ref.NULL;
  if (Buffer.isBuffer(h)) return h;
  const buf = Buffer.alloc(ref.sizeof.pointer);
  if (typeof h === 'number') {
    if (ref.sizeof.pointer === 8) {
      buf.writeBigUInt64LE(BigInt(h));
    } else {
      buf.writeUInt32LE(h);
    }
    return buf;
  }
  return ref.NULL;
}

function placeAfterWeChat(assistHandle, wechatHandle) {
  const aPtr = ptrFromHandle(assistHandle);
  const wPtr = ptrFromHandle(wechatHandle);
  if (aPtr.isNull() || wPtr.isNull()) return false;
  try {
    return user32.SetWindowPos(aPtr, wPtr, 0, 0, 0, 0, COMMON_FLAGS);
  } catch (e) {
    return false;
  }
}

module.exports = { placeAfterWeChat };