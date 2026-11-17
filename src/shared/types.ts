export type ExecutionMode = 'mock' | 'vertex';

export type SpeedProfile = 'normal' | 'slow';

export type JobStatus =
  | 'NOT_CONNECTED'
  | 'PENDING'
  | 'RUNNING'
  | 'MOCK'
  | 'REAL_SUCCESS'
  | 'FAILED'
  | 'AMBIGUOUS_RETRY_REVIEW'
  | 'SKIPPED';

export type QaStatus = 'QA_PENDING' | 'PASS' | 'REVIEW' | 'FAIL';

export type PublicationGate = 'BLOCKED_FOR_RELEASE' | 'INTERNAL_PILOT_ONLY';

export type SourceGate = 'language_prosody_review' | 'BLOCK_DOMAIN' | string;

export interface SourceRow {
  pilot_order: number;
  source_id: string;
  lesson_id: string;
  cs_exact: string;
  text_sha256: string;
  audio_text_key: string;
  dataset_version: string;
  locale: string;
  source_type: string;
  source_gate: SourceGate;
  source_safe_to_submit: boolean;
  publish_allowed: boolean;
  source_match_count: number;
  notes: string;
}

export interface AudioJobReceipt {
  source_id: string;
  dataset_version: string;
  cs_exact_sha256: string;
  fingerprint: string;
  filename: string;
  provider: 'vertex-ai' | 'local-mock-synth';
  model: string;
  voice: string;
  speed_profile: SpeedProfile;
  status: JobStatus;
  is_mock: boolean;
  http_status: number | null;
  provider_request_id: string | null;
  attempts: number;
  last_error: string | null;
  audio_sha256: string | null;
  sample_rate: number | null;
  channels: number | null;
  bit_depth: number | null;
  duration_ms: number | null;
  file_size: number | null;
  peak_dbfs: number | null;
  rms_dbfs: number | null;
  format: 'wav' | null;
  storage_ref: string | null;
  storage_backend: 'local-preview' | 'gcs-private-bucket' | null;
  stale: boolean;
  created_at: string;
  updated_at: string;
}

export interface QaRecord {
  source_id: string;
  listening_qa: QaStatus;
  publication_gate: PublicationGate;
  issue_category: string;
  notes: string;
  reviewer: string;
  updated_at: string;
}

export interface EventLogEntry {
  id: string;
  timestamp: string;
  event_type: string;
  source_id: string;
  mode: ExecutionMode | 'system';
  detail: string;
}

export interface ErrorLogEntry {
  id: string;
  timestamp: string;
  source_id: string;
  http_status: number | null;
  code: string;
  message: string;
}

export interface CloudRuntimeStatus {
  project_id: string;
  location: string;
  model: string;
  voice: string;
  endpoint: string;
  vertex_connected: boolean;
  adc_available: boolean;
  runtime_identity: string | null;
  storage_backend: 'local-preview' | 'gcs-private-bucket';
  gcs_bucket: string | null;
  firestore_connected: boolean;
  drive_connected: boolean;
  drive_folder_name: string | null;
  auth_mode: 'preview-local' | 'iap-or-allowlist';
  owner_email: string | null;
  estimated_cost_label: string;
  rate_limit_rpm: number;
  max_first_batch: number;
  adc_error: string | null;
}

export interface AppStateSnapshot {
  canonical_curriculum_sha256: string;
  dataset_version: string;
  sources: SourceRow[];
  jobs: Record<string, AudioJobReceipt>;
  qa: Record<string, QaRecord>;
  events: EventLogEntry[];
  errors: ErrorLogEntry[];
  runtime: CloudRuntimeStatus;
}

export interface ImportValidationResult {
  valid: boolean;
  rows: SourceRow[];
  errors: string[];
  warnings: string[];
  dataset_version: string | null;
  duplicate_ids: string[];
  mismatched_hashes: string[];
}
