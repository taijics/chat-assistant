(function() {
  function bind() {
    const accEl = document.getElementById('footer-account');
    if (accEl) {
      accEl.addEventListener('click', async () => {
        const token = (window.API && API.getToken && API.getToken()) || '';
        const user = (window.API && API.getUser && API.getUser()) || null;

        if (token && user) {
          AuthUI.showConfirmModal('确定退出登录吗？', async () => {
            try {
              await API.auth.logout({
                clearLocal: true
              });
            } catch (e) {}
            AuthService.updateFooterAuthUI();
            try {
              localStorage.removeItem(AuthConst.LS_REMEMBER);
              localStorage.removeItem(AuthConst.LS_REMEMBER_ACCOUNT);
              localStorage.removeItem(AuthConst.LS_REMEMBER_TOKEN);
              localStorage.removeItem('auth.vipExpireTime');
            } catch {}
            window.dispatchEvent(new CustomEvent('auth:logout'));
          });
        } else {
          AuthUI.showLoginModal();
        }
      });
    }

    AuthService.updateFooterAuthUI();

    // 自动恢复
    AuthService.tryRestoreRememberedLogin({
      onNeedLogin: () => {
        try {
          if (localStorage.getItem(AuthConst.LS_NEEDS_LOGIN) === '1') {
            localStorage.removeItem(AuthConst.LS_NEEDS_LOGIN);
            AuthUI.showLoginModal();
          }
        } catch {}
      }
    });

    // 401 -> 弹窗
    window.addEventListener('auth:login-required', () => {
      try {
        localStorage.removeItem(AuthConst.LS_REMEMBER_TOKEN);
      } catch {}
      AuthUI.showLoginModal();
    });
  }

  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})();