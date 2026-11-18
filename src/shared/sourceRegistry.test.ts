import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SEED_FIRST_FIVE_ROWS,
  SPEECH_STYLE_PROFILES,
  generateManifestCsv,
  generatePronunciationIssuesCsv,
  generateSummaryJson,
  getVariantKey,
  isJobDriveEligible,
  parseAndValidateImport,
} from './sourceRegistry';
import type { AudioJobReceipt, QaRecord } from './types';

test('SEED_FIRST_FIVE_ROWS contains exact 5 records and PH006 BLOCK_DOMAIN gate', () => {
  assert.equal(SEED_FIRST_FIVE_ROWS.length, 5);
  assert.equal(SEED_FIRST_FIVE_ROWS[0].cs_exact, 'Dobrý den.');
  assert.equal(SEED_FIRST_FIVE_ROWS[4].source_id, 'CZ-A0-M01-L01-PH006');
  assert.equal(SEED_FIRST_FIVE_ROWS[4].cs_exact, 'Můžete to prosím zopakovat?');
  assert.equal(SEED_FIRST_FIVE_ROWS[4].source_gate, 'BLOCK_DOMAIN');
  assert.equal(SEED_FIRST_FIVE_ROWS[4].publish_allowed, false);
});

test('parseAndValidateImport preserves Czech accents and rejects duplicates or mixed versions', () => {
  const validCsv = [
    'source_id,lesson_id,cs_exact,dataset_version,source_gate',
    'CZ-A0-M01-L01-PH001,CZ-A0-M01-L01,Dobrý den.,v0.9.20,language_prosody_review',
    'CZ-A0-M01-L01-PH006,CZ-A0-M01-L01,"Můžete to prosím zopakovat?",v0.9.20,BLOCK_DOMAIN',
  ].join('\n');

  const ok = parseAndValidateImport(validCsv, 'csv', 'v0.9.20');
  assert.equal(ok.valid, true);
  assert.equal(ok.rows.length, 2);
  assert.equal(ok.rows[1].cs_exact, 'Můžete to prosím zopakovat?');

  const duplicateJson = JSON.stringify({
    dataset_version: 'v0.9.20',
    rows: [
      { source_id: 'CZ-1', lesson_id: 'L1', cs_exact: 'Ahoj.' },
      { source_id: 'CZ-1', lesson_id: 'L1', cs_exact: 'Čau.' },
    ],
  });
  const dupRes = parseAndValidateImport(duplicateJson, 'json', 'v0.9.20');
  assert.equal(dupRes.valid, false);
  assert.deepEqual(dupRes.duplicate_ids, ['CZ-1']);

  const mixedVersionJson = JSON.stringify({
    rows: [
      { source_id: 'CZ-1', lesson_id: 'L1', cs_exact: 'Ahoj.', dataset_version: 'v0.9.20' },
      { source_id: 'CZ-2', lesson_id: 'L1', cs_exact: 'Děkuji.', dataset_version: 'v0.9.21' },
    ],
  });
  const mixRes = parseAndValidateImport(mixedVersionJson, 'json');
  assert.equal(mixRes.valid, false);
  assert.ok(mixRes.errors.some((e) => e.includes('Холимог хувилбар')));
});

test('generateManifestCsv emits variant metadata columns and BLOCKED_FOR_RELEASE for PH006', () => {
  const receiptKey = getVariantKey('CZ-A0-M01-L01-PH006', 'natural');
  const jobs: Record<string, AudioJobReceipt> = {
    [receiptKey]: {
      receipt_key: receiptKey,
      source_id: 'CZ-A0-M01-L01-PH006',
      dataset_version: 'v0.9.20',
      cs_exact_sha256: SEED_FIRST_FIVE_ROWS[4].text_sha256,
      fingerprint: 'abc123',
      filename: 'PH006.wav',
      provider: 'local-mock-synth',
      model: 'gemini-3.8-flash-tts',
      voice: 'Achernar',
      speed_profile: 'normal',
      speech_style: 'natural',
      style_version: 'v1',
      status: 'MOCK',
      is_mock: true,
      http_status: null,
      provider_request_id: null,
      attempts: 1,
      last_error: null,
      audio_sha256: 'deadbeef',
      sample_rate: 24000,
      channels: 1,
      bit_depth: 16,
      duration_ms: 1400,
      file_size: 67244,
      peak_dbfs: -6.1,
      rms_dbfs: -12.4,
      format: 'wav',
      storage_ref: 'local://mock/MOCK_PH006.wav',
      storage_backend: 'local-preview-ephemeral',
      stale: false,
      created_at: '2026-11-17T00:00:00Z',
      updated_at: '2026-11-17T00:00:00Z',
    },
  };
  const qaMap: Record<string, QaRecord> = {
    [receiptKey]: {
      qa_key: receiptKey,
      source_id: 'CZ-A0-M01-L01-PH006',
      speech_style: 'natural',
      style_version: 'v1',
      receipt_key: receiptKey,
      listening_qa: 'REVIEW',
      publication_gate: 'BLOCKED_FOR_RELEASE',
      issue_category: 'stress',
      notes: 'ů эгшиг богино сонсогдов',
      reviewer: 'owner',
      updated_at: '2026-11-17T00:00:00Z',
    },
  };

  const manifest = generateManifestCsv(SEED_FIRST_FIVE_ROWS, jobs, qaMap);
  const lines = manifest.trim().split('\n');
  assert.equal(
    lines[0],
    'content_id,receipt_key,dataset_version,cs_exact_sha256,provider,model,voice,speech_style,style_version,speed_profile,fingerprint,audio_sha256,duration_ms,format,storage_ref,listening_qa,publication_gate'
  );
  assert.equal(lines.length, 6);
  assert.ok(lines[5].includes('BLOCKED_FOR_RELEASE'));

  const issuesCsv = generatePronunciationIssuesCsv(SEED_FIRST_FIVE_ROWS, qaMap);
  assert.ok(issuesCsv.includes('CZ-A0-M01-L01-PH006'));
  assert.ok(issuesCsv.includes('ů эгшиг богино сонсогдов'));

  const summary = JSON.parse(generateSummaryJson(SEED_FIRST_FIVE_ROWS, {}, jobs, qaMap));
  assert.equal(summary.real_success_count, 0);
  assert.equal(summary.mock_count, 1);
  assert.equal(summary.publication_policy, 'ALL_INTERNAL_PILOT_ONLY_BLOCKED_FOR_RELEASE');
});

test('SPEECH_STYLE_PROFILES and isJobDriveEligible enforce QA PASS-only Drive sync', () => {
  assert.match(SPEECH_STYLE_PROFILES.natural.style_prompt, /Warm, relaxed, authentic conversational Czech/);
  assert.match(SPEECH_STYLE_PROFILES.learning_slow.style_prompt, /Calm, clearly articulated Czech for an adult beginner/);

  const baseRealJob: AudioJobReceipt = {
    receipt_key: 'CZ-A0-M01-L01-PH001__natural',
    source_id: 'CZ-A0-M01-L01-PH001',
    dataset_version: 'v0.9.20',
    cs_exact_sha256: SEED_FIRST_FIVE_ROWS[0].text_sha256,
    fingerprint: 'fp1',
    filename: 'nat.wav',
    provider: 'vertex-ai',
    model: 'gemini-3.8-flash-tts',
    voice: 'Achernar',
    speed_profile: 'normal',
    speech_style: 'natural',
    style_version: 'v1',
    status: 'REAL_SUCCESS',
    is_mock: false,
    http_status: 200,
    provider_request_id: 'req-1',
    attempts: 1,
    last_error: null,
    audio_sha256: 'sha1',
    sample_rate: 24000,
    channels: 1,
    bit_depth: 16,
    duration_ms: 1100,
    file_size: 48000,
    peak_dbfs: -6,
    rms_dbfs: -12,
    format: 'wav',
    storage_ref: 'gs://bucket/real/v0.9.20/natural/v1/nat.wav',
    gcs_object_path: 'real/v0.9.20/natural/v1/nat.wav',
    storage_backend: 'gcs-private-bucket',
    stale: false,
    created_at: '2026-11-17T00:00:00Z',
    updated_at: '2026-11-17T00:00:00Z',
  };

  assert.equal(
    isJobDriveEligible(baseRealJob, {
      'CZ-A0-M01-L01-PH001__natural': {
        qa_key: 'CZ-A0-M01-L01-PH001__natural',
        source_id: 'CZ-A0-M01-L01-PH001',
        speech_style: 'natural',
        style_version: 'v1',
        receipt_key: 'CZ-A0-M01-L01-PH001__natural',
        audio_sha256: 'sha1',
        listening_qa: 'PASS',
        publication_gate: 'BLOCKED_FOR_RELEASE',
        issue_category: '',
        notes: '',
        reviewer: 'owner',
        updated_at: '2026-11-17T00:00:00Z',
      },
    }),
    true
  );

  for (const blockedStatus of ['REVIEW', 'FAIL', 'QA_PENDING'] as const) {
    assert.equal(
      isJobDriveEligible(baseRealJob, {
        'CZ-A0-M01-L01-PH001__natural': {
          qa_key: 'CZ-A0-M01-L01-PH001__natural',
          source_id: 'CZ-A0-M01-L01-PH001',
          speech_style: 'natural',
          listening_qa: blockedStatus,
          publication_gate: 'BLOCKED_FOR_RELEASE',
          issue_category: '',
          notes: '',
          reviewer: 'owner',
          updated_at: '2026-11-17T00:00:00Z',
        },
      }),
      false
    );
  }

  assert.equal(
    isJobDriveEligible({ ...baseRealJob, is_mock: true, status: 'MOCK' }, {
      'CZ-A0-M01-L01-PH001__natural': {
        qa_key: 'CZ-A0-M01-L01-PH001__natural',
        source_id: 'CZ-A0-M01-L01-PH001',
        speech_style: 'natural',
        listening_qa: 'PASS',
        publication_gate: 'BLOCKED_FOR_RELEASE',
        issue_category: '',
        notes: '',
        reviewer: 'owner',
        updated_at: '2026-11-17T00:00:00Z',
      },
    }),
    false
  );
});



test('Drive export gate rejects stale QA approvals after WAV regeneration', () => {
  const key = getVariantKey('CZ-A0-M01-L01-PH001', 'natural');
  const goodJob = {
    receipt_key: key,
    source_id: 'CZ-A0-M01-L01-PH001',
    speech_style: 'natural' as const,
    style_version: 'v1',
    is_mock: false,
    status: 'REAL_SUCCESS' as const,
    storage_backend: 'gcs-private-bucket' as const,
    audio_sha256: 'hash-v1',
    stale: false,
  } as AudioJobReceipt;
  const goodQA: QaRecord = {
    qa_key: key,
    source_id: goodJob.source_id,
    speech_style: 'natural',
    style_version: 'v1',
    receipt_key: key,
    audio_sha256: 'hash-v1',
    listening_qa: 'PASS',
    publication_gate: 'BLOCKED_FOR_RELEASE',
    issue_category: '',
    notes: '',
    reviewer: 'owner',
    updated_at: '2026-11-18T00:00:00Z',
  };
  assert.equal(isJobDriveEligible(goodJob, { [key]: goodQA }), true);
  assert.equal(isJobDriveEligible({ ...goodJob, audio_sha256: 'regenerated-wav' }, { [key]: goodQA }), false);
  assert.equal(isJobDriveEligible({ ...goodJob, stale: true }, { [key]: goodQA }), false);
  assert.equal(isJobDriveEligible({ ...goodJob, storage_backend: 'local-preview-ephemeral' }, { [key]: goodQA }), false);
  assert.equal(isJobDriveEligible(goodJob, { [key]: { ...goodQA, style_version: 'v2' } }), false);
  assert.equal(isJobDriveEligible(goodJob, { [key]: { ...goodQA, audio_sha256: undefined } }), false);
  assert.equal(isJobDriveEligible(goodJob, { [key]: { ...goodQA, receipt_key: 'wrong-receipt' } }), false);
});


test('Drive sync is blocked for BLOCK_DOMAIN, mismatched hash or dataset', () => {
  const key = getVariantKey('CZ-A0-M01-L01-PH006', 'natural');
  const source = SEED_FIRST_FIVE_ROWS[4];
  const job = {
    receipt_key: key,
    source_id: source.source_id,
    dataset_version: source.dataset_version,
    cs_exact_sha256: source.text_sha256,
    speech_style: 'natural',
    style_version: 'v1',
    status: 'REAL_SUCCESS',
    is_mock: false,
    stale: false,
    storage_backend: 'gcs-private-bucket',
    audio_sha256: 'same-wav',
  } as AudioJobReceipt;
  const qa: QaRecord = {
    qa_key: key,
    source_id: source.source_id,
    receipt_key: key,
    speech_style: 'natural',
    style_version: 'v1',
    audio_sha256: 'same-wav',
    listening_qa: 'PASS',
    publication_gate: 'BLOCKED_FOR_RELEASE',
    issue_category: '',
    notes: '',
    reviewer: 'owner',
    updated_at: '2026-11-18T00:00:00Z',
  };
  assert.equal(isJobDriveEligible(job, { [key]: qa }, source), false);
  const clearGateSource = { ...source, source_gate: 'language_prosody_review' };
  assert.equal(isJobDriveEligible(job, { [key]: qa }, clearGateSource), true);
  assert.equal(isJobDriveEligible({ ...job, cs_exact_sha256: 'wrong-hash' }, { [key]: qa }, clearGateSource), false);
  assert.equal(isJobDriveEligible({ ...job, dataset_version: 'other-version' }, { [key]: qa }, clearGateSource), false);
});
