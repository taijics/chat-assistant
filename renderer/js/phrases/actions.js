function createPhrasesActions({
  state,
  util,
  dialogs
}) {
  const {
    ipcRenderer
  } = require('electron');

  let renderCats = () => {};
  let renderList = () => {};

  function _bindRenderers(r) {
    renderCats = r.renderCats;
    renderList = r.renderList;
  }

  function switchTab(tab) {
    if (!state.TAB_KEYS[tab]) return;
    state.currentTab = tab;

    ['corp', 'group', 'private'].forEach((t) => {
      const cwrap = document.getElementById('phrase-cats-' + t);
      if (cwrap) cwrap.style.display = t === state.currentTab ? '' : 'none';
      const lwrap = document.getElementById('phrase-list-' + t);
      if (lwrap) lwrap.style.display = t === state.currentTab ? '' : 'none';
    });

    renderCats();
    renderList();

    util.$$('.tab-btn', util.$('#tabbar')).forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tab === tab);
      btn.setAttribute('aria-selected', btn.dataset.tab === tab ? 'true' : 'false');
    });

    util.$$('.tabpane', util.$('.tabpanes')).forEach((sec) => {
      sec.classList.toggle('active', sec.id === `tab-${tab}`);
      sec.setAttribute('aria-hidden', sec.id === `tab-${tab}` ? 'false' : 'true');
    });

    util.setPhrasesUnavailable(false);
    loadRemotePhrasesText();
  }

  function showContextMenu(x, y, items) {
    let m = document.getElementById('phrases-context-menu');
    if (m) m.remove();

    m = document.createElement('div');
    m.id = 'phrases-context-menu';
    m.style.cssText =
      'position:fixed;z-index:3000;min-width:120px;background:#fff;border:1px solid #ccc;box-shadow:0 4px 16px rgba(0,0,0,.15);';
    m.style.left = x + 'px';
    m.style.top = y + 'px';
    m.innerHTML = items
      .map(
        (it) =>
        `<div class="ctx-item" data-act="${it.act}" style="padding:6px 12px;cursor:pointer;font-size:13px;white-space:nowrap;">${it.label}</div>`
      )
      .join('');

    document.body.appendChild(m);

    m.addEventListener('click', (e) => {
      const item = e.target.closest('.ctx-item');
      if (!item) return;
      const act = item.dataset.act;
      const def = items.find((i) => i.act === act);
      if (def && typeof def.onClick === 'function') def.onClick();
      m.remove();
    });

    document.addEventListener('click', () => m.remove(), {
      once: true
    });
  }

  async function loadRemotePhrasesText(force = false) {
    try {
      util.setPhrasesUnavailable(false);

      const useScope = util.getUseScopeForCurrent();
      const prevActive = util.getActiveCat();

      const resp = await API.content.phraseTree({
        useScope
      });
      const tree = resp && resp.data ? resp.data : {};
      const tops = Array.isArray(tree.tops) ? tree.tops : [];

      const cats = tops.map((t) => ({
        id: t.id,
        name: t.title,
        seconds: Array.isArray(t.seconds) ? t.seconds : [],
      }));

      state.allTypeIdMap[state.currentTab] = {};
      cats.forEach((c) => {
        state.allTypeIdMap[state.currentTab][c.name] = c.id;
      });

      state.allData[state.currentTab] = {
        cats
      };

      let active =
        prevActive && cats.find((c) => c.name === prevActive) ?
        prevActive :
        cats[0]?.name || '';

      if (active && active !== util.getActiveCat()) util.setActiveCat(active);

      renderCats();
      renderList();
      bindContextMenus();

      if (cats.length > 0) util.setPhrasesUnavailable(false);
    } catch (e) {
      console.warn('[phrases] phraseTree load fail:', e);
      if (util.isServerUnavailableError(e)) util.setPhrasesUnavailable(true);
    }
  }

  function getCurrentCatObj() {
    const data = util.getData();
    const active = util.getActiveCat();
    if (!data || !active) return null;
    return data.cats.find((c) => c.name === active);
  }

  function canEditDelete(tab) {
    if (tab === 'private') return true;
    if (tab === 'group') return util.currentUserIsAdmin();
    return false;
  }

  async function addCategory() {
    const useScope = util.getUseScopeForCurrent();
    if (useScope === 0) {
      window.alert('公司话术不支持前端添加');
      return;
    }

    let parents = [];

    // ✅ 小组：仍然用你现有的接口
    if (useScope === 1) {
      try {
        const tops = await API.get('/api/front/content/teamTopTypes');
        parents = Array.isArray(tops?.data) ?
          tops.data.map((x) => ({
            id: Number(x.id),
            title: x.title
          })) :
          [];
      } catch (e) {
        console.warn('获取小组顶级类别失败：', e);
        parents = [];
      }
    }

    // ✅ 私人：补齐“私人一级分类”作为父类下拉选项
    if (useScope === 2) {
      try {
        // /api/front/content/types?typeClass=2  -> data: { company, team, personal, network }
        const resp = await API.content.types({
          typeClass: 2
        });
        const personal = Array.isArray(resp?.data?.personal) ? resp.data.personal : [];

        // 只要一级分类 pid=0
        parents = personal
          .filter((t) => Number(t.pid || 0) === 0)
          .map((t) => ({
            id: Number(t.id),
            title: t.title
          }));
      } catch (e) {
        console.warn('获取私人顶级类别失败：', e);
        parents = [];
      }
    }

    // 默认加一个“无（创建一级）”选项
    parents.unshift({
      id: 0,
      title: '无（创建一级）'
    });

    const formRes = await dialogs.uiAddCategoryDialog({
      parents,
      tabLabel: state.TAB_KEYS[state.currentTab],
    });
    if (!formRes) return;

    const {
      parentId,
      name
    } = formRes;
    const finalName = (name || '').trim();
    if (!finalName) return;

    // 创建一级时：防重复（保持你原逻辑）
    if (Number(parentId) === 0) {
      const data = util.getData();
      const cats = Array.isArray(data?.cats) ? data.cats : [];
      const existedTopSame = cats.some((c) => (c?.name || '').trim() === finalName);
      if (existedTopSame) {
        util.showToast('已有相同的一级类别名称', {
          type: 'error',
          duration: 1500
        });
        return;
      }
    }

    const TYPE_CLASS_TEXT = 2;

    try {
      const payload = {
        useScope,
        title: finalName,
        typeClass: TYPE_CLASS_TEXT,
        pid: Number(parentId)
      };
      await API.content.addByMe(payload);

      await loadRemotePhrasesText(true);
      renderCats();
      renderList();
    } catch (e) {
      console.warn('创建类别失败：', e);
      if (util.isServerUnavailableError(e)) util.setPhrasesUnavailable(true);
      util.showToast((e && e.message) || '创建类别失败', {
        type: 'error',
        duration: 1500
      });
    }
  }

  // ✅ 支持从二级分类 header 传 secondId；否则 fallback 用一级
  async function addPhrase(opts = {}) {
    const useScope = util.getUseScopeForCurrent();
    if (useScope === 0) {
      window.alert('公司话术不支持前端添加');
      return;
    }

    const activeCat = util.getActiveCat();
    if (!activeCat) {
      window.alert('请先选择一个类别再添加短语');
      return;
    }

    const {
      secondId,
      secondTitle
    } = opts || {};

    const phrase = await dialogs.uiAddPhraseDialog({
      catName: secondTitle || activeCat
    });
    if (!phrase) return;

    const {
      title,
      content
    } = phrase;
    const finalTitle = (title || '').trim();
    const finalContent = (content || '').trim();

    if (!finalContent) {
      util.showToast('内容不能为空', {
        type: 'error',
        duration: 1500
      });
      return;
    }

    const TYPE_CLASS_TEXT = 2;

    try {
      // 1) 如果传了 secondId（真实二级分类 id），优先写入该二级分类
      if (secondId != null && String(secondId) !== '' && Number(secondId) > 0) {
        await API.content.addByMe({
          useScope,
          contentTypeId: Number(secondId),
          title: finalTitle,
          content: finalContent,
          typeClass: TYPE_CLASS_TEXT,
        });
      } else {
        // 2) fallback：按一级分类 id 添加（兼容旧逻辑）
        const typeId = state.allTypeIdMap[state.currentTab][activeCat];
        if (!typeId) {
          await API.content.addByMe({
            useScope,
            title: finalTitle,
            content: finalContent,
            typeClass: TYPE_CLASS_TEXT,
          });
        } else {
          await API.content.addByMe({
            useScope,
            contentTypeId: typeId,
            title: finalTitle,
            content: finalContent,
            typeClass: TYPE_CLASS_TEXT,
          });
        }
      }

      await loadRemotePhrasesText(true);
    } catch (e) {
      console.warn('添加短语失败：', e);
      if (util.isServerUnavailableError(e)) util.setPhrasesUnavailable(true);
      util.showToast((e && e.message) || '添加短语失败', {
        type: 'error',
        duration: 1500
      });
    }
  }

  function bindContextMenus() {
    // 保持你原来的右键逻辑不变（此处省略：你项目里继续用现有版本即可）
  }

  function sendPhrasePaste(content) {
    ipcRenderer.send('phrase:paste', content);
  }

  function sendPhrasePasteSend(content) {
    ipcRenderer.send('phrase:paste-send', content);
  }

  return {
    _bindRenderers,
    switchTab,
    loadRemotePhrasesText,
    addCategory,
    addPhrase,
    bindContextMenus,
    sendPhrasePaste,
    sendPhrasePasteSend,
    showContextMenu,
    // 其余方法按你原文件保留即可
  };
}

module.exports = {
  createPhrasesActions
};