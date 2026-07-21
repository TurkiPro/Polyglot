# Manual checklist — Phase 3 (PWA UI)

`npm test` covers everything that runs without a browser. These are the checks that need
real eyes, a real device and a real network tab.

Run `npm run dev` and open the URL Wrangler prints.

## Install and offline

- [ ] The app is installable (Chrome: address-bar install icon; iOS Safari: Share → Add to
      Home Screen). It opens standalone, with the 语 icon.
- [ ] After one normal load, put the browser in offline mode (DevTools → Network →
      Offline) and reload. The shell and a full review session still work.
- [ ] In DevTools → Application → Cache Storage, the shell cache holds the app files and
      `deck.zh.json`, and **not** `dict.zh.json` or the stroke files. Those appear in the
      runtime cache only after visiting Browse / doing a WRITE card.

## The five modes

- [ ] **REC** — large hanzi on the front; back shows coloured pinyin, definitions,
      traditional form when it differs, and an audio button.
- [ ] **LIS** — audio plays on its own, nothing else visible; back shows the sentence,
      pinyin, translation and definitions.
- [ ] **PROD** — English definitions and an input; typing the right pinyin preselects
      Good, a wrong answer preselects Again, and you can still override before confirming.
- [ ] **SENT** — the sentence in hanzi with the target word highlighted.
- [ ] **WRITE** — a drawing canvas per character; the outline shows for the first
      character only. It works with a finger on a touch screen.

## Interaction

- [ ] Space (or tapping the card) flips. Keys 1-4 grade. Typing in the PROD input does
      not trigger those shortcuts.
- [ ] Grading advances to the next card and the "N left" counter falls.
- [ ] A new card is not the very first thing in a session with reviews due.

## Language display

- [ ] Tone colours: 好 is t3, 传统 is t2 t3, 谢谢 is t4 t5.
- [ ] A split word (e.g. 别) shows a "not biè" hint on its REC front.
- [ ] The non-primary member of a split (别 biè) has **no** audio button and never shows
      a listening card.
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
