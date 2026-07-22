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

## Design system v2 (§C) — maintainer sign-off

Run on a real phone and a desktop browser, in both themes.

- [ ] **Bottom tab bar** appears at ≤640px with five tabs (Home, Review, Browse, Words,
      Stats), each reachable, icons legible, labels readable. Desktop ≥641px keeps the
      top bar instead.
- [ ] Settings and Credits are reachable from the gear in the app bar.
- [ ] The tab bar clears the home indicator on a notched phone (safe-area padding), and
      nothing is hidden behind it at the bottom of a long page.
- [ ] **Review**: the hanzi is vertically centred and dominates the screen; the grade bar
      sits in the thumb zone; the tab bar is hidden during review.
- [ ] **Interval previews** on the four grade buttons match what actually happens — grade
      a card with Good, note the preview, then check `#word/<id>` shows that due date.
      (Equality with the scheduler is asserted in tests; this checks the *displayed* one.)
- [ ] Press states: buttons visibly depress. Focus rings are visible when tabbing.
- [ ] With OS "reduce motion" on, transitions do not animate.
- [ ] **Home**: one primary CTA reading "Start review · N due"; the empty state shows the
      large 学 watermark rather than more boxes.
- [ ] Both themes: text is comfortable, the vermilion reads as intentional, dividers are
      visible but quiet.

### Known contrast exception — needs a decision

Token pairs all pass (4.5:1 body, 3:1 chrome), verified numerically. **The tone colours
do not**, and they are frozen by §0:

| tone | on dark | on light |
|---|---|---|
| t1 red | 4.38 | 3.85 |
| t2 green | 5.60 | **3.00** |
| t3 blue | 5.03 | **3.35** |
| t4 purple | **2.63** | 6.40 |
| t5 grey | 6.90 | **2.44** |

t4 on dark and t5/t2/t3 on light are well below 4.5:1 for text. This predates v2 — the
old palette failed similarly — and coloured pinyin is body text, so it matters.

- [ ] Decide: accept as-is, or let the theme derive per-theme tints from the §0 values
      (keeping config the source), or change the §0 values.

