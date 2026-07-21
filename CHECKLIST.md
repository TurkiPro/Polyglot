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
- [ ] "Add to my words" adds it; the word then appears in a review session and at
      `#word/<id>`.

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
