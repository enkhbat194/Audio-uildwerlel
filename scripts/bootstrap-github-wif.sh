#!/usr/bin/env bash
# Ahoj Česko Audio Factory: keyless GitHub federation bootstrap.
# This script makes NO changes unless invoked explicitly with --apply.
# Creates a DEDICATED, NO-RESOURCE-ROLES service account for token-only testing.
set -euo pipefail

PROJECT_ID="project-a699c3ff-995a-4b88-add"
PROJECT_NUMBER="814331085807"
POOL_ID="ahoj-audio-gh"
PROVIDER_ID="preflight"
SA_NAME="ahoj-gh-preflight"
SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
REPOSITORY="enkhbat194/Audio-uildwerlel"
REPOSITORY_ID="1462100229"
OWNER_ID="34760209"
BRANCH="experiment/free-hosting-render-20261118"
WORKFLOW_REF="${REPOSITORY}/.github/workflows/github-wif-preflight.yml@refs/heads/${BRANCH}"
PROVIDER_RESOURCE="projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL_ID}/providers/${PROVIDER_ID}"
PRINCIPAL="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL_ID}/attribute.repository_id/${REPOSITORY_ID}"
CLAIM_MAP="google.subject=assertion.sub,attribute.repository_id=assertion.repository_id"
CONDITION="assertion.repository_id=='${REPOSITORY_ID}' && assertion.repository_owner_id=='${OWNER_ID}' && assertion.ref=='refs/heads/${BRANCH}' && assertion.workflow_ref=='${WORKFLOW_REF}'"

if [[ "${1:-}" != "--apply" ]]; then
  cat <<EOF
DRY RUN — no Google Cloud resources changed.
Project ID:       ${PROJECT_ID}
Project number:   ${PROJECT_NUMBER}
GitHub repository: ${REPOSITORY}
Allowed branch:   ${BRANCH}
Allowed workflow: ${WORKFLOW_REF}
Workload provider: ${PROVIDER_RESOURCE}
New service account (no Vertex/GCS roles): ${SA_EMAIL}

To provision the isolated *authentication-only* test identity:
  bash scripts/bootstrap-github-wif.sh --apply

Requires gcloud, IAM privileges, and explicit owner review.
No service account JSON keys or API keys are created.
EOF
  exit 0
fi

command -v gcloud >/dev/null || { echo "gcloud CLI is required" >&2; exit 1; }

# Confirm authenticated operator and project before any writes.
gcloud auth list --filter=status:ACTIVE --format="value(account)"
gcloud projects describe "${PROJECT_ID}" --format="value(projectNumber)" |
  grep -Fx "${PROJECT_NUMBER}" >/dev/null ||
  { echo "Wrong Google Cloud project; refusing changes" >&2; exit 1; }

if ! gcloud iam service-accounts describe "${SA_EMAIL}" --project="${PROJECT_ID}" >/dev/null 2>&1; then
  gcloud iam service-accounts create "${SA_NAME}" \
    --project="${PROJECT_ID}" \
    --display-name="Ahoj GitHub WIF Preflight (no resource roles)"
fi

if ! gcloud iam workload-identity-pools describe "${POOL_ID}" \
    --project="${PROJECT_ID}" --location=global >/dev/null 2>&1; then
  gcloud iam workload-identity-pools create "${POOL_ID}" \
    --project="${PROJECT_ID}" --location=global \
    --display-name="Ahoj Audio GitHub" \
    --description="Branch restricted GitHub Actions; identity only, no TTS"
fi

if ! gcloud iam workload-identity-pools providers describe "${PROVIDER_ID}" \
    --project="${PROJECT_ID}" --location=global \
    --workload-identity-pool="${POOL_ID}" >/dev/null 2>&1; then
  gcloud iam workload-identity-pools providers create-oidc "${PROVIDER_ID}" \
    --project="${PROJECT_ID}" \
    --location=global --workload-identity-pool="${POOL_ID}" \
    --issuer-uri="https://token.actions.githubusercontent.com/" \
    --attribute-mapping="${CLAIM_MAP}" \
    --attribute-condition="${CONDITION}" \
    --display-name="Ahoj GitHub preflight branch only"
else
  # Fail closed rather than silently reusing a provider that might be broader.
  current_condition="$(gcloud iam workload-identity-pools providers describe "${PROVIDER_ID}" \
    --project="${PROJECT_ID}" --location=global --workload-identity-pool="${POOL_ID}" \
    --format='value(attributeCondition)')"
  if [[ "${current_condition}" != "${CONDITION}" ]]; then
    echo "Existing provider has a different attribute condition. Refusing to broaden/update it." >&2
    exit 1
  fi
fi

gcloud iam service-accounts add-iam-policy-binding "${SA_EMAIL}" \
  --project="${PROJECT_ID}" \
  --role="roles/iam.workloadIdentityUser" \
  --member="${PRINCIPAL}" >/dev/null

cat <<EOF
WIF_BOOTSTRAP_OK — test identity created/verified.
Repo variable AHOJ_WIF_PROVIDER:
  ${PROVIDER_RESOURCE}
Repo variable AHOJ_WIF_SERVICE_ACCOUNT:
  ${SA_EMAIL}

The service account has NO Vertex AI, GCS, Firestore or project resource roles.
No TTS/Storage requests were made.
EOF
