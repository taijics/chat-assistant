(function () {
  let ipcRenderer = null;
  try { ({ ipcRenderer } = require('electron')); } catch {}

  function bind() {
    window.addEventListener('keydown', (e) => {
      // Alt + D
      if (e.altKey && !e.ctrlKey && !e.shiftKey && String(e.key || '').toLowerCase() === 'd') {
        e.preventDefault();
        try { ipcRenderer && ipcRenderer.send('settings:devtools-toggle'); } catch {}
      }
    });
  }

  if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', bind);
  else bind();
})();