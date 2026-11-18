import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Headphones,
  Lock,
  Pause,
  Play,
  RotateCcw,
  ShieldAlert,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { authedFetch, downloadAuthedFile } from '../lib/apiClient';
import type {
  AudioJobReceipt,
  CloudRuntimeStatus,
  ExecutionMode,
  SourceRow,
} from '../shared/types';
import { JobStatusLabel } from './StatusBadge';

const FIRST_PILOT_ID = 'CZ-A0-M01-L01-PH001';

interface ProductionViewProps {
  sources: SourceRow[];
  realJobs: Record<string, AudioJobReceipt>;
  mockJobs: Record<string, AudioJobReceipt>;
  mode: ExecutionMode;
  runtime: CloudRuntimeStatus;
  selectedVoice: string;
  onChangeVoice: (voice: string) => void;
  isBatchRunning: boolean;
  isBatchPaused: boolean;
  activeRowId: string | null;
  confirmModalOpen: boolean;
  onOpenConfirmModal: () => void;
  onCloseConfirmModal: () => void;
  onRunBatch: (ackPrivateTest: boolean, onlyFirstRow?: boolean) => void;
  onPauseBatch: () => void;
  onResetMock: () => Promise<void>;
  onGoToQa: (sourceId: string) => void;
}

export function ProductionView({
  sources,
  realJobs,
  mockJobs,
  mode,
  runtime,
  selectedVoice,
  onChangeVoice,
  isBatchRunning,
  isBatchPaused,
  activeRowId,
  confirmModalOpen,
  onOpenConfirmModal,
  onCloseConfirmModal,
  onRunBatch,
  onPauseBatch,
  onResetMock,
  onGoToQa,
}: ProductionViewProps) {
  const [ackPrivateTest, setAckPrivateTest] = useState(false);
  const [speedTab, setSpeedTab] = useState<'normal' | 'slow'>('normal');
  const [ph001BlobUrl, setPh001BlobUrl] = useState<string | null>(null);

  const activeJobs = mode === 'mock' ? mockJobs : realJobs;
  const queueRows = sources.slice(0, runtime.max_first_batch);

  const isFirstRealGateActive = mode === 'vertex' && !runtime.first_real_wav_verified;
  const effectiveRowsToRun = isFirstRealGateActive
    ? queueRows.filter((r) => r.source_id === FIRST_PILOT_ID)
    : queueRows;

  const hasHoldFlag = effectiveRowsToRun.some((r) => r.source_gate === 'BLOCK_DOMAIN');
  const completedCount = queueRows.filter((r) => {
    const j = activeJobs[r.source_id];
    return j && (j.status === 'REAL_SUCCESS' || j.status === 'MOCK');
  }).length;
  const mockPresent = Object.keys(mockJobs).length > 0;

  const ph001RealJob = realJobs[FIRST_PILOT_ID];
  const ph001Verified = Boolean(
    ph001RealJob && ph001RealJob.status === 'REAL_SUCCESS' && !ph001RealJob.is_mock
  );

  useEffect(() => {
    let active = true;
    let currentUrl: string | null = null;

    async function loadPh001Audio() {
      if (!ph001Verified || !ph001RealJob?.filename) {
        setPh001BlobUrl(null);
        return;
      }
      try {
        const res = await authedFetch(
          `/api/audio/real/${encodeURIComponent(ph001RealJob.filename)}?v=${encodeURIComponent(
            ph001RealJob.updated_at
          )}`
        );
        if (!res.ok) return;
        const blob = await res.blob();
        if (!active) return;
        currentUrl = URL.createObjectURL(blob);
        setPh001BlobUrl(currentUrl);
      } catch {
        // Ignore preview fetch failure
      }
    }

    void loadPh001Audio();
    return () => {
      active = false;
      if (currentUrl) URL.revokeObjectURL(currentUrl);
    };
  }, [ph001Verified, ph001RealJob?.filename, ph001RealJob?.updated_at]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
            Үйлдвэрлэл (Эхний 5 эгнээ)
          </h1>
          <p className="text-xs md:text-sm text-slate-600 dark:text-slate-400">
            Дараалал: concurrency=1 · {mode === 'mock' ? 'MOCK ба Real зам тусдаа' : 'Эхлээд PH001 — 1 бодит WAV баталгаажуулна'}.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {mockPresent && !isBatchRunning && (
            <button
              type="button"
              onClick={onResetMock}
              className="min-h-[44px] px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
            >
              <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
              <span>MOCK цэвэрлэх</span>
            </button>
          )}

          {isBatchRunning ? (
            <button
              type="button"
              onClick={onPauseBatch}
              className="min-h-[44px] px-5 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-sm font-semibold flex items-center gap-2 cursor-pointer whitespace-nowrap"
            >
              <Pause className="w-4 h-4" aria-hidden="true" />
              <span>{isBatchPaused ? 'Түр зогсоосон' : 'Түр зогсоох'}</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                setAckPrivateTest(false);
                onOpenConfirmModal();
              }}
              className="min-h-[44px] px-5 py-2.5 rounded-xl bg-sky-700 hover:bg-sky-800 dark:bg-sky-600 dark:hover:bg-sky-500 text-white text-sm font-semibold flex items-center gap-2 cursor-pointer whitespace-nowrap"
            >
              <Play className="w-4 h-4" aria-hidden="true" />
              <span>
                {isFirstRealGateActive
                  ? '1 бодит WAV (PH001) үүсгэх'
                  : mode === 'mock'
                  ? 'MOCK 5 аудио үүсгэх'
                  : 'Үлдсэн бодит WAV үүсгэх'}
              </span>
            </button>
          )}
        </div>
      </div>

      {/* Verified PH001 Real WAV Inspection Card */}
      {ph001Verified && ph001RealJob && (
        <section className="bg-emerald-50/70 dark:bg-emerald-950/25 border border-emerald-200 dark:border-emerald-900 rounded-2xl p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <CheckCircle2 className="w-5 h-5 text-emerald-700 dark:text-emerald-400 shrink-0 mt-0.5" />
              <div>
                <h2 className="text-sm font-bold text-emerald-950 dark:text-emerald-200">
                  PH001 — Dobrý den. (Эхний бодит WAV баталгаажлаа)
                </h2>
                <p className="text-xs font-mono text-emerald-800 dark:text-emerald-300 mt-0.5 tabular-nums">
                  HTTP {ph001RealJob.http_status} · {ph001RealJob.duration_ms} ms ·{' '}
                  {ph001RealJob.file_size ? `${(ph001RealJob.file_size / 1024).toFixed(1)} KB` : '—'} ·{' '}
                  {ph001RealJob.storage_ref}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() =>
                void downloadAuthedFile(
                  `/api/audio/real/${encodeURIComponent(ph001RealJob.filename)}`,
                  ph001RealJob.filename
                )
              }
              className="min-h-[40px] px-3.5 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer self-start sm:self-auto"
            >
              <Download className="w-3.5 h-3.5" aria-hidden="true" />
              <span>PH001 WAV татах</span>
            </button>
          </div>

          <p className="text-xs font-mono text-emerald-900 dark:text-emerald-300 break-all">
            SHA256: {ph001RealJob.audio_sha256}
          </p>

          {ph001BlobUrl && <audio controls src={ph001BlobUrl} className="w-full" />}
        </section>
      )}

      {/* Voice & Speed Profile Settings Panel */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 grid grid-cols-1 md:grid-cols-3 gap-5">
        <div>
          <label htmlFor="voice-select" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
            Дуу хоолой (Voice)
          </label>
          <select
            id="voice-select"
            value={selectedVoice}
            onChange={(e) => onChangeVoice(e.target.value)}
            className="w-full min-h-[44px] px-3 py-2 text-sm bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-600"
          >
            <option value="Achernar">Achernar (Үндсэн туршилтын хоолой)</option>
          </select>
        </div>

        <div>
          <span className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
            Хурдны горим (Speed Profile)
          </span>
          <div role="group" aria-label="Хурдны горим" className="inline-flex w-full p-1 bg-slate-100 dark:bg-slate-800 rounded-xl">
            <button
              type="button"
              onClick={() => setSpeedTab('normal')}
              className={`flex-1 min-h-[36px] px-3 py-1.5 text-xs font-semibold rounded-lg cursor-pointer ${
                speedTab === 'normal'
                  ? 'bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-50 shadow-sm'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              Normal (Идэвхтэй)
            </button>
            <button
              type="button"
              onClick={() => setSpeedTab('slow')}
              className={`flex-1 min-h-[36px] px-3 py-1.5 text-xs font-semibold rounded-lg cursor-pointer ${
                speedTab === 'slow'
                  ? 'bg-white dark:bg-slate-950 text-amber-700 dark:text-amber-400 shadow-sm'
                  : 'text-slate-500 dark:text-slate-400'
              }`}
            >
              Slow (Түр хаалттай)
            </button>
          </div>
          {speedTab === 'slow' && (
            <p className="text-xs text-amber-700 dark:text-amber-400 mt-2">
              Баталгаажсан prompt болон пилот тест хийгдээгүй тул Slow экспорт хэрэгжүүлээгүй. Энгийн аудиог дижиталаар удаашруулж хадгалахгүй.
            </p>
          )}
        </div>

        <div>
          <span className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
            Багцын явц ({completedCount} / {queueRows.length})
          </span>
          <div className="w-full h-2.5 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden mt-3">
            <div
              className={`h-full transition-all duration-150 ${
                mode === 'mock' ? 'bg-amber-500' : 'bg-sky-600'
              }`}
              style={{ width: `${Math.round((completedCount / Math.max(1, queueRows.length)) * 100)}%` }}
            />
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-2 font-mono tabular-nums">
            Горим: {mode === 'mock' ? 'MOCK (Тусгаарлагдсан)' : runtime.vertex_connected ? 'REAL VERTEX AI' : 'NOT_CONNECTED'} · Max batch: {runtime.max_first_batch}
          </p>
        </div>
      </section>

      {/* Queue Rows */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl divide-y divide-slate-200 dark:divide-slate-800">
        {queueRows.map((row) => {
          const job = activeJobs[row.source_id];
          const isRunning = activeRowId === row.source_id;
          const lockedBehindPh001 = isFirstRealGateActive && row.source_id !== FIRST_PILOT_ID;
          const displayStatus = isRunning
            ? 'RUNNING'
            : job?.status ?? (runtime.vertex_connected || mode === 'mock' ? 'PENDING' : 'NOT_CONNECTED');
          const playable = job && (job.status === 'MOCK' || job.status === 'REAL_SUCCESS');

          return (
            <div
              key={row.source_id}
              className={`p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4 ${
                lockedBehindPh001 ? 'opacity-70' : ''
              }`}
            >
              <div className="space-y-1.5 min-w-0">
                <div className="flex flex-wrap items-center gap-2 text-xs font-mono text-slate-500 dark:text-slate-400">
                  <span className="font-semibold text-slate-800 dark:text-slate-200">{row.source_id}</span>
                  <span aria-hidden="true">·</span>
                  <span>#{row.pilot_order}</span>
                  {row.source_gate === 'BLOCK_DOMAIN' && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="font-sans font-semibold text-red-700 dark:text-red-400">
                        BLOCK_DOMAIN (Дотоод тест)
                      </span>
                    </>
                  )}
                  {lockedBehindPh001 && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="font-sans font-semibold text-slate-600 dark:text-slate-400 inline-flex items-center gap-1">
                        <Lock className="w-3 h-3" aria-hidden="true" />
                        <span>PH001 эхэлж баталгаажуулна</span>
                      </span>
                    </>
                  )}
                  {job?.stale && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="font-sans font-semibold text-amber-700 dark:text-amber-400">
                        Эх өөрчлөгдсөн (хуучин fingerprint)
                      </span>
                    </>
                  )}
                </div>

                <p className="text-lg font-semibold text-slate-900 dark:text-slate-50">{row.cs_exact}</p>

                <div className="flex flex-wrap items-center gap-3 text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
                  <span>HTTP: {job?.http_status ?? '—'}</span>
                  <span aria-hidden="true">·</span>
                  <span>Оролдлого: {job?.attempts ?? 0}</span>
                  <span aria-hidden="true">·</span>
                  <span>Хугацаа: {job?.duration_ms ? `${job.duration_ms} ms` : '—'}</span>
                  {job?.file_size && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>{(job.file_size / 1024).toFixed(1)} KB</span>
                    </>
                  )}
                </div>

                {job?.last_error && (
                  <p className="text-xs text-red-700 dark:text-red-400 mt-1">{job.last_error}</p>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-3 shrink-0">
                <JobStatusLabel status={displayStatus} />

                {playable && job && (
                  <>
                    <button
                      type="button"
                      onClick={() =>
                        void downloadAuthedFile(
                          `/api/audio/${job.is_mock ? 'mock' : 'real'}/${encodeURIComponent(
                            job.filename
                          )}`,
                          job.filename
                        )
                      }
                      className="min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                    >
                      <Download className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Татах</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onGoToQa(row.source_id)}
                      className="min-h-[44px] px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-800 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                    >
                      <Headphones className="w-4 h-4" aria-hidden="true" />
                      <span>Сонсох / QA</span>
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </section>

      {/* Pre-execution Confirmation & PH006 BLOCK_DOMAIN Acknowledgement Modal */}
      {confirmModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="batch-confirm-title"
          className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4"
        >
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-lg w-full p-6 space-y-5 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <h2 id="batch-confirm-title" className="text-lg font-bold text-slate-900 dark:text-slate-50">
                {mode === 'mock'
                  ? 'Тестийн (MOCK) 5 WAV үүсгэх баталгаажуулалт'
                  : isFirstRealGateActive
                  ? 'Эхний 1 бодит WAV (PH001 — Dobrý den.) баталгаажуулах'
                  : 'Үлдсэн бодит Vertex AI TTS дуудлага баталгаажуулах'}
              </h2>
              <button
                type="button"
                onClick={onCloseConfirmModal}
                aria-label="Цонх хаах"
                className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {mode === 'vertex' && !runtime.vertex_connected ? (
              <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 flex items-start gap-3">
                <ShieldAlert className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" aria-hidden="true" />
                <div className="text-xs md:text-sm text-amber-950 dark:text-amber-200 space-y-1.5">
                  <p className="font-semibold">Vertex AI: ТОХИРУУЛААГҮЙ (ADC / IAM эрх баталгаажаагүй)</p>
                  <p>
                    {runtime.adc_error ??
                      'Одоогийн орчинд project-a699c3ff-995a-4b88-add төслийн service account болон aiplatform.endpoints.predict эрх баталгаажаагүй тул бодит хүсэлт илгээхгүй.'}
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-4 text-sm text-slate-700 dark:text-slate-300">
                <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs space-y-1 font-mono">
                  <p>
                    Мөрийн тоо: {effectiveRowsToRun.length} · Хоолой: {selectedVoice} · Хурд: Normal
                  </p>
                  <p>
                    Горим:{' '}
                    {mode === 'mock'
                      ? 'Тестийн горим (Төлбөргүй синтетик MOCK WAV, бодит санд нөлөөлөхгүй)'
                      : isFirstRealGateActive
                      ? `Бодит Vertex AI (${runtime.project_id}) — эхлээд зөвхөн PH001 (1 дуудлага)`
                      : `Бодит Vertex AI (${runtime.project_id}) — PH001 баталгаажсан тул үлдсэн мөрүүд`}
                  </p>
                </div>

                {hasHoldFlag && (
                  <div className="p-4 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 space-y-3">
                    <div className="flex items-start gap-2.5 text-red-900 dark:text-red-200 text-xs">
                      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                      <p>
                        <strong>PH006 (Můžete to prosím zopakovat?)</strong> нь <span className="font-mono">BLOCK_DOMAIN</span> тугтай. Нийтлэлд гаргахгүй, зөвхөн дотоод инженерийн туршилтад ашиглана.
                      </p>
                    </div>
                    <label className="flex items-start gap-2.5 text-xs text-slate-900 dark:text-slate-100 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={ackPrivateTest}
                        onChange={(e) => setAckPrivateTest(e.target.checked)}
                        className="mt-0.5 w-4 h-4 rounded border-red-400 text-red-600 focus:ring-red-600"
                      />
                      <span>
                        PH006 болон эхний 5 мөрийг зөвхөн дотоод хувийн туршилтад (private pilot) үүсгэж, нийтлэхгүй гэдгийг баталж байна.
                      </span>
                    </label>
                  </div>
                )}
              </div>
            )}

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={onCloseConfirmModal}
                className="min-h-[44px] px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-medium text-slate-700 dark:text-slate-300 cursor-pointer"
              >
                Хаах
              </button>
              {!(mode === 'vertex' && !runtime.vertex_connected) && (
                <button
                  type="button"
                  disabled={hasHoldFlag && !ackPrivateTest}
                  onClick={() => onRunBatch(ackPrivateTest, isFirstRealGateActive)}
                  className="min-h-[44px] px-5 py-2 rounded-xl bg-sky-700 hover:bg-sky-800 disabled:opacity-40 text-white text-sm font-semibold cursor-pointer"
                >
                  {isFirstRealGateActive ? 'PH001 (1 WAV) эхлүүлэх' : 'Багцыг эхлүүлэх'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
