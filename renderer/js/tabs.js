(function () {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  window.addEventListener('DOMContentLoaded', () => {
    const bar = $('#tabbar');
    if (!bar) return;

    const buttons = $$('.tab-btn', bar);
    const panes = $$('.tabpane');

    function activate(tab) {
      buttons.forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
      panes.forEach(p => p.classList.toggle('active', p.id === `tab-${tab}`));
      try { localStorage.setItem('ui.activeTab', tab); } catch {}
    }

    bar.addEventListener('click', (e) => {
      const btn = e.target.closest('.tab-btn');
      if (!btn) return;
      activate(btn.dataset.tab);
    });

    const last = (localStorage && localStorage.getItem('ui.activeTab')) || 'phrases';
    activate(last);
  });
})();