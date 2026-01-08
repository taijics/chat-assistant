(function () {
  function bind() {
    const btn = document.getElementById('footer-vip');
    if (!btn) return;

    let ipcRenderer = null;
    try { ({ ipcRenderer } = require('electron')); } catch {}

    btn.addEventListener('click', () => {
      console.log('[VIP] click');
      if (!ipcRenderer) return;
      try { ipcRenderer.send('vip:open-settings'); } catch {}
    });
  }

  if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', bind);
  else bind();
})();