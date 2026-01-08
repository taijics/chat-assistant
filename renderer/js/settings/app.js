(function() {
  const {
    $,
    $all,
    showToast
  } = window.SettingsDOM;
  const pages = window.SettingsPages.getPages();

  function setTitle(t) {
    const el = $('#st-page-title');
    if (el) el.textContent = t || '';
  }

  function switchPage(name) {
    Object.keys(pages).forEach((k) => {
      const el = pages[k].el || (pages[k].el = document.getElementById('page-' + k));
      if (el) el.style.display = (k === name) ? '' : 'none';
    });

    setTitle(pages[name]?.title || '');

    $all('.st-nav-item').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.page === name);
    });

    if (name === 'vip') {
      window.SettingsVIP.renderVipStatus();
      window.SettingsVIP.loadVipPackages();
    }
    if (name === 'api') {
      window.SettingsAPI.fillApiBaseUrl();
    }
    // 在 switchPage(name) 里加上：
    if (name === 'agent') {
      window.SettingsAgent?.load?.();
    }
  }

  function bindNav() {
    $('#st-nav')?.addEventListener('click', (e) => {
      const btn = e.target.closest('.st-nav-item');
      if (!btn) return;
      const page = btn.dataset.page;
      if (!page || !pages[page]) return;
      switchPage(page);
    });
  }

  function bindTopbar() {
    $('#st-close')?.addEventListener('click', () => window.close());
    $('#st-refresh')?.addEventListener('click', () => {
      const active = document.querySelector('.st-nav-item.active')?.dataset?.page || 'vip';
      switchPage(active);
      showToast('已刷新', {
        type: 'success',
        duration: 900
      });
    });
  }

  function init() {
    bindNav();
    bindTopbar();

    window.SettingsAPI.bindApiBaseUrl();
    window.SettingsVIP.bindVip();
    window.SettingsUser.fillUserInfo();

    switchPage('vip');
  }

  if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', init);
  else init();

  window.SettingsApp = {
    switchPage
  };
})();