(() => {
  // 顶栏交互：DOMContentLoaded 后绑定；支持 Alt+D 切换 DevTools
  const {
    ipcRenderer
  } = require('electron');

  const $ = (sel) => document.querySelector(sel);

  function toggleMenu(show) {
    const menu = $('#app-menu');
    if (!menu) return;
    const willShow = typeof show === 'boolean' ? show : !menu.classList.contains('open');
    menu.classList.toggle('open', willShow);
  }

  function bindHeader() {
    const titlebar = document.querySelector('.app-titlebar');
    if (!titlebar) return;

    // 事件委托：设置 / 最小化 / 退出
    titlebar.addEventListener('click', (e) => {
      const target = e.target.closest('#btn-settings, #btn-minimize, #btn-exit');
      if (!target) return;

      if (target.id === 'btn-settings') {
        e.stopPropagation();
        toggleMenu(true);
        return;
      }
      if (target.id === 'btn-minimize') {
        ipcRenderer.send('toolbar:click', 'minimize');
        return;
      }
      if (target.id === 'btn-exit') {
        ipcRenderer.send('toolbar:click', 'exit');
        return;
      }
    });

    // 菜单项点击
    const menu = $('#app-menu');
    if (menu) {
      menu.addEventListener('click', (e) => {
        const li = e.target.closest('li[data-action]');
        if (!li || li.classList.contains('divider')) return;
        const action = li.getAttribute('data-action');
        ipcRenderer.send('toolbar:click', action);
        if (action !== 'pin') toggleMenu(false);
      });
    }

    // 点击外部 / ESC 关闭菜单
    window.addEventListener('mousedown', (e) => {
      const menuEl = $('#app-menu');
      const btn = $('#btn-settings');
      if (menuEl && !menuEl.contains(e.target) && e.target !== btn) toggleMenu(false);
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') toggleMenu(false);
      // 调试：Alt + D 切换 DevTools（主进程有对应 IPC）
      if (e.altKey && (e.key === 'd' || e.key === 'D')) {
        ipcRenderer.send('devtools:toggle');
      }
    });
  }

  function showArea(area) {
    console.log(area)
    document.getElementById('phrases-area').style.display = (area === 'phrases') ? '' : 'none';
    document.getElementById('ai-area').style.display = (area === 'ai') ? '' : 'none';
    document.getElementById('models-area').style.display = (area === 'models') ? '' : 'none';
    document.getElementById('emojis-area').style.display = (area === 'emojis') ? '' : 'none';
  }

  ipcRenderer.on('menu:switch-tab', (_e, tabName) => {
    showArea(tabName);
    // 切换到话术时，默认激活公司tab
    if (tabName === 'phrases') {
      if (window.activateTab) window.activateTab('corp');
    }
    // 切换到浏览器时，默认激活豆包
    if (tabName === 'models') {
      setTimeout(() => {
        if (window.activateModelTab) window.activateModelTab();
      }, 10);
    }
  });
  // 同步“置顶”勾选状态
  ipcRenderer.on('toolbar:pin-state', (_e, pinned) => {
    const pinItem = document.getElementById('menu-pin');
    if (pinItem) pinItem.classList.toggle('checked', !!pinned);
  });

  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', bindHeader);
  } else {
    bindHeader();
  }
})();