import { useEffect, useMemo, useState } from 'react';
import JSZip from 'jszip';
import { CheckCircle2, Download, FileArchive, Headphones, RefreshCw, ShieldAlert, XCircle } from 'lucide-react';

const DB_NAME = 'ahoj-audio-qa-inbox-v1';
const STORE = 'clips';
const REQUIRED_MODEL = 'gemini-3.8-flash-tts';

type ClipQAStatus = 'AUTO_PASS' | 'QUARANTINED';
type OwnerDecision = 'PENDING' | 'OWNER_APPROVED' | 'OWNER_REJECTED';

interface ClipInfo {
  id: string;
  source_id: string;
  lesson_id: string;
  text: string;
  style: 'natural' | 'learning_slow';
  model: string;
  voice: string;
  filename: string;
  sha256: string;
  qa_status: ClipQAStatus;
  batch_id: string;
  recognized_text?: string;
  issue?: string;
  production_method: 'original_gemini_tts';
  release_allowed: false;
}

interface StoredClip {
  id: string;
  info: ClipInfo;
  audio: Blob;
  decision: OwnerDecision;
  notes: string;
  reviewed_at: string | null;
}

interface ReviewIndex {
  schema_version: 'ahoj-qa-inbox-v1';
  publish_allowed: false;
  clips: ClipInfo[];
}

function openReviewDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

async function withStore<T>(mode: IDBTransactionMode, op: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openReviewDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = op(tx.objectStore(STORE));
    tx.oncomplete = () => { db.close(); resolve(req.result); };
    tx.onerror = () => { db.close(); reject(tx.error); };
    tx.onabort = () => { db.close(); reject(tx.error ?? Error('Database transaction aborted')); };
  });
}
function readClips() { return withStore<StoredClip[]>('readonly', store => store.getAll()); }
function readClip(id: string) { return withStore<StoredClip | undefined>('readonly', store => store.get(id)); }
function writeClip(clip: StoredClip) { return withStore<IDBValidKey>('readwrite', store => store.put(clip)); }
function hex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map(x => x.toString(16).padStart(2, '0')).join('');
}
function safeInfo(input: ClipInfo): boolean {
  return Boolean(
    input &&
    /^[A-Za-z0-9-]{6,100}$/.test(input.source_id) &&
    /^[0-9a-f]{64}$/.test(input.sha256) &&
    input.id === input.sha256 &&
    input.model === REQUIRED_MODEL &&
    input.production_method === 'original_gemini_tts' &&
    (input.qa_status === 'AUTO_PASS' || input.qa_status === 'QUARANTINED') &&
    (input.style === 'natural' || input.style === 'learning_slow') &&
    typeof input.text === 'string' && input.text.length > 0 && input.text.length < 1200 &&
    typeof input.filename === 'string' && /^audio\/[a-zA-Z0-9_.-]+\.wav$/.test(input.filename) &&
    input.release_allowed === false
  );
}

export function BatchReviewView() {
  const [clips, setClips] = useState<StoredClip[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [filter, setFilter] = useState<'quarantine' | 'all' | 'approved'>('quarantine');
  const [isImporting, setIsImporting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [fault, setFault] = useState<string | null>(null);

  const reload = async () => {
    try {
      const all = await readClips();
      setClips(all.sort((a, b) => {
        const aScore = a.info.qa_status === 'QUARANTINED' && a.decision === 'PENDING' ? 0 : 1;
        const bScore = b.info.qa_status === 'QUARANTINED' && b.decision === 'PENDING' ? 0 : 1;
        return aScore - bScore || a.info.source_id.localeCompare(b.info.source_id);
      }));
    } catch (error) {
      setFault(error instanceof Error ? error.message : 'Хувийн хадгалалтыг нээж чадсангүй.');
    }
  };

  useEffect(() => { void reload(); }, []);

  const rows = useMemo(() => clips.filter(clip => {
    if (filter === 'all') return true;
    if (filter === 'approved') return clip.decision === 'OWNER_APPROVED' || clip.info.qa_status === 'AUTO_PASS';
    return clip.info.qa_status === 'QUARANTINED' && clip.decision === 'PENDING';
  }), [clips, filter]);
  const selected = clips.find(x => x.id === selectedId) ?? null;
  const reviewCount = clips.filter(x => x.info.qa_status === 'QUARANTINED' && x.decision === 'PENDING').length;
  const passCount = clips.filter(x => x.info.qa_status === 'AUTO_PASS' || x.decision === 'OWNER_APPROVED').length;

  useEffect(() => {
    setNotes(selected?.notes ?? '');
    if (!selected) { setUrl(null); return; }
    const playbackUrl = URL.createObjectURL(selected.audio);
    setUrl(playbackUrl);
    return () => URL.revokeObjectURL(playbackUrl);
  }, [selected?.id, selected?.audio]);

  async function importZip(file: File) {
    setMessage(null);
    setFault(null);
    if (file.size > 125 * 1024 * 1024) {
      setFault('ZIP 125 MB-аас их байна. Багцаар нь оруул.');
      return;
    }
    setIsImporting(true);
    try {
      const zip = await JSZip.loadAsync(file);
      const manifestFile = zip.file('AUDIO_REVIEW_INDEX.json');
      if (!manifestFile) throw Error('AUDIO_REVIEW_INDEX.json байхгүй. QA Inbox багцыг сонго.');
      const manifest = JSON.parse(await manifestFile.async('string')) as ReviewIndex;
      if (manifest.schema_version !== 'ahoj-qa-inbox-v1' || manifest.publish_allowed !== false || !Array.isArray(manifest.clips) || manifest.clips.length > 500) {
        throw Error('Багцын эх сурвалж, нийтлэх эрх, эсвэл хэмжээ буруу.');
      }
      let imported = 0;
      let excluded = 0;
      for (const info of manifest.clips) {
        if (!safeInfo(info)) { excluded++; continue; }
        const entry = zip.file(info.filename);
        if (!entry || entry.dir) { excluded++; continue; }
        const audio = await entry.async('blob');
        if (audio.size > 6 * 1024 * 1024 || audio.size < 44) { excluded++; continue; }
        const bytes = await audio.arrayBuffer();
        const header = new Uint8Array(bytes.slice(0, 12));
        if (String.fromCharCode(...header.slice(0, 4)) !== 'RIFF' || String.fromCharCode(...header.slice(8, 12)) !== 'WAVE') { excluded++; continue; }
        const checksum = hex(await crypto.subtle.digest('SHA-256', bytes));
        if (checksum !== info.sha256) { excluded++; continue; }
        const old = await readClip(info.id);
        await writeClip({
          id: info.id,
          info,
          audio: new Blob([bytes], { type: 'audio/wav' }),
          decision: old?.decision ?? 'PENDING',
          notes: old?.notes ?? '',
          reviewed_at: old?.reviewed_at ?? null,
        });
        imported++;
      }
      await reload();
      setMessage(`Импорт: ${imported} WAV · Шалгалт зөрсөн/зөвшөөрөгдөөгүй: ${excluded}. Зөвхөн жинхэнэ Gemini TTS хүлээн авна.`);
      setFilter('quarantine');
    } catch (error) {
      setFault(error instanceof Error ? error.message : 'ZIP файл уншихад алдаа гарлаа.');
    } finally {
      setIsImporting(false);
    }
  }

  async function decide(decision: OwnerDecision) {
    if (!selected) return;
    try {
      const updated: StoredClip = { ...selected, decision, notes: notes.trim(), reviewed_at: new Date().toISOString() };
      await writeClip(updated);
      setMessage(decision === 'OWNER_APPROVED' ? 'Сонссон WAV-ийг зөвшөөрлөө. Сургалтын нийтлэх эрх өөрчлөгдөөгүй.' : 'WAV-ийг буцаалаа. Дараагийн Gemini TTS багцад засварлах шаардлагатай.');
      await reload();
    } catch (error) {
      setFault(error instanceof Error ? error.message : 'QA шийдвэр хадгалагдсангүй.');
    }
  }

  function exportDecisions() {
    const decisions = clips.filter(x => x.decision !== 'PENDING').map(x => ({
      source_id: x.info.source_id, lesson_id: x.info.lesson_id, cs_exact: x.info.text,
      style: x.info.style, audio_sha256: x.info.sha256, model: x.info.model,
      owner_decision: x.decision, notes: x.notes, reviewed_at: x.reviewed_at,
      curriculum_publish_allowed: false,
    }));
    const blob = new Blob([JSON.stringify({ schema: 'ahoj-qa-owner-decisions-v1', decisions }, null, 2)], { type: 'application/json' });
    const downloadUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = 'AHOJ_OWNER_QA_DECISIONS.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(downloadUrl), 2000);
  }

  return <section className="space-y-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 md:p-6">
    <div className="flex items-start gap-3">
      <Headphones className="w-6 h-6 shrink-0 text-sky-700 dark:text-sky-400" aria-hidden="true" />
      <div className="space-y-1 flex-1">
        <h2 className="font-bold text-xl">Үйлдвэрийн QA Inbox</h2>
        <p className="text-xs text-slate-600 dark:text-slate-400">Автоматаар тусгаарласан бодит Gemini 3.8 Flash TTS WAV-ийг сонсоод зөвшөөрөх эсвэл буцаана. Бусдыг заавал шалгахгүй.</p>
      </div>
    </div>

    <label className="flex items-center justify-center gap-2 px-4 py-3 min-h-[48px] bg-sky-700 hover:bg-sky-800 text-white text-sm font-semibold rounded-xl cursor-pointer">
      <FileArchive className="w-4 h-4" /> {isImporting ? 'ZIP уншиж байна...' : 'Drive / Files-ээс QA багцын ZIP оруулах'}
      <input type="file" accept=".zip,application/zip" className="sr-only" disabled={isImporting}
        onChange={e => { const f = e.target.files?.[0]; if (f) void importZip(f); e.target.value = ''; }} />
    </label>

    <div className="grid grid-cols-3 gap-2">
      <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/30"><p className="text-2xl font-bold text-amber-800 dark:text-amber-300">{reviewCount}</p><p className="text-[11px] text-amber-800 dark:text-amber-300">Сонсож шийдэх</p></div>
      <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/30"><p className="text-2xl font-bold text-emerald-800 dark:text-emerald-300">{passCount}</p><p className="text-[11px] text-emerald-800 dark:text-emerald-300">Тэнцсэн / зөвшөөрсөн</p></div>
      <div className="p-3 rounded-xl bg-slate-100 dark:bg-slate-800"><p className="text-2xl font-bold">{clips.length}</p><p className="text-[11px] text-slate-600 dark:text-slate-300">Нийт WAV</p></div>
    </div>

    {fault && <p role="alert" className="p-3 rounded-lg border border-red-300 text-red-800 dark:text-red-300 text-sm">{fault}</p>}
    {message && <p role="status" className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800 text-sm">{message}</p>}

    <div className="flex flex-wrap gap-2 items-center">
      {([
        ['quarantine','Тусгаарласан'],
        ['all','Бүгд'],
        ['approved','Зөвшөөрсөн'],
      ] as const).map(([value,label]) => <button key={value} type="button" onClick={() => setFilter(value)}
        className={`px-3 py-2 min-h-[40px] text-xs rounded-lg font-semibold border ${filter===value?'border-sky-700 bg-sky-50 text-sky-800 dark:bg-sky-950 dark:text-sky-200':'border-slate-300 text-slate-600 dark:border-slate-700 dark:text-slate-300'}`}>{label}</button>)}
      <button type="button" onClick={exportDecisions} disabled={!clips.some(x=>x.decision!=='PENDING')}
        className="ml-auto px-3 py-2 min-h-[40px] text-xs rounded-lg font-semibold border border-slate-300 disabled:opacity-40 flex items-center gap-1">
        <Download className="w-4 h-4" /> QA шийдвэр экспортлох
      </button>
    </div>

    <div className="grid md:grid-cols-5 gap-4">
      <div className="md:col-span-2 max-h-80 overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-800">
        {rows.length===0 && <p className="p-4 text-sm text-slate-500">Энэ ангилалд бичлэг алга. QA ZIP оруулбал энд гарна.</p>}
        {rows.map(c=><button key={c.id} type="button" onClick={()=>setSelectedId(c.id)}
          className={`w-full text-left p-3 text-sm hover:bg-sky-50 dark:hover:bg-slate-800 ${selectedId===c.id?'bg-sky-50 dark:bg-slate-800':''}`}>
          <div className="font-semibold">{c.info.text}</div>
          <div className="text-xs text-slate-500 mt-1">{c.info.source_id} · {c.info.style==='natural'?'Natural':'Learning Slow'}</div>
          <div className="text-xs mt-1">{c.decision==='OWNER_APPROVED'?'✓ Чи зөвшөөрсөн':c.decision==='OWNER_REJECTED'?'✕ Буцаасан':c.info.qa_status==='QUARANTINED'?'⚠ Сонсож шалгах':'✓ Автомат QA PASS'}</div>
        </button>)}
      </div>
      <div className="md:col-span-3 rounded-xl border border-slate-200 dark:border-slate-700 p-4 space-y-3">
        {selected ? <>
          <div className="text-lg font-semibold">{selected.info.text}</div>
          <p className="text-xs text-slate-500">{selected.info.source_id} · {selected.info.voice} · {selected.info.model} · {selected.info.style}</p>
          {url && <audio controls src={url} className="w-full" preload="metadata" />}
          {selected.info.recognized_text && <p className="text-sm"><strong>Автомат танилт:</strong> {selected.info.recognized_text}</p>}
          {selected.info.issue && <p className="text-xs text-amber-700 dark:text-amber-300"><ShieldAlert className="inline w-4 h-4 mr-1" />{selected.info.issue}</p>}
          <textarea aria-label="Тайлбар" placeholder="Тайлбар (заавал биш)" value={notes} onChange={e=>setNotes(e.target.value)}
            className="w-full border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 bg-transparent text-sm" rows={2} maxLength={1200}/>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={()=>void decide('OWNER_APPROVED')}
              className="min-h-[44px] px-4 py-2 bg-emerald-700 text-white rounded-lg flex items-center gap-1 text-sm font-semibold">
              <CheckCircle2 className="w-4 h-4"/> Сонсоод зөвшөөрөх
            </button>
            <button type="button" onClick={()=>void decide('OWNER_REJECTED')}
              className="min-h-[44px] px-4 py-2 border border-red-500 text-red-700 dark:text-red-300 rounded-lg flex items-center gap-1 text-sm font-semibold">
              <XCircle className="w-4 h-4"/> Буцаах
            </button>
          </div>
        </> : <p className="text-sm text-slate-500 flex items-center gap-2"><RefreshCw className="w-4 h-4"/> Жагсаалтаас бичлэг сонго.</p>}
      </div>
    </div>
    <p className="text-[11px] text-slate-500">Нууцлал: WAV болон чиний QA шийдвэр одоохондоо энэ төхөөрөмжийн browser IndexedDB санах ойд хадгалагдана. Багцын ZIP-ийг Drive-д мастер хувилбараар хадгал. Үүнийг сургалтын аппад нийтлэх зөвшөөрөл гэж үзэхгүй.</p>
  </section>;
}
