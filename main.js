/**
 * 主进程：吸附助手窗口 + 迷你窗口 + 精准跟随微信窗口 Z 序（Win32 SetWindowPos）
 * 说明：
 * 1. 不再使用 setAlwaysOnTop 闪一下的策略，改为 Win32 API 将助手窗口插到微信窗口之后。
 * 2. 当微信被其它窗口遮挡时，助手窗口也一起被遮挡；当微信回到前台，助手窗口紧随其后。
 * 3. 仍保留原有：减号最小化到迷你窗口、退出按钮、缓动跟随、首次直接定位、定时器清理等功能。
 */

const { app, BrowserWindow, ipcMain, screen } = require('electron');
const { windowManager } = require('node-window-manager');
const { placeAfterWeChat } = require('./win32'); // 新增：Win32 Z 序控制

let mainWindow;          // 吸附助手窗口
let miniWindow;          // 迷你图标窗口

// 定时器引用
let positionTimer = null;
let moveTimer = null;

// 缓动当前值
let currentX = 0;
let currentY = 0;
let currentWidth = 350;
let currentHeight = 650;

// 目标位置
let targetX = 0;
let targetY = 0;
let targetWidth = 350;
let targetHeight = 650;

const speed = 0.2;                 // 缓动速度
let isClosedByUser = false;        // 用户是否通过减号隐藏了主窗口
let firstWeChatPositioned = false; // 首次发现微信后直接定位
// Z 序同步相关状态
let lastZOrderWeChatHandle = null;
let lastZOrderResult = null;
let lastZSyncAt = 0;               // 上一次同步时间戳（节流）

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: currentWidth,
    height: currentHeight,
    frame: false,
    alwaysOnTop: false, // 不强制置顶，Z 序由 Win32 控制
    transparent: false,
    resizable: false,
    show: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  mainWindow.loadFile('renderer/index.html');
}

function createMiniWindow() {
  const { width } = screen.getPrimaryDisplay().workAreaSize;
  miniWindow = new BrowserWindow({
    width: 160,
    height: 40,
    x: width - 180,
    y: 20,
    frame: false,
    alwaysOnTop: true, // 迷你窗口保持置顶（方便点击恢复）
    transparent: false,
    resizable: false,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  miniWindow.loadFile('renderer/mini.html');
}

app.whenReady().then(() => {
  createMainWindow();
  createMiniWindow();

  // 位置 & Z 序轮询（每 30ms）
  positionTimer = setInterval(() => {
    try {
      const weChatWindow = windowManager
        .getWindows()
        .find(win => {
          const title = (win.getTitle() || '').toLowerCase();
          // 兼容 “微信” / “WeChat” / 带会话名等
          return title.includes('微信') || title.includes('wechat');
        });

      if (weChatWindow && !isClosedByUser) {
        const bounds = weChatWindow.getBounds();

        targetX = bounds.x + bounds.width;
        targetY = bounds.y;
        targetWidth = 350;
        targetHeight = bounds.height;

        miniWindow && miniWindow.hide();
        mainWindow && mainWindow.show();

        // 首次出现直接定位，避免从 (0,0) 滑过来
        if (!firstWeChatPositioned) {
          currentX = targetX;
          currentY = targetY;
          currentWidth = targetWidth;
          currentHeight = targetHeight;
          mainWindow.setBounds({
            x: Math.round(currentX),
            y: Math.round(currentY),
            width: Math.round(currentWidth),
            height: Math.round(currentHeight),
          });
          firstWeChatPositioned = true;
        }

        // ----------- 精准 Z 序同步（Win32 SetWindowPos）开始 -----------
        // 节流：约每 80ms 做一次同步（避免频繁调用 Win32 API）
        const now = Date.now();
        const needSync = !lastZSyncAt || (now - lastZSyncAt > 80);

        if (needSync && mainWindow) {
          const assistantHandleBuffer = mainWindow.getNativeWindowHandle(); // Buffer
          const weChatHandle = weChatWindow.handle; // 数字句柄

            // 仅在微信句柄变化、上次失败、或需要周期刷新时尝试
          if (weChatHandle) {
            if (weChatHandle !== lastZOrderWeChatHandle || lastZOrderResult === false) {
              lastZOrderWeChatHandle = weChatHandle;
            }

            // 如果微信最小化，不做 Z 序操作（可选逻辑）
            if (weChatWindow.isMinimized && weChatWindow.isMinimized()) {
              // do nothing
            } else {
              lastZOrderResult = placeAfterWeChat(assistantHandleBuffer, weChatHandle);
            }
          }

          lastZSyncAt = now;
        }
        // ----------- 精准 Z 序同步结束 -----------

      } else {
        // 没有找到微信 或 用户手动最小化
        mainWindow && mainWindow.hide();
        miniWindow && miniWindow.show();
        firstWeChatPositioned = false;
        // 重置 Z 序缓存，防止下次恢复不刷新
        lastZOrderWeChatHandle = null;
        lastZOrderResult = null;
      }
    } catch (err) {
      // 安全防护，防止某次窗口遍历异常导致崩溃
      // console.error('positionTimer error:', err);
    }
  }, 30);

  // 缓动动画（每 10ms ）
  moveTimer = setInterval(() => {
    if (mainWindow && mainWindow.isVisible && mainWindow.isVisible()) {
      currentX = lerp(currentX, targetX, speed);
      currentY = lerp(currentY, targetY, speed);
      currentWidth = lerp(currentWidth, targetWidth, speed);
      currentHeight = lerp(currentHeight, targetHeight, speed);

      mainWindow.setBounds({
        x: Math.round(currentX),
        y: Math.round(currentY),
        width: Math.round(currentWidth),
        height: Math.round(currentHeight),
      });
    }
  }, 10);
});

// 减号：隐藏主窗口 → 显示迷你窗口
ipcMain.on('close-main-window', () => {
  isClosedByUser = true;
  if (mainWindow) mainWindow.hide();
  if (miniWindow) miniWindow.show();

  // 重置 Z 序状态
  lastZOrderWeChatHandle = null;
  lastZOrderResult = null;
});

// 迷你窗口点击恢复
ipcMain.on('restore-main-window', () => {
  isClosedByUser = false;
  if (miniWindow) miniWindow.hide();
  if (mainWindow) mainWindow.show();
  // 下次轮询时会重新定位+同步 Z 序
});

// 退出应用（X 按钮）
ipcMain.on('exit-app', () => {
  if (positionTimer) clearInterval(positionTimer);
  if (moveTimer) clearInterval(moveTimer);
  positionTimer = null;
  moveTimer = null;
  mainWindow = null;
  miniWindow = null;
  app.quit();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});