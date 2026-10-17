import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,readdirSync,readFileSync} from 'node:fs';
import {dirname} from 'node:path';
import {createHash} from 'node:crypto';

export function openDatabase(path){
 if(path!==':memory:')mkdirSync(dirname(path),{recursive:true,mode:0o700});
 const sqlite=new DatabaseSync(path);
 sqlite.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
 sqlite.exec('CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, checksum TEXT NOT NULL)');
 for(const name of readdirSync(new URL('./drizzle/',import.meta.url)).filter(n=>n.endsWith('.sql')).sort()){
  const sql=readFileSync(new URL('./drizzle/'+name,import.meta.url),'utf8'),checksum=createHash('sha256').update(sql).digest('hex');
  const applied=sqlite.prepare('SELECT checksum FROM _migrations WHERE name=?').get(name);
  if(applied){if(applied.checksum!==checksum)throw new Error('已执行的数据库迁移内容发生变化：'+name);continue}
  sqlite.exec('BEGIN IMMEDIATE');try{sqlite.exec(sql);sqlite.prepare('INSERT INTO _migrations VALUES (?,?)').run(name,checksum);sqlite.exec('COMMIT')}catch(error){sqlite.exec('ROLLBACK');throw error}
 }
 class Statement{
  constructor(sql,args=[]){this.sql=sql;this.args=args}
  bind(...args){return new Statement(this.sql,args)}
  async first(){return sqlite.prepare(this.sql).get(...this.args)||null}
  async all(){return {results:sqlite.prepare(this.sql).all(...this.args)}}
  run(){return {meta:{changes:Number(sqlite.prepare(this.sql).run(...this.args).changes)}}}
 }
 return {prepare:sql=>new Statement(sql),async batch(statements){sqlite.exec('BEGIN IMMEDIATE');try{const results=statements.map(s=>s.run());sqlite.exec('COMMIT');return results}catch(error){sqlite.exec('ROLLBACK');throw error}},close(){sqlite.close()},sqlite};
}
