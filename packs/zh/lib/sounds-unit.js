/**
 * Unit 0 — "The Sounds" (Phase 10 B): onboarding, reborn as ordinary course content.
 *
 * The old `#welcome` flow died for being forced, half-baked, and awkward. The cure is not a
 * better modal but making onboarding the course's first unit — same syllabus, same runner, same
 * one-tap skip as any other unit. Its steps are abstract kinds the client renders (the existing
 * tone drills and pinyin crash intro); it holds no deck words, so it teaches phonology before a
 * single vocabulary card, and skipping it is exactly as free as skipping anything else.
 *
 * Prepended to `course.zh.json` by the pipeline, so it is generated data — the client only has
 * to know how to run TONES / PINYIN steps and a wordless checkpoint. Shared by build.mjs and
 * scripts/regen-course.mjs so the committed course and a fresh build agree byte for byte.
 */
export const SOUNDS_UNIT = Object.freeze({
  id: 'u000',
  title: 'The Sounds',
  band: 0,
  sounds: true,
  wordIds: [],
  steps: [
    { kind: 'TONES', set: 'intro' },   // the mā má mǎ mà · ma archetype, tap to hear
    { kind: 'TONES', set: 'singles' }, // "which tone did you hear?" — single syllables
    { kind: 'TONES', set: 'pairs' },   // the same, tone pairs (2/3 emphasis)
    { kind: 'PINYIN' },                // the crash intro to the unintuitive letters
    { kind: 'CHECKPOINT' },            // a wordless mini-checkpoint over the tones
  ],
});
