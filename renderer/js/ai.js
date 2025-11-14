(function() {
  const { ipcRenderer } = require('electron');
  const SINGLE_CLICK_DELAY = 300;

  /********* 调试日志 *********/
  ipcRenderer.on('ai:debug-log', (_e, payload) => {
    try {
      const tag = payload && payload.tag ? `[${payload.tag}]` : '';
      console.groupCollapsed(`%cAI 调试 ${tag}`, 'color:#0a84ff');
      console.log(payload);
      console.groupEnd();
    } catch {}
  });

  /********* 基础工具 *********/
  function normalizeText(s) {
    return String(s || '').replace(/\r\n/g, '\n').trim();
  }
  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function showHintBox(message) {
    let hintBox = document.getElementById('hintBox');
    if (!hintBox) {
      hintBox = document.createElement('div');
      hintBox.id = 'hintBox';
      hintBox.style.cssText = [
        'position:fixed','top:20px','left:50%','transform:translateX(-50%)',
        'background:rgba(0,0,0,.7)','color:#fff','padding:10px 30px',
        'border-radius:5px','z-index:9999','font-size:16px'
      ].join(';');
      document.body.appendChild(hintBox);
    }
    hintBox.textContent = message;
    hintBox.style.display = 'block';
    setTimeout(()=>{hintBox.style.display='none';},1000);
  }

  /********* OCR *********/
  const http = require('http');
  function getWeChatOCRText(callback) {
    const url = "http://127.0.0.1:5678/screenshot_ocr?img=wecom.png";
    http.get(url, res => {
      let data=''; res.on('data',c=>data+=c);
      res.on('end', () => {
        try {
          const obj = JSON.parse(data);
          callback(obj.status==="ok"?obj.text:"截图或OCR失败");
        } catch(e){ callback("解析失败:"+e.message); }
      });
    }).on('error', err=> callback('请求错误:'+err.message));
  }
  document.getElementById('resetAreaBtn')?.addEventListener('click', ()=>{
    fetch('http://127.0.0.1:5678/reset_area')
      .then(r=>r.json()).then(()=>showHintBox('截图区域已重选！'))
      .catch(()=>showHintBox('截图区域重选失败'));
  });

  /********* 建议解析 *********/
  function stripMarkdown(s){
    return String(s||'')
      .replace(/```[\s\S]*?```/g,'')
      .replace(/^#{1,6}\s+/gm,'')
      .replace(/\*\*(.*?)\*\*/g,'$1')
      .replace(/\*(.*?)\*/g,'$1')
      .replace(/^>\s?/gm,'')
      .replace(/!\[[^\]]*\]\([^)]+\)/g,'')
      .replace(/\[([^\]]+)\]\([^)]+\)/g,'$1')
      .replace(/`([^`]+)`/g,'$1')
      .replace(/[ \t]+\n/g,'\n')
      .replace(/\u00A0/g,' ')
      .replace(/\n{3,}/g,'\n\n')
      .trim();
  }
  function parseSuggestionsFromText(raw){
    if(!raw) return [];
    const s = String(raw).replace(/\r\n/g,'\n');
    const re = /^(\s*)(\d+)\.\s+(.+)$/gm;
    let m, matches=[];
    while((m=re.exec(s))!==null) matches.push({index:m.index,title:m[3]||''});
    if(matches.length){
      for(let i=0;i<matches.length;i++){
        const start=matches[i].index;
        const end=i+1<matches.length?matches[i+1].index:s.length;
        const seg=s.slice(start,end).trim();
        const nl=seg.indexOf('\n');
        const title=matches[i].title.trim();
        const body=nl>=0?seg.slice(nl+1):'';
        const quoteLines=body.split('\n').filter(l=>l.trim().startsWith('>'));
        const content=quoteLines.length?quoteLines.map(l=>l.replace(/^\s*>\s?/,'')).join('\n'):title+(body?'\n'+body:'');
        const cleaned=stripMarkdown(content);
        if(cleaned) matches[i].text=cleaned;
      }
      return matches.map(x=>x.text).filter(Boolean);
    }
    let body=s;
    const idx=s.indexOf('回复话术');
    if(idx>=0) body=s.slice(idx+'回复话术'.length);
    return body.split(/\n{2,}/)
      .map(p=>stripMarkdown(p).trim())
      .filter(p=>p && !/^客户问[:：]/.test(p))
      .slice(0,10);
  }

  /********* 渲染建议（仅编辑） *********/
  function renderSuggestions(items){
    const list=document.getElementById('ai-suggestions');
    if(!list) return;
    const arr=Array.isArray(items)&&items.length?items:['（无内容）'];
    list.innerHTML=arr.map((text,i)=>{
      const safe=escapeHtml(text);
      return `<li class="ai-sug" data-idx="${i}">
        <div class="title">建议 ${i+1}</div>
        <div class="body" title="单击：粘贴；双击：粘贴并发送">${safe}</div>
        <div class="editor" hidden><textarea>${safe}</textarea></div>
        <div class="ops"><button data-op="edit">编辑</button></div>
      </li>`;
    }).join('');
  }

  async function requestAiRaw(ctx, agentConfig){
    try{
      const res=await ipcRenderer.invoke('ai:generate',{prompt:String(ctx||''),agentConfig});
      const text=String(res?.text||res?.debug?.finalText||'');
      return normalizeText(text);
    }catch(e){
      console.warn('ai:generate error:', e.message);
      return '';
    }
  }

  /********* 智能体管理（仅来自后端） *********/
  let aiAgents=[];          // {name, token, botid, expire}
  let selectedAgentIdx=null;
  let loadingAgents=false;
  let agentInitialRequested=false;

  function getSelectedAgentConfig(){
    const a=aiAgents[selectedAgentIdx];
    return a?{token:a.token, botId:a.botid, userId:'123456789'}:null;
  }

  function updateAgentSelectedBtn(){
    const btn=document.getElementById('ai-agent-selected-btn');
    if(!btn) return;
    if(selectedAgentIdx==null || !aiAgents[selectedAgentIdx]){
      btn.textContent='智能体';
      btn.title= aiAgents.length?'点击选择智能体':'暂无智能体';
    }else{
      btn.textContent=aiAgents[selectedAgentIdx].name;
      btn.title='当前智能体：'+aiAgents[selectedAgentIdx].name;
    }
  }

  function renderAIAgentDropdown(){
    const list=document.getElementById('ai-agent-dropdown-list');
    if(!list) return;
    if(loadingAgents){
      list.innerHTML='<li class="loading">加载中…</li>';
      return;
    }
    if(!aiAgents.length){
      list.innerHTML='<li class="empty">无智能体</li>';
      return;
    }
    const today=new Date().toISOString().slice(0,10);
    list.innerHTML=aiAgents.map((a,i)=>{
      const expired=a.expire && a.expire < today;
      const sel=i===selectedAgentIdx?'selected':'';
      return `<li class="${sel} ${expired?'expired':''}" data-idx="${i}">
        <span class="agent-name">${escapeHtml(a.name||('智能体'+(i+1)))}</span>
        ${expired?'<span style="color:#e02424;font-size:12px;margin-left:6px;">已过期</span>':''}
      </li>`;
    }).join('');
  }

  async function loadAgentsFromAPI(){
    if(loadingAgents) return;
    if(!window.API || !API.agent || typeof API.agent.listByMyTeam!=='function'){
      console.log('[AI] API.agent.listByMyTeam 尚不可用，稍后再试');
      return;
    }
    loadingAgents=true;
    renderAIAgentDropdown();
    console.log('[AI] 请求智能体列表 /api/front/agent/listByMyTeam');
    try{
      const resp=await API.agent.listByMyTeam();
      const list=(resp && resp.status==='success' && Array.isArray(resp.data))?resp.data:[];
      aiAgents=(list||[]).map(a=>({
        name:a.title||a.name||'智能体',
        token:a.kzToken||a.token||'',
        botid:a.botId||a.botid||'',
        expire:a.expireDate||a.expire||''
      })).filter(x=>x.token && x.botid);
      if(aiAgents.length){
        if(selectedAgentIdx==null || !aiAgents[selectedAgentIdx]) selectedAgentIdx=0;
      }else{
        selectedAgentIdx=null;
      }
    }catch(e){
      console.warn('[AI] 获取智能体失败:', e.message);
      aiAgents=[]; selectedAgentIdx=null;
    }finally{
      loadingAgents=false;
      updateAgentSelectedBtn();
      renderAIAgentDropdown();
    }
  }

  // 轮询等待 API 注入（确保 api.js 已加载）
  let apiWaitCount=0;
  function waitAPIThenLoad(){
    if(window.API && API.agent && typeof API.agent.listByMyTeam==='function'){
      if(!agentInitialRequested){
        agentInitialRequested=true;
        loadAgentsFromAPI();
      }
      return;
    }
    apiWaitCount++;
    if(apiWaitCount>40){ // ~2秒
      console.warn('[AI] 等待 API 超时，无法请求智能体');
      updateAgentSelectedBtn();
      renderAIAgentDropdown();
      return;
    }
    setTimeout(waitAPIThenLoad,50);
  }
  waitAPIThenLoad();

  /********* 下拉交互 *********/
  document.getElementById('ai-agent-selected-btn')?.addEventListener('click', ()=>{
    const dd=document.getElementById('ai-agent-dropdown');
    if(!dd) return;
    if(dd.style.display==='block'){
      dd.style.display='none';
      return;
    }
    dd.style.display='block';
    // 若尚未加载成功再试一次
    if(!aiAgents.length && !loadingAgents) loadAgentsFromAPI();
    renderAIAgentDropdown();
  });
  document.addEventListener('click', (e)=>{
    const dd=document.getElementById('ai-agent-dropdown');
    const btn=document.getElementById('ai-agent-selected-btn');
    if(!dd || dd.style.display!=='block') return;
    if(dd.contains(e.target) || btn.contains(e.target)) return;
    dd.style.display='none';
  }, true);
  document.getElementById('ai-agent-dropdown-list')?.addEventListener('click', e=>{
    const li=e.target.closest('li[data-idx]');
    if(!li) return;
    const idx=Number(li.dataset.idx);
    if(!aiAgents[idx]) return;
    selectedAgentIdx=idx;
    updateAgentSelectedBtn();
    document.getElementById('ai-agent-dropdown').style.display='none';
  });

  /********* 建议区事件 *********/
  function bindSuggestionEvents(){
    const list=document.getElementById('ai-suggestions');
    if(!list || bindSuggestionEvents.bound) return;
    bindSuggestionEvents.bound=true;

    list.addEventListener('click',(e)=>{
      const opBtn=e.target.closest('button[data-op]');
      if(opBtn){
        const li=e.target.closest('li.ai-sug');
        if(!li) return;
        const bodyEl=li.querySelector('.body');
        const editor=li.querySelector('.editor');
        const textarea=editor.querySelector('textarea');
        const op=opBtn.dataset.op;
        if(op==='edit'){
          editor.removeAttribute('hidden');
          textarea.value=bodyEl.textContent||'';
          bodyEl.setAttribute('hidden','hidden');
          opBtn.dataset.op='commit';
          opBtn.textContent='保存修改';
          textarea.focus();
          textarea.setSelectionRange(textarea.value.length, textarea.value.length);
        }else if(op==='commit'){
          const val=normalizeText(textarea.value);
          bodyEl.textContent=val;
          bodyEl.removeAttribute('hidden');
          editor.setAttribute('hidden','hidden');
          opBtn.dataset.op='edit';
          opBtn.textContent='编辑';
        }
        return;
      }
    });

    let singleTimer=null;
    list.addEventListener('click',(e)=>{
      const body=e.target.closest('.ai-sug .body');
      if(!body) return;
      const editor=body.parentElement.querySelector('.editor');
      if(editor && !editor.hasAttribute('hidden')) return;
      const text=body.textContent||'';
      if(!normalizeText(text)) return;
      clearTimeout(singleTimer);
      singleTimer=setTimeout(()=>{
        ipcRenderer.send('phrase:paste', text);
        singleTimer=null;
      }, SINGLE_CLICK_DELAY);
    });
    list.addEventListener('dblclick',(e)=>{
      const body=e.target.closest('.ai-sug .body');
      if(!body) return;
      const editor=body.parentElement.querySelector('.editor');
      if(editor && !editor.hasAttribute('hidden')) return;
      const text=body.textContent||'';
      if(!normalizeText(text)) return;
      if(singleTimer){ clearTimeout(singleTimer); singleTimer=null; }
      ipcRenderer.send('phrase:paste-send', text);
    });
  }

  /********* 生成按钮 *********/
  function bindGenerate(){
    const btn=document.getElementById('ai-generate');
    const ta=document.getElementById('ai-context');
    if(!btn || !ta || bindGenerate.bound) return;
    bindGenerate.bound=true;
    btn.addEventListener('click', async ()=>{
      const orig=btn.textContent;
      btn.disabled=true;
      btn.textContent='截图中…';
      try{
        const ocr=await new Promise(r=>getWeChatOCRText(r));
        const cleaned=normalizeText(ocr);
        if(!cleaned || /^截图|OCR|解析失败|请求错误/.test(cleaned)){
          showHintBox('截图/OCR失败');
          return;
        }
        ta.value=cleaned;
        try{ ta.dispatchEvent(new Event('input',{bubbles:true})); }catch{}
        btn.textContent='生成中…';
        const agentConfig=getSelectedAgentConfig();
        if(!agentConfig) showHintBox('未选择智能体');
        const ans=await requestAiRaw(cleaned, agentConfig);
        renderSuggestions(parseSuggestionsFromText(ans));
      }finally{
        btn.disabled=false;
        btn.textContent=orig;
      }
    });
  }

  /********* 登录 / 菜单事件 *********/
  window.addEventListener('auth:login', ()=>{
    console.log('[AI] auth:login -> reload agents');
    loadAgentsFromAPI();
  });
  window.addEventListener('auth:logout', ()=>{
    aiAgents=[]; selectedAgentIdx=null;
    updateAgentSelectedBtn();
    renderAIAgentDropdown();
  });
  ipcRenderer.on('menu:switch-tab',(_e,tab)=>{
    if(tab==='ai'){
      console.log('[AI] menu switch to ai -> ensure agents loaded');
      if(!aiAgents.length && !loadingAgents) loadAgentsFromAPI();
    }
  });

  /********* 初始化 *********/
  window.addEventListener('DOMContentLoaded', ()=>{
    // 清除旧的“添加智能体”UI（若残留）
    document.getElementById('ai-agent-add-btn')?.remove();
    document.querySelectorAll('.agent-edit-btn,.agent-delete-btn,#ai-agent-modal,#ai-agent-confirm-modal')
      .forEach(el=>el.remove());

    bindGenerate();
    bindSuggestionEvents();
    renderSuggestions(['（这里将显示 AI 的原样回复，自动拆分）']);

    // 若 API 已经可用立即请求；否则 waitAPIThenLoad 已在顶部启动
    if(window.API && API.agent && typeof API.agent.listByMyTeam==='function' && !agentInitialRequested){
      agentInitialRequested=true;
      loadAgentsFromAPI();
    } else {
      console.log('[AI] DOMContentLoaded 等待 API 注入完成…');
    }
  });
})();