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


# $count is how many items were selected. The new graph seeds from them and
# fetches their references and citing papers, so the label says "seeds"
# rather than "items" (B35).
open-focus-view-new-tab-command =
    .label =
        { $count ->
            [1] New Graph with 1 seed
           *[other] New Graph with { $count } seeds
        }

new-graph-view-command =
    .label = New Graph

open-existing-view-command =
    .label = { $name }

# One folder gets a flat label: it used to read "New { $graph }" with the
# folder's name inside, which put the name of the folder before the word Graph
# and read as a title rather than an action (B19). $count is how many folders
# were selected; several are named by count rather than listed.
collection-new-graph-command =
    .label =
        { $count ->
            [1] Create a new graph
           *[other] New Graph from { $count } Folders
        }

rename-view-command =
    .label = Rename View…

refresh-library-command =
    .label = Refresh Library

open-saved-graph-submenu =
    .label = Open

save-command =
    .label = Save

save-as-command =
    .label = Save as…

open-saved-graph-empty-command =
    .label = No saved graphs yet.

add-to-submenu =
    .label = Add to

add-to-empty-command =
    .label = No graphs are open.
