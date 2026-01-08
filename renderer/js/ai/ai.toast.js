(function () {
  if (window.showToast) return;

  window.showToast = function (msg, { type = 'info', duration = 2000 } = {}) {
    let box = document.getElementById('global-toast-box');
    if (!box) {
      box = document.createElement('div');
      box.id = 'global-toast-box';
      box.style.cssText =
        'position:fixed;bottom:328px;left:50%;transform:translateX(-50%);z-index:10000;display:flex;flex-direction:column;align-items:center;gap:10px;';
      document.body.appendChild(box);
    }
    const item = document.createElement('div');
    item.textContent = msg;
    item.style.cssText = `
      background:${type === 'error' ? '#e02424' : '#333'};
      color:#fff;
      padding:8px 16px;
      border-radius:6px;
      font-size:13px;
      box-shadow:0 4px 16px rgba(0,0,0,.25);
      max-width:320px;
      word-break:break-word;
    `;
    box.appendChild(item);
    setTimeout(() => {
      item.style.opacity = '0';
      item.style.transition = 'opacity .3s';
      setTimeout(() => {
        item.remove();
        if (!box.childElementCount) box.remove();
      }, 320);
    }, duration);
  };
})();