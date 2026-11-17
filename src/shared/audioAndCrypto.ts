import type { SpeedProfile } from './types';

// Pure synchronous SHA-256 implementation (FIPS 180-4) for browser + Node.js parity
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotr(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n));
}

export function sha256Bytes(data: Uint8Array): string {
  const len = data.length;
  const bitLen = len * 8;
  const paddedLen = Math.ceil((len + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLen);
  padded.set(data);
  padded[len] = 0x80;

  const view = new DataView(padded.buffer);
  view.setUint32(paddedLen - 8, Math.floor(bitLen / 0x100000000), false);
  view.setUint32(paddedLen - 4, bitLen >>> 0, false);

  const H = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);

  const W = new Uint32Array(64);
  for (let offset = 0; offset < paddedLen; offset += 64) {
    for (let i = 0; i < 16; i++) {
      W[i] = view.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(W[i - 15], 7) ^ rotr(W[i - 15], 18) ^ (W[i - 15] >>> 3);
      const s1 = rotr(W[i - 2], 17) ^ rotr(W[i - 2], 19) ^ (W[i - 2] >>> 10);
      W[i] = (W[i - 16] + s0 + W[i - 7] + s1) >>> 0;
    }

    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + K[i] + W[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    H[0] = (H[0] + a) >>> 0;
    H[1] = (H[1] + b) >>> 0;
    H[2] = (H[2] + c) >>> 0;
    H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0;
    H[5] = (H[5] + f) >>> 0;
    H[6] = (H[6] + g) >>> 0;
    H[7] = (H[7] + h) >>> 0;
  }

  return Array.from(H)
    .map((word) => word.toString(16).padStart(8, '0'))
    .join('');
}

export function sha256Utf8(text: string): string {
  const bytes = new TextEncoder().encode(text);
  return sha256Bytes(bytes);
}

export const REQUEST_SCHEMA_VERSION = 'vertex-tts-v1-exact-text';

export interface FingerprintInput {
  source_id: string;
  dataset_version: string;
  exact_text_sha256: string;
  model: string;
  voice: string;
  speed_profile: SpeedProfile;
  request_schema?: string;
}

export function computeGenerationFingerprint(input: FingerprintInput): string {
  const canonical = [
    input.source_id,
    input.dataset_version,
    input.exact_text_sha256,
    input.model,
    input.voice,
    input.speed_profile,
    input.request_schema ?? REQUEST_SCHEMA_VERSION,
  ].join('|');
  return sha256Utf8(canonical);
}

export function buildDeterministicFilename(input: FingerprintInput): string {
  const fp = computeGenerationFingerprint(input);
  const safeModel = input.model.replace(/[^a-zA-Z0-9._-]/g, '_');
  const safeVoice = input.voice.replace(/[^a-zA-Z0-9._-]/g, '_');
  return `${input.source_id}__${safeModel}__${safeVoice}__${input.speed_profile}__${fp.slice(0, 12)}.wav`;
}

export interface ParsedWavInfo {
  valid: boolean;
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  dataByteLength: number;
  durationMs: number;
  peakDbfs: number | null;
  rmsDbfs: number | null;
  error?: string;
}

export function wrapPcm16ToWav(
  pcmBytes: Uint8Array,
  sampleRate = 24000,
  channels = 1
): Uint8Array {
  const bitsPerSample = 16;
  const blockAlign = channels * (bitsPerSample / 8);
  const byteRate = sampleRate * blockAlign;
  const dataSize = pcmBytes.byteLength;
  const wavBuffer = new Uint8Array(44 + dataSize);
  const view = new DataView(wavBuffer.buffer);

  // RIFF chunk descriptor
  wavBuffer.set([0x52, 0x49, 0x46, 0x46], 0); // "RIFF"
  view.setUint32(4, 36 + dataSize, true);
  wavBuffer.set([0x57, 0x41, 0x56, 0x45], 8); // "WAVE"

  // fmt sub-chunk
  wavBuffer.set([0x66, 0x6d, 0x74, 0x20], 12); // "fmt "
  view.setUint32(16, 16, true); // PCM subchunk size
  view.setUint16(20, 1, true); // PCM = 1
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);

  // data sub-chunk
  wavBuffer.set([0x64, 0x61, 0x74, 0x61], 36); // "data"
  view.setUint32(40, dataSize, true);
  wavBuffer.set(pcmBytes, 44);

  return wavBuffer;
}

export function parseWavHeader(wavBytes: Uint8Array): ParsedWavInfo {
  if (wavBytes.byteLength < 44) {
    return {
      valid: false,
      sampleRate: 0,
      channels: 0,
      bitsPerSample: 0,
      dataByteLength: 0,
      durationMs: 0,
      peakDbfs: null,
      rmsDbfs: null,
      error: 'WAV file smaller than 44-byte RIFF header',
    };
  }

  const ascii = (start: number, len: number) =>
    String.fromCharCode(...wavBytes.slice(start, start + len));

  if (ascii(0, 4) !== 'RIFF' || ascii(8, 4) !== 'WAVE') {
    return {
      valid: false,
      sampleRate: 0,
      channels: 0,
      bitsPerSample: 0,
      dataByteLength: 0,
      durationMs: 0,
      peakDbfs: null,
      rmsDbfs: null,
      error: 'Missing RIFF/WAVE signature',
    };
  }

  const view = new DataView(wavBytes.buffer, wavBytes.byteOffset, wavBytes.byteLength);
  let offset = 12;
  let audioFormat = 0;
  let channels = 0;
  let sampleRate = 0;
  let bitsPerSample = 0;
  let dataOffset = -1;
  let dataByteLength = 0;

  while (offset + 8 <= wavBytes.byteLength) {
    const chunkId = ascii(offset, 4);
    const chunkSize = view.getUint32(offset + 4, true);
    const chunkBodyOffset = offset + 8;

    if (chunkId === 'fmt ' && chunkSize >= 16 && chunkBodyOffset + 16 <= wavBytes.byteLength) {
      audioFormat = view.getUint16(chunkBodyOffset, true);
      channels = view.getUint16(chunkBodyOffset + 2, true);
      sampleRate = view.getUint32(chunkBodyOffset + 4, true);
      bitsPerSample = view.getUint16(chunkBodyOffset + 14, true);
    } else if (chunkId === 'data') {
      dataOffset = chunkBodyOffset;
      dataByteLength = Math.min(chunkSize, wavBytes.byteLength - chunkBodyOffset);
      break;
    }

    // Chunks are word-aligned (padded to even byte count)
    offset = chunkBodyOffset + chunkSize + (chunkSize % 2);
  }

  if (dataOffset < 0 || sampleRate <= 0 || channels <= 0 || bitsPerSample <= 0) {
    return {
      valid: false,
      sampleRate,
      channels,
      bitsPerSample,
      dataByteLength: 0,
      durationMs: 0,
      peakDbfs: null,
      rmsDbfs: null,
      error: 'Missing valid fmt or data chunk in WAV',
    };
  }

  if (audioFormat !== 1) {
    return {
      valid: false,
      sampleRate,
      channels,
      bitsPerSample,
      dataByteLength,
      durationMs: 0,
      peakDbfs: null,
      rmsDbfs: null,
      error: `Unsupported WAV format code ${audioFormat} (expected PCM16 = 1)`,
    };
  }

  const bytesPerSample = bitsPerSample / 8;
  const totalFrames = Math.floor(dataByteLength / (channels * bytesPerSample));
  const durationMs = Math.round((totalFrames / sampleRate) * 1000);

  let peakDbfs: number | null = null;
  let rmsDbfs: number | null = null;

  if (bitsPerSample === 16 && totalFrames > 0) {
    let peak = 0;
    let sumSq = 0;
    const sampleCount = Math.floor(dataByteLength / 2);
    for (let i = 0; i < sampleCount; i++) {
      const sample = view.getInt16(dataOffset + i * 2, true) / 32768;
      const abs = Math.abs(sample);
      if (abs > peak) peak = abs;
      sumSq += sample * sample;
    }
    const rms = Math.sqrt(sumSq / sampleCount);
    peakDbfs = peak > 0 ? Number((20 * Math.log10(peak)).toFixed(2)) : -96;
    rmsDbfs = rms > 0 ? Number((20 * Math.log10(rms)).toFixed(2)) : -96;
  }

  return {
    valid: true,
    sampleRate,
    channels,
    bitsPerSample,
    dataByteLength,
    durationMs,
    peakDbfs,
    rmsDbfs,
  };
}

/**
 * Generates an explicitly synthetic MOCK PCM16 24kHz mono WAV tone sequence
 * proportional to the Czech phrase length so UI playback, waveform meters,
 * SHA-256 verification, and ZIP export operate on real physical WAV files
 * while clearly marked MOCK (never counted as real Vertex production).
 */
export function generateMockSpeechWav(text: string, sourceId: string): Uint8Array {
  const sampleRate = 24000;
  const wordCount = Math.max(2, text.trim().split(/\s+/).length);
  const durationSec = Math.min(3.2, Math.max(0.95, 0.45 + wordCount * 0.38));
  const totalSamples = Math.floor(sampleRate * durationSec);
  const pcm = new Uint8Array(totalSamples * 2);
  const view = new DataView(pcm.buffer);

  // Seed base pitch deterministically from sourceId
  let seed = 0;
  for (let i = 0; i < sourceId.length; i++) {
    seed = (seed * 31 + sourceId.charCodeAt(i)) >>> 0;
  }
  const baseFreq = 165 + (seed % 55);

  for (let i = 0; i < totalSamples; i++) {
    const t = i / sampleRate;
    const progress = i / totalSamples;
    // Syllable envelope (smooth cadence with fade in/out)
    const syllableEnv = Math.pow(Math.sin(Math.PI * progress * wordCount * 1.4), 2);
    const edgeFade =
      Math.min(1, i / (sampleRate * 0.04)) *
      Math.min(1, (totalSamples - 1 - i) / (sampleRate * 0.06));
    const contour = 1 + 0.08 * Math.sin(2 * Math.PI * 1.3 * t);
    const fundamental = Math.sin(2 * Math.PI * baseFreq * contour * t);
    const harmonic2 = 0.45 * Math.sin(2 * Math.PI * baseFreq * 2 * contour * t);
    const harmonic3 = 0.2 * Math.sin(2 * Math.PI * baseFreq * 3 * contour * t);

    const sampleFloat = (fundamental + harmonic2 + harmonic3) * 0.22 * (0.25 + 0.75 * syllableEnv) * edgeFade;
    const int16 = Math.max(-32768, Math.min(32767, Math.round(sampleFloat * 32767)));
    view.setInt16(i * 2, int16, true);
  }

  return wrapPcm16ToWav(pcm, sampleRate, 1);
}
