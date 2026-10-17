import {createServer} from 'node:http';
import {readFileSync,existsSync} from 'node:fs';
import {resolve,extname,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {dispatchApi} from './lib/account-auth.mjs';
import {openDatabase} from './sqlite.mjs';
import {openTursoDatabase} from './turso.mjs';

const root=fileURLToPath(new URL('.',import.meta.url)),publicRoot=resolve(root,'public');
const html=readFileSync(resolve(root,'src/interface.html'));
const types={'.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon','.css':'text/css; charset=utf-8'};
export function makeApp({database,dbPath=process.env.DB_PATH||resolve(root,'data/tongzhu.sqlite'),publicOrigin=process.env.PUBLIC_ORIGIN||process.env.RENDER_EXTERNAL_URL||''}={}){
 if(publicOrigin){const u=new URL(publicOrigin);if(u.origin!==publicOrigin||u.username||u.password||!['http:','https:'].includes(u.protocol))throw new Error('PUBLIC_ORIGIN 必须是站点根地址，不带结尾斜杠，例如 https://你的域名')}
 const remote=process.env.TURSO_DATABASE_URL||process.env.TURSO_AUTH_TOKEN;
 if(!database&&!remote&&process.env.RENDER==='true')throw new Error('Render 免费部署需要 TURSO_DATABASE_URL 和 TURSO_AUTH_TOKEN；不能用临时本地磁盘保存账号与房间');
 const db=database||(remote?openTursoDatabase({url:process.env.TURSO_DATABASE_URL,authToken:process.env.TURSO_AUTH_TOKEN}):openDatabase(dbPath));
 async function handle(request,remoteAddress='unknown'){
  const incoming=new URL(request.url),path=incoming.pathname;
  if(path.startsWith('/api/')){
   try{await db.ready}catch{return Response.json({error:'数据库连接或初始化失败，请检查服务端的 Turso 配置'},{status:503})}
   // Validate write origins against configured origin, never a client-controlled Host header.
   if(!publicOrigin&&request.method!=='GET')return Response.json({error:'请先设置 PUBLIC_ORIGIN 为公开 HTTPS 地址后再使用账号和共享功能'},{status:503});
   const headers=new Headers(request.headers);headers.delete('cf-connecting-ip');headers.set('CF-Connecting-IP',remoteAddress);
   const url=new URL(path+incoming.search,publicOrigin||incoming.origin);
   const body=['GET','HEAD'].includes(request.method)?undefined:await request.arrayBuffer();
   return dispatchApi(new Request(url,{method:request.method,headers,...(body===undefined?{}:{body})}),db,null);
  }
  if(request.method!=='GET'&&request.method!=='HEAD')return new Response('Method Not Allowed',{status:405,headers:{Allow:'GET, HEAD'}});
  const headers={'X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin','Cache-Control':'no-cache'};
  if(path==='/'||path==='/index.html')return new Response(request.method==='HEAD'?null:html,{headers:{...headers,'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}});
  // Legacy platform sign-in remains a link back to the original platform, not trusted identity headers.
  if(path==='/signin-with-chatgpt')return Response.redirect('https://roommate-life-hub.vast-rose-3900.chatgpt.site/?legacy=1',302);
  let decoded;try{decoded=decodeURIComponent(path)}catch{return new Response('Bad Request',{status:400})}
  const target=resolve(publicRoot,'.'+decoded),type=types[extname(target)];
  if(!target.startsWith(publicRoot+sep)||!type||!existsSync(target))return new Response('Not Found',{status:404});
  return new Response(request.method==='HEAD'?null:readFileSync(target),{headers:{...headers,'Content-Type':type}});
 }
 const server=createServer(async(req,res)=>{
  try{
   const headers=new Headers();for(const [name,value] of Object.entries(req.headers))if(value!==undefined)headers.set(name,Array.isArray(value)?value.join('; '):value);
   const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>32768){res.writeHead(413,{'Content-Type':'application/json'});res.end('{"error":"提交内容过长"}');return}chunks.push(chunk)}
   const host='http://127.0.0.1',request=new Request(new URL(req.url,host),{method:req.method,headers,...(['GET','HEAD'].includes(req.method)?{}:{body:Buffer.concat(chunks)})});
   const response=await handle(request,req.socket.remoteAddress||'unknown'),out={};
   response.headers.forEach((value,name)=>{if(name!=='set-cookie')out[name]=value});const cookies=response.headers.getSetCookie();if(cookies.length)out['set-cookie']=cookies;
   res.writeHead(response.status,out);res.end(Buffer.from(await response.arrayBuffer()));
  }catch(error){console.error('Request failed:',error.name);if(!res.headersSent)res.writeHead(500,{'Content-Type':'application/json'});res.end('{"error":"服务暂时不可用，请稍后重试"}')}
 });
 server.requestTimeout=20000;server.headersTimeout=15000;
 return {server,handle,db,async close(){if(server.listening)await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()));db.close()}};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const port=Number(process.env.PORT||8080);if(!Number.isInteger(port)||port<1||port>65535)throw new Error('PORT 无效');
 if(process.env.NODE_ENV==='production'&&process.env.PUBLIC_ORIGIN&&!process.env.PUBLIC_ORIGIN.startsWith('https://'))throw new Error('生产环境需要 HTTPS 公开地址');
 const app=makeApp();app.server.listen(port,'0.0.0.0',()=>console.log('Tongzhu listening on port '+port+((process.env.PUBLIC_ORIGIN||process.env.RENDER_EXTERNAL_URL)?'':'；请设置 PUBLIC_ORIGIN 以启用账号与共享')));
 const shutdown=()=>{app.close().then(()=>process.exit(0)).catch(()=>process.exit(1))};process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
}
