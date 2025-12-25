function createPhrasesDialogs({ state, util }) {
  // 复用 util.$ 但 dialogs 内部更偏 DOM，因此不从外部再传 $/$$ 也行
  const { showToast } = util;

  async function uiPrompt(options) {
    const opts = Object.assign(
      { title: '请输入内容', placeholder: '', defaultValue: '' },
      options || {}
    );

    return new Promise((resolve) => {
      const mask = document.createElement('div');
      mask.className = 'prompt-mask';
      mask.innerHTML = `
        <div class="prompt-dialog" role="dialog" aria-modal="true">
          <div class="prompt-title">${opts.title}</div>
          <div class="prompt-body">
            <textarea class="prompt-input" placeholder="${opts.placeholder || ''}" rows="6"
              style="height:160px;min-height:120px;resize:vertical;line-height:1.5;"></textarea>
          </div>
          <div class="prompt-actions">
            <button class="btn-cancel" type="button">取消</button>
            <button class="btn-ok" type="button">确定</button>
          </div>
        </div>`;
      mask.style.webkitAppRegion = 'no-drag';
      document.body.appendChild(mask);

      const dialog = mask.querySelector('.prompt-dialog');
      const input = mask.querySelector('.prompt-input');
      const btnOk = mask.querySelector('.btn-ok');
      const btnCancel = mask.querySelector('.btn-cancel');

      input.value = opts.defaultValue || '';
      setTimeout(() => {
        input.focus();
        input.select();
      }, 0);

      const close = (val) => {
        if (mask && mask.parentNode) mask.parentNode.removeChild(mask);
        resolve(val);
      };

      btnOk.addEventListener('click', () => close(input.value.trim()));
      btnCancel.addEventListener('click', () => close(null));

      mask.addEventListener('click', (e) => {
        if (e.target === mask) close(null);
      });
      dialog.addEventListener('click', (e) => e.stopPropagation());

      mask.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
          e.preventDefault();
          btnOk.click();
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          btnCancel.click();
        }
      });
      input.addEventListener('keydown', (e) => e.stopPropagation());
    });
  }

  async function uiAddPhraseDialog(opts) {
    const options = Object.assign({ catName: '' }, opts || {});
    return new Promise((resolve) => {
      const mask = document.createElement('div');
      mask.className = 'prompt-mask';
      mask.innerHTML = `
      <div class="prompt-dialog" role="dialog" aria-modal="true" style="width:480px;max-width:90vw;">
        <div class="prompt-title" style="font-size:15px;margin-bottom:10px;">添加短语（${options.catName || ''}）</div>
        <div class="prompt-body" style="display:flex;flex-direction:column;gap:10px;">
          <div class="field">
            <label style="display:block;font-size:13px;color:#555;margin-bottom:6px;">标题</label>
            <input type="text" class="phrase-title" placeholder="请输入标题（可选）"
              style="width:95%;padding:8px;border:1px solid #ccc;border-radius:6px;font-size:13px;" />
          </div>
          <div class="field">
            <label style="display:block;font-size:13px;color:#555;margin-bottom:6px;">内容</label>
            <textarea class="phrase-content" rows="6" placeholder="请输入短语内容"
              style="width:100%;box-sizing:border-box;line-height:1.5;min-height:120px;resize:vertical;"></textarea>
          </div>
        </div>
        <div class="prompt-actions" style="margin-top:12px;display:flex;justify-content:flex-end;gap:8px;">
          <button class="btn-cancel" type="button">取消</button>
          <button class="btn-ok" type="button" disabled style="opacity:.5;cursor:not-allowed;">确定</button>
        </div>
      </div>`;
      document.body.appendChild(mask);

      const dialog = mask.querySelector('.prompt-dialog');
      const inputTitle = mask.querySelector('.phrase-title');
      const inputContent = mask.querySelector('.phrase-content');
      const btnOk = mask.querySelector('.btn-ok');
      const btnCancel = mask.querySelector('.btn-cancel');

      function updateState() {
        const content = (inputContent.value || '').trim();
        btnOk.disabled = !content;
        btnOk.style.opacity = content ? '1' : '.5';
        btnOk.style.cursor = content ? 'pointer' : 'not-allowed';
      }
      inputContent.addEventListener('input', updateState);
      inputTitle.addEventListener('input', updateState);
      updateState();

      setTimeout(() => inputContent.focus(), 0);

      function close(val) {
        if (mask && mask.parentNode) mask.parentNode.removeChild(mask);
        resolve(val);
      }
      btnCancel.onclick = () => close(null);
      btnOk.onclick = () => {
        if (btnOk.disabled) return;
        close({
          title: (inputTitle.value || '').trim(),
          content: (inputContent.value || '').trim(),
        });
      };

      mask.addEventListener('click', (e) => {
        if (e.target === mask) close(null);
      });
      dialog.addEventListener('click', (e) => e.stopPropagation());
      mask.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') close(null);
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !btnOk.disabled) btnOk.click();
      });
    });
  }

  async function uiEditPhraseDialog(initialTitle, initialContent) {
    return new Promise((resolve) => {
      const mask = document.createElement('div');
      mask.className = 'prompt-mask';
      mask.innerHTML = `
      <div class="prompt-dialog" role="dialog" aria-modal="true" style="width:480px;max-width:90vw;">
        <div class="prompt-title" style="font-size:15px;margin-bottom:10px;">编辑短语</div>
        <div class="prompt-body" style="display:flex;flex-direction:column;gap:10px;">
          <div class="field">
            <label style="display:block;font-size:13px;color:#555;margin-bottom:6px;">标题</label>
            <input type="text" class="phrase-title" placeholder="请输入标题（可选）"
              style="width:95%;padding:8px;border:1px solid #ccc;border-radius:6px;font-size:13px;" />
          </div>
          <div class="field">
            <label style="display:block;font-size:13px;color:#555;margin-bottom:6px;">内容</label>
            <textarea class="phrase-content" rows="6" placeholder="请输入短语内容"
              style="width:100%;box-sizing:border-box;line-height:1.5;min-height:120px;resize:vertical;"></textarea>
          </div>
        </div>
        <div class="prompt-actions" style="margin-top:12px;display:flex;justify-content:flex-end;gap:8px;">
          <button class="btn-cancel" type="button">取消</button>
          <button class="btn-ok" type="button" disabled style="opacity:.5;cursor:not-allowed;">确定</button>
        </div>
      </div>`;
      document.body.appendChild(mask);

      const dialog = mask.querySelector('.prompt-dialog');
      const inputTitle = mask.querySelector('.phrase-title');
      const inputContent = mask.querySelector('.phrase-content');
      const btnOk = mask.querySelector('.btn-ok');
      const btnCancel = mask.querySelector('.btn-cancel');

      inputTitle.value = initialTitle || '';
      inputContent.value = initialContent || '';

      function updateState() {
        const content = (inputContent.value || '').trim();
        const changed =
          content !== (initialContent || '').trim() ||
          (inputTitle.value || '').trim() !== (initialTitle || '').trim();

        btnOk.disabled = !changed || !content;
        btnOk.style.opacity = !btnOk.disabled ? '1' : '.5';
        btnOk.style.cursor = !btnOk.disabled ? 'pointer' : 'not-allowed';
      }
      inputTitle.addEventListener('input', updateState);
      inputContent.addEventListener('input', updateState);
      updateState();

      setTimeout(() => inputContent.focus(), 0);

      function close(val) {
        if (mask && mask.parentNode) mask.parentNode.removeChild(mask);
        resolve(val);
      }
      btnCancel.onclick = () => close(null);
      btnOk.onclick = () => {
        if (btnOk.disabled) return;
        close({
          title: (inputTitle.value || '').trim(),
          content: (inputContent.value || '').trim(),
        });
      };

      mask.addEventListener('click', (e) => {
        if (e.target === mask) close(null);
      });
      dialog.addEventListener('click', (e) => e.stopPropagation());
      mask.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') close(null);
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !btnOk.disabled) btnOk.click();
      });
    });
  }

  async function uiAddCategoryDialog(opts) {
    const options = Object.assign({ parents: [], tabLabel: '' }, opts || {});
    return new Promise((resolve) => {
      const mask = document.createElement('div');
      mask.className = 'prompt-mask';
      mask.innerHTML = `
        <div class="prompt-dialog" role="dialog" aria-modal="true" style="width:420px;max-width:90vw;">
          <div class="prompt-title" style="font-size:15px;margin-bottom:10px;">添加类别（${options.tabLabel || ''}）</div>
          <div class="prompt-body" style="display:flex;flex-direction:column;gap:10px;">
            <div class="field">
              <label style="display:block;font-size:13px;color:#555;margin-bottom:6px;">父类</label>
              <select class="parent-select" style="width:100%;padding:8px;border:1px solid #ccc;border-radius:6px;font-size:13px;">
                ${options.parents.map((p) => `<option value="${p.id}">${p.title}</option>`).join('')}
              </select>
            </div>
            <div class="field">
              <label style="display:block;font-size:13px;color:#555;margin-bottom:6px;">类别名称</label>
              <input type="text" class="cat-input" placeholder="请输入类别名称"
                style="width:100%;padding:8px;border:1px solid #ccc;border-radius:6px;font-size:13px;" />
            </div>
          </div>
          <div class="prompt-actions" style="margin-top:12px;display:flex;justify-content:flex-end;gap:8px;">
            <button class="btn-cancel" type="button">取消</button>
            <button class="btn-ok" type="button" disabled style="opacity:.5;cursor:not-allowed;">确定</button>
          </div>
        </div>`;
      document.body.appendChild(mask);

      const dialog = mask.querySelector('.prompt-dialog');
      const sel = mask.querySelector('.parent-select');
      const input = mask.querySelector('.cat-input');
      const btnOk = mask.querySelector('.btn-ok');
      const btnCancel = mask.querySelector('.btn-cancel');

      function updateState() {
        const name = (input.value || '').trim();
        btnOk.disabled = !name;
        btnOk.style.opacity = name ? '1' : '.5';
        btnOk.style.cursor = name ? 'pointer' : 'not-allowed';
      }
      input.addEventListener('input', updateState);
      updateState();

      setTimeout(() => input.focus(), 0);

      function close(val) {
        if (mask && mask.parentNode) mask.parentNode.removeChild(mask);
        resolve(val);
      }
      btnCancel.onclick = () => close(null);
      btnOk.onclick = () => {
        if (btnOk.disabled) return;
        close({ parentId: Number(sel.value || 0), name: (input.value || '').trim() });
      };

      mask.addEventListener('click', (e) => {
        if (e.target === mask) close(null);
      });
      dialog.addEventListener('click', (e) => e.stopPropagation());
      mask.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') close(null);
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !btnOk.disabled) btnOk.click();
      });
    });
  }

  async function uiEditPrompt(initial, title) {
    const mask = document.createElement('div');
    mask.className = 'prompt-mask';
    mask.innerHTML = `
  <div class="prompt-dialog" role="dialog" aria-modal="true" style="width:420px;max-width:90vw;">
    <div class="prompt-title" style="font-size:15px;margin-bottom:10px;">${title || '编辑'}</div>
    <div class="prompt-body">
      <textarea class="prompt-input" rows="6" style="width:100%;box-sizing:border-box;line-height:1.5;"></textarea>
    </div>
    <div class="prompt-actions" style="margin-top:12px;display:flex;justify-content:flex-end;gap:8px;">
      <button class="btn-cancel" type="button">取消</button>
      <button class="btn-ok" type="button" disabled style="opacity:.5;cursor:not-allowed;">确定</button>
    </div>
  </div>`;
    document.body.appendChild(mask);

    const dialog = mask.querySelector('.prompt-dialog');
    const input = mask.querySelector('.prompt-input');
    const btnOk = mask.querySelector('.btn-ok');
    const btnCancel = mask.querySelector('.btn-cancel');

    input.value = initial || '';
    input.focus();

    function updateState() {
      const changed = input.value.trim() !== (initial || '').trim();
      btnOk.disabled = !changed;
      btnOk.style.opacity = changed ? '1' : '.5';
      btnOk.style.cursor = changed ? 'pointer' : 'not-allowed';
    }
    input.addEventListener('input', updateState);
    updateState();

    return new Promise((resolve) => {
      function close(val) {
        mask.remove();
        resolve(val);
      }
      btnCancel.onclick = () => close(null);
      btnOk.onclick = () => {
        if (btnOk.disabled) return;
        close(input.value.trim());
      };

      mask.addEventListener('click', (e) => {
        if (e.target === mask) close(null);
      });
      dialog.addEventListener('click', (e) => e.stopPropagation());
      mask.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') close(null);
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !btnOk.disabled) btnOk.click();
      });
    });
  }

  return {
    uiPrompt,
    uiAddPhraseDialog,
    uiEditPhraseDialog,
    uiAddCategoryDialog,
    uiEditPrompt,
  };
}

module.exports = { createPhrasesDialogs };