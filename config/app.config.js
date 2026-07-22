/**
 * polyglot — single source of truth for every non-secret configurable value (§0).
 *
 * Nothing in this object may be duplicated as a literal anywhere else in the repo.
 * Client code, the deck pipeline and the gamification engine all import from here.
 * The Worker reads the values it needs from `worker/wrangler.toml` + Wrangler secrets.
 *
 * @typedef {typeof config} AppConfig
 */

/** Deep-freeze a plain object tree so config can never be mutated at runtime. */
function deepFreeze(obj) {
  for (const value of Object.values(obj)) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) deepFreeze(value);
  }
  return Object.freeze(obj);
}

export const config = deepFreeze({
  // ── Identity ──────────────────────────────────────────────
  identity: {
    projectName: 'polyglot',
    githubUser: 'TurkiPro',
    repoUrl: 'https://github.com/TurkiPro/polyglot',
    license: 'AGPL-3.0',
    workerName: 'polyglot',
    d1DbName: 'polyglot-db',
    /** Replace <subdomain> with the account's workers.dev subdomain, or a custom domain. */
    prodUrl: 'https://polyglot.<subdomain>.workers.dev',
  },

  // ── Auth / API ────────────────────────────────────────────
  auth: {
    oauthProviders: ['github', 'google'],
    sessionTtlDays: 30,
    syncBatchMax: 500, // review events per request
    rateLimitAuth: { requests: 10, windowMinutes: 10, per: 'ip' },
    rateLimitApi: { requests: 120, windowMinutes: 60, per: 'user' },
    turnstile: {
      enabled: true, // login page only
      /** Public Turnstile site key — filled in by the operator (§13.4). Secret lives in Wrangler. */
      siteKey: '',
    },
  },

  // ── Language pack (v1 = zh) ───────────────────────────────
  pack: {
    langPackV1: 'zh',
    hskVersion: '3.0',
    deckSchemaVersion: 1,
    sentencesPerWord: 3,
    sentenceMaxChars: 30,
  },

  // ── Study engine ──────────────────────────────────────────
  study: {
    newCardsPerDay: 10,
    maxReviewsPerDay: 200,
    staggerUnlockDays: 3, // non-REC cards unlock when REC interval ≥ this
    fsrsTargetRetention: 0.9,
  },

  // ── Gamification ──────────────────────────────────────────
  gamify: {
    xpShowup: 20, // first review of the local day
    xpPerReview: 2,
    xpPerNewWord: 5,
    xpBandBadge: 500,
    streakMinReviews: 10, // reviews needed for a day to count
    /** Cumulative XP required to reach level n. */
    levelXpFormula: (n) => Math.ceil(100 * Math.pow(n, 1.5)),
    /** A band is clear when ≥95% of its REC cards have interval ≥ 21 days. */
    bandClear: { minRatio: 0.95, minIntervalDays: 21 },
  },

  // ── Tone colors (CSS variables --t1..--t5), one pair per theme ────
  // Hue identity is the semantics; the two shades differ only in lightness so each
  // clears 4.5:1 on its own ground. `light` is "paper", `dark` is "night ink".
  toneColors: {
    light: {
      t1: '#b3362b',
      t2: '#2d783c',
      t3: '#1a5fb4',
      t4: '#6a3d9a',
      t5: '#6b655c',
    },
    dark: {
      t1: '#ef5952',
      t2: '#58c26b',
      t3: '#64a8ff',
      t4: '#c792ea',
      t5: '#a29a8c',
    },
  },

  // ── Data sources (verify URLs before first pipeline run) ──
  sources: {
    cedictUrl: 'https://www.mdbg.net/chinese/export/cedict/cedict_1_0_ts_utf-8_mdbg.txt.gz',
    /**
     * Tatoeba exports, verified 2026-07-21 against
     * https://downloads.tatoeba.org/exports/ (last-modified 2026-07-18).
     * The per-language links file is the cmn↔eng subset of the full links export:
     * 477 KB instead of 148 MB, same pairs, no tar to unpack. Columns are
     * `<cmn sentence id>\t<eng sentence id>`; the sentence files are
     * `<id>\t<lang>\t<text>`.
     */
    tatoebaLinks: 'https://downloads.tatoeba.org/exports/per_language/cmn/cmn-eng_links.tsv.bz2',
    tatoebaSentencesCmn:
      'https://downloads.tatoeba.org/exports/per_language/cmn/cmn_sentences.tsv.bz2',
    tatoebaSentencesEng:
      'https://downloads.tatoeba.org/exports/per_language/eng/eng_sentences.tsv.bz2',
    hsk30Base:
      'https://raw.githubusercontent.com/krmanik/HSK-3.0/182692ce5a11bc30bdc771835d2f0f27491c25de/New%20HSK%20(2025)/HSK%20Words/',
    /** Band 7-9 collapses to band 7 per §5.1. */
    hsk30Files: [
      'HSK_Level_1_words.txt',
      'HSK_Level_2_words.txt',
      'HSK_Level_3_words.txt',
      'HSK_Level_4_words.txt',
      'HSK_Level_5_words.txt',
      'HSK_Level_6_words.txt',
      'HSK_Level_7-9_words.txt',
    ],
  },
});

export default config;
