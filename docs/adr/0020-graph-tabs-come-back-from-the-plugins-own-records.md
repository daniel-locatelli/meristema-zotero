# Graph tabs come back from the plugin's own records

Open graph tabs come back after a restart, as reader tabs do (F15): in their
old places, the selected one selected, each with its fill stopped. Zotero's
session file could carry them, since `Zotero_Tabs.getState` writes every tab
and `restoreState` calls a hook by tab type, but the plugin keeps them out of
it and keeps its own records instead, one per open graph, in the plugin
database. Zotero runs `restoreState` while its window loads, possibly before
the plugin has installed its hook, and a graph tab with no hook throws inside
Zotero's loop and loses every tab after it, the readers' included; it does
the same when the plugin is disabled or removed. Zotero also writes its file only
on quit and five minutes after a tab change, so a crash would lose a graph's
last edits.

A record holds the tab's place, whether it was selected, its saved graph if
any, and its state, camera included. It is written a moment after a change
and once more when a quit is granted or the plugin goes down, while the tabs
are still open; from then on tabs closing are not the reader's doing and
drop nothing. A tab the reader closes drops its record. On startup the
plugin reopens the records into the first main window, each at its old
place once Zotero has restored its own tabs. A saved graph reopens as the
document of its row, on the tab's state, so edits the row had not caught up
with survive; an unsaved graph reopens from its state alone. A graph in a
detached window comes back as a tab at the end, since a window's place and
size are not worth a second restore path.
