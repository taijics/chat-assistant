(function () {
  window.AIApp = window.AIApp || {};

  window.AIApp.constants = {
    SINGLE_CLICK_DELAY: 300,
    WECHAT_GRACE_MS: 6000,
    OCR_URL: 'http://127.0.0.1:5678/screenshot_ocr?img=wecom.png',
    OCR_MIN_LEN: 4,
    OCR_RETRY_DELAY_MS: 250,
    AGENT_RELOAD_SPIN_MIN_MS: 300
  };
})();