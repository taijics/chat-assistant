(function () {
  const { createPhrasesState } = require('./js/phrases/state');
  const { createPhrasesUtil } = require('./js/phrases/util');
  const { createPhrasesDialogs } = require('./js/phrases/dialogs');
  const { createPhrasesActions } = require('./js/phrases/actions');
  const { createRenderCats } = require('./js/phrases/renderCats');
  const { createRenderList } = require('./js/phrases/renderList');

  const state = createPhrasesState();

  // 依赖注入（避免循环引用）
  const util = createPhrasesUtil({ state });
  const dialogs = createPhrasesDialogs({ state, util });

  const actions = createPhrasesActions({ state, util, dialogs });
  const renderCats = createRenderCats({ state, util, actions });
  const renderList = createRenderList({ state, util, actions });

  // 让 actions 能调用 renderCats/renderList（拆分后需要回填）
  actions._bindRenderers({ renderCats, renderList });

  function init() {
    // 显示默认 tab
    actions.switchTab(state.currentTab);

    // 已登录时拉远端数据
    try {
      const tk = (window.API && API.getToken && API.getToken()) || '';
      if (tk) actions.loadRemotePhrasesText();
    } catch {}

    actions.bindContextMenus();
  }

  // tabbar 点击切换
  util.$('#tabbar')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.tab-btn');
    if (!btn) return;
    const tab = btn.dataset.tab;
    if (!tab || tab === state.currentTab) return;
    actions.switchTab(tab);
  });

  // 原有事件：AI 保存短语后刷新
  window.addEventListener('ai:saved-phrase', async () => {
    await actions.loadRemotePhrasesText(true);
  });

  // 登录/登出刷新
  window.addEventListener('auth:login', () => {
    util.setPhrasesUnavailable(false);
    actions.loadRemotePhrasesText(true);
    renderCats(); // 刷新按钮显隐
  });

  window.addEventListener('auth:logout', () => {
    util.setPhrasesUnavailable(false);
    actions.loadRemotePhrasesText(true);
    renderCats();
  });

  // 暴露给外部（兼容旧逻辑）
  window.__phrases = {
    state,
    util,
    dialogs,
    actions,
    renderCats,
    renderList
  };

  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.__openPhrasesPanel = function () {
    actions.switchTab(state.currentTab);
  };
})();