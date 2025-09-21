// main/aimodels.js
// 在主进程中注册 BrowserView 相关的 IPC 处理（多实例池 + 持久保留会话）
const { BrowserView, ipcMain, shell } = require('electron');

const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/124.0.0.0 Safari/537.36';

function registerAimodelsHandlers(mainWindow) {
  // 按站点（origin）缓存多个 BrowserView
  const pool = new Map(); // key: origin, value: { view: BrowserView, origin: string, firstUrl: string }
  let currentKey = null;   // 当前附着在窗口上的 view key（origin）
  // 记录最近一次的 bounds，切换/复用时可直接应用
  let lastBounds = { x: 0, y: 0, width: 10, height: 10 };

  const keyFromUrl = (url) => {
    try { return new URL(url).origin; } catch { return url; }
  };

  function createView(url) {
    const view = new BrowserView({
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        partition: 'persist:aimodels', // 所有站点共享同一持久分区（各站点照样按域名隔离会话）
        webSecurity: true,
        // backgroundThrottling 默认开启；保留 view 时浏览器会按平台节流后台页面
      }
    });

    // UA 伪装：去掉 Electron 标识，使用标准 Chrome UA
    try { view.webContents.setUserAgent(CHROME_UA); } catch {}

    // 请求头补齐：提高兼容性（仍不能保证绕过风控/地区限制）
    try {
      const ses = view.webContents.session;
      ses.webRequest.onBeforeSendHeaders((details, callback) => {
        const headers = details.requestHeaders || {};
        headers['User-Agent'] = CHROME_UA;
        headers['Accept-Language'] = headers['Accept-Language'] || 'zh-CN,zh;q=0.9,en;q=0.8';
        headers['Upgrade-Insecure-Requests'] = '1';
        callback({ requestHeaders: headers });
      });
    } catch {}

    // 新窗口统一走系统浏览器
    view.webContents.setWindowOpenHandler(({ url }) => {
      shell.openExternal(url);
      return { action: 'deny' };
    });

    // 默认静音，避免后台视图发声；激活时再取消静音
    try { view.webContents.setAudioMuted(true); } catch {}

    return view;
  }

  async function ensureViewFor(url) {
    const key = keyFromUrl(url);
    if (pool.has(key)) {
      return { key, view: pool.get(key).view, existed: true };
    }
    const view = createView(url);
    // 首次加载
    await view.webContents.loadURL(url, {
      userAgent: CHROME_UA,
      httpReferrer: new URL(url).origin + '/',
    });
    pool.set(key, { view, origin: key, firstUrl: url });
    return { key, view, existed: false };
  }

  function attach(key) {
    const item = pool.get(key);
    if (!item) return false;
    // 先把当前 view 摘掉
    if (currentKey && pool.get(currentKey)) {
      try {
        const cur = pool.get(currentKey).view;
        // 摘掉前静音
        try { cur.webContents.setAudioMuted(true); } catch {}
        mainWindow.removeBrowserView(cur);
      } catch {}
    }
    // 附加新 view
    try {
      const v = item.view;
      mainWindow.setBrowserView(v);
      // 激活时取消静音
      try { v.webContents.setAudioMuted(false); } catch {}
      // 应用最近的 bounds
      v.setBounds({
        x: Math.max(0, Math.round(lastBounds.x)),
        y: Math.max(0, Math.round(lastBounds.y)),
        width: Math.max(0, Math.round(lastBounds.width)),
        height: Math.max(0, Math.round(lastBounds.height)),
      });
      v.setAutoResize({ width: false, height: false });
      currentKey = key;
      return true;
    } catch {
      return false;
    }
  }

  function detachActive() {
    if (!currentKey) return false;
    const item = pool.get(currentKey);
    if (!item) { currentKey = null; return false; }
    try {
      const v = item.view;
      // 摘除但不销毁，保持会话和页面状态
      try { v.webContents.setAudioMuted(true); } catch {}
      mainWindow.removeBrowserView(v);
    } catch {}
    currentKey = null;
    return true;
  }

  // 切换/首建：根据 URL 的 origin 作为 key
  ipcMain.handle('aimodels:switch', async (_e, { url }) => {
    if (!mainWindow) throw new Error('no main window');
    if (!/^https?:\/\//i.test(url)) throw new Error('invalid url');
    const { key } = await ensureViewFor(url);
    attach(key);
    return { ok: true };
  });

  // 调整当前显示中的 BrowserView 尺寸/位置
  ipcMain.handle('aimodels:resize', (_e, { bounds }) => {
    if (!mainWindow || !bounds) return { ok: false };
    lastBounds = { ...bounds };
    if (!currentKey) return { ok: true }; // 暂未附加时仅记录
    const item = pool.get(currentKey);
    if (!item) return { ok: false };
    try {
      item.view.setBounds({
        x: Math.max(0, Math.round(bounds.x)),
        y: Math.max(0, Math.round(bounds.y)),
        width: Math.max(0, Math.round(bounds.width)),
        height: Math.max(0, Math.round(bounds.height)),
      });
      return { ok: true };
    } catch {
      return { ok: false };
    }
  });

  // 离开“AI模型”选项卡：仅摘掉，不销毁
  ipcMain.handle('aimodels:detach', () => {
    const ok = detachActive();
    return { ok };
  });

  // 可选：销毁全部（如果你在设置里提供“释放内存”按钮时调用）
  ipcMain.handle('aimodels:destroyAll', () => {
    try {
      detachActive();
      for (const { view } of pool.values()) {
        try { view.destroy(); } catch {}
      }
      pool.clear();
      return { ok: true };
    } catch {
      return { ok: false };
    }
  });

  // 外部打开：如未传 url，使用当前活动视图的 URL
  ipcMain.handle('aimodels:openExternal', async (_e, { url }) => {
    let toOpen = url;
    if (!toOpen && currentKey && pool.get(currentKey)) {
      try { toOpen = pool.get(currentKey).view.webContents.getURL(); } catch {}
    }
    if (toOpen && /^https?:\/\//i.test(toOpen)) shell.openExternal(toOpen);
    return { ok: true };
  });
}

module.exports = { registerAimodelsHandlers };