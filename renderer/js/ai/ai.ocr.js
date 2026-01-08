(function () {
  window.AIApp = window.AIApp || {};
  const http = require('http');

  function getWeChatOCRTextOnce() {
    const url = window.AIApp.constants.OCR_URL + '&_ts=' + Date.now();
    return new Promise((resolve) => {
      http.get(url, res => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try {
            const obj = JSON.parse(data);
            resolve(obj.status === 'ok' ? obj.text : '截图或OCR失败');
          } catch (e) {
            resolve('解析失败:' + e.message);
          }
        });
      }).on('error', err => resolve('请求错误:' + err.message));
    });
  }

  async function doScreenshotOCRWithRetry() {
    const { normalizeText } = window.AIApp.utils;
    const minLen = window.AIApp.constants.OCR_MIN_LEN;

    const ok = (t) => {
      const cleaned = normalizeText(t);
      return cleaned &&
        !/^截图|OCR|解析失败|请求错误|OCR ERROR/i.test(cleaned) &&
        cleaned.replace(/\s+/g, '').length >= minLen ? cleaned : null;
    };

    let t1 = ok(await getWeChatOCRTextOnce());
    if (t1) return t1;

    await new Promise(r => setTimeout(r, window.AIApp.constants.OCR_RETRY_DELAY_MS));
    let t2 = ok(await getWeChatOCRTextOnce());
    return t2;
  }

  window.AIApp.ocr = { doScreenshotOCRWithRetry };
})();