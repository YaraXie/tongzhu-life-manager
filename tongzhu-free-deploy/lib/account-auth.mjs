import bcrypt from '../vendor/bcryptjs/index.js';
import { handleApi } from './room-service.mjs';

export const SESSION_COOKIE='__Host-tongzhu_session';
const NATIVE_COOKIE='__Host-tongzhu_native_only';
const SESSION_SECONDS=7*24*60*60;
const COST=10;
const DUMMY_HASH='$2b$10$HJq03xnSaoMBedQ0a/GUp.qq42nc8cxkA.MdpVT/YgLM/g1XlpCfa';
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
class AuthError extends Error{constructor(status,message){super(message);this.status=status}}
const ensure=(value,message,status=400)=>{if(!value)throw new AuthError(status,message)};
const seconds=()=>Math.floor(Date.now()/1000);
const sha=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))).map(b=>b.toString(16).padStart(2,'0')).join('');
const randomToken=()=>Array.from(crypto.getRandomValues(new Uint8Array(32))).map(b=>b.toString(16).padStart(2,'0')).join('');
function cookieValue(request,name){const cookie=request.headers.get('Cookie')||'';const part=cookie.split(';').map(p=>p.trim()).find(p=>p.startsWith(name+'='));return part?part.slice(name.length+1):null}
const cookie=(name,value,maxAge)=>`${name}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
const nativeOnly=request=>cookieValue(request,NATIVE_COOKIE)==='1';
function sessionToken(request){const token=cookieValue(request,SESSION_COOKIE);return token&&/^[a-f0-9]{64}$/.test(token)?token:null}
const identity=row=>({userId:row.user_key,displayName:row.display_name,fullName:row.display_name,email:'',provider:'password',username:row.username});
const publicAccount=row=>({name:row.display_name,username:row.username,provider:'password'});
function username(value){ensure(typeof value==='string','请填写账号');const normalized=value.trim().toLowerCase();ensure(/^[a-z0-9_]{4,24}$/.test(normalized),'账号需为 4–24 位字母、数字或下划线');return normalized}
function password(value){ensure(typeof value==='string'&&value.length>=8&&!value.includes('\0')&&new TextEncoder().encode(value).length<=72,'密码至少 8 个字符，UTF-8 长度不超过 72 字节');return value}
async function readBody(request){ensure(request.method==='POST','请求方式无效',405);ensure(request.headers.get('X-Requested-With')==='Tongzhu','请求来源无效',403);const origin=request.headers.get('Origin');ensure(!origin||origin===new URL(request.url).origin,'不允许跨站修改',403);const raw=await request.text();ensure(raw.length<=8000,'提交内容过长');let value;try{value=JSON.parse(raw)}catch{throw new AuthError(400,'提交格式无效')}ensure(value&&typeof value==='object'&&!Array.isArray(value),'提交格式无效');return value}
async function reserveAttempt(db,request,accountName,kind){
 const now=seconds(),bucket=Math.floor(now/900),ip=request.headers.get('CF-Connecting-IP');
 const buckets=[{key:await sha(kind+':account:'+accountName+':'+bucket),limit:kind==='login'?10:5}];
 if(ip)buckets.push({key:await sha(kind+':ip:'+ip+':'+bucket),limit:kind==='login'?80:20});
 for(const bucket of buckets){const row=await db.prepare('INSERT INTO auth_limits (key,hits,expires_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET hits=hits+1 RETURNING hits').bind(bucket.key,now+1800).first();ensure(row.hits<=bucket.limit,'尝试过于频繁，请 15 分钟后再试',429)}
 await db.prepare('DELETE FROM auth_limits WHERE expires_at < ?').bind(now).run();
}
async function nativeAccount(request,db){const token=sessionToken(request);if(!token)return null;return db.prepare('SELECT a.* FROM account_sessions s JOIN user_accounts a ON a.id=s.account_id WHERE s.token_hash=? AND s.expires_at>?').bind(await sha(token),seconds()).first()}
export async function resolveIdentity(request,db,platformUser){
 if(!db)return null;const account=await nativeAccount(request,db);if(account)return identity(account);
 return !nativeOnly(request)&&platformUser?{...platformUser,provider:'chatgpt'}:null;
}
async function newSession(db,request,account,response){
 const token=randomToken(),now=seconds(),old=sessionToken(request);
 const queries=[db.prepare('INSERT INTO account_sessions (token_hash,account_id,expires_at,created_at) VALUES (?,?,?,?)').bind(await sha(token),account.id,now+SESSION_SECONDS,new Date().toISOString()),db.prepare('DELETE FROM account_sessions WHERE expires_at<=?').bind(now)];
 if(old)queries.push(db.prepare('DELETE FROM account_sessions WHERE token_hash=?').bind(await sha(old)));
 await db.batch(queries);response.headers.append('Set-Cookie',cookie(SESSION_COOKIE,token,SESSION_SECONDS));response.headers.append('Set-Cookie',cookie(NATIVE_COOKIE,'1',30*24*60*60));return response;
}
async function register(db,request,platformUser,payload){
 const name=username(payload.username),pass=password(payload.password);ensure(typeof payload.nickname==='string'&&payload.nickname.trim().length>0&&payload.nickname.trim().length<=20,'昵称需为 1–20 个字符');
 await reserveAttempt(db,request,name,'register');ensure(!await nativeAccount(request,db),'请先退出当前账号，再注册其他账号',409);
 ensure(!await db.prepare('SELECT id FROM user_accounts WHERE username=?').bind(name).first(),'该账号已被使用，请更换账号或直接登录',409);
 const legacy=!nativeOnly(request)?platformUser:null;
 if(legacy)ensure(!await db.prepare('SELECT id FROM user_accounts WHERE platform_user_id=?').bind(legacy.userId).first(),'当前身份已经设置过本站账号，请直接登录',409);
 const account={id:crypto.randomUUID(),username:name,display_name:payload.nickname.trim(),user_key:legacy?.userId||'local:'+crypto.randomUUID()};
 const passwordHash=await bcrypt.hash(pass,COST);
 try{await db.prepare('INSERT INTO user_accounts (id,user_key,username,password_hash,display_name,platform_user_id,created_at) VALUES (?,?,?,?,?,?,?)').bind(account.id,account.user_key,name,passwordHash,account.display_name,legacy?.userId||null,new Date().toISOString()).run()}catch(error){if(/unique|constraint/i.test(String(error)))throw new AuthError(409,'账号已存在或身份已关联，请直接登录');throw error}
 return newSession(db,request,account,json({user:publicAccount(account),linkedExistingRooms:!!legacy},201));
}
async function login(db,request,payload){
 const name=username(payload.username),pass=password(payload.password);await reserveAttempt(db,request,name,'login');
 const account=await db.prepare('SELECT * FROM user_accounts WHERE username=?').bind(name).first();
 const valid=await bcrypt.compare(pass,account?.password_hash||DUMMY_HASH);ensure(account&&valid,'账号或密码不正确',401);
 return newSession(db,request,account,json({user:publicAccount(account)}));
}
async function logout(db,request){const token=sessionToken(request);if(token)await db.prepare('DELETE FROM account_sessions WHERE token_hash=?').bind(await sha(token)).run();const response=json({ok:true});response.headers.append('Set-Cookie',cookie(SESSION_COOKIE,'',0));response.headers.append('Set-Cookie',cookie(NATIVE_COOKIE,'1',30*24*60*60));return response}
export async function handleAuth(request,db,platformUser=null){const path=new URL(request.url).pathname;if(!path.startsWith('/api/auth/'))return null;try{ensure(db,'登录服务正在准备，请稍后重试',503);const payload=await readBody(request);if(path==='/api/auth/register')return await register(db,request,platformUser,payload);if(path==='/api/auth/login')return await login(db,request,payload);if(path==='/api/auth/logout')return await logout(db,request);throw new AuthError(404,'接口不存在')}catch(error){if(error instanceof AuthError)return json({error:error.message},error.status);console.error('Account authentication failed');return json({error:'登录服务暂时不可用，请稍后重试'},500)}}
/** @param {import('../app/chatgpt-auth').ChatGPTUser|null} [platformUser] */
export async function dispatchApi(request,db,platformUser=null){const authResponse=await handleAuth(request,db,platformUser);if(authResponse)return authResponse;try{return await handleApi(request,db,await resolveIdentity(request,db,platformUser))}catch{console.error('Account session lookup failed');return json({error:'登录状态暂时无法读取，请稍后重试'},503)}}
