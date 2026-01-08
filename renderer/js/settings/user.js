(function () {
  const { $ } = window.SettingsDOM;

  function fillUserInfo() {
    try {
      const u = (window.API && API.getUser && API.getUser()) || null;
      const token = (window.API && API.getToken && API.getToken()) || '';
      const title = $('#st-user-title');
      const sub = $('#st-user-sub');

      if (!title || !sub) return;

      if (token && u) {
        title.textContent = u.phone || u.username || u.name || '已登录';
        sub.textContent = '登录有效，可进行充值/设置';
      } else {
        title.textContent = '未登录';
        sub.textContent = '请先在主界面登录';
      }
    } catch {}
  }

  window.SettingsUser = { fillUserInfo };
})();