'use strict';
// Shared mode uses the server's authenticated member; demo mode remains browser-local.
const DEMO_MEMBERS=MEMBERS.map(m=>({...m}));
const ROOM_KEY='tongzhu.active-room.v2';
let shared=null,account=null,myRooms=[],saving=false,syncBusy=false,syncFailed=false,lastSynced=null,activeBill=null;
let preferredRoom=null;try{preferredRoom=localStorage.getItem(ROOM_KEY)}catch{}
function rememberRoom(value){try{localStorage.setItem(ROOM_KEY,value)}catch{}}
async function api(path,options={}){
 const response=await fetch('/api'+path,{credentials:'same-origin',cache:'no-store',...options,headers:{'Content-Type':'application/json','X-Requested-With':'Tongzhu',...(options.headers||{})},signal:AbortSignal.timeout(15000)});
 const data=await response.json();if(!response.ok){const error=new Error(data.error||'请求失败，请重试');error.status=response.status;throw error}return data;
}
function roomLink(code){return location.origin+'/?invite='+encodeURIComponent(code)}
function showSync(){const el=document.getElementById('sync-label');if(el)el.textContent=saving?'正在保存…':syncFailed?'同步中断，请检查网络':shared?'云端已同步 · '+(lastSynced||''):'示例体验';}
function applySnapshot(value){shared=value;state={...value.state,roomName:value.room.name};MEMBERS=value.members;lastSynced=new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',second:'2-digit'});syncFailed=false;rememberRoom(value.room.id);render();decorateModal();}
function demoMode(){shared=null;MEMBERS=DEMO_MEMBERS.map(m=>({...m}));try{state=JSON.parse(localStorage.getItem(KEY)||'null')||seed()}catch{state=seed()}if(!MEMBERS.some(m=>m.id===state.current))state=seed();page='overview';weekOffset=0;activeBill=null;rememberRoom('demo');modal.close();render();}
function activityHTML(){return shared.activity.length?shared.activity.map(a=>'<div class="activity-row"><strong>'+esc(a.actor)+'</strong> '+esc(a.summary)+'<small>'+new Date(a.at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})+'</small></div>').join(''):'<p class="small subtle">还没有协作记录。</p>'}
function canDeleteRecord(record){return shared.room.role==='owner'||record?.createdBy===state.current}
function decorateModal(){if(!shared)return;
 const payer=document.querySelector('#modal select[name="payer"]');if(payer){payer.value=state.current;payer.disabled=true;}
 document.querySelectorAll('#modal [data-action="settle"]').forEach(b=>{const bill=state.bills.find(x=>x.id===b.dataset.id);if(bill?.payer!==state.current){b.disabled=true;b.textContent='待垫付人确认';b.title='由垫付人核对实际收款后确认'}});
 for(const kind of ['bill','task','item','rule'])document.querySelectorAll('[data-action="delete-'+kind+'"]').forEach(b=>{const list=state[{bill:'bills',task:'tasks',item:'items',rule:'rules'}[kind]],record=list.find(x=>x.id===b.dataset.id);if(!canDeleteRecord(record)){b.disabled=true;b.title='只有创建者或房主可以删除'}});
 const notes=document.querySelectorAll('#modal p.small.subtle');notes.forEach(p=>{if(p.textContent.includes('代室友确认'))p.textContent='由垫付人确认实际收款；每次更新会记录操作人。此处仅记账，不会转账。'});
}
window.sharedDecorate=function(){
 document.getElementById('member-select').disabled=!!shared;
 const profileLabel=document.querySelector('label[for="member-select"]');if(profileLabel)profileLabel.textContent=shared?'当前房间身份':'当前体验身份';
 const houseTitle=document.querySelector('.house-card strong'),houseText=document.querySelector('.house-card>span');
 if(houseTitle)houseTitle.textContent=shared?shared.room.name:'梧桐小屋 · 302';
 if(houseText)houseText.innerHTML='<i class="status-dot"></i>'+(shared?MEMBERS.length+' 位室友，云端共享':'3 位室友，共同经营');
 const crumb=document.getElementById('room-crumb');if(crumb)crumb.textContent=shared?shared.room.name:'梧桐小屋';
 const banner=document.getElementById('collab-banner');
 banner.innerHTML=shared?'<div><strong>'+icon('users')+' '+esc(shared.room.name)+'</strong><span class="sync-label" id="sync-label"></span></div><div class="room-actions">'+(shared.room.role==='owner'?btn('邀请室友','invite-room','btn secondary tiny'):'')+btn('房间与动态','manage-rooms','btn secondary tiny')+'</div>':'<div><strong>'+icon('users')+' 和室友一起管理真实的小屋</strong><span class="sync-label" id="sync-label">当前为示例体验</span></div><div class="room-actions">'+btn('创建 / 加入房间','manage-rooms','btn tiny')+'</div>';
 const footer=document.querySelector('.footer [data-action="reset"]');if(footer)footer.textContent=shared?'返回示例体验':'重置示例数据';
 if(shared){document.getElementById('demo-note').innerHTML=icon('info')+'共享房间 · '+MEMBERS.length+' 位室友 · 页面打开时约每 4 秒同步。'+btn('立即同步','refresh-room','link-btn');decorateModal()}
 showSync();
};
function authForm(mode='login'){
 activeBill=null;const register=mode==='register',legacy=register&&account?.provider==='chatgpt';
 const returnTo=new URL(location.href);returnTo.searchParams.set('legacy','1');
 const legacyHref='/signin-with-chatgpt?return_to='+encodeURIComponent(returnTo.pathname+returnTo.search);
 const intro=legacy?'设置本站账号密码后，已有房间和记录会保留。':'使用本站账号即可共享房间，无需 ChatGPT 账号。';
 const tabs=legacy?'':'<div class="tabs auth-tabs">'+btn('登录','auth-login',register?'':'selected')+btn('注册账号','auth-register',register?'selected':'')+'</div>';
 const fields=inputField('账号','username','text','','required minlength="4" maxlength="24" pattern="[A-Za-z0-9_]{4,24}" autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="4–24 位字母、数字或下划线"')+(register?inputField('你的昵称','nickname','text',legacy?account.name?.slice(0,20)||'':'','required maxlength="20" autocomplete="nickname" placeholder="室友们怎么称呼你"'):'')+inputField('密码','password','password','','required minlength="8" maxlength="72" autocomplete="'+(register?'new-password':'current-password')+'" placeholder="至少 8 个字符"')+(register?inputField('再次输入密码','confirmPassword','password','','required minlength="8" maxlength="72" autocomplete="new-password"'):'');
 openModal(legacy?'设置本站账号密码':register?'注册同住账号':'登录同住',tabs+'<p class="small subtle">'+intro+'</p>'+form(register?'auth-register':'auth-login',fields,register?'注册并进入':'登录')+'<p class="small subtle auth-note">'+(new URL(location.href).searchParams.has('invite')?'登录后会继续加入邀请中的房间。':'登录后可以创建小屋，或通过邀请加入室友的房间。')+'</p>'+(!legacy?'<div class="auth-bottom">'+btn('继续示例体验','close','link-btn')+'<a class="link-btn" href="'+legacyHref+'" target="_top">原 ChatGPT 房间入口</a></div>':''));
}
async function afterAccountAuth(){
 await loadMyRooms();if(!account||account.provider!=='password')throw new Error('登录状态未能保存，请在浏览器新标签页打开本站后重试');
 if(shared&&!myRooms.some(r=>r.id===shared.room.id))demoMode();
 const url=new URL(location.href);url.searchParams.delete('legacy');history.replaceState(null,'',url.pathname+url.search+url.hash);
 const inviteCode=url.searchParams.get('invite');if(inviteCode){joinRoomForm(inviteCode);return}
 const room=myRooms.find(r=>r.id===shared?.room.id)||myRooms[0];if(room){modal.close();page='overview';weekOffset=0;applySnapshot(await api('/rooms/'+room.id))}else{window.sharedDecorate();roomManager()}
}
function roomManager(){activeBill=null;
 if(!account){authForm('login');return}
 openModal('我的房间'+(account.username?' · '+account.username:''),'<div class="room-option-grid">'+btn(icon('plus')+'创建新房间','create-room','btn')+btn(icon('users')+'用邀请加入','join-room','btn secondary')+'</div>'+(account.provider==='chatgpt'?'<div class="notice">已通过原 ChatGPT 身份进入。'+btn('设置本站账号密码','auth-register','link-btn')+'，保留已有房间。</div>':'')+(myRooms.length?myRooms.map(r=>'<div class="share-row"><div class="grow"><strong>'+esc(r.name)+'</strong><div class="small subtle">'+r.memberCount+' 位室友 · '+(r.role==='owner'?'我是房主':'我是成员')+'</div></div>'+btn(shared?.room.id===r.id?'当前房间':'进入','select-room','btn secondary tiny','data-id="'+esc(r.id)+'" '+(shared?.room.id===r.id?'disabled':''))+'</div>').join(''):'<div class="empty">还没有共享房间，创建一个邀请室友吧。</div>')+(shared?'<div class="room-section-label">最近协作动态</div>'+activityHTML():'')+'<div class="modal-actions">'+(shared?btn('返回示例体验','demo-mode','btn ghost'):'')+btn('退出登录','logout-account','btn ghost tiny')+'</div>');
}
function createRoomForm(){activeBill=null;openModal('创建共享房间',form('room-create',inputField('房间名称','name','text','','required maxlength="30" placeholder="例如：梧桐小屋 302"')+inputField('你在房间里的昵称','nickname','text',account?.name?.split('@')[0]?.slice(0,20)||'','required maxlength="20"')+'<p class="small subtle">新房间从空白开始，示例数据不会带入。创建后可复制邀请链接。</p>','创建房间'))}
function joinRoomForm(code=''){activeBill=null;if(!account){roomManager();return}openModal('加入室友的房间',form('room-join',inputField('邀请码或完整邀请链接','code','text',code,'required maxlength="500" placeholder="粘贴邀请链接，或填写 12 位邀请码"')+inputField('你在房间里的昵称','nickname','text',account.name?.split('@')[0]?.slice(0,20)||'','required maxlength="20"')+'<p class="small subtle">加入后可以查看和更新房间内的公共记录。相同账号会识别为同一位室友。</p>','加入房间'))}
function inviteRoom(){if(!shared||shared.room.role!=='owner')return;activeBill=null;const code=shared.room.inviteCode;openModal('邀请室友加入','<p class="small subtle">把链接发给室友，对方注册或登录本站账号即可加入。邀请码持续有效，房主更新后旧码立即失效。</p>'+inputField('邀请链接','invitation-link','text',roomLink(code),'readonly id="invite-link"')+'<div class="invite-code">'+code.match(/.{1,4}/g).join(' - ')+'</div><p class="small subtle" style="text-align:center">也可以在「创建 / 加入房间」中输入上方邀请码</p><div class="room-option-grid">'+btn('复制邀请链接','copy-invite','btn')+btn('更新邀请码','rotate-invite','btn ghost')+'</div>')}
async function loadMyRooms(){const data=await api('/bootstrap');account=data.user;myRooms=data.rooms;return data;}
async function refreshShared(force=false){if(!shared||syncBusy||saving||document.hidden&&!force)return;syncBusy=true;const rid=shared.room.id;try{const data=await api('/rooms/'+rid);if(shared?.room.id!==rid)return;if(data.revision!==shared.revision||force){applySnapshot(data);if(activeBill&&modal.open){billDetail(activeBill);decorateModal()}}else{syncFailed=false;lastSynced=new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',second:'2-digit'});showSync()}}catch(error){syncFailed=true;showSync();if(force)toast(error.message)}finally{syncBusy=false}}
async function sharedMutation(operation,payload,options={}){if(saving||!shared)return false;saving=true;showSync();const rid=shared.room.id,operationId=options.operationId||id();try{const snapshot=await api('/rooms/'+rid+'/actions',{method:'POST',body:JSON.stringify({operation,operationId,payload})});if(shared?.room.id!==rid)return false;if(options.close)modal.close();if(options.page)page=options.page;if(options.page==='chores')weekOffset=0;if(options.page==='bills')billFilter='all';applySnapshot(snapshot);if(options.billDetail){activeBill=payload.id;billDetail(payload.id);decorateModal()}toast('已保存并同步给室友');return true}catch(error){syncFailed=true;if(options.form){const el=options.form.querySelector('.form-error');if(el)el.textContent=error.message}toast(error.message);return false}finally{saving=false;showSync()}}
document.addEventListener('click',async e=>{const b=e.target.closest('[data-action]');if(!b||b.disabled)return;const a=b.dataset.action,bid=b.dataset.id;
 const localActions=['manage-rooms','create-room','join-room','select-room','invite-room','copy-invite','rotate-invite','demo-mode','refresh-room','auth-login','auth-register','logout-account'];
 const sharedActions=['reset','switch-member','select-member','settle','consume','confirm-rule','toggle-task','delete-bill','delete-task','delete-item','delete-rule'];
 if(!localActions.includes(a)&&!(shared&&sharedActions.includes(a)))return;
 e.preventDefault();e.stopImmediatePropagation();
 try{
 if(a==='manage-rooms'){await loadMyRooms();roomManager()}
 else if(a==='auth-login')authForm('login');
 else if(a==='auth-register')authForm('register');
 else if(a==='logout-account'){await api('/auth/logout',{method:'POST',body:'{}'});account=null;myRooms=[];demoMode();toast('已退出登录，共享房间记录会保留')}
 else if(a==='create-room'){if(account)createRoomForm();else roomManager()}
 else if(a==='join-room')joinRoomForm();
 else if(a==='select-room'){const value=await api('/rooms/'+bid);activeBill=null;page='overview';weekOffset=0;modal.close();applySnapshot(value)}
 else if(a==='invite-room')inviteRoom();
 else if(a==='copy-invite'){const link=roomLink(shared.room.inviteCode);try{await navigator.clipboard.writeText(link);toast('邀请链接已复制')}catch{const input=document.getElementById('invite-link');input.focus();input.select();toast('请按 Ctrl+C 或长按复制链接')}}
 else if(a==='rotate-invite'){if(!confirm('更新后旧邀请链接和邀请码立即失效，已加入的室友不受影响。确定更新吗？'))return;const value=await api('/rooms/'+shared.room.id+'/rotate-invite',{method:'POST',body:'{}'});applySnapshot(value);inviteRoom();toast('邀请码已更新')}
 else if(a==='demo-mode'||a==='reset'){demoMode();toast('已返回示例，共享房间的数据会保留')}
 else if(a==='switch-member'||a==='select-member')roomManager();
 else if(a==='refresh-room')await refreshShared(true);
 else if(a==='settle'){const bill=state.bills.find(x=>x.id===bid);if(bill)await sharedMutation('settle',{id:bid,member:b.dataset.member,settled:!bill.settled.includes(b.dataset.member)},{billDetail:true})}
 else if(a==='toggle-task'){const task=state.tasks.find(x=>x.id===bid);if(task&&!weekOffset)await sharedMutation('toggle-task',{id:bid,done:!taskDone(task)})}
 else if(a==='consume'||a==='confirm-rule')await sharedMutation(a,{id:bid});
 else if(a.startsWith('delete-')){if(confirm('确定删除这条共享记录吗？室友会同步看到删除结果。')){activeBill=null;await sharedMutation(a,{id:bid},{close:true})}}
 }catch(error){toast(error.message)}
},true);
document.addEventListener('click',e=>{const b=e.target.closest('[data-action]');if(!b)return;if(b.dataset.action==='bill-detail')activeBill=b.dataset.id;else if(['close','add-bill','add-task','add-item','add-rule','restock'].includes(b.dataset.action))activeBill=null;decorateModal()});
document.addEventListener('submit',async e=>{const f=e.target;if(!f.matches('form[data-kind]'))return;const kind=f.dataset.kind;if(!['bill','task','item','restock','rule','room-create','room-join','auth-register','auth-login'].includes(kind))return;if(!shared&&!['room-create','room-join','auth-register','auth-login'].includes(kind))return;
 e.preventDefault();e.stopImmediatePropagation();if(saving)return;const d=new FormData(f),v=k=>String(d.get(k)||'').trim(),error=f.querySelector('.form-error');const submit=f.querySelector('button[type="submit"]');if(submit)submit.disabled=true;
 try{
 if(kind==='auth-register'||kind==='auth-login'){
   const pass=String(d.get('password')||'');
   if(pass.length<8)throw new Error('密码至少需要 8 个字符');
   if(kind==='auth-register'&&pass!==String(d.get('confirmPassword')||''))throw new Error('两次输入的密码不一致');
   saving=true;const value=await api(kind==='auth-register'?'/auth/register':'/auth/login',{method:'POST',body:JSON.stringify({username:v('username'),password:pass,...(kind==='auth-register'?{nickname:v('nickname')}:{})})});
   await afterAccountAuth();toast(value.linkedExistingRooms?'账号密码已设置，原有房间已保留':kind==='auth-register'?'注册成功，欢迎加入同住':'登录成功');return;
 }
 if(kind==='room-create'||kind==='room-join'){saving=true;const value=await api(kind==='room-create'?'/rooms':'/rooms/join',{method:'POST',body:JSON.stringify(kind==='room-create'?{name:v('name'),nickname:v('nickname')}:{code:v('code'),nickname:v('nickname')})});modal.close();page='overview';weekOffset=0;applySnapshot(value);await loadMyRooms();const url=new URL(location.href);url.searchParams.delete('invite');history.replaceState(null,'',url.pathname+url.search+url.hash);if(kind==='room-create')inviteRoom();else toast('已加入房间，开始共同管理吧');return}
 let operation,payload,target;
 if(kind==='bill'){const amount=parseCents(v('amount'));if(amount===null)throw new Error('金额需大于 0，最多两位小数，且不超过 100 万元');operation='add-bill';payload={title:v('title'),amount,category:v('category'),date:v('date'),participants:d.getAll('participants')};target='bills'}
 else if(kind==='task'){operation='add-task';payload={name:v('name'),day:Number(v('day')),owner:v('owner')};target='chores'}
 else if(kind==='item'){operation='add-item';payload={name:v('name'),unit:v('unit'),quantity:Number(v('quantity')),threshold:Number(v('threshold')),keeper:v('keeper'),reminder:v('reminder')};target='items'}
 else if(kind==='restock'){operation='restock';payload={id:v('id'),quantity:Number(v('quantity')),reminder:v('reminder')}}
 else if(kind==='rule'){operation='add-rule';payload={title:v('title'),content:v('content')};target='rules'}
 if(operation)await sharedMutation(operation,payload,{form:f,close:true,page:target});
 }catch(err){if(error)error.textContent=err.message;toast(err.message)}finally{saving=false;if(submit)submit.disabled=false;showSync()}
},true);
document.addEventListener('change',e=>{if(shared&&e.target.id==='member-select'){e.stopImmediatePropagation();e.target.value=state.current}},true);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshShared(true)});
modal.addEventListener('close',()=>{activeBill=null;refreshShared()});
window.addEventListener('online',()=>refreshShared(true));
async function bootstrap(){window.sharedDecorate();try{await loadMyRooms();const code=new URL(location.href).searchParams.get('invite');if(code){if(account)joinRoomForm(code);else roomManager();return}const rid=preferredRoom==='demo'?null:myRooms.find(r=>r.id===preferredRoom)?.id||myRooms[0]?.id;if(account&&rid)applySnapshot(await api('/rooms/'+rid));else window.sharedDecorate()}catch(error){const label=document.getElementById('sync-label');if(label)label.textContent='共享连接失败，可点击创建 / 加入房间重试';console.error(error)}}
window.SharedRoom={bootstrap,refreshShared,sharedMutation,applySnapshot,getShared:()=>shared,getAccount:()=>account,roomManager,authForm};
setInterval(()=>refreshShared(),4000);bootstrap();
