import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import vm from 'node:vm';
import { handleApi } from '../lib/room-service.mjs';

// Run production service and generated migrations against SQLite, with a D1-compatible adapter.
const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');
for(const file of readdirSync(new URL('../drizzle/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())sqlite.exec(readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8'));
class Statement {
 constructor(sql,args=[]){this.sql=sql;this.args=args}
 bind(...args){return new Statement(this.sql,args)}
 async first(){return sqlite.prepare(this.sql).get(...this.args)||null}
 async all(){return {results:sqlite.prepare(this.sql).all(...this.args)}}
 run(){return {meta:{changes:Number(sqlite.prepare(this.sql).run(...this.args).changes)}}}
}
let conflictOnce=false;
const db={prepare:sql=>new Statement(sql),async batch(statements){
 if(conflictOnce&&statements[0].sql.startsWith('UPDATE rooms SET data=')){conflictOnce=false;sqlite.prepare('UPDATE rooms SET revision=revision+1 WHERE id=?').run(statements[0].args[3])}
 sqlite.exec('BEGIN');try{const result=statements.map(s=>s.run());sqlite.exec('COMMIT');return result}catch(e){sqlite.exec('ROLLBACK');throw e}
}};
const alice={userId:'account-alice',email:'alice@example.test',displayName:'Alice'},bob={userId:'account-bob',email:'bob@example.test',displayName:'Bob'},charlie={userId:'account-charlie',email:'charlie@example.test',displayName:'Charlie'};
async function call(user,path,payload,extraHeaders={}){const response=await handleApi(new Request('https://room.test/api'+path,{method:payload===undefined?'GET':'POST',headers:{'X-Requested-With':'Tongzhu','Content-Type':'application/json',...extraHeaders},...(payload===undefined?{}:{body:JSON.stringify(payload)})}),db,user);return {status:response.status,data:await response.json()}}
const ok=r=>{assert.ok(r.status>=200&&r.status<300,JSON.stringify(r));return r.data};
let count=0;const check=(label)=>{count++;console.log('PASS',label)};
assert.equal((await call(null,'/rooms',{name:'x',nickname:'x'})).status,401);
assert.deepEqual((await call(null,'/bootstrap')).data,{user:null,rooms:[]});check('anonymous writes rejected, public bootstrap stays anonymous');
assert.equal((await call(alice,'/rooms',{name:'x',nickname:'x'},{Origin:'https://evil.example'})).status,403);check('cross-origin mutations rejected');
let room=ok(await call(alice,'/rooms',{name:'测试合租屋',nickname:'小沐'}));const rid=room.room.id,aliceId=room.state.current,code=room.room.inviteCode;
assert.equal(room.members.length,1);assert.equal(room.state.bills.length,0);assert.equal(room.room.role,'owner');assert.ok(code);check('create persistent empty room and owner identity');
assert.equal((await call(bob,'/rooms/'+rid)).status,404);check('room ID alone cannot reveal private room records');
let b=ok(await call(bob,'/rooms/join',{code,nickname:'阿哲'}));const bobId=b.state.current;assert.equal(b.members.length,2);assert.equal(b.room.inviteCode,undefined);assert.equal(b.room.role,'member');
assert.equal(ok(await call(bob,'/rooms/join',{code,nickname:'重复加入'})).members.length,2);check('invite joins once and hides owner invitation controls from members');
const action=(user,operation,payload,operationId=crypto.randomUUID())=>call(user,'/rooms/'+rid+'/actions',{operation,payload,operationId});
const billOp=crypto.randomUUID();room=ok(await action(alice,'add-bill',{title:'水电费',amount:1001,participants:[aliceId,bobId],date:'2026-10-16',category:'水电',payer:bobId},billOp));const bill=room.state.bills[0];assert.equal(bill.payer,aliceId);
assert.equal(ok(await action(alice,'add-bill',{title:'水电费',amount:1001,participants:[aliceId,bobId],date:'2026-10-16'},billOp)).state.bills.length,1);
assert.equal(ok(await call(bob,'/rooms/'+rid)).state.bills[0].amount,1001);check('shared bill visible cross-user, payer derived from identity, retry does not duplicate');
assert.equal((await action(bob,'settle',{id:bill.id,member:bobId,settled:true})).status,403);
room=ok(await action(alice,'settle',{id:bill.id,member:bobId,settled:true}));assert.deepEqual(room.state.bills[0].settled,[bobId]);
assert.deepEqual(ok(await call(bob,'/rooms/'+rid)).state.bills[0].settled,[bobId]);check('only actual payer can confirm payment; other member sees updated status');
assert.equal((await action(bob,'delete-bill',{id:bill.id})).status,403);check('members cannot delete someone else’s bill');
assert.equal((await action(alice,'add-bill',{title:'非法用户',amount:100,participants:['outsider'],date:'2026-10-16'})).status,400);
assert.equal((await action(alice,'add-bill',{title:'重复用户',amount:100,participants:[aliceId,aliceId],date:'2026-10-16'})).status,400);
assert.equal((await action(alice,'add-bill',{title:'非法金额',amount:0.5,participants:[aliceId],date:'2026-10-16'})).status,400);check('server validates money and actual room participants');
await Promise.all([action(alice,'add-bill',{title:'并发 A',amount:101,participants:[aliceId,bobId],date:'2026-10-16'}).then(ok),action(bob,'add-bill',{title:'并发 B',amount:202,participants:[aliceId,bobId],date:'2026-10-16'}).then(ok)]);
room=ok(await call(alice,'/rooms/'+rid));assert.equal(room.state.bills.length,3);check('two concurrent writers retain both bills');
conflictOnce=true;room=ok(await action(alice,'add-rule',{title:'冲突后保留',content:'共同规则'}));assert.equal(room.state.rules.length,1);check('compare-and-swap retries after an injected competing revision');
const ruleId=room.state.rules[0].id;room=ok(await action(bob,'confirm-rule',{id:ruleId,member:aliceId}));assert.deepEqual(room.state.rules[0].approvals,[bobId]);
room=ok(await action(bob,'confirm-rule',{id:ruleId}));assert.equal(room.state.rules[0].approvals.length,1);room=ok(await action(alice,'confirm-rule',{id:ruleId}));assert.equal(room.state.rules[0].approvals.length,2);check('agreement confirmation uses actor identity and never duplicates an approval');
room=ok(await action(alice,'add-item',{name:'垃圾袋',unit:'卷',quantity:2,threshold:1,keeper:aliceId,reminder:''}));const itemId=room.state.items[0].id;
await Promise.all([action(alice,'consume',{id:itemId}).then(ok),action(bob,'consume',{id:itemId}).then(ok)]);
room=ok(await call(alice,'/rooms/'+rid));assert.equal(room.state.items[0].quantity,0);assert.equal((await action(bob,'consume',{id:itemId})).status,409);
const stockId=crypto.randomUUID();room=ok(await action(bob,'restock',{id:itemId,quantity:5,reminder:'2026-11-01'},stockId));room=ok(await action(bob,'restock',{id:itemId,quantity:5,reminder:'2026-11-01'},stockId));assert.equal(room.state.items[0].quantity,5);check('concurrent inventory updates are conserved, nonnegative and idempotent');
room=ok(await action(alice,'add-task',{name:'厨房',day:6,owner:bobId}));const tid=room.state.tasks[0].id;room=ok(await action(bob,'toggle-task',{id:tid,done:true}));assert.equal(Object.values(room.state.done).filter(Boolean).length,1);check('different member can complete shared weekly task');
assert.ok(room.activity.some(a=>a.actor==='阿哲'));assert.ok(room.activity.some(a=>a.summary.includes('垃圾袋')));check('activity identifies actual actor and operation');
assert.equal((await call(bob,'/rooms/'+rid+'/rotate-invite',{})).status,403);room=ok(await call(alice,'/rooms/'+rid+'/rotate-invite',{}));assert.notEqual(room.room.inviteCode,code);
assert.equal((await call(charlie,'/rooms/join',{code,nickname:'可可'})).status,404);let c=ok(await call(charlie,'/rooms/join',{code:room.room.inviteCode,nickname:'可可'}));assert.equal(c.members.length,3);assert.equal(c.state.bills.length,3);check('invite rotation invalidates old code, preserves members and existing records');
const another=ok(await call(charlie,'/rooms',{name:'隔离房间',nickname:'可可'}));assert.equal((await call(alice,'/rooms/'+another.room.id)).status,404);assert.equal(ok(await call(charlie,'/rooms/'+another.room.id)).state.bills.length,0);check('records remain isolated between rooms');
assert.equal(ok(await call(bob,'/bootstrap')).rooms.length,1);assert.equal(ok(await call(charlie,'/bootstrap')).rooms.length,2);check('room list contains only joined rooms');
assert.equal((await call(null,'/rooms/'+rid,undefined,{'oai-authenticated-user-id':alice.userId})).status,401);check('raw client headers never substitute for trusted identity argument');
console.log(`PASS: ${count} room collaboration scenarios`);

// Exercise the actual inline UI + shared.js in two independent browser contexts.
// No browser engine is installed; these tests cover DOM event wiring and API state, not visual layout.
const inline=readFileSync(new URL('../src/interface.html',import.meta.url),'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
const sharedScript=readFileSync(new URL('../public/shared.js',import.meta.url),'utf8');
async function client(user,preferred,storage=new Map()){
 if(preferred)storage.set('tongzhu.active-room.v2',preferred);
 const listeners={},elements=new Map();let networkFail=false;
 const element=key=>{if(!elements.has(key))elements.set(key,{innerHTML:'',outerHTML:'',textContent:'',value:'',hidden:false,disabled:false,open:false,listeners:{},addEventListener(event,fn){this.listeners[event]=fn},showModal(){this.open=true},close(){const was=this.open;this.open=false;if(was)this.listeners.close?.()},focus(){},select(){}});return elements.get(key)};
 const location=new URL('https://room.test/');
 const context={console,Date,Intl,crypto,URL,AbortSignal,Map,Set,location,navigator:{clipboard:{writeText:async()=>{}}},history:{replaceState(){}},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},setTimeout:()=>1,clearTimeout(){},setInterval:()=>1,confirm:()=>true,document:{hidden:false,getElementById:element,querySelector:()=>null,querySelectorAll:()=>[],addEventListener(event,fn,capture=false){(listeners[event]||=[]).push({fn,capture})}},window:{scrollTo(){},addEventListener(){}},FormData:class{constructor(f){this.data=f.data}get(k){return this.data[k]??null}getAll(k){return this.data[k]??[]}},fetch:async(path,options={})=>{if(networkFail)throw new Error('模拟网络中断');return handleApi(new Request(new URL(path,location),options),db,user)}};
 vm.createContext(context);vm.runInContext(inline,context);await vm.runInContext(sharedScript,context);
 async function dispatch(type,target){let stopped=false;const event={target,preventDefault(){},stopImmediatePropagation(){stopped=true}};for(const l of [...(listeners[type]||[])].sort((a,b)=>Number(b.capture)-Number(a.capture))){if(stopped)break;await l.fn(event)}}
 return {context,storage,elements,api:context.window.SharedRoom,async click(action,data={}){const b={dataset:{action,...data},disabled:false};await dispatch('click',{closest:()=>b})},async submit(kind,data){const error={textContent:''},submit={disabled:false};const f={dataset:{kind},data,matches:()=>true,querySelector:s=>s==='.form-error'?error:submit};await dispatch('submit',f);return error.textContent},failNetwork:value=>networkFail=value};
}
const browserRoom=ok(await call(alice,'/rooms',{name:'浏览器联调屋',nickname:'小沐'}));
const ca=await client(alice,browserRoom.room.id),cb=await client(bob,'demo');
assert.equal(ca.api.getShared().members.length,1);assert.equal(cb.api.getShared(),null);
assert.equal(await cb.submit('room-join',{code:browserRoom.room.inviteCode,nickname:'阿哲'}),'');
await ca.api.refreshShared(true);assert.equal(ca.api.getShared().members.length,2);assert.equal(cb.api.getShared().members.length,2);check('two independent client contexts create/join and synchronize roster');
const ids=ca.api.getShared().members.map(m=>m.id);
assert.equal(await ca.submit('bill',{title:'客户端账单',amount:'30.00',participants:ids,category:'水电',date:'2026-10-16'}),'');
await cb.api.refreshShared(true);assert.equal(cb.api.getShared().state.bills.length,1);assert.equal(cb.api.getShared().state.bills[0].amount,3000);assert.equal(JSON.parse(ca.storage.get('tongzhu.baseline.v1')).bills.length,3);check('real form event saves once to server and leaves demo records untouched');
await ca.submit('rule',{title:'客户端公约',content:'23 点后保持安静'});await cb.api.refreshShared(true);const clientRule=cb.api.getShared().state.rules[0];await cb.click('confirm-rule',{id:clientRule.id});await ca.api.refreshShared(true);assert.deepEqual(ca.api.getShared().state.rules[0].approvals,[cb.api.getShared().state.current]);check('confirmation click records the correct client identity');
await cb.submit('task',{name:'联调厨房清洁',day:'6',owner:ids[1]});await ca.api.refreshShared(true);await ca.click('toggle-task',{id:ca.api.getShared().state.tasks[0].id});await cb.api.refreshShared(true);assert.equal(Object.values(cb.api.getShared().state.done).filter(Boolean).length,1);check('shared task form and completion synchronize between UI contexts');
await ca.submit('item',{name:'联调纸巾',unit:'卷',quantity:'2',threshold:'1',keeper:ids[0],reminder:''});await cb.api.refreshShared(true);const clientItem=cb.api.getShared().state.items[0].id;await cb.click('consume',{id:clientItem});await ca.api.refreshShared(true);assert.equal(ca.api.getShared().state.items[0].quantity,1);check('shared item form and stock button synchronize between UI contexts');
cb.failNetwork(true);await cb.click('consume',{id:clientItem});assert.equal(cb.api.getShared().state.items[0].quantity,1);cb.failNetwork(false);await cb.api.refreshShared(true);check('failed network write does not falsely change local shared state');
const reloaded=await client(alice,null,ca.storage);assert.equal(reloaded.api.getShared().room.id,browserRoom.room.id);assert.equal(reloaded.api.getShared().state.bills.length,1);check('refresh restores room from server instead of overwriting cloud state');
await ca.click('demo-mode');assert.equal(ca.api.getShared(),null);assert.equal(ca.storage.get('tongzhu.active-room.v2'),'demo');assert.equal(ok(await call(alice,'/rooms/'+browserRoom.room.id)).state.bills.length,1);check('returning to demo preserves shared room records');
ok(await call(charlie,'/rooms/join',{code:browserRoom.room.inviteCode,nickname:'<b>可可</b>'}));await reloaded.api.refreshShared(true);assert.ok(reloaded.elements.get('content').innerHTML.includes('&lt;b&gt;可可&lt;/b&gt;'));assert.ok(!reloaded.elements.get('content').innerHTML.includes('<b>可可</b>'));check('shared member nicknames are escaped in HTML');
console.log(`PASS: ${count} total backend and client integration scenarios`);
