(function () {
  const { $, escapeHtml, showToast } = window.SettingsDOM;

  function getVipExpireTime() {
    try { return (window.AuthVip?.getVipExpireTime?.()) || ''; } catch { return ''; }
  }
  function isVipExpired() {
    try { return !!(window.AuthVip?.isVipExpired?.()); } catch { return true; }
  }

  function renderVipStatus() {
    const exp = getVipExpireTime();
    const expEl = $('#vip-expire');
    const stEl = $('#vip-status');

    if (expEl) expEl.textContent = exp ? String(exp) : '-';

    const expired = exp ? isVipExpired() : true;
    const statusText = exp ? (expired ? '已过期' : '有效') : '未开通/未知';

    if (stEl) {
      stEl.textContent = statusText;
      stEl.style.color = expired ? '#e02424' : '#059669';
    }
  }

  function readAmount(pkg) {
    const v = pkg?.amount ?? pkg?.price ?? pkg?.金额;
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }

  async function loadVipPackages() {
    const tbody = $('#vip-packages');
    if (!tbody) return;

    const token = (window.API && API.getToken && API.getToken()) || '';
    if (!token) {
      tbody.innerHTML = `<tr><td colspan="4" class="muted">请先在主界面登录后再充值。</td></tr>`;
      return;
    }

    tbody.innerHTML = `<tr><td colspan="4" class="muted">加载中...</td></tr>`;

    try {
      const resp = await API.get('/api/front/vip/vipPackagelist');
      const ok = resp && (resp.status === 'success' || resp.status === '成功');
      const list = (ok && Array.isArray(resp.data)) ? resp.data : [];

      if (!list.length) {
        tbody.innerHTML = `<tr><td colspan="4" class="muted">暂无套餐</td></tr>`;
        return;
      }

      // 先把 list 缓存到 DOM 上，点击时再取（避免把整对象塞到 data- 属性里）
      tbody.__vipList = list;

      tbody.innerHTML = list.map((pkg, idx) => {
        const title = pkg.title || 'VIP 套餐';
        const days = pkg.days ?? pkg.day ?? pkg.天数 ?? '-';
        const amount = readAmount(pkg);

        return `
          <tr>
            <td>${escapeHtml(String(title))}</td>
            <td>${escapeHtml(String(days))}</td>
            <td>${escapeHtml(String(amount.toFixed ? amount.toFixed(2) : amount))}</td>
            <td><button class="btn ghost" data-detail="${idx}">详情</button></td>
          </tr>
        `;
      }).join('');

      tbody.querySelectorAll('button[data-detail]').forEach(btn => {
        btn.addEventListener('click', () => {
          const i = Number(btn.getAttribute('data-detail'));
          const pkg = (tbody.__vipList && tbody.__vipList[i]) ? tbody.__vipList[i] : null;
          if (!pkg) return;

          if (window.PackageModal?.open) window.PackageModal.open(pkg);
          else showToast('详情弹窗未加载（package-modal.js）', { type: 'error', duration: 1500 });
        });
      });
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="4" class="muted">加载失败：${escapeHtml(e.message || 'error')}</td></tr>`;
    }
  }

  function bindVip() {
    // 你之前旧的 vip-pay-card 已经不需要了，可以不绑定
  }

  window.SettingsVIP = { renderVipStatus, loadVipPackages, bindVip };
})();