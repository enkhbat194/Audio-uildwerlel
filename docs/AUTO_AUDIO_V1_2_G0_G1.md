# AUTO AUDIO v1.2 — G0/G1 PRIVATE RECOVERY

Status: RECOVERY TOOL PREPARED. Actual History download, MP3 archive, Drive OAuth archiving and QA are NOT completed. Does not trigger TTS generation, R2 publishing or Ahoj app publication.

## Current verified situation (2026-11-23)
- Six connected ElevenLabs Flow groups: 252 nodes, **246 completed + 6 historical failed**. They report speech generation, not downloadable MP3 validation.
- Existing private Google Drive manifests: 246 unique source IDs, 124 Hana and 122 Jan, no duplicate exact text+voice+model and no duplicate expected filename. Private manifest lists 0 MP3 assets saved to Drive.
- Old AHOJ_HANA_JAN_EXPORT_TOOL_20261121.zip is preserved on private Drive.
- The public Audio-uildwerlel repository currently uses Firebase/Express/Vertex, not yet Cloudflare Workers/D1/Queues/ElevenLabs History. AUTO AUDIO v1.2 defines target architecture, NOT deployed state.
- ElevenLabs connected tools support Flow inspection but not History listing / audio download. Real API History access requires a narrowly scoped History Read API key in a private runner.

## G1 script and safety gates
Entry: tools/g1/recover_elevenlabs_history.py.
- Reads PRIVATE manifest path; does not commit the manifest in this public repository.
- Requires ELEVENLABS_API_KEY environment variable with History Read permission. NEVER put it in source, chat, browser or Drive plaintext.
- Uses ONLY GET /v1/history and GET /v1/history/{history_item_id}/audio. NO POST to /text-to-speech and NO audio generation credits.
- Default mode only lists and matches History; '--download' is an explicit separate choice.
- Strict NFC Czech exact text + voice_id + model_id + Flow-origin match. Holds ambiguous duplicates; never guesses newest.
- Cursor pagination with incomplete-scanning state. Safe file paths, no duplicate IDs, SHA256, no overwrite of unverified files.
- Media signature checked; optional duration_ms via ffprobe. Audio's Czech phonetics and meaning are still pending validation.
- Receipt records drive_file_id=null and published=false. Local files are NOT Drive archive or app publication.

## G1 use (inside a private authorized runtime)
1. Run offline test suite: python -m unittest discover -s tests -p 'test_recover_elevenlabs_history.py'
2. Download the private completed manifest from Drive into the runtime, OUTSIDE the public repository.
3. Set ELEVENLABS_API_KEY in private runtime secrets.
4. History comparison only:
   python tools/g1/recover_elevenlabs_history.py --manifest /private/AHOJ_HANA_JAN_246_COMPLETED_PRIVATE_QA_MANIFEST_20261121.json
5. Inspect private_recovery/HISTORY_MATCH_REPORT.json. If History does not contain the Flow items, record BLOCKED and DO NOT REGENERATE.
6. For one matched item, run with --download --max-files 1. Check actual MP3, SHA256, duration, matching source ID.
7. Download remaining matched entries; the exporter resumes and never overwrites unmatched prior files.
8. Implement PRIVATE Google Drive OAuth upload + readback verification separately. G1 is NOT done until real Drive File IDs and checksums are recorded.

## Implementation boundaries
This branch contains GENERIC recovery code, tests and documentation only. NO Czech source manifest, audio files, signed URLs or credentials can enter public GitHub.
G0/G1 code can run before Cloudflare migration. In future PRIVATE PRODUCTION: Cloudflare Workers + D1 + Queues + ElevenLabs + Drive API; public R2/CDN delivery remains disabled until explicit user approval.
Official references:
https://elevenlabs.io/docs/api-reference/history/list
https://elevenlabs.io/docs/api-reference/history/get-audio
https://elevenlabs.io/docs/api-reference/history/download
