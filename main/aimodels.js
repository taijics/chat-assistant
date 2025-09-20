// main/aimodels.js
// 在主进程中注册 BrowserView 相关的 IPC 处理
const { BrowserView, ipcMain, shell, session } = require('electron');

const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/124.0.0.0 Safari/537.36';

function registerAimodelsHandlers(mainWindow) {
  let view = null;

  function ensureView() {
    if (view) return view;
    view = new BrowserView({
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        partition: 'persist:aimodels',
        webSecurity: true,
      }
    });

    // 调整 UA（去掉 Electron 标识，伪装常规 Chrome）
    try {
      view.webContents.setUserAgent(CHROME_UA);
    } catch {}

    // 统一补齐请求头，提升兼容性
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

    // 拦截 window.open，新窗口走系统默认浏览器
    view.webContents.setWindowOpenHandler(({ url }) => {
      shell.openExternal(url);
      return { action: 'deny' };
    });

    // 将视图挂到窗口，初始尺寸极小；渲染进程会通过 IPC 精确设定
    try {
      mainWindow.setBrowserView(view);
      view.setBounds({ x: 0, y: 0, width: 10, height: 10 });
      view.setAutoResize({ width: false, height: false });
    } catch {}

    return view;
  }

  async function loadUrlInView(url) {
    const v = ensureView();
    // 顶级导航时传入更像真实浏览器的参数
    await v.webContents.loadURL(url, {
      userAgent: CHROME_UA,
      // 许多站点会依赖 Referrer；使用自身 Origin 作为参考
      httpReferrer: new URL(url).origin + '/',
    });
  }

  ipcMain.handle('aimodels:load', async (_e, { url }) => {
    if (!mainWindow) throw new Error('no main window');
    if (!/^https?:\/\//i.test(url)) throw new Error('invalid url');
    try {
      await loadUrlInView(url);
      return { ok: true };
    } catch (err) {
      // 将错误记录到控制台，返回失败，交给渲染进程做兜底或外部打开
      console.error("BrowserView load failed:", err);
      throw err;
    }
  });

  ipcMain.handle('aimodels:resize', (_e, { bounds }) => {
    if (!mainWindow || !view || !bounds) return { ok: false };
    const { x, y, width, height } = bounds;
    try {
      view.setBounds({
        x: Math.max(0, Math.round(x)),
        y: Math.max(0, Math.round(y)),
        width: Math.max(0, Math.round(width)),
        height: Math.max(0, Math.round(height))
      });
      return { ok: true };
    } catch {
      return { ok: false };
    }
  });

  // 隐藏/销毁（离开“AI模型”选项卡时调用，避免覆盖其他内容）
  ipcMain.handle('aimodels:hide', () => {
    if (!mainWindow || !view) return { ok: false };
    try { mainWindow.removeBrowserView(view); } catch {}
    try { view.destroy(); } catch {}
    view = null;
    return { ok: true };
  });

  // 外部打开当前 URL（渲染进程按钮触发）
  ipcMain.handle('aimodels:openExternal', (_e, { url }) => {
    if (url && /^https?:\/\//i.test(url)) shell.openExternal(url);
    return { ok: true };
  });
}

module.exports = { registerAimodelsHandlers };