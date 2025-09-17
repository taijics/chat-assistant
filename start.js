/**
 * 启动包装脚本：
 * 1. 过滤掉不被 Electron 允许的 --openssl-legacy-provider
 * 2. 以干净的环境启动 Electron 主进程
 */
const { spawn } = require('child_process');
const path = require('path');

const electronBinary = require('electron'); // 这里返回的是 electron 可执行文件路径

function sanitizeNodeOptions(value) {
  if (!value) return '';
  // 拆分空格（简单处理，不考虑引号嵌套，因为我们只要移除一个 flag）
  const parts = value.split(/\s+/).filter(Boolean);
  const filtered = parts.filter(p => p !== '--openssl-legacy-provider');
  return filtered.join(' ');
}

// 复制当前环境变量
const env = { ...process.env };

// 过滤 NODE_OPTIONS
if (env.NODE_OPTIONS && env.NODE_OPTIONS.includes('--openssl-legacy-provider')) {
  const before = env.NODE_OPTIONS;
  env.NODE_OPTIONS = sanitizeNodeOptions(env.NODE_OPTIONS);
  if (!env.NODE_OPTIONS) {
    delete env.NODE_OPTIONS;
  }
  console.log('[start] Removed disallowed flag from NODE_OPTIONS. Before =', before, 'After =', env.NODE_OPTIONS || '(deleted)');
}

const child = spawn(String(electronBinary), ['.'], {
  env,
  stdio: 'inherit',
  windowsHide: false,
});

child.on('exit', (code, signal) => {
  if (signal) {
    console.log(`[start] Electron exited by signal ${signal}`);
    process.exit(1);
  } else {
    process.exit(code ?? 0);
  }
});