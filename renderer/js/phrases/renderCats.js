function createRenderCats({ state, util, actions }) {
  function renderCats() {
    const wrap = document.getElementById('phrase-cats-' + state.currentTab);
    if (!wrap) return;

    const data = util.getData();
    const activeCat = util.getActiveCat();

    const MAX_SHOW = 5;
    const catsAll = Array.isArray(data.cats) ? data.cats : [];
    const visibleCats = catsAll.slice(0, MAX_SHOW);
    const moreCats = catsAll.slice(MAX_SHOW);

    const countItemsOfTop = (top) => {
      const seconds = Array.isArray(top?.seconds) ? top.seconds : [];
      return seconds.reduce((sum, s) => sum + (Array.isArray(s?.items) ? s.items.length : 0), 0);
    };

    const catsHtml = visibleCats
      .map(
        (c) => `<button class="cat ${c.name === activeCat ? 'active' : ''}"
     data-id="${c.id}"
     data-cat="${c.name}"
     data-count="${countItemsOfTop(c)}">${c.name}</button>`
      )
      .join('');

    const moreHtml = moreCats.length
      ? `
      <div class="more-wrap" style="position:relative;display:inline-block;">
        <button class="cat more-btn" id="cat-more-btn-${state.currentTab}" title="更多类别">更多...</button>
        <div class="more-dropdown" id="cat-more-dd-${state.currentTab}" aria-hidden="true"
             style="position:absolute;top:100%;left:0;background:#fff;border:1px solid #ddd;box-shadow:0 6px 16px rgba(0,0,0,.12);border-radius:6px;min-width:160px;padding:6px;display:none;z-index:2000;">
          ${moreCats
            .map(
              (mc) => `
            <div class="more-item" data-id="${mc.id}" data-cat="${mc.name}"
                 style="padding:6px 10px;cursor:pointer;font-size:13px;white-space:nowrap;">
              ${mc.name}
            </div>`
            )
            .join('')}
        </div>
      </div>
    `
      : '';

    const showOps = util.canShowOps(state.currentTab);
    const opsHtml = showOps
      ? `
      <button class="add-btn" id="btn-cat-ops-${state.currentTab}" title="添加"><span>＋</span></button>
      <div class="add-dropdown" id="cat-add-dropdown-${state.currentTab}" aria-hidden="true">
        <button class="item" data-action="add-cat" type="button">添加类别</button>
      </div>
    `
      : '';

    wrap.innerHTML = `
      <div class="phrase-cats-bar" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
        <div class="phrase-cats-list">${catsHtml}${moreHtml}</div>
        <div class="phrase-cats-ops">${opsHtml}</div>
      </div>
    `;

    // 类别切换（前 5）
    const list = util.$('.phrase-cats-list', wrap);
    list &&
      list.addEventListener('click', async (e) => {
        const btn = e.target.closest('.cat');
        if (!btn) return;
        if (btn.classList.contains('more-btn')) return;

        const name = btn.dataset.cat;
        if (!name) return;

        util.setActiveCat(name);
        util.$$('.cat', list).forEach((b) => b.classList.toggle('active', b === btn));
        window.__phrases?.renderList?.();
      });

    // ===== “更多...” 下拉：打开只能点更多；关闭=点任意地方（含容器内其它区域） =====
    const moreBtn = util.$(`#cat-more-btn-${state.currentTab}`, wrap);
    const moreDd = util.$(`#cat-more-dd-${state.currentTab}`, wrap);

    function isMoreOpen() {
      return !!(moreDd && moreDd.style.display === 'block');
    }
    function openMore() {
      if (!moreDd) return;
      moreDd.style.display = 'block';
      moreDd.setAttribute('aria-hidden', 'false');
    }
    function closeMore() {
      if (!moreDd) return;
      moreDd.style.display = 'none';
      moreDd.setAttribute('aria-hidden', 'true');
    }
    function toggleMore() {
      if (isMoreOpen()) closeMore();
      else openMore();
    }

    // 只允许点“更多...”按钮打开/关闭
    moreBtn &&
      moreBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation(); // 防止立刻被全局 click-close 关掉
        toggleMore();
      });

    // 选中 “更多...” 里的某一项
    moreDd &&
      moreDd.addEventListener('click', async (e) => {
        const item = e.target.closest('.more-item');
        if (!item) return;

        e.preventDefault();
        e.stopPropagation();

        const selName = item.dataset.cat;
        const selId = item.dataset.id;

        const idx = catsAll.findIndex((c) => String(c.id) === String(selId));
        if (idx >= 0) {
          const [picked] = catsAll.splice(idx, 1);
          catsAll.unshift(picked);
        }

        util.setActiveCat(selName);
        renderCats();
        window.__phrases?.renderList?.();
        closeMore();
      });

    // 关键：全局捕获监听（只绑定一次），点任何地方都关闭 “更多”
    // - 用 capture:true 可以绕开你内部的 stopPropagation
    // - 只在点到 more-wrap 外面才关
    if (!document.__phrasesMoreCloseBound) {
      document.__phrasesMoreCloseBound = true;
      document.addEventListener(
        'click',
        (e) => {
          try {
            const anyOpen = document.querySelector('.more-dropdown[aria-hidden="false"]');
            if (!anyOpen) return;

            // 如果点击发生在 more-wrap 内，不关闭（避免点下拉内部被关）
            const inMore = e.target && e.target.closest && e.target.closest('.more-wrap');
            if (inMore) return;

            // 关闭所有已打开的 more
            document.querySelectorAll('.more-dropdown[aria-hidden="false"]').forEach((dd) => {
              dd.style.display = 'none';
              dd.setAttribute('aria-hidden', 'true');
            });
          } catch {}
        },
        true
      );
    }

    // ===== 下面保持你原来的 “+ 添加类别” 下拉逻辑不变 =====
    const opsBtn = util.$(`#btn-cat-ops-${state.currentTab}`, wrap);
    const dd = util.$(`#cat-add-dropdown-${state.currentTab}`, wrap);

    function openDropdown() {
      dd && dd.classList.add('open');
      dd && dd.setAttribute('aria-hidden', 'false');
    }
    function closeDropdown() {
      if (!dd) return;
      dd.classList.remove('open');
      dd.setAttribute('aria-hidden', 'true');
    }

    opsBtn &&
      opsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (dd && dd.classList.contains('open')) closeDropdown();
        else openDropdown();
      });

    dd &&
      dd.addEventListener(
        'click',
        (e) => {
          const item = e.target.closest('.item');
          if (!item) return;
          e.stopPropagation();

          const act = item.dataset.action;
          closeDropdown();
          setTimeout(async () => {
            if (act === 'add-cat') await actions.addCategory();
          }, 0);
        },
        { capture: true }
      );

    // 保持原逻辑：点击任意地方关闭 add-dropdown（如果你也希望同样用 capture，可再改）
    document.body.addEventListener('click', () => {
      closeDropdown();
      // 注意：more 现在由全局 document capture 处理，不需要在这里关
    });

    wrap.querySelector('.phrase-cats-bar')?.addEventListener('click', (e) => e.stopPropagation());
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeDropdown();
        closeMore();
      }
    });
  }

  return renderCats;
}

module.exports = { createRenderCats };