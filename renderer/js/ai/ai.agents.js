(function() {
  window.AIApp = window.AIApp || {};
  const {
    escapeHtml
  } = window.AIApp.utils;

  let aiAgents = [];
  let selectedAgentIdx = null;
  let loadingAgents = false;
  let agentInitialRequested = false;
  let reloadSpinStart = 0;

  function maskToken(t = '') {
    const s = String(t);
    return s ? (s.slice(0, 4) + '…' + s.slice(-4)) : '';
  }

  function getCurrentUserId() {
    try {
      const u = (window.API && typeof API.getUser === 'function') ? API.getUser() : null;
      if (u) {
        const id = u.id || u.userId || u.uid || u.accountId || u.phone || u.username || u.name;
        if (id) return String(id).trim();
      }
    } catch {}
    try {
      const raw = localStorage.getItem('auth.user');
      if (raw) {
        const u = JSON.parse(raw);
        const id = u.id || u.userId || u.uid || u.accountId || u.phone || u.username || u.name;
        if (id) return String(id).trim();
      }
    } catch {}
    return '';
  }

  function isExpired(agent) {
    if (!agent || !agent.expire) return false;
    try {
      const today = new Date().toISOString().slice(0, 10);
      const expireStr = typeof agent.expire === 'string' ?
        agent.expire.slice(0, 10) :
        agent.expire.toISOString().slice(0, 10);
      return expireStr < today;
    } catch {
      return false;
    }
  }

  function setReloadSpinning(flag) {
    const btn = document.getElementById('ai-agent-reload-btn');
    if (!btn) return;
    if (flag) {
      reloadSpinStart = Date.now();
      btn.classList.add('spinning');
      btn.disabled = true;
    } else {
      const elapsed = Date.now() - reloadSpinStart;
      const remain = window.AIApp.constants.AGENT_RELOAD_SPIN_MIN_MS - elapsed;
      const stop = () => {
        btn.classList.remove('spinning');
        btn.disabled = false;
      };
      if (remain > 0) setTimeout(stop, remain);
      else stop();
    }
  }

  function updateAgentSelectedBtn() {
    const btn = document.getElementById('ai-agent-selected-btn');
    if (!btn) return;
    if (selectedAgentIdx == null || !aiAgents[selectedAgentIdx]) {
      btn.textContent = '智能体';
      btn.title = aiAgents.length ? '点击选择智能体' : '暂无智能体';
    } else {
      const ag = aiAgents[selectedAgentIdx];
      btn.textContent = ag.name;
      btn.title = (isExpired(ag) ? '已过期：' : '当前智能体：') + ag.name;
    }
  }

  function renderAIAgentDropdown() {
    const list = document.getElementById('ai-agent-dropdown-list');
    if (!list) return;
    if (loadingAgents) {
      list.innerHTML = '<li class="loading">加载中…</li>';
      return;
    }
    if (!aiAgents.length) {
      list.innerHTML = '<li class="empty">无智能体</li>';
      return;
    }
    list.innerHTML = aiAgents.map((a, i) => {
      const expired = isExpired(a);
      const sel = i === selectedAgentIdx ? 'selected' : '';
      return `<li class="${sel} ${expired ? 'expired' : ''}" data-idx="${i}" title="${expired ? '已过期，无法选择' : '点击选择'}">
        <span class="agent-name">${escapeHtml(a.name || ('智能体' + (i + 1)))}</span>
        ${expired ? '<span style="color:#e02424;font-size:12px;margin-left:6px;">已过期</span>' : ''}
      </li>`;
    }).join('');
  }

  function chooseDefaultAgent() {
    const idx = aiAgents.findIndex(a => !isExpired(a));
    selectedAgentIdx = idx >= 0 ? idx : null;
  }

  async function loadAgentsFromAPI() {
    if (loadingAgents) return;
    if (!window.API || !API.agent || typeof API.agent.listByMyTeam !== 'function') {
      console.log('[AI] API.agent.listByMyTeam 尚不可用，稍后再试');
      return;
    }
    loadingAgents = true;
    setReloadSpinning(true);
    renderAIAgentDropdown();
    console.log('[AI] 请求智能体列表 /api/front/agent/listByMyTeam');

    try {
      const resp = await API.agent.listByMyTeam();
      const list = (resp && resp.status === 'success' && Array.isArray(resp.data)) ? resp.data : [];
      aiAgents = (list || []).map(a => ({
        name: a.title || a.name || '智能体',
        token: a.kzToken || a.token || '',
        botid: a.botId || a.botid || '',
        expire: a.expireDate || a.expire || ''
      })).filter(x => x.token && x.botid);

      chooseDefaultAgent();
    } catch (e) {
      console.warn('[AI] 获取智能体失败:', e.message);
      aiAgents = [];
      selectedAgentIdx = null;
      showToast && showToast('刷新失败', {
        type: 'error',
        duration: 1000
      });
    } finally {
      loadingAgents = false;
      setReloadSpinning(false);
      updateAgentSelectedBtn();
      renderAIAgentDropdown();
    }
  }

  function getSelectedAgentConfig() {
    const a = aiAgents[selectedAgentIdx];
    if (!a) return null;
    const token = String(a.token || '').trim();
    const botId = String(a.botid || '').trim();
    const userId = getCurrentUserId();
    if (!userId) {
      showToast && showToast('未获取到用户ID，请先登录', {
        type: 'error',
        duration: 1500
      });
      return null;
    }
    const cfg = {
      token,
      botId,
      userId
    };
    try {
      console.log('[AI] agentConfig ->', {
        ...cfg,
        token: maskToken(cfg.token)
      });
    } catch {}
    return cfg;
  }

  function bindAgentDropdown() {
    document.getElementById('ai-agent-selected-btn')?.addEventListener('click', () => {
      const dd = document.getElementById('ai-agent-dropdown');
      if (!dd) return;
      dd.style.display = dd.style.display === 'block' ? 'none' : 'block';
      if (dd.style.display === 'block' && !aiAgents.length && !loadingAgents) loadAgentsFromAPI();
      renderAIAgentDropdown();
    });

    document.getElementById('ai-agent-reload-btn')?.addEventListener('click', () => {
      loadAgentsFromAPI();
      showToast && showToast('刷新成功', {
        type: 'success',
        duration: 1000
      });
    });

    document.addEventListener('click', (e) => {
      const dd = document.getElementById('ai-agent-dropdown');
      const btn = document.getElementById('ai-agent-selected-btn');
      if (!dd || dd.style.display !== 'block') return;
      if (dd.contains(e.target) || btn.contains(e.target)) return;
      dd.style.display = 'none';
    }, true);

    document.getElementById('ai-agent-dropdown-list')?.addEventListener('click', e => {
      const li = e.target.closest('li[data-idx]');
      if (!li) return;
      const idx = Number(li.dataset.idx);
      const ag = aiAgents[idx];
      if (!ag) return;
      if (isExpired(ag)) {
        showToast('智能体已过期，请联系管理员', {
          type: 'error',
          duration: 1800
        });
        return;
      }
      selectedAgentIdx = idx;
      updateAgentSelectedBtn();
      document.getElementById('ai-agent-dropdown').style.display = 'none';
    });
  }

  // 等待 API 就绪后首次加载
  let apiWaitCount = 0;

  function waitAPIThenLoad() {
    if (window.API && API.agent && typeof API.agent.listByMyTeam === 'function') {
      if (!agentInitialRequested) {
        agentInitialRequested = true;
        loadAgentsFromAPI();
      }
      return;
    }
    apiWaitCount++;
    if (apiWaitCount > 40) {
      console.warn('[AI] 等待 API 超时，无法请求智能体');
      updateAgentSelectedBtn();
      renderAIAgentDropdown();
      return;
    }
    setTimeout(waitAPIThenLoad, 50);
  }

  function ensureVipForAgents() {
    const expired = window.AuthVip && AuthVip.isVipExpired && AuthVip.isVipExpired();
    if (!expired) return true;

    // 到期：先确认
    if (window.AuthUI && AuthUI.showConfirmModal) {
      AuthUI.showConfirmModal('VIP到期，请续费', () => {
        // 确定 -> 充值弹窗（公共）
        if (window.PaywallUI && PaywallUI.showPaywallModal) {
          PaywallUI.showPaywallModal({
            reason: 'VIP到期，智能体功能不可用，请续费后继续使用。'
          });
        }
      });
    } else {
      // 没有确认框就直接弹充值
      window.PaywallUI && PaywallUI.showPaywallModal && PaywallUI.showPaywallModal({
        reason: 'VIP到期，智能体功能不可用，请续费后继续使用。'
      });
    }

    return false;
  }

  window.AIApp.agents = {
    loadAgentsFromAPI,
    getSelectedAgentConfig,
    updateAgentSelectedBtn,
    renderAIAgentDropdown,
    bindAgentDropdown,
    waitAPIThenLoad,
    ensureVipForAgents,
    resetAgents: () => {
      aiAgents = [];
      selectedAgentIdx = null;
      updateAgentSelectedBtn();
      renderAIAgentDropdown();
    }
  };
})();