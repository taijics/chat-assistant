(function () {
  const LS_VIP_EXPIRE = 'auth.vipExpireTime';

  function getVipExpireTime() {
    try {
      return localStorage.getItem(LS_VIP_EXPIRE) || '';
    } catch {
      return '';
    }
  }

  function parseVipExpire(v) {
    if (!v) return null;
    const s = String(v).trim();
    // 兼容 "YYYY-MM-DD HH:mm:ss" / "YYYY-MM-DDTHH:mm:ss"
    const normalized = s.replace('T', ' ').replace(/\.\d+Z?$/, '');
    const ms = Date.parse(normalized.replace(/-/g, '/')); // 兼容 Safari
    if (!isNaN(ms)) return new Date(ms);
    // 兜底：只取日期
    const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
    if (m) return new Date(m[1] + ' 23:59:59');
    return null;
  }

  function isVipExpired() {
    const exp = parseVipExpire(getVipExpireTime());
    if (!exp) return true; // 没有数据就按过期处理（更安全）
    return exp.getTime() < Date.now();
  }

  window.AuthVip = { getVipExpireTime, isVipExpired, parseVipExpire };
})();