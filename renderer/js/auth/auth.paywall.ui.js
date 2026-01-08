(function () {
  let visible = false;

  function showPaywallModal({ reason = 'VIP到期，请续费', onOpenExternal } = {}) {
    if (visible) return;
    visible = true;

    window.AuthStyles && AuthStyles.ensure && AuthStyles.ensure();

    const mask = document.createElement('div');
    mask.className = 'auth-mask';
    mask.id = 'vip-paywall-modal';
    mask.innerHTML = `
      <div class="auth-dialog auth-dialog-wrap" role="dialog" aria-modal="true" style="width:460px;height:auto;">
        <button id="vip-paywall-close" class="auth-close" type="button">×</button>
        <div class="auth-title" style="font-size:18px;margin-bottom:12px;">VIP 充值</div>
        <div style="color:#444;font-size:14px;line-height:1.6;margin-bottom:14px;">
          ${reason}
        </div>
        <div style="display:flex;gap:10px;justify-content:flex-end;">
          <button id="vip-paywall-cancel" class="auth-main-btn" style="height:36px;width:auto;padding:0 18px;background:#f2f3f5;color:#333;box-shadow:none;">取消</button>
          <button id="vip-paywall-ok" class="auth-main-btn" style="height:36px;width:auto;padding:0 18px;">去充值</button>
        </div>
      </div>
    `;
    document.body.appendChild(mask);

    const close = () => {
      try { mask.remove(); } catch {}
      visible = false;
    };

    mask.querySelector('#vip-paywall-close')?.addEventListener('click', close);
    mask.querySelector('#vip-paywall-cancel')?.addEventListener('click', close);
    mask.addEventListener('click', (e) => { if (e.target === mask) close(); });

    mask.querySelector('#vip-paywall-ok')?.addEventListener('click', () => {
      close();
      // 你可以：
      // 1) 打开内置 models-area 某个充值页
      // 2) 或者在系统浏览器打开充值 URL
      if (typeof onOpenExternal === 'function') onOpenExternal();
      else {
        // 默认行为：打开你们官网/充值地址（你换成真实 URL）
        try {
          const { shell } = require('electron');
          shell.openExternal('https://back.aiweiban.cn'); // TODO: 替换为充值页面
        } catch {}
      }
    });
  }

  window.PaywallUI = { showPaywallModal };
})();