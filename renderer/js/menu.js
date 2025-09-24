const {
  ipcRenderer,
  shell
} = require('electron');

/* const WechatOcrTool = require('./wechatOcrTool');

ipcRenderer.on('menu:recognize-wechat-users', async () => {
  let token = localStorage.getItem('baiduOcrToken') || '';
  if (!token) {
    alert('请先设置百度OCR接口信息！');
    return;
  }
  WechatOcrTool.OCR_ACCESS_TOKEN = token;
  const users = await WechatOcrTool.captureAndRecognize();
  if (users && users.length) {
    alert('识别成功！前50个微信客户：\n' + users.join('\n'));
    // TODO: 自动保存到客户表
  } else {
    // 此处不再需要弹窗，工具类里已弹出 OCR 原始结果
  }
}); */

// 百度OCR弹窗（优化样式，自动获取token）
ipcRenderer.on('menu:baidu-token', () => {
  showBaiduTokenModal();
});

function showBaiduTokenModal() {
  let appid = localStorage.getItem('baiduOcrAppId') || '';
  let apiKey = localStorage.getItem('baiduOcrApiKey') || '';
  let secretKey = localStorage.getItem('baiduOcrSecretKey') || '';
  let accessToken = localStorage.getItem('baiduOcrToken') || '';

  const modal = document.createElement('div');
  modal.className = 'baidu-token-modal';
  modal.innerHTML = `
    <div class="baidu-token-modal-content">
      <h3 class="baidu-token-modal-title">设置百度OCR接口信息</h3>
      <label class="baidu-token-label">
        <input id="baidu-appid-input" class="baidu-token-input" type="text" value="${appid}" placeholder="请输入APPID">
      </label>
      <label class="baidu-token-label">
        <input id="baidu-apikey-input" class="baidu-token-input" type="text" value="${apiKey}" placeholder="请输入API Key">
      </label>
      <label class="baidu-token-label">
        <input id="baidu-secretkey-input" class="baidu-token-input" type="text" value="${secretKey}" placeholder="请输入Secret Key">
      </label>
      <div class="baidu-token-tip">
        如已获取，当前Token：<span id="baidu-token-view" style="color:#1677ff">${accessToken ? accessToken : '未获取'}</span>
      </div>
      <div class="baidu-token-actions">
        <button id="baidu-token-fetch" class="baidu-token-btn-primary">获取Token</button>
        <button id="baidu-token-cancel" class="baidu-token-btn">取消</button>
      </div>
      <div class="baidu-token-tip2" id="baidu-token-openurl">
        获取API Key &amp; Secret Key请访问：https://cloud.baidu.com/product/ocr
      </div>
    </div>
  `;
  modal.style =
    `position:fixed;top:0;left:0;right:0;bottom:0;z-index:3000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.18);`;
  document.body.appendChild(modal);

  // 取消按钮
  modal.querySelector('#baidu-token-cancel').onclick = () => {
    document.body.removeChild(modal);
  };

  // 打开百度官网
  modal.querySelector('#baidu-token-openurl').onclick = () => {
    shell.openExternal('https://cloud.baidu.com/product/ocr');
  };

  // 获取token并保存
  modal.querySelector('#baidu-token-fetch').onclick = async () => {
    const appidVal = modal.querySelector('#baidu-appid-input').value.trim();
    const apiKeyVal = modal.querySelector('#baidu-apikey-input').value.trim();
    const secretKeyVal = modal.querySelector('#baidu-secretkey-input').value.trim();

    if (!appidVal || !apiKeyVal || !secretKeyVal) {
      alert('请填写完整信息');
      return;
    }

    try {
      const token = await fetchBaiduOcrToken(apiKeyVal, secretKeyVal);
      if (!token) throw new Error('未获取到Token');
      localStorage.setItem('baiduOcrAppId', appidVal);
      localStorage.setItem('baiduOcrApiKey', apiKeyVal);
      localStorage.setItem('baiduOcrSecretKey', secretKeyVal);
      localStorage.setItem('baiduOcrToken', token);
      modal.querySelector('#baidu-token-view').innerText = token;
      alert('获取并保存成功！');
      document.body.removeChild(modal);
    } catch (err) {
      alert('获取Token失败，请检查API Key和Secret Key是否正确。');
    }
  };
}

// 获取百度access_token
async function fetchBaiduOcrToken(apiKey, secretKey) {
  const url =
    `https://aip.baidubce.com/oauth/2.0/token?grant_type=client_credentials&client_id=${apiKey}&client_secret=${secretKey}`;
  const res = await fetch(url, {
    method: 'POST'
  });
  const data = await res.json();
  return data.access_token || '';
}