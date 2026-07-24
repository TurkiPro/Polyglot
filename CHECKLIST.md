# Manual checklist — Phase 3 (PWA UI)

`npm test` now covers the review loop, the card fronts and backs, tone colouring and the
split-word rules under jsdom. These are the checks that still need real eyes, a real
device and a real network tab — mostly install, audio, touch and the service worker.

Run `npm run dev` and open the URL Wrangler prints.

> **Testing from a phone on your LAN?** `http://<lan-ip>:8787` is a *non-secure context*.
> Service workers are unavailable there, so install and the offline checks below cannot
> pass over plain HTTP — use `localhost` on the dev machine, or serve over HTTPS. The app
> itself works either way.

## Install and offline

- [ ] The app is installable (Chrome: address-bar install icon; iOS Safari: Share → Add to
      Home Screen). It opens standalone, with the 语 icon.
- [ ] After one normal load, put the browser in offline mode (DevTools → Network →
      Offline) and reload. The shell and a full review session still work.
- [ ] In DevTools → Application → Cache Storage, the shell cache holds the app files and
      `deck.zh.json`, and **not** `dict.zh.json` or the stroke files. Those appear in the
      runtime cache only after visiting Browse / doing a WRITE card.

## The five modes

Structure for REC, PROD and SENT is asserted in `tests/views.test.js`; these confirm they
look and feel right on a real screen.

- [ ] **REC** — the hanzi is comfortably large on a phone (clamp 48-96px).
- [ ] **LIS** — audio plays on its own, nothing else visible; back shows the sentence,
      pinyin, translation and definitions. (Needs a real speech engine.)
- [ ] **PROD** — the input focuses without the mobile keyboard covering the card, and
      typing does not fire the 1-4 shortcuts.
- [ ] **SENT** — the highlighted word is legible against the rest of the sentence.
- [ ] **WRITE** — a drawing canvas per character; the outline shows for the first
      character only. It works with a finger on a touch screen. (Needs real pointer
      events; hanzi-writer is mocked in tests.)

## Interaction

- [ ] Tapping the card flips it (the space/1-4 path is covered by tests).
- [ ] Grading advances to the next card and the "N left" counter falls.
- [ ] A new card is not the very first thing in a session with reviews due.

## Language display

- [ ] Tone colours are actually distinguishable on your screen (the classes and hexes are
      asserted in tests; this is about contrast, including in light theme).
- [ ] With no Chinese voice installed, the dismissible banner appears once and listening
      cards fall back to showing text. Dismissing it sticks across reloads.

## Browse

- [ ] First visit shows the one-time dictionary import with progress.
- [ ] 咖啡 is found by `kafei`, by `coffee`, and by 咖啡.
- [ ] "Add to my words" turns into "Added · up next →"; following it lands on My Words.
- [ ] The added word is listed in My Words, and is the **next new card** in a session —
      ahead of curriculum order.
- [ ] Removing it from My Words asks for confirmation, then it never appears in a session
      again. Stats totals do not drop: the review history is kept.

## Settings and data

- [ ] The new/day and max/day sliders change how many cards the next session offers.
- [ ] The light theme applies immediately and survives a reload.
- [ ] **Export → wipe → import restores identical state.** Export the JSON, note the
      `stateHash` field, use the Danger Zone (typing DELETE) to wipe, then import the
      file. The `stateHash` in a fresh export must match the noted value.
- [ ] Danger Zone stays disabled until DELETE is typed exactly.

## Privacy (§1.2, §14)

- [ ] With the Network tab open, use every screen: **no request leaves the origin**. No
      analytics, no fonts, no CDN, no stroke data from a third party.

## Design overhaul (§3.2) — maintainer sign-off

Run on a real phone and a desktop browser, in both themes.

- [ ] **Desktop review**: the sheet is centred with visible breathing room — nothing
      floats in a void. The grade bar is the sheet's own footer.
- [ ] **LIS front** shows the 田字格 with a speaker where the character would be, and
      reads as intentional rather than broken. Tapping the square replays.
- [ ] Every card names its mode in the eyebrow; progress reads "n of m".
- [ ] Hanzi renders in the serif face on cards, Browse and Words. Search a rare
      dictionary-only character and confirm it falls back gracefully rather than tofu.
- [ ] Paper is the default on first run; night ink via the toggle. Tone colours are
      legible in both (the numeric check is committed in `tests/contrast.test.js`).
- [ ] Seal red appears **only** on: the app mark, the primary CTA, the active tab, the
      done stamp, and added checks. Anywhere else is a defect.
- [ ] The reveal stamp-in and the LIS pulse each play once — and not at all with OS
      "reduce motion" enabled.
- [ ] Phone: bottom tab bar present, grades in the thumb zone, sheet edge-to-edge.

## Fix pack (§3.3) — maintainer sign-off

- [ ] On a listening card, "Play again" replays and does **not** reveal the answer. Same
      for the audio button on any card back.
- [ ] Typing the right pinyin on a listening card preselects Good; a wrong one preselects
      Again and the back shows what you typed. Leaving it empty still reveals, self-graded.
- [ ] The reveal is one flip: the card turns, the sheet grows smoothly rather than
      snapping, and the grade buttons arrive after it lands — not mid-turn.
- [ ] With OS "reduce motion" on, the reveal is instant: no rotation, no height animation.
- [ ] No input shows a red focus ring. Tab through search, the answer field and the
      Danger Zone field: every ring is ink.
- [ ] Search 海 — the row shows "ocean; sea" with no `CL:` text; its word page shows
      "Measure word — 个 · 片".
- [ ] A browse row for an HSK word reads "HSK · band N"; one you added reads "In My Words"
      with the seal check.
- [ ] My Words, Browse before searching, Stats with no reviews, and the finished session
      are all centred compositions with a motif, one line, and one action — not a caption.
- [ ] Primary buttons look pressed: gradient, inner highlight, and they depress on tap.

## Gamification (§10) — maintainer sign-off

- [ ] Home shows streak and level tiles once you have reviewed something.
- [ ] `#stats` shows the level with progress to the next, a 12-week heatmap whose cells
      darken with the day's volume, per-band bars, badges, and an XP breakdown whose rows
      add up to the total.
- [ ] Hovering a heatmap cell names the date and the count.
- [ ] Do 10 reviews in a day and the streak tile reads 1; check tomorrow that it still
      reads 1 before you review, and 2 after another 10.
- [ ] Export, wipe, re-import: XP, level and streak come back identical — they are
      derived, not stored.

## Worker API (§11) — automated

These run themselves; listed so the sequence is on record.

```sh
npm run db:local      # apply worker/schema.sql to the local D1
npm run dev           # in one terminal
npm run api-test      # in another
```

- [x] `worker/schema.sql` applies cleanly twice (idempotent).
- [x] `scripts/api-tests.sh` fully green, and re-runnable.
- [x] With `DEV_MODE` unset, `POST /api/auth/dev` is 404.
- [x] `/` carries CSP, `X-Content-Type-Options` and `Referrer-Policy`.
- [ ] Human: register the OAuth apps (§13.3) and a Turnstile widget (§13.4), then sign in
      with GitHub and with Google against a deployed origin — the callback URLs cannot be
      exercised locally.

## Sync and deploy (§12) — maintainer sign-off

Automated: `npm test` covers the client's orchestration, two devices converging on one
state hash, and guest → account migration. `scripts/api-tests.sh` covers the server.
These need a real deployment:

- [ ] Register the OAuth apps and a Turnstile widget (SELF_HOSTING steps 4-5), deploy,
      then sign in with GitHub and with Google. The callback URLs cannot be tested locally.
- [ ] **Two profiles**: sign in on browser profile A and B as the same account. Review on
      A, press Sync now on A, then on B. B shows A's progress; Stats totals match.
- [ ] Guest migration: study as a guest, then sign in. Everything you did offline appears
      on the second device after a sync.
- [ ] Sign out leaves local progress untouched, and the app still works.
- [ ] Delete account: the server copy and this device are both erased, and signing in
      again starts clean.
- [ ] With Turnstile configured, the Network tab shows `challenges.cloudflare.com` **only**
      after pressing a sign-in button — never while reviewing, browsing or offline.
- [ ] Push to main and watch the deploy workflow run tests before deploying.

## Usability pack (§3.4) — maintainer sign-off

- [ ] Browse a curriculum word (咖啡): it offers **Study next**, and after pressing it the
      word is the first new card in the next session.
- [ ] Every card back plays audio — recognition, typing, sentence and writing alike.
- [ ] The 🐢 button is audibly slower than the normal one; long-pressing the normal button
      does the same on a phone.
- [ ] Tapping 好 on a recognition card **speaks it** and does not reveal the answer.
      Revealing is Show answer or Space only.
- [ ] Settings lists your device's Chinese voices with a preview. Pick one, restart the
      app, and it is still selected. On Windows, compare Edge's neural voices against the
      default — the tip should be true.
- [ ] A recognition back shows an example sentence with coloured pinyin and its English.
- [ ] On a day-one account, **Practice writing** is reachable from any word page and draws
      the stroke quiz. Nothing is graded and no review appears in Stats.
- [ ] Home shows the locked-modes line while modes are still locked, and stops once they
      are not.
- [ ] Browse with nothing typed shows the HSK bands; opening one lists its words.
- [ ] You found Practice writing without being told where it was.

