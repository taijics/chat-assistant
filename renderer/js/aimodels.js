// 只在渲染进程（有 window/document）执行；若被主进程误 require，则直接退出
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  (function () {
    const { ipcRenderer } = require('electron');
    const $ = (sel, root = document) => root.querySelector(sel);
    const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

    let useFallbackIframe = false;
    let lastUrl = 'https://www.doubao.com/chat/';

    // ---- 滚动/尺寸同步辅助 ----
    let rafId = null;
    let scrollParents = [];
    let resizeObs = null;

    const overflowRegex = /(auto|scroll|overlay)/i;
    function isScrollable(el) {
      const st = getComputedStyle(el);
      return (
        overflowRegex.test(st.overflowY || '') ||
        overflowRegex.test(st.overflow || '')
      ) && (el.scrollHeight > el.clientHeight);
    }

    function getScrollParents(el) {
      const parents = [];
      let p = el && el.parentElement;
      while (p) {
        if (isScrollable(p)) parents.push(p);
        p = p.parentElement;
      }
      // 页面自身滚动
      parents.push(window);
      return parents;
    }

    function scheduleResize() {
      if (useFallbackIframe) return;
      if (rafId) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        resizeToHost();
      });
    }

    function bindScrollSync() {
      const host = $('#aimodels-host');
      if (!host) return;
      unbindScrollSync();
      scrollParents = getScrollParents(host);
      scrollParents.forEach(p => {
        try { p.addEventListener('scroll', scheduleResize, { passive: true }); } catch {}
      });

      try {
        if (resizeObs) resizeObs.disconnect();
        resizeObs = new ResizeObserver(() => scheduleResize());
        resizeObs.observe(host);
      } catch {}
    }

    function unbindScrollSync() {
      if (scrollParents && scrollParents.length) {
        scrollParents.forEach(p => {
          try { p.removeEventListener('scroll', scheduleResize); } catch {}
        });
      }
      scrollParents = [];
      if (resizeObs) {
        try { resizeObs.disconnect(); } catch {}
        resizeObs = null;
      }
    }

    // 固定裁剪：以“顶栏(.app-titlebar) + 选项卡栏(.tabbar)”的下沿作为上边界，
    // 保证 BrowserView 永远不会越过它，从而不遮住顶部。
    function getClipRect() {
      const titleEl = document.querySelector('.app-titlebar');
      const tabbarEl = document.querySelector('.tabbar');

      let safeTop = 0;
      if (titleEl) {
        const r = titleEl.getBoundingClientRect();
        safeTop = Math.max(safeTop, Math.round(r.bottom));
      }
      if (tabbarEl) {
        const r = tabbarEl.getBoundingClientRect();
        safeTop = Math.max(safeTop, Math.round(r.bottom));
      }

      // 预留 2px 裁剪余量，避免因亚像素抖动出现 1px 覆盖
      const CLIP_MARGIN = 2;
      safeTop += CLIP_MARGIN;

      return { left: 0, top: safeTop, right: window.innerWidth, bottom: window.innerHeight };
    }

    function intersectRects(a, b) {
      const left = Math.max(a.left, b.left);
      const top = Math.max(a.top, b.top);
      const right = Math.min(a.right, b.right);
      const bottom = Math.min(a.bottom, b.bottom);
      return {
        left,
        top,
        right,
        bottom,
        width: Math.max(0, right - left),
        height: Math.max(0, bottom - top),
      };
    }

    function setActiveTabStyles(btn, bar) {
      const tabs = $$('.aim-tab', bar);
      tabs.forEach(t => {
        const isActive = t === btn;
        t.classList.toggle('active', isActive);
        t.setAttribute('aria-selected', isActive ? 'true' : 'false');
        t.setAttribute('tabindex', isActive ? '0' : '-1');
      });
    }

    function activateModel(btn) {
      const bar = $('#aimodels-tabs');
      if (!bar || !btn) return;
      setActiveTabStyles(btn, bar);
      const url = btn.dataset.url || '';
      if (url) {
        lastUrl = url;
        loadUrl(url);
      }
    }

    async function loadUrl(url) {
      const host = $('#aimodels-host');
      const iframe = $('#aimodels-fallback');
      if (!host) return;

      if (!useFallbackIframe) {
        try {
          await ipcRenderer.invoke('aimodels:load', { url });
          await resizeToHost(); // 切换站点后先同步一次位置尺寸
          bindScrollSync();
          if (iframe) iframe.hidden = true;
          return;
        } catch (e) {
          console.warn('aimodels: BrowserView not available or blocked, fallback to iframe. reason:', e && (e.message || e.code));
          useFallbackIframe = true;
        }
      }

      // 兜底 iframe
      if (iframe) {
        iframe.src = url;
        iframe.hidden = false;
        unbindScrollSync();
      }
    }

    function getHostBounds() {
      const host = $('#aimodels-host');
      if (!host) return null;

      const rect = host.getBoundingClientRect();
      const hostRect = { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
      const clipRect = getClipRect();
      const inter = intersectRects(hostRect, clipRect);

      if (inter.width <= 0 || inter.height <= 0) {
        // 完全不可见时，把 BrowserView 移出视口，避免遮挡
        return { x: 0, y: -10000, width: 1, height: 1 };
      }

      return {
        x: Math.round(inter.left),
        y: Math.round(inter.top),
        width: Math.round(inter.width),
        height: Math.round(inter.height)
      };
    }

    async function resizeToHost() {
      if (useFallbackIframe) return;
      const bounds = getHostBounds();
      if (!bounds) return;
      try {
        await ipcRenderer.invoke('aimodels:resize', { bounds });
      } catch (e) {
        // 主进程未实现或失败时切换到 iframe
        useFallbackIframe = true;
        const active = document.querySelector('.aim-tab.active');
        if (active) loadUrl(active.dataset.url || '');
      }
    }

    function hideBrowserView() {
      try { ipcRenderer.invoke('aimodels:hide'); } catch {}
      const iframe = $('#aimodels-fallback');
      if (iframe) iframe.hidden = true;
      unbindScrollSync();
    }

    function setupEvents() {
      const bar = $('#aimodels-tabs');
      if (!bar) return;

      // 初次激活
      const current = document.querySelector('.aim-tab.active') || $$('.aim-tab', bar)[0];
      if (current) {
        lastUrl = current.dataset.url || lastUrl;
        activateModel(current);
      }

      // 点击切换站点
      bar.addEventListener('click', (e) => {
        const btn = e.target.closest('.aim-tab');
        if (!btn) return;
        activateModel(btn);
        btn.focus();
      });

      // 键盘导航
      bar.addEventListener('keydown', (e) => {
        const key = e.key;
        const tabs = $$('.aim-tab', bar);
        const idx = tabs.findIndex(t => t.getAttribute('aria-selected') === 'true');
        if (idx < 0) return;

        const move = (n) => {
          const target = tabs[n];
          if (target) { activateModel(target); target.focus(); }
        };

        if (key === 'ArrowRight') { e.preventDefault(); move((idx + 1) % tabs.length); }
        else if (key === 'ArrowLeft') { e.preventDefault(); move((idx - 1 + tabs.length) % tabs.length); }
        else if (key === 'Home') { e.preventDefault(); move(0); }
        else if (key === 'End') { e.preventDefault(); move(tabs.length - 1); }
        else if (key === 'Enter' || key === ' ') {
          const focused = document.activeElement;
          if (focused && focused.classList.contains('aim-tab')) {
            e.preventDefault();
            activateModel(focused);
          }
        }
      });

      // 窗口尺寸变化，同步 BrowserView 尺寸/位置
      window.addEventListener('resize', scheduleResize, { passive: true });

      // 切换顶栏选项卡：离开时隐藏 BrowserView，返回时恢复
      document.getElementById('tabbar')?.addEventListener('click', (e) => {
        const tabBtn = e.target.closest('.tab-btn[role="tab"]');
        if (!tabBtn) return;
        if (tabBtn.dataset.tab === 'models') {
          const active = document.querySelector('.aim-tab.active') || $$('.aim-tab', bar)[0];
          if (active) {
            lastUrl = active.dataset.url || lastUrl;
            loadUrl(lastUrl);
            setTimeout(() => {
              scheduleResize();
              bindScrollSync();
            }, 0);
          }
        } else {
          hideBrowserView();
        }
      });

      // “在浏览器打开”按钮
      $('#aimodels-open-external')?.addEventListener('click', () => {
        ipcRenderer.invoke('aimodels:openExternal', { url: lastUrl });
      });

      // 初次渲染后对齐一次
      setTimeout(scheduleResize, 0);
    }

    window.addEventListener('DOMContentLoaded', setupEvents);
  })();
} else {
  module.exports = {};
}