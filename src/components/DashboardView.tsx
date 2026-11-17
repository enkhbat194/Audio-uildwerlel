import { AlertTriangle, ArrowRight, Play, ShieldAlert, Volume2 } from 'lucide-react';
import type { AppStateSnapshot, ExecutionMode } from '../shared/types';
import type { NavTabId } from './AppHeader';
import { JobStatusLabel, QaStatusLabel } from './StatusBadge';

interface DashboardViewProps {
  state: AppStateSnapshot;
  mode: ExecutionMode;
  onStartFirstFive: () => void;
  onNavigate: (tab: NavTabId) => void;
  onSwitchToMock: () => void;
}

export function DashboardView({
  state,
  mode,
  onStartFirstFive,
  onNavigate,
  onSwitchToMock,
}: DashboardViewProps) {
  const { sources, jobs, qa, runtime } = state;
  const totalCount = sources.length;

  const jobList = sources.map((s) => jobs[s.source_id]).filter(Boolean);
  const realSuccessCount = jobList.filter((j) => j.status === 'REAL_SUCCESS' && !j.is_mock).length;
  const mockCount = jobList.filter((j) => j.status === 'MOCK' && j.is_mock).length;
  const failedCount = jobList.filter(
    (j) => j.status === 'FAILED' || j.status === 'AMBIGUOUS_RETRY_REVIEW'
  ).length;
  const pendingCount = Math.max(0, totalCount - realSuccessCount - mockCount - failedCount);

  const qaValues = sources.map((s) => qa[s.source_id]?.listening_qa ?? 'QA_PENDING');
  const qaPass = qaValues.filter((v) => v === 'PASS').length;
  const qaReview = qaValues.filter((v) => v === 'REVIEW').length;
  const qaFail = qaValues.filter((v) => v === 'FAIL').length;
  const qaPending = qaValues.filter((v) => v === 'QA_PENDING').length;

  return (
    <div className="space-y-8">
      {/* Hero Summary Anchor */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 md:p-8">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
          <div className="space-y-2 max-w-2xl">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
              Эх багц {state.dataset_version} · Эхний {totalCount} өгүүлбэр · Зөвхөн дотоод үйлдвэрлэл
            </p>
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-50 text-balance">
              Чех дуудлагын WAV үйлдвэрлэлийн хяналт
            </h1>
            <p className="text-sm md:text-base text-slate-600 dark:text-slate-300 leading-relaxed">
              Эх текстийг өөрчлөхгүйгээр <span className="font-mono text-slate-800 dark:text-slate-100">{runtime.model}</span> ({runtime.voice}) ашиглан WAV файл үүсгэж, сонсож шалган, manifest-тай хадгална.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={onStartFirstFive}
              className="min-h-[48px] px-6 py-3 rounded-xl bg-sky-700 hover:bg-sky-800 dark:bg-sky-600 dark:hover:bg-sky-500 text-white font-semibold text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer whitespace-nowrap"
            >
              <Play className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>5 аудио үүсгэх</span>
            </button>
          </div>
        </div>

        {/* Cloud connection / Mock warning strip */}
        {!runtime.vertex_connected && mode === 'vertex' && (
          <div className="mt-6 pt-6 border-t border-slate-200 dark:border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <ShieldAlert className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" aria-hidden="true" />
              <div className="space-y-1 text-sm">
                <p className="font-semibold text-slate-900 dark:text-slate-100">
                  Vertex AI: ТОХИРУУЛААГҮЙ (NOT_CONNECTED)
                </p>
                <p className="text-slate-600 dark:text-slate-300">
                  AI Studio preview орчинд Cloud Run ADC эрх байхгүй тул бодит төлбөртэй TTS дуудлага хийх боломжгүй. Тохиргооны зааврыг харах эсвэл урсгал шалгахын тулд Тестийн горим (MOCK)-ийг ашиглана уу.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <button
                type="button"
                onClick={onSwitchToMock}
                className="min-h-[44px] px-4 py-2 text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer whitespace-nowrap"
              >
                Тестийн горим (MOCK) асаах
              </button>
              <button
                type="button"
                onClick={() => onNavigate('files')}
                className="min-h-[44px] px-4 py-2 text-xs font-semibold rounded-lg text-sky-700 dark:text-sky-400 hover:underline flex items-center gap-1 cursor-pointer whitespace-nowrap"
              >
                <span>Cloud Run заавар</span>
                <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            </div>
          </div>
        )}

        {mode === 'mock' && (
          <div className="mt-6 pt-6 border-t border-slate-200 dark:border-slate-800 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" aria-hidden="true" />
            <div className="text-sm space-y-1">
              <p className="font-semibold text-amber-800 dark:text-amber-300">
                Тестийн горим (MOCK) идэвхтэй байна
              </p>
              <p className="text-slate-600 dark:text-slate-300">
                Энэ горимд үүсгэсэн WAV файлууд нь зөвхөн интерфэйс, тоглуулагч, SHA256 болон ZIP экспорт шалгах синтетик дохио бөгөөд <strong className="font-semibold">бодит Vertex AI үйлдвэрлэлд тооцогдохгүй</strong>.
              </p>
            </div>
          </div>
        )}
      </section>

      {/* 4-column KPI Strip (strictly factual, tabular-nums, single-level) */}
      <section aria-label="Үндсэн үзүүлэлтүүд" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-2">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Vertex AI холболт</p>
          <p className="text-lg font-bold text-slate-900 dark:text-slate-50">
            {runtime.vertex_connected ? 'ХОЛБОГДСОН' : 'ТОХИРУУЛААГҮЙ'}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 font-mono truncate" title={runtime.project_id}>
            {runtime.project_id}
          </p>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-2">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Эхний 5 аудио явц</p>
          <p className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-50 flex items-baseline gap-2">
            <span>{realSuccessCount} / {totalCount}</span>
            <span className="text-xs font-sans font-normal text-slate-500 dark:text-slate-400">
              бодит
            </span>
          </p>
          <p className="text-xs text-slate-600 dark:text-slate-400 tabular-nums">
            Тест (MOCK): {mockCount} · Алдаа: {failedCount} · Хүлээж буй: {pendingCount}
          </p>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-2">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Сонсож шалгах (QA)</p>
          <p className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-50 flex items-baseline gap-2">
            <span>{qaPass} / {totalCount}</span>
            <span className="text-xs font-sans font-normal text-slate-500 dark:text-slate-400">
              PASS
            </span>
          </p>
          <p className="text-xs text-slate-600 dark:text-slate-400 tabular-nums">
            REVIEW: {qaReview} · FAIL: {qaFail} · Хүлээж буй: {qaPending}
          </p>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-2">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Хадгалалт ба Зардал</p>
          <p className="text-lg font-bold text-slate-900 dark:text-slate-50">
            {runtime.storage_backend === 'gcs-private-bucket'
              ? 'GCS Хувийн Bucket'
              : 'Preview Локал Диск'}
          </p>
          <p className="text-xs text-slate-600 dark:text-slate-400">
            Төлбөрийн тооцоо: {runtime.estimated_cost_label}
          </p>
        </div>
      </section>

      {/* Budget & First-5 Summary Table */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-50">
              Эхний 5 өгүүлбэрийн төлөв ({totalCount})
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Төсвийн анхааруулга: Эхний бодит гүйцэтгэл max=5 хүсэлтээр хязгаарлагдсан. Өмнөх түүхэн Dobrý den. файл хавсрагдаагүй тул тооцогдохгүй.
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('qa')}
            className="min-h-[40px] px-3 py-2 text-xs font-semibold text-sky-700 dark:text-sky-400 hover:bg-sky-50 dark:hover:bg-sky-950/50 rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
          >
            <Volume2 className="w-4 h-4" aria-hidden="true" />
            <span>QA хэсэгт сонсох</span>
          </button>
        </div>

        <div className="divide-y divide-slate-200 dark:divide-slate-800">
          {sources.map((row) => {
            const job = jobs[row.source_id];
            const qaRec = qa[row.source_id];
            const jobStatus = job?.status ?? (runtime.vertex_connected || mode === 'mock' ? 'PENDING' : 'NOT_CONNECTED');

            return (
              <div
                key={row.source_id}
                className="px-6 py-4 flex flex-col md:flex-row md:items-center justify-between gap-3 hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
              >
                <div className="space-y-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400 font-mono">
                    <span className="font-semibold text-slate-700 dark:text-slate-300">
                      {row.source_id}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>{row.lesson_id}</span>
                    {row.source_gate === 'BLOCK_DOMAIN' && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="font-sans font-semibold text-red-700 dark:text-red-400">
                          BLOCK_DOMAIN (Зөвхөн дотоод тест)
                        </span>
                      </>
                    )}
                  </div>
                  <p className="text-base font-semibold text-slate-900 dark:text-slate-50 break-words">
                    {row.cs_exact}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-4 md:gap-6 shrink-0">
                  <JobStatusLabel status={jobStatus} />
                  <QaStatusLabel status={qaRec?.listening_qa ?? 'QA_PENDING'} />
                  <span className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400 min-w-[72px] text-right">
                    {job?.duration_ms ? `${job.duration_ms} ms` : '—'}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
