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
  Sparkles,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { authedFetch, downloadAuthedFile } from '../lib/apiClient';
import {
  SPEECH_STYLE_PROFILES,
  getQaForJob,
  getVariantKey,
} from '../shared/sourceRegistry';
import type {
  AudioJobReceipt,
  CloudRuntimeStatus,
  ExecutionMode,
  QaRecord,
  SourceRow,
  SpeechStyle,
} from '../shared/types';
import { JobStatusLabel, QaStatusLabel } from './StatusBadge';

const FIRST_PILOT_ID = 'CZ-A0-M01-L01-PH001';

interface ProductionViewProps {
  sources: SourceRow[];
  realJobs: Record<string, AudioJobReceipt>;
  mockJobs: Record<string, AudioJobReceipt>;
  qa: Record<string, QaRecord>;
  mode: ExecutionMode;
  runtime: CloudRuntimeStatus;
  selectedVoice: string;
  onChangeVoice: (voice: string) => void;
  selectedSpeechStyle: SpeechStyle;
  onChangeSpeechStyle: (style: SpeechStyle) => void;
  isBatchRunning: boolean;
  isBatchPaused: boolean;
  activeRowId: string | null;
  confirmModalOpen: boolean;
  onOpenConfirmModal: () => void;
  onCloseConfirmModal: () => void;
  onRunBatch: (ackPrivateTest: boolean, onlyFirstRow?: boolean) => void;
  onGeneratePh001Variant: (style: SpeechStyle) => Promise<void>;
  onPauseBatch: () => void;
  onResetMock: () => Promise<void>;
  onGoToQa: (sourceId: string, style?: SpeechStyle) => void;
}

function useAuthedAudioBlobUrl(job: AudioJobReceipt | undefined) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const ready = Boolean(
    job &&
      ((job.is_mock && job.status === 'MOCK') || (!job.is_mock && job.status === 'REAL_SUCCESS'))
  );

  useEffect(() => {
    let active = true;
    let currentUrl: string | null = null;
    setBlobUrl(null);

    async function load() {
      if (!ready || !job?.filename) return;
      try {
        const scope = job.is_mock ? 'mock' : 'real';
        const res = await authedFetch(
          `/api/audio/${scope}/${encodeURIComponent(job.filename)}?v=${encodeURIComponent(
            job.updated_at
          )}`
        );
        if (!res.ok) return;
        const blob = await res.blob();
        if (!active) return;
        currentUrl = URL.createObjectURL(blob);
        setBlobUrl(currentUrl);
      } catch {
        // Ignore transient preview audio load failure
      }
    }

    void load();
    return () => {
      active = false;
      if (currentUrl) URL.revokeObjectURL(currentUrl);
    };
  }, [ready, job?.is_mock, job?.filename, job?.updated_at]);

  return blobUrl;
}

interface Ph001VariantCardProps {
  title: string;
  subtitle: string;
  job: AudioJobReceipt | undefined;
  qaMap: Record<string, QaRecord>;
  style?: SpeechStyle;
  isLegacy?: boolean;
  canGenerate: boolean;
  isBusy: boolean;
  onGenerate?: () => void;
  onGoToQa: (sourceId: string, style?: SpeechStyle) => void;
}

function Ph001VariantCard({
  title,
  subtitle,
  job,
  qaMap,
  style,
  isLegacy = false,
  canGenerate,
  isBusy,
  onGenerate,
  onGoToQa,
}: Ph001VariantCardProps) {
  const playable = Boolean(
    job &&
      ((job.is_mock && job.status === 'MOCK') || (!job.is_mock && job.status === 'REAL_SUCCESS'))
  );
  const audioUrl = useAuthedAudioBlobUrl(playable ? job : undefined);
  const qaRec = job ? getQaForJob(qaMap, job) : undefined;
  const scope = job?.is_mock ? 'mock' : 'real';

  return (
    <div
      className={`rounded-xl border p-4 space-y-3 ${
        playable
          ? 'bg-white dark:bg-slate-900 border-emerald-200 dark:border-emerald-900/70'
          : 'bg-slate-50/80 dark:bg-slate-950/60 border-slate-200 dark:border-slate-800'
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold text-slate-900 dark:text-slate-50">{title}</h3>
          <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-0.5">{subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          {qaRec && <QaStatusLabel status={qaRec.listening_qa} />}
          <JobStatusLabel status={job?.status ?? 'PENDING'} />
        </div>
      </div>

      {playable && job ? (
        <div className="space-y-2.5">
          {audioUrl && (
            <audio
              controls
              src={audioUrl}
              aria-label={`${title} audio player`}
              className="w-full"
            />
          )}
          <div className="text-[11px] font-mono text-slate-600 dark:text-slate-400 space-y-0.5 tabular-nums">
            <p>
              {job.duration_ms ?? '—'} ms ·{' '}
              {job.file_size ? `${(job.file_size / 1024).toFixed(1)} KB` : '—'} · HTTP{' '}
              {job.http_status ?? 'MOCK'}
            </p>
            <p className="truncate" title={job.filename}>
              Файл: {job.filename}
            </p>
            <p className="truncate" title={job.gcs_object_path ?? job.storage_ref ?? undefined}>
              Хадгалалт: {job.gcs_object_path ?? job.storage_ref}
            </p>
            {job.audio_sha256 && (
              <p className="truncate" title={job.audio_sha256}>
                SHA256: {job.audio_sha256.slice(0, 18)}…
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            {!isLegacy && onGenerate && (
              <button
                type="button"
                disabled={!canGenerate || isBusy}
                onClick={onGenerate}
                className="min-h-[38px] px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 cursor-pointer"
              >
                Дахин үүсгэх
              </button>
            )}
            <button
              type="button"
              onClick={() =>
                void downloadAuthedFile(
                  `/api/audio/${scope}/${encodeURIComponent(job.filename)}`,
                  job.filename
                )
              }
              className="min-h-[38px] px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Татах</span>
            </button>
            <button
              type="button"
              onClick={() => onGoToQa(FIRST_PILOT_ID, style)}
              className="min-h-[38px] px-3 py-1.5 rounded-lg bg-sky-700 hover:bg-sky-800 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Headphones className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Сонсох / QA</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-2.5 pt-1">
          {job?.last_error && (
            <p className="text-xs text-red-700 dark:text-red-400">{job.last_error}</p>
          )}
          {!isLegacy && onGenerate && (
            <button
              type="button"
              disabled={!canGenerate || isBusy}
              onClick={onGenerate}
              className="min-h-[42px] w-full px-4 py-2 rounded-xl bg-sky-700 hover:bg-sky-800 disabled:opacity-40 text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <Play className="w-3.5 h-3.5" aria-hidden="true" />
              <span>{title} · Зөвхөн PH001 үүсгэх</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function ProductionView({
  sources,
  realJobs,
  mockJobs,
  qa,
  mode,
  runtime,
  selectedVoice,
  onChangeVoice,
  selectedSpeechStyle,
  onChangeSpeechStyle,
  isBatchRunning,
  isBatchPaused,
  activeRowId,
  confirmModalOpen,
  onOpenConfirmModal,
  onCloseConfirmModal,
  onRunBatch,
  onGeneratePh001Variant,
  onPauseBatch,
  onResetMock,
  onGoToQa,
}: ProductionViewProps) {
  const [ackPrivateTest, setAckPrivateTest] = useState(false);

  const activeJobs = mode === 'mock' ? mockJobs : realJobs;
  const queueRows = sources.slice(0, runtime.max_first_batch);

  const isFirstRealGateActive = mode === 'vertex' && !runtime.first_real_wav_verified;
  const effectiveRowsToRun = isFirstRealGateActive
    ? queueRows.filter((r) => r.source_id === FIRST_PILOT_ID)
    : queueRows;

  const hasHoldFlag = effectiveRowsToRun.some((r) => r.source_gate === 'BLOCK_DOMAIN');
  const completedCount = queueRows.filter((r) => {
    const j = activeJobs[getVariantKey(r.source_id, selectedSpeechStyle)];
    return j && (j.status === 'REAL_SUCCESS' || j.status === 'MOCK');
  }).length;
  const mockPresent = Object.keys(mockJobs).length > 0;

  const activeStyleDef = SPEECH_STYLE_PROFILES[selectedSpeechStyle];
  const ph001NaturalJob = activeJobs[getVariantKey(FIRST_PILOT_ID, 'natural')];
  const ph001SlowJob = activeJobs[getVariantKey(FIRST_PILOT_ID, 'learning_slow')];
  const ph001LegacyJob = activeJobs[FIRST_PILOT_ID];

  const vertexReadyForReal =
    runtime.vertex_connected &&
    runtime.storage_backend === 'gcs-private-bucket' &&
    runtime.gcs_permission_verified;
  const canGeneratePh001Now = mode === 'mock' || vertexReadyForReal;

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
            Үйлдвэрлэл (Эхний 5 эгнээ)
          </h1>
          <p className="text-xs md:text-sm text-slate-600 dark:text-slate-400">
            Ярианы хэв маяг: <span className="font-semibold">{activeStyleDef.short_label} ({activeStyleDef.style_version})</span> ·{' '}
            {mode === 'mock'
              ? 'MOCK ба Real зам тусдаа'
              : 'Эхлээд PH001 — Natural / Learning Slow тус тусад нь туршина'}
            .
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
                  ? `PH001 · ${activeStyleDef.short_label} (1 WAV) үүсгэх`
                  : mode === 'mock'
                  ? `MOCK 5 (${activeStyleDef.short_label}) үүсгэх`
                  : `Үлдсэн мөр · ${activeStyleDef.short_label}`}
              </span>
            </button>
          )}
        </div>
      </div>

      {/* Voice & Speech Style Profile Selector Panel */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          <div>
            <label
              htmlFor="voice-select"
              className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5"
            >
              Загвар ба Дуу хоолой (Model / Voice)
            </label>
            <select
              id="voice-select"
              value={selectedVoice}
              onChange={(e) => onChangeVoice(e.target.value)}
              className="w-full min-h-[44px] px-3 py-2 text-sm bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-600"
            >
              <option value="Achernar">gemini-3.8-flash-tts · Achernar</option>
            </select>
          </div>

          <div>
            <span className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
              Ярианы хэв маяг (speechMetadata.style)
            </span>
            <div
              role="group"
              aria-label="Ярианы хэв маяг"
              className="inline-flex w-full p-1 bg-slate-100 dark:bg-slate-800 rounded-xl gap-1"
            >
              {(['natural', 'learning_slow'] as SpeechStyle[]).map((styleKey) => {
                const def = SPEECH_STYLE_PROFILES[styleKey];
                const selected = selectedSpeechStyle === styleKey;
                return (
                  <button
                    key={styleKey}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => onChangeSpeechStyle(styleKey)}
                    className={`flex-1 min-h-[36px] px-3 py-1.5 text-xs font-semibold rounded-lg cursor-pointer transition-colors ${
                      selected
                        ? 'bg-white dark:bg-slate-950 text-sky-900 dark:text-sky-200 shadow-sm'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                    }`}
                  >
                    {def.short_label}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <span className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
              {activeStyleDef.short_label} багцын явц ({completedCount} / {queueRows.length})
            </span>
            <div className="w-full h-2.5 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden mt-3">
              <div
                className={`h-full transition-all duration-150 ${
                  mode === 'mock' ? 'bg-amber-500' : 'bg-sky-600'
                }`}
                style={{
                  width: `${Math.round((completedCount / Math.max(1, queueRows.length)) * 100)}%`,
                }}
              />
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-2 font-mono tabular-nums">
              Горим: {mode === 'mock' ? 'MOCK (Тусгаарлагдсан)' : runtime.vertex_connected ? 'REAL VERTEX AI' : 'NOT_CONNECTED'} · Style: {activeStyleDef.style_version}
            </p>
          </div>
        </div>

        {/* Active speechMetadata.style prompt preview */}
        <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-1">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="font-semibold text-slate-800 dark:text-slate-200">
              {activeStyleDef.label_mn}
            </span>
            <span className="font-mono text-slate-500 dark:text-slate-400">
              style=&quot;{selectedSpeechStyle}&quot; · {activeStyleDef.style_version}
            </span>
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-400">{activeStyleDef.description_mn}</p>
          <p className="text-[11px] font-mono text-slate-500 dark:text-slate-400 break-words">
            speechMetadata.style: &quot;{activeStyleDef.style_prompt}&quot;
          </p>
        </div>
      </section>

      {/* PH001 Side-by-Side Voice Quality Comparison Workbench */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-start gap-2.5">
            <Sparkles className="w-5 h-5 text-sky-700 dark:text-sky-400 shrink-0 mt-0.5" aria-hidden="true" />
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-slate-50">
                PH001 — Dobrý den. (Natural / Learning Slow харьцуулалт)
              </h2>
              <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                Эхлээд зөвхөн PH001 дээр хоёр хувилбарыг тус тусад нь үүсгэж сонсоод харьцуулна. Үлдсэн 4 өгүүлбэрийг автоматаар үүсгэхгүй, өмнөх PH001 WAV файлыг устгахгүй.
              </p>
            </div>
          </div>
          {mode === 'vertex' && !vertexReadyForReal && (
            <span className="text-xs font-mono text-amber-700 dark:text-amber-400 shrink-0">
              Preview орчин · Бодит TTS хаалттай
            </span>
          )}
        </div>

        <div
          className={`grid grid-cols-1 ${
            ph001LegacyJob ? 'lg:grid-cols-3' : 'md:grid-cols-2'
          } gap-4`}
        >
          <Ph001VariantCard
            title="1. Natural (v1)"
            subtitle="Өдөр тутмын уугуул чех харилцан ярианы дулаан, амьд хэмнэл."
            job={ph001NaturalJob}
            qaMap={qa}
            style="natural"
            canGenerate={canGeneratePh001Now}
            isBusy={isBatchRunning}
            onGenerate={() => void onGeneratePh001Variant('natural')}
            onGoToQa={onGoToQa}
          />

          <Ph001VariantCard
            title="2. Learning Slow (v1)"
            subtitle="Анхан шатны суралцагчид зориулсан тайван, тод, холбоотой удаан хэллэг."
            job={ph001SlowJob}
            qaMap={qa}
            style="learning_slow"
            canGenerate={canGeneratePh001Now}
            isBusy={isBatchRunning}
            onGenerate={() => void onGeneratePh001Variant('learning_slow')}
            onGoToQa={onGoToQa}
          />

          {ph001LegacyJob && (
            <Ph001VariantCard
              title="Анхны PH001 (Legacy)"
              subtitle="Хуучин PH001 файл хадгалагдсан (устгахгүй, дарж бичихгүй)."
              job={ph001LegacyJob}
              qaMap={qa}
              isLegacy
              canGenerate={false}
              isBusy={isBatchRunning}
              onGoToQa={onGoToQa}
            />
          )}
        </div>
      </section>

      {/* Queue Rows */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl divide-y divide-slate-200 dark:divide-slate-800">
        {queueRows.map((row) => {
          const variantKey = getVariantKey(row.source_id, selectedSpeechStyle);
          const job = activeJobs[variantKey];
          const naturalJob = activeJobs[getVariantKey(row.source_id, 'natural')];
          const slowJob = activeJobs[getVariantKey(row.source_id, 'learning_slow')];
          const isRunning = activeRowId === row.source_id;
          const lockedBehindPh001 = isFirstRealGateActive && row.source_id !== FIRST_PILOT_ID;
          const displayStatus = isRunning
            ? 'RUNNING'
            : job?.status ??
              (runtime.vertex_connected || mode === 'mock' ? 'PENDING' : 'NOT_CONNECTED');
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
                  <span className="font-semibold text-slate-800 dark:text-slate-200">
                    {row.source_id}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>#{row.pilot_order}</span>
                  <span aria-hidden="true">·</span>
                  <span className="text-sky-700 dark:text-sky-400">
                    {activeStyleDef.short_label} ({activeStyleDef.style_version})
                  </span>
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

                <p className="text-lg font-semibold text-slate-900 dark:text-slate-50">
                  {row.cs_exact}
                </p>

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
                  {(naturalJob || slowJob) && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>
                        Хувилбар: {naturalJob ? 'Natural✓' : 'Natural—'} /{' '}
                        {slowJob ? 'Slow✓' : 'Slow—'}
                      </span>
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
                      onClick={() => onGoToQa(row.source_id, selectedSpeechStyle)}
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
              <h2
                id="batch-confirm-title"
                className="text-lg font-bold text-slate-900 dark:text-slate-50"
              >
                {mode === 'mock'
                  ? `Тестийн (MOCK) · ${activeStyleDef.short_label} багц`
                  : isFirstRealGateActive
                  ? `PH001 — Dobrý den. (${activeStyleDef.short_label}) баталгаажуулах`
                  : `Үлдсэн бодит Vertex AI TTS (${activeStyleDef.short_label})`}
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

            {mode === 'vertex' && (!runtime.vertex_connected || runtime.storage_backend !== 'gcs-private-bucket') ? (
              <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 flex items-start gap-3">
                <ShieldAlert
                  className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5"
                  aria-hidden="true"
                />
                <div className="text-xs md:text-sm text-amber-950 dark:text-amber-200 space-y-1.5">
                  <p className="font-semibold">
                    Vertex AI эсвэл бат бөх GCS хадгалалт баталгаажаагүй
                  </p>
                  <p>
                    {runtime.adc_error ??
                      runtime.gcs_error ??
                      'Одоогийн орчинд project-a699c3ff-995a-4b88-add төслийн service account болон GCS_BUCKET_NAME эрх баталгаажаагүй тул төлбөртэй хүсэлт илгээхгүй.'}
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-4 text-sm text-slate-700 dark:text-slate-300">
                <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs space-y-1.5 font-mono">
                  <p>
                    Мөрийн тоо: {effectiveRowsToRun.length} · Хоолой: {selectedVoice} · Хэв маяг:{' '}
                    {activeStyleDef.short_label} ({activeStyleDef.style_version})
                  </p>
                  <p className="text-[11px] text-slate-600 dark:text-slate-400 break-words">
                    speechMetadata.style: &quot;{activeStyleDef.style_prompt}&quot;
                  </p>
                  <p>
                    Горим:{' '}
                    {mode === 'mock'
                      ? 'Тестийн горим (Төлбөргүй синтетик MOCK WAV, бодит санд нөлөөлөхгүй)'
                      : isFirstRealGateActive
                      ? `Бодит Vertex AI (${runtime.project_id}) — зөвхөн PH001 (1 дуудлага)`
                      : `Бодит Vertex AI (${runtime.project_id}) — PH001 баталгаажсан тул үлдсэн мөрүүд`}
                  </p>
                </div>

                {hasHoldFlag && (
                  <div className="p-4 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 space-y-3">
                    <div className="flex items-start gap-2.5 text-red-900 dark:text-red-200 text-xs">
                      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                      <p>
                        <strong>PH006 (Můžete to prosím zopakovat?)</strong> нь{' '}
                        <span className="font-mono">BLOCK_DOMAIN</span> тугтай. Нийтлэлд гаргахгүй, зөвхөн дотоод инженерийн туршилтад ашиглана.
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
              {!(
                mode === 'vertex' &&
                (!runtime.vertex_connected || runtime.storage_backend !== 'gcs-private-bucket')
              ) && (
                <button
                  type="button"
                  disabled={hasHoldFlag && !ackPrivateTest}
                  onClick={() => onRunBatch(ackPrivateTest, isFirstRealGateActive)}
                  className="min-h-[44px] px-5 py-2 rounded-xl bg-sky-700 hover:bg-sky-800 disabled:opacity-40 text-white text-sm font-semibold cursor-pointer"
                >
                  {isFirstRealGateActive
                    ? `PH001 · ${activeStyleDef.short_label} эхлүүлэх`
                    : 'Багцыг эхлүүлэх'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
