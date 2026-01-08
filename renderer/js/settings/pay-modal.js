(function () {
  const { $, showToast } = window.SettingsDOM;

  const modal = () => $('#pay-modal');
  const mask = () => $('#pay-modal-mask');
  const closeBtn = () => $('#pay-modal-close');
  const cancelBtn = () => $('#pay-cancel');

  const loadingEl = () => $('#pay-loading');
  const qrImg = () => $('#pay-qrcode');

  const orderNoEl = () => $('#pay-orderNo');
  const amountEl = () => $('#pay-amount');
  const statusEl = () => $('#pay-status');
  const tipEl = () => $('#pay-tip');

  let _currentOrder = null;
  let _timer = null;
  let _checking = false;
  let _lastState = '';

  function setStatus(text, type) {
    const el = statusEl();
    if (!el) return;
    el.textContent = text || '';
    el.style.borderColor = '';
    el.style.background = '';
    el.style.color = '';

    if (type === 'success') {
      el.style.borderColor = 'rgba(5,150,105,.25)';
      el.style.background = 'rgba(5,150,105,.08)';
      el.style.color = '#057a55';
    }
    if (type === 'warn') {
      el.style.borderColor = 'rgba(234,179,8,.25)';
      el.style.background = 'rgba(234,179,8,.10)';
      el.style.color = '#92400e';
    }
    if (type === 'error') {
      el.style.borderColor = 'rgba(224,36,36,.20)';
      el.style.background = 'rgba(224,36,36,.06)';
      el.style.color = '#b91c1c';
    }
  }

  async function renderQrToImg(codeUrl) {
    const imgContainer = qrImg();
    const loading = loadingEl();
    if (!imgContainer || !loading) return;

    loading.style.display = '';
    imgContainer.style.display = 'none';
    imgContainer.innerHTML = '';

    try {
      if (!window.QRCode) throw new Error('QRCode 库未加载（qrcode.min.js）');

      new window.QRCode(imgContainer, {
        text: String(codeUrl),
        width: 260,
        height: 260,
        colorDark: '#111827',
        colorLight: '#FFFFFF',
        correctLevel: window.QRCode.CorrectLevel.M
      });

      loading.style.display = 'none';
      imgContainer.style.display = '';
    } catch (e) {
      const msg = '二维码生成失败：' + (e?.message || 'error');
      loading.textContent = msg;
      showToast(msg, { type: 'error', duration: 1800 });
      console.error(e);
    }
  }

  function stopPolling() {
    if (_timer) {
      clearInterval(_timer);
      _timer = null;
    }
    _checking = false;
    _lastState = '';
  }

  async function fetchOrderStatus(orderNo) {
    // ✅ 你需要后端提供这个接口
    // 返回：{ status:"success", data:{ tradeState:"NOTPAY|USERPAYING|SUCCESS|PAYERROR|CLOSED|..." } }
    return await API.get('/api/front/vip/order/getStatus?orderNo=' + encodeURIComponent(orderNo));
  }

  function mapState(tradeState) {
    const s = String(tradeState || '').toUpperCase();

    if (s === 'SUCCESS') return { ui: '支付成功', type: 'success' };
    if (s === 'USERPAYING') return { ui: '已扫码，支付中...', type: 'warn' };
    if (s === 'NOTPAY') return { ui: '等待扫码...', type: 'warn' };

    // 失败/关闭类
    if (s === 'PAYERROR') return { ui: '支付失败，请重试', type: 'error' };
    if (s === 'CLOSED') return { ui: '订单已关闭', type: 'error' };
    if (s === 'REVOKED') return { ui: '订单已撤销', type: 'error' };
    if (s === 'REFUND') return { ui: '订单已退款', type: 'error' };

    // 未知状态
    return { ui: '状态：' + s, type: 'warn' };
  }

  async function refreshUserVipAfterSuccess() {
    // ✅ 支付成功后刷新用户信息（到期时间）
    try {
      if (window.API?.auth?.profile) await API.auth.profile({ save: true });
    } catch {}
    try { window.AuthVip?.refresh?.(); } catch {}
    try { window.SettingsVIP?.renderVipStatus?.(); } catch {}
    try { window.SettingsUser?.fillUserInfo?.(); } catch {}
  }

  async function checkOnce() {
    if (!_currentOrder?.orderNo || _checking) return;
    _checking = true;

    try {
      const resp = await fetchOrderStatus(_currentOrder.orderNo);
      const ok = resp && (resp.status === 'success' || resp.status === '成功') && resp.data;

      if (!ok) return;

      const tradeState = resp.data.tradeState || resp.data.trade_state;
      const state = String(tradeState || '').toUpperCase();

      // 状态没变化就不重复刷 UI
      if (state && state !== _lastState) {
        _lastState = state;
        const { ui, type } = mapState(state);
        setStatus(ui, type);
      }

      if (state === 'SUCCESS') {
        stopPolling();
        await refreshUserVipAfterSuccess();
        showToast('支付成功', { type: 'success', duration: 1200 });
        setTimeout(() => close(), 600);
      }

      if (['PAYERROR', 'CLOSED', 'REVOKED'].includes(state)) {
        stopPolling();
        showToast('支付未完成：' + mapState(state).ui, { type: 'error', duration: 1600 });
      }
    } catch (e) {
      // 查询失败不立刻停，避免偶发网络抖动
      console.warn('check status failed:', e);
    } finally {
      _checking = false;
    }
  }

  function startPolling() {
    stopPolling();
    // 立即查一次
    checkOnce();
    // 每 2 秒查一次
    _timer = setInterval(checkOnce, 2000);
    // 可选：3 分钟超时自动停
    setTimeout(() => {
      if (_timer) {
        stopPolling();
        setStatus('二维码已过期，请重新下单', 'error');
      }
    }, 3 * 60 * 1000);
  }

  function open({ orderNo, amount, codeUrl }) {
    _currentOrder = { orderNo, amount, codeUrl };

    const m = modal();
    if (!m) return;

    if (orderNoEl()) orderNoEl().textContent = orderNo || '-';
    if (amountEl()) amountEl().textContent = amount != null ? String(amount) : '-';

    setStatus('等待扫码...', 'warn');
    if (tipEl()) tipEl().textContent = '请使用微信扫一扫';

    m.style.display = '';
    renderQrToImg(codeUrl).catch(() => {});

    // ✅ 开始轮询订单状态
    startPolling();
  }

  function close() {
    stopPolling();
    const m = modal();
    if (!m) return;
    m.style.display = 'none';
    _currentOrder = null;
  }

  function bind() {
    closeBtn()?.addEventListener('click', close);
    cancelBtn()?.addEventListener('click', close);
    mask()?.addEventListener('click', close);

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && modal()?.style.display !== 'none') close();
    });
  }

  if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', bind);
  else bind();

  window.PayModal = { open, close };
})();