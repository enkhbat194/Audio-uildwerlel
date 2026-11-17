import { GoogleAuth } from 'google-auth-library';
import { parseWavHeader, wrapPcm16ToWav } from '../shared/audioAndCrypto';
import {
  VERTEX_ENDPOINT,
  VERTEX_LOCATION,
  VERTEX_MODEL,
  VERTEX_PROJECT_ID,
  VERTEX_VOICE,
} from '../shared/sourceRegistry';
import type { CloudRuntimeStatus } from '../shared/types';

let cachedRuntimeCheck: { status: CloudRuntimeStatus; checkedAt: number } | null = null;

async function fetchMetadataIdentity(pathSuffix: string, timeoutMs = 800): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(
      `http://metadata.google.internal/computeMetadata/v1/${pathSuffix}`,
      {
        headers: { 'Metadata-Flavor': 'Google' },
        signal: controller.signal,
      }
    );
    clearTimeout(timer);
    if (!res.ok) return null;
    const text = (await res.text()).trim();
    return text || null;
  } catch {
    return null;
  }
}

export async function probeCloudRuntimeStatus(forceRefresh = false): Promise<CloudRuntimeStatus> {
  const now = Date.now();
  if (!forceRefresh && cachedRuntimeCheck && now - cachedRuntimeCheck.checkedAt < 30_000) {
    return cachedRuntimeCheck.status;
  }

  const gcsBucket = process.env.GCS_BUCKET_NAME?.trim() || null;
  const ownerEmail = process.env.OWNER_EMAIL_ALLOWLIST?.split(',')[0]?.trim() || null;
  const authMode: 'preview-local' | 'iap-or-allowlist' = process.env.OWNER_EMAIL_ALLOWLIST
    ? 'iap-or-allowlist'
    : 'preview-local';

  let adcAvailable = false;
  let runtimeIdentity: string | null = null;
  let adcError: string | null = null;

  try {
    const [hostedProject, saEmail] = await Promise.all([
      fetchMetadataIdentity('project/project-id'),
      fetchMetadataIdentity('instance/service-accounts/default/email'),
    ]);

    const isAiStudioSandbox = Boolean(saEmail && saEmail.startsWith('ais-sandbox@'));
    const projectMatches =
      hostedProject === VERTEX_PROJECT_ID || process.env.ALLOW_CROSS_PROJECT_ADC === 'true';

    if (isAiStudioSandbox || (!projectMatches && !process.env.GOOGLE_APPLICATION_CREDENTIALS)) {
      adcAvailable = false;
      runtimeIdentity = null;
      adcError =
        'AI Studio preview орчинд байна. project-a699c3ff-995a-4b88-add төслийн Cloud Run Workload Identity (ADC) холбогдоогүй.';
    } else {
      const auth = new GoogleAuth({
        scopes: ['https://www.googleapis.com/auth/cloud-platform'],
      });
      const probePromise = (async () => {
        const client = await auth.getClient();
        const tokenRes = await client.getAccessToken();
        if (tokenRes && tokenRes.token) {
          adcAvailable = true;
        }
      })();

      const timeoutPromise = new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error('ADC_METADATA_TIMEOUT')), 1200)
      );

      await Promise.race([probePromise, timeoutPromise]);

      if (adcAvailable) {
        runtimeIdentity =
          saEmail ?? process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ?? 'Cloud Run ADC Identity';
      }
    }
  } catch (err) {
    adcAvailable = false;
    adcError =
      err instanceof Error && err.message === 'ADC_METADATA_TIMEOUT'
        ? 'Cloud Run Workload Identity / ADC олдсонгүй (AI Studio preview орчин).'
        : err instanceof Error
          ? err.message
          : 'ADC шалгалт амжилтгүй боллоо.';
  }

  const status: CloudRuntimeStatus = {
    project_id: VERTEX_PROJECT_ID,
    location: VERTEX_LOCATION,
    model: VERTEX_MODEL,
    voice: VERTEX_VOICE,
    endpoint: VERTEX_ENDPOINT,
    vertex_connected: adcAvailable,
    adc_available: adcAvailable,
    runtime_identity: runtimeIdentity,
    storage_backend: gcsBucket && adcAvailable ? 'gcs-private-bucket' : 'local-preview',
    gcs_bucket: gcsBucket,
    firestore_connected: Boolean(process.env.FIRESTORE_DATABASE_ID && adcAvailable),
    drive_connected: false,
    drive_folder_name: null,
    auth_mode: authMode,
    owner_email: ownerEmail,
    estimated_cost_label: 'Тооцоолоогүй',
    rate_limit_rpm: Number(process.env.TTS_RATE_LIMIT_RPM ?? 10),
    max_first_batch: 5,
    adc_error: adcError,
  };

  cachedRuntimeCheck = { status, checkedAt: now };
  return status;
}

export async function getAdcAccessToken(): Promise<string> {
  const auth = new GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
  });
  const client = await auth.getClient();
  const tokenResponse = await client.getAccessToken();
  if (!tokenResponse?.token) {
    throw new Error('ADC access token олдсонгүй.');
  }
  return tokenResponse.token;
}

export async function uploadToGcsPrivateBucket(
  bucketName: string,
  objectName: string,
  bytes: Uint8Array,
  contentType = 'audio/wav'
): Promise<string> {
  const token = await getAdcAccessToken();
  const url = `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(bucketName)}/o?uploadType=media&name=${encodeURIComponent(objectName)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': contentType,
    },
    body: Buffer.from(bytes),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`GCS upload алдаа (${res.status}): ${errText.slice(0, 200)}`);
  }
  return `gs://${bucketName}/${objectName}`;
}

export interface VertexTtsCallResult {
  ok: boolean;
  httpStatus: number;
  providerRequestId: string | null;
  attempts: number;
  wavBytes?: Uint8Array;
  errorCode?: string;
  errorMessage?: string;
  ambiguous?: boolean;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function callVertexTtsWithRetry(
  exactCzechText: string,
  voice = VERTEX_VOICE,
  maxRetries = 3
): Promise<VertexTtsCallResult> {
  let token: string;
  try {
    token = await getAdcAccessToken();
  } catch (err) {
    return {
      ok: false,
      httpStatus: 503,
      providerRequestId: null,
      attempts: 0,
      errorCode: 'VERTEX_ADC_NOT_CONFIGURED',
      errorMessage:
        err instanceof Error
          ? err.message
          : 'Vertex AI ADC эрх тохируулаагүй байна.',
    };
  }

  const payload = {
    contents: [{ role: 'user', parts: [{ text: exactCzechText }] }],
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: {
        voiceConfig: {
          voice,
        },
      },
    },
  };

  let attempts = 0;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    attempts = attempt + 1;
    let res: Response;
    try {
      res = await fetch(VERTEX_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
    } catch (networkErr) {
      if (attempt < maxRetries) {
        const backoff = Math.min(8000, 750 * Math.pow(2, attempt)) + Math.random() * 400;
        await sleep(backoff);
        continue;
      }
      return {
        ok: false,
        httpStatus: 0,
        providerRequestId: null,
        attempts,
        ambiguous: true,
        errorCode: 'AMBIGUOUS_NETWORK_INTERRUPTION',
        errorMessage:
          networkErr instanceof Error
            ? `Сүлжээний тасалдал: ${networkErr.message}`
            : 'Сүлжээний тасалдал гарлаа.',
      };
    }

    const requestId =
      res.headers.get('x-guploader-uploadid') ??
      res.headers.get('x-request-id') ??
      null;

    // 401/403 must stop immediately without retry
    if (res.status === 401 || res.status === 403) {
      const bodyText = await res.text();
      return {
        ok: false,
        httpStatus: res.status,
        providerRequestId: requestId,
        attempts,
        errorCode: 'AUTH_OR_IAM_DENIED',
        errorMessage: `Vertex AI эрхийн алдаа (${res.status}): Cloud Run service account-д Vertex AI User эрх шаардлагатай. ${bodyText.slice(0, 180)}`,
      };
    }

    // 429 or 5xx: retry with exponential backoff + Retry-After
    if ((res.status === 429 || res.status >= 500) && attempt < maxRetries) {
      const retryAfterHeader = res.headers.get('retry-after');
      const retryAfterSec = retryAfterHeader ? Number(retryAfterHeader) : NaN;
      const waitMs =
        !Number.isNaN(retryAfterSec) && retryAfterSec > 0
          ? Math.min(15000, retryAfterSec * 1000)
          : Math.min(10000, 800 * Math.pow(2, attempt)) + Math.random() * 500;
      await sleep(waitMs);
      continue;
    }

    if (!res.ok) {
      const errBody = await res.text();
      return {
        ok: false,
        httpStatus: res.status,
        providerRequestId: requestId,
        attempts,
        errorCode: `HTTP_${res.status}`,
        errorMessage: `Vertex AI хариу (${res.status}): ${errBody.slice(0, 240)}`,
      };
    }

    // Parse Vertex JSON response and validate actual audio payload
    let jsonBody: any;
    try {
      jsonBody = await res.json();
    } catch {
      return {
        ok: false,
        httpStatus: res.status,
        providerRequestId: requestId,
        attempts,
        ambiguous: true,
        errorCode: 'INVALID_JSON_RESPONSE',
        errorMessage: 'Vertex AI хариуг JSON болгон задлахад алдаа гарлаа.',
      };
    }

    const parts = jsonBody?.candidates?.[0]?.content?.parts;
    if (!Array.isArray(parts)) {
      return {
        ok: false,
        httpStatus: res.status,
        providerRequestId: requestId,
        attempts,
        errorCode: 'MISSING_AUDIO_PARTS',
        errorMessage: 'Хариу дотор audio parts олдсонгүй.',
      };
    }

    const inlinePart = parts.find(
      (p: any) => p?.inlineData?.data && typeof p.inlineData.mimeType === 'string'
    );
    if (!inlinePart) {
      return {
        ok: false,
        httpStatus: res.status,
        providerRequestId: requestId,
        attempts,
        errorCode: 'NO_INLINE_AUDIO_DATA',
        errorMessage: 'inlineData аудио өгөгдөл ирсэнгүй.',
      };
    }

    const mimeType: string = inlinePart.inlineData.mimeType.toLowerCase();
    const rawBytes = new Uint8Array(Buffer.from(inlinePart.inlineData.data, 'base64'));

    let wavBytes: Uint8Array;
    if (
      rawBytes.byteLength >= 12 &&
      String.fromCharCode(...rawBytes.slice(0, 4)) === 'RIFF' &&
      String.fromCharCode(...rawBytes.slice(8, 12)) === 'WAVE'
    ) {
      wavBytes = rawBytes;
    } else if (mimeType.includes('pcm') || mimeType.includes('l16')) {
      const rateMatch = mimeType.match(/rate=(\d+)/);
      const rate = rateMatch ? Number(rateMatch[1]) : 24000;
      wavBytes = wrapPcm16ToWav(rawBytes, rate, 1);
    } else {
      return {
        ok: false,
        httpStatus: res.status,
        providerRequestId: requestId,
        attempts,
        errorCode: 'UNRECOGNIZED_AUDIO_SIGNATURE',
        errorMessage: `WAV RIFF/WAVE эсвэл PCM16 биш өгөгдөл ирлээ (mime: ${mimeType}).`,
      };
    }

    const parsed = parseWavHeader(wavBytes);
    if (!parsed.valid || parsed.durationMs <= 0) {
      return {
        ok: false,
        httpStatus: res.status,
        providerRequestId: requestId,
        attempts,
        errorCode: 'INVALID_WAV_HEADER',
        errorMessage: parsed.error ?? 'WAV толгой буруу байна.',
      };
    }

    return {
      ok: true,
      httpStatus: res.status,
      providerRequestId: jsonBody?.responseId ?? requestId,
      attempts,
      wavBytes,
    };
  }

  return {
    ok: false,
    httpStatus: 503,
    providerRequestId: null,
    attempts,
    errorCode: 'MAX_RETRIES_EXCEEDED',
    errorMessage: 'Дахин оролдлогын хязгаар хэтэрлээ.',
  };
}
