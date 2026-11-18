import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDeterministicFilename,
  computeGenerationFingerprint,
  generateMockSpeechWav,
  parseWavHeader,
  sha256Utf8,
  wrapPcm16ToWav,
} from './audioAndCrypto';

test('sha256Utf8 matches canonical source_lock_v0924 Czech string hashes', () => {
  assert.equal(
    sha256Utf8('Dobrý den.'),
    'd00f594ba38748a33a764dcbb341c5618ef80c4a8a49821e00dd9226088dd370'
  );
  assert.equal(
    sha256Utf8('Můžete to prosím zopakovat?'),
    'bf9d9632e1e849fe8ff45221db6602068258960c39055955cc6450e598ebb7ef'
  );
});

test('wrapPcm16ToWav and parseWavHeader produce valid 24kHz mono PCM16 WAV metadata', () => {
  const pcm = new Uint8Array(48000); // 1 second at 24kHz mono 16-bit
  const view = new DataView(pcm.buffer);
  for (let i = 0; i < 24000; i++) {
    view.setInt16(i * 2, Math.round(Math.sin((2 * Math.PI * 440 * i) / 24000) * 16384), true);
  }

  const wav = wrapPcm16ToWav(pcm, 24000, 1);
  const parsed = parseWavHeader(wav);

  assert.equal(parsed.valid, true);
  assert.equal(parsed.sampleRate, 24000);
  assert.equal(parsed.channels, 1);
  assert.equal(parsed.bitsPerSample, 16);
  assert.equal(parsed.durationMs, 1000);
  assert.ok(parsed.peakDbfs !== null && parsed.peakDbfs < -5 && parsed.peakDbfs > -7);
  assert.ok(parsed.rmsDbfs !== null && parsed.rmsDbfs < -8 && parsed.rmsDbfs > -11);
});

test('parseWavHeader rejects arbitrary non-WAV bytes instead of blindly renaming', () => {
  const garbage = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0xff, 0xfe]);
  const parsed = parseWavHeader(garbage);
  assert.equal(parsed.valid, false);
  assert.ok(parsed.error);
});

test('generateMockSpeechWav produces playable valid WAVs with longer duration for learning_slow', () => {
  const naturalWav = generateMockSpeechWav('Jak se jmenujete?', 'CZ-A0-M01-L01-PH003', 'natural');
  const slowWav = generateMockSpeechWav('Jak se jmenujete?', 'CZ-A0-M01-L01-PH003', 'learning_slow');
  const parsedNat = parseWavHeader(naturalWav);
  const parsedSlow = parseWavHeader(slowWav);
  assert.equal(parsedNat.valid, true);
  assert.equal(parsedNat.sampleRate, 24000);
  assert.equal(parsedNat.channels, 1);
  assert.ok(parsedNat.durationMs >= 950);
  assert.equal(parsedSlow.valid, true);
  assert.ok(parsedSlow.durationMs > parsedNat.durationMs);
});

test('computeGenerationFingerprint and filename include speech_style and style_version and invalidate on Czech text or style changes', () => {
  const fpNatural = computeGenerationFingerprint({
    source_id: 'CZ-A0-M01-L01-PH001',
    dataset_version: 'v0.9.20',
    exact_text_sha256: sha256Utf8('Dobrý den.'),
    model: 'gemini-3.8-flash-tts',
    voice: 'Achernar',
    speed_profile: 'normal',
    speech_style: 'natural',
    style_version: 'v1',
  });
  const fpTextChanged = computeGenerationFingerprint({
    source_id: 'CZ-A0-M01-L01-PH001',
    dataset_version: 'v0.9.20',
    exact_text_sha256: sha256Utf8('Dobrý večer.'),
    model: 'gemini-3.8-flash-tts',
    voice: 'Achernar',
    speed_profile: 'normal',
    speech_style: 'natural',
    style_version: 'v1',
  });
  const fpSlow = computeGenerationFingerprint({
    source_id: 'CZ-A0-M01-L01-PH001',
    dataset_version: 'v0.9.20',
    exact_text_sha256: sha256Utf8('Dobrý den.'),
    model: 'gemini-3.8-flash-tts',
    voice: 'Achernar',
    speed_profile: 'slow',
    speech_style: 'learning_slow',
    style_version: 'v1',
  });
  const fpVersionBump = computeGenerationFingerprint({
    source_id: 'CZ-A0-M01-L01-PH001',
    dataset_version: 'v0.9.20',
    exact_text_sha256: sha256Utf8('Dobrý den.'),
    model: 'gemini-3.8-flash-tts',
    voice: 'Achernar',
    speed_profile: 'normal',
    speech_style: 'natural',
    style_version: 'v2',
  });

  assert.notEqual(fpNatural, fpTextChanged);
  assert.notEqual(fpNatural, fpSlow);
  assert.notEqual(fpNatural, fpVersionBump);

  const naturalFilename = buildDeterministicFilename({
    source_id: 'CZ-A0-M01-L01-PH001',
    dataset_version: 'v0.9.20',
    exact_text_sha256: sha256Utf8('Dobrý den.'),
    model: 'gemini-3.8-flash-tts',
    voice: 'Achernar',
    speed_profile: 'normal',
    speech_style: 'natural',
    style_version: 'v1',
  });
  const slowFilename = buildDeterministicFilename({
    source_id: 'CZ-A0-M01-L01-PH001',
    dataset_version: 'v0.9.20',
    exact_text_sha256: sha256Utf8('Dobrý den.'),
    model: 'gemini-3.8-flash-tts',
    voice: 'Achernar',
    speed_profile: 'slow',
    speech_style: 'learning_slow',
    style_version: 'v1',
  });
  assert.match(
    naturalFilename,
    /^CZ-A0-M01-L01-PH001__gemini-3\.8-flash-tts__Achernar__natural__v1__[0-9a-f]{12}\.wav$/
  );
  assert.match(
    slowFilename,
    /^CZ-A0-M01-L01-PH001__gemini-3\.8-flash-tts__Achernar__learning_slow__v1__[0-9a-f]{12}\.wav$/
  );
  assert.notEqual(naturalFilename, slowFilename);
});

