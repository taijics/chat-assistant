(function () {
  const { ipcRenderer, clipboard } = require('electron');
  const $ = (sel, root = document) => root.querySelector(sel);

  function genStyles(ctx) {
    const base = (ctx || '').trim() || '（示例上下文：客户咨询发货时间）';
    return [
      { title: '正式', text: `您好，关于您提到的“${base}”，我们已受理并将尽快跟进处理。如有最新进展会第一时间通知您。感谢理解与支持。` },
      { title: '简短', text: `收到“${base}”，我们尽快处理，有结果立即回复您。` },
      { title: '友好', text: `收到啦～关于“${base}”，我们这边已经安排处理中哦，有进展会马上告诉您～` },
      { title: '幽默', text: `关于“${base}”，小助手已火速动身（比外卖还快）🚀，稍等我带来好消息！` },
      { title: '致歉', text: `抱歉让您久等了。关于“${base}”，我们已经在加急处理中，会尽快给到明确反馈。` },
    ];
  }

  function renderList(arr) {
    const list = document.getElementById('ai-suggestions');
    if (!list) return;
    list.innerHTML = arr.map(x => `
      <li>
        <div class="title">${x.title}</div>
        <div class="body">${x.text}</div>
        <div class="ops">
          <button data-op="copy" data-text="${x.text.replace(/"/g, '&quot;')}">复制</button>
          <button data-op="paste" data-text="${x.text.replace(/"/g, '&quot;')}">粘贴到微信</button>
        </div>
      </li>
    `).join('');
  }

  window.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('ai-generate');
    const ta = document.getElementById('ai-context');
    const list = document.getElementById('ai-suggestions');
    if (!btn || !ta || !list) return;

    btn.addEventListener('click', () => renderList(genStyles(ta.value)));

    list.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-op]');
      if (!btn) return;
      const text = btn.dataset.text || '';
      if (!text) return;
      const op = btn.dataset.op;
      if (op === 'copy') clipboard.writeText(text);
      if (op === 'paste') ipcRenderer.send('phrase:paste', text); // 复用现有粘贴逻辑
    });

    // 初始渲染
    renderList(genStyles(''));
  });
})();