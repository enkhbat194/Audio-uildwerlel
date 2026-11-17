import { CloudOff, Download, FileArchive, FileSpreadsheet, ShieldAlert } from 'lucide-react';
import type { AppStateSnapshot } from '../shared/types';
import { JobStatusLabel } from './StatusBadge';

interface FilesSettingsViewProps {
  state: AppStateSnapshot;
}

export function FilesSettingsView({ state }: FilesSettingsViewProps) {
  const { sources, jobs, runtime, events, errors } = state;

  const downloadableJobs = sources
    .map((row) => ({ row, job: jobs[row.source_id] }))
    .filter(
      (item): item is { row: (typeof sources)[number]; job: NonNullable<(typeof jobs)[string]> } =>
        Boolean(item.job && (item.job.status === 'REAL_SUCCESS' || item.job.status === 'MOCK'))
    );

  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
          Файлууд / Тохиргоо
        </h1>
        <p className="text-xs md:text-sm text-slate-600 dark:text-slate-400">
          Физик WAV болон CSV/JSON manifest татах, Cloud Run / Vertex AI / GCS / Google Drive бодит төлөв.
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
              Бодитоор хадгалагдсан WAV файл болон CSV/JSON бүртгэлийг ZIP архиваар татна. Хоосон загвар файл үүсгэхгүй.
            </p>
          </div>
          <a
            href="/api/export/zip"
            className="min-h-[44px] px-5 py-2.5 rounded-xl bg-sky-700 hover:bg-sky-800 text-white text-sm font-semibold inline-flex items-center justify-center gap-2 whitespace-nowrap shrink-0"
          >
            <FileArchive className="w-4 h-4" aria-hidden="true" />
            <span>ZIP татах ({downloadableJobs.length} WAV + Manifests)</span>
          </a>
        </div>

        {/* Manifest Links */}
        <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
          {[
            { kind: 'results', label: 'AUDIO_RESULTS_MANIFEST.csv' },
            { kind: 'issues', label: 'AUDIO_PRONUNCIATION_ISSUES.csv' },
            { kind: 'events', label: 'events.csv' },
            { kind: 'errors', label: 'errors.csv' },
            { kind: 'summary', label: 'summary.json' },
          ].map((m) => (
            <a
              key={m.kind}
              href={`/api/export/manifest/${m.kind}`}
              className="min-h-[40px] px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-mono text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 inline-flex items-center gap-1.5"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" aria-hidden="true" />
              <span>{m.label}</span>
            </a>
          ))}
        </div>

        {/* Physical WAV list */}
        <div className="divide-y divide-slate-200 dark:divide-slate-800 border-t border-slate-200 dark:border-slate-800">
          {downloadableJobs.length === 0 ? (
            <p className="py-6 text-sm text-slate-500 dark:text-slate-400">
              Одоогоор татаж авах боломжтой физик WAV файл алга.
            </p>
          ) : (
            downloadableJobs.map(({ row, job }) => (
              <div key={row.source_id} className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="space-y-0.5 min-w-0">
                  <div className="flex items-center gap-2 text-xs font-mono text-slate-500 dark:text-slate-400">
                    <span className="font-semibold text-slate-800 dark:text-slate-200">{job.filename}</span>
                    <JobStatusLabel status={job.status} />
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-400 font-mono tabular-nums truncate">
                    {row.cs_exact} · {job.duration_ms} ms · SHA256: {job.audio_sha256?.slice(0, 16)}…
                  </p>
                </div>
                <a
                  href={`/api/audio/${encodeURIComponent(job.filename)}`}
                  download={job.filename}
                  className="min-h-[40px] px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 inline-flex items-center gap-1.5 self-start sm:self-auto shrink-0"
                >
                  <Download className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>WAV татах</span>
                </a>
              </div>
            ))
          )}
        </div>
      </section>

      {/* Cloud Storage & Google Drive Integration Status */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 space-y-3">
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-50">
            Google Cloud Storage (Хувийн Bucket)
          </h2>
          <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">
            {runtime.storage_backend === 'gcs-private-bucket' && runtime.gcs_bucket
              ? `Холбогдсон: gs://${runtime.gcs_bucket}`
              : 'Тохируулаагүй (Одоогоор Preview локал диск)'}
          </p>
          <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
            Cloud Run дээр <span className="font-mono">GCS_BUCKET_NAME</span> орчны хувьсагч болон <span className="font-mono">roles/storage.objectAdmin</span> эрх олгосны дараа бүх бодит WAV болон manifest шууд хувийн bucket-д хадгалагдана.
          </p>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-50">
              Google Drive синк (Сонголтоор)
            </h2>
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-600 dark:text-slate-400">
              <CloudOff className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Not configured</span>
            </span>
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
            Google Drive OAuth холболт хийгдээгүй (Phase D). Хуурамч синк хийхгүй тул холбогдох товч түр идэвхгүй байна; дээрх ZIP болон WAV таталтыг ашиглана уу.
          </p>
          <button
            type="button"
            disabled
            className="min-h-[44px] px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-400 dark:text-slate-500 cursor-not-allowed"
          >
            Google Drive холбох (OAuth тохируулаагүй)
          </button>
        </div>
      </section>

      {/* Vertex AI Runtime & GUI Setup Guide */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 space-y-5">
        <div className="flex items-start gap-3">
          <ShieldAlert className="w-5 h-5 text-sky-700 dark:text-sky-400 shrink-0 mt-0.5" aria-hidden="true" />
          <div className="space-y-1">
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-50">
              Vertex AI ба Cloud Run тохиргоо (Нууц түлхүүр дэлгэцэнд гарахгүй)
            </h2>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              Бүх Vertex дуудлага зөвхөн сервер талд Application Default Credentials (ADC)-аар ажиллана.
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
            <dd className="font-mono text-slate-900 dark:text-slate-100 mt-0.5">
              {runtime.runtime_identity ?? 'Байхгүй (Preview орчин)'}
            </dd>
          </div>
          <div>
            <dt className="text-slate-500 dark:text-slate-400">Хурдны хязгаар / Багц</dt>
            <dd className="font-mono tabular-nums text-slate-900 dark:text-slate-100 mt-0.5">
              {runtime.rate_limit_rpm} req/min · First run max={runtime.max_first_batch}
            </dd>
          </div>
          <div>
            <dt className="text-slate-500 dark:text-slate-400">Хандалтын горим</dt>
            <dd className="font-mono text-slate-900 dark:text-slate-100 mt-0.5">
              {runtime.auth_mode === 'iap-or-allowlist' ? 'Owner Allowlist / IAP' : 'Preview Local'}
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
            Эзэмшигчийн Cloud Run GUI тохиргооны алхмууд (Phase B):
          </p>
          <ol className="list-decimal list-inside space-y-1">
            <li>Google Cloud Console → <strong>IAM &amp; Admin → Service Accounts</strong> дотор <span className="font-mono">project-a699c3ff-995a-4b88-add</span> төсөл дээр тусгай service account үүсгэнэ.</li>
            <li>Зөвхөн <strong>Vertex AI User</strong> (<span className="font-mono">roles/aiplatform.user</span>) болон хувийн GCS bucket дээрх <strong>Storage Object Admin</strong> эрх олгоно (JSON key татахгүй).</li>
            <li><strong>Cloud Run → Security</strong> хэсэгт уг service account-ийг холбож, <strong>Require authentication / IAP</strong> болон <span className="font-mono">OWNER_EMAIL_ALLOWLIST</span> тохируулна.</li>
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
    </div>
  );
}
