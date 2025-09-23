(function() {
  const {
    ipcRenderer
  } = require('electron');
  const handle = document.getElementById('edge-resizer-right');
  if (!handle) return;

  // 必须让拖动条高度覆盖整个窗口右侧
  handle.style.position = 'fixed';
  handle.style.top = '0';
  handle.style.right = '0';
  handle.style.width = '8px';
  handle.style.height = '100%';
  handle.style.cursor = 'ew-resize';
  handle.style.zIndex = '9999';
  // handle.style.background = 'rgba(255,0,0,0.08)'; //开发测试可取消注释

  let dragging = false;
  let startX = 0;
  let startW = 0;

  // 前端也做宽度限制，与主进程保持一致
  const MIN_W = 260,
    MAX_W = 1400;

  function clampWidth(w) {
    return Math.max(MIN_W, Math.min(MAX_W, w));
  }

  function onMouseMove(e) {
    if (!dragging) return;
    // 用clientX更稳妥
    const dx = e.clientX - startX;
    const newW = clampWidth(startW + dx);
    ipcRenderer.send('window:resize-width', newW);
  }

  function onMouseUp() {
    if (!dragging) return;
    dragging = false;
    document.body.style.cursor = '';
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
  }

  handle.addEventListener('mousedown', async (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    try {
      const b = await ipcRenderer.invoke('window:get-bounds');
      if (!b) return;
      dragging = true;
      startX = e.clientX;
      startW = b.width;
      document.body.style.cursor = 'ew-resize';
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    } catch {}
  });
})();