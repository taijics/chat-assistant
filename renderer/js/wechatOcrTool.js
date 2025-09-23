const { desktopCapturer } = require('electron');
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch'); // 确认已安装
console.log('wechatOcrTool.js loaded');
class WechatOcrTool {
  static OCR_ACCESS_TOKEN = 'YOUR_BAIDU_OCR_TOKEN';

  static FILTER_KEYWORDS = [
    '公众号', '订阅号', '微信团队', '文件传输助手', '服务通知', '微信支付', '群通知', '官方', '通知'
  ];

  static async captureWechatWindow() {
    const sources = await desktopCapturer.getSources({ types: ['window', 'screen'] });
    const wxSource = sources.find(src => src.name.includes('微信') || src.name.toLowerCase().includes('wechat'));
    if (!wxSource) throw new Error('未找到微信窗口');
    const image = wxSource.thumbnail.toPNG();
    const tempPath = path.join(__dirname, 'wechat_list.png');
    fs.writeFileSync(tempPath, image);
    return tempPath;
  }

  static async ocrImage(filePath) {
    const imageData = fs.readFileSync(filePath).toString('base64');
    const url = `https://aip.baidubce.com/rest/2.0/ocr/v1/general_basic?access_token=${WechatOcrTool.OCR_ACCESS_TOKEN}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `image=${encodeURIComponent(imageData)}`
    });
    const json = await res.json();
    if (!json.words_result) return [];
    return json.words_result.map(x => x.words);
  }

  static filterNicknames(wordsArr) {
    return wordsArr
      .filter(w =>
        !WechatOcrTool.FILTER_KEYWORDS.some(bk => w.includes(bk)) &&
        w.length >= 2 && w.length <= 20
      )
      .slice(0, 50);
  }

  static async captureAndRecognize() {
    try {
      const filePath = await WechatOcrTool.captureWechatWindow();
      console.log('截图文件路径:', filePath);
      const wordsArr = await WechatOcrTool.ocrImage(filePath);
      console.log('OCR原始结果:', wordsArr);
      const nicknames = WechatOcrTool.filterNicknames(wordsArr);
      console.log('过滤后昵称:', nicknames);
      if (!nicknames.length) {
        alert('未识别到有效昵称，OCR原始结果如下：\n' + (wordsArr && wordsArr.length ? wordsArr.join('\n') : '[空]'));
      }
      return nicknames;
    } catch (e) {
      console.error('微信OCR识别失败:', e);
      alert('微信OCR识别失败: ' + (e && e.message ? e.message : e));
      return [];
    }
  }
}

module.exports = WechatOcrTool;