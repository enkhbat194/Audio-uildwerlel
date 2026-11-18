# AHOJ ČESKO — GitHub → Google Workload Identity Federation handoff
Date: 2026-11-18. Scope: `experiment/free-hosting-render-20261118` ONLY.

## Current state (not a claim of live TTS on Render)

- Render Free preview: read-only; no Vertex AI, Firestore or Google Drive client imports; backend write operations are blocked.
- Working original PH001 WAV remains in the prior Google Cloud workflow and private GCS; do not remove or replace it.
- Main branch and canonical Czech source lock are protected by workflow discipline (we are not modifying them).
- **WIF in Google Cloud has NOT been provisioned**, and no GitHub Actions token has been confirmed.
- The new `.github/workflows/github-wif-preflight.yml` requests *only* a short-lived OAuth access token after two repository variables are present. It never calls Vertex TTS or GCS APIs.

## Security architecture

Use a dedicated `ahoj-gh-preflight` service account **with no resource roles**, separate from the Cloud Run `ahoj-audio-runtime` service account.

Restrict the OIDC provider to the exact repository numeric ID `1462100229`, owner ID `34760209`, experiment branch, and `.github/workflows/github-wif-preflight.yml` via `assertion.workflow_ref`. Do not grant the GitHub workflow the existing runtime account's GCS Object Admin/Datastore powers.

- Pool: `ahoj-audio-gh` (new, not yet created)
- Provider: `preflight` (new, not yet created)
- Project ID: `project-a699c3ff-995a-4b88-add`
- Project number: `814331085807`
- Principal: only identity federation, `roles/iam.workloadIdentityUser` on a new, dedicated account
- No keys, no user secrets, no new billable TTS operations.

## Owner approval / activation — intentionally not executed

The script below has NO effect unless `--apply` is explicitly passed. It is safe to inspect:

```bash
bash scripts/bootstrap-github-wif.sh
```

After reviewing the script and logging in to Google Cloud Shell with the *correct* project and IAM privileges, the owner can authorize this separate identity bootstrap:

```bash
bash scripts/bootstrap-github-wif.sh --apply
```

This will create the separate service account, pool, provider, and only the service-account impersonation binding. It does not grant resource roles or call Vertex AI.

If `roles/iam.workloadIdentityPoolAdmin`, `roles/iam.serviceAccountAdmin`, or other requisite IAM privileges are missing, the script will report an error. Do not weaken permissions or make JSON keys to bypass it.

## GitHub repo configuration (no account credentials)

Go to **GitHub → enkhbat194/Audio-uildwerlel → Settings → Secrets and variables → Actions → Variables → New repository variable**.

Add these two **non-secret resource identifiers** *only after Google Cloud bootstrap succeeds*:

```text
AHOJ_WIF_PROVIDER=projects/814331085807/locations/global/workloadIdentityPools/ahoj-audio-gh/providers/preflight
AHOJ_WIF_SERVICE_ACCOUNT=ahoj-gh-preflight@project-a699c3ff-995a-4b88-add.iam.gserviceaccount.com
```

The new token workflow runs on a matching push to the experiment branch or a manual workflow dispatch. Note: GitHub's Actions UI may only show a manually dispatchable workflow if that workflow also exists on the repository's default branch. We deliberately **do not** change `main`; pushing a reviewed change to this experiment branch can trigger the safe preflight instead.

Read outcomes accurately:
- `WIF_NOT_CONFIGURED`: GitHub variables missing; the token job is skipped.
- `WIF_TOKEN_OK`: Google accepted the GitHub OIDC identity and minted a temporary token. This **does not** prove Vertex/GCS permissions or TTS quality.
- Auth/permission error: review exact provider attribute mapping, condition, IAM role, and required Google APIs. Do not disable safeguards as a shortcut.

## Next phase — *only after WIF_TOKEN_OK*

1. Create a separate least-privilege, production **audio-worker** identity with a dedicated WIF workflow restricted to exactly the production job; do not reuse the preflight identity for billable generation.
2. Verify bucket write access with a single throwaway object *in a non-canonical test prefix*, then delete it. Ensure retention/soft-delete implications are understood.
3. Design an explicit manual, auditable request (one `PH001` variant per run), approval gate and cost cap. Do not use every push or a scheduled trigger for billable TTS.
4. Verify actual model and style, persist WAV + SHA-256 + duration + receipt to versioned GCS object. Do not overwrite existing PH001.
5. Gate Drive sync by exact job hash, source lock, QA PASS and source release rules. Don't use Render Free's ephemeral filesystem as durable storage.

**GitHub Actions is a job runner, not a continuously running backend API.** A Render button cannot safely invoke arbitrary GitHub workflows without separate owner-authenticated request infrastructure. A personal access token in client-side JavaScript or Render Free is not an acceptable shortcut.

## References

- Google Cloud IAM: https://docs.cloud.google.com/iam/docs/workload-identity-federation-with-deployment-pipelines
- Google GitHub Action: https://github.com/google-github-actions/auth
- GitHub OIDC: https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-google-cloud-platform
