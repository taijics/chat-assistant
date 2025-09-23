const { ipcRenderer } = require('electron');
const WechatOcrTool = require('./tools/wechatOcrTool');

// 监听菜单事件：识别聊天用户列表
ipcRenderer.on('menu:recognize-wechat-users', async () => {
  // 获取token
  let token = localStorage.getItem('baiduOcrToken') || '';
  if (!token) {
    alert('请先设置百度OCR token！');
    return;
  }
  WechatOcrTool.OCR_ACCESS_TOKEN = token;
  const users = await WechatOcrTool.captureAndRecognize();
  if (users.length) {
    alert('识别成功！前50个微信客户：\n' + users.join('\n'));
    // TODO: 自动保存到客户表
  } else {
    alert('未识别到微信客户，请确认微信窗口已打开且客户昵称可见。');
  }
});

// 监听菜单事件：百度token设置
ipcRenderer.on('menu:baidu-token', () => {
  showBaiduTokenModal();
});

function showBaiduTokenModal() {
  let token = localStorage.getItem('baiduOcrToken') || '';
  const modal = document.createElement('div');
  modal.className = 'baidu-token-modal';
  modal.innerHTML = `
    <div style="background:#fff;padding:24px 36px;border-radius:12px;box-shadow:0 4px 16px #0002;min-width:320px;">
      <h3 style="font-size:18px;margin-bottom:16px;">设置百度OCR Token</h3>
      <input id="baidu-token-input" type="text" value="${token}" placeholder="请输入百度OCR Token" style="width:100%;padding:8px;border-radius:6px;border:1px solid #eee;margin-bottom:18px;">
      <div style="text-align:right;">
        <button id="baidu-token-ok" style="background:#1677ff;border-radius:6px;color:#fff;border:none;padding:6px 18px;margin-right:10px;">确定</button>
        <button id="baidu-token-cancel" style="background:#eee;border-radius:6px;color:#333;border:none;padding:6px 18px;">取消</button>
      </div>
      <div style="margin-top:12px;font-size:13px;color:#888;">
        获取Token请访问：<a href="https://cloud.baidu.com/product/ocr" target="_blank">https://cloud.baidu.com/product/ocr</a>
      </div>
    </div>
  `;
  modal.style = `position:fixed;top:0;left:0;right:0;bottom:0;z-index:3000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.18);`;
  document.body.appendChild(modal);

  modal.querySelector('#baidu-token-ok').onclick = () => {
    const val = modal.querySelector('#baidu-token-input').value.trim();
    if (!val) {
      alert('Token不能为空');
      return;
    }
    localStorage.setItem('baiduOcrToken', val);
    document.body.removeChild(modal);
    alert('保存成功！');
  };
  modal.querySelector('#baidu-token-cancel').onclick = () => {
    document.body.removeChild(modal);
  };
}