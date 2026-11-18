import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test, { after, before } from 'node:test';
import express from 'express';
import {
  listDriveImportFiles,
  uploadBytesToDriveFolder,
} from '../lib/driveClient';
import type { AuthVerifierDeps } from './auth';

function base64Url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function signRs256Jwt(
  payload: Record<string, unknown>,
  privateKeyPem: string,
  kid: string
): string {
  const header = { alg: 'RS256', typ: 'JWT', kid };
  const encodedHeader = base64Url(JSON.stringify(header));
  const encodedPayload = base64Url(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(signingInput);
  const sig = signer.sign(privateKeyPem);
  return `${signingInput}.${base64Url(sig)}`;
}

let tempDir: string;
let originalCwd: string;
let server: http.Server;
let baseUrl: string;
let privateKeyPem: string;
let publicKeyPem: string;
const TEST_KID = 'test-key-1';
const TEST_PROJECT = 'project-a699c3ff-995a-4b88-add';
const TEST_IAP_AUDIENCE = '/projects/814331085807/global/backendServices/123456';

before(async () => {
  originalCwd = process.cwd();
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ahoj-factory-test-'));
  process.chdir(tempDir);

  const pair = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  privateKeyPem = pair.privateKey;
  publicKeyPem = pair.publicKey;

  const { createApiRouter } = await import('./appFactory');

  const authDeps: AuthVerifierDeps = {
    projectId: TEST_PROJECT,
    iapAudience: TEST_IAP_AUDIENCE,
    requireIap: false,
    ownerAllowlist: ['zazadada8899@gmail.com'],
    fetchFirebaseCerts: async () => ({ [TEST_KID]: publicKeyPem }),
    fetchIapKeys: async () => ({ [TEST_KID]: publicKeyPem }),
  };

  const app = express();
  app.use(express.json({ limit: '5mb' }));
  app.use('/api', createApiRouter({ authDeps }));

  server = http.createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const addr = server.address();
  if (!addr || typeof addr === 'string') {
    throw new Error('Failed to bind ephemeral test port');
  }
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

after(async () => {
  await new Promise<void>((resolve) => {
    server?.close(() => resolve());
  });
  process.chdir(originalCwd);
  if (tempDir && fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

function mintOwnerFirebaseToken(email = 'zazadada8899@gmail.com', verified = true): string {
  const now = Math.floor(Date.now() / 1000);
  return signRs256Jwt(
    {
      iss: `https://securetoken.google.com/${TEST_PROJECT}`,
      aud: TEST_PROJECT,
      auth_time: now - 10,
      user_id: 'uid-owner-1',
      sub: 'uid-owner-1',
      iat: now - 10,
      exp: now + 3600,
      email,
      email_verified: verified,
    },
    privateKeyPem,
    TEST_KID
  );
}

function mintIapJwt(email = 'zazadada8899@gmail.com'): string {
  const now = Math.floor(Date.now() / 1000);
  return signRs256Jwt(
    {
      iss: 'https://cloud.google.com/iap',
      aud: TEST_IAP_AUDIENCE,
      sub: 'accounts.google.com:10001',
      iat: now - 10,
      exp: now + 3600,
      email,
      email_verified: true,
    },
    privateKeyPem,
    TEST_KID
  );
}

test('fail-closed auth: blocks unauthenticated requests and unsigned spoofed email headers', async () => {
  const healthRes = await fetch(`${baseUrl}/api/health`);
  assert.equal(healthRes.status, 200);
  const health = (await healthRes.json()) as { auth_required: boolean };
  assert.equal(health.auth_required, true);

  const unauthedState = await fetch(`${baseUrl}/api/state`);
  assert.equal(unauthedState.status, 401);

  // Unsigned x-goog-authenticated-user-email must NEVER bypass auth
  const spoofedRes = await fetch(`${baseUrl}/api/state`, {
    headers: {
      'x-goog-authenticated-user-email': 'accounts.google.com:zazadada8899@gmail.com',
    },
  });
  assert.equal(spoofedRes.status, 401);

  // Non-owner signed Firebase JWT must return 403
  const strangerToken = mintOwnerFirebaseToken('attacker@example.com', true);
  const strangerRes = await fetch(`${baseUrl}/api/state`, {
    headers: { Authorization: `Bearer ${strangerToken}` },
  });
  assert.equal(strangerRes.status, 403);

  // Unverified email must return 403
  const unverifiedToken = mintOwnerFirebaseToken('zazadada8899@gmail.com', false);
  const unverifiedRes = await fetch(`${baseUrl}/api/state`, {
    headers: { Authorization: `Bearer ${unverifiedToken}` },
  });
  assert.equal(unverifiedRes.status, 403);
});

test('accepts valid signed owner Firebase token and valid signed Cloud Run IAP JWT', async () => {
  const ownerToken = mintOwnerFirebaseToken();
  const stateRes = await fetch(`${baseUrl}/api/state`, {
    headers: { Authorization: `Bearer ${ownerToken}` },
  });
  assert.equal(stateRes.status, 200);
  const snapshot = (await stateRes.json()) as {
    sources: Array<{ source_id: string }>;
    real_jobs: Record<string, unknown>;
    mock_jobs: Record<string, unknown>;
  };
  assert.equal(snapshot.sources.length, 5);

  const iapJwt = mintIapJwt();
  const iapRes = await fetch(`${baseUrl}/api/state`, {
    headers: { 'X-Goog-IAP-JWT-Assertion': iapJwt },
  });
  assert.equal(iapRes.status, 200);
});

test('enforces PH001 single real WAV gate before PH003..PH006 and requires CSRF header', async () => {
  const ownerToken = mintOwnerFirebaseToken();

  // Missing X-Requested-With on POST must fail with 403
  const noCsrf = await fetch(`${baseUrl}/api/tts/generate`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ownerToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ sourceId: 'CZ-A0-M01-L01-PH001', mode: 'vertex' }),
  });
  assert.equal(noCsrf.status, 403);

  // Requesting PH003 in vertex mode before PH001 is verified must fail with 409 FIRST_REAL_WAV_REQUIRED
  const blockedPh003 = await fetch(`${baseUrl}/api/tts/generate`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ownerToken}`,
      'Content-Type': 'application/json',
      'X-Requested-With': 'AhojAudioFactory',
    },
    body: JSON.stringify({ sourceId: 'CZ-A0-M01-L01-PH003', mode: 'vertex' }),
  });
  assert.equal(blockedPh003.status, 409);
  const body = (await blockedPh003.json()) as { code: string };
  assert.equal(body.code, 'FIRST_REAL_WAV_REQUIRED');

  // PH006 BLOCK_DOMAIN without acknowledgePrivateTest must be rejected (400) even in mock mode
  const blockedPh006 = await fetch(`${baseUrl}/api/tts/generate`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ownerToken}`,
      'Content-Type': 'application/json',
      'X-Requested-With': 'AhojAudioFactory',
    },
    body: JSON.stringify({
      sourceId: 'CZ-A0-M01-L01-PH006',
      mode: 'mock',
      acknowledgePrivateTest: false,
    }),
  });
  assert.equal(blockedPh006.status, 400);
});

test('isolates MOCK storage/jobs from REAL jobs, enforces idempotent duplicate skip, and saves QA/Drive folder', async () => {
  const ownerToken = mintOwnerFirebaseToken();
  const headers = {
    Authorization: `Bearer ${ownerToken}`,
    'Content-Type': 'application/json',
    'X-Requested-With': 'AhojAudioFactory',
  };

  // Generate MOCK WAV for PH001
  const gen1 = await fetch(`${baseUrl}/api/tts/generate`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      sourceId: 'CZ-A0-M01-L01-PH001',
      mode: 'mock',
      acknowledgePrivateTest: true,
    }),
  });
  assert.equal(gen1.status, 200);
  const res1 = (await gen1.json()) as {
    skipped: boolean;
    job: { filename: string; is_mock: boolean; storage_ref: string };
  };
  assert.equal(res1.skipped, false);
  assert.equal(res1.job.is_mock, true);
  assert.ok(res1.job.filename.startsWith('MOCK_'));
  assert.ok(res1.job.storage_ref.startsWith('local://mock/'));

  // Duplicate MOCK generation must be skipped via fingerprint idempotency
  const gen2 = await fetch(`${baseUrl}/api/tts/generate`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      sourceId: 'CZ-A0-M01-L01-PH001',
      mode: 'mock',
      acknowledgePrivateTest: true,
    }),
  });
  assert.equal(gen2.status, 200);
  const res2 = (await gen2.json()) as { skipped: boolean };
  assert.equal(res2.skipped, true);

  // Scoped audio route must serve mock under /mock/ and NEVER leak under /real/
  const mockAudioRes = await fetch(
    `${baseUrl}/api/audio/mock/${encodeURIComponent(res1.job.filename)}`,
    { headers: { Authorization: `Bearer ${ownerToken}` } }
  );
  assert.equal(mockAudioRes.status, 200);

  const crossScopeRes = await fetch(
    `${baseUrl}/api/audio/real/${encodeURIComponent(res1.job.filename)}`,
    { headers: { Authorization: `Bearer ${ownerToken}` } }
  );
  assert.equal(crossScopeRes.status, 404);

  // Verify real_jobs remains completely empty while mock_jobs has PH001
  const stateRes = await fetch(`${baseUrl}/api/state`, {
    headers: { Authorization: `Bearer ${ownerToken}` },
  });
  const snapshot = (await stateRes.json()) as {
    real_jobs: Record<string, unknown>;
    mock_jobs: Record<string, unknown>;
  };
  assert.equal(Object.keys(snapshot.real_jobs).length, 0);
  assert.equal(Object.keys(snapshot.mock_jobs).length, 1);

  // Default manifest CSV (without includeMock=true) must NOT report MOCK as real audio
  const manifestRes = await fetch(`${baseUrl}/api/export/manifest/results`, {
    headers: { Authorization: `Bearer ${ownerToken}` },
  });
  assert.equal(manifestRes.status, 200);
  const manifestText = await manifestRes.text();
  assert.ok(!manifestText.includes('local://mock/'));

  // Persist Drive folder selection & sync receipt
  const folderRes = await fetch(`${baseUrl}/api/drive/folder`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ folderId: 'drv-folder-99', folderName: 'Ahoj Pilot' }),
  });
  assert.equal(folderRes.status, 200);

  // Reset MOCK clears mock_jobs cleanly
  const resetRes = await fetch(`${baseUrl}/api/jobs/reset-mock`, {
    method: 'POST',
    headers,
  });
  assert.equal(resetRes.status, 200);
  const resetBody = (await resetRes.json()) as { mock_jobs: Record<string, unknown> };
  assert.equal(Object.keys(resetBody.mock_jobs).length, 0);
});

test('driveClient listDriveImportFiles & uploadBytesToDriveFolder construct valid Google Drive v3 requests', async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; method: string; auth: string | null }> = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const hdrs = new Headers(init?.headers);
    calls.push({ url, method: init?.method ?? 'GET', auth: hdrs.get('Authorization') });

    if (url.includes('/upload/drive/v3/files')) {
      return new Response(
        JSON.stringify({ id: 'drive-file-abc', name: 'PH001.wav', size: '128' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return new Response(
      JSON.stringify({
        files: [{ id: 'drv-1', name: 'AHOJ_72_LESSONS.json', mimeType: 'application/json' }],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }) as typeof fetch;

  try {
    const files = await listDriveImportFiles('ya29.test-token');
    assert.equal(files.length, 1);
    assert.equal(files[0].name, 'AHOJ_72_LESSONS.json');

    const receipt = await uploadBytesToDriveFolder({
      accessToken: 'ya29.test-token',
      folderId: 'drv-folder-99',
      filename: 'PH001.wav',
      mimeType: 'audio/wav',
      bytes: new Uint8Array([82, 73, 70, 70]),
      kind: 'wav',
    });
    assert.equal(receipt.drive_file_id, 'drive-file-abc');
    assert.equal(receipt.kind, 'wav');
    assert.equal(calls[0].auth, 'Bearer ya29.test-token');
    assert.equal(calls[1].method, 'POST');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('all server API routes deny unauthenticated requests even when OWNER_EMAIL_ALLOWLIST is missing or wildcard', async () => {
  const prevAllowlist = process.env.OWNER_EMAIL_ALLOWLIST;
  delete process.env.OWNER_EMAIL_ALLOWLIST;

  try {
    const { getOwnerAllowlist } = await import('./auth');
    assert.deepEqual(getOwnerAllowlist(), ['zazadada8899@gmail.com']);

    process.env.OWNER_EMAIL_ALLOWLIST = '*';
    assert.deepEqual(getOwnerAllowlist(), ['zazadada8899@gmail.com']);
    delete process.env.OWNER_EMAIL_ALLOWLIST;

    const endpoints: Array<{ method: string; path: string; body?: string }> = [
      { method: 'GET', path: '/api/state' },
      { method: 'POST', path: '/api/runtime/refresh' },
      { method: 'POST', path: '/api/sources/import', body: JSON.stringify({ rawText: '', format: 'csv' }) },
      { method: 'POST', path: '/api/tts/generate', body: JSON.stringify({ sourceId: 'CZ-A0-M01-L01-PH001', mode: 'vertex' }) },
      { method: 'POST', path: '/api/jobs/reset-mock' },
      { method: 'POST', path: '/api/qa/CZ-A0-M01-L01-PH001', body: JSON.stringify({ listening_qa: 'PASS' }) },
      { method: 'POST', path: '/api/drive/folder', body: JSON.stringify({ folderId: '1', folderName: 'x' }) },
      { method: 'POST', path: '/api/drive/sync-record', body: JSON.stringify({ uploadedFiles: [] }) },
      { method: 'GET', path: '/api/audio/real/test.wav' },
      { method: 'GET', path: '/api/export/manifest/results' },
      { method: 'GET', path: '/api/export/zip' },
    ];

    for (const ep of endpoints) {
      const res = await fetch(`${baseUrl}${ep.path}`, {
        method: ep.method,
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'AhojAudioFactory',
        },
        body: ep.body,
      });
      assert.equal(
        res.status,
        401,
        `Expected 401 on unauthenticated ${ep.method} ${ep.path} when OWNER_EMAIL_ALLOWLIST is missing`
      );
    }
  } finally {
    if (prevAllowlist !== undefined) {
      process.env.OWNER_EMAIL_ALLOWLIST = prevAllowlist;
    } else {
      delete process.env.OWNER_EMAIL_ALLOWLIST;
    }
  }
});

test('prevents billable Vertex TTS generation BEFORE calling Vertex AI when durable Cloud Storage is unverified', async () => {
  const { createApiRouter } = await import('./appFactory');
  const { generateMockSpeechWav } = await import('../shared/audioAndCrypto');

  let ttsCallCount = 0;
  let gcsVerified = false;

  const customApp = express();
  customApp.use(express.json());
  customApp.use(
    '/api',
    createApiRouter({
      authDeps: {
        projectId: TEST_PROJECT,
        iapAudience: TEST_IAP_AUDIENCE,
        requireIap: false,
        ownerAllowlist: ['zazadada8899@gmail.com'],
        fetchFirebaseCerts: async () => ({ [TEST_KID]: publicKeyPem }),
      },
      runtimeProbe: async (_force, firstRealVerified) => ({
        project_id: TEST_PROJECT,
        location: 'global',
        model: 'gemini-3.8-flash-tts',
        voice: 'Achernar',
        endpoint: 'https://aiplatform.googleapis.com/test',
        vertex_connected: true,
        vertex_permission_verified: true,
        adc_available: true,
        runtime_identity: 'audio-factory-sa@project-a699c3ff-995a-4b88-add.iam.gserviceaccount.com',
        storage_backend: gcsVerified ? 'gcs-private-bucket' : 'local-preview-ephemeral',
        gcs_bucket: gcsVerified ? 'ahoj-private-audio' : null,
        gcs_permission_verified: gcsVerified,
        gcs_error: gcsVerified ? null : 'GCS_BUCKET_NAME тохируулаагүй байна.',
        firestore_connected: true,
        firestore_database_id: 'ai-studio-608c02cc-851c-478c-a335-cdcc0cf9a9c3',
        iap_enabled: true,
        auth_mode: 'iap-and-firebase-jwt',
        owner_allowlist: ['zazadada8899@gmail.com'],
        allowlist_explicit: true,
        estimated_cost_label: 'Тооцоолоогүй',
        rate_limit_rpm: 10,
        max_first_batch: 5,
        first_real_wav_verified: Boolean(firstRealVerified),
        adc_error: null,
      }),
      ttsCaller: async (text) => {
        ttsCallCount++;
        return {
          ok: true,
          httpStatus: 200,
          providerRequestId: 'req-real-1',
          attempts: 1,
          wavBytes: generateMockSpeechWav(text, 'CZ-A0-M01-L01-PH001'),
        };
      },
      gcsUploader: async (bucket, obj) => `gs://${bucket}/${obj}`,
    })
  );

  const customServer = http.createServer(customApp);
  await new Promise<void>((resolve) => customServer.listen(0, '127.0.0.1', () => resolve()));
  const addr = customServer.address() as { port: number };
  const customUrl = `http://127.0.0.1:${addr.port}`;

  try {
    const ownerToken = mintOwnerFirebaseToken();
    const headers = {
      Authorization: `Bearer ${ownerToken}`,
      'Content-Type': 'application/json',
      'X-Requested-With': 'AhojAudioFactory',
    };

    // 1. Vertex connected, but durable GCS NOT configured -> MUST block BEFORE calling Vertex TTS!
    const blockedRes = await fetch(`${customUrl}/api/tts/generate`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        sourceId: 'CZ-A0-M01-L01-PH001',
        mode: 'vertex',
      }),
    });
    assert.equal(blockedRes.status, 503);
    const blockedJson = (await blockedRes.json()) as { code: string };
    assert.equal(blockedJson.code, 'EPHEMERAL_STORAGE_BLOCKED');
    assert.equal(ttsCallCount, 0, 'Must NOT invoke billable Vertex TTS when durable storage is unconfigured');

    // 2. Now enable verified durable GCS -> PH001 real WAV succeeds and records gs:// storage_ref
    gcsVerified = true;
    const okRes = await fetch(`${customUrl}/api/tts/generate`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        sourceId: 'CZ-A0-M01-L01-PH001',
        mode: 'vertex',
      }),
    });
    assert.equal(okRes.status, 200);
    const okJson = (await okRes.json()) as {
      job: { status: string; storage_backend: string; storage_ref: string; is_mock: boolean };
    };
    assert.equal(ttsCallCount, 1);
    assert.equal(okJson.job.status, 'REAL_SUCCESS');
    assert.equal(okJson.job.is_mock, false);
    assert.equal(okJson.job.storage_backend, 'gcs-private-bucket');
    assert.ok(okJson.job.storage_ref.startsWith('gs://ahoj-private-audio/real/'));
  } finally {
    await new Promise<void>((resolve) => customServer.close(() => resolve()));
  }
});
