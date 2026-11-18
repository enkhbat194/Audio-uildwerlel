# Ahoj Česko Audio Factory — Render Free experiment

> **Experimental, read-only hosting proof. Not production audio manufacturing.**
> Existing Cloud Run `ahoj-cesko-audio-factory`, GitHub `main`, the canonical Czech source data and curriculum are not modified by this experiment.

[Deploy the isolated experiment on Render](https://render.com/deploy?repo=https%3A%2F%2Fgithub.com%2Fenkhbat194%2FAudio-uildwerlel%2Ftree%2Fexperiment%2Ffree-hosting-render-20261118)

## Prepared and verified

- Branch: `experiment/free-hosting-render-20261118`
- Source: React + Vite + Express / Bun
- `render.yaml`: Render Free, Singapore, manual deploy only; `NODE_ENV=production`, `FREE_HOSTING_POC=true`
- GitHub Actions: TypeScript, automated tests, production build, HTTP health and auth smoke tests
- The experiment refuses ALL write methods for `/api/*` with HTTP 403 `FREE_HOSTING_READ_ONLY`, including billable Vertex TTS calls and Drive/Firestore writes. A protected read of `/api/state` without authentication still returns HTTP 401.

## One-time launch

1. Open **Deploy the isolated experiment on Render** above and sign in to Render. Confirm repository `enkhbat194/Audio-uildwerlel` and branch `experiment/free-hosting-render-20261118`. Do **not** select `main`.
2. Confirm **Free** compute plan, **Singapore** region, `autoDeployTrigger: off`, and `FREE_HOSTING_POC=true`. Start a manual deployment. A Render account connection is needed; GitHub alone cannot create the service.
3. Once Render reports **Live**, open the service's real **onrender.com** URL followed by `/api/health`. Expect a JSON object with `ok:true`, `auth_required:true`.
4. The app UI can display the owner's Google sign-in; Firebase Auth may require adding the new Render domain as an Authorized Domain. This is **not** done automatically and is not necessary for the health smoke test.
5. `POST /api/tts/generate` is intentionally blocked (403), regardless of the presence of Google credentials. The experiment must never be used to produce or export paid audio.

## What remains for a real no-Cloud-Run migration

1. Keyless identity to Vertex AI + existing private GCS, OR choose an independently authenticated alternative TTS and durable storage.
2. Persistent backend state. The current JSON store and local files would disappear on Render Free restarts/redeploys.
3. Proper owner login on Render domain, tenant isolation, and server-side QA PASS-only export policy.
4. Production-equivalent end-to-end WAV test before changing the current Cloud Run service.

**Never** upload Service Account JSON key, `GEMINI_API_KEY`, OAuth client secrets, or private audio to the public GitHub repo or this free test service.

Useful docs: https://render.com/docs/deploy-to-render, https://render.com/docs/free, https://render.com/docs/blueprint-spec.
