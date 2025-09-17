const { ipcRenderer } = require('electron');

document.getElementById('min-btn').onclick = () => {
  ipcRenderer.send('close-main-window'); // 最小化（显示迷你窗口）
};

document.getElementById('close-btn').onclick = () => {
  ipcRenderer.send('exit-app'); // 退出程序
};