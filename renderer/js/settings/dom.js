(function () {
  function $(sel, root = document) {
    return root.querySelector(sel);
  }
  function $all(sel, root = document) {
    return Array.from(root.querySelectorAll(sel));
  }

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function showToast(msg, opts) {
    try { if (window.showToast) return window.showToast(msg, opts); } catch {}
    console.log('[toast]', msg);
  }

  window.SettingsDOM = { $, $all, escapeHtml, showToast };
})();