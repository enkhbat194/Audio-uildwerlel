# Security Specification — Ahoj Česko Audio Factory Firestore Rules

## 1. Data Invariants
- Only the verified owner account (`zazadada8899@gmail.com` with `email_verified == true`) may read or write any collection.
- `real_jobs` and `mock_jobs` are strictly separated collections; `real_jobs` requires `is_mock == false` and `provider == 'vertex-ai'`; `mock_jobs` requires `is_mock == true` and `provider == 'local-mock-synth'`.
- `sources` cannot be written with `publish_allowed == true` for `BLOCK_DOMAIN` rows; `qa_records` always preserves `publication_gate == 'BLOCKED_FOR_RELEASE'` for internal pilot rows.
- Every document enforces `ownerUid == request.auth.uid`, valid ID length (`<= 128` chars matching `^[a-zA-Z0-9_\-]+$`), and strict string size bounds.

## 2. Adversarial Payloads (Red Team Verification)
1. Unauthenticated read on `/sources/CZ-A0-M01-L01-PH001` -> DENIED.
2. Authenticated non-owner (`other@gmail.com`) read/write on `/real_jobs/CZ-A0-M01-L01-PH001` -> DENIED.
3. Unverified owner email (`email_verified == false`) write -> DENIED.
4. Cross-contamination: write `is_mock: true` into `/real_jobs/...` -> DENIED.
5. Cross-contamination: write `is_mock: false` into `/mock_jobs/...` -> DENIED.
6. Oversized document ID (`> 128` chars) -> DENIED.
7. Oversized `notes` (`> 2000` chars) -> DENIED.
8. Missing `ownerUid` or mismatched `ownerUid != request.auth.uid` -> DENIED.
9. Shadow field injection (`isAdmin: true`) on `/qa_records/...` -> DENIED by `hasOnly`.
10. Setting `publish_allowed: true` on `BLOCK_DOMAIN` source -> DENIED.
11. Blanket `list` without `resource.data.ownerUid == request.auth.uid` -> DENIED.
12. `ownerUid` mutation during `update` -> DENIED.
