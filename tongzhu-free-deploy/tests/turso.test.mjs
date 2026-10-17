import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {openTursoDatabase} from '../turso.mjs';
import {makeApp} from '../server.mjs';
import {purchaseDraftFacts} from '../public/purchasing-core.mjs';

// Independent in-process Hrana endpoint: executes actual SQLite statements and protocol conditions.
const sqlite=new DatabaseSync(':memory:');let calls=0,networkDown=false,badAuth=false;
const enc=v=>v===null?{type:'null'}:typeof v==='number'?{type:Number.isInteger(v)?'integer':'float',value:Number.isInteger(v)?String(v):v}:{type:'text',value:v};
const dec=c=>c.type==='null'?null:c.type==='integer'||c.type==='float'?Number(c.value):c.value;
function query(stmt){const s=sqlite.prepare(stmt.sql),cols=s.columns(),args=(stmt.args||[]).map(dec);let rows=[];
 if(cols.length)rows=s.all(...args);else s.run(...args);
 const changed=/^\s*(INSERT|UPDATE|DELETE|REPLACE)/i.test(stmt.sql)?sqlite.prepare('SELECT changes() n').get().n:0;
 return {cols:cols.map(c=>({name:c.name})),rows:stmt.want_rows===false?[]:rows.map(row=>cols.map(c=>enc(row[c.name]))),affected_row_count:changed};
}
function condition(c,results){if(c.type==='ok')return results[c.step]!==null;if(c.type==='not')return !condition(c.cond,results);if(c.type==='and')return c.conds.every(x=>condition(x,results));throw new Error('unsupported condition')}
async function fakeFetch(url,options){
 calls++;if(networkDown)throw new Error('network down');assert.equal(url,'https://example.turso.io/v2/pipeline');assert.equal(options.headers.Authorization,'Bearer test-private-token');assert.equal(options.redirect,'error');
 if(badAuth)return new Response('secret server content test-private-token',{status:401});
 const body=JSON.parse(options.body),results=[];
 for(const r of body.requests){
  if(r.type==='close'){try{sqlite.exec('ROLLBACK')}catch{}results.push({type:'ok',response:{type:'close'}});continue}
  if(r.type==='execute'){try{results.push({type:'ok',response:{type:'execute',result:query(r.stmt)}})}catch(e){results.push({type:'error',error:{message:e.message,code:'SQLITE_ERROR'}})}continue}
  assert.equal(r.type,'batch');const step_results=[],step_errors=[];
  for(const step of r.batch.steps){if(step.condition&&!condition(step.condition,step_results)){step_results.push(null);step_errors.push(null);continue}
   try{step_results.push(query(step.stmt));step_errors.push(null)}catch(e){step_results.push(null);step_errors.push({code:/UNIQUE/.test(e.message)?'SQLITE_CONSTRAINT_UNIQUE':'SQLITE_ERROR',message:e.message})}}
  results.push({type:'ok',response:{type:'batch',result:{step_results,step_errors}}});
 }
 return Response.json({baton:null,base_url:null,results});
}
const options={url:'libsql://example.turso.io',authToken:'test-private-token',fetchImpl:fakeFetch};
let db=openTursoDatabase(options),app;let count=0;const check=s=>{count++;console.log('PASS',s)};
try{
 await db.ready;assert.equal((await db.prepare('SELECT COUNT(*) n FROM _migrations').first()).n,2);assert.equal((await db.prepare('SELECT COUNT(*) n FROM user_accounts').first()).n,0);check('remote migrations execute against SQLite over typed HTTP protocol');
 await db.batch([db.prepare('CREATE TABLE adapter_test (id TEXT PRIMARY KEY, value TEXT)'),db.prepare('INSERT INTO adapter_test VALUES (?,?)').bind('一','引号\'与<script>')]);assert.equal((await db.prepare('SELECT value FROM adapter_test WHERE id=?').bind('一').first()).value,"引号'与<script>");check('bound UTF-8 text is preserved without SQL interpolation');
 await assert.rejects(()=>db.batch([db.prepare('UPDATE adapter_test SET value=? WHERE id=?').bind('partial','一'),db.prepare('INSERT INTO missing_table VALUES (1)')]),/SQLITE_ERROR/);assert.equal((await db.prepare('SELECT value FROM adapter_test').first()).value,"引号'与<script>");check('failed transactional HTTP batch rolls back earlier successful mutations');
 await db.batch([db.prepare('CREATE TABLE parents (id TEXT PRIMARY KEY)'),db.prepare('CREATE TABLE children (parent TEXT REFERENCES parents(id))')]);await assert.rejects(()=>db.prepare('INSERT INTO children VALUES (?)').bind('missing').run());check('foreign-key enforcement survives each new HTTP connection');
 badAuth=true;await assert.rejects(()=>db.prepare('SELECT 1').first(),error=>error.message.includes('HTTP_401')&&!error.message.includes('test-private-token'));badAuth=false;check('provider authentication error never exposes token or raw response body');
 networkDown=true;const previous=calls;await assert.rejects(()=>db.prepare('INSERT INTO adapter_test VALUES (?,?)').bind('network','bad').run(),/NETWORK/);assert.equal(calls,previous+1);networkDown=false;assert.equal((await db.prepare('SELECT COUNT(*) n FROM adapter_test').first()).n,1);check('failed network write is not automatically retried');
 class Jar{values=new Map();header(){return [...this.values].map(([k,v])=>k+'='+v).join('; ')}accept(r){for(const c of r.headers.getSetCookie()){const p=c.split(';')[0],at=p.indexOf('=');this.values.set(p.slice(0,at),p.slice(at+1))}}}
 const origin='https://tongzhu.onrender.com';app=makeApp({database:db,publicOrigin:origin});
 async function request(jar,path,payload){const r=await app.handle(new Request(origin+'/api'+path,{method:payload===undefined?'GET':'POST',headers:{Origin:origin,'X-Requested-With':'Tongzhu','Content-Type':'application/json',Cookie:jar.header()},...(payload===undefined?{}:{body:JSON.stringify(payload)})}));jar.accept(r);const data=await r.json();assert.ok(r.ok,JSON.stringify(data));return data}
 const a=new Jar(),b=new Jar(),pass='TursoTest2026!';await request(a,'/auth/register',{username:'turso_a',password:pass,nickname:'小沐'});await request(b,'/auth/register',{username:'turso_b',password:pass,nickname:'阿哲'});
 let room=await request(a,'/rooms',{name:'免费部署测试房',nickname:'小沐'});const rid=room.room.id,aid=room.state.current;await request(b,'/rooms/join',{code:room.room.inviteCode,nickname:'阿哲'});check('two real account sessions create and join a shared room through remote adapter');
 const action=(jar,operation,payload,operationId=crypto.randomUUID())=>request(jar,'/rooms/'+rid+'/actions',{operation,operationId,payload});room=await action(a,'add-item',{name:'纸巾',quantity:1,threshold:2,unit:'卷',keeper:aid,reminder:''});
 const itemId=room.state.items[0].id,token=crypto.randomUUID(),purchase={itemId,quantity:2,amount:3001,participants:room.members.map(m=>m.id),date:'2026-10-16',entryDraftId:token,previewActorId:aid,facts:purchaseDraftFacts(room.state,itemId,room.members)};
 room=await action(a,'record-purchase',purchase,token);assert.equal(room.state.items[0].quantity,3);assert.equal(room.state.bills[0].amount,3001);assert.equal(room.state.shopping[0].status,'completed');assert.equal((await request(b,'/rooms/'+rid)).state.items[0].quantity,3);check('remote confirmation atomically updates stock, procurement and shared AA bill');
 await action(a,'record-purchase',purchase,token);assert.equal((await request(b,'/rooms/'+rid)).state.bills.length,1);check('remote confirmation retry uses persisted audit token and cannot double-charge');
 await Promise.all([action(a,'add-bill',{title:'并发A',amount:100,category:'日用',participants:room.members.map(m=>m.id),date:'2026-10-16'}),action(b,'add-bill',{title:'并发B',amount:200,category:'日用',participants:room.members.map(m=>m.id),date:'2026-10-16'})]);assert.equal((await request(a,'/rooms/'+rid)).state.bills.length,3);check('competing shared writes retry CAS and both survive HTTP database transport');
 await app.close();db=openTursoDatabase(options);await db.ready;app=makeApp({database:db,publicOrigin:origin});room=await request(a,'/rooms/'+rid);assert.equal(room.state.items[0].quantity,3);assert.equal(room.state.bills.length,3);assert.equal(room.state.shopping[0].entryDraftId,token);check('new application instance recovers room data and sessions from external database');
 const oldRender=process.env.RENDER,oldURL=process.env.RENDER_EXTERNAL_URL;process.env.RENDER='true';process.env.RENDER_EXTERNAL_URL=origin;
 try{assert.throws(()=>makeApp(),/免费部署需要/);const auto=makeApp({database:db});const r=await auto.handle(new Request(origin+'/api/rooms',{method:'POST',headers:{Origin:origin,'X-Requested-With':'Tongzhu','Content-Type':'application/json',Cookie:a.header()},body:JSON.stringify({name:'自动域名',nickname:'小沐'})}));assert.equal(r.status,201);await auto.close()}finally{if(oldRender===undefined)delete process.env.RENDER;else process.env.RENDER=oldRender;if(oldURL===undefined)delete process.env.RENDER_EXTERNAL_URL;else process.env.RENDER_EXTERNAL_URL=oldURL}check('Render requires durable database and automatically uses its real HTTPS origin');
 assert.throws(()=>openTursoDatabase({...options,url:'http://example.turso.io'}));assert.throws(()=>openTursoDatabase({...options,authToken:''}));check('invalid or incomplete remote database configuration is rejected');
 console.log(`PASS: ${count} remote database and free-hosting integration scenarios`);
}finally{if(app)await app.close();sqlite.close()}
