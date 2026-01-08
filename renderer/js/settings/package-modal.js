(function() {
  const {
    $,
    showToast
  } = window.SettingsDOM;

  const modal = () => $('#pkg-modal');
  const mask = () => $('#pkg-modal-mask');
  const closeBtn = () => $('#pkg-modal-close');
  const cancelBtn = () => $('#pkg-cancel');

  const titleEl = () => $('#pkg-title');
  const typeEl = () => $('#pkg-type');
  const daysEl = () => $('#pkg-days');
  const amountEl = () => $('#pkg-amount');
  const msgEl = () => $('#pkg-msg');

  const payWechatBtn = () => $('#pkg-pay-wechat');
  const payAlipayBtn = () => $('#pkg-pay-alipay');

  let _pkg = null;

  function formatAmount(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return '-';
    return n.toFixed(2);
  }

  function pkgTypeText(type) {
    if (Number(type) === 1) return '公司会员';
    if (Number(type) === 2) return '个人会员';
    return '未知类型';
  }

  // ✅ 最小化安全处理：去掉 script、on*、javascript:
  function sanitizeHtml(html) {
    const raw = String(html || '');
    const tpl = document.createElement('template');
    tpl.innerHTML = raw;

    // 1) 删除 script/style/iframe 等危险标签（按需增减）
    tpl.content.querySelectorAll('script, iframe, object, embed').forEach(n => n.remove());

    // 2) 移除所有 onXXX 事件属性
    tpl.content.querySelectorAll('*').forEach(el => {
      [...el.attributes].forEach(attr => {
        const name = attr.name.toLowerCase();
        const val = String(attr.value || '');
        if (name.startsWith('on')) el.removeAttribute(attr.name);
        if ((name === 'href' || name === 'src') && val.trim().toLowerCase().startsWith('javascript:')) {
          el.removeAttribute(attr.name);
        }
      });
    });

    return tpl.innerHTML;
  }

  function open(pkg) {
    _pkg = pkg || null;
    const m = modal();
    if (!m || !_pkg) return;

    if (titleEl()) titleEl().textContent = _pkg.title || '套餐详情';
    if (typeEl()) typeEl().textContent = pkgTypeText(_pkg.type);
    if (daysEl()) daysEl().textContent = `${_pkg.days ?? '-'} 天`;
    if (amountEl()) amountEl().textContent = formatAmount(_pkg.amount);

    // ✅ msg 富文本展示（HTML）
    const html = (_pkg.msg || '').trim();
    if (msgEl()) {
      msgEl().innerHTML = html ? sanitizeHtml(html) : '<span class="muted">暂无介绍</span>';
    }

    m.style.display = '';
  }

  function close() {
    const m = modal();
    if (!m) return;
    m.style.display = 'none';
    _pkg = null;
  }

  async function createWechatOrder() {
    if (!_pkg) return;

    // 0 元不下单
    const amt = Number(_pkg.amount);
    if (Number.isFinite(amt) && amt <= 0) {
      showToast('该套餐为 0 元，无需支付', {
        type: 'success',
        duration: 1200
      });
      return;
    }

    try {
      const resp = await window.SettingsLoading.wrap(async () => {
        return await API.post('/api/front/vip/create', {
          packageId: Number(_pkg.id)
        });
      }, '正在创建订单...');

      const ok = resp && (resp.status === 'success' || resp.status === '成功');
      if (!ok || !resp.data) {
        showToast(resp?.message || '下单失败', {
          type: 'error',
          duration: 1500
        });
        return;
      }
      // ✅ 下单成功提示
      showToast('订单已创建，请扫码支付', {
        type: 'success',
        duration: 1200
      });

      const {
        orderNo,
        amount,
        codeUrl
      } = resp.data;
      if (!codeUrl) {
        showToast('下单失败：未返回 codeUrl', {
          type: 'error',
          duration: 1500
        });
        return;
      }

      // 关闭详情弹窗 -> 打开二维码弹窗
      close();
      window.PayModal?.open?.({
        orderNo,
        amount,
        codeUrl
      });
    } catch (e) {
      showToast(e?.message || '下单失败', {
        type: 'error',
        duration: 1500
      });
    }
  }

  async function createAlipayOrder() {
    showToast('支付宝支付暂未接入', {
      type: 'error',
      duration: 1500
    });
  }

  function bind() {
    closeBtn()?.addEventListener('click', close);
    cancelBtn()?.addEventListener('click', close);
    mask()?.addEventListener('click', close);

    payWechatBtn()?.addEventListener('click', createWechatOrder);
    payAlipayBtn()?.addEventListener('click', createAlipayOrder);

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && modal()?.style.display !== 'none') close();
    });
  }

  if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', bind);
  else bind();

  window.PackageModal = {
    open,
    close
  };
})();