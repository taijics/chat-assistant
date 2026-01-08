(function () {
  window.AIApp = window.AIApp || {};
  const { ipcRenderer } = require('electron');
  const { normalizeText } = window.AIApp.utils;

  // debug-log
  ipcRenderer.on('ai:debug-log', (_e, payload) => {
    try {
      const tag = payload && payload.tag ? `[${payload.tag}]` : '';
      console.groupCollapsed(`%cAI 调试 ${tag}`, 'color:#0a84ff');
      console.log(payload);
      console.groupEnd();
    } catch {}
  });

  function maskToken(t='') { const s=String(t); return s ? (s.slice(0,4)+'…'+s.slice(-4)) : ''; }

  async function requestAiRaw(ctx, agentConfig) {
    try {
      const msg = String(ctx || '');
      try {
        console.log('[AI] requestAiRaw prompt_len=', msg.length, 'agentConfig(token masked)=',
          agentConfig ? { ...agentConfig, token: maskToken(agentConfig.token) } : null);
      } catch {}
      const res = await ipcRenderer.invoke('ai:generate', { prompt: msg, agentConfig });
      if (res?.debug?.error) {
        showToast && showToast('请求错误，请联系管理员', { type: 'error', duration: 1800 });
        return '';
      }
      const text = String(res?.text || res?.debug?.finalText || '');
      return normalizeText(text);
    } catch (e) {
      showToast && showToast('请求错误，请联系管理员', { type: 'error', duration: 1800 });
      return '';
    }
  }

  function bindGenerateButtons() {
    const btnShot = document.getElementById('ai-generate');
    const btnDirect = document.getElementById('ai-zhijie-generate');
    const ta = document.getElementById('ai-context');
    if (!ta) return;

    // 截图生成
    if (btnShot && !bindGenerateButtons.boundShot) {
      bindGenerateButtons.boundShot = true;
      btnShot.addEventListener('click', async () => {
        const orig = btnShot.textContent;
        btnShot.disabled = true;
        try {
          const agentConfig = window.AIApp.agents.getSelectedAgentConfig();
          if (!agentConfig) {
            showToast && showToast('未选择智能体', { type: 'error', duration: 1000 });
            return;
          }

          const isDocked = await ipcRenderer.invoke('wechat:is-docked').catch(() => false);
          console.log('[AI] isDocked =', isDocked);

          if (isDocked) {
            btnShot.textContent = '截图中…';
            const ocrText = await window.AIApp.ocr.doScreenshotOCRWithRetry();
            if (!ocrText) {
              showToast && showToast('截图/OCR失败', { type: 'error', duration: 1200 });
              return;
            }
            ta.value = ocrText;
            try { ta.dispatchEvent(new Event('input', { bubbles: true })); } catch {}

            btnShot.textContent = '生成中…';
            const ans = await requestAiRaw(ocrText, agentConfig);
            window.AIApp.suggestions.renderSuggestions(window.AIApp.suggestions.parseSuggestionsFromText(ans));
          } else {
            const ctx = normalizeText(ta.value);
            if (!ctx) {
              showToast && showToast('助手未吸附企业微信：请贴靠企业微信窗口或手动输入内容', { type: 'error', duration: 1400 });
              return;
            }
            btnShot.textContent = '生成中…';
            const ans = await requestAiRaw(ctx, agentConfig);
            window.AIApp.suggestions.renderSuggestions(window.AIApp.suggestions.parseSuggestionsFromText(ans));
          }
        } finally {
          btnShot.disabled = false;
          btnShot.textContent = orig;
        }
      });
    }

    // 直接生成
    if (btnDirect && !bindGenerateButtons.boundDirect) {
      bindGenerateButtons.boundDirect = true;
      btnDirect.addEventListener('click', async () => {
        const orig = btnDirect.textContent;
        btnDirect.disabled = true;
        try {
          const agentConfig = window.AIApp.agents.getSelectedAgentConfig();
          if (!agentConfig) {
            showToast && showToast('未选择智能体', { type: 'error', duration: 1000 });
            return;
          }
          const ctx = normalizeText(ta.value);
          if (!ctx) {
            showToast && showToast('请输入问题或聊天内容', { type: 'error', duration: 1200 });
            return;
          }
          btnDirect.textContent = '生成中…';
          const ans = await requestAiRaw(ctx, agentConfig);
          window.AIApp.suggestions.renderSuggestions(window.AIApp.suggestions.parseSuggestionsFromText(ans));
        } finally {
          btnDirect.disabled = false;
          btnDirect.textContent = orig;
        }
      });
    }
  }

  window.AIApp.actions = { bindGenerateButtons };
})();