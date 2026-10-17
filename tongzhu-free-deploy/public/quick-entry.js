'use strict';
const sentenceReady=window.SentenceCore?Promise.resolve(window.SentenceCore):import('/sentence-core.mjs?v=5');
let sentenceDraft=null,sentenceEngine=null,sentenceBusy=false;
const sentenceContext=()=>({room:shared?.room.id||'demo',actor:state.current});
const sentenceExample=()=>{const i=state.items[0];return i?'买了2'+i.unit+i.name+'，30元，'+MEMBERS.length+'个人平摊':'买了两卷纸巾，30元，三个人平摊'};
function sentenceInput(text=''){
 return '<label class="field"><span>描述一件已买好的公共物品</span><textarea name="sentence" rows="3" maxlength="500" required placeholder="例如：'+esc(sentenceExample())+'">'+esc(text)+'</textarea></label><p class="small subtle">支持常见中文数量、金额和 AA 表达，一次一件物品。先生成草稿，再确认执行。</p>'+btn('填入示例','sentence-example','link-btn');
}
function sentenceCard(){return '<section class="sentence-card"><div class="sentence-heading"><div><span class="eyebrow">少填几个框，多一点轻松</span><h2>买好了？一句话记下来。</h2><p>先看清库存和分摊预览，确认后再入账。</p></div><span class="badge">新功能 · 确认后执行</span></div>'+form('sentence-parse',sentenceInput(),'生成确认草稿').replace(btn('取消','close','btn ghost'),'')+'</section>'}
const beforeSentenceOverview=overview;overview=function(){return beforeSentenceOverview().replace('<section class="purchase-summary">',sentenceCard()+'<section class="purchase-summary">')};
const beforeSentenceItems=itemsPage;itemsPage=function(){const original=btn(icon('plus')+'登记物品','add-item');return beforeSentenceItems().replace(original,'<div class="sentence-actions">'+btn('一句话录入','sentence-open','btn secondary')+original+'</div>')};
function openSentence(text=''){activeBill=null;openModal('一句话录入 · 公共采购',form('sentence-parse',sentenceInput(text),'生成确认草稿'))}
async function createSentenceDraft(text){
 const [parser,engine]=await Promise.all([sentenceReady,purchasingReady]);sentenceEngine=engine;
 const parsed=parser.parsePurchaseSentence(text,state.items,MEMBERS,state.current,TODAY);
 sentenceDraft={...parsed,entryDraftId:id(),context:sentenceContext(),facts:engine.purchaseDraftFacts(state,parsed.itemId,MEMBERS)};
 showSentenceDraft();return sentenceDraft;
}
function sentenceFields(f){const d=new FormData(f);return {itemId:String(d.get('itemId')||''),quantity:Number(d.get('quantity')),amount:parseCents(String(d.get('amount')||'')),date:String(d.get('date')||''),participants:d.getAll('participants')}}
function keepSentenceFields(f){if(!sentenceDraft||!f)return;const d=new FormData(f);Object.assign(sentenceDraft,{itemId:String(d.get('itemId')||''),quantity:String(d.get('quantity')||''),amount:String(d.get('amount')||''),date:String(d.get('date')||''),participants:d.getAll('participants')})}
function sentenceIssue(values){
 if(!sentenceDraft)return '请先生成确认草稿';
 if(sentenceDraft.blockers.length)return sentenceDraft.blockers.join(' ');
 if(JSON.stringify(sentenceDraft.context)!==JSON.stringify(sentenceContext()))return '房间或当前身份已切换，请返回重新生成草稿。';
 const item=state.items.find(i=>i.id===values.itemId);if(!item)return '请选择一件已登记的公共物品。';
 if(JSON.stringify(sentenceDraft.facts)!==JSON.stringify(sentenceEngine.purchaseDraftFacts(state,values.itemId,MEMBERS)))return '库存、采购进度或室友已变化，请点击「刷新草稿」重新核对。';
 const pending=purchaseForItem(values.itemId);if(pending?.status==='claimed'&&pending.claimedBy!==state.current)return '这件物品由'+member(pending.claimedBy).name+'认领，请由本人补货入账。';
 if(!Number.isInteger(values.quantity)||values.quantity<1||values.quantity>9999||values.quantity+item.quantity>9999)return '请按「'+item.unit+'」填写有效的实际数量，补货后库存最多 9999。';
 if(values.amount===null)return '请填写大于 0、最多两位小数的实际总金额。';
 if(!values.participants.length||!values.participants.every(id=>MEMBERS.some(m=>m.id===id)))return '请至少选择一位房间内的分摊人。';
 if(!/^\d{4}-\d{2}-\d{2}$/.test(values.date)||Number.isNaN(Date.parse(values.date))||new Date(values.date).toISOString().slice(0,10)!==values.date)return '请填写有效采购日期。';
 return '';
}
function showSentenceDraft(){
 const d=sentenceDraft;if(!d)return;activeBill=null;
 const selected=state.items.find(i=>i.id===d.itemId);
 openModal('确认草稿 · 尚未保存',form('sentence-confirm',
  '<div class="sentence-stage"><span>1 描述采购</span><strong>2 核对草稿</strong><span>3 补库与记账</span></div><blockquote class="sentence-quote">'+esc(d.text)+'</blockquote>'+
  (d.blockers.length?'<div class="notice">'+d.blockers.map(esc).join('<br>')+'</div>':'')+
  '<p class="small subtle">识别结果可以修改。未写日期时使用今天；付款人固定为当前身份。物品提醒日期保持现有设置。</p>'+
  (d.warnings.length?'<details class="sentence-hints" open><summary>请重点核对 '+d.warnings.length+' 项</summary><ul>'+d.warnings.map(s=>'<li>'+esc(s)+'</li>').join('')+'</ul></details>':'')+
  selectField('公共物品（必选）','itemId','<option value="">请选择物品</option>'+state.items.map(i=>'<option value="'+esc(i.id)+'" '+(i.id===d.itemId?'selected':'')+'>'+esc(i.name)+' · 库存单位 '+esc(i.unit)+'</option>').join(''))+
  '<div class="field-row">'+inputField('实际数量'+(selected?'（'+esc(selected.unit)+'）':''),'quantity','number',d.quantity,'required min="1" max="9999" step="1"')+inputField('实际总金额（元）','amount','number',d.amount,'required min="0.01" max="1000000" step="0.01"')+'</div>'+
  '<div class="field-row">'+inputField('采购日期','date','date',d.date,'required')+'<div class="field"><span>垫付人</span><strong class="sentence-payer">'+esc(member(state.current).name)+'（当前身份）</strong></div></div>'+
  '<fieldset class="field"><legend>参与 AA 的室友（必选）</legend><div class="checks">'+MEMBERS.map(m=>'<label><input type="checkbox" name="participants" value="'+esc(m.id)+'" '+(d.participants.includes(m.id)?'checked':'')+'>'+esc(m.name)+'</label>').join('')+'</div></fieldset>'+
  '<div class="purchase-preview sentence-preview" id="sentence-preview" aria-live="polite"></div><div class="sentence-actions">'+btn('返回修改原话','sentence-back','link-btn')+btn('刷新草稿','sentence-refresh','link-btn')+'</div>', '确认补货并生成 AA 账单'));
 updateSentencePreview(document.querySelector('form[data-kind="sentence-confirm"]'));
}
function updateSentencePreview(f){
 if(!f||!sentenceDraft||!sentenceEngine)return;const values=sentenceFields(f),issue=sentenceIssue(values),out=document.getElementById('sentence-preview'),submit=f.querySelector('button[type="submit"]');
 if(submit)submit.disabled=!!issue||sentenceBusy;
 if(!out)return;if(issue){out.textContent=issue;return}
 const i=state.items.find(x=>x.id===values.itemId),pending=purchaseForItem(i.id),split=Object.fromEntries(shares({amount:values.amount,participants:values.participants}).map(x=>[x.member,x.amount]));
 out.innerHTML='<strong>确认后将执行以下操作</strong><span>① '+(pending?(pending.status==='needed'?'由你认领现有补货需求并完成采购':'完成你已认领的采购'):'新增一条已完成的采购记录')+'</span><span>② '+esc(i.name)+'库存：'+i.quantity+' → '+(i.quantity+values.quantity)+' '+esc(i.unit)+'</span><span>③ 新增账单 ¥'+money(values.amount)+'，'+esc(member(state.current).name)+'垫付</span><div class="sentence-splits">'+values.participants.map(mid=>'<span>'+esc(member(mid).name)+'<strong>¥'+money(split[mid])+'</strong></span>').join('')+'</div><small>金额精确到分；余分按所选室友显示顺序分配。不会发起真实转账。</small>';
}
async function confirmSentence(f){
 if(sentenceBusy||purchaseSubmitting||saving)return false;const values=sentenceFields(f),issue=sentenceIssue(values);
 if(issue){f.querySelector('.form-error').textContent=issue;updateSentencePreview(f);return false}
 const draft=sentenceDraft;sentenceBusy=true;updateSentencePreview(f);
 try{const saved=await performPurchase('record-purchase',{...values,entryDraftId:draft.entryDraftId,previewActorId:draft.context.actor,facts:draft.facts},{form:f,close:true,operationId:draft.entryDraftId});if(saved&&sentenceDraft===draft)sentenceDraft=null;return saved}
 finally{sentenceBusy=false;if(sentenceDraft)updateSentencePreview(f)}
}
const sentencePreviousDecorate=window.sharedDecorate;window.sharedDecorate=function(){sentencePreviousDecorate();updateSentencePreview(document.querySelector('form[data-kind="sentence-confirm"]'))};
document.addEventListener('click',async e=>{const b=e.target.closest('[data-action]');if(!b||b.disabled||!['sentence-open','sentence-example','sentence-back','sentence-refresh'].includes(b.dataset.action))return;e.preventDefault();e.stopImmediatePropagation();if(sentenceBusy)return;
 if(b.dataset.action==='sentence-open')openSentence();
 if(b.dataset.action==='sentence-example'){const f=b.closest?.('form'),field=f?.querySelector('[name="sentence"]');if(field){field.value=sentenceExample();field.focus()}}
 if(b.dataset.action==='sentence-back')openSentence(sentenceDraft?.text||'');
 if(b.dataset.action==='sentence-refresh'){
  const f=document.querySelector('form[data-kind="sentence-confirm"]');if(!sentenceDraft||!f)return;keepSentenceFields(f);if(shared)await refreshShared(true);
  if(JSON.stringify(sentenceDraft.context)!==JSON.stringify(sentenceContext())){toast('房间或身份已切换，请重新生成草稿');return}
  const old=shopping().find(p=>p.entryDraftId===sentenceDraft.entryDraftId);if(old){if(old.status==='completed')completionReceipt(old.id);else toast('这份草稿曾经执行，请重新生成草稿');return}
  sentenceDraft.facts=sentenceEngine.purchaseDraftFacts(state,sentenceDraft.itemId,MEMBERS);showSentenceDraft();
 }
},true);
document.addEventListener('submit',async e=>{const f=e.target,kind=f.dataset?.kind;if(!['sentence-parse','sentence-confirm'].includes(kind))return;e.preventDefault();e.stopImmediatePropagation();if(sentenceBusy)return;
 if(kind==='sentence-parse'){try{await createSentenceDraft(String(new FormData(f).get('sentence')||''))}catch(error){f.querySelector('.form-error').textContent=error.message}}
 else await confirmSentence(f);
},true);
function sentenceChanged(e){const f=e.target.closest?.('form[data-kind="sentence-confirm"]');if(!f||!sentenceDraft)return;
 if(e.target.name==='itemId'&&e.type==='change'){keepSentenceFields(f);sentenceDraft.quantity='';sentenceDraft.facts=sentenceEngine.purchaseDraftFacts(state,sentenceDraft.itemId,MEMBERS);showSentenceDraft();return}
 updateSentencePreview(f);
}
document.addEventListener('input',sentenceChanged);document.addEventListener('change',sentenceChanged);
window.SentenceEntry={ready:sentenceReady,createDraft:createSentenceDraft,getDraft:()=>sentenceDraft,issue:sentenceIssue,confirm:confirmSentence};
sentenceReady.catch(()=>toast('一句话录入加载失败，请刷新页面'));render();
