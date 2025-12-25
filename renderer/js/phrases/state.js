function createPhrasesState() {
  const TAB_KEYS = {
    corp: '公司话术',
    group: '小组话术',
    private: '私人话术',
  };

  // 纯内存数据（不再读写 localStorage）
  const loadData = () => ({ cats: [] });
  const loadActiveCat = (_tab, data) =>
    data && Array.isArray(data.cats) && data.cats.length ? data.cats[0].name : '';

  const allData = {
    corp: loadData(),
    group: loadData(),
    private: loadData(),
  };

  const allActiveCat = {
    corp: loadActiveCat('corp', allData.corp),
    group: loadActiveCat('group', allData.group),
    private: loadActiveCat('private', allData.private),
  };

  // 记录“类别名称 -> 后端类别ID”的映射，给新增短语用
  const allTypeIdMap = {
    corp: {},
    group: {},
    private: {},
  };

  return {
    TAB_KEYS,
    currentTab: 'corp',

    allData,
    allActiveCat,
    allTypeIdMap,

    listRenderSeq: { corp: 0, group: 0, private: 0 }, // 保留（虽然当前未使用）
  };
}

module.exports = { createPhrasesState };