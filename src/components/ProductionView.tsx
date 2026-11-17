import {
  AlertTriangle,
  Headphones,
  Pause,
  Play,
  RotateCcw,
  ShieldAlert,
  X,
} from 'lucide-react';
import { useState } from 'react';
import type {
  AudioJobReceipt,
  CloudRuntimeStatus,
  ExecutionMode,
  SourceRow,
} from '../shared/types';
import { JobStatusLabel } from './StatusBadge';

interface ProductionViewProps {
  sources: SourceRow[];
  jobs: Record<string, AudioJobReceipt>;
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
  onRunBatch: (ackPrivateTest: boolean) => void;
  onPauseBatch: () => void;
  onResetMock: () => Promise<void>;
  onGoToQa: (sourceId: string) => void;
}

export function ProductionView({
  sources,
  jobs,
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

  const queueRows = sources.slice(0, runtime.max_first_batch);
  const hasHoldFlag = queueRows.some((r) => r.source_gate === 'BLOCK_DOMAIN');
  const completedCount = queueRows.filter((r) => {
    const j = jobs[r.source_id];
    return j && (j.status === 'REAL_SUCCESS' || j.status === 'MOCK');
  }).length;
  const mockPresent = Object.values(jobs).some((j) => j.is_mock);

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
            Үйлдвэрлэл (Эхний 5 эгнээ)
          </h1>
          <p className="text-xs md:text-sm text-slate-600 dark:text-slate-400">
            Дараалал: concurrency=1 · Ижил fingerprint/SHA256 баталгаажсан мөрийг дахин дуудахгүй алгасна.
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
              <span>5 аудио үүсгэх</span>
            </button>
          )}
        </div>
      </div>

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
            Горим: {mode === 'mock' ? 'MOCK (Синтетик тест)' : runtime.vertex_connected ? 'REAL VERTEX AI' : 'NOT_CONNECTED'} · Max batch: {runtime.max_first_batch}
          </p>
        </div>
      </section>

      {/* Queue Rows */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl divide-y divide-slate-200 dark:divide-slate-800">
        {queueRows.map((row) => {
          const job = jobs[row.source_id];
          const isRunning = activeRowId === row.source_id;
          const displayStatus = isRunning
            ? 'RUNNING'
            : job?.status ?? (runtime.vertex_connected || mode === 'mock' ? 'PENDING' : 'NOT_CONNECTED');
          const playable = job && (job.status === 'MOCK' || job.status === 'REAL_SUCCESS');

          return (
            <div
              key={row.source_id}
              className="p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4"
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
                </div>

                {job?.last_error && (
                  <p className="text-xs text-red-700 dark:text-red-400 mt-1">{job.last_error}</p>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-4 shrink-0">
                <JobStatusLabel status={displayStatus} />

                {playable && (
                  <button
                    type="button"
                    onClick={() => onGoToQa(row.source_id)}
                    className="min-h-[44px] px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-800 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                  >
                    <Headphones className="w-4 h-4" aria-hidden="true" />
                    <span>Сонсох / QA</span>
                  </button>
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
                  : 'Бодит Vertex AI TTS дуудлага баталгаажуулах'}
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
                  <p className="font-semibold">Vertex AI: ТОХИРУУЛААГҮЙ (ADC олдсонгүй)</p>
                  <p>
                    Одоогийн preview орчинд Cloud Run service account эрх байхгүй тул бодит хүсэлт илгээх боломжгүй. Файлууд / Тохиргоо хуудаснаас Cloud Run зааврыг харах эсвэл дээрх горим сонгогчоос <strong>Тестийн горим (MOCK)</strong>-г сонгоно уу.
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-4 text-sm text-slate-700 dark:text-slate-300">
                <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs space-y-1 font-mono">
                  <p>Мөрийн тоо: max={queueRows.length} · Хоолой: {selectedVoice} · Хурд: Normal</p>
                  <p>
                    Горим:{' '}
                    {mode === 'mock'
                      ? 'Тестийн горим (Төлбөргүй синтетик MOCK WAV)'
                      : `Бодит Vertex AI (${runtime.project_id}) — төлбөртэй хүсэлт`}
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
                  onClick={() => onRunBatch(ackPrivateTest)}
                  className="min-h-[44px] px-5 py-2 rounded-xl bg-sky-700 hover:bg-sky-800 disabled:opacity-40 text-white text-sm font-semibold cursor-pointer"
                >
                  Багцыг эхлүүлэх
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
