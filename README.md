# chat-assistant
智能聊天助手

### 常见错误处理
  --- npm run start 报错：
  --- electron: --openssl-legacy-provider is not allowed in NODE_OPTIONS
   处理方式：$env:NODE_OPTIONS=""
   
### 控制台启动时间打印
   ```javascript
   performance.now()  
   ```

用最严格的空白页验证没有“二次导航”：
PowerShell：$env:DEBUG_BLANK="1"; npm start
预期：日志只会有一次 did-navigate about:blank，绝不会出现 file:///… 的 did-navigate。若此时仍出现 file:///，终端会打印 “[nav] loadFile called AGAIN … stack”，请把这段堆栈贴我，我们立刻能定位是谁触发了第二次加载。
验证 data: 方案是否生效：
$env:USE_DATA_URL="1"; Remove-Item Env:DEBUG_BLANK; npm start
预期：will/did-navigate 指向 data:（Chromium 会显示 about:blank → data: 的序列或直接 data:），且“绝不再出现 file:///… 的 did-navigate”。若仍出现 file:///，终端会打印第二次加载的堆栈，请贴我。
验证 app:// 方案：
$env:USE_APP_PROTOCOL="1"; Remove-Item Env:USE_DATA_URL; npm start
预期：will/did-navigate 指向 app://index.html，且不出现 file:///…；如若出现，同样会有 “[nav] … AGAIN” 堆栈。