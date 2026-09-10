# Handoff: B11 closed, the Zotero suite is green, what to pick up next

Date: 2026-09-10. Branch `main` at `d78b8ff`, pushed, tree clean.
XPI `.scaffold/build/meristema.xpi` built from `d78b8ff`, after the last
`npm test` run.

Read `2026-09-08-roadmap.md` first; it is still the single place that says
what comes next. This file only carries what that file cannot: what B11
turned out to be, and what is worth doing while the manual batch waits on
the user.

## Where things stand

`npm test`: **39 passed, 0 failed**. The Zotero suite is fully green for the
first time. `npm run check`: green, 341 unit tests. There is no known red
test anywhere in the repo.

That is worth saying plainly because every handoff before this one carried a
list of known failures to work around. There is none now. **Any failure a
session sees from here is that session's, with one exception:**
`savedGraphMenu.test.ts` "lists the saved graphs on the first showing" is
still the intermittent one — it drives the real Tools menu and a focus or
popup timing race is the first suspect. One failure there is not a
regression; two in a row is worth looking at.

## What B11 was

"View 15" in `test/zotero/graphViewVisual.test.ts` had been red since the day
it was written, and the pane was never at fault.

A one-row library selection **does** select the node, and the detail pane
**does** show the paper. What the case asked was "is there any
`.cm-placeholder` left in `.cm-detail-body`", and a selected paper with no
metrics renders "No impact metrics for this paper yet." as a placeholder of
its own — which is every paper the visual harness's corpus builds. So a
selected paper read as an empty pane. The case reads the detail header now:
a selected paper puts its own title there, and the empty state names itself
"Paper details".

The question the entry asked — select or only emphasise? — is settled in
favour of select. Decision 4 of `2026-09-07-selection-sync-design.md` says a
one-row selection selects, and Stage 2's adopt rule governs only the
`{ adopt: true }` apply a fresh render makes; the case passes no options, so
the adopt rule never applied to it.

Fixing the assertion made the case's tail run for the first time, and it
failed too. It expected `addFocusItems` to report its selection back to
Zotero, on a spec sentence that named `revealItem` and five siblings — every
one of them retired in Stage 2. The survivor seeds through
`activateFocusState`, which suppresses the report by design and says why: the
seed a projection lands on is the view's own choice, not a click. The rule
that sentence was serving is that only a gesture reaches Zotero, so the case
now asserts that a command reports nothing, and takes its control — that the
suppression is scoped rather than a flag left on — from a real gesture:
Escape on the canvas deselects and reports null exactly once. The spec was
updated to match; no product code changed.

## What is worth doing before the user walks the manual batch

The batch (D3's eight checks and the one B11 check appended to it) is the
user's to walk. Nothing below waits on it. In order:

1. **B9 with B10, the rate-limit pair.** The best of these. It is pure
   logic, unit-testable end to end, and needs no manual check at all — and
   it is the only item on the board that is _time-sensitive_: B9 only bites
   once a Semantic Scholar key is pasted, and today's keyless path is inside
   the limit. It has to land before the user enters a key. The roadmap says
   one small plan covers both.
2. **B13, B14, B16, B17 and B21**, the five surface fixes one branch could
   carry. They build now, and their checks join the pending manual batch
   rather than starting a second one.
3. **Stage 3's brainstorm and spec.** The main line, and its prerequisites
   (Stage 2, B6) are both done and verified in Zotero. It needs the user at a
   keyboard, but not in Zotero.

D3's unwalked checks block none of these. They only mean nothing in the
colour system may be called verified yet — do not tick them, and do not lean
on them.

## Traps, including two this session found

- `npm test` deletes `.scaffold/build/meristema.xpi`. Build the XPI **after**
  the last test run, never before.
- A leftover `zotero.exe` holds the test profile and the run dies with EBUSY
  on `cert9.db`. Killing every `zotero.exe` on the machine is allowed. If a
  run dies at startup rather than producing results, kill and retry before
  concluding anything — the dev profile sometimes opens a "Checking database
  integrity…" dialog that stalls startup.
- The Zotero test add-on is a second copy of `src`, so a UI-path test drives
  the plugin's own menus and rows, never an imported service, and a stub must
  outlive an async `onCommand`.
- **A whole `npm test` run is not the reproduction loop.** `it.only` on a
  single case plus `npm test` is about a minute end to end, because the build
  is a tenth of a second and only the one case runs. That is what made this
  session's five instrument-and-rerun cycles affordable. Remember to take the
  `.only` off — nothing in the gate catches it, since `npm run check` does not
  run the Zotero suite.
- **The visual harness's corpus builds papers with no metrics.** Any
  assertion about the detail pane has to survive that: the pane is full of
  placeholder paragraphs that have nothing to do with whether a paper is
  selected. Read the header (`.cm-detail-title`), which is the paper's title
  or "Paper details" and nothing else.
- `ViewStage` does not expose the renderer, so a case cannot ask where a node
  was drawn and cannot click one. The gestures available to a case are the
  ones that need no coordinates: Escape on the canvas (deselect), and a
  pointer through `windowUtils.sendMouseEvent` at a place known to be empty.
  A constructed `PointerEvent` is not an option — the renderer captures the
  pointer on the way down and a synthetic one has no valid pointer id, which
  fails whichever case is running with no message on it.

## The lesson worth carrying

The unit suite was green at 341/341 through all of this, and so was every
part of the Zotero suite but one, and the one red case was read for two
sessions as a defect in the product. It was a defect in the question the case
asked. When a case has been red since it was written and the rest of it
passes, suspect the assertion before the feature — and instrument the
boundary rather than reasoning about it. Five cycles of "print what the code
actually saw at this line" took twenty minutes and ended the ambiguity that
two triage passes had left open.
