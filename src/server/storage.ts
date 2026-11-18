import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import firebaseConfig from '../../firebase-applet-config.json' with { type: 'json' };
import {
  CANONICAL_CURRICULUM_SHA256,
  CANONICAL_DATASET_VERSION,
  SEED_FIRST_FIVE_ROWS,
  getJobReceiptKey,
} from '../shared/sourceRegistry';
import type {
  AudioJobReceipt,
  DriveSelection,
  ErrorLogEntry,
  EventLogEntry,
  QaRecord,
  SourceRow,
} from '../shared/types';
import { getAdcAccessToken } from './vertexTts';

export interface PersistedStore {
  canonical_curriculum_sha256: string;
  dataset_version: string;
  sources: SourceRow[];
  real_jobs: Record<string, AudioJobReceipt>;
  mock_jobs: Record<string, AudioJobReceipt>;
  qa: Record<string, QaRecord>;
  events: EventLogEntry[];
  errors: ErrorLogEntry[];
  drive: DriveSelection;
}

const DATA_DIR = path.resolve(process.cwd(), '.data');
const REAL_AUDIO_DIR = path.join(DATA_DIR, 'audio', 'real');
const MOCK_AUDIO_DIR = path.join(DATA_DIR, 'audio', 'mock');
const STATE_FILE = path.join(DATA_DIR, 'state.json');

export const FIRESTORE_DATABASE_ID =
  process.env.FIRESTORE_DATABASE_ID?.trim() ||
  (firebaseConfig as any).firestoreDatabaseId ||
  '(default)';

function ensureDirs() {
  for (const dir of [DATA_DIR, REAL_AUDIO_DIR, MOCK_AUDIO_DIR]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}

function buildInitialQaMap(sources: SourceRow[]): Record<string, QaRecord> {
  const qa: Record<string, QaRecord> = {};
  const now = new Date().toISOString();
  for (const row of sources) {
    qa[row.source_id] = {
      source_id: row.source_id,
      listening_qa: 'QA_PENDING',
      publication_gate: 'BLOCKED_FOR_RELEASE',
      issue_category: '',
      notes: '',
      reviewer: 'owner',
      updated_at: now,
    };
  }
  return qa;
}

function defaultStore(): PersistedStore {
  return {
    canonical_curriculum_sha256: CANONICAL_CURRICULUM_SHA256,
    dataset_version: CANONICAL_DATASET_VERSION,
    sources: SEED_FIRST_FIVE_ROWS,
    real_jobs: {},
    mock_jobs: {},
    qa: buildInitialQaMap(SEED_FIRST_FIVE_ROWS),
    events: [],
    errors: [],
    drive: {
      folder_id: null,
      folder_name: null,
      last_synced_at: null,
      uploaded_files: [],
    },
  };
}

export function loadStore(): PersistedStore {
  ensureDirs();
  if (!fs.existsSync(STATE_FILE)) {
    const initial = defaultStore();
    saveStore(initial);
    return initial;
  }

  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    const parsed = JSON.parse(raw) as Partial<PersistedStore> & { jobs?: Record<string, AudioJobReceipt> };
    const store = defaultStore();
    if (Array.isArray(parsed.sources) && parsed.sources.length > 0) {
      store.sources = parsed.sources;
    }
    store.dataset_version = parsed.dataset_version ?? CANONICAL_DATASET_VERSION;
    store.real_jobs = parsed.real_jobs ?? {};
    store.mock_jobs = parsed.mock_jobs ?? {};
    // Migrate legacy single jobs map cleanly without mixing mock into real
    if (parsed.jobs && !parsed.real_jobs && !parsed.mock_jobs) {
      for (const [k, job] of Object.entries(parsed.jobs)) {
        if (job.is_mock) store.mock_jobs[k] = job;
        else if (job.status === 'REAL_SUCCESS') store.real_jobs[k] = job;
      }
    }
    store.qa = parsed.qa ?? buildInitialQaMap(store.sources);
    store.events = parsed.events ?? [];
    store.errors = parsed.errors ?? [];
    store.drive = parsed.drive ?? store.drive;
    return store;
  } catch {
    const fallback = defaultStore();
    saveStore(fallback);
    return fallback;
  }
}

export function saveStore(store: PersistedStore): void {
  ensureDirs();
  const tmpFile = `${STATE_FILE}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify(store, null, 2), 'utf8');
  fs.renameSync(tmpFile, STATE_FILE);
}

/**
 * Strictly isolated path resolver: MOCK and REAL audio files NEVER share a directory or filename path.
 */
export function getAudioFilePath(scope: 'real' | 'mock', filename: string): string {
  ensureDirs();
  const safeName = path.basename(filename);
  return path.join(scope === 'real' ? REAL_AUDIO_DIR : MOCK_AUDIO_DIR, safeName);
}

export function writeScopedAudioFile(
  scope: 'real' | 'mock',
  filename: string,
  bytes: Uint8Array
): {
  fullPath: string;
  sha256: string;
  byteLength: number;
} {
  ensureDirs();
  const fullPath = getAudioFilePath(scope, filename);
  fs.writeFileSync(fullPath, bytes);
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  return {
    fullPath,
    sha256,
    byteLength: bytes.byteLength,
  };
}

export function verifyScopedAudioFile(
  scope: 'real' | 'mock',
  filename: string,
  expectedSha256?: string | null
): boolean {
  const fullPath = getAudioFilePath(scope, filename);
  if (!fs.existsSync(fullPath)) return false;
  if (!expectedSha256) return true;
  const bytes = fs.readFileSync(fullPath);
  const actual = crypto.createHash('sha256').update(bytes).digest('hex');
  return actual === expectedSha256;
}

export function readScopedAudioFile(scope: 'real' | 'mock', filename: string): Buffer | null {
  const fullPath = getAudioFilePath(scope, filename);
  if (!fs.existsSync(fullPath)) return null;
  return fs.readFileSync(fullPath);
}

export function deleteScopedAudioFile(scope: 'real' | 'mock', filename: string): void {
  const fullPath = getAudioFilePath(scope, filename);
  if (fs.existsSync(fullPath)) {
    fs.unlinkSync(fullPath);
  }
}

export function appendEvent(
  store: PersistedStore,
  event: Omit<EventLogEntry, 'id' | 'timestamp'>
): EventLogEntry {
  const entry: EventLogEntry = {
    id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    timestamp: new Date().toISOString(),
    ...event,
  };
  store.events = [entry, ...store.events].slice(0, 200);
  return entry;
}

export function appendError(
  store: PersistedStore,
  err: Omit<ErrorLogEntry, 'id' | 'timestamp'>
): ErrorLogEntry {
  const entry: ErrorLogEntry = {
    id: `err_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    timestamp: new Date().toISOString(),
    ...err,
  };
  store.errors = [entry, ...store.errors].slice(0, 200);
  return entry;
}

function toFirestoreValue(val: unknown): Record<string, unknown> {
  if (val === null || val === undefined) return { nullValue: null };
  if (typeof val === 'string') return { stringValue: val };
  if (typeof val === 'boolean') return { booleanValue: val };
  if (typeof val === 'number') {
    return Number.isInteger(val) ? { integerValue: String(val) } : { doubleValue: val };
  }
  if (Array.isArray(val)) {
    return { arrayValue: { values: val.map((item) => toFirestoreValue(item)) } };
  }
  if (typeof val === 'object') {
    const fields: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      if (v !== undefined) fields[k] = toFirestoreValue(v);
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(val) };
}

function toFirestoreFields(obj: Record<string, unknown>): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) fields[k] = toFirestoreValue(v);
  }
  return fields;
}

async function patchFirestoreDoc(
  baseUrl: string,
  token: string,
  docPath: string,
  payload: Record<string, unknown>
): Promise<boolean> {
  const res = await fetch(`${baseUrl}/${docPath}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ fields: toFirestoreFields(payload) }),
  });
  return res.ok;
}

/**
 * Syncs server state snapshot (meta, sources, real_jobs, qa_records) to Firestore REST API
 * when Cloud Run ADC is available so Cloud Run never relies on ephemeral disk as permanent state.
 */
export async function syncSnapshotToFirestoreAdc(
  store: PersistedStore,
  ownerUid: string
): Promise<boolean> {
  try {
    const token = await getAdcAccessToken();
    const projectId = firebaseConfig.projectId || 'project-a699c3ff-995a-4b88-add';
    const baseUrl = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
      projectId
    )}/databases/${encodeURIComponent(FIRESTORE_DATABASE_ID)}/documents`;

    const now = new Date().toISOString();
    const metaOk = await patchFirestoreDoc(baseUrl, token, 'factory_meta/config', {
      dataset_version: store.dataset_version,
      canonical_curriculum_sha256: store.canonical_curriculum_sha256,
      drive_folder_id: store.drive.folder_id,
      drive_folder_name: store.drive.folder_name,
      ownerUid,
      updatedAt: now,
    });

    await Promise.all([
      ...store.sources.map((row) =>
        patchFirestoreDoc(baseUrl, token, `sources/${encodeURIComponent(row.source_id)}`, {
          ...row,
          publish_allowed: row.source_gate === 'BLOCK_DOMAIN' ? false : row.publish_allowed,
          ownerUid,
          updatedAt: now,
        })
      ),
      ...Object.values(store.real_jobs).map((job) =>
        patchFirestoreDoc(
          baseUrl,
          token,
          `real_jobs/${encodeURIComponent(getJobReceiptKey(job))}`,
          {
            ...job,
            ownerUid,
          }
        )
      ),
      ...Object.entries(store.qa).map(([key, qa]) =>
        patchFirestoreDoc(
          baseUrl,
          token,
          `qa_records/${encodeURIComponent(qa.qa_key ?? key)}`,
          {
            ...qa,
            ownerUid,
          }
        )
      ),
    ]);

    return metaOk;
  } catch {
    return false;
  }
}
