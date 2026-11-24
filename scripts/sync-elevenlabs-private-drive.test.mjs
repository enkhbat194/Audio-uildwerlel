import test from 'node:test';
import assert from 'node:assert/strict';
import {candidateRows,syncPrivateArchive} from './sync-elevenlabs-private-drive.mjs';
const env={ELEVENLABS_API_KEY:'fixture',AHOJ_DRIVE_FOLDER_ID:'folder',GOOGLE_OAUTH_CLIENT_ID:'fixture',GOOGLE_OAUTH_CLIENT_SECRET:'fixture',GOOGLE_OAUTH_REFRESH_TOKEN:'fixture',AHOJ_SYNC_TEXTS_JSON:'["Ahoj!","Dobrý den."]',AHOJ_PREVIOUS_INDEX_FILE_ID:'prior'};
const history=[{history_item_id:'old',text:'Dobrý den.'},{history_item_id:'new',text:'Ahoj!'},{history_item_id:'new',text:'Ahoj!'},{history_item_id:'other',text:'Ahoj'}];
const response=o=>new Response(JSON.stringify(o),{headers:{'content-type':'application/json'}});
function fixture(shared=false){
 let writes=0,downloads=0;
 const files=[];
 const fetcher=async(url,opt={})=>{
  const u=new URL(url),p=u.pathname;
  assert(!p.includes('text-to-speech'),'No billable TTS');
  if(u.hostname==='oauth2.googleapis.com')return response({access_token:'fixture'});
  if(p==='/drive/v3/files/folder')return response({mimeType:'application/vnd.google-apps.folder',ownedByMe:true,capabilities:{canAddChildren:true}});
  if(p.endsWith('/permissions'))return response({permissions:[{type:shared?'anyone':'user',role:shared?'reader':'owner'}]});
  if(p==='/drive/v3/files/prior')return response({records:[{history_item_id:'old',text_cs:'Dobrý den.'}]});
  if(p==='/drive/v3/files')return response({files});
  if(p==='/v1/history')return response({history,has_more:false});
  if(p==='/v1/history/new/audio'){downloads++;const b=Buffer.alloc(256);b.write('ID3');return new Response(b,{headers:{'content-type':'audio/mpeg'}});}
  if(p==='/upload/drive/v3/files'){
   writes++;const b=Buffer.from(opt.body);const info=JSON.parse(b.toString().split('\r\n\r\n')[1].split('\r\n--')[0]);
   const saved={id:'saved',size:'256',md5Checksum:info.appProperties.md5,appProperties:info.appProperties,parents:['folder']};files.push(saved);return response(saved);
  }
  throw Error('Unexpected '+p);
 };
 return {fetcher,counts:()=>({writes,downloads})};
}
test('exact NFC, punctuation and history dedupe',()=>assert.deepEqual(candidateRows(history,['Ahoj!','Dobry\u0301 den.'],new Set(['old'])).map(x=>x.history_item_id),['new']));
test('dry-run does not download or write',async()=>{const f=fixture();const r=await syncPrivateArchive(env,f.fetcher);assert.equal(r.candidates,1);assert.deepEqual(f.counts(),{writes:0,downloads:0});});
test('archive and repeat without new download',async()=>{const f=fixture();const e={...env,AHOJ_PRIVATE_SYNC_ENABLED:'true'};assert.equal((await syncPrivateArchive(e,f.fetcher)).archived,1);assert.equal((await syncPrivateArchive(e,f.fetcher)).candidates,0);assert.deepEqual(f.counts(),{writes:1,downloads:1});});
test('shared destination is blocked',async()=>{const f=fixture(true);await assert.rejects(syncPrivateArchive({...env,AHOJ_PRIVATE_SYNC_ENABLED:'true'},f.fetcher),/NON_OWNER_PERMISSION/);assert.deepEqual(f.counts(),{writes:0,downloads:0});});
test('missing credentials blocked',async()=>{await assert.rejects(syncPrivateArchive({},()=>{throw Error('no network');}),/MISSING_ELEVENLABS_API_KEY/);});
