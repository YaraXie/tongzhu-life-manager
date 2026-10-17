// One business engine for authenticated rooms and the public interactive demo.
export class PurchasingError extends Error {constructor(status,message){super(message);this.status=status}}
const ensure=(condition,message,status=400)=>{if(!condition)throw new PurchasingError(status,message)};
const int=(value,label,min=1,max=9999)=>{ensure(Number.isSafeInteger(value)&&value>=min&&value<=max,label+'超出有效范围');return value};
const date=value=>{ensure(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value,'请选择有效日期');return value};
export const PURCHASE_OPERATIONS=new Set(['request-purchase','claim-purchase','release-purchase','cancel-purchase','complete-purchase','undo-purchase','record-purchase']);
export const activePurchase=p=>p.status==='needed'||p.status==='claimed';
export function normalizePurchasing(data){if(!Array.isArray(data.shopping))data.shopping=[];return data}
export function purchaseDraftFacts(data,itemId,people){
 const i=data.items.find(x=>x.id===itemId),r=(data.shopping||[]).find(x=>x.itemId===itemId&&activePurchase(x));
 return {itemId,stock:i?.quantity??null,reminder:i?.reminder||'',purchase:r?{id:r.id,status:r.status,claimedBy:r.claimedBy||null}:null,members:people.map(x=>x.id).sort()};
}
export function linkedRecordError(data,kind,id){
 normalizePurchasing(data);
 if(kind==='bill'&&data.bills.some(b=>b.id===id&&b.purchaseId))return '这笔账单关联采购和库存，请在采购记录中撤销入账';
 if(kind==='item'&&data.shopping.some(p=>p.itemId===id&&(activePurchase(p)||p.status==='completed')))return '物品有关联采购记录，请先取消需求或撤销入账后再删除';
 return null;
}
export function applyPurchasing(data,operation,payload,actor,people,isOwner){
 normalizePurchasing(data);const p=payload||{},now=new Date().toISOString();
 const item=id=>{const result=data.items.find(i=>i.id===id);ensure(result,'关联物品已不存在，请刷新后重试',404);return result};
 const purchase=id=>{const result=data.shopping.find(i=>i.id===id);ensure(result,'采购需求不存在，请刷新后重试',404);return result};
 const participants=value=>{ensure(Array.isArray(value)&&value.length>0&&value.length<=people.length&&new Set(value).size===value.length&&value.every(id=>people.some(m=>m.id===id)),'请至少选择一位房间内的分摊人，且不能重复');return [...value]};
 if(operation==='record-purchase'){
  ensure(typeof p.entryDraftId==='string'&&/^[a-zA-Z0-9-]{16,80}$/.test(p.entryDraftId),'确认草稿标识无效');
  ensure(p.previewActorId===actor.id,'当前身份已变化，请重新生成确认草稿',409);
  const previous=data.shopping.find(x=>x.entryDraftId===p.entryDraftId);
  if(previous){ensure(previous.completedBy===actor.id&&previous.status==='completed','这份草稿已执行或撤销，请重新生成草稿',409);return '这份采购草稿已经入账，无需重复操作'}
  const facts=purchaseDraftFacts(data,p.itemId,people);
  ensure(JSON.stringify(p.facts)===JSON.stringify(facts),'库存、采购进度或室友已变化，请刷新草稿后重新确认',409);
  const i=item(p.itemId),next=JSON.parse(JSON.stringify(data));
  let r=next.shopping.find(x=>x.itemId===i.id&&activePurchase(x));
  ensure(!r||r.status!=='claimed'||r.claimedBy===actor.id,'这件物品已由其他室友认领，请由采购人补货入账',403);
  if(!r){applyPurchasing(next,'request-purchase',{itemId:i.id,quantity:p.quantity,note:'一句话录入，确认后补货入账'},actor,people,isOwner);r=next.shopping[0]}
  if(r.status==='needed')applyPurchasing(next,'claim-purchase',{id:r.id},actor,people,isOwner);
  const summary=applyPurchasing(next,'complete-purchase',{...p,id:r.id,reminder:i.reminder||''},actor,people,isOwner);
  r.entryDraftId=p.entryDraftId;r.entrySource='sentence';next.bills.find(x=>x.id===r.billId).entrySource='sentence';
  Object.assign(data,next);return summary;
 }
 if(operation==='request-purchase'){
  const i=item(p.itemId);ensure(data.shopping.length<500,'采购记录已达 500 条上限');ensure(!data.shopping.some(r=>r.itemId===i.id&&activePurchase(r)),'这件物品已有采购需求，请查看采购进度',409);
  const requestedQty=int(p.quantity,'计划采购数量');ensure(p.note===undefined||typeof p.note==='string'&&p.note.trim().length<=120,'备注最多 120 个字符');
  data.shopping.unshift({id:crypto.randomUUID(),itemId:i.id,itemName:i.name,emoji:i.emoji||'📦',unit:i.unit,requestedQty,note:(p.note||'').trim(),status:'needed',createdBy:actor.id,createdAt:now,claimedBy:null,claimedAt:null});
  return '发起了「'+i.name+'」补货需求：'+requestedQty+' '+i.unit;
 }
 const r=purchase(p.id);
 if(operation==='claim-purchase'){
  ensure(r.status==='needed','这项采购已被认领或已结束，请刷新查看',409);r.status='claimed';r.claimedBy=actor.id;r.claimedAt=now;return '认领了「'+r.itemName+'」采购';
 }
 if(operation==='release-purchase'){
  ensure(r.status==='claimed','这项采购当前不在采购中',409);ensure(r.claimedBy===actor.id||isOwner,'只有采购人或房主可以撤回认领',403);r.status='needed';r.claimedBy=null;r.claimedAt=null;return '撤回了「'+r.itemName+'」的采购认领';
 }
 if(operation==='cancel-purchase'){
  ensure(activePurchase(r),'这项采购已经结束',409);ensure(isOwner||(r.status==='needed'?r.createdBy===actor.id:r.claimedBy===actor.id),'只有发起人、采购人或房主可以取消相应需求',403);r.status='cancelled';r.cancelledBy=actor.id;r.cancelledAt=now;return '取消了「'+r.itemName+'」采购需求';
 }
 if(operation==='complete-purchase'){
  ensure(r.status==='claimed',r.status==='completed'?'这笔采购已经入账，请查看关联账单':'请先认领采购，再确认补货入账',409);ensure(r.claimedBy===actor.id,'只有认领采购的室友可以补货入账',403);
  const i=item(r.itemId),quantity=int(p.quantity,'实际补货数量'),amount=int(p.amount,'采购金额',1,100000000),members=participants(p.participants),purchaseDate=date(p.date),reminder=p.reminder?date(p.reminder):'';
  ensure(i.quantity+quantity<=9999,'补货后库存不能超过 9999');ensure(data.bills.length<500,'账单数量已达 500 条上限，请先整理账本');
  const billId=crypto.randomUUID(),oldReminder=i.reminder||'';
  i.quantity+=quantity;i.reminder=reminder;
  data.bills.unshift({id:billId,title:'采购'+r.itemName,category:'日用',amount,payer:actor.id,participants:members,settled:[],date:purchaseDate,createdBy:actor.id,purchaseId:r.id,itemId:i.id});
  Object.assign(r,{status:'completed',actualQty:quantity,amount,participants:members,billId,purchaseDate,completedBy:actor.id,completedAt:now,previousReminder:oldReminder,reminderAfterCompletion:reminder});
  return '完成「'+r.itemName+'」采购：补充 '+quantity+' '+r.unit+'，¥'+(amount/100).toFixed(2)+' 已入账';
 }
 if(operation==='undo-purchase'){
  ensure(r.status==='completed','这项采购当前没有可撤销的入账',409);ensure(r.completedBy===actor.id||isOwner,'只有采购人或房主可以撤销入账',403);
  const i=item(r.itemId),bill=data.bills.find(b=>b.id===r.billId&&b.purchaseId===r.id);ensure(bill,'关联账单已不存在，请联系房主核对',409);ensure(bill.settled.length===0,'已有室友完成结算，请先由垫付人撤销收款确认',409);ensure(i.quantity>=r.actualQty,'补货后库存已被使用，无法直接撤销，请先核对实际库存',409);
  i.quantity-=r.actualQty;if(i.reminder===r.reminderAfterCompletion)i.reminder=r.previousReminder;
  data.bills=data.bills.filter(b=>b.id!==r.billId);r.lastUndoAt=now;r.status='claimed';
  for(const key of ['actualQty','amount','participants','billId','purchaseDate','completedBy','completedAt','previousReminder','reminderAfterCompletion'])delete r[key];
  return '撤销了「'+r.itemName+'」采购入账，库存和账单已一并还原';
 }
 throw new PurchasingError(400,'不支持的采购操作');
}
