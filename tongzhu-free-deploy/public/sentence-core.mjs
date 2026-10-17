// A bounded parser for common Chinese purchase expressions. Parsing never writes data.
const NUM='[0-9]+(?:\\.[0-9]+)?|[零〇一二两三四五六七八九十百千万点]+';
const escapeRE=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
export function numberValue(raw){
 if(/^\d+(\.\d+)?$/.test(raw))return Number(raw);
 const digits={零:0,〇:0,一:1,二:2,两:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9};
 const [whole,fraction]=raw.split('点');let sum=0,part=0,n=0;
 for(const c of whole){if(c in digits)n=digits[c];else if(c==='万'){sum+=(part+n||1)*10000;part=0;n=0}else{const u={十:10,百:100,千:1000}[c];if(!u)return NaN;part+=(n||1)*u;n=0}}
 const f=fraction?[...fraction].map(c=>digits[c]??'x').join(''):'';return sum+part+n+(f?Number('0.'+f):0);
}
export function parsePurchaseSentence(raw,items,people,actorId,today){
 const text=String(raw||'').trim(),warnings=[],blockers=[];
 if(!text||text.length>500)throw new Error('请填写 1～500 字的采购描述');
 if(/准备|打算|计划|预算|大概|大约|可能|还没买|没有买|没买|想买|明天|后天/.test(text))blockers.push('这句话包含计划或估算；请在实际买好后，填写实际采购数量和总金额。');
 const matched=items.filter(i=>{const alias=i.name.replace(/^(厨房|客厅|卫生间|浴室|公共|共用|家用)/,'');return text.includes(i.name)||(alias.length>=2&&text.includes(alias))});
 let itemId=matched.length===1?matched[0].id:'',quantity='',amount='',participants=[];
 if(matched.length>1){
  const aliases=new Set(matched.map(i=>i.name.replace(/^(厨房|客厅|卫生间|浴室|公共|共用|家用)/,'')));
  if(aliases.size>1)blockers.push('检测到多种物品，请拆成一句一件，分别填写各自的实际总金额。');
  else warnings.push('同名物品有多个登记，请手动选择具体物品并填写数量。');
 }
 if(!matched.length)warnings.push('未匹配到已登记的物品，请选择；新物品需先登记。');
 const i=items.find(x=>x.id===itemId);
 if(i){
  const matches=[...text.matchAll(new RegExp('('+NUM+')\\s*'+escapeRE(i.unit),'g'))];
  if(matches.length===1){const m=matches[0],value=numberValue(m[1]),prefix=text.slice(Math.max(0,m.index-8),m.index);if(Number.isInteger(value)&&value>0&&value<=9999&&!/(?:[-−负至到～~]\s*|每.{0,4})$/.test(prefix))quantity=value}
  if(!quantity)warnings.push('请按库存单位「'+i.unit+'」补充实际数量，包装单位不同时需手动换算。');
 }
 const amounts=[...text.matchAll(new RegExp('(?:[¥￥]\\s*('+NUM+')|('+NUM+')\\s*(元|块)(?:([0-9一二三四五六七八九])(?:毛|角|(?=[\\s，,。；;！!]|$)))?)','g'))];
 const total=amounts.filter(m=>/总共|一共|合计|实付|花了|总价|总金额/.test(text.slice(Math.max(0,m.index-8),m.index)));
 const chosen=total.length===1?total[0]:amounts.length===1&&!/每|单价/.test(text.slice(Math.max(0,amounts[0].index-6),amounts[0].index))?amounts[0]:null;
 if(chosen){const value=numberValue(chosen[1]||chosen[2])+(chosen[4]?numberValue(chosen[4])/10:0);const cents=Math.round(value*100);if(value>0&&value<=1000000&&Math.abs(value*100-cents)<1e-6&&!/[-−负]/.test(text.slice(Math.max(0,chosen.index-1),chosen.index)))amount=(cents/100).toFixed(2)}
 if(!amount)warnings.push('请补充实际总金额，单价或多个金额不会自动作为总金额。');
 const hasAA=/平摊|均摊|AA|aa|分摊/.test(text),count=text.match(new RegExp('('+NUM+')\\s*(?:个)?人\\s*(?:一起)?(?:平摊|均摊|AA|aa|分摊)'));
 const named=people.filter(m=>text.includes(m.name));
 const excluded=people.filter(m=>new RegExp('(?:除了?|不含|不包括)'+escapeRE(m.name)+'|'+escapeRE(m.name)+'(?:不参与|不分摊|不算)').test(text));
 if(hasAA){
  if(excluded.length)participants=people.filter(m=>!excluded.includes(m)).map(m=>m.id);
  else if(/全员|所有人|大家/.test(text)||(count&&numberValue(count[1])===people.length))participants=people.map(m=>m.id);
  else if(!count&&named.length){participants=named.map(m=>m.id);if(/我和|和我|我们俩/.test(text)&&!participants.includes(actorId))participants.push(actorId)}
  if(count&&participants.length!==numberValue(count[1]))participants=[];
 }
 if(!participants.length)warnings.push('请选择本次参与 AA 的室友，不会默认让全员分摊。');
 for(const m of people)if(m.id!==actorId&&new RegExp(escapeRE(m.name)+'(?:付了|支付|垫付|买了|买的)').test(text))blockers.push('句中由'+m.name+'垫付，请由本人登录后录入；草稿付款人固定为当前身份。');
 let date=today;const explicit=text.match(/\d{4}-\d{2}-\d{2}/);
 const monthDay=text.match(/(\d{1,2})月(\d{1,2})[日号]/);
 if(explicit)date=explicit[0];else if(monthDay)date=today.slice(0,4)+'-'+monthDay[1].padStart(2,'0')+'-'+monthDay[2].padStart(2,'0');else if(/前天|昨天/.test(text)){const d=new Date(today+'T12:00:00Z');d.setUTCDate(d.getUTCDate()-(/前天/.test(text)?2:1));date=d.toISOString().slice(0,10)}
 participants=people.filter(m=>participants.includes(m.id)).map(m=>m.id);
 return {text,itemId,quantity,amount,participants,date,warnings,blockers,candidates:matched.map(x=>x.id)};
}
