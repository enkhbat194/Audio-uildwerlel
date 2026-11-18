import crypto from 'node:crypto';
import express from 'express';
import JSZip from 'jszip';
import path from 'node:path';
import {
  buildDeterministicFilename,
  computeGenerationFingerprint,
  generateMockSpeechWav,
  parseWavHeader,
  sha256Utf8,
} from '../shared/audioAndCrypto';
import {
  VERTEX_MODEL,
  VERTEX_VOICE,
  generateErrorsCsv,
  generateEventsCsv,
  generateManifestCsv,
  generatePronunciationIssuesCsv,
  generateSummaryJson,
  parseAndValidateImport,
} from '../shared/sourceRegistry';
import type {
  AudioJobReceipt,
  CloudRuntimeStatus,
  ExecutionMode,
  SpeedProfile,
} from '../shared/types';
import { authenticateOwnerRequest, type AuthVerifierDeps } from './auth';
import {
  appendError,
  appendEvent,
  deleteScopedAudioFile,
  loadStore,
  readScopedAudioFile,
  saveStore,
  syncSnapshotToFirestoreAdc,
  verifyScopedAudioFile,
  writeScopedAudioFile,
} from './storage';
import {
  callVertexTtsWithRetry,
  downloadFromGcsPrivateBucket,
  probeCloudRuntimeStatus,
  uploadToGcsPrivateBucket,
  type VertexTtsCallResult,
} from './vertexTts';

export const FIRST_PILOT_SOURCE_ID = 'CZ-A0-M01-L01-PH001';

export interface ApiRouterOptions {
  authDeps?: AuthVerifierDeps;
  runtimeProbe?: (forceRefresh?: boolean, firstRealWavVerified?: boolean) => Promise<CloudRuntimeStatus>;
  ttsCaller?: (exactCzechText: string, voice?: string, maxRetries?: number) => Promise<VertexTtsCallResult>;
  gcsUploader?: (bucketName: string, objectName: string, bytes: Uint8Array, contentType?: string) => Promise<string>;
}

export function createApiRouter(options: ApiRouterOptions = {}): express.Router {
  const probeRuntime = options.runtimeProbe ?? probeCloudRuntimeStatus;
  const invokeVertexTts = options.ttsCaller ?? callVertexTtsWithRetry;
  const uploadToGcs = options.gcsUploader ?? uploadToGcsPrivateBucket;
  const router = express.Router();
  const rateBucket = new Map<string, number[]>();

  function checkRateLimit(key: string, maxPerMinute: number): boolean {
    const now = Date.now();
    const windowStart = now - 60_000;
    const timestamps = (rateBucket.get(key) ?? []).filter((t) => t > windowStart);
    if (timestamps.length >= maxPerMinute) {
      return false;
    }
    timestamps.push(now);
    rateBucket.set(key, timestamps);
    return true;
  }

  // Unauthenticated minimal liveness probe ONLY (never leaks state or secrets)
  router.get('/health', (_req, res) => {
    res.json({
      ok: true,
      app: 'Ahoj Česko — Audio Factory',
      auth_required: true,
    });
  });

  // Session probe for detecting Cloud Run IAP without triggering 401 console noise
  router.get('/auth/session', async (req, res) => {
    const authResult = await authenticateOwnerRequest(req.headers, options.authDeps);
    res.json({
      authenticated: authResult.authenticated,
      method: authResult.authenticated ? authResult.method : null,
    });
  });

  // Fail-closed owner authentication + CSRF protection for ALL other /api/* routes
  router.use(async (req, res, next) => {
    const authResult = await authenticateOwnerRequest(req.headers, options.authDeps);
    if (!authResult.authenticated) {
      res.status(authResult.statusCode).json({
        error: authResult.error ?? 'Unauthorized',
        code: 'OWNER_AUTH_REQUIRED',
      });
      return;
    }

    (req as any).ownerAuth = authResult;

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const xrw = req.headers['x-requested-with'];
      if (xrw !== 'AhojAudioFactory') {
        res.status(403).json({
          error: 'CSRF хамгаалалт: X-Requested-With толгой дутуу байна.',
          code: 'CSRF_HEADER_MISSING',
        });
        return;
      }
    }
    next();
  });

  router.get('/state', async (_req, res) => {
    const store = loadStore();
    const firstReal = store.real_jobs[FIRST_PILOT_SOURCE_ID];
    const firstRealVerified = Boolean(
      firstReal &&
        firstReal.status === 'REAL_SUCCESS' &&
        !firstReal.is_mock &&
        Boolean(firstReal.audio_sha256)
    );
    const runtime = await probeRuntime(false, firstRealVerified);

    let dirty = false;
    for (const row of store.sources) {
      // Reconcile REAL jobs
      const realJob = store.real_jobs[row.source_id];
      if (realJob) {
        const fp = computeGenerationFingerprint({
          source_id: row.source_id,
          dataset_version: row.dataset_version,
          exact_text_sha256: row.text_sha256,
          model: realJob.model,
          voice: realJob.voice,
          speed_profile: realJob.speed_profile,
        });
        const isStale = realJob.fingerprint !== fp;
        if (realJob.stale !== isStale) {
          realJob.stale = isStale;
          dirty = true;
        }
        if (
          realJob.status === 'REAL_SUCCESS' &&
          realJob.storage_backend === 'local-preview-ephemeral' &&
          !verifyScopedAudioFile('real', realJob.filename, realJob.audio_sha256)
        ) {
          realJob.status = 'FAILED';
          realJob.last_error = 'Локал бодит WAV файл олдсонгүй эсвэл SHA256 зөрүүтэй байна.';
          dirty = true;
        }
      }

      // Reconcile isolated MOCK jobs
      const mockJob = store.mock_jobs[row.source_id];
      if (mockJob) {
        const fp = computeGenerationFingerprint({
          source_id: row.source_id,
          dataset_version: row.dataset_version,
          exact_text_sha256: row.text_sha256,
          model: mockJob.model,
          voice: mockJob.voice,
          speed_profile: mockJob.speed_profile,
        });
        const isStale = mockJob.fingerprint !== fp;
        if (mockJob.stale !== isStale) {
          mockJob.stale = isStale;
          dirty = true;
        }
        if (
          mockJob.status === 'MOCK' &&
          !verifyScopedAudioFile('mock', mockJob.filename, mockJob.audio_sha256)
        ) {
          mockJob.status = 'FAILED';
          mockJob.last_error = 'Локал MOCK WAV файл олдсонгүй.';
          dirty = true;
        }
      }
    }
    if (dirty) saveStore(store);

    res.json({
      canonical_curriculum_sha256: store.canonical_curriculum_sha256,
      dataset_version: store.dataset_version,
      sources: store.sources,
      real_jobs: store.real_jobs,
      mock_jobs: store.mock_jobs,
      qa: store.qa,
      events: store.events,
      errors: store.errors,
      drive: store.drive,
      runtime,
    });
  });

  router.post('/runtime/refresh', async (_req, res) => {
    const store = loadStore();
    const firstReal = store.real_jobs[FIRST_PILOT_SOURCE_ID];
    const firstRealVerified = Boolean(
      firstReal && firstReal.status === 'REAL_SUCCESS' && !firstReal.is_mock
    );
    const runtime = await probeRuntime(true, firstRealVerified);
    res.json({ runtime });
  });

  router.post('/sources/import', async (req, res) => {
    const { rawText, format, replaceExisting, sourceOrigin = 'upload' } = req.body ?? {};
    if (typeof rawText !== 'string' || (format !== 'json' && format !== 'csv')) {
      res.status(400).json({ error: 'Хүчингүй импорт хүсэлт (rawText болон json/csv формат шаардлагатай).' });
      return;
    }

    const store = loadStore();
    const validation = parseAndValidateImport(rawText, format);
    if (!validation.valid) {
      res.status(400).json({ validation });
      return;
    }

    if (replaceExisting) {
      store.sources = validation.rows;
    } else {
      const byId = new Map(store.sources.map((r) => [r.source_id, r]));
      for (const row of validation.rows) {
        byId.set(row.source_id, row);
      }
      store.sources = Array.from(byId.values()).sort((a, b) => a.pilot_order - b.pilot_order);
    }

    if (validation.dataset_version) {
      store.dataset_version = validation.dataset_version;
    }

    const now = new Date().toISOString();
    for (const row of store.sources) {
      if (!store.qa[row.source_id]) {
        store.qa[row.source_id] = {
          source_id: row.source_id,
          listening_qa: 'QA_PENDING',
          publication_gate: 'BLOCKED_FOR_RELEASE',
          issue_category: '',
          notes: '',
          reviewer: (req as any).ownerAuth?.email ?? 'owner',
          updated_at: now,
        };
      }
      for (const receiptMap of [store.real_jobs, store.mock_jobs]) {
        const existingJob = receiptMap[row.source_id];
        if (existingJob) {
          const fp = computeGenerationFingerprint({
            source_id: row.source_id,
            dataset_version: row.dataset_version,
            exact_text_sha256: row.text_sha256,
            model: existingJob.model,
            voice: existingJob.voice,
            speed_profile: existingJob.speed_profile,
          });
          existingJob.stale = existingJob.fingerprint !== fp;
        }
      }
    }

    appendEvent(store, {
      event_type: sourceOrigin === 'google-drive' ? 'DRIVE_SOURCE_IMPORT' : 'SOURCE_IMPORT',
      source_id: 'BATCH',
      mode: 'system',
      detail: `${validation.rows.length} мөр (${format.toUpperCase()}) импортлогдож баталгаажлаа.`,
    });
    saveStore(store);

    const ownerUid = (req as any).ownerAuth?.uid ?? 'owner';
    await syncSnapshotToFirestoreAdc(store, ownerUid);

    res.json({
      validation,
      sources: store.sources,
      qa: store.qa,
      real_jobs: store.real_jobs,
      mock_jobs: store.mock_jobs,
    });
  });

  router.post('/tts/generate', async (req, res) => {
    const {
      sourceId,
      voice = VERTEX_VOICE,
      speedProfile = 'normal',
      mode = 'vertex',
      acknowledgePrivateTest = false,
      forceRegenerate = false,
    } = req.body ?? {};

    if (typeof sourceId !== 'string' || !sourceId.trim()) {
      res.status(400).json({ error: 'sourceId заавал шаардлагатай.' });
      return;
    }

    if (speedProfile !== 'normal') {
      res.status(400).json({
        error: 'Slow хурдны горим туршилт/зөвшөөрөлгүй тул түр хаалттай байна. Зөвхөн Normal горимыг ашиглана уу.',
      });
      return;
    }

    const execMode: ExecutionMode = mode === 'mock' ? 'mock' : 'vertex';
    const store = loadStore();
    const firstReal = store.real_jobs[FIRST_PILOT_SOURCE_ID];
    const firstRealVerified = Boolean(
      firstReal && firstReal.status === 'REAL_SUCCESS' && !firstReal.is_mock
    );
    const runtime = await probeRuntime(false, firstRealVerified);

    const ownerKey = (req as any).ownerAuth?.email ?? req.ip ?? 'owner';
    if (!checkRateLimit(ownerKey, runtime.rate_limit_rpm)) {
      res.status(429).json({
        error: `Хурдны хязгаар (${runtime.rate_limit_rpm} хүсэлт/мин) хэтэрлээ. Түр хүлээнэ үү.`,
      });
      return;
    }

    const row = store.sources.find((s) => s.source_id === sourceId);
    if (!row) {
      res.status(404).json({ error: `Эх мөр олдсонгүй: ${sourceId}` });
      return;
    }

    const computedTextSha = sha256Utf8(row.cs_exact);
    if (computedTextSha !== row.text_sha256) {
      res.status(409).json({
        error: `${row.source_id}: Эх текстийн SHA256 зөрүүтэй байна.`,
      });
      return;
    }

    if (row.source_gate === 'BLOCK_DOMAIN' && !acknowledgePrivateTest) {
      res.status(400).json({
        error: `${row.source_id} нь BLOCK_DOMAIN тугтай тул дотоод инженерийн тестийн зөвшөөрөл (acknowledgePrivateTest) шаардлагатай.`,
      });
      return;
    }

    // Requirement #3: Do not generate remaining 4 real WAVs until PH001 is generated & verified as 1 real WAV!
    if (execMode === 'vertex' && row.source_id !== FIRST_PILOT_SOURCE_ID && !firstRealVerified) {
      res.status(409).json({
        code: 'FIRST_REAL_WAV_REQUIRED',
        error: `Эхлээд ${FIRST_PILOT_SOURCE_ID} (Dobrý den.) мөрийг 1 бодит WAV болгон үүсгэж баталгаажуулсны дараа үлдсэн 4 мөрийг үүсгэнэ.`,
      });
      return;
    }

    const fpInput = {
      source_id: row.source_id,
      dataset_version: row.dataset_version,
      exact_text_sha256: row.text_sha256,
      model: VERTEX_MODEL,
      voice: String(voice),
      speed_profile: speedProfile as SpeedProfile,
    };
    const fingerprint = computeGenerationFingerprint(fpInput);
    const baseFilename = buildDeterministicFilename(fpInput);
    const scopedFilename = execMode === 'mock' ? `MOCK_${baseFilename}` : baseFilename;
    const now = new Date().toISOString();

    if (execMode === 'mock') {
      const existingMock = store.mock_jobs[row.source_id];
      if (
        !forceRegenerate &&
        existingMock &&
        existingMock.fingerprint === fingerprint &&
        existingMock.status === 'MOCK' &&
        existingMock.is_mock &&
        verifyScopedAudioFile('mock', existingMock.filename, existingMock.audio_sha256)
      ) {
        appendEvent(store, {
          event_type: 'IDEMPOTENT_SKIP_MOCK',
          source_id: row.source_id,
          mode: 'mock',
          detail: `MOCK fingerprint (${fingerprint.slice(0, 10)}…) давхцсан тул алгаслаа.`,
        });
        saveStore(store);
        res.json({ skipped: true, job: existingMock });
        return;
      }

      const wavBytes = generateMockSpeechWav(row.cs_exact, row.source_id);
      const parsed = parseWavHeader(wavBytes);
      const stored = writeScopedAudioFile('mock', scopedFilename, wavBytes);

      const mockReceipt: AudioJobReceipt = {
        source_id: row.source_id,
        dataset_version: row.dataset_version,
        cs_exact_sha256: row.text_sha256,
        fingerprint,
        filename: scopedFilename,
        provider: 'local-mock-synth',
        model: VERTEX_MODEL,
        voice: String(voice),
        speed_profile: 'normal',
        status: 'MOCK',
        is_mock: true,
        http_status: null,
        provider_request_id: null,
        attempts: 1,
        last_error: null,
        audio_sha256: stored.sha256,
        sample_rate: parsed.sampleRate,
        channels: parsed.channels,
        bit_depth: parsed.bitsPerSample,
        duration_ms: parsed.durationMs,
        file_size: stored.byteLength,
        peak_dbfs: parsed.peakDbfs,
        rms_dbfs: parsed.rmsDbfs,
        format: 'wav',
        storage_ref: `local://mock/${scopedFilename}`,
        storage_backend: 'local-preview-ephemeral',
        stale: false,
        created_at: existingMock?.created_at ?? now,
        updated_at: now,
      };

      // Strict isolation: write ONLY to store.mock_jobs, never touch store.real_jobs
      store.mock_jobs[row.source_id] = mockReceipt;
      appendEvent(store, {
        event_type: 'MOCK_WAV_GENERATED',
        source_id: row.source_id,
        mode: 'mock',
        detail: `Тусгаарлагдсан MOCK WAV үүслээ (${parsed.durationMs} ms). Бодит real_jobs-д нөлөөлөөгүй.`,
      });
      saveStore(store);
      res.json({ skipped: false, job: mockReceipt });
      return;
    }

    // REAL Vertex AI TTS generation path
    const existingReal = store.real_jobs[row.source_id];
    if (
      !forceRegenerate &&
      existingReal &&
      existingReal.fingerprint === fingerprint &&
      existingReal.status === 'REAL_SUCCESS' &&
      !existingReal.is_mock &&
      Boolean(existingReal.audio_sha256)
    ) {
      let existsDurably = false;
      if (existingReal.storage_backend === 'gcs-private-bucket' && runtime.gcs_bucket && runtime.adc_available) {
        const gcsBuf = await downloadFromGcsPrivateBucket(
          runtime.gcs_bucket,
          `real/${row.dataset_version}/${existingReal.filename}`
        );
        if (gcsBuf) {
          const sha = crypto.createHash('sha256').update(gcsBuf).digest('hex');
          existsDurably = sha === existingReal.audio_sha256;
        }
      } else {
        existsDurably = verifyScopedAudioFile('real', existingReal.filename, existingReal.audio_sha256);
      }

      if (existsDurably) {
        appendEvent(store, {
          event_type: 'IDEMPOTENT_SKIP_REAL',
          source_id: row.source_id,
          mode: 'vertex',
          detail: `Бодит WAV ба fingerprint (${fingerprint.slice(0, 10)}…) баталгаажсан тул давхар дуудлагыг алгаслаа.`,
        });
        saveStore(store);
        res.json({ skipped: true, job: existingReal });
        return;
      }
    }

    if (existingReal?.status === 'AMBIGUOUS_RETRY_REVIEW' && !forceRegenerate) {
      res.status(409).json({
        error: `${row.source_id} өмнөх дуудлага эргэлзээтэй (AMBIGUOUS_RETRY_REVIEW) тул зогслоо.`,
      });
      return;
    }

    if (!runtime.vertex_connected) {
      const notConnectedReceipt: AudioJobReceipt = {
        source_id: row.source_id,
        dataset_version: row.dataset_version,
        cs_exact_sha256: row.text_sha256,
        fingerprint,
        filename: scopedFilename,
        provider: 'vertex-ai',
        model: VERTEX_MODEL,
        voice: String(voice),
        speed_profile: 'normal',
        status: 'NOT_CONNECTED',
        is_mock: false,
        http_status: 503,
        provider_request_id: null,
        attempts: 0,
        last_error:
          runtime.adc_error ??
          'Vertex AI ADC болон IAM эрх project-a699c3ff-995a-4b88-add дээр баталгаажаагүй.',
        audio_sha256: null,
        sample_rate: null,
        channels: null,
        bit_depth: null,
        duration_ms: null,
        file_size: null,
        peak_dbfs: null,
        rms_dbfs: null,
        format: null,
        storage_ref: null,
        storage_backend: null,
        stale: false,
        created_at: existingReal?.created_at ?? now,
        updated_at: now,
      };
      store.real_jobs[row.source_id] = notConnectedReceipt;
      appendError(store, {
        source_id: row.source_id,
        http_status: 503,
        code: 'VERTEX_ADC_NOT_CONFIGURED',
        message: notConnectedReceipt.last_error ?? 'Vertex AI ADC not configured',
      });
      saveStore(store);
      res.status(503).json({
        error: notConnectedReceipt.last_error,
        code: 'VERTEX_ADC_NOT_CONFIGURED',
        job: notConnectedReceipt,
      });
      return;
    }

    // Requirement #4: Prevent billable TTS whenever durable Cloud Storage (GCS_BUCKET_NAME + IAM) is NOT verified
    if (
      runtime.storage_backend !== 'gcs-private-bucket' ||
      !runtime.gcs_bucket ||
      !runtime.gcs_permission_verified
    ) {
      const storageMsg =
        runtime.gcs_error ??
        'Байнгын Cloud Storage (GCS_BUCKET_NAME болон storage.objects.create/get эрх) баталгаажаагүй тул төлбөртэй Vertex TTS дуудлагыг зогсоолоо.';
      appendError(store, {
        source_id: row.source_id,
        http_status: 503,
        code: 'EPHEMERAL_STORAGE_BLOCKED',
        message: storageMsg,
      });
      saveStore(store);
      res.status(503).json({
        code: 'EPHEMERAL_STORAGE_BLOCKED',
        error: storageMsg,
      });
      return;
    }

    const ttsRes = await invokeVertexTts(row.cs_exact, String(voice), 3);
    if (!ttsRes.ok || !ttsRes.wavBytes) {
      const errStatus = ttsRes.ambiguous ? 'AMBIGUOUS_RETRY_REVIEW' : 'FAILED';
      const receipt: AudioJobReceipt = {
        source_id: row.source_id,
        dataset_version: row.dataset_version,
        cs_exact_sha256: row.text_sha256,
        fingerprint,
        filename: scopedFilename,
        provider: 'vertex-ai',
        model: VERTEX_MODEL,
        voice: String(voice),
        speed_profile: 'normal',
        status: errStatus,
        is_mock: false,
        http_status: ttsRes.httpStatus,
        provider_request_id: ttsRes.providerRequestId,
        attempts: ttsRes.attempts,
        last_error: ttsRes.errorMessage ?? 'Vertex AI алдаа',
        audio_sha256: null,
        sample_rate: null,
        channels: null,
        bit_depth: null,
        duration_ms: null,
        file_size: null,
        peak_dbfs: null,
        rms_dbfs: null,
        format: null,
        storage_ref: null,
        storage_backend: null,
        stale: false,
        created_at: existingReal?.created_at ?? now,
        updated_at: now,
      };
      store.real_jobs[row.source_id] = receipt;
      appendError(store, {
        source_id: row.source_id,
        http_status: ttsRes.httpStatus,
        code: ttsRes.errorCode ?? 'VERTEX_TTS_ERROR',
        message: ttsRes.errorMessage ?? 'Vertex AI TTS дуудлага амжилтгүй.',
      });
      saveStore(store);
      res.status(ttsRes.httpStatus >= 400 ? ttsRes.httpStatus : 502).json({
        error: ttsRes.errorMessage,
        code: ttsRes.errorCode,
        job: receipt,
      });
      return;
    }

    const parsed = parseWavHeader(ttsRes.wavBytes);
    let storageRef: string;
    try {
      storageRef = await uploadToGcs(
        runtime.gcs_bucket,
        `real/${row.dataset_version}/${scopedFilename}`,
        ttsRes.wavBytes,
        'audio/wav'
      );
    } catch (gcsErr) {
      appendError(store, {
        source_id: row.source_id,
        http_status: 502,
        code: 'GCS_UPLOAD_FAILED',
        message: gcsErr instanceof Error ? gcsErr.message : 'GCS хадгалалт амжилтгүй.',
      });
      saveStore(store);
      res.status(502).json({
        code: 'GCS_UPLOAD_FAILED',
        error: 'Vertex AI хариу ирсэн боловч GCS хувийн bucket руу хадгалж чадсангүй.',
      });
      return;
    }
    const localStored = writeScopedAudioFile('real', scopedFilename, ttsRes.wavBytes);
    const storageBackend = 'gcs-private-bucket' as const;

    const realReceipt: AudioJobReceipt = {
      source_id: row.source_id,
      dataset_version: row.dataset_version,
      cs_exact_sha256: row.text_sha256,
      fingerprint,
      filename: scopedFilename,
      provider: 'vertex-ai',
      model: VERTEX_MODEL,
      voice: String(voice),
      speed_profile: 'normal',
      status: 'REAL_SUCCESS',
      is_mock: false,
      http_status: ttsRes.httpStatus,
      provider_request_id: ttsRes.providerRequestId,
      attempts: ttsRes.attempts,
      last_error: null,
      audio_sha256: localStored.sha256,
      sample_rate: parsed.sampleRate,
      channels: parsed.channels,
      bit_depth: parsed.bitsPerSample,
      duration_ms: parsed.durationMs,
      file_size: localStored.byteLength,
      peak_dbfs: parsed.peakDbfs,
      rms_dbfs: parsed.rmsDbfs,
      format: 'wav',
      storage_ref: storageRef,
      storage_backend: storageBackend,
      stale: false,
      created_at: existingReal?.created_at ?? now,
      updated_at: now,
    };

    store.real_jobs[row.source_id] = realReceipt;
    appendEvent(store, {
      event_type: 'REAL_VERTEX_WAV_SAVED',
      source_id: row.source_id,
      mode: 'vertex',
      detail: `HTTP ${ttsRes.httpStatus} · ${parsed.durationMs} ms · ${storageBackend}`,
    });
    saveStore(store);

    const ownerUid = (req as any).ownerAuth?.uid ?? 'owner';
    await syncSnapshotToFirestoreAdc(store, ownerUid);

    res.json({ skipped: false, job: realReceipt });
  });

  router.post('/jobs/reset-mock', (_req, res) => {
    const store = loadStore();
    for (const [id, job] of Object.entries(store.mock_jobs)) {
      if (job.filename) deleteScopedAudioFile('mock', job.filename);
      delete store.mock_jobs[id];
    }
    appendEvent(store, {
      event_type: 'MOCK_RESET',
      source_id: 'BATCH',
      mode: 'mock',
      detail: 'Тусгаарлагдсан MOCK баримт болон файлуудыг цэвэрлэлээ (real_jobs хөндөгдөөгүй).',
    });
    saveStore(store);
    res.json({ mock_jobs: store.mock_jobs, real_jobs: store.real_jobs, events: store.events });
  });

  router.post('/qa/:sourceId', async (req, res) => {
    const { sourceId } = req.params;
    const { listening_qa, issue_category = '', notes = '' } = req.body ?? {};
    if (!['QA_PENDING', 'PASS', 'REVIEW', 'FAIL'].includes(listening_qa)) {
      res.status(400).json({ error: 'Хүчингүй QA төлөв.' });
      return;
    }

    const store = loadStore();
    const row = store.sources.find((s) => s.source_id === sourceId);
    if (!row) {
      res.status(404).json({ error: `Мөр олдсонгүй: ${sourceId}` });
      return;
    }

    const now = new Date().toISOString();
    const qaRecord = {
      source_id: sourceId,
      listening_qa,
      publication_gate: 'BLOCKED_FOR_RELEASE' as const,
      issue_category: String(issue_category),
      notes: String(notes),
      reviewer: (req as any).ownerAuth?.email ?? 'owner',
      updated_at: now,
    };

    store.qa[sourceId] = qaRecord;
    appendEvent(store, {
      event_type: 'QA_UPDATED',
      source_id: sourceId,
      mode: 'system',
      detail: `Сонсож шалгах дүн: ${listening_qa}`,
    });
    saveStore(store);

    const ownerUid = (req as any).ownerAuth?.uid ?? 'owner';
    await syncSnapshotToFirestoreAdc(store, ownerUid);

    res.json({ qa: qaRecord, events: store.events });
  });

  router.post('/drive/folder', async (req, res) => {
    const { folderId, folderName } = req.body ?? {};
    if (typeof folderId !== 'string' || !folderId.trim() || typeof folderName !== 'string' || !folderName.trim()) {
      res.status(400).json({ error: 'Drive folderId болон folderName шаардлагатай.' });
      return;
    }

    const store = loadStore();
    store.drive.folder_id = folderId.trim();
    store.drive.folder_name = folderName.trim();
    appendEvent(store, {
      event_type: 'DRIVE_FOLDER_SELECTED',
      source_id: 'DRIVE',
      mode: 'system',
      detail: `Google Drive хавтас сонгогдлоо: ${store.drive.folder_name} (${store.drive.folder_id})`,
    });
    saveStore(store);

    const ownerUid = (req as any).ownerAuth?.uid ?? 'owner';
    await syncSnapshotToFirestoreAdc(store, ownerUid);
    res.json({ drive: store.drive });
  });

  router.post('/drive/sync-record', async (req, res) => {
    const { uploadedFiles } = req.body ?? {};
    if (!Array.isArray(uploadedFiles)) {
      res.status(400).json({ error: 'uploadedFiles массив шаардлагатай.' });
      return;
    }
    const store = loadStore();
    store.drive.last_synced_at = new Date().toISOString();
    store.drive.uploaded_files = uploadedFiles.slice(0, 100);
    appendEvent(store, {
      event_type: 'DRIVE_SYNC_VERIFIED',
      source_id: 'DRIVE',
      mode: 'system',
      detail: `Google Drive руу ${uploadedFiles.length} файл бодитоор хуулагдлаа.`,
    });
    saveStore(store);

    const ownerUid = (req as any).ownerAuth?.uid ?? 'owner';
    await syncSnapshotToFirestoreAdc(store, ownerUid);
    res.json({ drive: store.drive });
  });

  // Strict scoped audio streaming (MOCK and REAL never mix)
  router.get('/audio/:scope/:filename', async (req, res) => {
    const { scope, filename } = req.params;
    if (scope !== 'real' && scope !== 'mock') {
      res.status(400).json({ error: 'Хүчингүй аудио scope (real эсвэл mock).' });
      return;
    }

    const safeName = path.basename(filename);
    const store = loadStore();
    const jobMap = scope === 'real' ? store.real_jobs : store.mock_jobs;
    const matchingJob = Object.values(jobMap).find((j) => j.filename === safeName);
    if (!matchingJob) {
      res.status(404).json({ error: `${scope} аудио бүртгэл олдсонгүй.` });
      return;
    }

    let buf: Buffer | null = null;
    if (scope === 'real' && matchingJob.storage_backend === 'gcs-private-bucket') {
      const runtime = await probeRuntime(false, true);
      if (runtime.gcs_bucket && runtime.adc_available) {
        buf = await downloadFromGcsPrivateBucket(
          runtime.gcs_bucket,
          `real/${matchingJob.dataset_version}/${safeName}`
        );
      }
    }

    if (!buf) {
      buf = readScopedAudioFile(scope, safeName);
    }

    if (!buf) {
      res.status(404).json({ error: 'Физик WAV файл хадгалалтаас олдсонгүй.' });
      return;
    }

    res.setHeader('Content-Type', 'audio/wav');
    res.setHeader('Content-Length', String(buf.byteLength));
    res.setHeader('Content-Disposition', `inline; filename="${safeName}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(buf);
  });

  router.get('/export/manifest/:kind', (req, res) => {
    const store = loadStore();
    const { kind } = req.params;
    const includeMock = req.query.includeMock === 'true';
    const manifestJobs = includeMock ? { ...store.real_jobs, ...store.mock_jobs } : store.real_jobs;

    if (kind === 'results') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="AUDIO_RESULTS_MANIFEST.csv"');
      res.send(generateManifestCsv(store.sources, manifestJobs, store.qa));
      return;
    }
    if (kind === 'issues') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="AUDIO_PRONUNCIATION_ISSUES.csv"');
      res.send(generatePronunciationIssuesCsv(store.sources, store.qa));
      return;
    }
    if (kind === 'events') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="events.csv"');
      res.send(generateEventsCsv(store.events));
      return;
    }
    if (kind === 'errors') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="errors.csv"');
      res.send(generateErrorsCsv(store.errors));
      return;
    }
    if (kind === 'summary') {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="summary.json"');
      res.send(generateSummaryJson(store.sources, store.real_jobs, store.mock_jobs, store.qa));
      return;
    }

    res.status(404).json({ error: 'Тодорхойгүй manifest төрөл.' });
  });

  router.get('/export/zip', async (req, res) => {
    const store = loadStore();
    const includeMock = req.query.includeMock === 'true';
    const manifestJobs = includeMock ? { ...store.real_jobs, ...store.mock_jobs } : store.real_jobs;
    const zip = new JSZip();

    zip.file('AUDIO_RESULTS_MANIFEST.csv', generateManifestCsv(store.sources, manifestJobs, store.qa));
    zip.file('AUDIO_PRONUNCIATION_ISSUES.csv', generatePronunciationIssuesCsv(store.sources, store.qa));
    zip.file('events.csv', generateEventsCsv(store.events));
    zip.file('errors.csv', generateErrorsCsv(store.errors));
    zip.file(
      'summary.json',
      generateSummaryJson(store.sources, store.real_jobs, store.mock_jobs, store.qa)
    );
    zip.file(
      'SOURCE_GATE_NOTES.txt',
      [
        'Ahoj Česko — Audio Factory Source Gate Notes',
        `Dataset Version: ${store.dataset_version}`,
        `Canonical Curriculum SHA256: ${store.canonical_curriculum_sha256}`,
        'Policy: Real WAVs and MOCK WAVs are stored in strictly isolated folders.',
        'CZ-A0-M01-L01-PH006 has source_gate=BLOCK_DOMAIN and must NEVER be auto-released.',
      ].join('\n')
    );

    const realFolder = zip.folder('wav/real');
    let includedReal = 0;
    const runtime = await probeRuntime(false, false);

    for (const row of store.sources) {
      const realJob = store.real_jobs[row.source_id];
      if (realJob && realJob.status === 'REAL_SUCCESS' && !realJob.is_mock) {
        let buf: Buffer | null = null;
        if (
          realJob.storage_backend === 'gcs-private-bucket' &&
          runtime.gcs_bucket &&
          runtime.adc_available
        ) {
          buf = await downloadFromGcsPrivateBucket(
            runtime.gcs_bucket,
            `real/${row.dataset_version}/${realJob.filename}`
          );
        }
        if (!buf) buf = readScopedAudioFile('real', realJob.filename);
        if (buf && realFolder) {
          realFolder.file(realJob.filename, buf);
          includedReal++;
        }
      }
    }

    if (includeMock) {
      const mockFolder = zip.folder('wav/mock');
      for (const row of store.sources) {
        const mockJob = store.mock_jobs[row.source_id];
        if (mockJob && mockJob.status === 'MOCK' && mockJob.is_mock) {
          const buf = readScopedAudioFile('mock', mockJob.filename);
          if (buf && mockFolder) {
            mockFolder.file(mockJob.filename, buf);
          }
        }
      }
    }

    if (includedReal === 0 && !includeMock) {
      zip.file(
        'NO_REAL_WAV_FILES_NOTICE.txt',
        'Одоогоор үүсгэгдсэн бодит (REAL_SUCCESS) WAV файл байхгүй тул зөвхөн manifest болон тэмдэглэлийн файлууд багтлаа.'
      );
    }

    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="ahoj-cesko-audio-factory-${store.dataset_version}.zip"`
    );
    res.send(zipBuffer);
  });

  return router;
}
