#!/usr/bin/env bash
# Private 20-phrase Chirp comparison only. No mutations without --apply.
# Isolated Google WIF pool: avoids broadening the existing preflight identity.
set -euo pipefail
PROJECT="project-a699c3ff-995a-4b88-add"
NUMBER="814331085807"
POOL="ahoj-chirp-ab20"
PROVIDER="only-github-ab20"
ACCOUNT="ahoj-chirp20"
EMAIL="$ACCOUNT@$PROJECT.iam.gserviceaccount.com"
REPO_ID="1462100229"
OWNER_ID="34760209"
BRANCH="experiment/free-hosting-render-20261118"
WORKFLOW="enkhbat194/Audio-uildwerlel/.github/workflows/chirp3hd-czech-ab20.yml@refs/heads/$BRANCH"
RESOURCE="projects/$NUMBER/locations/global/workloadIdentityPools/$POOL/providers/$PROVIDER"
PRINCIPAL="principalSet://iam.googleapis.com/projects/$NUMBER/locations/global/workloadIdentityPools/$POOL/attribute.repository_id/$REPO_ID"
CONDITION="assertion.repository_id=='$REPO_ID' && assertion.repository_owner_id=='$OWNER_ID' && assertion.ref=='refs/heads/$BRANCH' && assertion.workflow_ref=='$WORKFLOW'"
echo "Private Czech Chirp 20 A/B identity: $RESOURCE"
echo "Workflow restricted to: $WORKFLOW"
echo "Service account: $EMAIL"
echo "No service account keys. No publish, no TTS in setup."
if [[ $# -eq 0 || "$1" != "--apply" ]]; then
  echo "DRY_RUN: no Google Cloud changes. Run with --apply only after checking this exact script."
  exit 0
fi
command -v gcloud >/dev/null || { echo "Google Cloud Shell/gcloud required" >&2; exit 1; }
actual="$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')"
test "$actual" = "$NUMBER" || { echo "Wrong project number" >&2; exit 1; }
gcloud config set project "$PROJECT" >/dev/null
gcloud services enable texttospeech.googleapis.com --project="$PROJECT"
if ! gcloud iam service-accounts describe "$EMAIL" --project="$PROJECT" >/dev/null 2>&1; then
  gcloud iam service-accounts create "$ACCOUNT" --project="$PROJECT" \
    --display-name="Ahoj isolated Chirp3HD 20-sentence QA runner"
fi
if ! gcloud iam workload-identity-pools describe "$POOL" \
   --project="$PROJECT" --location=global >/dev/null 2>&1; then
  gcloud iam workload-identity-pools create "$POOL" --project="$PROJECT" \
    --location=global --display-name="Ahoj one-shot Chirp twenty"
fi
if ! gcloud iam workload-identity-pools providers describe "$PROVIDER" \
    --project="$PROJECT" --location=global --workload-identity-pool="$POOL" >/dev/null 2>&1; then
  gcloud iam workload-identity-pools providers create-oidc "$PROVIDER" \
    --project="$PROJECT" --location=global --workload-identity-pool="$POOL" \
    --issuer-uri="https://token.actions.githubusercontent.com/" \
    --attribute-mapping="google.subject=assertion.sub,attribute.repository_id=assertion.repository_id" \
    --attribute-condition="$CONDITION"
else
  current="$(gcloud iam workload-identity-pools providers describe "$PROVIDER" \
    --project="$PROJECT" --location=global --workload-identity-pool="$POOL" \
    --format='value(attributeCondition)')"
  test "$current" = "$CONDITION" || { echo "Existing condition differs; refusing to broaden" >&2; exit 1; }
fi
gcloud iam service-accounts add-iam-policy-binding "$EMAIL" \
  --project="$PROJECT" --member="$PRINCIPAL" \
  --role="roles/iam.workloadIdentityUser" >/dev/null
# A minimal project billing/quota-consumption role for Text-to-Speech;
# do not grant Editor, Owner, Vertex user or storage admin roles.
gcloud projects add-iam-policy-binding "$PROJECT" \
  --member="serviceAccount:$EMAIL" \
  --role="roles/serviceusage.serviceUsageConsumer" >/dev/null
echo "AB20_WIF_READY: no audio generated. Trigger the exact capped private comparison workflow."
