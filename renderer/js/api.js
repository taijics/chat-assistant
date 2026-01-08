(function() {
  /**
   * API 客户端（统一 baseURL 配置）
   *
   * - 初始默认 baseURL: http://127.0.0.1:6004
   * - 你可以通过以下任一方式覆盖：
   *   1) 运行时调用：API.setBaseURL('https://your-api.example.com')
   *   2) 在浏览器控制台或首屏脚本设置：localStorage.setItem('api.baseURL', 'https://your-api.example.com')
   * - 所有请求都会使用该 baseURL 与相对路径拼接。
   */

  // -------------------- 常量与本地存储键 --------------------
  //const DEFAULT_BASE_URL = 'http://127.0.0.1:6003'; // 统一默认后端地址
  const DEFAULT_BASE_URL = 'https://allback.aiweiban.cn'; // 统一默认后端地址
  const LS_TOKEN = 'auth.token';
  const LS_TOKEN_NAME = 'auth.tokenName'; // 例如 "auth-token" 或 "Authorization"
  const LS_USER = 'auth.user';
  const LS_BASE = 'api.baseURL';

  // -------------------- baseURL（统一入口） --------------------
  // 优先取 localStorage，其次落回默认 DEFAULT_BASE_URL
  let baseURL = DEFAULT_BASE_URL;
  try {
    baseURL = DEFAULT_BASE_URL;
    // 规范化：如果误把 /api/front 配到了 baseURL，自动剥掉，避免重复拼接
    if (/\/api\/front\/?$/i.test(baseURL)) {
      baseURL = baseURL.replace(/\/api\/front\/?$/i, '');
    }
  } catch {}

  /**
   * 设置后端基础地址（统一入口）
   * - 传入空字符串会复位到默认 DEFAULT_BASE_URL
   */
  function setBaseURL(url) {
    const newURL = String(url || '').trim();
    baseURL = newURL || DEFAULT_BASE_URL;
    try {
      localStorage.setItem(LS_BASE, baseURL);
    } catch {}
  }

  /** 获取当前生效的基础地址（含默认值回退） */
  function getBaseURL() {
    return baseURL;
  }

  // -------------------- token 与用户信息 --------------------
  function getToken() {
    try {
      return localStorage.getItem(LS_TOKEN) || '';
    } catch {
      return '';
    }
  }

  function setToken(t) {
    try {
      localStorage.setItem(LS_TOKEN, String(t || ''));
    } catch {}
  }

  function getTokenName() {
    return tokenName || '';
  }

  function setTokenName(name) {
    tokenName = String(name || '').trim();
    try {
      localStorage.setItem(LS_TOKEN_NAME, tokenName);
    } catch {}
  }

  /** 同时设置 tokenName 与 token（便于登录后一次性写入） */
  function setAuth(auth) {
    if (!auth || typeof auth !== 'object') return;
    if ('tokenName' in auth) setTokenName(auth.tokenName);
    if ('token' in auth) setToken(auth.token);
  }

  function getUser() {
    try {
      const raw = localStorage.getItem(LS_USER);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function setUser(u) {
    try {
      localStorage.setItem(LS_USER, JSON.stringify(u || null));
    } catch {}
  }

  // token 名（请求头键名），默认空，优先使用登录返回的 tokenName
  let tokenName = '';
  try {
    tokenName = localStorage.getItem(LS_TOKEN_NAME) || '';
  } catch {}

  // -------------------- 工具函数 --------------------
  /** 将相对路径与统一 baseURL 拼接为完整 URL（绝对地址则原样返回） */
  function buildURL(path) {
    const isAbs = /^https?:\/\//i.test(path);
    return isAbs ?
      path : [String(baseURL || '').replace(/\/$/, ''), String(path || '').replace(/^\//, '')]
      .filter(Boolean)
      .join('/');
  }

  /** 简易查询串拼接 */
  function qs(params = {}) {
    const esc = encodeURIComponent;
    const pairs = Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => esc(k) + '=' + esc(v));
    return pairs.length ? '?' + pairs.join('&') : '';
  }

  // -------------------- 核心请求封装 --------------------
  /**
   * 统一请求方法
   * - 自动拼接 baseURL
   * - 自动附带鉴权头（优先使用 tokenName，默认为 "auth-token"；若为 "Authorization" 则按 Bearer 方案）
   * - 默认超时 15s
   * - 支持 FormData（用于文件上传）
   */
  async function request(path, {
    method = 'GET',
    headers = {},
    body = null,
    timeoutMs = 15000
  } = {}) {
    const token = getToken();
    const tn = getTokenName() || 'auth-token'; // 来自 OpenAPI 约定的默认请求头键名
    const url = buildURL(path);

    const isForm = (typeof FormData !== 'undefined') && (body instanceof FormData);

    const h = {
      ...headers
    };
    // 发送 JSON 时补齐 Content-Type；FormData 不设置，让浏览器自动生成 boundary
    if (body != null && !isForm) {
      if (!h['Content-Type'] && !h['content-type']) {
        h['Content-Type'] = 'application/json';
      }
    }

    // 自动携带鉴权
    if (token) {
      if (/^authorization$/i.test(tn)) {
        // 服务端若要求使用 Authorization 头，默认使用 Bearer 方案
        if (!h.Authorization && !h.authorization) {
          h.Authorization = 'Bearer ' + token;
        }
      } else {
        h[tn] = token;
      }
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort('timeout'), timeoutMs);
    let resp;
    try {
      resp = await fetch(url, {
        method,
        headers: h,
        body: body == null ? undefined : (isForm ? body : JSON.stringify(body)),
        signal: controller.signal
      });
    } finally {
      clearTimeout(timer);
    }

    const text = await resp.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }

    if (!resp.ok) {
      // 统一处理 401 未授权 -> 触发重新登录
      if (resp.status === 401) {
        try {
          setToken('');
          setTokenName('');
          setUser(null);
          localStorage.setItem('auth.needsLogin', '1'); // 标记一次，以防事件监听尚未挂载
        } catch {}
        try {
          window.dispatchEvent(new CustomEvent('auth:login-required', {
            detail: {
              url,
              method,
              status: resp.status
            }
          }));
        } catch {}
      }

      const err = new Error((data && (data.message || data.msg)) || resp.statusText || 'Request failed');
      err.status = resp.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  const get = (p, opts = {}) => request(p, {
    ...opts,
    method: 'GET'
  });
  const post = (p, body, opts = {}) => request(p, {
    ...opts,
    method: 'POST',
    body
  });

  // 发送表单（文件上传）
  const postForm = (p, formData, opts = {}) => request(p, {
    ...opts,
    method: 'POST',
    body: formData
  });

  // -------------------- 高层 API（基于 OpenAPI 定义） --------------------
  const Auth = {
    /**
     * 登录
     * POST /api/front/auth/login
     * body: { username, password }
     * 返回 RestResponse_LoginResp（data: { tokenName, token, expiresIn }）
     * 自动将 tokenName 与 token 写入本地，用于后续请求鉴权。
     */
    async login({
      username,
      password
    }) {
      const resp = await post('/api/front/auth/login', {
        username,
        password
      });
      const data = resp && resp.data ? resp.data : {};
      const tn = data.tokenName || 'auth-token';
      const tk = data.token || '';
      if (tk) {
        setToken(tk);
        setTokenName(tn);
      }
      return resp;
    },

    /**
     * 退出登录
     * POST /api/front/auth/logout
     * 默认清理本地鉴权信息
     */
    async logout({
      clearLocal = true
    } = {}) {
      const resp = await post('/api/front/auth/logout', {});
      if (clearLocal) {
        setToken('');
        setTokenName('');
        setUser(null);
      }
      return resp;
    },

    /**
     * 获取当前登录人信息
     * GET /api/front/auth/profile
     * 默认将用户信息保存到本地（API.getUser 可读取）
     */
    async profile({
      save = true
    } = {}) {
      const resp = await get('/api/front/auth/profile');
      if (save && resp && Object.prototype.hasOwnProperty.call(resp, 'data')) {
        setUser(resp.data || null);
      }
      return resp;
    }
  };
  // 在 Auth 下面新增：
  const UserAuth = {
    /** 密码登录 POST /api/front/user/auth/loginByPassword */
    async loginByPassword({
      account,
      password
    }) {
      const resp = await post('/api/front/user/auth/loginByPassword', {
        account,
        password
      });
      const data = resp && resp.data ? resp.data : {};
      const tn = data.tokenName || 'auth-token';
      const tk = data.token || '';
      if (tk) {
        setToken(tk);
        setTokenName(tn);
      }
      return resp;
    },

    /** 发送验证码 POST /api/front/user/sendSmsCode?phone=&scene=login|resetPwd */
    async sendSmsCode({
      phone,
      scene = 'login'
    }) {
      const url = '/api/front/user/sendSmsCode' + qs({
        phone,
        scene
      });
      return post(url, {}); // 后端是 @RequestParam，body 无所谓
    },

    /** 验证码登录 POST /api/front/user/auth/loginBySms */
    async loginBySms({
      phone,
      smsCode
    }) {
      const resp = await post('/api/front/user/auth/loginBySms', {
        phone,
        smsCode
      });
      const data = resp && resp.data ? resp.data : {};
      const tn = data.tokenName || 'auth-token';
      const tk = data.token || '';
      if (tk) {
        setToken(tk);
        setTokenName(tn);
      }
      return resp;
    },

    /** 忘记密码/重置密码 POST /api/front/user/auth/resetPassword */
    async resetPassword({
      phone,
      smsCode,
      newPassword
    }) {
      return post('/api/front/user/auth/resetPassword', {
        phone,
        smsCode,
        newPassword
      });
    }
  };
  const Agent = {
    /** 获取我所在小组可用的 AI 智能体列表 GET /api/front/agent/listByMyTeam */
    listByMyTeam() {
      return get('/api/front/agent/listByMyTeam');
    }
  };

  const Content = {
    /** 获取（公司/小组/私人）分类：按 scope 分组返回 GET /api/front/content/types?typeClass=0|1|2 */
    types({
      typeClass
    } = {}) {
      const url = '/api/front/content/types' + qs({
        typeClass
      });
      return get(url);
    },

    /** 获取可见范围内的内容列表 GET /api/front/content/list?typeClass=&typeId=&keyword= */
    list({
      typeClass,
      typeId,
      keyword
    } = {}) {
      const url = '/api/front/content/list' + qs({
        typeClass,
        typeId,
        keyword
      });
      return get(url);
    },
    //添加私人/小组类别与话术（后端会按 useScope 和 isAdmin 做权限校验）
    addByMe({
      useScope,
      contentTypeId,
      title,
      content,
      pid,
      typeClass
    } = {}) {
      return post('/api/front/content/addByMe', {
        useScope, // 1=小组，2=私人
        contentTypeId, // 为空则会按 title 新建类别
        title, // 新建类别标题
        pid,
        content, // 可选：要添加的话术内容或图片URL
        typeClass // 0图片 1表情 2文字（默认传 2）
      });
    },

    // 在 Content = { ... } 里新增
    /** 话术树（一级->二级->内容），仅文字 GET /api/front/content/phraseTree?useScope=0|1|2 */
    phraseTree({
      useScope
    } = {}) {
      const url = '/api/front/phraseTree' + qs({
        useScope
      });
      return get(url);
    },

    /** 图片/表情树（一级->二级->内容），GET /api/front/content/mediaTree?useScope=0|1|2&typeClass=0|1|3 */
    mediaTree({
      useScope,
      typeClass
    } = {}) {
      const url = '/api/front/mediaTree' + qs({
        useScope,
        typeClass
      });
      return get(url);
    }
  };

  // 文件上传（COS）
  const Files = {
    /**
     * 上传单个文件，返回后端响应
     * 默认接口：/api/file/operation/upload
     * 如你的后端是别的路径，可在此调整
     */
    async upload(file) {
      const fd = new FormData();
      fd.append('file', file);
      return postForm('/api/front/upload', fd);
    }
  };

  // -------------------- 导出 --------------------
  window.API = {
    // base
    DEFAULT_BASE_URL, // 暴露默认值仅用于调试/查看
    setBaseURL,
    getBaseURL,

    // token
    getToken,
    setToken,
    getTokenName,
    setTokenName,
    setAuth,

    // user
    getUser,
    setUser,

    // 低层 HTTP
    request,
    get,
    post,
    postForm,

    // 高层端点
    auth: Auth,
    userAuth: UserAuth,
    agent: Agent,
    content: Content,
    files: Files
  };
})();