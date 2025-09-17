const { ipcRenderer } = require('electron');
document.getElementById('mini-container').onclick = () => {
  ipcRenderer.send('restore-main-window');
};