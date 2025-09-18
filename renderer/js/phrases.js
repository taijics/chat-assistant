(() => {
  // 话术面板渲染与交互（包在 IIFE 内，避免与其它脚本的 const 冲突）
  const { ipcRenderer } = require('electron');

  const PHRASE_POOL = [
    '亲亲~ 您的订单已收到，我们将尽快为您发货，请耐心等待哦～',
    '这款是店里热销款，质量有保证，七天无理由退换，放心购买～',
    '今天下单享受满200减20活动，叠加店铺优惠券更划算！',
    '收到货有任何问题都可以随时联系我，在线时间 9:00-22:00 哦～',
    '我们支持顺丰/中通等多家快递，默认发中通，需要指定可备注～',
    '库存紧张，建议尽快拍下锁定库存，支持无忧退换～',
    '优惠券我给您申请到了，拍下立减，性价比超高！',
    '尺码偏小半码，建议按平时尺码选大一码更合适哦～',
    '发票可开增值税电子发票，备注抬头和税号即可～',
    '发货时间为工作日当天 17:00 前下单基本都能发出～',
    '亲亲，图片为实拍，颜色在自然光下更接近第二张图～',
    '年终大促，买二送一，拍三件系统自动减免一件～',
    '售后无忧，拆封试用不满意 7 天内无理由退～',
    '这边给您申请优先打包，尽量安排当天出库～',
    '运费险已赠送，退换货邮费险承担，您放心～',
    '这款材料是 A 级面料，亲肤透气，不闷不刺痒～',
    '到货建议先低温清洗，手感会更柔软～',
    '支持货到付款的地区可以选择到付方式～',
    '收藏加购优先发货，有惊喜福利哦～',
    '好评返现活动进行中，详情可咨询我～',
    '联系客服报口令“到店福利”，可再享神秘折扣～',
    '物流更新稍有延迟，实际已在路上，请您放心～',
    '下单备注「礼品」我们会精美包装并不附清单～',
    '如需换色换码，收到货 7 天内直接找我处理～',
    '这批是新到货，版本有小升级，性价比更高～',
    '晚到必赔，超过承诺时效我来为您处理赔付～',
    '支持 24 小时内无理由撤单，拍错也没关系～',
    '亲测偏薄/偏厚，适合春秋/冬季穿着哦～',
    '拍下立减，平台补贴叠加店铺券更省～',
    '赠品随机，都会帮您尽量挑选更实用的～'
  ];

  function sampleUnique(arr, n) {
    const copy = [...arr];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy.slice(0, n);
  }

  function renderPhrasePanel() {
    const phrases = sampleUnique(PHRASE_POOL, 10);

    let panel = document.getElementById('quick-phrases');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'quick-phrases';
      document.body.prepend(panel);
    }

    panel.innerHTML = `
      <h3 class="title">快捷话术（双击插入到微信）</h3>
      <ul class="list">
        ${phrases.map(p => `<li class="phrase-item" title="双击插入">${escapeHtml(p)}</li>`).join('')}
      </ul>
    `;

    panel.querySelectorAll('.phrase-item').forEach(li => {
      li.addEventListener('dblclick', () => {
        const text = li.textContent || '';
        ipcRenderer.send('phrase:paste', text);
      });
    });
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderPhrasePanel);
  } else {
    renderPhrasePanel();
  }
})();