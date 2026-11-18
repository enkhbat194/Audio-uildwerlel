import { useState } from 'react';
import { CANONICAL_DATASET_VERSION, SEED_FIRST_FIVE_ROWS, SPEECH_STYLE_PROFILES } from './shared/sourceRegistry';

type ConnectionState = 'idle' | 'checking' | 'ok' | 'error';
type PreviewTab = 'overview' | 'sources' | 'styles';

const TABS: { id: PreviewTab; label: string }[] = [
  { id: 'overview', label: 'Төлөв' },
  { id: 'sources', label: 'Эх өгүүлбэр' },
  { id: 'styles', label: 'Дууны хэв маяг' },
];

/**
 * The Render Free PoC is a fully isolated static client.
 * Crucially, this component neither imports the production App nor initializes
 * Firebase, Google OAuth/Drive, Firestore or any paid audio API.
 */
export default function FreeHostingPreview() {
  const [tab, setTab] = useState<PreviewTab>('overview');
  const [health, setHealth] = useState<ConnectionState>('idle');

  async function verifyHealth() {
    setHealth('checking');
    try {
      const res = await fetch('/api/health', { cache: 'no-store' });
      if (!res.ok) throw new Error('health request failed');
      const data = (await res.json()) as { ok?: boolean; auth_required?: boolean };
      setHealth(data.ok === true && data.auth_required === true ? 'ok' : 'error');
    } catch {
      setHealth('error');
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 pb-12">
      <header className="sticky top-0 z-20 bg-white/95 border-b border-slate-200 backdrop-blur-sm">
        <div className="max-w-4xl mx-auto px-4 h-16 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="font-bold text-sm sm:text-base truncate">Ahoj Česko — Audio Factory</div>
            <div className="text-xs text-slate-500">Render Free · Туршилтын хувилбар</div>
          </div>
          <span className="text-[11px] font-semibold tracking-wide text-amber-900 bg-amber-100 px-2.5 py-1.5 rounded-lg whitespace-nowrap">READ ONLY</span>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-6 space-y-5">
        <section className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-7 space-y-3">
          <h1 className="text-xl sm:text-2xl font-bold">Туршилтын сервер ажиллаж байна</h1>
          <p className="text-sm leading-6 text-slate-700">
            Энэ бол зөвхөн GitHub-аас Render Free рүү байршуулсан, <strong>өгөгдөл өөрчилдөггүй</strong> урьдчилан харах хувилбар.
            Бодит Vertex AI аудио үүсгэх, Firestore бичих, Google Drive руу файл хуулах үйлдэл энд ажиллахгүй.
          </p>
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="bg-emerald-50 text-emerald-800 rounded-lg px-2.5 py-1.5">Production-д хүрэхгүй</span>
            <span className="bg-slate-100 text-slate-700 rounded-lg px-2.5 py-1.5">Нууц түлхүүргүй</span>
            <span className="bg-slate-100 text-slate-700 rounded-lg px-2.5 py-1.5">Дуу үйлдвэрлэхгүй</span>
          </div>
        </section>

        <nav aria-label="Туршилтын хэсэг" className="flex gap-1 bg-slate-200/60 rounded-xl p-1">
          {TABS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              aria-current={tab === id ? 'page' : undefined}
              className={`flex-1 min-h-11 px-2 rounded-lg text-xs sm:text-sm font-semibold transition-colors ${tab === id ? 'bg-white text-sky-800 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
            >
              {label}
            </button>
          ))}
        </nav>

        {tab === 'overview' && (
          <section className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-7 space-y-4">
            <h2 className="text-lg font-bold">Серверийн холболтын шалгалт</h2>
            <p className="text-sm leading-6 text-slate-600">
              Шалгах товч нь зөвхөн <code className="bg-slate-100 px-1.5 rounded">GET /api/health</code> хүсэлт илгээнэ.
              Төлбөртэй TTS, Drive, Firestore ашиглахгүй.
            </p>
            <button
              type="button"
              disabled={health === 'checking'}
              onClick={() => void verifyHealth()}
              className="min-h-11 bg-sky-700 hover:bg-sky-800 disabled:opacity-50 text-white px-5 py-2 rounded-xl font-semibold text-sm"
            >
              {health === 'checking' ? 'Шалгаж байна…' : 'Сервер шалгах'}
            </button>
            {health === 'ok' && <p role="status" className="text-sm font-semibold text-emerald-700">HTTP health OK — сервер хариулж байна. Бодит TTS холбогдсон гэсэн үг биш.</p>}
            {health === 'error' && <p role="alert" className="text-sm font-semibold text-red-700">Health шалгалт амжилтгүй. Render Logs хэсгийг шалгах шаардлагатай.</p>}
            <div className="border-t border-slate-200 pt-4 text-sm text-slate-600 space-y-1">
              <p>Source dataset: <code>{CANONICAL_DATASET_VERSION}</code> — өөрчлөгдөөгүй</p>
              <p>Кодонд бэлэн: Natural / Learning Slow</p>
              <p>Production аудио: Google Cloud Run дээр хэвээр</p>
            </div>
          </section>
        )}

        {tab === 'sources' && (
          <section className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-7 space-y-3">
            <h2 className="text-lg font-bold">Эхний 5 canonical мөр</h2>
            <p className="text-xs text-slate-600">Энэ нь зөвхөн кодод хадгалсан сургалтын текстийн харагдац; үйлдвэрлэлийн WAV жагсаалт биш.</p>
            <div className="divide-y divide-slate-100">
              {SEED_FIRST_FIVE_ROWS.map((row) => (
                <div key={row.source_id} className="py-3 space-y-1">
                  <div className="text-xs font-mono text-slate-500">{row.source_id}</div>
                  <div className="font-semibold text-base">{row.cs_exact}</div>
                  {row.source_gate === 'BLOCK_DOMAIN' && (
                    <div className="text-xs font-semibold text-amber-700">BLOCK_DOMAIN — нийтлэх хориотой</div>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {tab === 'styles' && (
          <section className="space-y-3">
            <h2 className="text-lg font-bold px-1">TTS хэв маяг (кодын тохиргоо)</h2>
            {Object.values(SPEECH_STYLE_PROFILES).map((style) => (
              <article key={style.id} className="bg-white rounded-2xl border border-slate-200 p-5 space-y-2">
                <div className="font-bold">{style.label_mn} <span className="text-xs font-mono font-normal text-slate-500">{style.style_version}</span></div>
                <p className="text-sm text-slate-700">{style.description_mn}</p>
                <p className="text-xs text-slate-500 leading-5">{style.style_prompt}</p>
              </article>
            ))}
            <p className="text-sm text-amber-800 px-1">
              Энд сонсох WAV байхгүй. Шинэ хэв маягийн бодит дуудлагыг Cloud Run талд тусад нь үйлдвэрлэж, QA PASS болгосны дараа ашиглана.
            </p>
          </section>
        )}
      </main>
    </div>
  );
}
