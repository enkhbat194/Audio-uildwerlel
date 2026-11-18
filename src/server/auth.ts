import { OAuth2Client } from 'google-auth-library';
import firebaseConfig from '../../firebase-applet-config.json' with { type: 'json' };

const DEFAULT_OWNER_ALLOWLIST = ['zazadada8899@gmail.com'];
const FIREBASE_CERT_URL =
  'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';

export interface AuthVerificationResult {
  authenticated: boolean;
  method: 'iap-jwt' | 'firebase-id-token' | null;
  email: string | null;
  uid: string | null;
  statusCode: number;
  error?: string;
}

export interface AuthVerifierDeps {
  fetchFirebaseCerts?: () => Promise<Record<string, string>>;
  fetchIapKeys?: () => Promise<Record<string, any>>;
  projectId?: string;
  iapAudience?: string | null;
  requireIap?: boolean;
  ownerAllowlist?: string[];
  nowSeconds?: number;
}

let cachedFirebaseCerts: { certs: Record<string, string>; expiresAt: number } | null = null;
const oauthClient = new OAuth2Client();

export function getOwnerAllowlist(override?: string[]): string[] {
  if (override !== undefined) {
    return override
      .map((e) => e.trim().toLowerCase())
      .filter((e) => Boolean(e) && e !== '*');
  }
  const raw = process.env.OWNER_EMAIL_ALLOWLIST?.trim();
  if (!raw) return DEFAULT_OWNER_ALLOWLIST;
  const parsed = raw
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter((e) => Boolean(e) && e !== '*' && e.includes('@'));
  return parsed.length > 0 ? parsed : DEFAULT_OWNER_ALLOWLIST;
}

async function defaultFetchFirebaseCerts(): Promise<Record<string, string>> {
  const now = Date.now();
  if (cachedFirebaseCerts && now < cachedFirebaseCerts.expiresAt) {
    return cachedFirebaseCerts.certs;
  }
  const res = await fetch(FIREBASE_CERT_URL);
  if (!res.ok) {
    throw new Error(`Failed to fetch Firebase public certs (${res.status})`);
  }
  const certs = (await res.json()) as Record<string, string>;
  const cacheControl = res.headers.get('cache-control') ?? '';
  const maxAgeMatch = cacheControl.match(/max-age=(\d+)/);
  const ttlMs = maxAgeMatch ? Number(maxAgeMatch[1]) * 1000 : 3600_000;
  cachedFirebaseCerts = { certs, expiresAt: now + ttlMs };
  return certs;
}

async function defaultFetchIapKeys(): Promise<Record<string, any>> {
  const res = await oauthClient.getIapPublicKeys();
  return res.pubkeys as Record<string, any>;
}

function getHeaderString(
  headers: Record<string, string | string[] | undefined>,
  name: string
): string | null {
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === lower) {
      if (Array.isArray(v)) return v[0] ?? null;
      return typeof v === 'string' ? v : null;
    }
  }
  return null;
}

/**
 * Fail-closed owner authentication:
 * 1. Verifies signed Cloud Run IAP JWT (`X-Goog-IAP-JWT-Assertion`) when IAP is active/required.
 * 2. Or verifies signed Firebase Auth ID token (`Authorization: Bearer <token>`) against project certs.
 * 3. NEVER trusts unsigned email headers (`x-goog-authenticated-user-email` alone).
 */
export async function authenticateOwnerRequest(
  headers: Record<string, string | string[] | undefined>,
  deps: AuthVerifierDeps = {}
): Promise<AuthVerificationResult> {
  const allowlist = getOwnerAllowlist(deps.ownerAllowlist);
  const projectId = deps.projectId ?? firebaseConfig.projectId ?? 'project-a699c3ff-995a-4b88-add';
  const iapAudience =
    deps.iapAudience !== undefined ? deps.iapAudience : process.env.IAP_AUDIENCE?.trim() || null;
  const requireIap =
    deps.requireIap !== undefined ? deps.requireIap : process.env.REQUIRE_IAP === 'true';

  if (requireIap && !iapAudience) {
    return {
      authenticated: false,
      method: null,
      email: null,
      uid: null,
      statusCode: 503,
      error: 'IAP_AUDIENCE тохируулаагүй тул fail-closed хамгаалалтаар хүсэлтийг зогсоолоо.',
    };
  }

  const iapJwt = getHeaderString(headers, 'x-goog-iap-jwt-assertion')?.trim();
  if (iapJwt) {
    if (!iapAudience) {
      return {
        authenticated: false,
        method: null,
        email: null,
        uid: null,
        statusCode: 403,
        error: 'IAP JWT илэрсэн боловч IAP_AUDIENCE серверийн тохиргоо дутуу байна.',
      };
    }

    try {
      const pubkeys = await (deps.fetchIapKeys ?? defaultFetchIapKeys)();
      const ticket = await oauthClient.verifySignedJwtWithCertsAsync(
        iapJwt,
        pubkeys,
        iapAudience,
        ['https://cloud.google.com/iap']
      );
      const payload = ticket.getPayload();
      const email = payload?.email?.toLowerCase() ?? null;
      const emailVerified = payload?.email_verified !== false;

      if (!email || !emailVerified || !allowlist.includes(email)) {
        return {
          authenticated: false,
          method: null,
          email,
          uid: payload?.sub ?? null,
          statusCode: 403,
          error: 'IAP хандалт зөвшөөрөгдсөн эзэмшигчийн жагсаалтад багтаагүй байна.',
        };
      }

      return {
        authenticated: true,
        method: 'iap-jwt',
        email,
        uid: payload?.sub ?? email,
        statusCode: 200,
      };
    } catch (err) {
      return {
        authenticated: false,
        method: null,
        email: null,
        uid: null,
        statusCode: 401,
        error: `Cloud Run IAP JWT баталгаажуулалт амжилтгүй: ${
          err instanceof Error ? err.message : 'invalid token'
        }`,
      };
    }
  }

  if (requireIap) {
    return {
      authenticated: false,
      method: null,
      email: null,
      uid: null,
      statusCode: 401,
      error: 'Cloud Run IAP гарын үсэгтэй толгой (X-Goog-IAP-JWT-Assertion) шаардлагатай.',
    };
  }

  // Check Firebase ID Token (Authorization: Bearer <idToken>)
  const authHeader = getHeaderString(headers, 'authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return {
      authenticated: false,
      method: null,
      email: null,
      uid: null,
      statusCode: 401,
      error: 'Эзэмшигчийн баталгаажуулалт шаардлагатай (Sign in with Google эсвэл Cloud Run IAP).',
    };
  }

  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) {
    return {
      authenticated: false,
      method: null,
      email: null,
      uid: null,
      statusCode: 401,
      error: 'Хоосон Bearer токен.',
    };
  }

  try {
    const certs = await (deps.fetchFirebaseCerts ?? defaultFetchFirebaseCerts)();
    const expectedIss = `https://securetoken.google.com/${projectId}`;
    const ticket = await oauthClient.verifySignedJwtWithCertsAsync(
      token,
      certs,
      projectId,
      [expectedIss]
    );
    const payload = ticket.getPayload();
    const email = payload?.email?.toLowerCase() ?? null;
    const emailVerified = payload?.email_verified === true;
    const uid = payload?.sub ?? null;

    if (!uid || !email || !emailVerified) {
      return {
        authenticated: false,
        method: null,
        email,
        uid,
        statusCode: 403,
        error: 'Баталгаажсан имэйлтэй Google бүртгэл шаардлагатай.',
      };
    }

    if (!allowlist.includes(email)) {
      return {
        authenticated: false,
        method: null,
        email,
        uid,
        statusCode: 403,
        error: `Энэ бүртгэл (${email}) эзэмшигчийн allowlist-д байхгүй байна.`,
      };
    }

    return {
      authenticated: true,
      method: 'firebase-id-token',
      email,
      uid,
      statusCode: 200,
    };
  } catch (err) {
    return {
      authenticated: false,
      method: null,
      email: null,
      uid: null,
      statusCode: 401,
      error: `Firebase Auth токен хүчингүй байна: ${
        err instanceof Error ? err.message : 'invalid jwt'
      }`,
    };
  }
}
