(function() {
  function getLS(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  function setLS(key, val) {
    try {
      localStorage.setItem(key, val);
    } catch {}
  }

  function rmLS(key) {
    try {
      localStorage.removeItem(key);
    } catch {}
  }

  function updateFooterAuthUI() {
    const accEl = document.getElementById('footer-account');
    const user = (window.API && API.getUser && API.getUser()) || null;
    const token = (window.API && API.getToken && API.getToken()) || '';
    if (!accEl) return;

    if (token && user) {
      accEl.textContent = user.phone || user.username || user.name || '已登录';
      accEl.title = '点击退出登录';
    } else {
      accEl.textContent = '登录';
      accEl.title = '登录';
    }
  }

  async function afterLoginSuccess({
    remember,
    account,
    vipExpireTime
  } = {}) {
    // 登录成功后拉取 profile，用于页脚显示
    await API.auth.profile({
      save: true
    });

    const C = window.AuthConst;
    try {
      // ✅ 保存 VIP 到期时间（来自登录/注册接口返回）
      if (vipExpireTime) {
        localStorage.setItem('auth.vipExpireTime', String(vipExpireTime));
      }

      if (remember) {
        setLS(C.LS_REMEMBER, '1');
        setLS(C.LS_REMEMBER_ACCOUNT, account || '');
        const tk = API.getToken && API.getToken();
        if (tk) setLS(C.LS_REMEMBER_TOKEN, tk);
      } else {
        rmLS(C.LS_REMEMBER);
        rmLS(C.LS_REMEMBER_ACCOUNT);
        rmLS(C.LS_REMEMBER_TOKEN);
      }
      rmLS(C.LS_NEEDS_LOGIN);
    } catch {}

    window.dispatchEvent(new CustomEvent('auth:login', {
      detail: {
        user: API.getUser && API.getUser()
      }
    }));
    updateFooterAuthUI();
  }

  async function tryRestoreRememberedLogin({
    onNeedLogin
  } = {}) {
    const C = window.AuthConst;
    try {
      const remember = getLS(C.LS_REMEMBER) === '1';
      const savedToken = getLS(C.LS_REMEMBER_TOKEN) || '';
      const hasToken = (API.getToken && API.getToken()) || '';

      if (remember && savedToken && !hasToken) {
        API.setToken && API.setToken(savedToken);
        await API.auth.profile({
          save: true
        });
        updateFooterAuthUI();
        window.dispatchEvent(new CustomEvent('auth:login', {
          detail: {
            user: API.getUser && API.getUser()
          }
        }));
        return true;
      }
    } catch {}

    if (typeof onNeedLogin === 'function') onNeedLogin();
    return false;
  }

  window.AuthService = {
    updateFooterAuthUI,
    afterLoginSuccess,
    tryRestoreRememberedLogin
  };
})();