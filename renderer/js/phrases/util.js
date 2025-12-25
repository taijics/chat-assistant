function createPhrasesUtil({ state }) {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function currentUserIsAdmin() {
    try {
      const u = (window.API && API.getUser && API.getUser()) || null;
      return !!(u && Number(u.isAdmin) === 1);
    } catch {
      return false;
    }
  }

  function canShowOps(tab) {
    if (tab === 'corp') return false; // 公司：不显示“＋”
    if (tab === 'group') return currentUserIsAdmin(); // 小组：组长才显示
    if (tab === 'private') return true; // 私人：总是显示
    return false;
  }

  function getUseScopeForCurrent() {
    if (state.currentTab === 'group') return 1;
    if (state.currentTab === 'private') return 2;
    return 0;
  }

  function getData() {
    return state.allData[state.currentTab];
  }

  function getActiveCat() {
    return state.allActiveCat[state.currentTab];
  }

  function setActiveCat(name) {
    state.allActiveCat[state.currentTab] = name || '';
  }

  /* ------------------- 服务端不可用提示 Banner（居中显示） ------------------- */
  function ensurePhrasesUnavailableBanner() {
    let el = document.getElementById('phrases-unavailable');
    if (!el) {
      el = document.createElement('div');
      el.id = 'phrases-unavailable';
      el.style.cssText = [
        'position:fixed',
        'inset:0',
        'display:none',
        'z-index:2147483000',
        'pointer-events:none',
        'display:flex',
        'align-items:center',
        'justify-content:center',
      ].join(';');

      const card = document.createElement('div');
      card.style.cssText = [
        'pointer-events:auto',
        'background:#fff',
        'color:#333',
        'border:1px solid #ddd',
        'box-shadow:0 8px 28px rgba(0,0,0,.15)',
        'border-radius:10px',
        'padding:16px 20px',
        'font-size:14px',
        'line-height:1.6',
        'max-width:80vw',
        'text-align:center',
      ].join(';');
      card.innerHTML = `
        <span class="msg-text" style="color:#444;">服务端不可用</span>
        <button type="button" class="retry-btn"
          style="margin-left:14px;padding:6px 14px;font-size:13px;cursor:pointer;border:1px solid #bbb;background:#fff;border-radius:6px;">
          重试
        </button>
      `;
      el.appendChild(card);
      document.body.appendChild(el);

      const retryBtn = card.querySelector('.retry-btn');
      retryBtn.addEventListener('click', () => {
        setPhrasesUnavailable(false);
        try {
          window.__phrases?.actions?.loadRemotePhrasesText?.(true);
        } catch {}
      });
    }
    return el;
  }

  function setPhrasesUnavailable(show, msg) {
    const el = ensurePhrasesUnavailableBanner();
    if (!el) return;
    if (msg) {
      const mt = el.querySelector('.msg-text');
      if (mt) mt.textContent = msg;
    }
    el.style.display = show ? 'flex' : 'none';
  }

  function isServerUnavailableError(err) {
    if (!err) return true;
    if (err.name === 'AbortError') return true;
    if (typeof err.status === 'number') {
      if (err.status >= 500) return true;
    }
    const msg = (err.message || '').toLowerCase();
    if (msg.includes('failed to fetch') || msg.includes('timeout') || msg.includes('network')) return true;
    return false;
  }
  /* ------------------------------------------------------------- */

  // 兜底：优先用 header.js 提供的全局 showToast/uiConfirm
  function showToast(msg, opts) {
    try {
      if (typeof window.showToast === 'function') return window.showToast(msg, opts);
    } catch {}
    if (opts && opts.type === 'error') console.warn('[toast]', msg);
    else console.log('[toast]', msg);
  }

  async function uiConfirm({ title, message, okText, danger } = {}) {
    try {
      if (typeof window.uiConfirm === 'function') {
        return await window.uiConfirm({ title, message, okText, danger });
      }
    } catch {}
    return window.confirm((title ? title + '\n\n' : '') + (message || '确定吗？'));
  }

  return {
    $,
    $$,
    currentUserIsAdmin,
    canShowOps,
    getUseScopeForCurrent,
    getData,
    getActiveCat,
    setActiveCat,
    ensurePhrasesUnavailableBanner,
    setPhrasesUnavailable,
    isServerUnavailableError,
    showToast,
    uiConfirm,
  };
}

module.exports = { createPhrasesUtil };