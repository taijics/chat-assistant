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
    ensureStyles();
    const mask = document.createElement('div');
    mask.className = 'auth-mask';
    mask.innerHTML = `
      <div class="auth-dialog" role="dialog" aria-modal="true">
        <h3>登录</h3>
        <div class="auth-field"><input id="auth-account" type="text" placeholder="账号" autocomplete="username"></div>
        <div class="auth-field"><input id="auth-password" type="password" placeholder="密码" autocomplete="current-password"></div>
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
    const btnCancel = $('#auth-cancel', mask);
    const btnSubmit = $('#auth-submit', mask);
    const errEl = $('#auth-error', mask);

    inputAcc && inputAcc.focus();

    const close = () => {
      try {
        mask.remove();
      } catch {}
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
        //通知短语模块去加载公司/小组类别与话术（文本类）
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