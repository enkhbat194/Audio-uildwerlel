// AHOJ private ElevenLabs archive. No TTS, no public sharing.
// Set ELEVENLABS_API_KEY in Project Settings > Script properties.
// Run setup once; it archives existing new items and installs a 15-minute trigger.
const ROOT = '1_TfQwRJmy4T7dyArcFl_jTLMMuYT3mVf';
const INDEX = '1XmJToPAQ7vGUlPkkcBO0OM_mWZ2KKKRF';
const SUB = 'AUTO_NEW_MP3';
const LIMIT = 25;
const BASE = 'https://api.elevenlabs.io/v1/history';
function privateOnly_(folder) {
  if (folder.getSharingAccess() !== DriveApp.Access.PRIVATE ||
      folder.getEditors().length || folder.getViewers().length)
    throw new Error('Archive folder is not owner-only');
}
function fetch_(url,key) {
  const r = UrlFetchApp.fetch(url,{method:'get',headers:{'xi-api-key':key},muteHttpExceptions:true,followRedirects:false});
  if (r.getResponseCode()!==200) throw new Error('ElevenLabs HTTP '+r.getResponseCode());
  return r;
}
function digest_(bytes) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,bytes).map(b=>('0'+(b&255).toString(16)).slice(-2)).join('');
}
function selectNew_(rows,known) {
  const seen=new Set(known);
  return rows.filter(r=>{
    const id=r.history_item_id;
    if(typeof id!=='string'|| !/^[A-Za-z0-9_-]{1,100}$/.test(id)||seen.has(id))return false;
    seen.add(id);return true;
  });
}
function syncAudio() {
  const lock=LockService.getScriptLock();
  if(!lock.tryLock(1000))return;
  try{
    const key=PropertiesService.getScriptProperties().getProperty('ELEVENLABS_API_KEY');
    if(!key)throw new Error('Missing ELEVENLABS_API_KEY script property');
    const root=DriveApp.getFolderById(ROOT);privateOnly_(root);
    const ix=DriveApp.getFileById(INDEX);
    if(ix.getSharingAccess()!==DriveApp.Access.PRIVATE||ix.getEditors().length||ix.getViewers().length)throw new Error('Index is not private');
    const prior=JSON.parse(ix.getBlob().getDataAsString());
    const known=new Set((prior.records||[]).map(r=>r.history_item_id));
    if(prior.total_archived!==276||known.size!==276||known.has(undefined))throw new Error('Original archive index mismatch');
    const existing=root.getFoldersByName(SUB);
    const out=existing.hasNext()?existing.next():root.createFolder(SUB);
    if(existing.hasNext())throw new Error('Duplicate output folder');
    privateOnly_(out);
    const files=out.getFiles();
    while(files.hasNext()){
      const f=files.next();
      if(!f.getName().endsWith('.mp3'))continue;
      const m=JSON.parse(f.getDescription()||'{}');
      if(!m.history_item_id || f.getName()!==m.history_item_id+'.mp3'||m.size!==f.getSize()||!m.sha256)throw new Error('Incomplete receipt: '+f.getName());
      known.add(m.history_item_id);
    }
    let rows=[],cursor='',complete=false;
    for(let p=0;p<100;p++){
      const r=JSON.parse(fetch_(BASE+'?page_size=100&source=Flows&date_after_unix=1795132800'+(cursor?'&start_after_history_item_id='+encodeURIComponent(cursor):''),key).getContentText());
      if(!Array.isArray(r.history))throw new Error('Invalid history response');
      rows=rows.concat(r.history);
      if(!r.has_more){complete=true;break;}
      if(!r.last_history_item_id||r.last_history_item_id===cursor)throw new Error('History pagination error');
      cursor=r.last_history_item_id;
    }
    if(!complete)throw new Error('History exceeds page limit');
    const pending=selectNew_(rows,known);
    let archived=0;const start=Date.now();
    for(const item of pending.slice(0,LIMIT)){
      if(Date.now()-start>220000)break;
      const id=item.history_item_id;
      const resp=fetch_(BASE+'/'+encodeURIComponent(id)+'/audio',key);
      const blob=resp.getBlob();
      const b=blob.getBytes();
      const mp3=b.length>128&&((b[0]===73&&b[1]===68&&b[2]===51)||((b[0]&255)===255&&(b[1]&224)===224));
      if(!mp3||b.length>20*1024*1024)throw new Error('Invalid MP3: '+id);
      const sha=digest_(b);
      const f=out.createFile(blob.setName(id+'.mp3').setContentType('audio/mpeg'));
      f.setDescription(JSON.stringify({history_item_id:id,text_cs:item.text||'',voice_id:item.voice_id||'',model_id:item.model_id||'',size:b.length,sha256:sha,publish_allowed:false}));
      if(f.getSize()!==b.length||digest_(f.getBlob().getBytes())!==sha)throw new Error('Archive verification failed: '+id);
      archived++;
    }
    const result={prior:276,newArchived:archived,pending:pending.length-archived,ttsCalls:0,publicationAllowed:false};
    console.log(JSON.stringify(result));
    return result;
  }finally{lock.releaseLock();}
}
function setup(){
  const result=syncAudio();
  if(!result)throw new Error('Sync already running');
  const triggers=ScriptApp.getProjectTriggers().filter(t=>t.getHandlerFunction()==='syncAudio');
  if(!triggers.length)ScriptApp.newTrigger('syncAudio').timeBased().everyMinutes(15).create();
  console.log('AUTO_SYNC_ENABLED');
}
function stopSync(){
  ScriptApp.getProjectTriggers().filter(t=>t.getHandlerFunction()==='syncAudio').forEach(t=>ScriptApp.deleteTrigger(t));
}
function testSelection(){
  const a=selectNew_([{history_item_id:'old'},{history_item_id:'new'},{history_item_id:'new'},{history_item_id:'bad/id'}],new Set(['old']));
  if(a.length!==1||a[0].history_item_id!=='new')throw new Error('FAIL');
  console.log('PASS: existing and duplicate history IDs skipped');
}
