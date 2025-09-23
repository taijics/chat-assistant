const { desktopCapturer } = require('electron');
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

/**
 * 微信聊天客户OCR识别工具
 * 用法：
 *   const WechatOcrTool = require('./tools/wechatOcrTool');
 *   WechatOcrTool.captureAndRecognize().then(list => { ... });
 */
class WechatOcrTool {
  // 配置 OCR 服务（百度，可换其它）
  static OCR_ACCESS_TOKEN = 'YOUR_BAIDU_OCR_TOKEN'; // 请替换为你的百度OCR token

  // 聊天窗口过滤关键词
  static FILTER_KEYWORDS = [
    '公众号', '订阅号', '微信团队', '文件传输助手', '服务通知', '微信支付', '群通知', '官方', '通知'
  ];

  /**
   * 截图微信窗口（仅聊天列表）并保存为图片
   * @returns {Promise<string>} 返回图片文件路径
   */
  static async captureWechatWindow() {
    const sources = await desktopCapturer.getSources({ types: ['window', 'screen'] });
    const wxSource = sources.find(src => src.name.includes('微信'));
    if (!wxSource) throw new Error('未找到微信窗口');
    const image = wxSource.thumbnail.toPNG();
    const tempPath = path.join(__dirname, 'wechat_list.png');
    fs.writeFileSync(tempPath, image);
    return tempPath;
  }

  /**
   * OCR识别图片中的文本（昵称等）
   * @param {string} filePath 图片路径
   * @returns {Promise<string[]>} 返回所有识别到的文本行
   */
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

  /**
   * 过滤掉公众号、通知类消息昵称，只保留有效的客户昵称
   * @param {string[]} wordsArr
   * @returns {string[]} 返回前50个有效昵称
   */
  static filterNicknames(wordsArr) {
    return wordsArr
      .filter(w =>
        !WechatOcrTool.FILTER_KEYWORDS.some(bk => w.includes(bk)) &&
        w.length >= 2 && w.length <= 20
      )
      .slice(0, 50);
  }

  /**
   * 综合流程：截图微信窗口->OCR识别->过滤有效昵称
   * @returns {Promise<string[]>} 前50个有效昵称列表
   */
  static async captureAndRecognize() {
    try {
      const filePath = await WechatOcrTool.captureWechatWindow();
      const wordsArr = await WechatOcrTool.ocrImage(filePath);
      const nicknames = WechatOcrTool.filterNicknames(wordsArr);
      return nicknames;
    } catch (e) {
      console.warn('微信OCR识别失败:', e.message);
      return [];
    }
  }
}

module.exports = WechatOcrTool;