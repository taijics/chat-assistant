(function() {
  /**
   * 登录弹窗与页脚登录态展示
   *
   * baseURL 统一在 api.js 内管理：
   * - 默认值：API.DEFAULT_BASE_URL（http://127.0.0.1:6004）
   * - 如需修改请使用：API.setBaseURL('https://your-api.example.com')
   * - 或通过 localStorage：localStorage.setItem('api.baseURL', 'https://your-api.example.com')
   * 此文件不再设置或覆盖 baseURL，确保“唯一配置入口”。
   */
  let loginModalVisible = false; // 新增：防止重复弹出登录框
  const $ = (sel, root = document) => root.querySelector(sel);

  // 注入登录弹窗样式（仅注入一次）
  function ensureStyles() {
    if (document.getElementById('auth-modal-styles')) return;
    const style = document.createElement('style');
    style.id = 'auth-modal-styles';
    style.textContent = `
      .auth-mask{position:fixed;inset:0;background:rgba(0,0,0,.28);z-index:3000;display:flex;align-items:center;justify-content:center}
      .auth-dialog{background:#fff;width:360px;border-radius:8px;box-shadow:0 10px 30px rgba(0,0,0,.15);padding:16px 16px 12px}
      .auth-dialog h3{margin:0 0 12px;font-size:16px}
      .auth-field{margin:8px 0}
      .auth-field input{width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid #dcdcdc;border-radius:4px;outline:none}
      .auth-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:12px}
      .auth-error{color:#e02424;font-size:12px;min-height:16px;margin-top:4px}
      .footer-login-btn{cursor:pointer}
        .sys-btn{padding:7px 20px;border-radius:4px;background:#1976d2;color:#fff;border:0;font-size:15px;cursor:pointer;transition:background .2s;}
            .sys-btn:hover{background:#1565c0;}
            .sys-btn-danger{background:#e02424;}
            .sys-btn-danger:hover{background:#b71c1c;}
    `;
    document.head.appendChild(style);
  }

  // 根据是否已登录切换页脚“登录/用户名”展示
  function updateFooterAuthUI() {
    const accEl = document.getElementById('footer-account');
    const user = (window.API && API.getUser && API.getUser()) || null;
    const token = (window.API && API.getToken && API.getToken()) || '';

    if (!accEl) return;

    if (token && user) {
      accEl.textContent = user.phone || user.username || user.name || '已登录';
      accEl.title = '点击退出登录';
    } else {
      accEl.textContent = '登录';
      accEl.title = '登录';
    }
  }

  // 展示登录弹窗与处理登录流程
  function showLoginModal() {
    if (loginModalVisible) return; // 新增：已显示则不再创建
    loginModalVisible = true; // 新增：打开时即标记，防止重复弹
    ensureStyles();
    const mask = document.createElement('div');
    mask.className = 'auth-mask';
    mask.innerHTML = `
      <div class="auth-dialog" role="dialog" aria-modal="true">
        <h3>登录</h3>
        <div class="auth-field"><input id="auth-account" type="text" placeholder="账号" autocomplete="username"></div>
        <div class="auth-field"><input id="auth-password" type="password" placeholder="密码" autocomplete="current-password"></div>
        <div class="auth-field" style="display:flex;align-items:center;gap:6px;margin-top:4px;">
          <input id="auth-remember" type="checkbox" style="width:14px;height:14px;margin:0;">
          <label for="auth-remember" style="font-size:12px;color:#555;cursor:pointer;user-select:none;">记住账号</label>
        </div>
        <div id="auth-error" class="auth-error"></div>
        <div class="auth-actions">
          <button id="auth-cancel" class="sys-btn">取消</button>
                  <button id="auth-submit" class="sys-btn sys-btn-danger">登录</button>
        </div>
      </div>
    `;
    document.body.appendChild(mask);

    const inputAcc = $('#auth-account', mask);
    const inputPwd = $('#auth-password', mask);
    const chkRemember = $('#auth-remember', mask);
    const btnCancel = $('#auth-cancel', mask);
    const btnSubmit = $('#auth-submit', mask);
    const errEl = $('#auth-error', mask);

    inputAcc && inputAcc.focus();

    try {
      const rememberedFlag = localStorage.getItem('auth.remember') === '1';
      const rememberedAcc = localStorage.getItem('auth.remember.account') || '';
      if (chkRemember) chkRemember.checked = rememberedFlag;
      if (rememberedFlag && rememberedAcc && inputAcc) {
        inputAcc.value = rememberedAcc;
      }
    } catch {}

    const close = () => {
      try {
        mask.remove();
      } catch {}
      loginModalVisible = false; // 新增：关闭后清除标记
    };

    btnCancel && (btnCancel.onclick = close);
    mask.addEventListener('click', (e) => {
      if (e.target === mask) close();
    });

    // 执行登录
    async function doLogin() {
      const account = (inputAcc && inputAcc.value || '').trim();
      const password = (inputPwd && inputPwd.value || '');

      if (!account || !password) {
        errEl.textContent = '请填写账号和密码';
        return;
      }

      btnSubmit.disabled = true;
      btnSubmit.textContent = '登录中…';
      errEl.textContent = '';

      try {
        // 使用统一封装：自动设置 tokenName 与 token，路径为 /api/front/auth/login
        const resp = await API.auth.login({
          username: account,
          password
        });
        if (!resp || resp.status !== 'success' || !resp.data || !resp.data.token) {
          errEl.textContent = (resp && resp.message) ? resp.message : '账号或密码错误';
          return;
        }

        // 校验登录成功（后端 RestResponse<LoginResp>）
        if (!resp || resp.status !== 'success' || !resp.data || !resp.data.token) {
          errEl.textContent = (resp && resp.message) ? resp.message : '账号或密码错误';
          return;
        }

        // 拉取并保存用户信息（用于显示手机号）
        await API.auth.profile({
          save: true
        });

        // 新增：根据“记住账号”复选框，决定是否记住 token 与账号
        try {
          const remember = chkRemember && chkRemember.checked;
          if (remember) {
            // 标记记住 & 记住账号 + 当前 token
            localStorage.setItem('auth.remember', '1');
            localStorage.setItem('auth.remember.account', account);
            const tk = API.getToken && API.getToken();
            if (tk) localStorage.setItem('auth.remember.token', tk);
          } else {
            // 取消记住：清除相关信息
            localStorage.removeItem('auth.remember');
            localStorage.removeItem('auth.remember.account');
            localStorage.removeItem('auth.remember.token');
          }
        } catch {}

        // 新增：清除“需要重新登录”一次性标记
        try {
          localStorage.removeItem('auth.needsLogin');
        } catch {}
        //通知短语模块...
        window.dispatchEvent(new CustomEvent('auth:login', {
          detail: {
            user: API.getUser && API.getUser()
          }
        }));

        // 刷新底部显示并关闭弹窗
        updateFooterAuthUI();
        close();
      } catch (e) {
        console.warn('login failed:', e);
        errEl.textContent = e && e.message ? e.message : '登录失败';
      } finally {
        btnSubmit.disabled = false;
        btnSubmit.textContent = '登录';
      }
    }

    btnSubmit && (btnSubmit.onclick = doLogin);
    mask.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') doLogin();
      if (e.key === 'Escape') close();
    });
  }

  // 绑定页脚登录按钮并按当前登录态刷新展示
  function bind() {
    const accEl = document.getElementById('footer-account');
    if (accEl) {
      accEl.addEventListener('click', async () => {
        const token = (window.API && API.getToken && API.getToken()) || '';
        const user = (window.API && API.getUser && API.getUser()) || null;

        if (token && user) {
          showConfirmModal('确定退出登录吗？', async () => {
            try {
              await API.auth.logout({
                clearLocal: true
              });
            } catch (e) {}
            updateFooterAuthUI();
            // 退出登录时清除“记住登录”信息（token & 账号）
            try {
              localStorage.removeItem('auth.remember');
              localStorage.removeItem('auth.remember.account');
              localStorage.removeItem('auth.remember.token');
            } catch {}
            // 新增：派发登出事件，phrases.js 会根据 isAdmin 为空隐藏“小组＋”
            window.dispatchEvent(new CustomEvent('auth:logout'));
          });
          // 不用 else 的 confirm
        } else {
          // 未登录：打开登录弹窗
          showLoginModal();
        }
      });
    }
    updateFooterAuthUI();

    // 新增：优先尝试用记住的 token 自动恢复登录
    try {
      const remember = localStorage.getItem('auth.remember') === '1';
      const savedToken = localStorage.getItem('auth.remember.token') || '';
      if (remember && savedToken && (!API.getToken || !API.getToken())) {
        // 本地还没有 token，就用记住的 token 直接恢复
        API.setToken && API.setToken(savedToken);
        // 尝试拉一次用户信息，不弹窗
        API.auth.profile({
          save: true
        }).then(() => {
          updateFooterAuthUI();
          // 通知其它模块已经登录（比如短语那边）
          window.dispatchEvent(new CustomEvent('auth:login', {
            detail: {
              user: API.getUser && API.getUser()
            }
          }));
        }).catch(() => {
          // 失败就视为需要重新登录，清掉记住信息，后面再走弹窗逻辑
          try {
            localStorage.removeItem('auth.remember');
            localStorage.removeItem('auth.remember.account');
            localStorage.removeItem('auth.remember.token');
          } catch {}
          // 再按原逻辑处理 auth.needsLogin
          if (localStorage.getItem('auth.needsLogin') === '1') {
            localStorage.removeItem('auth.needsLogin');
            showLoginModal();
          }
        });
      } else {
        // 没有记住 token 的情况，保留原来的 401 标记弹窗逻辑
        if (localStorage.getItem('auth.needsLogin') === '1') {
          localStorage.removeItem('auth.needsLogin');
          showLoginModal();
        }
      }
    } catch {}

    // 监听 API 层派发的 401 事件：这时也可以先试清除 token&记住，再弹登录
    window.addEventListener('auth:login-required', () => {
      try {
        // 发 401 时，当前 token 已失效，清掉老的记住信息
        localStorage.removeItem('auth.remember.token');
      } catch {}
      showLoginModal();
    });
  }
  // 新增自定义确认弹窗函数（放在文件末尾即可）
  function showConfirmModal(message, onConfirm, onCancel) {
    // 移除已有弹窗
    const old = document.getElementById('auth-confirm-modal');
    if (old) old.remove();
    ensureStyles();
    const mask = document.createElement('div');
    mask.id = 'auth-confirm-modal';
    mask.className = 'auth-mask';
    mask.innerHTML = `
       <div class="auth-dialog" role="dialog" aria-modal="true" style="min-width:260px;">
         <h3 style="margin-bottom:18px;">${message || '确认操作'}</h3>
         <div style="display:flex;justify-content:flex-end;gap:10px;">
           <button id="auth-confirm-cancel" class="sys-btn">取消</button>
           <button id="auth-confirm-ok" class="sys-btn sys-btn-danger">确定</button>
         </div>
       </div>
     `;
    document.body.appendChild(mask);

    $('#auth-confirm-cancel', mask).onclick = () => {
      mask.remove();
      if (onCancel) onCancel();
    };
    $('#auth-confirm-ok', mask).onclick = () => {
      mask.remove();
      if (onConfirm) onConfirm();
    };
    mask.addEventListener('click', (e) => {
      if (e.target === mask) {
        mask.remove();
        if (onCancel) onCancel();
      }
    });
  }
  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})();