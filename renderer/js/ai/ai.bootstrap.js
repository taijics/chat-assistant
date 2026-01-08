(function () {
  window.AIApp = window.AIApp || {};
  const { ipcRenderer } = require('electron');

  function bootstrap() {
    // 事件：登录/退出
    window.addEventListener('auth:login', () => {
      window.AIApp.agents.loadAgentsFromAPI();
    });
    window.addEventListener('auth:logout', () => {
      window.AIApp.agents.resetAgents();
    });

    // 菜单切 tab
    ipcRenderer.on('menu:switch-tab', (_e, tab) => {
      if (tab === 'ai') {
        window.AIApp.agents.loadAgentsFromAPI();
      }
    });

    // DOM 初始化
    window.addEventListener('DOMContentLoaded', () => {
      // 你原来删除的元素
      document.getElementById('ai-agent-add-btn')?.remove();
      document.querySelectorAll('.agent-edit-btn,.agent-delete-btn,#ai-agent-modal,#ai-agent-confirm-modal')
        .forEach(el => el.remove());

      window.AIApp.actions.bindGenerateButtons();
      window.AIApp.suggestions.bindSuggestionEvents(ipcRenderer);
      window.AIApp.suggestions.renderSuggestions(['（这里将显示 AI 的原样回复，自动拆分）']);

      window.AIApp.agents.bindAgentDropdown();
      window.AIApp.agents.waitAPIThenLoad();
    });
  }

  bootstrap();
})();