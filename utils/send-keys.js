const { exec } = require('child_process');

function sendCtrlV() {
  // 依赖 Windows 的 WScript.Shell.SendKeys，把 ^v 发送给当前前台窗口
  const cmd = 'powershell -NoProfile -WindowStyle Hidden -Command "$ws=New-Object -ComObject WScript.Shell; $ws.SendKeys(\'^v\')"';
  exec(cmd, { windowsHide: true });
}

function sendEnter() {
  const cmd = 'powershell -NoProfile -WindowStyle Hidden -Command "$ws=New-Object -ComObject WScript.Shell; $ws.SendKeys(\'{ENTER}\')"';
  exec(cmd, { windowsHide: true });
}

module.exports = { sendCtrlV, sendEnter };