// D1-compatible adapter for Turso SQL-over-HTTP. No browser or third-party runtime dependency.
import {readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
const failure=code=>new Error('数据库请求失败（'+(/^[A-Z0-9_]{1,80}$/.test(code||'')?code:'REMOTE_DATABASE')+'），请稍后重试');
function encoded(value){
 if(value===null)return {type:'null'};
 if(typeof value==='string')return {type:'text',value};
 if(typeof value==='boolean')return {type:'integer',value:value?'1':'0'};
 if(typeof value==='number'&&Number.isFinite(value))return {type:Number.isInteger(value)?'integer':'float',value:Number.isInteger(value)?String(value):value};
 throw new Error('数据库参数类型无效');
}
function decoded(cell){if(cell.type==='null')return null;if(cell.type==='text')return cell.value;if(cell.type==='integer'){const n=Number(cell.value);if(!Number.isSafeInteger(n))throw failure('INTEGER_RANGE');return n}if(cell.type==='float')return Number(cell.value);if(cell.type==='blob')return Buffer.from(cell.base64,'base64');throw failure('INVALID_VALUE')}
function result(wire){
 if(!wire||!Array.isArray(wire.cols)||!Array.isArray(wire.rows))throw failure('INVALID_RESULT');
 return {results:wire.rows.map(row=>Object.fromEntries(wire.cols.map((col,i)=>[col.name,decoded(row[i])]))),meta:{changes:Number(wire.affected_row_count||0)}};
}
export function openTursoDatabase({url,authToken,fetchImpl=fetch}){
 if(!url||!authToken||/\s/.test(authToken))throw new Error('请完整设置 TURSO_DATABASE_URL 和 TURSO_AUTH_TOKEN');
 const origin=new URL(url.replace(/^(libsql|turso):\/\//,'https://'));
 if(origin.protocol!=='https:'||origin.username||origin.password||!['','/'].includes(origin.pathname)||origin.search||origin.hash)throw new Error('TURSO_DATABASE_URL 应为 Turso 的根地址，不含 /v2/pipeline 或查询参数');
 const endpoint=origin.origin+'/v2/pipeline';
 async function pipeline(request){
  let response;try{response=await fetchImpl(endpoint,{method:'POST',headers:{Authorization:'Bearer '+authToken,'Content-Type':'application/json'},body:JSON.stringify({requests:[{type:'execute',stmt:{sql:'PRAGMA foreign_keys=ON'}},request,{type:'close'}]}),signal:AbortSignal.timeout(10000),redirect:'error'})}catch{throw failure('NETWORK')}
  if(!response.ok)throw failure('HTTP_'+response.status);
  let body;try{body=await response.json()}catch{throw failure('INVALID_JSON')}
  if(!Array.isArray(body.results)||body.results.length!==3)throw failure('INVALID_RESPONSE');
  for(const entry of body.results)if(entry?.type!=='ok')throw failure(entry?.error?.code);
  return body.results[1].response;
 }
 const statement=(sql,args=[],wantRows=true)=>({sql,args:args.map(encoded),want_rows:wantRows});
 async function execute(sql,args=[],wantRows=true){const response=await pipeline({type:'execute',stmt:statement(sql,args,wantRows)});if(response.type!=='execute')throw failure('INVALID_RESPONSE');return result(response.result)}
 async function atomic(queries){
  if(!queries.length)return [];
  const steps=[{stmt:{sql:'BEGIN IMMEDIATE',want_rows:false}}];
  for(const query of queries)steps.push({condition:{type:'ok',step:steps.length-1},stmt:statement(query.sql,query.args||[],true)});
  const commit=steps.length;steps.push({condition:{type:'ok',step:commit-1},stmt:{sql:'COMMIT',want_rows:false}});
  steps.push({condition:{type:'and',conds:[{type:'ok',step:0},{type:'not',cond:{type:'ok',step:commit}}]},stmt:{sql:'ROLLBACK',want_rows:false}});
  const response=await pipeline({type:'batch',batch:{steps}}),wire=response.result;
  if(response.type!=='batch'||!Array.isArray(wire?.step_results)||!Array.isArray(wire?.step_errors)||wire.step_results.length!==steps.length||wire.step_errors.length!==steps.length)throw failure('INVALID_BATCH');
  const error=wire.step_errors.find(Boolean);if(error)throw failure(error.code);
  if(!wire.step_results[commit])throw failure('NOT_COMMITTED');
  return wire.step_results.slice(1,commit).map(result);
 }
 async function initialize(){
  await execute('CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, checksum TEXT NOT NULL)');
  for(const name of readdirSync(new URL('./drizzle/',import.meta.url)).filter(x=>x.endsWith('.sql')).sort()){
   const sql=readFileSync(new URL('./drizzle/'+name,import.meta.url),'utf8'),checksum=createHash('sha256').update(sql).digest('hex');
   const applied=await execute('SELECT checksum FROM _migrations WHERE name=?',[name]);
   if(applied.results[0]){if(applied.results[0].checksum!==checksum)throw failure('MIGRATION_CHECKSUM');continue}
   const queries=sql.replaceAll('--> statement-breakpoint','').split(';').map(s=>s.trim()).filter(Boolean).map(sql=>({sql}));queries.push({sql:'INSERT INTO _migrations VALUES (?,?)',args:[name,checksum]});
   try{await atomic(queries)}catch(error){const other=await execute('SELECT checksum FROM _migrations WHERE name=?',[name]);if(other.results[0]?.checksum!==checksum)throw error}
  }
 }
 const ready=initialize();ready.catch(()=>{});
 class Statement{
  constructor(sql,args=[]){this.sql=sql;this.args=args}
  bind(...args){return new Statement(this.sql,args)}
  async first(){await ready;return (await execute(this.sql,this.args)).results[0]||null}
  async all(){await ready;return {results:(await execute(this.sql,this.args)).results}}
  async run(){await ready;return {meta:(await execute(this.sql,this.args,false)).meta}}
 }
 return {ready,prepare:sql=>new Statement(sql),async batch(queries){await ready;return atomic(queries)},close(){}};
}
