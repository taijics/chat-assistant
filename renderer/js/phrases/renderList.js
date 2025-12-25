function createRenderList({ state, util, actions }) {
  function renderList() {
    const listWrap = document.getElementById('phrase-list-' + state.currentTab);
    if (!listWrap) return;

    const data = util.getData();
    const activeCat = util.getActiveCat();
    const top = (data.cats || []).find((c) => c.name === activeCat);

    listWrap.innerHTML = '';

    if (!top) {
      listWrap.innerHTML = `<div style="padding:20px;color:#999;">请选择一级分类</div>`;
      return;
    }

    // ✅ 过滤：通用(items为空)不显示
    const secondsRaw = Array.isArray(top.seconds) ? top.seconds : [];
    const seconds = secondsRaw.filter((sec) => {
      const title = String(sec?.title || '').trim();
      if (title !== '通用') return true;
      const items = Array.isArray(sec?.items) ? sec.items : [];
      return items.length > 0; // 通用有内容才显示
    });

    if (!seconds.length) {
      listWrap.innerHTML = `<div style="padding:20px;color:#999;">暂无二级分类</div>`;
      return;
    }

    const acc = document.createElement('div');
    acc.className = 'phrase-accordion';

    const showOpsHere = util.canShowOps(state.currentTab);

    seconds.forEach((sec, idx) => {
      const secId = sec.id;
      const secTitle = sec.title || '未命名';
      const items = Array.isArray(sec.items) ? sec.items : [];

      const itemEl = document.createElement('div');
      itemEl.className = 'phrase-acc-item';
      itemEl.dataset.secId = String(secId);

      const header = document.createElement('div');
      header.className = 'phrase-acc-header';

      // “通用”右侧不要 + 号（保留你现有逻辑）
      const isGeneric = String(secTitle).trim() === '通用';
      const showAddBtn = showOpsHere && !isGeneric;

      header.innerHTML = `
        <span class="arrow">▾</span>
        <span class="sec-title">${secTitle}</span>
        <span style="flex:1"></span>
        <span class="sec-count">${items.length}</span>
        ${
          showAddBtn
            ? `<button class="sec-add-btn" type="button" title="添加短语" style="
                margin-left:8px;
                width:28px;height:28px;
                border-radius:14px;
                border:1px solid #ddd;
                background:#fff;
                cursor:pointer;
                font-size:18px;
                line-height:26px;
              ">+</button>`
            : ''
        }
      `;

      const body = document.createElement('div');
      body.className = 'phrase-acc-body';

      if (idx !== 0) itemEl.classList.add('collapsed');

      if (!items.length) {
        body.innerHTML = `<div class="phrase-empty">暂无话术</div>`;
      } else {
        const frag = document.createDocumentFragment();
        items.forEach((t) => {
          const el = document.createElement('div');
          el.className = 'phrase-item';
          el.dataset.content = String(t.content || '').replace(/"/g, '&quot;');
          el.dataset.title = String(t.title || '').replace(/"/g, '&quot;');
          el.dataset.id = t.id != null ? String(t.id) : '';
          el.dataset.typeTitle = String(t.typeTitle || '').replace(/"/g, '&quot;');

          el.title = '单击：粘贴内容；双击：粘贴并发送；右键：操作';

          const titleDiv = document.createElement('div');
          titleDiv.className = 'title';
          titleDiv.textContent = (t.title || '').trim();

          const textDiv = document.createElement('div');
          textDiv.className = 'text';
          textDiv.textContent = (t.content || '').trim();

          el.appendChild(titleDiv);
          el.appendChild(textDiv);
          frag.appendChild(el);
        });
        body.appendChild(frag);
      }

      header.addEventListener('click', (e) => {
        if (e.target && e.target.closest && e.target.closest('.sec-add-btn')) return;
        itemEl.classList.toggle('collapsed');
      });

      const addBtn = header.querySelector('.sec-add-btn');
      addBtn &&
        addBtn.addEventListener('click', async (e) => {
          e.preventDefault();
          e.stopPropagation();
          await actions.addPhrase({ secondId: secId, secondTitle: secTitle });
        });

      itemEl.appendChild(header);
      itemEl.appendChild(body);
      acc.appendChild(itemEl);
    });

    listWrap.appendChild(acc);

    if (!listWrap._eventsBound) {
      let singleTimer = null;

      listWrap.addEventListener('click', (e) => {
        const item = e.target.closest('.phrase-item');
        if (!item) return;
        const content = item.dataset.content || '';
        if (!content) return;

        clearTimeout(singleTimer);
        singleTimer = setTimeout(() => {
          actions.sendPhrasePaste(content);
          singleTimer = null;
        }, 300);
      });

      listWrap.addEventListener('dblclick', (e) => {
        const item = e.target.closest('.phrase-item');
        if (!item) return;
        const content = item.dataset.content || '';
        if (!content) return;

        if (singleTimer) {
          clearTimeout(singleTimer);
          singleTimer = null;
        }
        actions.sendPhrasePasteSend(content);
      });

      listWrap._eventsBound = true;
    }
  }

  return renderList;
}

module.exports = { createRenderList };