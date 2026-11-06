# Reading lists (R1)

Ordered reading lists for learning a topic, written by Claude through the
Zotero skill, kept in Zotero so they sync and travel with group libraries.
Three parts share one format: a new plugin, Meristema Reading
(`zotero-meristema-reading`), that edits lists; a `reading-list` verb in the
using-zotero skill that writes them; and Meristema's Reading plan view that
draws them.

Not built on Zotero Syllabus (janbaykara/zotero-syllabus), which already has
ordered lists: its done state is per folder, and here a paper read once is read
in every list. Its collection-note storage is the model for ours.

## 1. Format (the contract)

A **reading list** is a Zotero folder holding one standalone note tagged
`meristema-reading-list`.

- The folder holds the papers. Every paper in a list is in its folder.
- The note has a readable part, then a data part:
  1. An H1 `Reading list - {topic}`, then an `<ol>`: one `<li>` per step, a
     `zotero://select/...` link to the paper (author, year, title) and the
     step's reason.
  2. `<pre data-meristema-reading-list="1">` holding JSON:
     `{ "version": 1, "topic": string, "steps": [{ "key": string, "why": string }] }`.
- The JSON is the source of truth. The plugin rewrites the readable part from it
  on every change. Writers write both parts.
- Readers drop step keys that resolve to no live regular item in the folder,
  and put folder papers absent from `steps` after the last step, as unordered,
  in Zotero's title order.
- A note with an unknown `version` or unparsable JSON is not a list; readers say
  so and never rewrite it.
- One list note per folder. A second one is ignored, and the plugin names it in
  the sidebar.

**Read state** is personal and per paper, the same in every list. It lives in
one standalone note in the user's own library, outside any folder, tagged
`meristema-reading-state`, its JSON in `<pre data-meristema-reading-state="1">`:
`{ "version": 1, "states": { "<paper id>": { "state": "reading" | "read", "at": ISO date } } }`.

- A paper id is `doi:<normalized DOI>`, else `<library>:<item key>` (`user` or
  `group-<id>`), so the state holds for a group's copy and a future platform.
- A paper absent from `states` is Unread. **Next up** is a list's first step that
  is Reading, else its first Unread step.
- The truth is not tags: tags on group items are shared with every member, and
  a removed tag cannot be restored, while a trashed note can.
- For apps without plugins (Zotero for iOS), the plugin mirrors the state onto
  papers in the user's own library as `_reading` and `_read` tags, rewritten
  from the note after every change and at startup. The mirror is one way: a
  tag added or removed by hand is overwritten, never read. Group items get no
  mirror tags. The skill can rebuild the mirror on request.
- Two state notes (a sync race) are merged per paper, the later `at` winning;
  the plugin keeps the merge and trashes the other.
- Lists and state are two versioned JSON documents; Zotero is one store for
  them, and an online platform would keep the same two shapes (a shared list, a
  per-user state).

## 2. Meristema Reading (`zotero-meristema-reading`)

Own repo, same toolchain as Meristema (zotero-plugin-scaffold, TypeScript,
node unit tests, Zotero mocha suite). Display name "Meristema Reading".

| Unit                | Does                                                                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `readingListFormat` | Pure. Parses and writes the note per section 1.                                                                                                  |
| `readState`         | Pure. Parses, merges and writes the state note; maps a Zotero item to its paper id.                                                              |
| `readingListStore`  | Finds the list notes and the state note, caches them, writes changes and the tag mirror; follows Zotero's notifier so sync and skill edits show. |
| Sidebar section     | For a list folder, or a paper in one: steps in order, drag handles, editable reasons, a read-state toggle, next up highlighted.                  |
| Step column         | A "Step" column in the item list, so a folder sorts in reading order.                                                                            |
| List tab            | Double-click a list: full-width cards to drag, reasons in full.                                                                                  |
| Folder menu         | Make reading list: a note with the folder's papers in their current order.                                                                       |
| Item menu           | Mark Unread, Reading or Read, for one paper or a selection.                                                                                      |

A merged or deleted paper drops out of the list. Remapping merged keys through
`dc:replaces` is left for later.

## 3. Meristema's Reading plan view

- Meristema reads both notes itself with its own copy of the format code; it
  needs only the notes, not Meristema Reading.
- Available when a ticked folder holds a list note. Otherwise its row reads
  "Needs a reading list in a ticked folder" (replaces "Arrives with reading
  state").
- Appearance: x is a new **Reading step** metric (1…n; unordered papers after
  the last step), y is citations, colour is a new **Read state** colouring
  (Unread, Reading, Read). The nodes are the ticked folders' papers, drawn as
  any ticked folder already draws; nothing is greyed. A paper in no list has no
  step and sits after the last one; hops appear only when expanded, as in every
  view. A **reading path** joins consecutive steps, drawn apart from citation
  edges.
- Several ticked list folders each keep their own steps; a path never joins two
  lists.
- No shapes for read state. The summary and paragraph are rewritten; the
  "3 annotated papers" rule goes.

## 4. The skill verb

The using-zotero skill drives Zotero through one script, `zot.py`, whose
subcommands (`search`, `add`, `tag`, `file-into`) are its verbs. A new one,
`zot.py reading-list --topic T --collection NAME --steps steps.json`, where each
`steps.json` entry is `{ "doi" | "key", "why" }`. It runs `doctor`, adds missing
papers (`from-doi`, `add`), files them into the folder (made if absent), writes
the note with its tag, then re-reads the note and checks its JSON equals what it
wrote. A folder that already holds a list is refused unless `--replace` is given.

## Testing

- One set of sample notes (ordered, unordered leftovers, missing keys, wrong
  version; state notes with DOI and key ids, two to merge, and the tags each
  mirrors) is read alike by
  the plugin's, Meristema's and the skill's parsers.
- Plugin: unit tests for the format and read state; Zotero cases for the store's
  notifier, sidebar dragging, the folder menu and the item menu, driven through
  the plugin's own menus.
- Meristema: unit tests for Reading step and Read state; a Zotero case where a
  ticked list folder lights the view, places its papers by step and colours them
  by state.

## Build order and plans

1. The format and its sample notes.
2. The plugin, and the skill verb beside it.
3. Meristema's view.
4. Last: rename this repo to `zotero-meristema-graph`.

Steps 1 to 3 each get their own implementation plan.
