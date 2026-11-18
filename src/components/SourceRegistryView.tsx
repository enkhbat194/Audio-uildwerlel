import {
  AlertTriangle,
  Cloud,
  Eye,
  FileUp,
  Lock,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { authedFetch } from '../lib/apiClient';
import {
  downloadDriveFileText,
  listDriveImportFiles,
  type DriveFileItem,
} from '../lib/driveClient';
import { parseAndValidateImport } from '../shared/sourceRegistry';
import type {
  AudioJobReceipt,
  ExecutionMode,
  ImportValidationResult,
  SourceRow,
} from '../shared/types';
import { JobStatusLabel, ReleaseGateLabel } from './StatusBadge';

interface SourceRegistryViewProps {
  sources: SourceRow[];
  realJobs: Record<string, AudioJobReceipt>;
  mockJobs: Record<string, AudioJobReceipt>;
  mode: ExecutionMode;
  datasetVersion: string;
  canonicalSha256: string;
  driveAccessToken: string | null;
  onConnectDrive: () => Promise<string | null>;
  onImportSuccess: (importedRows: SourceRow[]) => Promise<void>;
}

export function SourceRegistryView({
  sources,
  realJobs,
  mockJobs,
  mode,
  datasetVersion,
  canonicalSha256,
  driveAccessToken,
  onConnectDrive,
  onImportSuccess,
}: SourceRegistryViewProps) {
  const [query, setQuery] = useState('');
  const [gateFilter, setGateFilter] = useState<'all' | 'review' | 'block'>('all');
  const [previewRow, setPreviewRow] = useState<SourceRow | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  // Import state
  const [importTab, setImportTab] = useState<'local' | 'drive'>('local');
  const [importOrigin, setImportOrigin] = useState<'upload' | 'google-drive'>('upload');
  const [importFormat, setImportFormat] = useState<'json' | 'csv'>('csv');
  const [rawImportText, setRawImportText] = useState('');
  const [replaceExisting, setReplaceExisting] = useState(false);
  const [validation, setValidation] = useState<ImportValidationResult | null>(null);
  const [isSubmittingImport, setIsSubmittingImport] = useState(false);
  const [importServerError, setImportServerError] = useState<string | null>(null);

  // Google Drive import state
  const [driveFiles, setDriveFiles] = useState<DriveFileItem[]>([]);
  const [isLoadingDriveFiles, setIsLoadingDriveFiles] = useState(false);
  const [driveError, setDriveError] = useState<string | null>(null);
  const [loadingDriveFileId, setLoadingDriveFileId] = useState<string | null>(null);

  const activeJobs = mode === 'mock' ? mockJobs : realJobs;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sources.filter((row) => {
      if (gateFilter === 'block' && row.source_gate !== 'BLOCK_DOMAIN') return false;
      if (gateFilter === 'review' && row.source_gate === 'BLOCK_DOMAIN') return false;
      if (!q) return true;
      return (
        row.source_id.toLowerCase().includes(q) ||
        row.lesson_id.toLowerCase().includes(q) ||
        row.cs_exact.toLowerCase().includes(q)
      );
    });
  }, [sources, query, gateFilter]);

  function handleValidateLocal(
    text: string,
    fmt: 'json' | 'csv',
    origin: 'upload' | 'google-drive' = 'upload'
  ) {
    setRawImportText(text);
    setImportFormat(fmt);
    setImportOrigin(origin);
    setImportServerError(null);
    if (!text.trim()) {
      setValidation(null);
      return;
    }
    setValidation(parseAndValidateImport(text, fmt));
  }

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const fmt = file.name.toLowerCase().endsWith('.json') ? 'json' : 'csv';
    const text = await file.text();
    handleValidateLocal(text, fmt, 'upload');
  }

  async function handleLoadDriveFiles(tokenOverride?: string | null) {
    const token = tokenOverride ?? driveAccessToken;
    if (!token) return;
    setIsLoadingDriveFiles(true);
    setDriveError(null);
    try {
      const files = await listDriveImportFiles(token);
      setDriveFiles(files);
    } catch (err) {
      setDriveError(err instanceof Error ? err.message : 'Google Drive жагсаалт татахад алдаа гарлаа.');
    } finally {
      setIsLoadingDriveFiles(false);
    }
  }

  async function handleReconnectDriveAndLoad() {
    setDriveError(null);
    const token = await onConnectDrive();
    if (token) {
      await handleLoadDriveFiles(token);
    } else {
      setDriveError('Google Drive OAuth эрх авч чадсангүй.');
    }
  }

  async function handlePickDriveFile(file: DriveFileItem) {
    if (!driveAccessToken) return;
    setLoadingDriveFileId(file.id);
    setDriveError(null);
    try {
      const text = await downloadDriveFileText(driveAccessToken, file.id);
      const isJson =
        file.name.toLowerCase().endsWith('.json') || file.mimeType === 'application/json';
      handleValidateLocal(text, isJson ? 'json' : 'csv', 'google-drive');
    } catch (err) {
      setDriveError(err instanceof Error ? err.message : 'Drive файл татахад алдаа гарлаа.');
    } finally {
      setLoadingDriveFileId(null);
    }
  }

  async function handleConfirmImport() {
    if (!validation?.valid) return;
    setIsSubmittingImport(true);
    setImportServerError(null);
    try {
      const res = await authedFetch('/api/sources/import', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          rawText: rawImportText,
          format: importFormat,
          replaceExisting,
          sourceOrigin: importOrigin,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setImportServerError(data.error ?? 'Импорт хийхэд алдаа гарлаа.');
        return;
      }
      await onImportSuccess(data.sources ?? []);
      setImportOpen(false);
      setRawImportText('');
      setValidation(null);
    } catch {
      setImportServerError('Сервертэй холбогдож чадсангүй.');
    } finally {
      setIsSubmittingImport(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
            Өгүүлбэрүүд (Эх бүртгэл)
          </h1>
          <p className="text-xs text-slate-600 dark:text-slate-400 font-mono">
            Хувилбар: {datasetVersion} · Canonical SHA256: {canonicalSha256.slice(0, 16)}… · Зөвхөн унших эх
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            setImportOpen(true);
            if (driveAccessToken && driveFiles.length === 0) {
              void handleLoadDriveFiles(driveAccessToken);
            }
          }}
          className="min-h-[44px] px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 dark:bg-slate-100 dark:hover:bg-slate-200 text-white dark:text-slate-900 text-sm font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer whitespace-nowrap shrink-0"
        >
          <FileUp className="w-4 h-4" aria-hidden="true" />
          <span>CSV / JSON / Drive импорт</span>
        </button>
      </div>

      {/* Explicit Read-Only & Non-Approval Policy Notice */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex items-start gap-3">
        <Lock className="w-5 h-5 text-slate-600 dark:text-slate-400 shrink-0 mt-0.5" aria-hidden="true" />
        <div className="text-xs md:text-sm text-slate-700 dark:text-slate-300 space-y-1">
          <p className="font-semibold text-slate-900 dark:text-slate-100">
            Эх текст өөрчлөхгүй · Нийтлэх зөвшөөрөлгүй
          </p>
          <p>
            Curriculum Branch нь эх текст болон нийтлэлтийн эрхийг хариуцна. Энэ систем чех өгүүлбэр, өргөлт, цэг тэмдгийг автоматаар засахгүй. PH006 (<span className="font-mono">BLOCK_DOMAIN</span>) нь нийтлэх хориотой.
          </p>
        </div>
      </div>

      {/* Search and Filter Controls */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Search
            className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
            aria-hidden="true"
          />
          <label htmlFor="source-search" className="sr-only">
            Өгүүлбэр эсвэл ID хайх
          </label>
          <input
            id="source-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ID, хичээл эсвэл чех өгүүлбэрээр хайх..."
            className="w-full min-h-[44px] pl-10 pr-4 py-2 text-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-600"
          />
        </div>

        <div
          role="group"
          aria-label="Шүүлтүүр"
          className="inline-flex items-center p-1 bg-slate-200/70 dark:bg-slate-800 rounded-xl self-start"
        >
          <button
            type="button"
            onClick={() => setGateFilter('all')}
            className={`px-3 py-1.5 min-h-[36px] text-xs font-semibold rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
              gateFilter === 'all'
                ? 'bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-50 shadow-sm'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            Бүгд ({sources.length})
          </button>
          <button
            type="button"
            onClick={() => setGateFilter('review')}
            className={`px-3 py-1.5 min-h-[36px] text-xs font-semibold rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
              gateFilter === 'review'
                ? 'bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-50 shadow-sm'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            Хяналттай
          </button>
          <button
            type="button"
            onClick={() => setGateFilter('block')}
            className={`px-3 py-1.5 min-h-[36px] text-xs font-semibold rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
              gateFilter === 'block'
                ? 'bg-white dark:bg-slate-950 text-red-700 dark:text-red-400 shadow-sm'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            BLOCK_DOMAIN
          </button>
        </div>
      </div>

      {/* Desktop Data Table */}
      <div className="hidden lg:block bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-slate-200 dark:border-slate-800 text-xs font-semibold text-slate-500 dark:text-slate-400 bg-slate-50/70 dark:bg-slate-950/40">
              <th className="py-3.5 px-4">content_id / Хичээл</th>
              <th className="py-3.5 px-4">Чех өгүүлбэр (Зөвхөн унших)</th>
              <th className="py-3.5 px-4">Эх туг ба зөвшөөрөл</th>
              <th className="py-3.5 px-4">
                Normal ({mode === 'mock' ? 'MOCK' : 'Бодит'}) / Slow
              </th>
              <th className="py-3.5 px-4 text-right">Үйлдэл</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-sm">
            {filtered.map((row) => {
              const job = activeJobs[row.source_id];
              const realExists = realJobs[row.source_id]?.status === 'REAL_SUCCESS';
              return (
                <tr
                  key={row.source_id}
                  className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
                >
                  <td className="py-4 px-4 align-top">
                    <div className="font-mono text-xs font-semibold text-slate-900 dark:text-slate-100">
                      {row.source_id}
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 font-mono">
                      {row.lesson_id} · {row.dataset_version}
                    </div>
                  </td>
                  <td className="py-4 px-4 align-top">
                    <div className="text-base font-semibold text-slate-900 dark:text-slate-50">
                      {row.cs_exact}
                    </div>
                    <div className="text-xs font-mono text-slate-500 dark:text-slate-400 mt-1">
                      SHA256: {row.text_sha256.slice(0, 16)}…
                    </div>
                  </td>
                  <td className="py-4 px-4 align-top space-y-1">
                    <ReleaseGateLabel sourceGate={row.source_gate} />
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      {row.source_gate}
                    </div>
                  </td>
                  <td className="py-4 px-4 align-top space-y-1">
                    <div className="flex items-center gap-2">
                      <JobStatusLabel status={job?.status ?? 'PENDING'} />
                      {mode === 'mock' && realExists && (
                        <span className="text-[11px] font-mono text-emerald-700 dark:text-emerald-400">
                          (+Бодит бэлэн)
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      Slow: Хэрэгжүүлээгүй
                    </div>
                  </td>
                  <td className="py-4 px-4 align-top text-right">
                    <button
                      type="button"
                      onClick={() => setPreviewRow(row)}
                      aria-label={`${row.source_id} дэлгэрэнгүй харах`}
                      className="min-h-[40px] px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
                    >
                      <Eye className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Харах</span>
                    </button>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={5} className="py-12 text-center text-sm text-slate-500 dark:text-slate-400">
                  Хайлтад тохирох өгүүлбэр олдсонгүй.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Mobile / Tablet Cards */}
      <div className="lg:hidden space-y-3">
        {filtered.map((row) => {
          const job = activeJobs[row.source_id];
          return (
            <div
              key={row.source_id}
              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-3"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="text-xs font-mono text-slate-500 dark:text-slate-400">
                  <span className="font-semibold text-slate-800 dark:text-slate-200">{row.source_id}</span>
                  <span> · </span>
                  <span>{row.dataset_version}</span>
                </div>
                <JobStatusLabel status={job?.status ?? 'PENDING'} />
              </div>

              <p className="text-lg font-semibold text-slate-900 dark:text-slate-50">{row.cs_exact}</p>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                <ReleaseGateLabel sourceGate={row.source_gate} />
                <button
                  type="button"
                  onClick={() => setPreviewRow(row)}
                  className="min-h-[44px] px-3.5 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-lg inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <Eye className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Дэлгэрэнгүй</span>
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Source Preview Modal */}
      {previewRow && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="preview-modal-title"
          className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4"
        >
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-xl w-full p-6 space-y-5 shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-mono text-slate-500 dark:text-slate-400">
                  {previewRow.source_id} · {previewRow.lesson_id}
                </p>
                <h2 id="preview-modal-title" className="text-lg font-bold text-slate-900 dark:text-slate-50 mt-1">
                  Эх өгүүлбэрийн дэлгэрэнгүй
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setPreviewRow(null)}
                aria-label="Цонх хаах"
                className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-1">
              <p className="text-xs text-slate-500 dark:text-slate-400">Яг эх чех текст (cs_exact)</p>
              <p className="text-xl font-bold text-slate-900 dark:text-slate-50">{previewRow.cs_exact}</p>
            </div>

            {previewRow.source_gate === 'BLOCK_DOMAIN' && (
              <div className="p-4 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400 shrink-0 mt-0.5" aria-hidden="true" />
                <div className="text-xs md:text-sm text-red-900 dark:text-red-200 space-y-1">
                  <p className="font-semibold">BLOCK_DOMAIN — Нийтлэхийг хориглосон мөр</p>
                  <p>
                    Үйлдвэрлэл хэсэгт үүсгэхийн өмнө эзэмшигч зөвхөн дотоод инженерийн туршилтын зөвшөөрлийг тусгайлан баталгаажуулах шаардлагатай. Автоматаар хэзээ ч нийтлэгдэхгүй.
                  </p>
                </div>
              </div>
            )}

            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                <dt className="text-slate-500 dark:text-slate-400">text_sha256</dt>
                <dd className="font-mono text-slate-900 dark:text-slate-100 break-all mt-1">
                  {previewRow.text_sha256}
                </dd>
              </div>
              <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                <dt className="text-slate-500 dark:text-slate-400">audio_text_key / Хувилбар</dt>
                <dd className="font-mono text-slate-900 dark:text-slate-100 mt-1">
                  {previewRow.audio_text_key} · {previewRow.dataset_version}
                </dd>
              </div>
              <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                <dt className="text-slate-500 dark:text-slate-400">source_gate</dt>
                <dd className="font-mono text-slate-900 dark:text-slate-100 mt-1">{previewRow.source_gate}</dd>
              </div>
              <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                <dt className="text-slate-500 dark:text-slate-400">publish_allowed</dt>
                <dd className="font-mono text-slate-900 dark:text-slate-100 mt-1">
                  {String(previewRow.publish_allowed)} (BLOCKED_FOR_RELEASE)
                </dd>
              </div>
            </dl>

            {previewRow.notes && (
              <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                Тэмдэглэл: {previewRow.notes}
              </p>
            )}

            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setPreviewRow(null)}
                className="min-h-[44px] px-5 py-2 rounded-xl bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-sm font-semibold cursor-pointer"
              >
                Хаах
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CSV / JSON / Google Drive Importer Modal */}
      {importOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="import-modal-title"
          className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4"
        >
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-2xl w-full p-6 space-y-5 shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 id="import-modal-title" className="text-lg font-bold text-slate-900 dark:text-slate-50">
                  CSV / JSON эх өгүүлбэр импортлох
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  ID давхардал, UTF-8 чех тэмдэгт, холимог хувилбар, дутуу талбар болон text_sha256-ийг шалгана.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setImportOpen(false)}
                aria-label="Импорт цонх хаах"
                className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Source Origin Tabs: Local vs Google Drive */}
            <div className="inline-flex p-1 bg-slate-100 dark:bg-slate-800 rounded-xl">
              <button
                type="button"
                onClick={() => setImportTab('local')}
                className={`px-3.5 py-2 min-h-[38px] text-xs font-semibold rounded-lg cursor-pointer flex items-center gap-1.5 ${
                  importTab === 'local'
                    ? 'bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 shadow-sm'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                <FileUp className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Локал файл / Текст</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setImportTab('drive');
                  if (driveAccessToken && driveFiles.length === 0) {
                    void handleLoadDriveFiles(driveAccessToken);
                  }
                }}
                className={`px-3.5 py-2 min-h-[38px] text-xs font-semibold rounded-lg cursor-pointer flex items-center gap-1.5 ${
                  importTab === 'drive'
                    ? 'bg-white dark:bg-slate-950 text-sky-800 dark:text-sky-300 shadow-sm'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                <Cloud className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Google Drive-аас авах</span>
              </button>
            </div>

            {importTab === 'drive' && (
              <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-3">
                {!driveAccessToken ? (
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <p className="text-xs text-slate-600 dark:text-slate-300">
                      Google Drive файлын жагсаалт уншихын тулд OAuth token-оо сэргээнэ үү.
                    </p>
                    <button
                      type="button"
                      onClick={() => void handleReconnectDriveAndLoad()}
                      className="min-h-[44px] px-4 py-2 rounded-xl bg-sky-700 hover:bg-sky-800 text-white text-xs font-semibold cursor-pointer whitespace-nowrap"
                    >
                      Google Drive эрх сэргээх
                    </button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                        Таны Google Drive дээрх JSON / CSV файлууд
                      </span>
                      <button
                        type="button"
                        onClick={() => void handleLoadDriveFiles(driveAccessToken)}
                        disabled={isLoadingDriveFiles}
                        className="min-h-[36px] px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-1.5 cursor-pointer"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${isLoadingDriveFiles ? 'animate-spin' : ''}`} />
                        <span>Шинэчлэх</span>
                      </button>
                    </div>

                    {driveError && (
                      <p className="text-xs text-red-700 dark:text-red-400">{driveError}</p>
                    )}

                    <div className="max-h-48 overflow-y-auto divide-y divide-slate-200 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-900">
                      {driveFiles.length === 0 ? (
                        <p className="p-3 text-xs text-slate-500 dark:text-slate-400">
                          {isLoadingDriveFiles
                            ? 'Google Drive-аас уншиж байна...'
                            : 'Тохирох .json эсвэл .csv файл олдсонгүй.'}
                        </p>
                      ) : (
                        driveFiles.map((file) => (
                          <div
                            key={file.id}
                            className="px-3 py-2.5 flex items-center justify-between gap-3 text-xs"
                          >
                            <div className="min-w-0">
                              <p className="font-mono font-semibold text-slate-900 dark:text-slate-100 truncate">
                                {file.name}
                              </p>
                              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                                {file.size ? `${Math.round(Number(file.size) / 1024)} KB` : '—'}
                              </p>
                            </div>
                            <button
                              type="button"
                              disabled={loadingDriveFileId === file.id}
                              onClick={() => void handlePickDriveFile(file)}
                              className="min-h-[36px] px-3 py-1.5 rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 font-semibold cursor-pointer whitespace-nowrap disabled:opacity-50"
                            >
                              {loadingDriveFileId === file.id ? 'Татаж байна...' : 'Татаж шалгах'}
                            </button>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="inline-flex p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
                <button
                  type="button"
                  onClick={() => handleValidateLocal(rawImportText, 'csv', importOrigin)}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md cursor-pointer ${
                    importFormat === 'csv'
                      ? 'bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 shadow-sm'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  CSV
                </button>
                <button
                  type="button"
                  onClick={() => handleValidateLocal(rawImportText, 'json', importOrigin)}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md cursor-pointer ${
                    importFormat === 'json'
                      ? 'bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 shadow-sm'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  JSON
                </button>
              </div>

              {importTab === 'local' && (
                <label className="min-h-[44px] px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-semibold text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer flex items-center gap-2">
                  <FileUp className="w-4 h-4" aria-hidden="true" />
                  <span>Файл сонгох (.csv / .json)</span>
                  <input
                    type="file"
                    accept=".csv,.json,text/csv,application/json"
                    onChange={handleFileSelect}
                    className="sr-only"
                  />
                </label>
              )}
            </div>

            <div>
              <label
                htmlFor="import-textarea"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
              >
                Эсвэл CSV / JSON агуулгыг шалгах / шууд хуулж тавих
              </label>
              <textarea
                id="import-textarea"
                rows={6}
                value={rawImportText}
                onChange={(e) => handleValidateLocal(e.target.value, importFormat, importOrigin)}
                placeholder="source_id,lesson_id,cs_exact,dataset_version,source_gate"
                className="w-full p-3 text-xs font-mono bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-600"
              />
            </div>

            <label className="flex items-center gap-2.5 text-xs text-slate-700 dark:text-slate-300 cursor-pointer min-h-[40px]">
              <input
                type="checkbox"
                checked={replaceExisting}
                onChange={(e) => setReplaceExisting(e.target.checked)}
                className="w-4 h-4 rounded border-slate-300 text-sky-600 focus:ring-sky-600"
              />
              <span>Одоо байгаа бүртгэлийг бүтнээр нь орлуулах (анхдагч нь нэмэх/шинэчлэх)</span>
            </label>

            {validation && (
              <div
                className={`p-4 rounded-xl border text-xs space-y-2 ${
                  validation.valid
                    ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900 text-emerald-900 dark:text-emerald-200'
                    : 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-900 text-red-900 dark:text-red-200'
                }`}
              >
                <p className="font-semibold">
                  {validation.valid
                    ? `Шалгалт амжилттай: ${validation.rows.length} мөр бэлэн (${validation.dataset_version ?? 'v0.9.20'})`
                    : `Шалгалт амжилтгүй (${validation.errors.length} алдаа)`}
                </p>
                {validation.errors.map((err, idx) => (
                  <p key={idx}>• {err}</p>
                ))}
                {validation.warnings.map((w, idx) => (
                  <p key={idx} className="text-amber-800 dark:text-amber-300">
                    • {w}
                  </p>
                ))}
              </div>
            )}

            {importServerError && (
              <p className="text-xs font-medium text-red-600 dark:text-red-400">{importServerError}</p>
            )}

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setImportOpen(false)}
                className="min-h-[44px] px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-medium text-slate-700 dark:text-slate-300 cursor-pointer"
              >
                Болих
              </button>
              <button
                type="button"
                disabled={!validation?.valid || isSubmittingImport}
                onClick={handleConfirmImport}
                className="min-h-[44px] px-5 py-2 rounded-xl bg-sky-700 hover:bg-sky-800 disabled:opacity-40 text-white text-sm font-semibold cursor-pointer"
              >
                {isSubmittingImport ? 'Хадгалж байна...' : 'Баталгаажуулж хадгалах'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
