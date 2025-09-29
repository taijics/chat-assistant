(function() {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  window.activateTab = activate;

  function activate(tabName) {
    const bar = $('#tabbar');
    const tabs = $$('.tab-btn[role="tab"]', bar);
    const panes = $$('.tabpane[role="tabpanel"]');

    tabs.forEach(t => {
      const isActive = t.dataset.tab === tabName;
      t.classList.toggle('active', isActive);
      t.setAttribute('aria-selected', isActive ? 'true' : 'false');
      t.setAttribute('tabindex', isActive ? '0' : '-1');
    });

    panes.forEach(p => {
      const isActive = p.id === `tab-${tabName}`;
      p.classList.toggle('active', isActive);
      p.setAttribute('aria-hidden', isActive ? 'false' : 'true');
      if (isActive) {
        // 将标题与面板无缝连接的视觉效果可通过 CSS 实现，这里仅处理可见性
      }
    });

    try {
      localStorage.setItem('ui.activeTab', tabName);
    } catch {}
  }

  function moveFocus(direction) {
    const bar = $('#tabbar');
    const tabs = $$('.tab-btn[role="tab"]', bar);
    const currentIndex = tabs.findIndex(t => t.getAttribute('aria-selected') === 'true');
    if (currentIndex < 0) return;

    let nextIndex = currentIndex + direction;
    if (nextIndex < 0) nextIndex = tabs.length - 1;
    if (nextIndex >= tabs.length) nextIndex = 0;

    const next = tabs[nextIndex];
    if (next) {
      next.focus();
      activate(next.dataset.tab);
    }
  }

  window.addEventListener('DOMContentLoaded', () => {
    const bar = $('#tabbar');
    if (!bar) return;

    // 赋予语义：tablist / tab / tabpanel
    bar.setAttribute('role', 'tablist');

    const tabs = $$('.tab-btn', bar);
    const panes = $$('.tabpane');

    // 确保每个 tab 都有 id，且对应的 panel 有 aria-labelledby
    tabs.forEach(btn => {
      const name = btn.dataset.tab;
      const tid = `tabbtn-${name}`;
      btn.id = tid;
      btn.setAttribute('role', 'tab');
      btn.setAttribute('aria-controls', `tab-${name}`);
      btn.setAttribute('tabindex', '-1'); // 激活后设为 0
    });

    panes.forEach(p => {
      p.setAttribute('role', 'tabpanel');
      const name = (p.id || '').replace(/^tab-/, '');
      const labelledBy = `tabbtn-${name}`;
      p.setAttribute('aria-labelledby', labelledBy);
      p.setAttribute('aria-hidden', p.classList.contains('active') ? 'false' : 'true');
    });

    // 初始激活：本地存储优先，否则用已有 active 的按钮，否则第一个
    const stored = (localStorage && localStorage.getItem('ui.activeTab')) || '';
    let init = stored && tabs.find(b => b.dataset.tab === stored) ? stored : '';
    if (!init) {
      const activeBtn = tabs.find(b => b.classList.contains('active'));
      init = activeBtn ? activeBtn.dataset.tab : (tabs[0] && tabs[0].dataset.tab);
    }
    if (init) activate(init);

    // 点击激活
    bar.addEventListener('click', (e) => {
      const btn = e.target.closest('.tab-btn[role="tab"]');
      if (!btn) return;
      activate(btn.dataset.tab);
      btn.focus();
    });

    // 键盘导航：左右/Home/End
    bar.addEventListener('keydown', (e) => {
      const key = e.key;
      if (key === 'ArrowRight') {
        e.preventDefault();
        moveFocus(+1);
      } else if (key === 'ArrowLeft') {
        e.preventDefault();
        moveFocus(-1);
      } else if (key === 'Home') {
        e.preventDefault();
        const first = $$('.tab-btn[role="tab"]', bar)[0];
        if (first) {
          activate(first.dataset.tab);
          first.focus();
        }
      } else if (key === 'End') {
        e.preventDefault();
        const all = $$('.tab-btn[role="tab"]', bar);
        const last = all[all.length - 1];
        if (last) {
          activate(last.dataset.tab);
          last.focus();
        }
      } else if (key === 'Enter' || key === ' ') {
        // 已在 roving tabindex 上，Enter/Space 可保持一致行为
        const focused = document.activeElement;
        if (focused && focused.getAttribute('role') === 'tab') {
          e.preventDefault();
          activate(focused.dataset.tab);
        }
      }
    });
  });
})();