tools-submenu =
    .label = Meristema

open-command =
    .label = Open Graph (Current Library)

update-library-command =
    .label = Update Fields (Current Library)

show-update-progress-command =
    .label = Show Update Progress

settings-command =
    .label = Settings

update-items-command =
    .label = Update fields

automatic-updates-command =
    .label = { $marker }Automatic citation updates

provider-submenu =
    .label = Citation data provider

provider-auto-command =
    .label = { $marker }Automatic (recommended)

provider-openalex-command =
    .label = { $marker }OpenAlex

provider-semantic-scholar-command =
    .label = { $marker }Semantic Scholar

provider-crossref-command =
    .label = { $marker }Crossref

provider-opencitations-command =
    .label = { $marker }OpenCitations

provider-inspire-command =
    .label = { $marker }INSPIRE-HEP

refresh-command =
    .label = Refresh

show-items-new-tab-command =
    .label = Show in New Graph

# $count is how many items were selected. The new graph seeds from them and
# fetches their references and citing papers.
open-focus-view-new-tab-command =
    .label =
        { $count ->
            [1] New Graph from item
           *[other] New Graph from { $count } items
        }

new-graph-view-command =
    .label = New Graph

open-existing-view-command =
    .label = { $name }

# $graph is the whole graph name, e.g. "PhD Graph", so a folder already named
# like a graph does not read "New PhD Graph Graph". $count is how many folders
# were selected; several are named by count rather than listed.
collection-new-graph-command =
    .label =
        { $count ->
            [1] New { $graph }
           *[other] New Graph from { $count } Folders
        }

rename-view-command =
    .label = Rename View…

refresh-library-command =
    .label = Refresh Library

open-saved-graph-submenu =
    .label = Open Saved Graph…

open-saved-graph-empty-command =
    .label = No saved graphs yet.
