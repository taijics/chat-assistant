// main/ai-coze.js
// 直接用用户原话调用 Coze（v3 + api.coze.cn），过滤中间消息，仅取最终回答；把调试信息发送到渲染端控制台（UTF-8）

const { ipcMain } = require('electron');
const https = require('https');
const { URL } = require('url');
const path = require('path');

// 固定走国内域名 + v3（与 curl 一致）
const BASE = process.env.COZE_BASE || 'https://api.coze.cn';
const API_URL = `${BASE}/v3/chat`;
const RETRIEVE_URL = `${BASE}/v3/chat/retrieve`;
const MESSAGE_LIST_URL = `${BASE}/v3/chat/message/list`;

// 记录主窗口用于把日志发到渲染端（UTF-8 控制台）
let mainWinRef = null;
const mask = (t='') => (t ? String(t).slice(0,4) + '…' + String(t).slice(-4) : '');

function sendDebug(tag, payload) {
  try {
    if (mainWinRef && !mainWinRef.isDestroyed()) {
      mainWinRef.webContents.send('ai:debug-log', { tag, time: Date.now(), ...payload });
    }
  } catch {}
}

// 安全打印：打码 Authorization
function safeHeaders(h = {}) {
  const hs = { ...h };
  if (hs.Authorization) {
    const m = /Bearer\s+(.+)/i.exec(hs.Authorization);
    if (m) hs.Authorization = 'Bearer ' + mask(m[1]);
  }
  return hs;
}

// 1) 加载配置：优先本地文件 -> 环境变量（兼容多种本地文件名）
let CONFIG = {
  token: process.env.COZE_TOKEN || '',
  botId: process.env.COZE_BOT_ID || '',
  userId: process.env.COZE_USER_ID || 'chat-assistant-user',
};

function tryLoadLocalConfig() {
  const candidates = [
    'ai-coze.config.local.js',
    'ai-coze-config-local.js',
    'ai_coze.config.local.js'
  ];
  for (const name of candidates) {
    try {
      const p = path.join(__dirname, name);
      const cfg = require(p);
      if (cfg && typeof cfg === 'object') {
        CONFIG = { ...CONFIG, ...cfg };
        return name;
      }
    } catch {}
  }
  return null;
}
const loadedFrom = tryLoadLocalConfig();
try {
  console.log('[coze] config source:', loadedFrom || 'env-only',
              'token:', mask(CONFIG.token), 'botId:', CONFIG.botId || '(none)', 'base:', BASE);
} catch {}

// 2) 基础 HTTPS JSON
function httpJSON(method, urlStr, { headers = {}, body = null, query = null, timeoutMs = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    try {
      const url = new URL(urlStr);
      if (query && typeof query === 'object') {
        Object.entries(query).forEach(([k, v]) => {
          if (v !== undefined && v !== null) url.searchParams.append(k, String(v));
        });
      }

      const opts = {
        method,
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'chat-assistant/1.0 (+electron)',
          ...headers
        }
      };

      const req = https.request(url, opts, (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            const json = data ? JSON.parse(data) : null;
            resolve({ statusCode: res.statusCode, data: json, raw: data });
          } catch {
            resolve({ statusCode: res.statusCode, data: { raw: data }, raw: data });
          }
        });
      });

      req.on('error', (err) => reject(err));
      req.setTimeout(timeoutMs, () => { req.destroy(new Error(`Request timeout after ${timeoutMs}ms`)); });

      if (body) {
        const str = typeof body === 'string' ? body : JSON.stringify(body);
        req.write(str);
      }
      req.end();
    } catch (err) {
      reject(err);
    }
  });
}

// 3) Coze v3 三步流（直接用原话；非流式：stream=false）
async function triggerChat(prompt) {
  // 强制去除不可见字符/空格
  CONFIG.token = (CONFIG.token || '').trim();
  CONFIG.botId = (CONFIG.botId || '').trim();
  CONFIG.userId = (CONFIG.userId || '').trim();

  const { token, botId, userId } = CONFIG;
  if (!token) {
    sendDebug('error', { where: 'triggerChat', msg: 'COZE_TOKEN is missing' });
    throw new Error('COZE_TOKEN is missing');
  }
  if (!botId) {
    sendDebug('error', { where: 'triggerChat', msg: 'COZE_BOT_ID is missing' });
    throw new Error('COZE_BOT_ID is missing');
  }

  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
  // 与 curl 对齐；保留非流式 stream=false 以便后续 retrieve 轮询
  const body = {
    bot_id: botId,
    user_id: userId || 'chat-assistant-user',
    user: userId || 'chat-assistant-user',
    stream: false,
    additional_messages: [{
      content: String(prompt || ''),
      content_type: 'text',
      role: 'user',
      type: 'question',
    }],
    parameters: {},
  };

  // 关键：在发起请求前把“请求参数”打印出来（打码 token / 截断内容）
  sendDebug('request:trigger', {
    endpoint: API_URL,
    headers: safeHeaders(headers),
    body: {
      ...body,
      bot_id: body.bot_id ? (String(body.bot_id).slice(0, 6) + '…') : '',
      additional_messages_preview: body.additional_messages?.map(m => ({
        role: m.role,
        type: m.type,
        content_preview: String(m.content || '').slice(0, 50)
      }))
    }
  });

  let res;
  try {
    res = await httpJSON('POST', API_URL, { headers, body, timeoutMs: 20000 });
  } catch (err) {
    sendDebug('error', {
      where: 'triggerChat/httpJSON',
      err: err && err.message,
      endpoint: API_URL
    });
    throw err;
  }
  if (res.statusCode !== 200) {
    sendDebug('error', { where: 'triggerChat/http', statusCode: res.statusCode, endpoint: API_URL, raw: res.raw });
    throw new Error(`triggerChat http ${res.statusCode}, raw: ${res.raw}`);
  }
  const j = res.data || {};
  if (j.code !== 0) {
    sendDebug('error', { where: 'triggerChat/resp', code: j.code, msg: j.msg, raw: res.raw,
      hint: '检查 token/bot_id 是否来自同一个空间、是否是 Coze API Key、是否有换行/空格' });
    throw new Error(`triggerChat failed: ${j.msg || 'unknown error'}`);
  }
  const chat_id = j.data && j.data.id;
  const conversation_id = j.data && j.data.conversation_id;
  if (!chat_id || !conversation_id) {
    sendDebug('error', { where: 'triggerChat/id', j });
    throw new Error('missing chat_id or conversation_id');
  }
  return { chat_id, conversation_id };
}

async function waitForCompleted(chat_id, conversation_id, { maxWaitMs = 45000, intervalMs = 800 } = {}) {
  const headers = { Authorization: `Bearer ${CONFIG.token}` };
  const start = Date.now();

  // 打印轮询参数
  sendDebug('request:retrieve', {
    endpoint: RETRIEVE_URL,
    headers: safeHeaders(headers),
    query: { chat_id, conversation_id }
  });

  while (true) {
    let res;
    try {
      res = await httpJSON('GET', RETRIEVE_URL, {
        headers,
        query: { chat_id, conversation_id },
        timeoutMs: 15000,
      });
    } catch (err) {
      sendDebug('error', { where: 'waitForCompleted/httpJSON', err: err && err.message, chat_id, conversation_id, waited: Date.now() - start });
      throw err;
    }
    if (res.statusCode !== 200) {
      sendDebug('error', { where: 'waitForCompleted/retrieve', statusCode: res.statusCode, chat_id, conversation_id, waited: Date.now() - start, raw: res.raw });
      throw new Error(`retrieve http ${res.statusCode}, raw: ${res.raw}`);
    }
    const j = res.data || {};
    const status = j.data && j.data.status;
    if (status === 'completed') return true;
    if (status === 'failed' || status === 'cancelled') {
      const msg = (j.data && j.data.last_error && j.data.last_error.msg) || 'unknown';
      sendDebug('error', { where: 'waitForCompleted/status', status, chat_id, conversation_id, msg });
      throw new Error(`chat ${status}: ${msg}`);
    }
    if (Date.now() - start > maxWaitMs) {
      sendDebug('error', { where: 'waitForCompleted/timeout', chat_id, conversation_id, waited: Date.now() - start });
      throw new Error(`retrieve timeout: chat_id=${chat_id}, conversation_id=${conversation_id}, waited=${Date.now() - start}ms`);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

// 只取“最终回答”的文本，过滤掉中间产物
async function listAssistantMessagesDetailed(chat_id, conversation_id) {
  const headers = { Authorization: `Bearer ${CONFIG.token}` };

  // 打印消息列表参数
  sendDebug('request:messageList', {
    endpoint: MESSAGE_LIST_URL,
    headers: safeHeaders(headers),
    query: { chat_id, conversation_id, order: 'asc' }
  });

  let res;
  try {
    res = await httpJSON('GET', MESSAGE_LIST_URL, {
      headers,
      query: { chat_id, conversation_id, order: 'asc' },
      timeoutMs: 20000,
    });
  } catch (err) {
    sendDebug('error', { where: 'listAssistantMessagesDetailed/httpJSON', err: err && err.message, chat_id, conversation_id });
    throw err;
  }
  if (res.statusCode !== 200) {
    sendDebug('error', { where: 'listAssistantMessagesDetailed/http', statusCode: res.statusCode, chat_id, conversation_id, raw: res.raw });
    throw new Error(`message/list http ${res.statusCode}, raw: ${res.raw}`);
  }
  const j = res.data || {};
  if (j.code !== 0) {
    sendDebug('error', { where: 'listAssistantMessagesDetailed/resp', code: j.code, msg: j.msg, chat_id, conversation_id, raw: res.raw });
    throw new Error(`message/list failed: ${j.msg || 'unknown error'}`);
  }
  const arr = Array.isArray(j.data) ? j.data : [];

  const assistants = arr.filter(m => m && m.role === 'assistant');
  const isAnswerLike = (m) => {
    const t = String(m.type || m.msg_type || m.message_type || '').toLowerCase();
    const ct = String(m.content_type || '').toLowerCase();
    return (t === 'answer' || t === 'chat' || t === 'reply' || t === 'finish') && (!ct || ct === 'text');
  };
  const candidates = assistants.filter(isAnswerLike).map(m => String(m.content || '')).filter(Boolean);

  const finalText = candidates.length
    ? candidates[candidates.length - 1]
    : (assistants.length ? String(assistants[assistants.length - 1].content || '') : '');

  return { assistants, finalText, rawJoined: assistants.map(m => String(m.content || '')).filter(Boolean).join('\n\n') };
}

async function cozeGenerate(prompt) {
  try {
    const { chat_id, conversation_id } = await triggerChat(prompt);
    await waitForCompleted(chat_id, conversation_id);
    const { assistants, finalText, rawJoined } = await listAssistantMessagesDetailed(chat_id, conversation_id);
    return { text: finalText, rawJoined, assistants, chat_id, conversation_id };
  } catch (err) {
    sendDebug('error', { where: 'cozeGenerate', err: err && err.message });
    throw new Error('AI 服务暂时不可用，请稍后重试。\n\n详细错误：' + (err && err.message));
  }
}

// 4) IPC
function setConfig(part) {
  if (!part || typeof part !== 'object') return;
  const next = { ...CONFIG, ...part };
  // trim 一次，避免换行/空格污染
  next.token = (next.token || '').trim();
  next.botId = (next.botId || '').trim();
  next.userId = (next.userId || '').trim();
  CONFIG = next;

  if (!CONFIG.token || !CONFIG.botId) {
    sendDebug('error', { where: 'setConfig', msg: 'token 或 botId 缺失', CONFIG: { ...CONFIG, token: mask(CONFIG.token) } });
  } else {
    sendDebug('info', { where: 'setConfig', msg: 'using config',
      CONFIG: { token: mask(CONFIG.token), botId: CONFIG.botId, userId: CONFIG.userId, base: BASE } });
  }
}

function registerAiHandlers(mainWindow) {
  mainWinRef = mainWindow;

  ipcMain.handle('ai:setConfig', async (_e, cfg) => {
    setConfig(cfg);
    return { ok: true };
  });

  ipcMain.handle('ai:generate', async (_e, payload) => {
    // 打印渲染端传来的 agentConfig（打码）
    const incoming = payload && payload.agentConfig
      ? { ...payload.agentConfig, token: mask(payload.agentConfig.token || '') }
      : '(none)';
    sendDebug('client-agentConfig', { incoming });

    const finalPrompt = String((payload && payload.prompt) || '');
    if (payload && payload.agentConfig) {
      setConfig(payload.agentConfig);
    } else {
      setConfig({
        token: process.env.COZE_TOKEN || CONFIG.token,
        botId: process.env.COZE_BOT_ID || CONFIG.botId,
        userId: process.env.COZE_USER_ID || CONFIG.userId
      });
    }
    try {
      const preview = finalPrompt.length > 2000 ? (finalPrompt.slice(0, 2000) + ' ...[truncated]') : finalPrompt;
      console.log('[coze] final prompt ->\n', preview);
      sendDebug('prompt', { prompt_preview: finalPrompt.slice(0, 200), length: finalPrompt.length });
    } catch {}

    try {
      const res = await cozeGenerate(finalPrompt);
      try {
        const raw = res.rawJoined || '';
        const preview = raw.length > 2000 ? (raw.slice(0, 2000) + ' ...[truncated]') : raw;
        console.log('[coze] raw response length:', raw.length, '\n[coze] raw response preview ->\n', preview);
        console.log('[coze] final answer length:', (res.text || '').length);
        console.log('[coze] ids:', { chat_id: res.chat_id, conversation_id: res.conversation_id });
        const meta = (res.assistants || []).map(m => ({
          role: m.role,
          type: m.type || m.msg_type || m.message_type || '',
          content_type: m.content_type || '',
          hasContent: !!(m && m.content)
        }));
        console.log('[coze] assistant meta:', meta);
        sendDebug('response', {
          ids: { chat_id: res.chat_id, conversation_id: res.conversation_id },
          meta,
          rawText: res.rawJoined,
          finalText: res.text
        });
      } catch {}
      return { text: res.text, debug: { prompt: finalPrompt, rawText: res.rawJoined, finalText: res.text } };
    } catch (err) {
      sendDebug('error', { where: 'ai:generate', err: err && err.message });
      return { text: '', debug: { prompt: finalPrompt, error: err && err.message } };
    }
  });
}

module.exports = { registerAiHandlers, setConfig };