# AHOJ ČESKO — Audio Factory Educational & Pronunciation QA Contract (draft v0.1)

**Scope**: Audio Factory source verification, pronunciation assets, listening QA, and release gating.
**Status**: engineering policy draft for the experiment branch; **NOT** an amendment to the approved Curriculum, the canonical CSV/JSON, or the main branch.
**Reference standards**: Council of Europe *CEFR Companion Volume (2020)*, phonological control (overall phonological control, sound articulation, prosodic features) and listening/interaction progression.
**Project-specific standards**: Ahoj Česko Curriculum v1.2; S1.04 v0.3 (16-stage lesson workflow); S2.02 v0.3 (pronunciation / chunk-to-sentence learning). Retrieve and align with complete source documents prior to calling this an officially approved standard.

## The key distinction

CEFR is a **language proficiency and assessment framework**, not a specification for WAV bitrate, speech-generation model, exact playback speed, or whether a synthesized recording is a native reference. A0 is the project's local teaching label; **Pre-A1** is the official CEFR descriptor level below A1. CEFR alignment must be evidenced by learning tasks and intelligibility, not only a voice selection or a model name.

## Content authority and instructional progression

- The Curriculum branch owns the canonical texts, lesson IDs, variant grammar, Czech corrections, educational level and release decisions. Audio Factory **must never silently change** `cs_exact`, locked source IDs, source hashes, or canonical v0.9.20.
- One full utterance / one audio asset by default, plus optional derived training assets with a declared parent source ID.
- Align audio to the project's staged practice: listening → sound articulation → syllable/chunk → word → phrase → full sentence → dialogue turn → free-response/transfer. Derived units must retain their provenance. A whole-sentence waveform is not a substitute for phoneme- and chunk-level instruction.
- Treat dialogue as conversational turns; roles, natural pauses and politeness must match the linguistic situation and curriculum.
- The approved progression is **not** proof that a source draft is publication ready. Any `BLOCK_DOMAIN`, `publish_allowed=false`, or unresolved editorial hold prevents student-facing release.

## Two distinct voice assets

1. **Natural reference**: intelligible, idiomatic Czech with natural prosody, vowel length, first-syllable word stress as appropriate, context-appropriate interrogative contour; realistic word linking and rhythm.
2. **Learning Slow**: same *exact* Czech utterance, clearer and somewhat slower while preserving contrastive vowel length, consonants, word boundaries, stress, intonation and normal connected speech. Slow must never mean robotic breaks, altered vocabulary or false syllable boundaries.

Do not claim a fixed speed ratio or duration is an official CEFR requirement. Speech duration alone cannot prove naturalness or correctness. A language-proficient reviewer must compare both versions.

## Quality gates, in order

| Gate | Required evidence | Pass rule |
|---|---|---|
| G0 Source authority | exact `cs_exact`, ID, curriculum version, SHA-256, current source gate | matches authoritative, publishable source |
| G1 Technical WAV | PCM16 WAV header, sample rate/channels, nonempty duration, SHA-256, file path, no clipping/truncation/silence | reproducible, parsable and correct fingerprint; 24 kHz mono is a **project codec choice**, not a CEFR mandate |
| G2 Czech intelligibility | reviewer listens for omitted/inserted words, `ř/r`, `č/š/ž`, long vs short vowels, clusters, syllabic r/l, natural Czech stress | language-proficient review, not automatic transcript equality alone |
| G3 Prosody and teaching suitability | rhythm, focus/intonation, appropriate register, normal vs learning-slow comparison | clear and natural in context; slow retains intended articulation and meaning |
| G4 Curriculum alignment | appropriate lesson stage and dialogue role, linked derived chunks, exercise/response tasks | match lesson standard; not only a single isolated listening clip |
| G5 Publication & sync | distinct reviewer, immutable audio SHA, QA PASS, release approval, relevant hold flags | only explicitly authorized, non-stale WAVs move to app-audio Drive manifest |

All unresolved items remain **REVIEW** (or FAIL), not PASS. A `QA PASS` on a draft/reference QA sample never automatically overrides `publish_allowed=false`. Do not treat automated ASR / TTS transcript similarity as phonetic scoring, accent quality, or pedagogic certification.

## Current two full-sentence outputs (2026-11-19)

- QA-only source: `Můžete mi prosím říct, kde je nejbližší autobusová zastávka a jak se tam dostanu?`
- Natural: 7000 ms, SHA-256 `6da66f99ee8b9296f88f49b965fc4a7b77d6520ec2b78e2b0c28fedf76d6943f`
- Learning Slow: 8120 ms, SHA-256 `fdd5de05eea7f40ea5b20dbccd35817b74f9537f50511da58edfa137dde07181`
- Both assets are **QA-only / REVIEW**, not canonical course audio. There is no documented native-level human listening QA yet. Duration comparison does not certify good pronunciation.

## Source references

- CEFR Companion Volume (2020): https://rm.coe.int/cefr-companion-volume-with-new-descriptors-2020/16809ea0d4
- Council of Europe: https://www.coe.int/en/web/common-european-framework-reference-languages/phonological-competence
- Council of Europe: https://www.coe.int/en/web/common-european-framework-reference-languages/phonology-in-the-classroom

**Implementation note**: This file is a draft QA contract. Integrating full checks into production requires reading the exact v1.2/S1.04/S2.02 approved files and testing against existing content, without rewriting them.
