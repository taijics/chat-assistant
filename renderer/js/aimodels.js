// 只在渲染进程（有 window/document）执行；若被主进程误 require，则直接退出
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  (function () {
    const { ipcRenderer } = require('electron');
    const $ = (sel, root = document) => root.querySelector(sel);
    const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

    let useFallbackIframe = false;
    let lastUrl = 'https://www.doubao.com/chat/';

    // 懒加载与激活状态
    let modelsInitialized = false; // 是否已创建/切换过一次模型视图
    let modelsActive = false;      // 当前是否在“AI模型”选项卡

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
      parents.push(window);
      return parents;
    }

    function scheduleResize() {
      if (!modelsInitialized || !modelsActive) return; // 未激活时不做尺寸同步
      if (useFallbackIframe) return;
      if (rafId) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        resizeToHost();
      });
    }

    function bindScrollSync() {
      if (!modelsInitialized || !modelsActive) return;
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

    // 固定裁剪：以“顶栏(.app-titlebar) + 选项卡栏(.tabbar)”的下沿作为上边界，吸顶不遮挡
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

      const CLIP_MARGIN = 2; // 预留 2px 余量
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
        switchTo(url);
      }
    }

    async function switchTo(url) {
      const host = $('#aimodels-host');
      const iframe = $('#aimodels-fallback');
      if (!host) return;

      if (!useFallbackIframe) {
        try {
          await ipcRenderer.invoke('aimodels:switch', { url });
          // 切回 models 页签或切换站点后，同步一次位置尺寸并绑定滚动同步
          await resizeToHost();
          bindScrollSync();
          if (iframe) iframe.hidden = true;
          return;
        } catch (e) {
          console.warn('aimodels: switch failed or blocked, fallback to iframe. reason:', e && (e.message || e.code));
          useFallbackIframe = true;
        }
      }

      // 兜底 iframe（注意：很多站点仍会拒绝被内嵌）
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
      if (!modelsInitialized || !modelsActive) return; // 未初始化或未激活时不调整
      const bounds = getHostBounds();
      if (!bounds) return;
      try {
        await ipcRenderer.invoke('aimodels:resize', { bounds });
      } catch (e) {
        // 主进程不可用或失败时切换到 iframe
        useFallbackIframe = true;
        const active = document.querySelector('.aim-tab.active');
        if (active) switchTo(active.dataset.url || '');
      }
    }

    function detachBrowserView() {
      // 仅从窗口摘除，不销毁实例；会话、页面状态仍在
      try { ipcRenderer.invoke('aimodels:detach'); } catch {}
      // 同时隐藏兜底 iframe
      const iframe = $('#aimodels-fallback');
      if (iframe) iframe.hidden = true;
      // 解绑滚动同步
      unbindScrollSync();
    }

    function setupEvents() {
      const bar = $('#aimodels-tabs');
      if (!bar) return;

      // 初次加载：不再主动创建/切换模型，避免首屏阻塞
      // 只记录默认激活按钮和 lastUrl
      const defaultBtn = document.querySelector('.aim-tab.active') || $$('.aim-tab', bar)[0];
      if (defaultBtn) {
        lastUrl = defaultBtn.dataset.url || lastUrl;
        // 保留 active 样式，但不触发 activateModel()
      }

      // 点击切换站点（仅在“AI模型”页签内工作）
      bar.addEventListener('click', (e) => {
        if (!modelsActive) return;
        const btn = e.target.closest('.aim-tab');
        if (!btn) return;
        activateModel(btn); // 已初始化且在 models 页签内，此时切换站点
        btn.focus();
      });

      // 键盘导航（仅在“AI模型”页签内生效）
      bar.addEventListener('keydown', (e) => {
        if (!modelsActive) return;
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

      // 窗口尺寸变化：仅在 models 激活时同步 BrowserView 尺寸/位置
      window.addEventListener('resize', scheduleResize, { passive: true });

      // 顶部主选项卡切换
      document.getElementById('tabbar')?.addEventListener('click', (e) => {
        const tabBtn = e.target.closest('.tab-btn[role="tab"]');
        if (!tabBtn) return;

        if (tabBtn.dataset.tab === 'models') {
          modelsActive = true;
          const active = document.querySelector('.aim-tab.active') || $$('.aim-tab', bar)[0];
          if (!modelsInitialized) {
            modelsInitialized = true;
            const toActivate = active || $$('.aim-tab', bar)[0];
            if (toActivate) {
              lastUrl = toActivate.dataset.url || lastUrl;
              activateModel(toActivate);
              setTimeout(() => { scheduleResize(); bindScrollSync(); }, 0);
            }
          } else {
            // 已初始化：仅重新附加并对齐
            if (active) lastUrl = active.dataset.url || lastUrl;
            switchTo(lastUrl);
            setTimeout(() => { scheduleResize(); bindScrollSync(); }, 0);
          }
        } else {
          // 离开 models：仅从窗口摘除
          modelsActive = false;
          detachBrowserView();
        }
      });
    }

    window.addEventListener('DOMContentLoaded', setupEvents);
  })();
} else {
  module.exports = {};
}