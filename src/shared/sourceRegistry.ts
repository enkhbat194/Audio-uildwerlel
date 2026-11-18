import { sha256Utf8 } from './audioAndCrypto';
import type {
  AudioJobReceipt,
  ErrorLogEntry,
  EventLogEntry,
  ImportValidationResult,
  QaRecord,
  SourceRow,
  SpeechStyle,
  SpeedProfile,
} from './types';

export const CANONICAL_CURRICULUM_SHA256 =
  'bf6de3f4872353d13768e79cb53299bfe1927ca3927209334df3e7e548860a03';
export const CANONICAL_DATASET_VERSION = 'v0.9.20';

export const VERTEX_PROJECT_ID = 'project-a699c3ff-995a-4b88-add';
export const VERTEX_LOCATION = 'global';
export const VERTEX_MODEL = 'gemini-3.8-flash-tts';
export const VERTEX_VOICE = 'Achernar';
export const VERTEX_ENDPOINT =
  'https://aiplatform.googleapis.com/v1/projects/project-a699c3ff-995a-4b88-add/locations/global/publishers/google/models/gemini-3.8-flash-tts:generateContent';

export interface SpeechStyleDefinition {
  id: SpeechStyle;
  style_version: string;
  speed_profile: SpeedProfile;
  label_mn: string;
  short_label: string;
  description_mn: string;
  style_prompt: string;
}

export const SPEECH_STYLE_PROFILES: Record<SpeechStyle, SpeechStyleDefinition> = {
  natural: {
    id: 'natural',
    style_version: 'v1',
    speed_profile: 'normal',
    label_mn: 'Natural (Байгалийн яриа)',
    short_label: 'Natural',
    description_mn: 'Өдөр тутмын уугуул чех харилцан ярианы дулаан, амьд өнгө аяс ба байгалийн хэмнэл.',
    style_prompt:
      'Warm, relaxed, authentic conversational Czech. Human-like intonation, natural rhythm, unhurried delivery, clear but not exaggerated articulation.',
  },
  learning_slow: {
    id: 'learning_slow',
    style_version: 'v1',
    speed_profile: 'slow',
    label_mn: 'Learning Slow (Суралцагчид)',
    short_label: 'Learning Slow',
    description_mn: 'Анхан шатны насанд хүрсэн суралцагчид зориулсан тайван, эгшгийн урт богино тод хэмнэл.',
    style_prompt:
      'Calm, clearly articulated Czech for an adult beginner. Moderately slower than natural speech, smooth connected pronunciation, natural vowel lengths, no robotic pauses.',
  },
};

export function getVariantKey(sourceId: string, speechStyle: SpeechStyle): string {
  return `${sourceId}__${speechStyle}`;
}

export function getJobReceiptKey(job: Pick<AudioJobReceipt, 'source_id' | 'speech_style' | 'receipt_key'>): string {
  if (job.receipt_key) return job.receipt_key;
  if (job.speech_style) return getVariantKey(job.source_id, job.speech_style);
  return job.source_id;
}

export function getJobsForSource(
  jobs: Record<string, AudioJobReceipt>,
  sourceId: string
): AudioJobReceipt[] {
  return Object.values(jobs).filter((j) => j.source_id === sourceId);
}

export function getQaForJob(
  qaMap: Record<string, QaRecord>,
  job: Pick<AudioJobReceipt, 'source_id' | 'speech_style' | 'receipt_key'>
): QaRecord | undefined {
  const key = getJobReceiptKey(job);
  if (qaMap[key]) return qaMap[key];
  if (!job.speech_style) return qaMap[job.source_id];
  return undefined;
}

export function isJobDriveEligible(
  job: AudioJobReceipt,
  qaMap: Record<string, QaRecord>
): boolean {
  // A PASS decision applies to one immutable WAV, not to any later regeneration
  // of the same Czech sentence / speech style.
  if (job.is_mock || job.status !== 'REAL_SUCCESS' || job.stale) return false;
  if (job.storage_backend !== 'gcs-private-bucket' || !job.audio_sha256) return false;
  const qaRec = getQaForJob(qaMap, job);
  if (qaRec?.listening_qa !== 'PASS') return false;
  if (qaRec.audio_sha256 !== job.audio_sha256) return false;
  if (qaRec.receipt_key && qaRec.receipt_key !== getJobReceiptKey(job)) return false;
  if (job.speech_style && (qaRec.speech_style !== job.speech_style ||
    qaRec.style_version !== job.style_version)) return false;
  return true;
}

export const SEED_FIRST_FIVE_ROWS: SourceRow[] = [
  {
    pilot_order: 1,
    source_id: 'CZ-A0-M01-L01-PH001',
    lesson_id: 'CZ-A0-M01-L01',
    cs_exact: 'Dobrý den.',
    text_sha256: 'd00f594ba38748a33a764dcbb341c5618ef80c4a8a49821e00dd9226088dd370',
    audio_text_key: 'AUDIO-TEXT-D00F594BA38748',
    dataset_version: 'v0.9.20',
    locale: 'cs-CZ',
    source_type: 'phrase',
    source_gate: 'language_prosody_review',
    source_safe_to_submit: false,
    publish_allowed: false,
    source_match_count: 2,
    notes:
      'First five taken from user-reported 100-list; canonical source exact string verified in packed v0.9.20. Existing single test WAV not attached.',
  },
  {
    pilot_order: 2,
    source_id: 'CZ-A0-M01-L01-PH003',
    lesson_id: 'CZ-A0-M01-L01',
    cs_exact: 'Jak se jmenujete?',
    text_sha256: '9e2b678bd1e7e3de4649ffb6c1d376649a2dc46d0b05e2a99994d784a99f54b3',
    audio_text_key: 'AUDIO-TEXT-9E2B678BD1E7E3',
    dataset_version: 'v0.9.20',
    locale: 'cs-CZ',
    source_type: 'phrase',
    source_gate: 'language_prosody_review',
    source_safe_to_submit: false,
    publish_allowed: false,
    source_match_count: 1,
    notes:
      'First five taken from user-reported 100-list; canonical source exact string verified in packed v0.9.20. Existing single test WAV not attached.',
  },
  {
    pilot_order: 3,
    source_id: 'CZ-A0-M01-L01-PH004',
    lesson_id: 'CZ-A0-M01-L01',
    cs_exact: 'Jsem z Mongolska.',
    text_sha256: 'd12e5e94df47f400714004765a2836caf6a47fa9eda075ec03f51924cc45881f',
    audio_text_key: 'AUDIO-TEXT-D12E5E94DF47F4',
    dataset_version: 'v0.9.20',
    locale: 'cs-CZ',
    source_type: 'phrase',
    source_gate: 'language_prosody_review',
    source_safe_to_submit: false,
    publish_allowed: false,
    source_match_count: 5,
    notes:
      'First five taken from user-reported 100-list; canonical source exact string verified in packed v0.9.20. Existing single test WAV not attached.',
  },
  {
    pilot_order: 4,
    source_id: 'CZ-A0-M01-L01-PH005',
    lesson_id: 'CZ-A0-M01-L01',
    cs_exact: 'Nerozumím.',
    text_sha256: '3dbe64054c73f1083313d5fb2f9b4a01edee2bf952835dd7cac380c247055985',
    audio_text_key: 'AUDIO-TEXT-3DBE64054C73F1',
    dataset_version: 'v0.9.20',
    locale: 'cs-CZ',
    source_type: 'phrase',
    source_gate: 'language_prosody_review',
    source_safe_to_submit: false,
    publish_allowed: false,
    source_match_count: 4,
    notes:
      'First five taken from user-reported 100-list; canonical source exact string verified in packed v0.9.20. Existing single test WAV not attached.',
  },
  {
    pilot_order: 5,
    source_id: 'CZ-A0-M01-L01-PH006',
    lesson_id: 'CZ-A0-M01-L01',
    cs_exact: 'Můžete to prosím zopakovat?',
    text_sha256: 'bf9d9632e1e849fe8ff45221db6602068258960c39055955cc6450e598ebb7ef',
    audio_text_key: 'AUDIO-TEXT-BF9D9632E1E849',
    dataset_version: 'v0.9.20',
    locale: 'cs-CZ',
    source_type: 'phrase',
    source_gate: 'BLOCK_DOMAIN',
    source_safe_to_submit: false,
    publish_allowed: false,
    source_match_count: 5,
    notes:
      'First five taken from user-reported 100-list; canonical source exact string verified in packed v0.9.20. BLOCK_DOMAIN: explicit private-test acknowledgement required.',
  },
];

function parseCsvLines(raw: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let inQuotes = false;

  const clean = raw.replace(/^\uFEFF/, '');
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    const next = clean[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        currentField += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        currentField += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      currentRow.push(currentField);
      currentField = '';
    } else if (ch === '\r' && next === '\n') {
      currentRow.push(currentField);
      rows.push(currentRow);
      currentRow = [];
      currentField = '';
      i++;
    } else if (ch === '\n' || ch === '\r') {
      currentRow.push(currentField);
      rows.push(currentRow);
      currentRow = [];
      currentField = '';
    } else {
      currentField += ch;
    }
  }

  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField);
    rows.push(currentRow);
  }

  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

export function parseAndValidateImport(
  rawText: string,
  format: 'json' | 'csv',
  expectedVersion?: string
): ImportValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const duplicateIds: string[] = [];
  const mismatchedHashes: string[] = [];

  if (!rawText || rawText.trim().length === 0) {
    return {
      valid: false,
      rows: [],
      errors: ['Файл хоосон байна.'],
      warnings: [],
      dataset_version: null,
      duplicate_ids: [],
      mismatched_hashes: [],
    };
  }

  if (rawText.includes('\uFFFD')) {
    errors.push('UTF-8 кодчилол эвдэрсэн (replacement character U+FFFD илэрлээ).');
  }

  let rawObjects: Array<Record<string, unknown>> = [];
  let detectedVersion: string | null = null;

  if (format === 'json') {
    try {
      const parsed = JSON.parse(rawText);
      if (Array.isArray(parsed)) {
        rawObjects = parsed;
      } else if (parsed && typeof parsed === 'object') {
        if (typeof parsed.dataset_version === 'string') {
          detectedVersion = parsed.dataset_version;
        }
        if (
          typeof parsed.curriculum_json_sha256 === 'string' &&
          parsed.curriculum_json_sha256 !== CANONICAL_CURRICULUM_SHA256
        ) {
          warnings.push(
            `Curriculum SHA256 (${parsed.curriculum_json_sha256.slice(0, 12)}…) нь canonical v0.9.20 хашаас өөр байна.`
          );
        }
        if (Array.isArray(parsed.rows)) {
          rawObjects = parsed.rows;
        } else if (Array.isArray(parsed.items)) {
          rawObjects = parsed.items;
        } else {
          errors.push('JSON бүтэц дотор "rows" массив эсвэл шууд массив олдсонгүй.');
        }
      } else {
        errors.push('JSON файл хүчинтэй объект эсвэл массив биш байна.');
      }
    } catch (err) {
      errors.push(
        `JSON задлахад алдаа гарлаа: ${err instanceof Error ? err.message : 'Тодорхойгүй алдаа'}`
      );
    }
  } else {
    const matrix = parseCsvLines(rawText);
    if (matrix.length < 2) {
      errors.push('CSV файл дотор толгой мөр болон өгөгдлийн мөр байх шаардлагатай.');
    } else {
      const headers = matrix[0].map((h) => h.trim());
      for (let i = 1; i < matrix.length; i++) {
        const line = matrix[i];
        const obj: Record<string, unknown> = {};
        headers.forEach((h, idx) => {
          obj[h] = line[idx] ?? '';
        });
        rawObjects.push(obj);
      }
    }
  }

  const seenIds = new Set<string>();
  const seenVersions = new Set<string>();
  if (detectedVersion) seenVersions.add(detectedVersion);
  const validatedRows: SourceRow[] = [];

  rawObjects.forEach((obj, idx) => {
    const rowNum = idx + 1;
    const sourceId = String(obj.source_id ?? obj.canonical_source_id ?? obj.content_id ?? '').trim();
    const lessonId = String(obj.lesson_id ?? obj.lesson ?? '').trim();
    // Preserve literal Czech text without trimming inner whitespace or stripping accents
    const csExactRaw = obj.cs_exact ?? obj.czech_text ?? obj.text;
    const csExact = typeof csExactRaw === 'string' ? csExactRaw : '';

    if (!sourceId) {
      errors.push(`Мөр #${rowNum}: source_id / content_id дутуу байна.`);
      return;
    }
    if (!lessonId) {
      errors.push(`Мөр #${rowNum} (${sourceId}): lesson_id дутуу байна.`);
    }
    if (!csExact) {
      errors.push(`Мөр #${rowNum} (${sourceId}): cs_exact чех өгүүлбэр хоосон байна.`);
    }

    if (seenIds.has(sourceId)) {
      duplicateIds.push(sourceId);
      errors.push(`Давхардсан ID илэрлээ: ${sourceId}`);
    } else {
      seenIds.add(sourceId);
    }

    const rowVersion = String(
      obj.dataset_version ??
        (typeof obj.dataset_source === 'string'
          ? obj.dataset_source.replace(/\s*curriculum$/i, '').trim()
          : '') ??
        detectedVersion ??
        CANONICAL_DATASET_VERSION
    ).trim();

    if (rowVersion) {
      seenVersions.add(rowVersion);
    }

    const computedHash = sha256Utf8(csExact);
    const providedHash = typeof obj.text_sha256 === 'string' ? obj.text_sha256.trim() : '';
    if (providedHash && providedHash !== computedHash) {
      mismatchedHashes.push(sourceId);
      errors.push(
        `${sourceId}: text_sha256 зөрүүтэй байна (өгөгдсөн ${providedHash.slice(0, 10)}… != бодит ${computedHash.slice(0, 10)}…).`
      );
    }

    const sourceGate = String(obj.source_gate ?? 'language_prosody_review');
    const publishAllowed = Boolean(obj.publish_allowed === true || obj.publish_allowed === 'true');
    if (sourceGate === 'BLOCK_DOMAIN' && publishAllowed) {
      errors.push(`${sourceId}: BLOCK_DOMAIN тугтай мөр publish_allowed=true байж болохгүй.`);
    }

    validatedRows.push({
      pilot_order: Number(obj.pilot_order ?? rowNum),
      source_id: sourceId,
      lesson_id: lessonId,
      cs_exact: csExact,
      text_sha256: computedHash,
      audio_text_key:
        typeof obj.audio_text_key === 'string' && obj.audio_text_key.trim()
          ? obj.audio_text_key.trim()
          : `AUDIO-TEXT-${computedHash.slice(0, 12).toUpperCase()}`,
      dataset_version: rowVersion || CANONICAL_DATASET_VERSION,
      locale: String(obj.locale ?? 'cs-CZ'),
      source_type: String(obj.source_type ?? 'phrase'),
      source_gate: sourceGate,
      source_safe_to_submit: Boolean(
        obj.source_safe_to_submit === true || obj.source_safe_to_submit === 'true'
      ),
      publish_allowed: false, // Always non-publication until Curriculum Branch approves
      source_match_count: Number(obj.source_match_count ?? 1),
      notes: String(obj.notes ?? ''),
    });
  });

  if (seenVersions.size > 1) {
    errors.push(
      `Холимог хувилбар илэрлээ (${Array.from(seenVersions).join(', ')}). Нэг импорт дотор зөвхөн нэг dataset_version байх ёстой.`
    );
  }

  const finalVersion = seenVersions.size === 1 ? Array.from(seenVersions)[0] : detectedVersion;
  if (expectedVersion && finalVersion && expectedVersion !== finalVersion) {
    errors.push(
      `Хувилбарын зөрүү: одоогийн эх (${expectedVersion}) болон импортын файл (${finalVersion}) таарахгүй байна.`
    );
  }

  if (validatedRows.length > 0) {
    warnings.push(
      'Анхаар: Импортлогдсон бүх өгүүлбэр дотоод туршилт / үйлдвэрлэлд зориулагдсан бөгөөд Curriculum Branch-ийн зөвшөөрөлгүйгээр нийтлэхгүй.'
    );
  }

  return {
    valid: errors.length === 0 && validatedRows.length > 0,
    rows: validatedRows,
    errors,
    warnings,
    dataset_version: finalVersion,
    duplicate_ids: duplicateIds,
    mismatched_hashes: mismatchedHashes,
  };
}

function escapeCsvCell(value: string | number | boolean | null | undefined): string {
  const str = value === null || value === undefined ? '' : String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function generateManifestCsv(
  sources: SourceRow[],
  jobs: Record<string, AudioJobReceipt>,
  qaMap: Record<string, QaRecord>
): string {
  const header = [
    'content_id',
    'receipt_key',
    'dataset_version',
    'cs_exact_sha256',
    'provider',
    'model',
    'voice',
    'speech_style',
    'style_version',
    'speed_profile',
    'fingerprint',
    'audio_sha256',
    'duration_ms',
    'format',
    'storage_ref',
    'listening_qa',
    'publication_gate',
  ];

  const lines = [header.join(',')];
  for (const row of sources) {
    const rowJobs = getJobsForSource(jobs, row.source_id);
    const itemsToEmit: Array<AudioJobReceipt | null> = rowJobs.length > 0 ? rowJobs : [null];

    for (const job of itemsToEmit) {
      const qa = job ? getQaForJob(qaMap, job) : qaMap[row.source_id];
      const publicationGate =
        row.source_gate === 'BLOCK_DOMAIN' || !row.publish_allowed
          ? 'BLOCKED_FOR_RELEASE'
          : qa?.publication_gate ?? 'BLOCKED_FOR_RELEASE';

      lines.push(
        [
          row.source_id,
          job ? getJobReceiptKey(job) : row.source_id,
          row.dataset_version,
          row.text_sha256,
          job?.provider ?? '',
          job?.model ?? VERTEX_MODEL,
          job?.voice ?? VERTEX_VOICE,
          job?.speech_style ?? '',
          job?.style_version ?? '',
          job?.speed_profile ?? 'normal',
          job?.fingerprint ?? '',
          job?.audio_sha256 ?? '',
          job?.duration_ms ?? '',
          job?.format ?? '',
          job?.storage_ref ?? '',
          qa?.listening_qa ?? 'QA_PENDING',
          publicationGate,
        ]
          .map(escapeCsvCell)
          .join(',')
      );
    }
  }
  return lines.join('\n') + '\n';
}

export function generatePronunciationIssuesCsv(
  sources: SourceRow[],
  qaMap: Record<string, QaRecord>
): string {
  const header = [
    'content_id',
    'qa_key',
    'speech_style',
    'cs_exact',
    'listening_qa',
    'issue_category',
    'notes',
    'publication_gate',
    'updated_at',
  ];
  const lines = [header.join(',')];
  const sourceById = new Map(sources.map((s) => [s.source_id, s]));

  for (const [key, qa] of Object.entries(qaMap)) {
    const row = sourceById.get(qa.source_id);
    if (!row) continue;
    if (qa.listening_qa === 'REVIEW' || qa.listening_qa === 'FAIL' || qa.notes.trim()) {
      lines.push(
        [
          row.source_id,
          qa.qa_key ?? key,
          qa.speech_style ?? '',
          row.cs_exact,
          qa.listening_qa,
          qa.issue_category || 'pronunciation_review',
          qa.notes,
          'BLOCKED_FOR_RELEASE',
          qa.updated_at,
        ]
          .map(escapeCsvCell)
          .join(',')
      );
    }
  }
  return lines.join('\n') + '\n';
}

export function generateEventsCsv(events: EventLogEntry[]): string {
  const header = ['id', 'timestamp', 'event_type', 'source_id', 'mode', 'detail'];
  const lines = [header.join(',')];
  for (const ev of events) {
    lines.push(
      [ev.id, ev.timestamp, ev.event_type, ev.source_id, ev.mode, ev.detail]
        .map(escapeCsvCell)
        .join(',')
    );
  }
  return lines.join('\n') + '\n';
}

export function generateErrorsCsv(errors: ErrorLogEntry[]): string {
  const header = ['id', 'timestamp', 'source_id', 'http_status', 'code', 'message'];
  const lines = [header.join(',')];
  for (const err of errors) {
    lines.push(
      [err.id, err.timestamp, err.source_id, err.http_status ?? '', err.code, err.message]
        .map(escapeCsvCell)
        .join(',')
    );
  }
  return lines.join('\n') + '\n';
}

export function generateSummaryJson(
  sources: SourceRow[],
  realJobs: Record<string, AudioJobReceipt>,
  mockJobs: Record<string, AudioJobReceipt>,
  qaMap: Record<string, QaRecord>
): string {
  const realList = Object.values(realJobs);
  const mockList = Object.values(mockJobs);
  const realCount = realList.filter((j) => j.status === 'REAL_SUCCESS' && !j.is_mock).length;
  const mockCount = mockList.filter((j) => j.is_mock && j.status === 'MOCK').length;
  const failedCount = realList.filter((j) => j.status === 'FAILED').length;
  const qaValues = Object.values(qaMap);
  const qaPass = qaValues.filter((q) => q.listening_qa === 'PASS').length;
  const qaReview = qaValues.filter((q) => q.listening_qa === 'REVIEW').length;
  const qaFail = qaValues.filter((q) => q.listening_qa === 'FAIL').length;

  return JSON.stringify(
    {
      app: 'Ahoj Česko — Audio Factory',
      dataset_version: CANONICAL_DATASET_VERSION,
      canonical_curriculum_sha256: CANONICAL_CURRICULUM_SHA256,
      total_sources: sources.length,
      real_success_count: realCount,
      mock_count: mockCount,
      failed_count: failedCount,
      qa_summary: {
        pass: qaPass,
        review: qaReview,
        fail: qaFail,
        pending: Math.max(0, qaValues.length - qaPass - qaReview - qaFail),
      },
      publication_policy: 'ALL_INTERNAL_PILOT_ONLY_BLOCKED_FOR_RELEASE',
      generated_at: new Date().toISOString(),
    },
    null,
    2
  );
}
