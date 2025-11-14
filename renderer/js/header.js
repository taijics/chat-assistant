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
  
  // 新增：全局通用确认框（任何页面可调用 window.uiConfirm(...)）
  function uiConfirm({ title = '确认操作', message = '确定要执行该操作吗？', okText = '确定', cancelText = '取消', danger = false } = {}) {
    // 注入一次样式
    if (!document.getElementById('confirm-style')) {
      const style = document.createElement('style');
      style.id = 'confirm-style';
      style.textContent = `
        .confirm-mask{position:fixed;inset:0;background:rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;z-index:3100;}
        .confirm-dialog{background:#fff;width:420px;max-width:90vw;border-radius:12px;box-shadow:0 12px 28px rgba(0,0,0,.18);padding:16px 16px 12px;color:#222;}
        .confirm-title{font-size:16px;font-weight:600;margin-bottom:8px;}
        .confirm-body{font-size:14px;color:#444;line-height:1.6;margin-bottom:14px;}
        .confirm-actions{display:flex;justify-content:flex-end;gap:10px}
        .confirm-actions .btn-cancel,.confirm-actions .btn-ok{min-width:72px;padding:6px 12px;font-size:13px;border-radius:8px;border:1px solid #d0d7de;background:#fff;cursor:pointer}
        .confirm-actions .btn-ok{background:#1f6feb;color:#fff;border-color:#1f6feb}
        .confirm-actions .btn-ok.danger{background:#e02424;border-color:#e02424;color:#fff}
        .confirm-actions .btn-cancel:hover{background:#f6f8fa}
        .confirm-actions .btn-ok:hover{opacity:.95}
      `;
      document.head.appendChild(style);
    }
  
    return new Promise((resolve) => {
      const mask = document.createElement('div');
      mask.className = 'confirm-mask';
      mask.innerHTML = `
        <div class="confirm-dialog" role="dialog" aria-modal="true">
          <div class="confirm-title">${title}</div>
          <div class="confirm-body">${message}</div>
          <div class="confirm-actions">
            <button class="btn-cancel" type="button">${cancelText}</button>
            <button class="btn-ok ${danger ? 'danger' : ''}" type="button">${okText}</button>
          </div>
        </div>`;
      document.body.appendChild(mask);
      const dialog = mask.querySelector('.confirm-dialog');
      const btnOk = mask.querySelector('.btn-ok');
      const btnCancel = mask.querySelector('.btn-cancel');
      function close(val) { mask.remove(); resolve(!!val); }
      btnOk.onclick = () => close(true);
      btnCancel.onclick = () => close(false);
      mask.addEventListener('click', (e) => { if (e.target === mask) close(false); });
      dialog.addEventListener('click', (e) => e.stopPropagation());
      mask.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { e.preventDefault(); close(false); }
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); close(true); }
      });
    });
  }
  // 挂到全局
  window.uiConfirm = uiConfirm;
  
  
  // 添加在 uiConfirm 定义旁边（上/下均可），确保只注入一次样式
  function showToast(message, { type = 'success', duration = 1200 } = {}) {
    if (!document.getElementById('toast-style')) {
      const style = document.createElement('style');
      style.id = 'toast-style';
      style.textContent = `
        #global-toast-wrap{position:fixed;left:50%;bottom:56px;transform:translateX(-50%);z-index:3000;pointer-events:none}
        .toast{display:flex;align-items:center;gap:8px;margin-top:8px;padding:8px 12px;border-radius:8px;color:#fff;
               box-shadow:0 6px 18px rgba(0,0,0,.18);opacity:0;transform:translateY(6px) scale(.98);
               transition:opacity .15s ease, transform .15s ease;pointer-events:none;font-size:13px;line-height:1.3}
        .toast.show{opacity:1;transform:translateY(0) scale(1)}
        .toast.success{background:rgba(16,185,129,.95)}   /* 绿色 */
        .toast.error{background:rgba(239,68,68,.95)}      /* 红色 */
        .toast .icon{font-weight:700;font-size:14px;line-height:1}
        .toast.success .icon{content:"";} /* 留空即可用字符 */
        .toast.error .icon{content:"";}   /* 留空即可用字符 */
      `;
      document.head.appendChild(style);
    }
    let wrap = document.getElementById('global-toast-wrap');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = 'global-toast-wrap';
      document.body.appendChild(wrap);
    }
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    const icon = document.createElement('span');
    icon.className = 'icon';
    icon.textContent = type === 'error' ? '✖' : '✓';
    const text = document.createElement('span');
    text.className = 'text';
    text.textContent = message || '';
    el.appendChild(icon);
    el.appendChild(text);
    wrap.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => el.remove(), 180);
    }, Math.max(600, duration));
  }
  window.showToast = showToast;
})();