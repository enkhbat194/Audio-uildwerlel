import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SEED_FIRST_FIVE_ROWS,
  generateManifestCsv,
  generatePronunciationIssuesCsv,
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

test('generateManifestCsv emits required canonical columns and BLOCKED_FOR_RELEASE for PH006', () => {
  const jobs: Record<string, AudioJobReceipt> = {
    'CZ-A0-M01-L01-PH006': {
      source_id: 'CZ-A0-M01-L01-PH006',
      dataset_version: 'v0.9.20',
      cs_exact_sha256: SEED_FIRST_FIVE_ROWS[4].text_sha256,
      fingerprint: 'abc123',
      filename: 'PH006.wav',
      provider: 'local-mock-synth',
      model: 'gemini-3.8-flash-tts',
      voice: 'Achernar',
      speed_profile: 'normal',
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
      storage_ref: 'local://.data/audio/PH006.wav',
      storage_backend: 'local-preview',
      stale: false,
      created_at: '2026-11-17T00:00:00Z',
      updated_at: '2026-11-17T00:00:00Z',
    },
  };
  const qaMap: Record<string, QaRecord> = {
    'CZ-A0-M01-L01-PH006': {
      source_id: 'CZ-A0-M01-L01-PH006',
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
    'content_id,dataset_version,cs_exact_sha256,provider,model,voice,speed_profile,audio_sha256,duration_ms,format,storage_ref,listening_qa,publication_gate'
  );
  assert.equal(lines.length, 6);
  assert.ok(lines[5].includes('BLOCKED_FOR_RELEASE'));

  const issuesCsv = generatePronunciationIssuesCsv(SEED_FIRST_FIVE_ROWS, qaMap);
  assert.ok(issuesCsv.includes('CZ-A0-M01-L01-PH006'));
  assert.ok(issuesCsv.includes('ů эгшиг богино сонсогдов'));
});
