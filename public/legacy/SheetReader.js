// 由使用者提供的《（保健室老師）.xlsx》擷取：生平故事旁的照片優先，其次為人物卡左上角立繪。

// 依照參考的 googleSheets.js 讀取公開 Google 試算表，並保留整份角色 JSON，而非只擷取摘要欄位。
function spreadsheetInfo(raw){try{const u=new URL(String(raw||'').trim());if(!/(^|\.)docs\.google\.com$/i.test(u.hostname))return null;const m=u.pathname.match(/\/spreadsheets\/d\/([\w-]+)/);return m?{id:m[1],gid:u.searchParams.get('gid')||''}:null}catch(e){return null}}
function querySheetJsonp(url){return new Promise((resolve,reject)=>{const old=window.google; if(!window.google)window.google={};if(!google.visualization)google.visualization={};if(!google.visualization.Query)google.visualization.Query={};const q=google.visualization.Query,oldCb=q.setResponse;let done=false;const script=document.createElement('script');const timer=setTimeout(()=>finish(new Error('讀取逾時，請確認試算表已設為可檢視或已發布。')),16000);function finish(err,val){if(done)return;done=true;clearTimeout(timer);script.remove();if(oldCb===undefined)delete q.setResponse;else q.setResponse=oldCb;if(!old&&Object.keys(google).length===0)delete window.google;if(err)reject(err);else resolve(val)}q.setResponse=res=>{if(!res||res.status==='error'||!res.table){finish(new Error(res?.errors?.[0]?.detailed_message||'Google 試算表沒有回傳資料'));return}finish(null,res)};script.onerror=()=>finish(new Error('無法讀取試算表，請檢查網址與共用權限。'));script.src=url;document.head.appendChild(script)})}
function parseJsonCandidate(v){if(v==null)return null;if(typeof v==='object')return v;if(typeof v!=='string')return null;let t=v.trim();const tries=[t];if(t.startsWith('"')&&t.endsWith('"'))tries.push(t.slice(1,-1).replace(/""/g,'"'));let a=t.indexOf('{'),b=t.lastIndexOf('}');if(a>=0&&b>a)tries.push(t.slice(a,b+1));for(let x of tries){try{let o=JSON.parse(x);if(typeof o==='string')o=JSON.parse(o);if(o&&typeof o==='object')return o}catch(e){}}return null}
function unwrapRaw(o){return o?.kind==='character'&&o.data?o.data:(o?.data&&typeof o.data==='object'?o.data:o)}
function deepFind(obj,keys){const wanted=new Set(keys.map(k=>k.toLowerCase()));const seen=new Set();function walk(v){if(!v||typeof v!=='object'||seen.has(v))return '';seen.add(v);for(const [k,x] of Object.entries(v)){if(wanted.has(k.toLowerCase())&&x!==null&&x!==undefined&&String(x).trim()!=='')return x}for(const x of Object.values(v)){const got=walk(x);if(got!==''&&got!==undefined)return got}return ''}return walk(obj)}
function toText(v){if(v===null||v===undefined)return '';if(typeof v==='string')return v;if(typeof v==='number'||typeof v==='boolean')return String(v);if(Array.isArray(v))return v.map(toText).filter(Boolean).join('\n');return JSON.stringify(v,null,2)}
function candidateScore(obj){
 if(!obj||typeof obj!=='object')return -1;
 const d=unwrapRaw(obj)||{};let score=0;
 if(obj.kind==='character')score+=20;
 if(typeof d.name==='string'&&d.name.trim())score+=100;
 if(typeof d.commands==='string'&&d.commands.length>30)score+=25;
 if(Array.isArray(d.status))score+=12;
 if(Array.isArray(d.params))score+=8;
 if(d.infos||d.info||d.information)score+=8;
 if(d.attributes||d.attribs)score+=8;
 if(d.skills)score+=8;
 score+=Math.min(15,Object.keys(d).length);
 return score;
}
function findFullJson(response){
 const rows=response?.table?.rows||[];let best=null,bestScore=-1;
 const consider=obj=>{if(!obj)return;const d=unwrapRaw(obj)||{};const valid=obj.kind==='character'||(typeof d.name==='string'&&d.name.trim())||Array.isArray(d.status)||Array.isArray(d.params);if(!valid)return;const sc=candidateScore(obj);if(sc>bestScore){best=obj;bestScore=sc}};
 for(const row of rows){const cells=row?.c||[];
  for(const cell of cells){if(!cell)continue;for(const val of [cell.v,cell.f])consider(parseJsonCandidate(val));}
  // 某些 COC 試算表把 JSON 拆成相鄰儲存格；先收集所有候選，避免先遇到空白 name 的半成品就提早返回。
  for(let start=0;start<cells.length;start++){
   const firstCell=cells[start];const fv=firstCell?.v??firstCell?.f;const t=typeof fv==='string'?fv.trim():'';
   if(!t.startsWith('{')||(!t.includes('"kind"')&&!t.includes('"name"')))continue;
   let combined='';
   for(let end=start;end<Math.min(cells.length,start+32);end++){
    const cell=cells[end];const val=cell?(cell.v??cell.f):'';if(val!==undefined&&val!==null)combined+=String(val);
    consider(parseJsonCandidate(combined));
    const repaired=combined.replace(/("initiative"\s*:\s*),(?=\s*")/g,'$1null,');
    consider(parseJsonCandidate(repaired));
   }
  }
 }
 return best;
}
function first(...values){for(const v of values){if(v!==undefined&&v!==null&&String(v).trim()!=='')return v}return '';}
function cellText(cell){if(!cell)return '';const v=cell.f!==undefined&&cell.f!==null?cell.f:cell.v;return v===undefined||v===null?'':String(v).trim()}

// 針對「人物卡」這類 COC 7 版 Google Sheet：AM 欄是機器欄位名稱、AO 欄是對應值。
// 不依賴 Excel 公式文字，而是讀取 Google Visualization API 回傳的計算結果。
function extractCocKeyValueFields(response){
 const rows=response?.table?.rows||[], fields={};
 const cleanKey=v=>String(v??'').trim().replace(/^\s*\[\s*\{\s*["']?/,'').replace(/["'\s]+$/,'').toLowerCase();
 const empty=v=>v===undefined||v===null||String(v).trim()===''||String(v).trim().toLowerCase()==='none';
 for(const row of rows){
  const cells=row?.c||[];
  const key=cleanKey(cellText(cells[38])); // AM
  const value=cellText(cells[40]);         // AO
  if(key && !empty(value)) fields[key]=value;
 }
 return fields;
}
const COC_FIELD_LABELS={
 meaningful_locations:'意義非凡之地',meaningful_location:'意義非凡之地',important_places:'意義非凡之地',important_places_and_reasons:'意義非凡之地',
 character_name:'角色名稱',player:'玩家',occupation:'職業',sex:'性別',age:'年齡',
 birthplace:'出生地',residence:'居住地',str:'力量',dex:'敏捷',pow:'意志',con:'體質',
 app:'外貌',edu:'教育',siz:'體型',int:'智力',luck:'幸運',hp:'HP',mp:'MP',san:'SAN',
 armor:'護甲',psychology:'心理學',credit_rating:'信譽',persuade:'說服',fast_talk:'話術',
 intimidate:'恐嚇',charm:'取悅',navigate:'導航',jump:'跳躍',climb:'攀爬',swim:'游泳',
 drive_auto:'駕駛（汽車）',ride:'騎術',stealth:'潛行',track:'追蹤',disguise:'喬裝',
 locksmith:'鎖匠',sleight_of_hand:'妙手',language_own:'母語',accounting:'會計',
 law:'法律',occult:'神秘學',history:'歷史',natural_world:'自然學',anthropology:'人類學',
 archaeology:'考古學',compute_use:'電腦使用',acting:'表演',mech_repair:'機械維修',
 elec_repair:'電器維修',op_hv_machine:'操作重機',spot_hidden:'偵查',listen:'聆聽',
 library_use:'圖書館使用',appraise:'估價',cthulhu_mythos:'克蘇魯神話',first_aid:'急救',
 medicine:'醫學',pharmacy:'藥學',psychoanalysis:'精神分析',dodge:'閃避',
 fighting_brawl:'鬥毆',throw:'投擲',firearms_handgun:'射擊（手槍）',
 firearms_rifle:'射擊（步槍／霰彈槍）',submachine_gun:'射擊（衝鋒槍）',machine_gun:'射擊（機關槍）'
};
// 只從試算表回傳的儲存格內容尋找圖片網址／IMAGE("網址")公式，優先掃描生平故事欄位附近。
// Google Sheets 的「浮動插入圖片」不屬於儲存格資料，GViz 不會回傳；這種情況需由使用者上傳或貼圖片直連網址。
// 依使用者需求，不再嘗試從試算表擷取圖片；圖片只由編輯頁手動上傳。
function extractSheetImageUrls(_response){return [];}
function mapCocSheetCharacter(url,response){
 const f=extractCocKeyValueFields(response);
 if(!f.character_name && !f.player && !f.occupation && !f.str) return null;
 const attrs={};
 for(const [key,label] of Object.entries(COC_FIELD_LABELS)){
  if(['str','dex','pow','con','app','edu','siz','int','luck','hp','mp','san','armor'].includes(key)&&!emptyCoc(f[key])) attrs[label]=f[key];
 }
 const skills={};
 for(const [key,label] of Object.entries(COC_FIELD_LABELS)){
  const isAttr=['str','dex','pow','con','app','edu','siz','int','luck','hp','mp','san','armor','character_name','player','occupation','sex','age','birthplace','residence','personal_description','ideaology_beliefs','significant_people','meaningful_locations','meaningful_location','important_places','importantplaces','important_places_and_reasons','treasured_posessions','traits','phobias_manias','injuries_scars','other_back_story','investigators_notes','gear_and_posessions','spending_level','cash','assets','san_start'].includes(key);
  if(!isAttr && !emptyCoc(f[key])) skills[label]=f[key];
 }
 // 把角色卡上的自訂技能、額外語言、武器及其他技能也保留下來。
 for(const [key,value] of Object.entries(f)){
  if(emptyCoc(value)) continue;
  let m=key.match(/^(?:otherskill|drive_other|language_other)(\d+)_name$/);
  if(m){
   const prefix=key.startsWith('otherskill')?'otherskill':key.startsWith('drive_other')?'drive_other':'language_other';
   const valKey=prefix+m[1];
   if(!emptyCoc(f[valKey])) skills[String(value)]=f[valKey];
  }
 }
 const name=f.character_name||'未命名角色';
 const desc=f.personal_description||'';
 const backstory=f.other_back_story||'';
 const notes=[
  f.investigators_notes?`調查員備註：${f.investigators_notes}`:'',
  f.encounters_with_strange_entities?`異常遭遇：${f.encounters_with_strange_entities}`:'',
  f.charchest_traits?`角色特徵：${f.charchest_traits}`:'',
  f.charchest_exp?`經驗包：${f.charchest_exp}`:'',
  f.tomes_spells_artifacts?`典籍／法術／神器：${f.tomes_spells_artifacts}`:'',
 ].filter(Boolean).join('\n');
 return {
  id:'CHR-'+Date.now().toString(36)+Math.random().toString(36).slice(2,5),
  name,alias:'',work:'',type:'COC 7版／Google 試算表匯入',system:'COC 克蘇魯神話 7版',
  occupation:f.occupation||'',age:f.age||'',gender:f.sex||'',player:f.player||'',
  nationality:f.nationality||'',birthplace:f.birthplace||'',residence:f.residence||'',portraitUrl:'',originalImageUrl:'',images:[],
  description:desc,backstory:backstory,personality:f.traits||'',beliefs:f.ideaology_beliefs||'',injuries:f.injuries_scars||'',
  importantPeople:first(f.significant_people,f.important_people,f.significantPeople,''),importantPlaces:first(f.meaningful_locations,f.meaningful_location,f.important_places,f.importantPlaces,f.important_places_and_reasons,f.meaningful_locations_description,''),
  possessions:f.treasured_posessions||'',items:f.gear_and_posessions||'',weapons:f.weapon1_name&&f.weapon1_name!=='None'?[{name:f.weapon1_name,damage:f.weapon1_damage||'',range:f.weapon1_range||''}]:[],phobias:f.phobias_manias||'',
  notes,tags:[],favorite:false,status:'active',
  attributes:attrs,skills,rawCharacter:null,
  
  createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()
 };
}
function emptyCoc(v){return v===undefined||v===null||String(v).trim()===''||String(v).trim().toLowerCase()==='none';}

function normalizeLabel(value){return String(value||'').replace(/[：:]$/,'').replace(/[\s　]/g,'').toLowerCase()}
function extractVisibleFields(response){
 const rows=response?.table?.rows||[];
 const aliases={
  '角色':['角色','角色名稱','角色名','姓名','名稱','character name','name'],
  '玩家':['玩家','玩家名稱','玩家名','player','player name'],
  '性別':['性別','gender','sex'],
  '年齡':['年齡','年龄','年齢','age'],
  '職位':['職位','職業','職業／身份','身份','occupation','job'],
  '出生地':['出生地','出身','birthplace'],
  '國籍':['國籍','国籍','nationality'],
  '居住地':['居住地','所在地','residence'],
  '隨身物品':['隨身物品','裝備與持有物','gear_and_posessions','inventory','items'],
  '學歷':['學歷','学历','教育','education'],
  '簡介':['簡介','介紹','角色簡介','形象描述','description','introduction'],
  '傷勢':['傷勢及傷痕','傷勢','傷痕','injuries_scars','injuries','scars'],
  '思想信念':['思想/信念','思想／信念','思想','信念','beliefs'],
  '重要之人':['重要之人及理由','重要之人','重要人物','significant_people'],
  '意義非凡之地':['意義非凡之地','異於常人的力量','重要地點','meaningful_locations','meaningful_location','important_places','important_places_and_reasons'],
  '性格特徵':['性格特徵','性格','個性','traits','personality'],
  '恐懼症':['恐懼症及狂躁症','恐懼症','狂躁症','phobias_manias'],
  '寶貴之物':['寶貴之物','珍愛物品','treasured_posessions','treasuredPossessions'],
  '背景':['背景','背景資料','背景故事','人物背景','角色背景','人物設定','角色設定','生平','backstory','background'],
  '職業備忘':['職業備忘','職業補充','職業描述'],
  '力量':['力量','str','strength'],'敏捷':['敏捷','dex','dexterity'],'意志':['意志','pow','power'],
  '體質':['體質','con','constitution'],'外貌':['外貌','app','appearance'],'教育':['教育','edu'],
  '體型':['體型','siz','size'],'智力':['智力','int','intelligence'],'幸運':['幸運','luck'],
  'HP':['hp','生命值'],'MP':['mp','魔力'],'SAN':['san','理智值']
 };
 const known=new Map();Object.entries(aliases).forEach(([canonical,names])=>names.forEach(n=>known.set(normalizeLabel(n),canonical)));
 const out={};
 for(const row of rows){const cells=row?.c||[];const vals=cells.map(cellText);
  for(let i=0;i<vals.length;i++){
   const key=known.get(normalizeLabel(vals[i]));if(!key)continue;
   // 依照「左邊是標籤、右邊是資料」的常見角色卡排版，往右搜尋最近的非空值。
   for(let j=i+1;j<Math.min(vals.length,i+9);j++){
    if(!vals[j])continue;
    if(known.has(normalizeLabel(vals[j])))break;
    if(!out[key])out[key]=vals[j];break;
   }
  }
 }
 return out;
}
function mapVisibleFallback(url,response){
 const v=extractVisibleFields(response);const attrNames=['力量','敏捷','意志','體質','外貌','教育','體型','智力','幸運','HP','MP','SAN'];const attributes={};
 attrNames.forEach(k=>{if(v[k]!==undefined&&v[k]!=='')attributes[k]=v[k]});
 const name=first(v['角色'],v['姓名'],v['角色名稱'],'未命名角色');
 const occupation=first(v['職位'],v['職業'],'');
 const description=first(v['簡介'],'');const backstory=first(v['背景'],'');
 return {id:'CHR-'+Date.now().toString(36)+Math.random().toString(36).slice(2,5),name:String(name),alias:'',work:'',type:'自訂角色／試算表匯入',system:'',occupation:String(occupation),age:String(v['年齡']||''),gender:String(v['性別']||''),player:String(v['玩家']||''),nationality:String(v['國籍']||''),birthplace:String(v['出生地']||''),residence:String(v['居住地']||''),portraitUrl:'',originalImageUrl:'',images:[],description:String(description),backstory:String(backstory),personality:String(v['性格特徵']||''),beliefs:String(v['思想信念']||''),importantPeople:String(v['重要之人']||''),importantPlaces:String(v['意義非凡之地']||''),injuries:String(v['傷勢']||''),possessions:String(v['寶貴之物']||''),items:String(v['隨身物品']||''),phobias:String(v['恐懼症']||''),notes:'',tags:[],favorite:false,status:'active',attributes,skills:{},rawCharacter:null,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
}
function mapCompleteCharacter(raw,url,response){
 const d=unwrapRaw(raw)||{};const info=d.infos||d.info||d.information||{};const attrs=d.attribs||d.attributes||d.characteristics||{};const statusArr=Array.isArray(d.status)?d.status:[];const paramArr=Array.isArray(d.params)?d.params:[];const visible=extractVisibleFields(response);
 const attrFlat={};for(const [k,v] of Object.entries(attrs)){if(v&&typeof v==='object')attrFlat[v.label||v.name||v.short||k]=v.value??v.current??v.score??v.total??v;else attrFlat[k]=v}
 for(const x of [...statusArr,...paramArr])if(x&&typeof x==='object'){const k=x.label||x.name||x.title;if(k)attrFlat[k]=x.value??x.current??x.max??x.score??''}
 const skills={};if(Array.isArray(d.skills))for(const x of d.skills)if(x&&(x.name||x.label||x.title))skills[x.name||x.label||x.title]=x.value??x.score??x.total??x.base??x;
 if(d.skills&&typeof d.skills==='object'&&!Array.isArray(d.skills))for(const [k,v] of Object.entries(d.skills))skills[v&&typeof v==='object'?(v.label||v.name||k):k]=v&&typeof v==='object'?(v.value??v.total??v.base??v.score??JSON.stringify(v)):v;
 const commands=typeof d.commands==='string'?d.commands:'';let section='';const attrNames=new Set(['力量','敏捷','意志','體質','外貌','教育','體型','智力','幸運','靈感','HP','MP','SAN','MOV','DB','Build']);
 for(const line of commands.split(/\r?\n/)){const h=line.match(/^\s*\[([^\]]+)\]/);if(h){section=h[1];continue}const m=line.match(/^\s*CC\s*<=\s*(\d+)\s+(.+?)\s*$/i);if(!m)continue;const label=m[2].trim(),value=Number(m[1]);if(attrNames.has(label)||/屬性/.test(section)){if(!attrFlat[label])attrFlat[label]=value;}else if(!/SAN|幸運/.test(label)&&!skills[label])skills[label]=value;}
 const name=first(d.name,info.name,deepFind(d,['characterName','character_name','角色名稱','姓名','name']),visible['角色'],visible['角色名稱'],visible['姓名'],'未命名角色');
 const jobs=[visible['職位'],visible['職業'],info.occupation,info.job,d.occupation,d.job,deepFind(d,['occupation','job','職業','職業／身份','職位'])].filter(Boolean).map(String);const occupation=[...new Set(jobs)].join('／');
 const age=first(info.age,info.年齡,deepFind(d,['age','年齡','年齢']),visible['年齡']);const gender=first(info.sex,info.gender,info.性別,deepFind(d,['gender','sex','性別']),visible['性別']);
 const player=first(info.playername,info.player,deepFind(d,['player','playername','玩家','玩家名稱']),visible['玩家']);const birthplace=first(info.birthplace,deepFind(d,['birthplace','出生地','出身']),visible['出生地']);const residence=first(info.residence,deepFind(d,['residence','居住地','所在地']),visible['居住地']);const nationality=first(info.nationality,deepFind(d,['nationality','國籍']),visible['國籍']);
 const bio=first(deepFind(d,['description','memo','introduction','簡介','形象描述','外貌']),visible['簡介']);const backstory=first(deepFind(d,['backstory','background','生平','背景資料','背景故事','背景']),visible['背景']);
 const injuries=first(deepFind(d,['injuries','injuries_scars','scars','傷勢及傷痕','傷勢','傷痕']));const beliefs=first(deepFind(d,['beliefs','belief','思想','信念']));const importantPeople=first(deepFind(d,['importantPeople','significantPeople','重要之人','重要人物']));const importantPlaces=first(deepFind(d,['importantPlaces','meaningfulLocations','meaningfulLocation','meaningful_locations','meaningful_location','important_places','important_places_and_reasons','異於常人的力量','意義非凡之地','重要地點']));const possessions=first(deepFind(d,['treasuredPossessions','treasured_posessions','珍愛物品','寶貴之物']));const items=first(deepFind(d,['gear_and_posessions','gearAndPossessions','inventory','carriedItems','隨身物品','裝備與持有物']));const phobias=first(deepFind(d,['phobias','manias','恐懼','恐懼症','癖好']));const personality=first(deepFind(d,['personality','traits','特質','個性']));
 return {id:'CHR-'+Date.now().toString(36)+Math.random().toString(36).slice(2,5),name:String(name),alias:'',work:'',type:'COC／CCFOLIA 角色卡',system:first(d.system,d.ruleset,deepFind(d,['system','ruleset','系統']),'COC 克蘇魯神話 7版'),occupation:toText(occupation),age:toText(age),gender:toText(gender),player:toText(player),nationality:toText(nationality),birthplace:toText(birthplace),residence:toText(residence),portraitUrl:'',originalImageUrl:'',images:[],description:toText(bio),backstory:toText(backstory),personality:toText(personality),beliefs:toText(beliefs),injuries:toText(injuries),importantPeople:toText(importantPeople),importantPlaces:toText(importantPlaces),possessions:toText(possessions),items:toText(items),phobias:toText(phobias),notes:'',tags:[],favorite:false,status:'active',attributes:attrFlat,skills,rawCharacter:raw,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()}
}
async function fetchCharacterLink(){
 const input=document.getElementById('f_sourceUrl'),url=input?.value.trim(),status=document.getElementById('fetchStatus');
 if(!url){toast('請先貼上角色卡試算表連結');return}
 const info=spreadsheetInfo(url);if(!info){toast('請貼上 Google 試算表網址；也可以使用「匯入 CSV/JSON」匯入檔案');return}
 if(status)status.textContent='正在搜尋角色資料…';
 try{
  const base='https://docs.google.com/spreadsheets/d/'+encodeURIComponent(info.id)+'/gviz/tq?tqx=out:json';
  const urls=[];if(info.gid)urls.push(base+'&gid='+encodeURIComponent(info.gid)+'&_cg='+Date.now());
  urls.push(base+'&sheet='+encodeURIComponent('人物卡')+'&_cg='+Date.now());urls.push(base+'&_cg='+Date.now());
  let raw=null,lastErr=null,usedResponse=null;
  for(const u of [...new Set(urls)]){
   try{const res=await querySheetJsonp(u);const found=findFullJson(res);if(found){raw=found;usedResponse=res;break}if(!usedResponse||extractVisibleFields(res)&&Object.keys(extractVisibleFields(res)).length){usedResponse=res}lastErr=new Error('已讀到表格，正在嘗試辨識標籤與右側內容。')}
   catch(e){lastErr=e}
  }
  let imported;
  // 優先使用這份 COC 7 版人物卡的欄位索引（AM:AO），避免把試算表中的 JSON 片段誤認為完整 JSON。
  imported=usedResponse?mapCocSheetCharacter(url,usedResponse):null;
  if(!imported && raw){
   imported=mapCompleteCharacter(raw,url,usedResponse);
   if(!imported.name||imported.name==='未命名角色') imported=null;
  }
  if(!imported){
   let fields=usedResponse?extractVisibleFields(usedResponse):{};
   if(!Object.keys(fields).length){
    for(const u of [...new Set(urls)]){try{const res=await querySheetJsonp(u);const candidate=extractVisibleFields(res);if(Object.keys(candidate).length){usedResponse=res;fields=candidate;break}}catch(e){lastErr=e}}
   }
   if(!Object.keys(fields).length)throw new Error((lastErr?.message||'找不到角色 JSON 或可辨識的標籤／右側資料')+'。請確認試算表可檢視，並且標籤與內容位於同一列、內容在標籤右側。');
   imported=mapVisibleFallback(url,usedResponse);
   if(!imported.name||imported.name==='未命名角色')throw new Error('有讀到試算表，但找不到角色名稱標籤及其右側的值。');
  }
  const old=editingId?characters.find(x=>x.id===editingId):null;
  // 不擷取試算表圖片；保留使用者目前已上傳的圖片。
  window._editingImages=Array.isArray(window._editingImages)?window._editingImages:[];
  if(old){Object.assign(old,imported,{id:old.id,portraitUrl:old.portraitUrl||'',images:window._editingImages.slice(),tags:old.tags?.length?old.tags:[],favorite:old.favorite,notes:old.notes||'',createdAt:old.createdAt});}
  else window._pendingFetchedCharacter=imported;
  renderImageManager();
  const fill=(id,v)=>{const el=document.getElementById('f_'+id);if(el&&v!==undefined&&v!==null&&String(v)!=='')el.value=typeof v==='object'?JSON.stringify(v):String(v)};
  ['name','occupation','system','type','work','age','gender','player','nationality','birthplace','residence','description','backstory','personality','beliefs','importantPeople','importantPlaces','injuries','possessions','items','phobias'].forEach(k=>fill(k,imported[k]));
  fill('tags',tagsOf(imported).join(', '));fill('rawCharacter',imported.rawCharacter?JSON.stringify(imported.rawCharacter,null,2):'');
  if(status){const base=imported.rawCharacter?`讀取成功：${imported.name}；屬性 ${Object.keys(imported.attributes||{}).length} 項、技能 ${Object.keys(imported.skills||{}).length} 項。`:`已擷取：${imported.name}；屬性 ${Object.keys(imported.attributes||{}).length} 項、技能 ${Object.keys(imported.skills||{}).length} 項。`;status.textContent=base+' 圖片不會從試算表自動擷取，請在編輯頁上方手動上傳。';}
  toast('已讀取角色資料；圖片請在最上方手動上傳。');
 }catch(e){if(status)status.textContent='讀取失敗：'+e.message;toast('讀取失敗：'+e.message)}
}
