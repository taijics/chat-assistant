(function () {
  const pages = {
    vip:   { title: 'VIP 充值', el: null },
    api:   { title: '接口设置', el: null },
    agent: { title: '智能体选择', el: null }, // ✅ 新增
    tasks: { title: '任务设置（预留）', el: null },
    me:    { title: '我的（预留）', el: null },
  };

  function getPages() { return pages; }

  window.SettingsPages = { getPages };
})();