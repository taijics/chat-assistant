(function() {
  let loginModalVisible = false;

  function startCountdown(btn, seconds) {
    let left = seconds;
    btn.disabled = true;
    const originText = btn.textContent;
    btn.textContent = `${left}s`;
    const timer = setInterval(() => {
      left -= 1;
      if (left <= 0) {
        clearInterval(timer);
        btn.disabled = false;
        btn.textContent = originText;
      } else {
        btn.textContent = `${left}s`;
      }
    }, 1000);
  }

  function showLoginModal() {
    if (loginModalVisible) return;
    loginModalVisible = true;

    window.AuthStyles && AuthStyles.ensure && AuthStyles.ensure();

    const mask = document.createElement('div');
    mask.className = 'auth-mask';
    mask.innerHTML = `
      <div class="auth-dialog auth-dialog-wrap" role="dialog" aria-modal="true">
        <button id="auth-cancel" class="auth-close" type="button" title="关闭">×</button>

        <div id="auth-title" class="auth-title">登录</div>

        <div class="auth-body">
          <!-- 密码登录 -->
          <div id="panel-pwd" class="auth-form">
            <div class="auth-row">
              <div class="auth-label">账号</div>
              <input id="pwd-account" class="auth-input" type="text" placeholder="手机号/用户名/邮箱" autocomplete="username">
            </div>
            <div class="auth-row">
              <div class="auth-label">密码</div>
              <input id="pwd-password" class="auth-input" type="password" placeholder="请输入" autocomplete="current-password">
              <button id="pwd-toggle" class="auth-icon-btn" type="button" title="显示/隐藏密码">
                <svg class="auth-icon" viewBox="0 0 24 24" fill="none">
                  <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" stroke="currentColor" stroke-width="2"/>
                  <circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="2"/>
                </svg>
              </button>
            </div>

            <label class="auth-remember">
              <input id="auth-remember" type="checkbox">
              记住账号
            </label>
          </div>

          <!-- 验证码登录 -->
          <div id="panel-sms" class="auth-form" style="display:none;">
            <div class="auth-row">
              <div class="auth-label">手机号</div>
              <input id="sms-phone" class="auth-input" type="text" placeholder="请输入手机号" autocomplete="tel">
            </div>
            <div class="auth-row">
              <div class="auth-label">验证码</div>
              <div class="auth-sms-wrap">
                <input id="sms-code" class="auth-input" type="text" placeholder="请输入验证码">
                <button id="sms-send" class="auth-sms-btn" type="button">获取验证码</button>
              </div>
            </div>

            <label class="auth-remember">
              <input id="sms-remember" type="checkbox">
              记住账号
            </label>
          </div>

          <!-- 修改密码 -->
          <div id="panel-reset" class="auth-form" style="display:none;">
            <div class="auth-row">
              <div class="auth-label">手机号</div>
              <input id="reset-phone" class="auth-input" type="text" placeholder="请输入手机号" autocomplete="tel">
            </div>
            <div class="auth-row">
              <div class="auth-label">验证码</div>
              <div class="auth-sms-wrap">
                <input id="reset-code" class="auth-input" type="text" placeholder="请输入验证码">
                <button id="reset-send" class="auth-sms-btn" type="button">获取验证码</button>
              </div>
            </div>
            <div class="auth-row">
              <div class="auth-label">密码</div>
              <input id="reset-newpwd" class="auth-input" type="password" placeholder="请输入新密码" autocomplete="new-password">
            </div>
          </div>

          <!-- ✅ 账号注册（手机号 + 验证码 + 密码） -->
          <div id="panel-register" class="auth-form" style="display:none;">
            <div class="auth-row">
                <div class="auth-label">邀请人</div>
                <input id="register-inviter" class="auth-input" type="text" placeholder="邀请人ID或手机号（可不填）" autocomplete="off">
              </div>
            <div class="auth-row">
              <div class="auth-label">手机号</div>
              <input id="register-phone" class="auth-input" type="text" placeholder="请输入手机号" autocomplete="tel">
            </div>
            <div class="auth-row">
              <div class="auth-label">验证码</div>
              <div class="auth-sms-wrap">
                <input id="register-code" class="auth-input" type="text" placeholder="请输入验证码">
                <button id="register-send" class="auth-sms-btn" type="button">获取验证码</button>
              </div>
            </div>
            <div class="auth-row">
              <div class="auth-label">密码</div>
              <input id="register-pwd" class="auth-input" type="password" placeholder="请输入密码" autocomplete="new-password">
            </div>
          </div>

          <div id="auth-error" class="auth-error"></div>

          <button id="auth-submit" class="auth-main-btn">立即登录</button>

          <div class="auth-footer">
            <a id="link-sms" class="auth-link">验证码登录</a>
            <span id="split-1" class="auth-split">|</span>

            <a id="link-pwd" class="auth-link" style="display:none;">密码登录</a>
            <span id="split-2" class="auth-split" style="display:none;">|</span>

            <a id="link-reset" class="auth-link">修改密码</a>
            <span id="split-3" class="auth-split">|</span>

            <!-- ✅ 新增 -->
            <a id="link-register" class="auth-link">账号注册</a>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(mask);

    const $$ = (sel) => mask.querySelector(sel);
    const C = window.AuthConst;

    const titleEl = $$('#auth-title');

    const panelPwd = $$('#panel-pwd');
    const panelSms = $$('#panel-sms');
    const panelReset = $$('#panel-reset');
    const panelRegister = $$('#panel-register');

    const inputPwdAcc = $$('#pwd-account');
    const inputPwdPwd = $$('#pwd-password');
    const btnPwdToggle = $$('#pwd-toggle');
    const chkRemember = $$('#auth-remember');

    const inputSmsPhone = $$('#sms-phone');
    const inputSmsCode = $$('#sms-code');
    const btnSmsSend = $$('#sms-send');
    const chkSmsRemember = $$('#sms-remember');

    const inputResetPhone = $$('#reset-phone');
    const inputResetCode = $$('#reset-code');
    const inputResetNewPwd = $$('#reset-newpwd');
    const btnResetSend = $$('#reset-send');

    // register
    const inputRegisterPhone = $$('#register-phone');
    const inputRegisterCode = $$('#register-code');
    const inputRegisterPwd = $$('#register-pwd');
    const btnRegisterSend = $$('#register-send');

    const btnCancel = $$('#auth-cancel');
    const btnSubmit = $$('#auth-submit');
    const errEl = $$('#auth-error');

    const linkSms = $$('#link-sms');
    const linkPwd = $$('#link-pwd');
    const linkReset = $$('#link-reset');
    const linkRegister = $$('#link-register');

    const split1 = $$('#split-1');
    const split2 = $$('#split-2');
    const split3 = $$('#split-3');

    let mode = 'pwd'; // pwd | sms | reset | register

    function setMode(m) {
      mode = m;

      panelPwd.style.display = m === 'pwd' ? '' : 'none';
      panelSms.style.display = m === 'sms' ? '' : 'none';
      panelReset.style.display = m === 'reset' ? '' : 'none';
      panelRegister.style.display = m === 'register' ? '' : 'none';

      // 标题 & 按钮文案
      if (m === 'reset') {
        titleEl.textContent = '修改密码';
        btnSubmit.textContent = '确认修改';
      } else if (m === 'register') {
        titleEl.textContent = '账号注册';
        btnSubmit.textContent = '立即注册';
      } else {
        titleEl.textContent = '登录';
        btnSubmit.textContent = '立即登录';
      }

      // 底部链接显示逻辑（延续你原逻辑 + register）
      // pwd: 显示 [验证码登录 | 修改密码 | 账号注册]
      // sms: 显示 [密码登录 | 修改密码 | 账号注册]
      // reset: 显示 [密码登录 | 验证码登录] + [账号注册]（不显示“修改密码”本身）
      // register: 显示 [密码登录 | 验证码登录 | 修改密码]（不显示“账号注册”本身）
      if (m === 'pwd') {
        linkPwd.style.display = 'none';
        split2.style.display = 'none';

        linkSms.style.display = '';
        split1.style.display = '';

        linkReset.style.display = '';
        split3.style.display = '';

        linkRegister.style.display = '';
      } else if (m === 'sms') {
        linkPwd.style.display = '';
        split2.style.display = '';

        linkSms.style.display = 'none';
        split1.style.display = 'none';

        linkReset.style.display = '';
        split3.style.display = '';

        linkRegister.style.display = '';
      } else if (m === 'reset') {
        linkPwd.style.display = '';
        split2.style.display = '';

        linkSms.style.display = '';
        split1.style.display = '';

        linkReset.style.display = 'none';
        split3.style.display = 'none'; // ✅ reset 模式不显示 split3，避免出现两个 |

        linkRegister.style.display = '';
      } else {
        // register
        linkPwd.style.display = '';
        split2.style.display = '';

        linkSms.style.display = '';
        split1.style.display = '';

        linkReset.style.display = '';
        split3.style.display = 'none';

        linkRegister.style.display = 'none';
      }

      errEl.textContent = '';

      // focus
      if (m === 'pwd') inputPwdAcc && inputPwdAcc.focus();
      if (m === 'sms') inputSmsPhone && inputSmsPhone.focus();
      if (m === 'reset') inputResetPhone && inputResetPhone.focus();
      if (m === 'register') inputRegisterPhone && inputRegisterPhone.focus();
    }

    linkSms.onclick = () => setMode('sms');
    linkPwd.onclick = () => setMode('pwd');
    linkReset.onclick = () => setMode('reset');
    linkRegister.onclick = () => setMode('register');

    btnPwdToggle.onclick = () => {
      const t = inputPwdPwd.getAttribute('type');
      inputPwdPwd.setAttribute('type', t === 'password' ? 'text' : 'password');
    };

    // 回填记住账号（同步到两种登录）
    try {
      const rememberedFlag = localStorage.getItem(C.LS_REMEMBER) === '1';
      const rememberedAcc = localStorage.getItem(C.LS_REMEMBER_ACCOUNT) || '';
      chkRemember.checked = rememberedFlag;
      chkSmsRemember.checked = rememberedFlag;
      if (rememberedFlag && rememberedAcc) {
        inputPwdAcc.value = rememberedAcc;
        inputSmsPhone.value = rememberedAcc;
      }
    } catch {}

    const close = () => {
      try {
        mask.remove();
      } catch {}
      loginModalVisible = false;
    };

    btnCancel.onclick = close;
    mask.addEventListener('click', (e) => {
      if (e.target === mask) close();
    });

    btnSmsSend.onclick = async () => {
      const phone = (inputSmsPhone.value || '').trim();
      if (!phone) {
        errEl.textContent = '请输入手机号';
        return;
      }
      try {
        btnSmsSend.disabled = true;
        await API.userAuth.sendSmsCode({
          phone,
          scene: 'login'
        });
        startCountdown(btnSmsSend, 60);
        errEl.textContent = '验证码已发送';
      } catch (e) {
        btnSmsSend.disabled = false;
        errEl.textContent = e && e.message ? e.message : '发送失败';
      }
    };

    btnResetSend.onclick = async () => {
      const phone = (inputResetPhone.value || '').trim();
      if (!phone) {
        errEl.textContent = '请输入手机号';
        return;
      }
      try {
        btnResetSend.disabled = true;
        await API.userAuth.sendSmsCode({
          phone,
          scene: 'resetPwd'
        });
        startCountdown(btnResetSend, 60);
        errEl.textContent = '验证码已发送';
      } catch (e) {
        btnResetSend.disabled = false;
        errEl.textContent = e && e.message ? e.message : '发送失败';
      }
    };

    // ✅ 注册验证码
    btnRegisterSend.onclick = async () => {
      const phone = (inputRegisterPhone.value || '').trim();
      if (!phone) {
        errEl.textContent = '请输入手机号';
        return;
      }
      try {
        btnRegisterSend.disabled = true;
        await API.userAuth.sendSmsCode({
          phone,
          scene: 'inviteRegister'
        });
        startCountdown(btnRegisterSend, 60);
        errEl.textContent = '验证码已发送';
      } catch (e) {
        btnRegisterSend.disabled = false;
        errEl.textContent = e && e.message ? e.message : '发送失败';
      }
    };

    async function doSubmit() {
      errEl.textContent = '';
      btnSubmit.disabled = true;
      btnSubmit.textContent = '处理中…';

      try {
        if (mode === 'pwd') {
          const account = (inputPwdAcc.value || '').trim();
          const password = (inputPwdPwd.value || '');
          if (!account || !password) {
            errEl.textContent = '请填写账号和密码';
            return;
          }

          const resp = await API.userAuth.loginByPassword({
            account,
            password
          });
          if (!resp || resp.status !== 'success' || !resp.data || !resp.data.token) {
            errEl.textContent = (resp && resp.message) ? resp.message : '登录失败';
            return;
          }
          await AuthService.afterLoginSuccess({
            remember: chkRemember.checked,
            account,
            vipExpireTime: resp.data && resp.data.vipExpireTime

          });
          close();
          return;
        }

        if (mode === 'sms') {
          const phone = (inputSmsPhone.value || '').trim();
          const smsCode = (inputSmsCode.value || '').trim();
          if (!phone || !smsCode) {
            errEl.textContent = '请填写手机号和验证码';
            return;
          }

          const resp = await API.userAuth.loginBySms({
            phone,
            smsCode
          });
          if (!resp || resp.status !== 'success' || !resp.data || !resp.data.token) {
            errEl.textContent = (resp && resp.message) ? resp.message : '登录失败';
            return;
          }
          await AuthService.afterLoginSuccess({
            remember: chkSmsRemember.checked,
            account: phone,
            vipExpireTime: resp.data && resp.data.vipExpireTime
          });
          close();
          return;
        }

        if (mode === 'reset') {
          const phone = (inputResetPhone.value || '').trim();
          const smsCode = (inputResetCode.value || '').trim();
          const newPassword = (inputResetNewPwd.value || '');
          if (!phone || !smsCode || !newPassword) {
            errEl.textContent = '请填写手机号、验证码和新密码';
            return;
          }

          const resp = await API.userAuth.resetPassword({
            phone,
            smsCode,
            newPassword
          });
          if (!resp || resp.status !== 'success') {
            errEl.textContent = (resp && resp.message) ? resp.message : '修改失败';
            return;
          }

          errEl.textContent = '密码修改成功，请使用新密码登录';
          setMode('pwd');
          inputPwdAcc.value = phone;
          inputPwdPwd.value = '';
          return;
        }

        if (mode === 'register') {
          const phone = (inputRegisterPhone.value || '').trim();
          const smsCode = (inputRegisterCode.value || '').trim();
          const password = (inputRegisterPwd.value || '');
          if (!phone || !smsCode || !password) {
            errEl.textContent = '请填写手机号、验证码和密码';
            return;
          }

          // 注册接口：后端返回 LoginResp，并且已经登录成功
          const resp = await API.post('/api/front/user/inviteRegister', {
            phone,
            smsCode,
            password,
            inviterId: null,
            inviterPhone: null,
            username: phone
          });

          if (!resp || resp.status !== 'success' || !resp.data || !resp.data.token) {
            errEl.textContent = (resp && resp.message) ? resp.message : '注册失败';
            return;
          }

          // ✅ 写入 tokenName/token（因为这是新接口，不一定走 API.userAuth 的封装）
          try {
            const tn = resp.data.tokenName || 'auth-token';
            const tk = resp.data.token || '';
            if (tk) {
              API.setToken && API.setToken(tk);
              API.setTokenName && API.setTokenName(tn);
            }
          } catch {}

          // 注册成功后，走统一登录后逻辑（会拉 profile、更新底部手机号）
          await AuthService.afterLoginSuccess({
            remember: true,
            account: phone,
            vipExpireTime: resp.data && resp.data.vipExpireTime

          });
          close();
          return;
        }
      } finally {
        btnSubmit.disabled = false;
        if (mode === 'reset') btnSubmit.textContent = '确认修改';
        else if (mode === 'register') btnSubmit.textContent = '立即注册';
        else btnSubmit.textContent = '立即登录';
      }
    }

    btnSubmit.onclick = doSubmit;
    mask.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') doSubmit();
      if (e.key === 'Escape') close();
    });

    setMode('pwd');
  }

  function showConfirmModal(message, onConfirm, onCancel) {
    window.AuthStyles && AuthStyles.ensure && AuthStyles.ensure();

    const old = document.getElementById('auth-confirm-modal');
    if (old) old.remove();

    const mask = document.createElement('div');
    mask.id = 'auth-confirm-modal';
    mask.className = 'auth-mask';
    mask.innerHTML = `
      <div class="auth-dialog auth-dialog-wrap" role="dialog" aria-modal="true" style="width:420px;height:auto;">
        <button id="auth-confirm-close" class="auth-close" type="button">×</button>
        <div class="auth-title" style="font-size:16px;margin-bottom:14px;">${message || '确认操作'}</div>
        <div id="auth-vip-expire" style="margin:0 0 12px;color:#666;font-size:13px;"></div>
        <button id="auth-confirm-ok" class="auth-main-btn" style="margin-top:0;">确定</button>
      </div>
    `;
    document.body.appendChild(mask);
    const vipEl = mask.querySelector('#auth-vip-expire');
    try {
      const vip = localStorage.getItem('auth.vipExpireTime') || '';
      vipEl.textContent = vip ? `VIP到期时间：${vip.split(' ')[0]}` : ''; // 只显示日期可改
      if (!vip) vipEl.style.display = 'none';
    } catch {
      vipEl.style.display = 'none';
    }
    const close = () => {
      try {
        mask.remove();
      } catch {}
    };

    const btnClose = mask.querySelector('#auth-confirm-close');
    const btnOk = mask.querySelector('#auth-confirm-ok');

    btnClose && (btnClose.onclick = () => {
      close();
      if (typeof onCancel === 'function') onCancel();
    });

    btnOk && (btnOk.onclick = () => {
      close();
      if (typeof onConfirm === 'function') onConfirm();
    });

    mask.addEventListener('click', (e) => {
      if (e.target === mask) {
        close();
        if (typeof onCancel === 'function') onCancel();
      }
    });
  }

  window.AuthUI = {
    showLoginModal,
    showConfirmModal
  };
})();