(function() {
  const {
    $,
    escapeHtml,
    showToast
  } = window.SettingsDOM;

  const els = {
    tbody: () => $('#agent-tbody'),
    addBtn: () => $('#agent-add-btn'),
    refreshBtn: () => $('#agent-refresh-btn'),

    modal: () => $('#agent-modal'),
    mask: () => $('#agent-modal-mask'),
    close: () => $('#agent-modal-close'),
    cancel: () => $('#agent-modal-cancel'),
    save: () => $('#agent-modal-save'),
    modalTitle: () => $('#agent-modal-title'),

    inpTitle: () => $('#agent-title'),
    inpToken: () => $('#agent-kzToken'),
    inpBotId: () => $('#agent-botId'),
    inpExpire: () => $('#agent-expireDate'),

    selLong: () => $('#agent-isLongTime'),
    selStats: () => $('#agent-stats'),
    expireRow: () => $('#agent-expire-row'),
  };

  let _list = [];
  let _editing = null; // null=新增；否则 = 当前编辑对象

  function isLoggedIn() {
    const token = (window.API && API.getToken && API.getToken()) || '';
    return !!token;
  }

  // 可选：如果你希望非 VIP 不允许操作
  function isVipOk() {
    try {
      // 你项目里已有 AuthVip
      // isVipExpired() === true 表示过期/不是会员
      return !(window.AuthVip?.isVipExpired?.());
    } catch {
      // 如果取不到，就先按允许（避免误伤）
      return true;
    }
  }

  function asBool(v) {
    // 兼容：true/false, 0/1, "0"/"1", bit(2) 序列化（可能是 0/1）
    if (v === true) return true;
    if (v === false) return false;
    if (v == null) return false;
    const s = String(v).trim();
    return s === '1' || s.toLowerCase() === 'true';
  }

  function normalizeExpireDate(v) {
    if (!v) return '';
    // 可能是 "2026-01-06" 或 "2026-01-06 00:00:00" 或 ISO
    const s = String(v).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
    return m ? m[1] : s;
  }
  // ✅ 控制“到期日”是否显示
  function syncExpireVisibility() {
    const isLong = (els.selLong()?.value || '0') === '1';
    const row = els.expireRow();
    const inp = els.inpExpire();
    if (!row || !inp) return;

    if (isLong) {
      row.style.display = 'none';
      inp.value = ''; // 长期有效时清空到期日
    } else {
      row.style.display = '';
    }
  }

  function statsText(stats) {
    // 你表里 stats 是 int；你业务可自行调整
    if (String(stats) === '1') return '启用';
    if (String(stats) === '0') return '停用';
    return String(stats ?? '-');
  }

  function typeBadge(isLongTime) {
    return asBool(isLongTime) ? `<span class="badge">长期</span>` : `<span class="badge ghost">期限</span>`;
  }

  function openModal(mode, data) {
    const m = els.modal();
    if (!m) return;

    // VIP 控制（可选）
    if (!isVipOk()) {
      showToast('VIP 会员才可操作智能体', {
        type: 'error',
        duration: 1500
      });
      return;
    }

    _editing = mode === 'edit' ? (data || null) : null;

    if (els.modalTitle()) els.modalTitle().textContent = mode === 'edit' ? '编辑智能体' : '新增智能体';

    if (els.inpTitle()) els.inpTitle().value = data?.title ?? '';
    if (els.inpToken()) els.inpToken().value = data?.kzToken ?? data?.kz_token ?? '';
    if (els.inpBotId()) els.inpBotId().value = data?.botId ?? data?.bot_id ?? '';
    if (els.inpExpire()) els.inpExpire().value = normalizeExpireDate(data?.expireDate ?? data?.expire_date);

    // ✅ 先设置长期有效，再决定是否显示到期日
    if (els.selLong()) els.selLong().value = asBool(data?.isLongTime ?? data?.is_long_time) ? '1' : '0';

    // 到期日：只在“长期有效=否”时赋值（否则会被清空）
    const exp = normalizeExpireDate(data?.expireDate ?? data?.expire_date);
    if (els.inpExpire()) els.inpExpire().value = exp;

    if (els.selStats()) els.selStats().value = (data?.stats != null ? String(data.stats) : '1');
    // ✅ 最后同步可见性（会在长期=是时隐藏并清空）
    syncExpireVisibility();
    m.style.display = '';
  }

  function closeModal() {
    const m = els.modal();
    if (!m) return;
    m.style.display = 'none';
    _editing = null;
  }

  function readForm() {
    const title = (els.inpTitle()?.value || '').trim();
    const kzToken = (els.inpToken()?.value || '').trim();
    const botId = (els.inpBotId()?.value || '').trim();

    const isLongTime = (els.selLong()?.value || '0') === '1';
    const stats = Number(els.selStats()?.value ?? 1);

    // ✅ 长期=是 -> expireDate 必须为空
    let expireDate = (els.inpExpire()?.value || '').trim();
    if (isLongTime) expireDate = '';

    if (!title) throw new Error('名称不能为空');
    if (!kzToken) throw new Error('Token不能为空');
    if (!botId) throw new Error('BotId不能为空');

    if (expireDate && !/^\d{4}-\d{2}-\d{2}$/.test(expireDate)) {
      throw new Error('到期日格式不正确，应为 yyyy-MM-dd');
    }

    // ✅ 后端 MyAgentReq 只接收：title kzToken botId expireDate
    // 你如果要让 isLongTime/stats 生效，需要后端 MyAgentReq 也加字段并传到 service
    // 目前先把它们带上（如果后端忽略也不会报错；如果 strict 校验会报 400，再删）
    return {
      title,
      kzToken,
      botId,
      expireDate: expireDate || null,
      isLongTime,
      stats
    };
  }

  function renderList() {
    const tbody = els.tbody();
    if (!tbody) return;

    if (!_list.length) {
      tbody.innerHTML = `<tr><td colspan="4" class="muted">暂无智能体</td></tr>`;
      return;
    }

    const vipOk = isVipOk();

    tbody.innerHTML = _list.map((a, idx) => {
      const title = a.title ?? '-';
      const botId = a.botId ?? a.bot_id ?? '-';

      // expireDate：长期则显示“长期”，否则显示日期
      const isLong = asBool(a.isLongTime ?? a.is_long_time);
      const expireDate = isLong ? '长期有效' : (normalizeExpireDate(a.expireDate ?? a.expire_date) || '-');

      const badge = typeBadge(isLong);

      // 操作：非 VIP 只展示“查看”
      const ops = vipOk ?
        `
          <button class="btn ghost" data-edit="${idx}">编辑</button>
          <button class="btn ghost" data-del="${idx}" style="margin-left:8px; border-color:#ffd1d1; color:#b91c1c;">删除</button>
        ` :
        `<span class="muted">VIP可编辑</span>`;

      return `
        <tr>
          <td>
            <div style="display:flex; gap:8px; align-items:center;">
              ${badge}
              <span>${escapeHtml(String(title))}</span>
            </div>
            <div class="muted" style="margin-top:4px;">状态：${escapeHtml(statsText(a.stats))}</div>
          </td>
          <td>${escapeHtml(String(botId))}</td>
          <td>${escapeHtml(String(expireDate))}</td>
          <td>${ops}</td>
        </tr>
      `;
    }).join('');

    tbody.querySelectorAll('button[data-edit]').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.getAttribute('data-edit'));
        const item = _list[idx];
        if (item) openModal('edit', item);
      });
    });

    tbody.querySelectorAll('button[data-del]').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.getAttribute('data-del'));
        const item = _list[idx];
        if (item) removeAgent(item);
      });
    });
  }

  async function load() {
    const tbody = els.tbody();
    // ✅ 新增：卡片容器
    const grid = document.getElementById('agent-grid');
    const empty = document.getElementById('agent-empty');

    // 如果你已经把 settings.html 改成 grid 版，这里 tbody 可能不存在了
    // 所以不要 return，改成同时兼容 tbody/grid 两种
    if (!tbody && !grid) return;

    if (!isLoggedIn()) {
      if (tbody) tbody.innerHTML = `<tr><td colspan="4" class="muted">请先在主界面登录</td></tr>`;
      if (grid) {
        grid.innerHTML = '';
        if (empty) {
          empty.textContent = '请先在主界面登录';
          grid.appendChild(empty);
        }
      }
      return;
    }

    if (tbody) tbody.innerHTML = `<tr><td colspan="4" class="muted">加载中...</td></tr>`;
    if (grid) {
      grid.innerHTML = '';
      if (empty) {
        empty.textContent = '加载中...';
        grid.appendChild(empty);
      }
    }

    try {
      const resp = await API.get('/api/front/vip/list');
      const ok = resp && (resp.status === 'success' || resp.status === '成功');
      _list = ok && Array.isArray(resp.data) ? resp.data : [];

      // ✅ 这里就是你要加的地方：把列表渲染成卡片
      renderAgentCards(_list);

      // （可选）如果你还保留 table，也可以继续渲染
      // renderList();
    } catch (e) {
      const msg = `加载失败：${escapeHtml(e.message || 'error')}`;
      if (tbody) tbody.innerHTML = `<tr><td colspan="4" class="muted">${msg}</td></tr>`;
      if (grid) {
        grid.innerHTML = '';
        if (empty) {
          empty.textContent = msg;
          grid.appendChild(empty);
        }
      }
    }
  }

  async function saveAgent() {
    // VIP 控制（可选）
    if (!isVipOk()) {
      showToast('VIP 会员才可操作智能体', {
        type: 'error',
        duration: 1500
      });
      return;
    }

    try {
      const payload = readForm();

      if (_editing?.id) {
        await API.post('/api/front/vip/update', {
          id: Number(_editing.id),
          ...payload
        });
        showToast('已保存', {
          type: 'success',
          duration: 1200
        });
      } else {
        await API.post('/api/front/vip/add', payload);
        showToast('已新增', {
          type: 'success',
          duration: 1200
        });
      }

      closeModal();
      await load();
    } catch (e) {
      showToast(e.message || '保存失败', {
        type: 'error',
        duration: 1500
      });
    }
  }

  async function removeAgent(item) {
    // VIP 控制（可选）
    if (!isVipOk()) {
      showToast('VIP 会员才可操作智能体', {
        type: 'error',
        duration: 1500
      });
      return;
    }

    const id = item?.id;
    if (!id) return;

    const ok = window.confirm(`确定删除智能体「${item.title || id}」吗？`);
    if (!ok) return;

    try {
      await API.post('/api/front/vip/delete', {
        id: Number(id)
      });
      showToast('已删除', {
        type: 'success',
        duration: 1200
      });
      await load();
    } catch (e) {
      showToast(e.message || '删除失败', {
        type: 'error',
        duration: 1500
      });
    }
  }



  function renderAgentCards(list) {
    const grid = document.getElementById('agent-grid');
    const empty = document.getElementById('agent-empty');
    if (!grid) return;

    const arr = Array.isArray(list) ? list : [];

    if (!arr.length) {
      if (empty) empty.textContent = '暂无智能体';
      grid.innerHTML = '';
      grid.appendChild(empty);
      return;
    }

    // 清空“加载中...”
    grid.innerHTML = '';

    const frag = document.createDocumentFragment();

    for (const a of arr) {
      // 兼容字段名：按你接口实际字段调整
      const id = a.id ?? a.agentId ?? '';
      const title = a.title ?? a.name ?? '未命名';
      const botId = a.botId ?? a.bot_id ?? '';
      const expire = a.expireDate ?? a.expire ?? a.expireTime ?? '';
      const enabled = String(a.status ?? a.stats ?? a.enabled ?? '1') !== '0';

      const card = document.createElement('div');
      card.className = 'agent-card';
      card.dataset.id = String(id);

      card.innerHTML = `
      <div class="agent-card-head">
        <div class="agent-title" title="${escapeHtml(title)}">${escapeHtml(title)}</div>
        <div class="agent-status ${enabled ? 'on' : 'off'}">${enabled ? '启用' : '停用'}</div>
      </div>

      <div class="agent-meta">
        <div class="kv"><div class="k">BotId</div><div class="v">${escapeHtml(botId)}</div></div>
        <div class="kv"><div class="k">到期</div><div class="v">${escapeHtml(expire || '-')}</div></div>
      </div>

      <div class="agent-card-footer">
        <button class="btn ghost" data-action="edit">编辑</button>
        <button class="btn ghost" data-action="delete" style="border-color:#ffd0d0;color:#b91c1c;">删除</button>
      </div>
    `;

      // 事件：编辑/删除（这里调用你原来已有的函数）
      card.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-action]');
        if (!btn) return;
        const action = btn.dataset.action;

        if (action === 'edit') openModal('edit', a);
        else if (action === 'delete') removeAgent(a);
      });

      frag.appendChild(card);
    }

    grid.appendChild(frag);
  }

  function bind() {
    els.addBtn()?.addEventListener('click', () => openModal('add', {}));
    els.refreshBtn()?.addEventListener('click', load);

    els.close()?.addEventListener('click', closeModal);
    els.cancel()?.addEventListener('click', closeModal);
    els.mask()?.addEventListener('click', closeModal);
    els.save()?.addEventListener('click', saveAgent);
    // ✅ 监听长期有效变化
    els.selLong()?.addEventListener('change', syncExpireVisibility);


    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && els.modal()?.style.display !== 'none') closeModal();
    });
  }

  if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', bind);
  else bind();

  window.SettingsAgent = {
    load,
    bind
  };
})();