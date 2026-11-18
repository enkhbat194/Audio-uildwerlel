import {
  CheckCircle2,
  Cloud,
  Download,
  FileArchive,
  FileSpreadsheet,
  FolderPlus,
  RefreshCw,
  ShieldAlert,
  UploadCloud,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { authedFetch, downloadAuthedFile } from '../lib/apiClient';
import {
  createDriveFolder,
  listDriveFolders,
  uploadBytesToDriveFolder,
  type DriveFileItem,
  type DriveUploadedReceipt,
} from '../lib/driveClient';
import type { AppStateSnapshot } from '../shared/types';
import { JobStatusLabel } from './StatusBadge';

interface FilesSettingsViewProps {
  state: AppStateSnapshot;
  driveAccessToken: string | null;
  onConnectDrive: () => Promise<string | null>;
  onSelectDriveFolder: (folderId: string, folderName: string) => Promise<void>;
  onRecordDriveSync: (uploadedFiles: DriveUploadedReceipt[]) => Promise<void>;
}

export function FilesSettingsView({
  state,
  driveAccessToken,
  onConnectDrive,
  onSelectDriveFolder,
  onRecordDriveSync,
}: FilesSettingsViewProps) {
  const { sources, real_jobs, mock_jobs, drive, runtime, events, errors } = state;

  const realDownloadable = sources
    .map((row) => ({ row, job: real_jobs[row.source_id] }))
    .filter(
      (item): item is { row: (typeof sources)[number]; job: NonNullable<(typeof real_jobs)[string]> } =>
        Boolean(item.job && item.job.status === 'REAL_SUCCESS' && !item.job.is_mock)
    );

  const mockDownloadable = sources
    .map((row) => ({ row, job: mock_jobs[row.source_id] }))
    .filter(
      (item): item is { row: (typeof sources)[number]; job: NonNullable<(typeof mock_jobs)[string]> } =>
        Boolean(item.job && item.job.status === 'MOCK' && item.job.is_mock)
    );

  const [downloadError, setDownloadError] = useState<string | null>(null);

  // Google Drive state
  const [driveFolders, setDriveFolders] = useState<DriveFileItem[]>([]);
  const [isLoadingFolders, setIsLoadingFolders] = useState(false);
  const [newFolderName, setNewFolderName] = useState('Ahoj Česko Audio Factory');
  const [confirmCreateFolderOpen, setConfirmCreateFolderOpen] = useState(false);
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);

  const [includeMockInDriveSync, setIncludeMockInDriveSync] = useState(false);
  const [confirmDriveUploadOpen, setConfirmDriveUploadOpen] = useState(false);
  const [isUploadingDrive, setIsUploadingDrive] = useState(false);
  const [driveProgressText, setDriveProgressText] = useState<string | null>(null);
  const [driveError, setDriveError] = useState<string | null>(null);

  async function handleSafeDownload(url: string, filename: string) {
    setDownloadError(null);
    try {
      await downloadAuthedFile(url, filename);
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : 'Татахад алдаа гарлаа.');
    }
  }

  async function handleLoadFolders(tokenOverride?: string | null) {
    const token = tokenOverride ?? driveAccessToken;
    if (!token) return;
    setIsLoadingFolders(true);
    setDriveError(null);
    try {
      const folders = await listDriveFolders(token);
      setDriveFolders(folders);
    } catch (err) {
      setDriveError(err instanceof Error ? err.message : 'Drive хавтас уншихад алдаа гарлаа.');
    } finally {
      setIsLoadingFolders(false);
    }
  }

  async function handleReconnectDrive() {
    setDriveError(null);
    const token = await onConnectDrive();
    if (token) {
      await handleLoadFolders(token);
    } else {
      setDriveError('Google Drive OAuth зөвшөөрөл авч чадсангүй.');
    }
  }

  async function handleConfirmCreateFolder() {
    if (!driveAccessToken || !newFolderName.trim()) return;
    setIsCreatingFolder(true);
    setDriveError(null);
    try {
      const created = await createDriveFolder(driveAccessToken, newFolderName.trim());
      await onSelectDriveFolder(created.id, created.name);
      setConfirmCreateFolderOpen(false);
      await handleLoadFolders(driveAccessToken);
    } catch (err) {
      setDriveError(err instanceof Error ? err.message : 'Хавтас үүсгэхэд алдаа гарлаа.');
    } finally {
      setIsCreatingFolder(false);
    }
  }

  const plannedDriveManifests = [
    { kind: 'results', name: 'AUDIO_RESULTS_MANIFEST.csv', mime: 'text/csv' },
    { kind: 'issues', name: 'AUDIO_PRONUNCIATION_ISSUES.csv', mime: 'text/csv' },
    { kind: 'summary', name: 'summary.json', mime: 'application/json' },
  ];

  async function handleConfirmDriveUpload() {
    if (!driveAccessToken || !drive.folder_id) return;
    setIsUploadingDrive(true);
    setDriveError(null);
    const uploaded: DriveUploadedReceipt[] = [];

    try {
      // 1. Upload real WAVs
      for (const { job } of realDownloadable) {
        setDriveProgressText(`Бодит WAV хуулж байна: ${job.filename}`);
        const res = await authedFetch(`/api/audio/real/${encodeURIComponent(job.filename)}`);
        if (!res.ok) throw new Error(`WAV татах алдаа: ${job.filename} (HTTP ${res.status})`);
        const bytes = new Uint8Array(await res.arrayBuffer());
        const receipt = await uploadBytesToDriveFolder({
          accessToken: driveAccessToken,
          folderId: drive.folder_id,
          filename: job.filename,
          mimeType: 'audio/wav',
          bytes,
          kind: 'wav',
        });
        uploaded.push(receipt);
      }

      // 2. Optionally upload clearly prefixed MOCK_ WAVs
      if (includeMockInDriveSync) {
        for (const { job } of mockDownloadable) {
          setDriveProgressText(`MOCK WAV хуулж байна: ${job.filename}`);
          const res = await authedFetch(`/api/audio/mock/${encodeURIComponent(job.filename)}`);
          if (!res.ok) throw new Error(`MOCK WAV татах алдаа: ${job.filename} (HTTP ${res.status})`);
          const bytes = new Uint8Array(await res.arrayBuffer());
          const receipt = await uploadBytesToDriveFolder({
            accessToken: driveAccessToken,
            folderId: drive.folder_id,
            filename: job.filename,
            mimeType: 'audio/wav',
            bytes,
            kind: 'wav',
          });
          uploaded.push(receipt);
        }
      }

      // 3. Upload manifests
      for (const m of plannedDriveManifests) {
        setDriveProgressText(`Manifest хуулж байна: ${m.name}`);
        const qs = includeMockInDriveSync ? '?includeMock=true' : '';
        const res = await authedFetch(`/api/export/manifest/${m.kind}${qs}`);
        if (!res.ok) throw new Error(`Manifest татах алдаа: ${m.name} (HTTP ${res.status})`);
        const bytes = new Uint8Array(await res.arrayBuffer());
        const receipt = await uploadBytesToDriveFolder({
          accessToken: driveAccessToken,
          folderId: drive.folder_id,
          filename: m.name,
          mimeType: m.mime,
          bytes,
          kind: 'manifest',
        });
        uploaded.push(receipt);
      }

      await onRecordDriveSync(uploaded);
      setDriveProgressText(null);
      setConfirmDriveUploadOpen(false);
    } catch (err) {
      setDriveError(err instanceof Error ? err.message : 'Google Drive upload амжилтгүй.');
      setDriveProgressText(null);
    } finally {
      setIsUploadingDrive(false);
    }
  }

  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
          Файлууд / Тохиргоо
        </h1>
        <p className="text-xs md:text-sm text-slate-600 dark:text-slate-400">
          Баталгаажсан таталт (WAV + manifests), Google Cloud Storage, Firestore болон бодит Google Drive синк.
        </p>
      </div>

      {/* Downloads & Manifests */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-50">
              Татаж авах (WAV болон Manifests)
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Бодит (`wav/real`) болон MOCK (`wav/mock`) замууд тусдаа хадгалагдана. Хоосон загвар файл үүсгэхгүй.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() =>
                void handleSafeDownload(
                  '/api/export/zip',
                  `ahoj-cesko-real-${state.dataset_version}.zip`
                )
              }
              className="min-h-[44px] px-4 py-2.5 rounded-xl bg-sky-700 hover:bg-sky-800 text-white text-sm font-semibold inline-flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer"
            >
              <FileArchive className="w-4 h-4" aria-hidden="true" />
              <span>Бодит ZIP ({realDownloadable.length} WAV)</span>
            </button>

            {mockDownloadable.length > 0 && (
              <button
                type="button"
                onClick={() =>
                  void handleSafeDownload(
                    '/api/export/zip?includeMock=true',
                    `ahoj-cesko-with-mock-${state.dataset_version}.zip`
                  )
                }
                className="min-h-[44px] px-4 py-2.5 rounded-xl border border-amber-300 dark:border-amber-800 text-amber-800 dark:text-amber-300 text-xs font-semibold inline-flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer hover:bg-amber-50 dark:hover:bg-amber-950/40"
              >
                <FileArchive className="w-4 h-4" aria-hidden="true" />
                <span>+ MOCK оруулсан ZIP ({mockDownloadable.length})</span>
              </button>
            )}
          </div>
        </div>

        {downloadError && (
          <p className="text-xs text-red-700 dark:text-red-400">{downloadError}</p>
        )}

        {/* Manifest Links */}
        <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
          {[
            { kind: 'results', label: 'AUDIO_RESULTS_MANIFEST.csv' },
            { kind: 'issues', label: 'AUDIO_PRONUNCIATION_ISSUES.csv' },
            { kind: 'events', label: 'events.csv' },
            { kind: 'errors', label: 'errors.csv' },
            { kind: 'summary', label: 'summary.json' },
          ].map((m) => (
            <button
              key={m.kind}
              type="button"
              onClick={() => void handleSafeDownload(`/api/export/manifest/${m.kind}`, m.label)}
              className="min-h-[40px] px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-mono text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 inline-flex items-center gap-1.5 cursor-pointer"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" aria-hidden="true" />
              <span>{m.label}</span>
            </button>
          ))}
        </div>

        {/* Scoped Physical WAV Lists */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 pt-4 border-t border-slate-200 dark:border-slate-800">
          <div className="space-y-2">
            <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Бодит WAV сан (`real/`) — {realDownloadable.length} файл
            </h3>
            {realDownloadable.length === 0 ? (
              <p className="py-4 text-xs text-slate-500 dark:text-slate-400">
                Одоогоор үүсгэгдсэн бодит WAV файл алга.
              </p>
            ) : (
              <div className="divide-y divide-slate-200 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-xl">
                {realDownloadable.map(({ row, job }) => (
                  <div key={row.source_id} className="p-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-xs font-mono">
                        <span className="font-semibold text-slate-900 dark:text-slate-100 truncate">
                          {job.filename}
                        </span>
                        <JobStatusLabel status={job.status} />
                      </div>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 font-mono truncate">
                        {row.cs_exact} · {job.duration_ms} ms
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        void handleSafeDownload(
                          `/api/audio/real/${encodeURIComponent(job.filename)}`,
                          job.filename
                        )
                      }
                      className="min-h-[38px] px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 inline-flex items-center gap-1.5 cursor-pointer shrink-0"
                    >
                      <Download className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Татах</span>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <h3 className="text-xs font-bold uppercase tracking-wide text-amber-700 dark:text-amber-400">
              Тусгаарлагдсан MOCK сан (`mock/`) — {mockDownloadable.length} файл
            </h3>
            {mockDownloadable.length === 0 ? (
              <p className="py-4 text-xs text-slate-500 dark:text-slate-400">
                MOCK туршилтын файл байхгүй.
              </p>
            ) : (
              <div className="divide-y divide-slate-200 dark:divide-slate-800 border border-amber-200 dark:border-amber-900/60 rounded-xl">
                {mockDownloadable.map(({ row, job }) => (
                  <div key={row.source_id} className="p-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-xs font-mono">
                        <span className="font-semibold text-slate-900 dark:text-slate-100 truncate">
                          {job.filename}
                        </span>
                        <JobStatusLabel status={job.status} />
                      </div>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 font-mono truncate">
                        {row.cs_exact} · {job.duration_ms} ms
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        void handleSafeDownload(
                          `/api/audio/mock/${encodeURIComponent(job.filename)}`,
                          job.filename
                        )
                      }
                      className="min-h-[38px] px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 inline-flex items-center gap-1.5 cursor-pointer shrink-0"
                    >
                      <Download className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Татах</span>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Cloud Storage & Real Google Drive Integration */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 space-y-3">
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-50">
            Google Cloud Storage &amp; Firestore
          </h2>
          <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">
            {runtime.storage_backend === 'gcs-private-bucket' && runtime.gcs_bucket && runtime.gcs_permission_verified
              ? `GCS Bucket: gs://${runtime.gcs_bucket} (IAM OK)`
              : runtime.gcs_bucket
              ? `GCS Bucket: gs://${runtime.gcs_bucket} (Эрх баталгаажаагүй)`
              : 'GCS Bucket: Тохируулаагүй (Preview орчин)'}
          </p>
          {runtime.gcs_error && (
            <p className="text-xs text-amber-800 dark:text-amber-300">{runtime.gcs_error}</p>
          )}
          <p className="text-xs font-mono text-slate-600 dark:text-slate-400">
            Firestore DB: {runtime.firestore_database_id}
          </p>
          <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
            Cloud Run дээр <span className="font-mono">GCS_BUCKET_NAME</span> болон <span className="font-mono">storage.objects.create/get</span> эрх баталгаажаагүй бол төлбөртэй Vertex TTS дуудлага эхлүүлэхийг сервер автоматаар хориглоно (<span className="font-mono">EPHEMERAL_STORAGE_BLOCKED</span>).
          </p>
        </div>

        {/* Real Google Drive OAuth & Folder Sync */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-50">
              Google Drive синк (Бодит OAuth)
            </h2>
            <span
              className={`inline-flex items-center gap-1.5 text-xs font-semibold ${
                driveAccessToken
                  ? 'text-emerald-700 dark:text-emerald-400'
                  : 'text-amber-700 dark:text-amber-400'
              }`}
            >
              <Cloud className="w-3.5 h-3.5" aria-hidden="true" />
              <span>{driveAccessToken ? 'OAuth идэвхтэй' : 'Эрх сэргээх шаардлагатай'}</span>
            </span>
          </div>

          <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs space-y-1">
            <p className="text-slate-600 dark:text-slate-400">
              Сонгосон хавтас:{' '}
              <span className="font-semibold text-slate-900 dark:text-slate-100">
                {drive.folder_name ?? 'Сонгоогүй'}
              </span>
              {drive.folder_id && (
                <span className="font-mono text-slate-500"> ({drive.folder_id})</span>
              )}
            </p>
            <p className="text-slate-600 dark:text-slate-400 font-mono">
              Сүүлд хуулсан: {drive.last_synced_at ?? 'Хараахан хуулаагүй'}
            </p>
          </div>

          {!driveAccessToken ? (
            <button
              type="button"
              onClick={() => void handleReconnectDrive()}
              className="min-h-[44px] px-4 py-2 rounded-xl bg-sky-700 hover:bg-sky-800 text-white text-xs font-semibold cursor-pointer"
            >
              Google Drive эрх сэргээх (OAuth)
            </button>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void handleLoadFolders(driveAccessToken)}
                  disabled={isLoadingFolders}
                  className="min-h-[40px] px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center gap-1.5 cursor-pointer"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isLoadingFolders ? 'animate-spin' : ''}`} />
                  <span>Хавтаснууд татах</span>
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmCreateFolderOpen(true)}
                  className="min-h-[40px] px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center gap-1.5 cursor-pointer"
                >
                  <FolderPlus className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Шинэ хавтас</span>
                </button>
              </div>

              {driveFolders.length > 0 && (
                <div className="max-h-36 overflow-y-auto divide-y divide-slate-200 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-xl">
                  {driveFolders.map((f) => {
                    const selected = f.id === drive.folder_id;
                    return (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => void onSelectDriveFolder(f.id, f.name)}
                        className={`w-full text-left px-3 py-2 text-xs flex items-center justify-between cursor-pointer ${
                          selected
                            ? 'bg-sky-50 dark:bg-sky-950/40 font-semibold text-sky-900 dark:text-sky-200'
                            : 'hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300'
                        }`}
                      >
                        <span className="truncate">{f.name}</span>
                        {selected && <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-sky-600" />}
                      </button>
                    );
                  })}
                </div>
              )}

              <div className="pt-2 border-t border-slate-200 dark:border-slate-800 space-y-2.5">
                {mockDownloadable.length > 0 && (
                  <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={includeMockInDriveSync}
                      onChange={(e) => setIncludeMockInDriveSync(e.target.checked)}
                      className="w-4 h-4 rounded border-slate-300 text-sky-600"
                    />
                    <span>MOCK_ файлуудыг тусад нь оруулж хуулах ({mockDownloadable.length})</span>
                  </label>
                )}

                <button
                  type="button"
                  disabled={!drive.folder_id}
                  onClick={() => setConfirmDriveUploadOpen(true)}
                  className="min-h-[44px] w-full px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 dark:bg-slate-100 dark:hover:bg-slate-200 disabled:opacity-40 text-white dark:text-slate-900 text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer"
                >
                  <UploadCloud className="w-4 h-4" aria-hidden="true" />
                  <span>
                    {drive.folder_id
                      ? `Сонгосон хавтас руу WAV + Manifest хуулах`
                      : 'Эхлээд Drive хавтас сонгоно уу'}
                  </span>
                </button>
              </div>
            </div>
          )}

          {driveError && <p className="text-xs text-red-700 dark:text-red-400">{driveError}</p>}

          {drive.uploaded_files.length > 0 && (
            <div className="pt-2 border-t border-slate-200 dark:border-slate-800 space-y-1">
              <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                Баталгаажсан Drive файлууд ({drive.uploaded_files.length}):
              </p>
              <div className="max-h-28 overflow-y-auto space-y-1 text-[11px] font-mono text-slate-600 dark:text-slate-400">
                {drive.uploaded_files.map((uf) => (
                  <p key={uf.drive_file_id} className="truncate">
                    {uf.name} → id:{uf.drive_file_id}
                  </p>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Vertex AI Runtime & GUI Setup Guide */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 space-y-5">
        <div className="flex items-start gap-3">
          <ShieldAlert className="w-5 h-5 text-sky-700 dark:text-sky-400 shrink-0 mt-0.5" aria-hidden="true" />
          <div className="space-y-1">
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-50">
              Vertex AI, IAP ба Cloud Run тохиргоо (Нууц түлхүүр хадгалахгүй)
            </h2>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              Сервер талд ADC + <span className="font-mono">testIamPermissions</span> шалгалт болон IAP signed JWT баталгаажуулалт ажиллана.
            </p>
          </div>
        </div>

        <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 text-xs pt-2 border-t border-slate-200 dark:border-slate-800">
          <div>
            <dt className="text-slate-500 dark:text-slate-400">GCP Project ID</dt>
            <dd className="font-mono text-slate-900 dark:text-slate-100 mt-0.5">{runtime.project_id}</dd>
          </div>
          <div>
            <dt className="text-slate-500 dark:text-slate-400">Model / Voice / Region</dt>
            <dd className="font-mono text-slate-900 dark:text-slate-100 mt-0.5">
              {runtime.model} · {runtime.voice} · {runtime.location}
            </dd>
          </div>
          <div>
            <dt className="text-slate-500 dark:text-slate-400">Одоогийн Runtime Identity</dt>
            <dd className="font-mono text-slate-900 dark:text-slate-100 mt-0.5 break-all">
              {runtime.runtime_identity ?? 'Байхгүй (Preview орчин)'}
            </dd>
          </div>
          <div>
            <dt className="text-slate-500 dark:text-slate-400">Vertex IAM Эрх</dt>
            <dd className="font-mono text-slate-900 dark:text-slate-100 mt-0.5">
              {runtime.vertex_permission_verified ? 'aiplatform.endpoints.predict OK' : 'Баталгаажаагүй'}
            </dd>
          </div>
          <div>
            <dt className="text-slate-500 dark:text-slate-400">Хандалт ба Allowlist</dt>
            <dd className="font-mono text-slate-900 dark:text-slate-100 mt-0.5 break-all">
              IAP:{runtime.iap_enabled ? 'ON' : 'OFF'} · {runtime.owner_allowlist.join(', ')}
            </dd>
          </div>
          <div>
            <dt className="text-slate-500 dark:text-slate-400">Тооцоолсон зардал</dt>
            <dd className="font-semibold text-slate-900 dark:text-slate-100 mt-0.5">
              {runtime.estimated_cost_label}
            </dd>
          </div>
        </dl>

        {/* GUI-first Cloud Run Owner Guide */}
        <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-2 text-xs text-slate-700 dark:text-slate-300">
          <p className="font-semibold text-slate-900 dark:text-slate-100">
            Google Cloud Console дээр хийх дараагийн GUI алхмууд:
          </p>
          <ol className="list-decimal list-inside space-y-1">
            <li>
              <strong>IAM &amp; Admin → Service Accounts</strong> (<span className="font-mono">project-a699c3ff-995a-4b88-add</span>): Тусгай service account үүсгэж, <span className="font-mono">roles/aiplatform.user</span>, <span className="font-mono">roles/storage.objectAdmin</span> (зөвхөн хувийн bucket дээр), <span className="font-mono">roles/datastore.user</span> эрх олгоно (JSON key татахгүй).
            </li>
            <li>
              <strong>Cloud Storage → Buckets</strong>: Хувийн bucket үүсгэж Public access prevention асаана; Cloud Run дээр <span className="font-mono">GCS_BUCKET_NAME</span> хувьсагчийг заана.
            </li>
            <li>
              <strong>Cloud Run → Security / Networking</strong>: IAP (Identity-Aware Proxy) идэвхжүүлж <span className="font-mono">IAP_AUDIENCE</span>, <span className="font-mono">OWNER_EMAIL_ALLOWLIST=zazadada8899@gmail.com</span> хувьсагчдыг тохируулна.
            </li>
          </ol>
        </div>
      </section>

      {/* Event & Error Logs */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 space-y-3">
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-50">
            Үйл явдлын бүртгэл ({events.length})
          </h2>
          <div className="max-h-64 overflow-y-auto divide-y divide-slate-200 dark:divide-slate-800 text-xs">
            {events.length === 0 ? (
              <p className="py-4 text-slate-500 dark:text-slate-400">Одоогоор үйл явдал бүртгэгдээгүй.</p>
            ) : (
              events.slice(0, 20).map((ev) => (
                <div key={ev.id} className="py-2.5 space-y-0.5">
                  <div className="flex items-center justify-between gap-2 font-mono text-slate-500 dark:text-slate-400">
                    <span className="font-semibold text-slate-800 dark:text-slate-200">{ev.event_type}</span>
                    <span>{ev.source_id}</span>
                  </div>
                  <p className="text-slate-700 dark:text-slate-300">{ev.detail}</p>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 space-y-3">
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-50">
            Алдааны лог ({errors.length})
          </h2>
          <div className="max-h-64 overflow-y-auto divide-y divide-slate-200 dark:divide-slate-800 text-xs">
            {errors.length === 0 ? (
              <p className="py-4 text-slate-500 dark:text-slate-400">Алдаа бүртгэгдээгүй.</p>
            ) : (
              errors.slice(0, 20).map((err) => (
                <div key={err.id} className="py-2.5 space-y-0.5">
                  <div className="flex items-center justify-between gap-2 font-mono text-red-700 dark:text-red-400">
                    <span>{err.code} (HTTP {err.http_status ?? '—'})</span>
                    <span>{err.source_id}</span>
                  </div>
                  <p className="text-slate-700 dark:text-slate-300">{err.message}</p>
                </div>
              ))
            )}
          </div>
        </div>
      </section>

      {/* Confirm Create Drive Folder Modal */}
      {confirmCreateFolderOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4"
        >
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-md w-full p-6 space-y-4 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-50">
                Google Drive дээр шинэ хавтас үүсгэх
              </h3>
              <button
                type="button"
                onClick={() => setConfirmCreateFolderOpen(false)}
                className="min-h-[40px] min-w-[40px] flex items-center justify-center text-slate-500 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div>
              <label htmlFor="new-drive-folder" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                Хавтасны нэр
              </label>
              <input
                id="new-drive-folder"
                type="text"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                className="w-full min-h-[44px] px-3 py-2 text-sm bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-900 dark:text-slate-100"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmCreateFolderOpen(false)}
                className="min-h-[44px] px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold cursor-pointer"
              >
                Болих
              </button>
              <button
                type="button"
                disabled={isCreatingFolder || !newFolderName.trim()}
                onClick={() => void handleConfirmCreateFolder()}
                className="min-h-[44px] px-4 py-2 rounded-xl bg-sky-700 hover:bg-sky-800 text-white text-xs font-semibold cursor-pointer disabled:opacity-50"
              >
                {isCreatingFolder ? 'Үүсгэж байна...' : 'Баталгаажуулж үүсгэх'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Explicit Confirmation Modal before uploading WAV + Manifests to Google Drive */}
      {confirmDriveUploadOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4"
        >
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-lg w-full p-6 space-y-4 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-50">
                Google Drive руу файл хуулах баталгаажуулалт
              </h3>
              <button
                type="button"
                disabled={isUploadingDrive}
                onClick={() => setConfirmDriveUploadOpen(false)}
                className="min-h-[40px] min-w-[40px] flex items-center justify-center text-slate-500 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="text-xs text-slate-700 dark:text-slate-300 space-y-2">
              <p>
                Зорилтот хавтас: <strong>{drive.folder_name}</strong> (<span className="font-mono">{drive.folder_id}</span>)
              </p>
              <ul className="list-disc list-inside space-y-1 font-mono bg-slate-50 dark:bg-slate-950 p-3 rounded-xl border border-slate-200 dark:border-slate-800">
                <li>Бодит WAV: {realDownloadable.length} файл</li>
                {includeMockInDriveSync && <li>MOCK_ WAV: {mockDownloadable.length} файл</li>}
                {plannedDriveManifests.map((m) => (
                  <li key={m.kind}>{m.name}</li>
                ))}
              </ul>
            </div>

            {driveProgressText && (
              <p className="text-xs font-mono text-sky-700 dark:text-sky-400">{driveProgressText}</p>
            )}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                disabled={isUploadingDrive}
                onClick={() => setConfirmDriveUploadOpen(false)}
                className="min-h-[44px] px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold cursor-pointer"
              >
                Болих
              </button>
              <button
                type="button"
                disabled={isUploadingDrive}
                onClick={() => void handleConfirmDriveUpload()}
                className="min-h-[44px] px-5 py-2 rounded-xl bg-sky-700 hover:bg-sky-800 text-white text-xs font-semibold cursor-pointer disabled:opacity-50"
              >
                {isUploadingDrive ? 'Хуулж байна...' : 'Одоо Drive руу хуулах'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
