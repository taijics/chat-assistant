(function () {
  const { ipcRenderer } = require('electron');
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  // 示例数据：后续可改为从本地 JSON 或设置加载
  const phraseData = [
    { cat: '问候', text: '您好，请问有什么可以帮您？' },
    { cat: '问候', text: '在的，看到消息会尽快回复～' },
    { cat: '跟进', text: '想跟您确认下，前面的问题是否已经解决？' },
    { cat: '跟进', text: '我们这边可以安排在今天内处理完，您看可以吗？' },
    { cat: '致谢', text: '收到，感谢反馈！' },
    { cat: '致谢', text: '谢谢支持，有需要随时联系～' },
  ];

  function render() {
    const catsWrap = $('#phrase-cats');
    const listWrap = $('#phrase-list');
    if (!catsWrap || !listWrap) return;

    const cats = Array.from(new Set(phraseData.map(x => x.cat)));
    catsWrap.innerHTML = cats.map((c, i) => `<button class="cat ${i===0?'active':''}" data-cat="${c}">${c}</button>`).join('');

    function drawList(activeCat) {
      const rows = phraseData.filter(x => !activeCat || x.cat === activeCat);
      listWrap.innerHTML = rows.map(x => `
        <div class="phrase-item" data-text="${x.text.replace(/"/g, '&quot;')}">
          <div class="text">${x.text}</div>
          <div class="meta">${x.cat}</div>
        </div>
      `).join('');
    }

    // 初始
    const first = cats[0];
    drawList(first);

    // 切换类别
    catsWrap.addEventListener('click', (e) => {
      const btn = e.target.closest('.cat');
      if (!btn) return;
      $$('.cat', catsWrap).forEach(b => b.classList.toggle('active', b === btn));
      drawList(btn.dataset.cat);
    });

    // 双击发送到微信
    listWrap.addEventListener('dblclick', (e) => {
      const item = e.target.closest('.phrase-item');
      if (!item) return;
      const text = item.dataset.text || '';
      if (text) ipcRenderer.send('phrase:paste', text);
    });
  }

  window.addEventListener('DOMContentLoaded', render);
})();