import {
  AlertTriangle,
  Check,
  Download,
  Pause,
  Play,
  Repeat,
  Volume2,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { authedFetch, downloadAuthedFile } from '../lib/apiClient';
import {
  SPEECH_STYLE_PROFILES,
  getJobsForSource,
  getVariantKey,
} from '../shared/sourceRegistry';
import type {
  AudioJobReceipt,
  ExecutionMode,
  QaRecord,
  QaStatus,
  SourceRow,
  SpeechStyle,
} from '../shared/types';
import { JobStatusLabel, QaStatusLabel } from './StatusBadge';

export type QaVariantSelection = SpeechStyle | 'legacy';

interface ListeningQaViewProps {
  sources: SourceRow[];
  realJobs: Record<string, AudioJobReceipt>;
  mockJobs: Record<string, AudioJobReceipt>;
  mode: ExecutionMode;
  qa: Record<string, QaRecord>;
  selectedSourceId: string;
  onSelectSourceId: (id: string) => void;
  selectedStyle: SpeechStyle;
  onSelectStyle: (style: SpeechStyle) => void;
  onSaveQa: (
    sourceId: string,
    payload: {
      listening_qa: QaStatus;
      issue_category: string;
      notes: string;
      speechStyle?: SpeechStyle;
      qaKey?: string;
    }
  ) => Promise<void>;
}

export function ListeningQaView({
  sources,
  realJobs,
  mockJobs,
  mode,
  qa,
  selectedSourceId,
  onSelectSourceId,
  selectedStyle,
  onSelectStyle,
  onSaveQa,
}: ListeningQaViewProps) {
  const [scope, setScope] = useState<'real' | 'mock'>(mode === 'mock' ? 'mock' : 'real');
  const [variantTab, setVariantTab] = useState<QaVariantSelection>(selectedStyle);

  useEffect(() => {
    setScope(mode === 'mock' ? 'mock' : 'real');
  }, [mode]);

  useEffect(() => {
    setVariantTab(selectedStyle);
  }, [selectedStyle]);

  const activeJobMap = scope === 'mock' ? mockJobs : realJobs;
  const activeSource = sources.find((s) => s.source_id === selectedSourceId) ?? sources[0];

  const legacyJob = activeSource ? activeJobMap[activeSource.source_id] : undefined;
  const activeQaKey = activeSource
    ? variantTab === 'legacy'
      ? activeSource.source_id
      : getVariantKey(activeSource.source_id, variantTab)
    : '';
  const activeJob = activeSource ? activeJobMap[activeQaKey] : undefined;
  const activeQa = activeQaKey ? qa[activeQaKey] : undefined;

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [audioBlobUrl, setAudioBlobUrl] = useState<string | null>(null);
  const [audioLoadError, setAudioLoadError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [loopEnabled, setLoopEnabled] = useState(false);
  const [listenSpeed, setListenSpeed] = useState<1 | 0.75>(1);

  const [qaStatus, setQaStatus] = useState<QaStatus>(activeQa?.listening_qa ?? 'QA_PENDING');
  const [issueCategory, setIssueCategory] = useState(activeQa?.issue_category ?? '');
  const [notes, setNotes] = useState(activeQa?.notes ?? '');
  const [isSaving, setIsSaving] = useState(false);
  const [saveFeedback, setSaveFeedback] = useState<string | null>(null);

  useEffect(() => {
    setQaStatus(activeQa?.listening_qa ?? 'QA_PENDING');
    setIssueCategory(activeQa?.issue_category ?? '');
    setNotes(activeQa?.notes ?? '');
    setSaveFeedback(null);
    setIsPlaying(false);
  }, [activeSource?.source_id, activeQaKey, activeQa?.updated_at]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = listenSpeed;
      audioRef.current.loop = loopEnabled;
    }
  }, [listenSpeed, loopEnabled]);

  const playable = Boolean(
    activeJob &&
      ((scope === 'real' && activeJob.status === 'REAL_SUCCESS' && !activeJob.is_mock) ||
        (scope === 'mock' && activeJob.status === 'MOCK' && activeJob.is_mock))
  );

  useEffect(() => {
    let active = true;
    let currentUrl: string | null = null;
    setAudioBlobUrl(null);
    setAudioLoadError(null);
    setIsPlaying(false);

    async function loadAudio() {
      if (!playable || !activeJob?.filename) return;
      try {
        const res = await authedFetch(
          `/api/audio/${scope}/${encodeURIComponent(activeJob.filename)}?v=${encodeURIComponent(
            activeJob.updated_at
          )}`
        );
        if (!res.ok) {
          if (active) setAudioLoadError(`Аудио ачаалж чадсангүй (HTTP ${res.status}).`);
          return;
        }
        const blob = await res.blob();
        if (!active) return;
        currentUrl = URL.createObjectURL(blob);
        setAudioBlobUrl(currentUrl);
      } catch {
        if (active) setAudioLoadError('Аудио татахад сүлжээний алдаа гарлаа.');
      }
    }

    void loadAudio();
    return () => {
      active = false;
      if (currentUrl) URL.revokeObjectURL(currentUrl);
    };
  }, [playable, scope, activeJob?.filename, activeJob?.updated_at]);

  function togglePlay() {
    if (!audioRef.current || !audioBlobUrl) return;
    if (audioRef.current.paused) {
      audioRef.current.playbackRate = listenSpeed;
      audioRef.current.loop = loopEnabled;
      audioRef.current.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));
    } else {
      audioRef.current.pause();
      setIsPlaying(false);
    }
  }

  async function handleSubmitQa(e: React.FormEvent) {
    e.preventDefault();
    if (!activeSource) return;
    setIsSaving(true);
    setSaveFeedback(null);
    try {
      await onSaveQa(activeSource.source_id, {
        listening_qa: qaStatus,
        issue_category: issueCategory,
        notes,
        ...(variantTab === 'legacy'
          ? { qaKey: activeSource.source_id }
          : { speechStyle: variantTab, qaKey: getVariantKey(activeSource.source_id, variantTab) }),
      });
      setSaveFeedback(
        `${variantTab === 'legacy' ? 'Legacy' : SPEECH_STYLE_PROFILES[variantTab].short_label} хувилбарын QA хадгалагдлаа.`
      );
    } catch {
      setSaveFeedback('QA хадгалахад алдаа гарлаа.');
    } finally {
      setIsSaving(false);
    }
  }

  if (!activeSource) {
    return (
      <div className="p-8 text-center text-sm text-slate-500 dark:text-slate-400">
        Шалгах өгүүлбэр олдсонгүй.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
            Сонсож шалгах (WAV бүрт тусдаа QA)
          </h1>
          <p className="text-xs md:text-sm text-slate-600 dark:text-slate-400">
            Natural, Learning Slow болон анхны WAV файл бүрд тусдаа QA үнэлгээ хадгална. REVIEW эсвэл FAIL болсон файл Google Drive руу синк хийгдэхгүй.
          </p>
        </div>

        {/* Isolated Scope Toggle */}
        <div
          role="group"
          aria-label="Аудио сангийн төрөл"
          className="inline-flex p-1 bg-slate-200/80 dark:bg-slate-800 rounded-xl self-start"
        >
          <button
            type="button"
            onClick={() => setScope('real')}
            className={`px-3.5 py-2 min-h-[38px] text-xs font-semibold rounded-lg cursor-pointer transition-colors ${
              scope === 'real'
                ? 'bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-50 shadow-sm'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            Бодит WAV (real)
          </button>
          <button
            type="button"
            onClick={() => setScope('mock')}
            className={`px-3.5 py-2 min-h-[38px] text-xs font-semibold rounded-lg cursor-pointer transition-colors ${
              scope === 'mock'
                ? 'bg-white dark:bg-slate-950 text-amber-800 dark:text-amber-300 shadow-sm'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            Тест WAV (mock)
          </button>
        </div>
      </div>

      {/* Mandatory Technical Validity vs Linguistic Accuracy & Drive Gate Disclaimer */}
      <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded-xl p-4 flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" aria-hidden="true" />
        <p className="text-xs md:text-sm text-amber-950 dark:text-amber-200">
          <strong>Анхаар:</strong> WAV дохио хүчинтэй (PCM16, 24kHz) гэдэг нь чех уугуул дуудлага зөв гэсэн үг биш.
          {scope === 'mock'
            ? ' Одоо зөвхөн тусгаарлагдсан MOCK (синтетик) файл харагдаж байна — үүнийг бодит дуудлага гэж тооцохгүй.'
            : ' Зөвхөн PASS үнэлгээ авсан WAV файлыг л Google Drive руу апп аудио гэж синк хийхийг зөвшөөрнө.'}
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: Selector List */}
        <div className="lg:col-span-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl divide-y divide-slate-200 dark:divide-slate-800 overflow-hidden">
          {sources.map((row) => {
            const selected = row.source_id === activeSource.source_id;
            const naturalQa = qa[getVariantKey(row.source_id, 'natural')];
            const slowQa = qa[getVariantKey(row.source_id, 'learning_slow')];
            const rowJobs = getJobsForSource(activeJobMap, row.source_id);
            const displayQa =
              variantTab === 'legacy'
                ? qa[row.source_id]
                : qa[getVariantKey(row.source_id, variantTab)];

            return (
              <button
                key={row.source_id}
                type="button"
                onClick={() => onSelectSourceId(row.source_id)}
                className={`w-full text-left p-4 transition-colors cursor-pointer space-y-1.5 ${
                  selected
                    ? 'bg-sky-50/90 dark:bg-sky-950/40'
                    : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                }`}
              >
                <div className="flex items-center justify-between gap-2 text-xs font-mono text-slate-500 dark:text-slate-400">
                  <span className="font-semibold text-slate-800 dark:text-slate-200">{row.source_id}</span>
                  <QaStatusLabel status={displayQa?.listening_qa ?? 'QA_PENDING'} />
                </div>
                <p className="text-sm font-semibold text-slate-900 dark:text-slate-50 truncate">
                  {row.cs_exact}
                </p>
                <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono text-slate-500 dark:text-slate-400">
                  <JobStatusLabel status={rowJobs[0]?.status ?? 'PENDING'} />
                  {naturalQa && <span>N:{naturalQa.listening_qa}</span>}
                  {slowQa && <span>S:{slowQa.listening_qa}</span>}
                </div>
              </button>
            );
          })}
        </div>

        {/* Right: Variant Tabs, Player, Signal Metadata, and Per-WAV QA Form */}
        <div className="lg:col-span-8 space-y-6">
          <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 space-y-5">
            {/* Variant Selector Tabs */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div
                role="tablist"
                aria-label="Аудио хувилбар сонгох"
                className="inline-flex flex-wrap p-1 bg-slate-100 dark:bg-slate-800 rounded-xl gap-1"
              >
                {(['natural', 'learning_slow'] as SpeechStyle[]).map((styleKey) => {
                  const def = SPEECH_STYLE_PROFILES[styleKey];
                  const vKey = getVariantKey(activeSource.source_id, styleKey);
                  const vQa = qa[vKey]?.listening_qa;
                  const isActive = variantTab === styleKey;
                  return (
                    <button
                      key={styleKey}
                      role="tab"
                      aria-selected={isActive}
                      type="button"
                      onClick={() => {
                        setVariantTab(styleKey);
                        onSelectStyle(styleKey);
                      }}
                      className={`min-h-[38px] px-3.5 py-1.5 rounded-lg text-xs font-semibold cursor-pointer flex items-center gap-2 transition-colors ${
                        isActive
                          ? 'bg-white dark:bg-slate-950 text-sky-900 dark:text-sky-200 shadow-sm'
                          : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                      }`}
                    >
                      <span>{def.short_label} ({def.style_version})</span>
                      {vQa && vQa !== 'QA_PENDING' && (
                        <span className="font-mono text-[10px] opacity-80">[{vQa}]</span>
                      )}
                    </button>
                  );
                })}

                {legacyJob && (
                  <button
                    role="tab"
                    aria-selected={variantTab === 'legacy'}
                    type="button"
                    onClick={() => setVariantTab('legacy')}
                    className={`min-h-[38px] px-3.5 py-1.5 rounded-lg text-xs font-semibold cursor-pointer ${
                      variantTab === 'legacy'
                        ? 'bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 shadow-sm'
                        : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    Анхны PH001 (Legacy)
                  </button>
                )}
              </div>

              <JobStatusLabel status={activeJob?.status ?? 'PENDING'} />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono text-slate-500 dark:text-slate-400">
              <span>
                {activeQaKey} · {activeSource.lesson_id} · {activeSource.source_gate}
              </span>
              {activeJob?.fingerprint && (
                <span>FP: {activeJob.fingerprint.slice(0, 12)}…</span>
              )}
            </div>

            <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
              <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">Тулгах чех өгүүлбэр (Зөвхөн унших)</p>
              <p className="text-2xl font-bold text-slate-900 dark:text-slate-50">{activeSource.cs_exact}</p>
              {variantTab !== 'legacy' && (
                <p className="text-[11px] font-mono text-slate-500 dark:text-slate-400 mt-2">
                  speechMetadata.style: &quot;{SPEECH_STYLE_PROFILES[variantTab].style_prompt}&quot;
                </p>
              )}
            </div>

            {playable && audioBlobUrl ? (
              <div className="space-y-4">
                <audio
                  ref={audioRef}
                  src={audioBlobUrl}
                  onEnded={() => {
                    if (!loopEnabled) setIsPlaying(false);
                  }}
                  onPause={() => setIsPlaying(false)}
                  onPlay={() => setIsPlaying(true)}
                  controls
                  className="w-full"
                />

                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={togglePlay}
                    className="min-h-[44px] px-5 py-2 rounded-xl bg-sky-700 hover:bg-sky-800 text-white text-sm font-semibold flex items-center gap-2 cursor-pointer"
                  >
                    {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                    <span>{isPlaying ? 'Зогсоох' : 'Тоглуулах'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setLoopEnabled((v) => !v)}
                    aria-pressed={loopEnabled}
                    className={`min-h-[44px] px-4 py-2 rounded-xl border text-xs font-semibold flex items-center gap-1.5 cursor-pointer ${
                      loopEnabled
                        ? 'border-sky-600 bg-sky-50 dark:bg-sky-950/50 text-sky-800 dark:text-sky-300'
                        : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    <Repeat className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Давтах {loopEnabled ? '(Асаалттай)' : ''}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setListenSpeed((s) => (s === 1 ? 0.75 : 1))}
                    className={`min-h-[44px] px-4 py-2 rounded-xl border text-xs font-semibold cursor-pointer ${
                      listenSpeed === 0.75
                        ? 'border-amber-600 bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300'
                        : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    {listenSpeed === 0.75 ? '0.75x (Зөвхөн сонсоход)' : '1.0x Хэвийн'}
                  </button>

                  {activeJob && (
                    <button
                      type="button"
                      onClick={() =>
                        void downloadAuthedFile(
                          `/api/audio/${scope}/${encodeURIComponent(activeJob.filename)}`,
                          activeJob.filename
                        )
                      }
                      className="min-h-[44px] px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center gap-1.5 cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>WAV татах</span>
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div className="p-6 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 text-center space-y-2">
                <Volume2 className="w-6 h-6 text-slate-400 mx-auto" aria-hidden="true" />
                <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                  {audioLoadError ??
                    `Энэ өгүүлбэрийн ${
                      variantTab === 'legacy' ? 'Legacy' : SPEECH_STYLE_PROFILES[variantTab].short_label
                    } (${scope}) WAV файл үүсээгүй байна.`}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Үйлдвэрлэл хэсгээс энэ хэв маягийн аудиог үүсгэсний дараа энд тоглуулж шалгана уу.
                </p>
              </div>
            )}

            {/* Recording Signal Metadata */}
            <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 border-t border-slate-200 dark:border-slate-800 text-xs">
              <div>
                <dt className="text-slate-500 dark:text-slate-400">Sample rate / Суваг</dt>
                <dd className="font-mono tabular-nums text-slate-900 dark:text-slate-100 mt-0.5">
                  {activeJob?.sample_rate ? `${activeJob.sample_rate} Hz · Mono` : '—'}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500 dark:text-slate-400">Формат / Хугацаа</dt>
                <dd className="font-mono tabular-nums text-slate-900 dark:text-slate-100 mt-0.5">
                  {activeJob?.duration_ms ? `PCM16 · ${activeJob.duration_ms} ms` : '—'}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500 dark:text-slate-400">Хэмжээ</dt>
                <dd className="font-mono tabular-nums text-slate-900 dark:text-slate-100 mt-0.5">
                  {activeJob?.file_size ? `${(activeJob.file_size / 1024).toFixed(1)} KB` : '—'}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500 dark:text-slate-400">Хэв маяг / Хувилбар</dt>
                <dd className="font-mono tabular-nums text-slate-900 dark:text-slate-100 mt-0.5">
                  {activeJob?.speech_style
                    ? `${activeJob.speech_style} (${activeJob.style_version ?? 'v1'})`
                    : 'legacy'}
                </dd>
              </div>
              <div className="col-span-2 sm:col-span-4">
                <dt className="text-slate-500 dark:text-slate-400">Файл / WAV SHA256</dt>
                <dd className="font-mono text-slate-900 dark:text-slate-100 break-all mt-0.5">
                  {activeJob?.filename ? `${activeJob.filename} · ` : ''}
                  {activeJob?.audio_sha256 ?? '—'}
                </dd>
              </div>
            </dl>
          </section>

          {/* Human QA Form */}
          <form
            onSubmit={handleSubmitQa}
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 space-y-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-bold text-slate-900 dark:text-slate-50">
                Хүний QA үнэлгээ бүртгэх —{' '}
                <span className="font-mono text-sky-700 dark:text-sky-400">
                  {variantTab === 'legacy' ? 'Legacy' : SPEECH_STYLE_PROFILES[variantTab].short_label}
                </span>
              </h2>
              <span className="text-xs font-mono text-slate-500 dark:text-slate-400">
                QA Key: {activeQaKey}
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {(['QA_PENDING', 'PASS', 'REVIEW', 'FAIL'] as QaStatus[]).map((opt) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => setQaStatus(opt)}
                  className={`min-h-[44px] px-3 py-2 rounded-xl border text-xs font-semibold cursor-pointer transition-colors ${
                    qaStatus === opt
                      ? 'border-sky-600 bg-sky-50 dark:bg-sky-950/50 text-sky-900 dark:text-sky-200'
                      : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'
                  }`}
                >
                  {opt}
                </button>
              ))}
            </div>

            {(qaStatus === 'REVIEW' || qaStatus === 'FAIL') && (
              <p className="text-xs text-red-700 dark:text-red-400 font-medium">
                {qaStatus} төлөвтэй файл нь Google Drive-д аппад ашиглах аудио хэлбэрээр синк хийгдэхгүй (автоматаар хасагдана).
              </p>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="qa-category" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  Алдаа / Ангилал
                </label>
                <select
                  id="qa-category"
                  value={issueCategory}
                  onChange={(e) => setIssueCategory(e.target.value)}
                  className="w-full min-h-[44px] px-3 py-2 text-sm bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-900 dark:text-slate-100"
                >
                  <option value="">Сонгох (заавал биш)</option>
                  <option value="pronunciation_error">Дуудлага буруу</option>
                  <option value="vowel_length">Эгшгийн урт/богино алдаа</option>
                  <option value="stress_prosody">Өргөлт ба хэмнэл</option>
                  <option value="audio_artifact">Дууны шуугиан / тасалдал</option>
                  <option value="verified_clean">Цэвэр, ойлгомжтой</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  Нийтлэлтийн төлөв
                </label>
                <div className="min-h-[44px] px-3 py-2 text-xs font-mono bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-600 dark:text-slate-400 flex items-center">
                  BLOCKED_FOR_RELEASE (Дотоод пилот)
                </div>
              </div>
            </div>

            <div>
              <label htmlFor="qa-notes" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                Сонссон тэмдэглэл
              </label>
              <textarea
                id="qa-notes"
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Жишээ нь: ř / ů дуудлага тодорхой, төгсгөл огцом тасраагүй..."
                className="w-full p-3 text-sm bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-600"
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-xs text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5">
                {saveFeedback && (
                  <>
                    <Check className="w-4 h-4" aria-hidden="true" />
                    <span>{saveFeedback}</span>
                  </>
                )}
              </span>

              <button
                type="submit"
                disabled={isSaving}
                className="min-h-[44px] px-5 py-2.5 rounded-xl bg-sky-700 hover:bg-sky-800 disabled:opacity-50 text-white text-sm font-semibold cursor-pointer"
              >
                {isSaving ? 'Хадгалж байна...' : 'Энэ WAV-ийн QA хадгалах'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
