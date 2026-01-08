(function () {
  const { $ , showToast } = window.SettingsDOM;

  function fillApiBaseUrl() {
    const inp = $('#api-baseurl');
    if (!inp) return;
    try {
      inp.value = (window.API && API.getBaseURL && API.getBaseURL()) || '';
    } catch {
      inp.value = '';
    }
  }

  function bindApiBaseUrl() {
    $('#api-save')?.addEventListener('click', () => {
      const inp = $('#api-baseurl');
      const v = (inp?.value || '').trim();
      try {
        window.API && API.setBaseURL && API.setBaseURL(v);
        showToast('已保存', { type: 'success', duration: 1200 });
      } catch {
        showToast('保存失败', { type: 'error', duration: 1200 });
      }
    });

    $('#api-reset')?.addEventListener('click', () => {
      try {
        window.API && API.setBaseURL && API.setBaseURL('');
        fillApiBaseUrl();
        showToast('已恢复默认', { type: 'success', duration: 1200 });
      } catch {
        showToast('操作失败', { type: 'error', duration: 1200 });
      }
    });
  }

  window.SettingsAPI = { fillApiBaseUrl, bindApiBaseUrl };
})();