// 自定义右侧缩放（与 frame:true 兼容，不依赖系统边框）
const { ipcRenderer } = require('electron');

(function () {
  const handle = document.getElementById('edge-resizer-right');
  if (!handle) return;

  let dragging = false;
  let startX = 0;
  let startW = 0;
  let raf = 0;

  const onMouseMove = (e) => {
    if (!dragging) return;
    const dx = e.screenX - startX;
    const newW = Math.round(startW + dx);
    if (!raf) {
      raf = requestAnimationFrame(() => {
        raf = 0;
        ipcRenderer.send('window:resize-width', newW);
      });
    }
  };

  const onMouseUp = () => {
    if (!dragging) return;
    dragging = false;
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
  };

  handle.addEventListener('mousedown', async (e) => {
    if (e.button !== 0) return; // 左键
    e.preventDefault();
    try {
      const b = await ipcRenderer.invoke('window:get-bounds');
      if (!b) return;
      dragging = true;
      startX = e.screenX;
      startW = b.width;
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    } catch {}
  });
})();