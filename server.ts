import express from 'express';
import JSZip from 'jszip';
import path from 'node:path';
import { createServer as createViteServer } from 'vite';
import {
  buildDeterministicFilename,
  computeGenerationFingerprint,
  generateMockSpeechWav,
  parseWavHeader,
  sha256Utf8,
} from './src/shared/audioAndCrypto';
import {
  VERTEX_MODEL,
  VERTEX_VOICE,
  generateErrorsCsv,
  generateEventsCsv,
  generateManifestCsv,
  generatePronunciationIssuesCsv,
  generateSummaryJson,
  parseAndValidateImport,
} from './src/shared/sourceRegistry';
import type { AudioJobReceipt, ExecutionMode, SpeedProfile } from './src/shared/types';
import {
  appendError,
  appendEvent,
  deleteAudioFile,
  loadStore,
  readAudioFile,
  saveStore,
  verifyPhysicalAudioFile,
  writeAudioFile,
} from './src/server/storage';
import {
  callVertexTtsWithRetry,
  probeCloudRuntimeStatus,
  uploadToGcsPrivateBucket,
} from './src/server/vertexTts';

const PORT = 3000;
const rateBucket = new Map<string, number[]>();

function checkOwnerAccess(req: express.Request): { allowed: boolean; email: string | null; reason?: string } {
  const allowlistRaw = process.env.OWNER_EMAIL_ALLOWLIST?.trim();
  if (!allowlistRaw) {
    // Preview mode (no IAP/allowlist configured yet)
    return { allowed: true, email: null };
  }
  const allowlist = allowlistRaw
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  const iapHeader = req.headers['x-goog-authenticated-user-email'];
  const headerEmail =
    typeof iapHeader === 'string'
      ? iapHeader.replace(/^accounts\.google\.com:/i, '').trim().toLowerCase()
      : null;

  if (!headerEmail || !allowlist.includes(headerEmail)) {
    return {
      allowed: false,
      email: headerEmail,
      reason: 'Эзэмшигчийн зөвшөөрөгдсөн имэйл баталгаажаагүй байна (403).',
    };
  }
  return { allowed: true, email: headerEmail };
}

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

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '5mb' }));

  // CSRF & Same-Origin check for state-mutating API calls
  app.use('/api', (req, res, next) => {
    const access = checkOwnerAccess(req);
    if (!access.allowed) {
      res.status(403).json({ error: access.reason ?? 'Forbidden' });
      return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const xrw = req.headers['x-requested-with'];
      if (xrw !== 'AhojAudioFactory') {
        res.status(403).json({
          error: 'CSRF хамгаалалт: X-Requested-With толгой дутуу байна.',
        });
        return;
      }
    }
    next();
  });

  app.get('/api/health', async (_req, res) => {
    const runtime = await probeCloudRuntimeStatus(false);
    res.json({
      ok: true,
      app: 'Ahoj Česko — Audio Factory',
      vertex_connected: runtime.vertex_connected,
      storage_backend: runtime.storage_backend,
    });
  });

  app.get('/api/state', async (_req, res) => {
    const store = loadStore();
    const runtime = await probeCloudRuntimeStatus(false);

    // Reconcile stale/missing physical files accurately without fabricating completions
    let dirty = false;
    for (const row of store.sources) {
      const job = store.jobs[row.source_id];
      if (!job) continue;
      const expectedFp = computeGenerationFingerprint({
        source_id: row.source_id,
        dataset_version: row.dataset_version,
        exact_text_sha256: row.text_sha256,
        model: job.model,
        voice: job.voice,
        speed_profile: job.speed_profile,
      });
      const isStale = job.fingerprint !== expectedFp;
      const fileOk =
        job.status === 'MOCK' || job.status === 'REAL_SUCCESS'
          ? verifyPhysicalAudioFile(job.filename, job.audio_sha256)
          : true;

      if (job.stale !== isStale) {
        job.stale = isStale;
        dirty = true;
      }
      if (!fileOk && (job.status === 'MOCK' || job.status === 'REAL_SUCCESS')) {
        job.status = 'FAILED';
        job.last_error = 'Физик WAV файл олдсонгүй эсвэл SHA256 зөрүүтэй байна.';
        dirty = true;
      }
    }
    if (dirty) saveStore(store);

    res.json({
      canonical_curriculum_sha256: store.canonical_curriculum_sha256,
      dataset_version: store.dataset_version,
      sources: store.sources,
      jobs: store.jobs,
      qa: store.qa,
      events: store.events,
      errors: store.errors,
      runtime,
    });
  });

  app.post('/api/runtime/refresh', async (_req, res) => {
    const runtime = await probeCloudRuntimeStatus(true);
    res.json({ runtime });
  });

  app.post('/api/sources/import', (req, res) => {
    const { rawText, format, replaceExisting } = req.body ?? {};
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
          reviewer: 'owner',
          updated_at: now,
        };
      }
      const existingJob = store.jobs[row.source_id];
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

    appendEvent(store, {
      event_type: 'SOURCE_IMPORT',
      source_id: 'BATCH',
      mode: 'system',
      detail: `${validation.rows.length} мөр (${format.toUpperCase()}) амжилттай шалгагдаж бүртгэгдлээ.`,
    });
    saveStore(store);

    res.json({
      validation,
      sources: store.sources,
      qa: store.qa,
      jobs: store.jobs,
    });
  });

  app.post('/api/tts/generate', async (req, res) => {
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
    const runtime = await probeCloudRuntimeStatus(false);

    if (!checkRateLimit(req.ip ?? 'owner', runtime.rate_limit_rpm)) {
      res.status(429).json({
        error: `Хурдны хязгаар (${runtime.rate_limit_rpm} хүсэлт/мин) хэтэрлээ. Түр хүлээнэ үү.`,
      });
      return;
    }

    const store = loadStore();
    const row = store.sources.find((s) => s.source_id === sourceId);
    if (!row) {
      res.status(404).json({ error: `Эх мөр олдсонгүй: ${sourceId}` });
      return;
    }

    // Verify source integrity against literal Czech text SHA-256
    const computedTextSha = sha256Utf8(row.cs_exact);
    if (computedTextSha !== row.text_sha256) {
      res.status(409).json({
        error: `${row.source_id}: Эх текстийн SHA256 зөрүүтэй байна. Эхийг дахин баталгаажуулна уу.`,
      });
      return;
    }

    // Explicit PH006 BLOCK_DOMAIN / hold flag private-test acknowledgement check
    if (row.source_gate === 'BLOCK_DOMAIN' && !acknowledgePrivateTest) {
      res.status(400).json({
        error: `${row.source_id} нь BLOCK_DOMAIN тугтай тул дотоод инженерийн тестийн зөвшөөрөл (acknowledgePrivateTest) заавал шаардлагатай.`,
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
    const filename = buildDeterministicFilename(fpInput);
    const now = new Date().toISOString();

    // Idempotency check before triggering any billable call
    const existing = store.jobs[row.source_id];
    if (
      !forceRegenerate &&
      existing &&
      existing.fingerprint === fingerprint &&
      ((execMode === 'vertex' && existing.status === 'REAL_SUCCESS' && !existing.is_mock) ||
        (execMode === 'mock' && existing.status === 'MOCK' && existing.is_mock)) &&
      verifyPhysicalAudioFile(existing.filename, existing.audio_sha256)
    ) {
      appendEvent(store, {
        event_type: 'IDEMPOTENT_SKIP',
        source_id: row.source_id,
        mode: execMode,
        detail: `Ижил fingerprint (${fingerprint.slice(0, 10)}…) болон WAV SHA256 баталгаажсан тул алгаслаа.`,
      });
      saveStore(store);
      res.json({ skipped: true, job: existing });
      return;
    }

    if (existing?.status === 'AMBIGUOUS_RETRY_REVIEW' && !forceRegenerate) {
      res.status(409).json({
        error: `${row.source_id} өмнөх дуудлага эргэлзээтэй (AMBIGUOUS_RETRY_REVIEW) тул давхар төлбөртэй дуудлагаас сэргийлж зогслоо.`,
      });
      return;
    }

    if (execMode === 'vertex' && !runtime.adc_available) {
      const failedReceipt: AudioJobReceipt = {
        source_id: row.source_id,
        dataset_version: row.dataset_version,
        cs_exact_sha256: row.text_sha256,
        fingerprint,
        filename,
        provider: 'vertex-ai',
        model: VERTEX_MODEL,
        voice: String(voice),
        speed_profile: 'normal',
        status: 'NOT_CONNECTED',
        is_mock: false,
        http_status: 503,
        provider_request_id: null,
        attempts: 0,
        last_error: 'Vertex AI ADC холбогдоогүй (AI Studio preview дээр Cloud Run Workload Identity байхгүй).',
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
        created_at: existing?.created_at ?? now,
        updated_at: now,
      };
      store.jobs[row.source_id] = failedReceipt;
      appendError(store, {
        source_id: row.source_id,
        http_status: 503,
        code: 'VERTEX_ADC_NOT_CONFIGURED',
        message: failedReceipt.last_error ?? 'Vertex AI ADC not configured',
      });
      saveStore(store);
      res.status(503).json({
        error: failedReceipt.last_error,
        code: 'VERTEX_ADC_NOT_CONFIGURED',
        job: failedReceipt,
      });
      return;
    }

    if (execMode === 'mock') {
      const wavBytes = generateMockSpeechWav(row.cs_exact, row.source_id);
      const parsed = parseWavHeader(wavBytes);
      const stored = writeAudioFile(filename, wavBytes);

      const receipt: AudioJobReceipt = {
        source_id: row.source_id,
        dataset_version: row.dataset_version,
        cs_exact_sha256: row.text_sha256,
        fingerprint,
        filename,
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
        storage_ref: `local://.data/audio/${filename}`,
        storage_backend: 'local-preview',
        stale: false,
        created_at: existing?.created_at ?? now,
        updated_at: now,
      };

      store.jobs[row.source_id] = receipt;
      appendEvent(store, {
        event_type: 'MOCK_WAV_GENERATED',
        source_id: row.source_id,
        mode: 'mock',
        detail: `Тестийн (MOCK) WAV үүсгэлээ (${parsed.durationMs} ms, SHA256 ${stored.sha256.slice(0, 10)}…). Бодит Vertex дуудлага хийгдээгүй.`,
      });
      saveStore(store);
      res.json({ skipped: false, job: receipt });
      return;
    }

    // Real Vertex AI TTS call (server-side ADC)
    const ttsRes = await callVertexTtsWithRetry(row.cs_exact, String(voice), 3);
    if (!ttsRes.ok || !ttsRes.wavBytes) {
      const errStatus = ttsRes.ambiguous ? 'AMBIGUOUS_RETRY_REVIEW' : 'FAILED';
      const receipt: AudioJobReceipt = {
        source_id: row.source_id,
        dataset_version: row.dataset_version,
        cs_exact_sha256: row.text_sha256,
        fingerprint,
        filename,
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
        created_at: existing?.created_at ?? now,
        updated_at: now,
      };
      store.jobs[row.source_id] = receipt;
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
    const stored = writeAudioFile(filename, ttsRes.wavBytes);

    let storageRef = `local://.data/audio/${filename}`;
    let storageBackend: 'local-preview' | 'gcs-private-bucket' = 'local-preview';

    if (runtime.gcs_bucket && runtime.adc_available) {
      try {
        storageRef = await uploadToGcsPrivateBucket(
          runtime.gcs_bucket,
          `ahoj-cesko/${row.dataset_version}/${filename}`,
          ttsRes.wavBytes,
          'audio/wav'
        );
        storageBackend = 'gcs-private-bucket';
      } catch (gcsErr) {
        appendError(store, {
          source_id: row.source_id,
          http_status: 500,
          code: 'GCS_UPLOAD_FAILED',
          message: gcsErr instanceof Error ? gcsErr.message : 'GCS хадгалалт амжилтгүй.',
        });
        saveStore(store);
        res.status(502).json({
          error: 'Vertex AI хариу ирсэн боловч GCS хувийн bucket руу хадгалж чадсангүй.',
        });
        return;
      }
    }

    const realReceipt: AudioJobReceipt = {
      source_id: row.source_id,
      dataset_version: row.dataset_version,
      cs_exact_sha256: row.text_sha256,
      fingerprint,
      filename,
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
      audio_sha256: stored.sha256,
      sample_rate: parsed.sampleRate,
      channels: parsed.channels,
      bit_depth: parsed.bitsPerSample,
      duration_ms: parsed.durationMs,
      file_size: stored.byteLength,
      peak_dbfs: parsed.peakDbfs,
      rms_dbfs: parsed.rmsDbfs,
      format: 'wav',
      storage_ref: storageRef,
      storage_backend: storageBackend,
      stale: false,
      created_at: existing?.created_at ?? now,
      updated_at: now,
    };

    store.jobs[row.source_id] = realReceipt;
    appendEvent(store, {
      event_type: 'REAL_VERTEX_WAV_SAVED',
      source_id: row.source_id,
      mode: 'vertex',
      detail: `HTTP ${ttsRes.httpStatus} · ${parsed.durationMs} ms · ${storageBackend}`,
    });
    saveStore(store);
    res.json({ skipped: false, job: realReceipt });
  });

  app.post('/api/jobs/reset-mock', (_req, res) => {
    const store = loadStore();
    for (const [id, job] of Object.entries(store.jobs)) {
      if (job.is_mock || job.status === 'NOT_CONNECTED') {
        if (job.filename) deleteAudioFile(job.filename);
        delete store.jobs[id];
      }
    }
    appendEvent(store, {
      event_type: 'MOCK_RESET',
      source_id: 'BATCH',
      mode: 'mock',
      detail: 'Тестийн (MOCK) баримт болон файлуудыг цэвэрлэлээ.',
    });
    saveStore(store);
    res.json({ jobs: store.jobs, events: store.events });
  });

  app.post('/api/qa/:sourceId', (req, res) => {
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
      reviewer: 'owner',
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
    res.json({ qa: qaRecord, events: store.events });
  });

  app.get('/api/audio/:filename', (req, res) => {
    const safeName = path.basename(req.params.filename);
    const store = loadStore();
    const matchingJob = Object.values(store.jobs).find((j) => j.filename === safeName);
    if (!matchingJob) {
      res.status(404).json({ error: 'Аудио бүртгэл олдсонгүй.' });
      return;
    }
    const buf = readAudioFile(safeName);
    if (!buf) {
      res.status(404).json({ error: 'Физик WAV файл диск дээр олдсонгүй.' });
      return;
    }

    res.setHeader('Content-Type', 'audio/wav');
    res.setHeader('Content-Length', String(buf.byteLength));
    res.setHeader('Content-Disposition', `inline; filename="${safeName}"`);
    res.setHeader('Cache-Control', 'private, max-age=60');
    res.send(buf);
  });

  app.get('/api/export/manifest/:kind', (req, res) => {
    const store = loadStore();
    const { kind } = req.params;

    if (kind === 'results') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="AUDIO_RESULTS_MANIFEST.csv"');
      res.send(generateManifestCsv(store.sources, store.jobs, store.qa));
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
      res.send(generateSummaryJson(store.sources, store.jobs, store.qa));
      return;
    }

    res.status(404).json({ error: 'Тодорхойгүй manifest төрөл.' });
  });

  app.get('/api/export/zip', async (_req, res) => {
    const store = loadStore();
    const zip = new JSZip();

    zip.file('AUDIO_RESULTS_MANIFEST.csv', generateManifestCsv(store.sources, store.jobs, store.qa));
    zip.file('AUDIO_PRONUNCIATION_ISSUES.csv', generatePronunciationIssuesCsv(store.sources, store.qa));
    zip.file('events.csv', generateEventsCsv(store.events));
    zip.file('errors.csv', generateErrorsCsv(store.errors));
    zip.file('summary.json', generateSummaryJson(store.sources, store.jobs, store.qa));
    zip.file(
      'SOURCE_GATE_NOTES.txt',
      [
        'Ahoj Česko — Audio Factory Source Gate Notes',
        `Dataset Version: ${store.dataset_version}`,
        `Canonical Curriculum SHA256: ${store.canonical_curriculum_sha256}`,
        'Policy: All first-five pilot WAVs are internal engineering previews only.',
        'CZ-A0-M01-L01-PH006 has source_gate=BLOCK_DOMAIN and must NEVER be auto-released.',
      ].join('\n')
    );

    const wavFolder = zip.folder('wav');
    let includedWavs = 0;
    for (const row of store.sources) {
      const job = store.jobs[row.source_id];
      if (job && (job.status === 'REAL_SUCCESS' || job.status === 'MOCK')) {
        const buf = readAudioFile(job.filename);
        if (buf && wavFolder) {
          wavFolder.file(job.filename, buf);
          includedWavs++;
        }
      }
    }

    if (includedWavs === 0) {
      zip.file(
        'NO_WAV_FILES_NOTICE.txt',
        'Одоогоор үүсгэгдсэн физик WAV файл байхгүй тул зөвхөн manifest болон тэмдэглэлийн файлууд багтлаа.'
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

  // Mount Vite middleware in dev, or serve dist in production
  if (process.env.NODE_ENV === 'production') {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Ahoj Česko — Audio Factory server listening on http://localhost:${PORT}`);
  });
}

startServer();
