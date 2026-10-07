# FirstCiv Culture Agent — design decision (locked 2026-10-07)

## Direction: STRING FIGURE

String figures (cat's cradle) are one of the few living traditions found across many of the
cultures this agent connects — Inuit *ajaraaq*, Māori *whai*, Diné *na'atł'o'*. The product does the
same thing a string figure does: it stretches threads between two sets of pegs. Left pegs are the
things you already love; right pegs are FirstCiv's living cultures. Qloo's affinities decide
which threads pull taut.

Three directions were considered:
1. **Archive card catalogue** (parchment, Cormorant) — rejected: it is the existing FirstCiv look and
   the portfolio's most repeated slop (cream + serif + gold).
2. **Radio dial / frequency scanner** (black glass, mono) — rejected: reads as a tech toy, says
   nothing about heritage.
3. **String figure on indigo cloth** — chosen. Dyed indigo is a near-universal living craft, the
   thread metaphor maps 1:1 to the data (signal → culture affinity), and the board can animate
   from real agent events instead of decoration.

## Tokens
- Ground: indigo-dyed cloth `--bg #141A31`, surface `#1B2240`, raised `#242C4E`, hairline `#343D63`.
- Text: unbleached cotton `--ink #ECE5D3`, dim `#A9ABBE`.
- Accent: cochineal `--thread #E5577C` — taut threads, the primary action, focus rings. ≤3 per viewport.
- Culture colours come from FirstCiv's own data and only ever colour that culture's peg.
- Type: **Young Serif** (display, one weight), **Red Hat Text** (UI/body), **Spline Sans Mono** (agent
  field notes, scores, endpoints). Radius language: 2px (cloth has no rounded corners) — pills only
  for taste chips.
- One layout primitive: the **ruled bridge row** (index · culture · evidence), repeated.

## Motion
- Signature: threads draw from peg to peg (`stroke-dashoffset`) as each Qloo bridge call returns,
  then settle with a small tension overshoot; the winning threads thicken and turn cochineal.
- Structural: culture pegs pulse once as they are scanned; rows wipe in with `clip-path` left→right
  (the thread's direction); the field-notes log types in.
- Micro: hover lifts a row's thread on the board. `prefers-reduced-motion` → static final state.

## Ledger axes
indigo cloth `#141A31` · Young Serif · cochineal `#E5577C` · live string-figure board · thread draw + tension settle
