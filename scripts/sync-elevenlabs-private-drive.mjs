/**
 * AHOJ read-only ElevenLabs history -> private Google Drive archive.
 * No text-to-speech request, no public sharing, no secret or audio in Git.
 * Run on a cloud scheduler (single worker) with existing ElevenLabs key and
 * owner's Drive OAuth credentials stored as environment secrets.
 */
import {createHash, randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const hash=(b,alg='sha256')=>createHash(alg).update(b).digest('hex');
const exact=s=>String(s).normalize('NFC').trim();
const esc=s=>String(s).replace(/\\/g,'\\\\').replace(/'/g,"\\'");
const endpoint='https://api.elevenlabs.io/v1';
const drive='https://www.googleapis.com/drive/v3';
const upload='https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,size,md5Checksum,appProperties,parents';
const timeout=()=>AbortSignal.timeout(30000);
async function checked(res,where){if(!res.ok)throw Error(where+'_HTTP_'+res.status);return res;}
function requireEnv(e,k){const v=e[k]?.trim();if(!v)throw Error('MISSING_'+k);return v;}
function mp3(b){return b.length>=128&&(b.subarray(0,3).toString()==='ID3'||(b[0]===255&&(b[1]&224)===224));}
export function candidateRows(history,targets,archivedIds){
 const wanted=new Set(targets.map(exact));
 const seen=new Set();
 return history.filter(h=>typeof h.history_item_id==='string'&&h.history_item_id.length>0&&typeof h.text==='string'&&wanted.has(exact(h.text))&&!archivedIds.has(h.history_item_id)&&!seen.has(h.history_item_id)&&seen.add(h.history_item_id));
}
export async function syncPrivateArchive(e=process.env,request=fetch){
 const enabled=e.AHOJ_PRIVATE_SYNC_ENABLED==='true';
 const key=requireEnv(e,'ELEVENLABS_API_KEY'),folder=requireEnv(e,'AHOJ_DRIVE_FOLDER_ID');
 const clientId=requireEnv(e,'GOOGLE_OAUTH_CLIENT_ID'),clientSecret=requireEnv(e,'GOOGLE_OAUTH_CLIENT_SECRET'),refresh=requireEnv(e,'GOOGLE_OAUTH_REFRESH_TOKEN');
 const targets=JSON.parse(requireEnv(e,'AHOJ_SYNC_TEXTS_JSON'));
 if(!Array.isArray(targets)||!targets.length||targets.length>500||targets.some(t=>typeof t!=='string'||!t.trim()||t.length>5000))throw Error('INVALID_TARGETS');
 const max=Number(e.AHOJ_SYNC_MAX_FILES||'25');if(!Number.isInteger(max)||max<1||max>100)throw Error('INVALID_BATCH_LIMIT');
 const tokenRes=await checked(await request('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams({client_id:clientId,client_secret:clientSecret,refresh_token:refresh,grant_type:'refresh_token'}),signal:timeout()}),'OAUTH');
 const token=(await tokenRes.json()).access_token;if(!token)throw Error('OAUTH_NO_TOKEN');
 const auth={Authorization:'Bearer '+token};
 const callDrive=async(url,opt={})=>checked(await request(url,{...opt,headers:{...auth,...opt.headers},signal:timeout()}),'DRIVE');
 // Owner's My Drive only: never change sharing, never archive into a shared folder.
 const meta=await (await callDrive(drive+'/files/'+encodeURIComponent(folder)+'?fields=id,mimeType,ownedByMe,trashed,capabilities(canAddChildren)')).json();
 if(meta.mimeType!=='application/vnd.google-apps.folder'||!meta.ownedByMe||meta.trashed||!meta.capabilities?.canAddChildren)throw Error('FOLDER_NOT_PRIVATE_WRITABLE_OWNER');
 async function assertPrivate(id){
 let pageToken;do{const p=new URL(drive+'/files/'+encodeURIComponent(id)+'/permissions');p.searchParams.set('fields','nextPageToken,permissions(type,role,deleted)');p.searchParams.set('pageSize','100');if(pageToken)p.searchParams.set('pageToken',pageToken);
 const d=await (await callDrive(p)).json();if(!Array.isArray(d.permissions)||!d.permissions.length||d.permissions.some(x=>!x.deleted&&(x.type!=='user'||x.role!=='owner')))throw Error('NON_OWNER_PERMISSION');pageToken=d.nextPageToken;}while(pageToken);
 }
 await assertPrivate(folder);
 const archivedIds=new Set(),archivedTexts=new Set();
 // Previous immutable archive index: verify owner-only permissions before reading.
 const prior=e.AHOJ_PREVIOUS_INDEX_FILE_ID?.trim();
 if(prior){await assertPrivate(prior);const j=await (await callDrive(drive+'/files/'+encodeURIComponent(prior)+'?alt=media')).json();if(!Array.isArray(j.records))throw Error('INVALID_PREVIOUS_INDEX');for(const r of j.records){if(r.history_item_id)archivedIds.add(r.history_item_id);if(typeof r.text_cs==='string')archivedTexts.add(exact(r.text_cs));}}
 // Existing new archive receipts are stored on Drive itself; not ephemeral disk.
 let pageToken;do{const p=new URL(drive+'/files');p.searchParams.set('q',"'"+esc(folder)+"' in parents and trashed = false");p.searchParams.set('fields','nextPageToken,files(id,name,size,md5Checksum,appProperties)');p.searchParams.set('pageSize','100');if(pageToken)p.searchParams.set('pageToken',pageToken);const d=await (await callDrive(p)).json();for(const f of d.files||[]){const a=f.appProperties;if(a?.provider==='elevenlabs'&&a.history_id&&a.sha256&&f.md5Checksum===a.md5&&Number(f.size)>0){archivedIds.add(a.history_id);}}pageToken=d.nextPageToken;}while(pageToken);
 let cursor,complete=false;const history=[];
 for(let i=0;i<100;i++){const p=new URL(endpoint+'/history');p.searchParams.set('page_size','100');if(cursor)p.searchParams.set('start_after_history_item_id',cursor);const d=await (await checked(await request(p,{headers:{'xi-api-key':key},signal:timeout()}),'HISTORY')).json();if(!Array.isArray(d.history))throw Error('INVALID_HISTORY');history.push(...d.history);if(!d.has_more){complete=true;break;}if(!d.last_history_item_id||d.last_history_item_id===cursor)throw Error('INCOMPLETE_HISTORY');cursor=d.last_history_item_id;}
 if(!complete)throw Error('HISTORY_PAGE_LIMIT');
 const candidates=candidateRows(history,targets,archivedIds);
 const report={mode:enabled?'private_archive':'dry_run',history_count:new Set(history.map(x=>x.history_item_id)).size,target_count:new Set(targets.map(exact)).size,previous_index_records:archivedIds.size,previous_index_text_hits:targets.filter(t=>archivedTexts.has(exact(t))).length,candidates:candidates.length,archived:0,skipped:0,failed:0,missing_texts:targets.filter(t=>!archivedTexts.has(exact(t))&&!history.some(h=>typeof h.text==='string'&&exact(h.text)===exact(t))).length,tts_calls:0,published:false};
 if(!enabled)return report;
 for(const h of candidates.slice(0,max)){
 const id=h.history_item_id;
 try{
 // Recheck idempotency immediately before write (single cloud worker required).
 const q=new URL(drive+'/files');q.searchParams.set('q',"'"+esc(folder)+"' in parents and trashed = false and appProperties has { key='history_id' and value='"+esc(id)+"' }");q.searchParams.set('fields','files(id,size,md5Checksum,appProperties)');const d=await (await callDrive(q)).json();if((d.files||[]).length){if(d.files.length!==1||!d.files[0].appProperties?.sha256||d.files[0].md5Checksum!==d.files[0].appProperties?.md5||!(Number(d.files[0].size)>0))throw Error('EXISTING_RECEIPT_CONFLICT');report.skipped++;continue;}
 const res=await checked(await request(endpoint+'/history/'+encodeURIComponent(id)+'/audio',{headers:{'xi-api-key':key},signal:timeout()}),'AUDIO');
 const mime=(res.headers.get('content-type')||'').split(';')[0];if(!['audio/mpeg','audio/mp3','application/octet-stream'].includes(mime))throw Error('INVALID_AUDIO_TYPE');
 const b=Buffer.from(await res.arrayBuffer());if(b.length>20_000_000||!mp3(b))throw Error('INVALID_MP3');
 const sha=hash(b),md5=hash(b,'md5'),boundary='ahoj_'+randomUUID();
 const info={name:'eleven_'+hash(id).slice(0,24)+'.mp3',mimeType:'audio/mpeg',parents:[folder],description:JSON.stringify({schema:1,provider:'elevenlabs',history_id:id,text_cs:h.text,voice_id:h.voice_id||null,model_id:h.model_id||null,sha256:sha,qa:'TECHNICAL_HEADER_ONLY',publication_allowed:false}),appProperties:{provider:'elevenlabs',history_id:id,sha256:sha,md5,text_sha256:hash(exact(h.text)),qa:'PENDING_CONTENT_QA',publication:'blocked'}};
 const body=Buffer.concat([Buffer.from('--'+boundary+'\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n'+JSON.stringify(info)+'\r\n--'+boundary+'\r\nContent-Type: audio/mpeg\r\n\r\n'),b,Buffer.from('\r\n--'+boundary+'--\r\n')]);
 const saved=await (await callDrive(upload,{method:'POST',headers:{'Content-Type':'multipart/related; boundary='+boundary},body})).json();
 if(!saved.id||!saved.parents?.includes(folder)||Number(saved.size)!==b.length||saved.md5Checksum!==md5||saved.appProperties?.sha256!==sha)throw Error('DRIVE_RECEIPT_MISMATCH');
 await assertPrivate(saved.id);report.archived++;
 }catch{report.failed++;}
 }
 return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{const r=await syncPrivateArchive();console.log(JSON.stringify(r));if(r.failed)process.exitCode=1;}catch(e){const m=String(e?.message||'');console.error('SYNC_BLOCKED '+(/^[A-Z0-9_]+$/.test(m)?m:'REQUEST_FAILED'));process.exitCode=1;}}
