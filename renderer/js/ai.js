(function () {
  const path = require('path');
  const fs = require('fs');

  // 1) 先尝试以 cwd 作为项目根（开发时通常可用）
  const candidates = [
    path.join(process.cwd(), 'renderer', 'js'),           // ✅ 你的结构：<root>/renderer/js
    path.join(process.cwd(), 'resources', 'renderer', 'js'), // 打包后可能在 resources 下（可选）
    path.join(__dirname) // 最后兜底（不可靠，但留着）
  ];

  function requireFromJsDir(jsDir, rel) {
    const full = path.join(jsDir, rel);
    if (!fs.existsSync(full)) return false;
    require(full);
    return true;
  }

  function loadAll(jsDir) {
    const ok =
      requireFromJsDir(jsDir, path.join('ai', 'ai.constants.js')) &&
      requireFromJsDir(jsDir, path.join('ai', 'ai.toast.js')) &&
      requireFromJsDir(jsDir, path.join('ai', 'ai.utils.js')) &&
      requireFromJsDir(jsDir, path.join('ai', 'ai.ocr.js')) &&
      requireFromJsDir(jsDir, path.join('ai', 'ai.suggestions.js')) &&
      requireFromJsDir(jsDir, path.join('ai', 'ai.agents.js')) &&
      requireFromJsDir(jsDir, path.join('ai', 'ai.actions.js')) &&
      requireFromJsDir(jsDir, path.join('ai', 'ai.bootstrap.js'));
    return ok;
  }

  let loaded = false;
  for (const jsDir of candidates) {
    try {
      if (loadAll(jsDir)) {
        loaded = true;
        break;
      }
    } catch (e) {}
  }

  if (!loaded) {
    const tried = candidates.join('\n- ');
    throw new Error('AI modules load failed. Tried:\n- ' + tried);
  }
})();