(function() {
  function ensureStyles() {
    const ID = (window.AuthConst && AuthConst.MODAL_STYLE_ID) || 'auth-modal-styles';
    if (document.getElementById(ID)) return;

    const style = document.createElement('style');
    style.id = ID;
    style.textContent = `
      .auth-mask{
        position:fixed;inset:0;background:rgba(0,0,0,.28);
        z-index:3000;display:flex;align-items:center;justify-content:center;
        padding:5px;
      }
      .auth-dialog{
        background:#fff;
        width:520px;
        max-width:95vw;
        border-radius:14px;
        box-shadow:0 18px 55px rgba(0,0,0,.18);
        padding:15px;

        /* 固定高度，防止切换抖动 */
        height:350px;
        display:flex;
        flex-direction:column;
      }
      .auth-dialog-wrap{ position:relative; }
      .auth-body{
        flex:1 1 auto;
        display:flex;
        flex-direction:column;
        min-height: 0; 
      }

      .auth-title{
        font-size:22px;font-weight:600;color:#111;margin:0 0 18px;
        letter-spacing:.5px;
      }

      .auth-form{
        flex: 1 1 auto;
        min-height: 0;            /* 关键：配合 overflow */
        overflow: hidden;         /* 默认不滚动 */
      }
      .auth-row{
        display:flex;align-items:center;
        padding:10px 0;
        border-bottom:1px solid #eee;
      }
      .auth-label{
        width:70px;
        color:#111;
        font-size:16px;
        flex:0 0 auto;
      }
      .auth-input{
        flex:1;
        border:0;
        outline:none;
        font-size:16px;
        padding:6px 0;
        background:transparent;
        color:#111;
        width:80%;
      }
      .auth-input::placeholder{color:#bdbdbd}

      .auth-icon-btn{
        border:0;background:transparent;cursor:pointer;
        padding:6px;border-radius:10px;
      }
      .auth-icon-btn:hover{background:#f4f5f7}
      .auth-icon{
        width:22px;height:22px;display:block;
        opacity:.55;
      }

      .auth-remember{
        display:flex;align-items:center;gap:8px;
        margin-top:14px;
        color:#666;
        font-size:13px;
        user-select:none;
      }
      .auth-remember input{width:16px;height:16px;margin:0}

      .auth-error{
        color:#e02424;
        font-size:12px;
        min-height:18px;
        margin-top:12px;
      }

      .auth-main-btn{
        width:100%;
        height:36px;
        border-radius:999px;
        border:0;
        cursor:pointer;
        background:#4f83ff;
        color:#fff;
        font-size:17px;
        letter-spacing:1px;
        box-shadow:0 12px 26px rgba(79,131,255,.25);
      }
      .auth-main-btn:hover{background:#3f74f7}
      .auth-main-btn:disabled{
        opacity:.6;cursor:not-allowed;box-shadow:none;
      }

      .auth-footer{
        margin-top:16px;
        display:flex;
        justify-content:center;
        gap:16px;
        font-size:14px;
        flex: 0 0 auto;
      }
      .auth-link{
        color:#4f83ff;
        text-decoration:none;
        cursor:pointer;
      }
      .auth-link:hover{ text-decoration:underline; }
      .auth-split{ color:#d2d2d2; }

      .auth-sms-wrap{
        display:flex;
        align-items:center;
        gap:10px;
        flex:1;
      }
      .auth-sms-btn{
        height:34px;
        border-radius:999px;
        border:1px solid #d9e2ff;
        background:#f3f6ff;
        color:#2d5bff;
        font-size:12px;
        padding:0 12px;
        cursor:pointer;
        white-space:nowrap;
      }
      .auth-sms-btn:disabled{opacity:.6;cursor:not-allowed}

      .auth-close{
        position:absolute;
        right:14px;top:12px;
        width:34px;height:34px;
        border-radius:10px;
        border:0;background:#f2f3f5;
        cursor:pointer;
        color:#666;
        font-size:18px;
        line-height:34px;
      }
      .auth-close:hover{background:#e9ebef}
      .auth-vip-expire{
        margin:0 0 12px;
        color:#666;
        font-size:13px;
      }
    `;
    document.head.appendChild(style);
  }

  window.AuthStyles = {
    ensure: ensureStyles
  };
})();