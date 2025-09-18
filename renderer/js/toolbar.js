const { ipcRenderer } = require('electron');

const btn = document.getElementById('btn-settings');
const menu = document.getElementById('dropdown');
const pinItem = document.getElementById('menu-pin');

function toggleMenu(show) {
  const willShow = typeof show === 'boolean' ? show : !menu.classList.contains('open');
  if (willShow) {
    menu.classList.add('open');
    // 计算菜单高度，通知主进程把 BrowserView 高度临时拉大（工具栏40 + 菜单高度）
    const extra = Math.ceil(menu.scrollHeight); // DIP
    ipcRenderer.send('toolbar:menu-open', extra);
  } else {
    menu.classList.remove('open');
    ipcRenderer.send('toolbar:menu-close');
  }
}

btn.addEventListener('click', (e) => {
  e.stopPropagation();
  toggleMenu(true);
});

// 点击菜单项
menu.addEventListener('click', (e) => {
  const li = e.target.closest('li[data-action]');
  if (!li || li.classList.contains('divider')) return;
  const action = li.getAttribute('data-action');
  ipcRenderer.send('toolbar:click', action);
  if (action !== 'pin') toggleMenu(false);
});

// 点击外部关闭
window.addEventListener('mousedown', (e) => {
  if (!menu.contains(e.target) && e.target !== btn) toggleMenu(false);
});
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') toggleMenu(false);
});

// 从主进程同步置顶状态
ipcRenderer.on('toolbar:pin-state', (_e, pinned) => {
  pinItem.classList.toggle('checked', !!pinned);
});