import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  FlaskConical,
  Loader2,
  Lock,
  SkipForward,
  Unplug,
  XCircle,
} from 'lucide-react';
import type { JobStatus, QaStatus } from '../shared/types';

interface JobStatusLabelProps {
  status: JobStatus;
}

/**
 * Unboxed semantic status indicator (zero-pill discipline: icon + crisp text label, never color-only).
 */
export function JobStatusLabel({ status }: JobStatusLabelProps) {
  switch (status) {
    case 'REAL_SUCCESS':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400 whitespace-nowrap">
          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span>REAL_SUCCESS</span>
        </span>
      );
    case 'MOCK':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-700 dark:text-amber-400 whitespace-nowrap">
          <FlaskConical className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span>MOCK (Тест)</span>
        </span>
      );
    case 'RUNNING':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-sky-700 dark:text-sky-400 whitespace-nowrap">
          <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin" aria-hidden="true" />
          <span>RUNNING</span>
        </span>
      );
    case 'FAILED':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-red-700 dark:text-red-400 whitespace-nowrap">
          <XCircle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span>FAILED</span>
        </span>
      );
    case 'AMBIGUOUS_RETRY_REVIEW':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-orange-700 dark:text-orange-400 whitespace-nowrap">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span>AMBIGUOUS_RETRY_REVIEW</span>
        </span>
      );
    case 'SKIPPED':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 dark:text-slate-400 whitespace-nowrap">
          <SkipForward className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span>SKIPPED</span>
        </span>
      );
    case 'NOT_CONNECTED':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 dark:text-slate-400 whitespace-nowrap">
          <Unplug className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span>NOT_CONNECTED</span>
        </span>
      );
    case 'PENDING':
    default:
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400 whitespace-nowrap">
          <Clock className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span>PENDING</span>
        </span>
      );
  }
}

export function QaStatusLabel({ status }: { status: QaStatus }) {
  switch (status) {
    case 'PASS':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400 whitespace-nowrap">
          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span>PASS</span>
        </span>
      );
    case 'REVIEW':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-700 dark:text-amber-400 whitespace-nowrap">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span>REVIEW</span>
        </span>
      );
    case 'FAIL':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-red-700 dark:text-red-400 whitespace-nowrap">
          <XCircle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span>FAIL</span>
        </span>
      );
    case 'QA_PENDING':
    default:
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400 whitespace-nowrap">
          <Clock className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span>QA_PENDING</span>
        </span>
      );
  }
}

export function ReleaseGateLabel({ sourceGate }: { sourceGate: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs font-medium whitespace-nowrap ${
        sourceGate === 'BLOCK_DOMAIN'
          ? 'text-red-700 dark:text-red-400'
          : 'text-slate-600 dark:text-slate-400'
      }`}
    >
      <Lock className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
      <span>{sourceGate === 'BLOCK_DOMAIN' ? 'BLOCK_DOMAIN · Нийтлэх хориотой' : 'BLOCKED_FOR_RELEASE'}</span>
    </span>
  );
}
