import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  CANONICAL_CURRICULUM_SHA256,
  CANONICAL_DATASET_VERSION,
  SEED_FIRST_FIVE_ROWS,
} from '../shared/sourceRegistry';
import type {
  AudioJobReceipt,
  ErrorLogEntry,
  EventLogEntry,
  QaRecord,
  SourceRow,
} from '../shared/types';

export interface PersistedStore {
  canonical_curriculum_sha256: string;
  dataset_version: string;
  sources: SourceRow[];
  jobs: Record<string, AudioJobReceipt>;
  qa: Record<string, QaRecord>;
  events: EventLogEntry[];
  errors: ErrorLogEntry[];
}

const DATA_DIR = path.resolve(process.cwd(), '.data');
const AUDIO_DIR = path.join(DATA_DIR, 'audio');
const STATE_FILE = path.join(DATA_DIR, 'state.json');

function ensureDirs() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(AUDIO_DIR)) {
    fs.mkdirSync(AUDIO_DIR, { recursive: true });
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

export function loadStore(): PersistedStore {
  ensureDirs();
  if (!fs.existsSync(STATE_FILE)) {
    const initial: PersistedStore = {
      canonical_curriculum_sha256: CANONICAL_CURRICULUM_SHA256,
      dataset_version: CANONICAL_DATASET_VERSION,
      sources: SEED_FIRST_FIVE_ROWS,
      jobs: {},
      qa: buildInitialQaMap(SEED_FIRST_FIVE_ROWS),
      events: [],
      errors: [],
    };
    saveStore(initial);
    return initial;
  }

  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    const parsed = JSON.parse(raw) as PersistedStore;
    if (!Array.isArray(parsed.sources) || parsed.sources.length === 0) {
      parsed.sources = SEED_FIRST_FIVE_ROWS;
    }
    parsed.jobs = parsed.jobs ?? {};
    parsed.qa = parsed.qa ?? buildInitialQaMap(parsed.sources);
    parsed.events = parsed.events ?? [];
    parsed.errors = parsed.errors ?? [];
    return parsed;
  } catch {
    const fallback: PersistedStore = {
      canonical_curriculum_sha256: CANONICAL_CURRICULUM_SHA256,
      dataset_version: CANONICAL_DATASET_VERSION,
      sources: SEED_FIRST_FIVE_ROWS,
      jobs: {},
      qa: buildInitialQaMap(SEED_FIRST_FIVE_ROWS),
      events: [],
      errors: [],
    };
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

export function getAudioFilePath(filename: string): string {
  ensureDirs();
  const safeName = path.basename(filename);
  return path.join(AUDIO_DIR, safeName);
}

export function writeAudioFile(filename: string, bytes: Uint8Array): {
  fullPath: string;
  sha256: string;
  byteLength: number;
} {
  ensureDirs();
  const fullPath = getAudioFilePath(filename);
  fs.writeFileSync(fullPath, bytes);
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  return {
    fullPath,
    sha256,
    byteLength: bytes.byteLength,
  };
}

export function verifyPhysicalAudioFile(filename: string, expectedSha256?: string | null): boolean {
  const fullPath = getAudioFilePath(filename);
  if (!fs.existsSync(fullPath)) return false;
  if (!expectedSha256) return true;
  const bytes = fs.readFileSync(fullPath);
  const actual = crypto.createHash('sha256').update(bytes).digest('hex');
  return actual === expectedSha256;
}

export function readAudioFile(filename: string): Buffer | null {
  const fullPath = getAudioFilePath(filename);
  if (!fs.existsSync(fullPath)) return null;
  return fs.readFileSync(fullPath);
}

export function deleteAudioFile(filename: string): void {
  const fullPath = getAudioFilePath(filename);
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
