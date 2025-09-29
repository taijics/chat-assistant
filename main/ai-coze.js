// main/ai-coze.js
// 直接用用户原话调用 Coze，过滤中间消息，仅取最终回答；把调试信息发送到渲染端控制台（UTF-8）

const { ipcMain } = require('electron');
const https = require('https');
const { URL } = require('url');
const path = require('path');

const API_URL = 'https://api.coze.cn/v3/chat';
const RETRIEVE_URL = 'https://api.coze.cn/v3/chat/retrieve';
const MESSAGE_LIST_URL = 'https://api.coze.cn/v3/chat/message/list';

// 记录主窗口用于把日志发到渲染端（UTF-8 控制台）
let mainWinRef = null;

function sendDebug(tag, payload) {
  try {
    if (mainWinRef && !mainWinRef.isDestroyed()) {
      mainWinRef.webContents.send('ai:debug-log', {
        tag,
        time: Date.now(),
        ...payload
      });
    }
  } catch {}
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
      // eslint-disable-next-line import/no-dynamic-require, global-require
      const cfg = require(p);
      if (cfg && typeof cfg === 'object') {
        CONFIG = {
          ...CONFIG,
          ...cfg
        };
        return name;
      }
    } catch {
      /* 未命中忽略 */
    }
  }
  return null;
}
const loadedFrom = tryLoadLocalConfig();
try {
  console.log('[coze] config source:', loadedFrom || 'env-only', 'tokenLen:', (CONFIG.token || '').length, 'botId:',
    CONFIG.botId || '(none)');
} catch {}

// 2) 基础 HTTPS JSON
function httpJSON(method, urlStr, {
  headers = {},
  body = null,
  query = null,
  timeoutMs = 15000
} = {}) {
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
            resolve({
              statusCode: res.statusCode,
              data: json,
              raw: data
            });
          } catch {
            resolve({
              statusCode: res.statusCode,
              data: {
                raw: data
              },
              raw: data
            });
          }
        });
      });

      req.on('error', (err) => reject(err));
      req.setTimeout(timeoutMs, () => {
        req.destroy(new Error(`Request timeout after ${timeoutMs}ms`));
      });

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

// 3) Coze 三步流（直接用原话）
async function triggerChat(prompt) {
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
  const body = {
    bot_id: botId,
    user_id: userId || 'chat-assistant-user',
    stream: false,
    additional_messages: [{
      content: String(prompt || ''),
      content_type: 'text',
      role: 'user',
      type: 'question',
    }],
    parameters: {},
  };

  let res;
  try {
    res = await httpJSON('POST', API_URL, {
      headers,
      body,
      timeoutMs: 20000
    });
  } catch (err) {
    sendDebug('error', {
      where: 'triggerChat/httpJSON',
      err: err && err.message,
      body
    });
    throw err;
  }
  if (res.statusCode !== 200) {
    sendDebug('error', {
      where: 'triggerChat/http',
      statusCode: res.statusCode,
      body,
      raw: res.raw
    });
    throw new Error(`triggerChat http ${res.statusCode}, raw: ${res.raw}`);
  }
  const j = res.data || {};
  if (j.code !== 0) {
    sendDebug('error', {
      where: 'triggerChat/resp',
      code: j.code,
      msg: j.msg,
      body,
      raw: res.raw
    });
    throw new Error(`triggerChat failed: ${j.msg || 'unknown error'}`);
  }
  const chat_id = j.data && j.data.id;
  const conversation_id = j.data && j.data.conversation_id;
  if (!chat_id || !conversation_id) {
    sendDebug('error', {
      where: 'triggerChat/id',
      j,
      body
    });
    throw new Error('missing chat_id or conversation_id');
  }
  return { chat_id, conversation_id };
}

async function waitForCompleted(chat_id, conversation_id, {
  maxWaitMs = 45000,
  intervalMs = 800
} = {}) {
  const { token } = CONFIG;
  const headers = {
    Authorization: `Bearer ${token}`
  };
  const start = Date.now();

  while (true) {
    let res;
    try {
      res = await httpJSON('GET', RETRIEVE_URL, {
        headers,
        query: {
          chat_id,
          conversation_id
        },
        timeoutMs: 15000,
      });
    } catch (err) {
      sendDebug('error', {
        where: 'waitForCompleted/httpJSON',
        err: err && err.message,
        chat_id,
        conversation_id,
        waited: Date.now() - start
      });
      throw err;
    }
    if (res.statusCode !== 200) {
      sendDebug('error', {
        where: 'waitForCompleted/retrieve',
        statusCode: res.statusCode,
        chat_id,
        conversation_id,
        waited: Date.now() - start,
        raw: res.raw
      });
      throw new Error(`retrieve http ${res.statusCode}, raw: ${res.raw}`);
    }
    const j = res.data || {};
    const status = j.data && j.data.status;
    if (status === 'completed') return true;
    if (status === 'failed' || status === 'cancelled') {
      const msg = (j.data && j.data.last_error && j.data.last_error.msg) || 'unknown';
      sendDebug('error', {
        where: 'waitForCompleted/status',
        status,
        chat_id,
        conversation_id,
        msg
      });
      throw new Error(`chat ${status}: ${msg}`);
    }
    if (Date.now() - start > maxWaitMs) {
      sendDebug('error', {
        where: 'waitForCompleted/timeout',
        chat_id,
        conversation_id,
        waited: Date.now() - start
      });
      throw new Error(`retrieve timeout: chat_id=${chat_id}, conversation_id=${conversation_id}, waited=${Date.now() - start}ms`);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

// 只取“最终回答”的文本，过滤掉 knowledge_recall 等中间产物
async function listAssistantMessagesDetailed(chat_id, conversation_id) {
  const { token } = CONFIG;
  const headers = {
    Authorization: `Bearer ${token}`
  };
  let res;
  try {
    res = await httpJSON('GET', MESSAGE_LIST_URL, {
      headers,
      query: {
        chat_id,
        conversation_id,
        order: 'asc'
      },
      timeoutMs: 20000,
    });
  } catch (err) {
    sendDebug('error', {
      where: 'listAssistantMessagesDetailed/httpJSON',
      err: err && err.message,
      chat_id,
      conversation_id
    });
    throw err;
  }
  if (res.statusCode !== 200) {
    sendDebug('error', {
      where: 'listAssistantMessagesDetailed/http',
      statusCode: res.statusCode,
      chat_id,
      conversation_id,
      raw: res.raw
    });
    throw new Error(`message/list http ${res.statusCode}, raw: ${res.raw}`);
  }
  const j = res.data || {};
  if (j.code !== 0) {
    sendDebug('error', {
      where: 'listAssistantMessagesDetailed/resp',
      code: j.code,
      msg: j.msg,
      chat_id,
      conversation_id,
      raw: res.raw
    });
    throw new Error(`message/list failed: ${j.msg || 'unknown error'}`);
  }
  const arr = Array.isArray(j.data) ? j.data : [];

  // 全部 assistant 条目
  const assistants = arr.filter(m => m && m.role === 'assistant');

  // 候选 = 明确的“回答类”文本
  const isAnswerLike = (m) => {
    const t = String(m.type || m.msg_type || m.message_type || '').toLowerCase();
    const ct = String(m.content_type || '').toLowerCase();
    return (t === 'answer' || t === 'chat' || t === 'reply' || t === 'finish') &&
      (!ct || ct === 'text');
  };
  let candidates = assistants.filter(isAnswerLike).map(m => String(m.content || '')).filter(Boolean);

  // 没有明确回答时，兜底取最后一条有内容的 assistant
  const finalText = candidates.length ?
    candidates[candidates.length - 1] :
    (assistants.length ? String(assistants[assistants.length - 1].content || '') : '');

  return {
    assistants,
    finalText,
    rawJoined: assistants.map(m => String(m.content || '')).filter(Boolean).join('\n\n')
  };
}

async function cozeGenerate(prompt) {
  try {
    const { chat_id, conversation_id } = await triggerChat(prompt);
    await waitForCompleted(chat_id, conversation_id);
    const { assistants, finalText, rawJoined } = await listAssistantMessagesDetailed(chat_id, conversation_id);
    return {
      text: finalText,
      rawJoined,
      assistants,
      chat_id,
      conversation_id,
    };
  } catch (err) {
    sendDebug('error', { where: 'cozeGenerate', err: err && err.message });
    throw new Error('AI 服务暂时不可用，请稍后重试。\n\n详细错误：' + (err && err.message));
  }
}

// 4) IPC
function setConfig(part) {
  if (!part || typeof part !== 'object') return;
  CONFIG = {
    ...CONFIG,
    ...part
  };
  // 检查必要参数
  if (!CONFIG.token || !CONFIG.botId) {
    sendDebug('error', {
      where: 'setConfig',
      msg: 'token 或 botId 缺失',
      CONFIG
    });
  }
}

function registerAiHandlers(mainWindow) {
  // 记录主窗口，用于把调试信息发到渲染端（保证 UTF-8 显示）
  mainWinRef = mainWindow;

  ipcMain.handle('ai:setConfig', async (_e, cfg) => {
    setConfig(cfg);
    return {
      ok: true
    };
  });

  // 渲染侧调用：生成建议（直接用原话）
  ipcMain.handle('ai:generate', async (_e, payload) => {
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
    // 调试打印：提交给 AI 的最终 Prompt（原文）
    try {
      const preview = finalPrompt.length > 2000 ? (finalPrompt.slice(0, 2000) + ' ...[truncated]') : finalPrompt;
      console.log('[coze] final prompt ->\n', preview);
      sendDebug('prompt', { prompt: finalPrompt });
    } catch {}

    try {
      const res = await cozeGenerate(finalPrompt);

      // 调试打印：AI 原始返回（全部 assistant 拼接 + 最终用于展示的文本）
      try {
        const raw = res.rawJoined || '';
        const preview = raw.length > 2000 ? (raw.slice(0, 2000) + ' ...[truncated]') : raw;
        console.log('[coze] raw response length:', raw.length, '\n[coze] raw response preview ->\n', preview);
        console.log('[coze] final answer length:', (res.text || '').length);
        console.log('[coze] ids:', {
          chat_id: res.chat_id,
          conversation_id: res.conversation_id
        });
        const meta = (res.assistants || []).map(m => ({
          role: m.role,
          type: m.type || m.msg_type || m.message_type || '',
          content_type: m.content_type || '',
          hasContent: !!(m && m.content)
        }));
        console.log('[coze] assistant meta:', meta);

        // 发到渲染端控制台（UTF-8）
        sendDebug('response', {
          ids: {
            chat_id: res.chat_id,
            conversation_id: res.conversation_id
          },
          meta,
          rawText: res.rawJoined,
          finalText: res.text
        });
      } catch {}
      // 直接回传文本，由渲染端直接显示
      return {
        text: res.text,
        debug: {
          prompt: finalPrompt,
          rawText: res.rawJoined,
          finalText: res.text
        }
      };
    } catch (err) {
      // 错误也回传前端
      sendDebug('error', { where: 'ai:generate', err: err && err.message });
      return {
        text: '',
        debug: {
          prompt: finalPrompt,
          error: err && err.message
        }
      };
    }
  });
}

module.exports = {
  registerAiHandlers,
  setConfig
};