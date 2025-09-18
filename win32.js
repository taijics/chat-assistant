const ffi = require('ffi-napi');
const ref = require('ref-napi');

// Win32: BOOL SetWindowPos(HWND hWnd, HWND hWndInsertAfter, int X,int Y,int cx,int cy, UINT uFlags);
const user32 = ffi.Library('user32', {
  SetWindowPos: ['bool', ['pointer', 'pointer', 'int', 'int', 'int', 'int', 'uint']],
  IsIconic: ['bool', ['pointer']] // 判断是否最小化
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

/**
 * 把 assistant 插到 wechat 窗口“上方紧邻”位置。
 * 注意：hWndInsertAfter = wechatHandle => 结果是 assistant 位于微信之上（高一层），
 * 如果微信整体被其它窗口遮挡，assistant 同样也被遮挡，不会超越最上层窗口。
 */
function placeAboveWeChat(assistantHandleBuf, wechatHandleNumeric) {
  const aPtr = ptrFromHandle(assistantHandleBuf);
  const wPtr = ptrFromHandle(wechatHandleNumeric);
  if (aPtr.isNull() || wPtr.isNull()) return false;
  try {
    return user32.SetWindowPos(aPtr, wPtr, 0, 0, 0, 0, COMMON_FLAGS);
  } catch {
    return false;
  }
}

/**
 * 判断窗口是否最小化
 */
function isMinimized(wechatHandleNumeric) {
  const wPtr = ptrFromHandle(wechatHandleNumeric);
  if (wPtr.isNull()) return false;
  try {
    return user32.IsIconic(wPtr);
  } catch {
    return false;
  }
}

module.exports = {
  placeAboveWeChat,
  isMinimized
};