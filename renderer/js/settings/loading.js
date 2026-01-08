(function () {
  const { $ } = window.SettingsDOM;

  let _count = 0;

  function ensure() {
    let el = $('#st-loading');
    if (el) return el;

    const div = document.createElement('div');
    div.id = 'st-loading';
    div.className = 'st-loading';
    div.style.display = 'none';
    div.innerHTML = `
      <div class="st-loading-mask"></div>
      <div class="st-loading-card" role="status" aria-live="polite">
        <div class="st-loading-spinner"></div>
        <div class="st-loading-text" id="st-loading-text">加载中...</div>
      </div>
    `;
    document.body.appendChild(div);
    return div;
  }

  function show(text) {
    const root = ensure();
    _count++;
    const textEl = document.getElementById('st-loading-text');
    if (textEl) textEl.textContent = text || '加载中...';
    root.style.display = '';
  }

  function hide() {
    const root = ensure();
    _count = Math.max(0, _count - 1);
    if (_count === 0) root.style.display = 'none';
  }

  async function wrap(promiseOrFn, text) {
    show(text);
    try {
      const p = (typeof promiseOrFn === 'function') ? promiseOrFn() : promiseOrFn;
      return await p;
    } finally {
      hide();
    }
  }

  window.SettingsLoading = { show, hide, wrap };
})();