#!/usr/bin/env bash
# One-time owner-authorized Google Cloud IAM setup for TWO sentence TTS tests.
# NO CHANGES on default invocation. Only --apply creates the dedicated service
# account and grants Vertex AI User; no GCS permissions, keys, or TTS requests.
set -euo pipefail

PROJECT="project-a699c3ff-995a-4b88-add"
PROJECT_NUMBER="814331085807"
SA_ID="ahoj-gh-voiceqa"
SA_EMAIL="${SA_ID}@${PROJECT}.iam.gserviceaccount.com"
POOL_ID="ahoj-audio-gh"
PROVIDER_ID="preflight"
REPO_ID="1462100229"
OWNER_ID="34760209"
BRANCH="experiment/free-hosting-render-20261118"
WF="enkhbat194/Audio-uildwerlel/.github/workflows/github-wif-preflight.yml@refs/heads/${BRANCH}"
COND="assertion.repository_id=='${REPO_ID}' && assertion.repository_owner_id=='${OWNER_ID}' && assertion.ref=='refs/heads/${BRANCH}' && assertion.workflow_ref=='${WF}'"
IDENTITY="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL_ID}/attribute.repository_id/${REPO_ID}"

if [[ "${1:-}" != "--apply" ]]; then
  echo "DRY_RUN_OK — No Google Cloud changes made."
  echo "Dedicated service account: ${SA_EMAIL}"
  echo "Only project role to grant: roles/aiplatform.user (Vertex AI User)"
  echo "Existing WIF provider: ${POOL_ID}/${PROVIDER_ID}, exact protected branch/workflow"
  echo "No GCS, Firestore, Service Account keys, Cloud Run, or billable TTS."
  echo "To explicitly provision: bash scripts/setup-voice-qa-identity.sh --apply"
  exit 0
fi

command -v gcloud >/dev/null || { echo "gcloud missing" >&2; exit 1; }
gcloud projects describe "${PROJECT}" --format='value(projectNumber)' |
  grep -Fx "${PROJECT_NUMBER}" >/dev/null || { echo "Wrong project — abort" >&2; exit 1; }
CURRENT="$(gcloud iam workload-identity-pools providers describe "${PROVIDER_ID}" \
  --workload-identity-pool="${POOL_ID}" --location=global --project="${PROJECT}" \
  --format='value(attributeCondition)')"
if [[ "${CURRENT}" != "${COND}" ]]; then
  echo "WIF provider restriction changed; refusing IAM grants" >&2
  exit 1
fi

if ! gcloud iam service-accounts describe "${SA_EMAIL}" --project="${PROJECT}" >/dev/null 2>&1; then
  gcloud iam service-accounts create "${SA_ID}" --project="${PROJECT}" \
    --display-name="Ahoj Voice QA (GitHub only)"
fi

gcloud iam service-accounts add-iam-policy-binding "${SA_EMAIL}" \
  --project="${PROJECT}" --role="roles/iam.workloadIdentityUser" \
  --member="${IDENTITY}" >/dev/null

# This role is scoped to the Google Cloud project and this dedicated identity.
# It does not grant Cloud Storage, Drive, Firestore, or IAM admin rights.
gcloud projects add-iam-policy-binding "${PROJECT}" \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/aiplatform.user" >/dev/null

echo "VOICE_QA_IAM_READY: ${SA_EMAIL}"
echo "No WAV was generated. No files were written to Google Cloud Storage."
