# Ahoj Česko Audio Factory — free hosting experiment (2026-11-18)

**Branch:** `experiment/free-hosting-render-20261118` (from `main`). Do not merge this experiment into `main` or redeploy the current Cloud Run Audio Factory automatically.

## Verified architecture today

- React/Vite front end with Express/TypeScript API (`server.ts`).
- REAL TTS: Google Vertex AI via Application Default Credentials (ADC); `src/server/vertexTts.ts`.
- Durable WAV: private Google Cloud Storage bucket. Signed-in owner access: IAP JWT or Firebase ID token (`src/server/auth.ts`).
- Server currently depends on Cloud Run's attached runtime service account to obtain ADC tokens. A separate free host **does not inherit this identity**.
- Server also writes a local JSON snapshot (`src/server/storage.ts`); that is unsuitable for durable state on an ephemeral hosting plan.

## Options and reality check

1. **Keep Cloud Run and deploy from GitHub:** lowest-risk option. Cloud Run has a monthly free allowance; Vertex AI TTS usage and storage are separately metered. Requires GitHub-based deployment configuration, not AI Studio Publish.
2. **Render Free — experimental full-stack host:** `render.yaml` is provided for a no-secrets, non-production hosting proof. It supports the existing Node/Express shape with almost no rewrite, but sleeps after 15 minutes of inactivity, has ephemeral local storage, and grants 750 instance-hours per month per workspace. Its free plan should not be treated as a production guarantee.
3. **Cloudflare Workers Free + R2 Free:** a future rebuild might reduce hosting and storage costs, but Express/Node filesystem access, auth, and Vertex ADC must be redesigned; this is *not* a lift-and-shift.
4. **Koyeb Free:** possible similar demo constraints (low RAM, no durable volumes) and the same Google identity issue.

## Critical security constraint

Do **not** put `ahoj-audio-runtime` JSON private keys, `GEMINI_API_KEY`, OAuth client secrets, or Firebase admin credentials into the GitHub repo or Render environment as a shortcut.

Google Workload Identity Federation supports external workloads with an appropriate external identity provider. However, managed Render OIDC is listed as a **Pro workspace feature**, so the free Render host currently has no verified keyless path to the existing production Vertex/GCS service account. This means Render Free cannot yet replace the working Cloud Run REAL TTS backend safely.

The branch is an infrastructure PoC, **not** a claim that Vertex TTS or Google Drive sync work on Render.

## Render test (manual; no deployment has been created)

1. On Render connect the existing GitHub repository and select **this experiment branch**, not `main`.
2. Create/confirm a **Free** web service with `render.yaml` configuration; **automatic deploy disabled**.
3. Inspect logs; first test only unauthenticated `GET /api/health`, expecting `ok: true`.
4. Expect REAL Vertex TTS to report `NOT_CONNECTED`: this is intentionally blocked without ADC. Do not run REAL production audio on this free test service.
5. Do not import canonical datasets, run QA production sessions, or sync Drive from the temporary host. Its local filesystem is ephemeral.
6. Stop/delete the Render experiment after collecting uptime/build observations; retain the current Cloud Run service unchanged.

## Production migration gates

- [ ] Verified release commit and automated tests
- [ ] Owner authentication and no publicly accessible protected API routes
- [ ] Keyless, least-privilege workload authentication to Vertex/GCS **or** a reviewed alternative TTS/storage design
- [ ] Durable state and WAV storage with SHA-256 reconciliation
- [ ] QA PASS-only Drive sync
- [ ] PH001 REAL WAV end-to-end tested; identical source-lock
- [ ] Cost accounting for hosting, TTS, requests, storage and egress; rollback tested

## References (checked 2026-11-18)

- https://render.com/docs/free
- https://render.com/docs/blueprint-spec
- https://render.com/docs/deploy-node-express-app
- https://render.com/docs/platform-features-by-plan
- https://docs.cloud.google.com/iam/docs/workload-identity-federation
- https://cloud.google.com/run/pricing
- https://developers.cloudflare.com/workers/platform/limits/
