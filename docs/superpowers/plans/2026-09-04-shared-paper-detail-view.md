# Shared paper detail view — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The item pane section and the graph's detail pane draw a paper's
tabs, badges, metrics, related-work rows, relationship list and similar-paper
section from one module and one stylesheet.

**Spec:** `docs/superpowers/specs/2026-09-04-shared-paper-detail-view-design.md`

**Architecture:** Pure decisions (tab labels, entry merging, the
ignored-relation descriptor) live in `paperDetailModel.ts`, which imports no
Zotero global and is unit-tested under Node. DOM builders live in
`paperDetailView.ts` and take a `PaperDetailHost` adapter that says what the
host can do. The graph keeps its shell (toolbar, header, resizer, collapse) and
the item pane keeps its registration; each becomes a host. The detail rules
leave `graph.css` for `paperDetail.css`, scoped under `.meristema-paper-detail`.

**Tech Stack:** TypeScript, Zotero 7/8 plugin runtime (`Zotero.*`, HTML in a
XUL document), `node --test` + Chai for unit tests, `zotero-plugin test` for
the visual harness, Prettier + ESLint.

## Global constraints

- Branch `shared-paper-detail-view`, based on `88590a3`.
- `test/unit/**` runs under plain Node: nothing imported there may touch
  `Zotero.*` or the DOM at module load. `paperDetailModel.ts` must stay free of
  both; `paperDetailView.ts` may use both.
- Line numbers in this plan are as of `88590a3`. Re-locate by content if the
  file has moved.
- Class names for shared markup are the graph's existing `cm-*` names. Do not
  invent a third vocabulary.
- Behaviour to preserve exactly: the update flow's three outcomes (`N new
paper(s) added`, `No new papers returned`, `Update failed` / `Update
cancelled`), the generation counter on list renders, and the
  `RelationshipMutationEvent` shape.
- The graph host publishes mutations with origin `"graph"`; the item pane host
  with origin `"item-pane"`. Each host ignores events of its own origin, as
  today.
- Verification per task: `npx prettier --check <touched files>`,
  `npx eslint <touched files>`, `npm run typecheck`, `npm run test:unit`.
  `npm test` (real Zotero, minutes) runs in the last task only.
- Commit messages: sentence-case subject, no `feat:`/`fix:` prefixes, body
  ending with the two trailers shown by `git log -1 --format=%B 88590a3`.

## File structure

| File                                          | Responsibility                                                                                       |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `src/services/paperDetailModel.ts`            | Pure: tab labels, merging manual and provider entries, the ignored-relation descriptor.              |
| `src/services/paperDetailView.ts`             | DOM builders: tabs, badges, overview metrics, rows, import area, similar section, relationship list. |
| `addon/content/paperDetail.css`               | Every rule the shared markup needs, under `.meristema-paper-detail`.                                 |
| `addon/content/graph.css`                     | The graph shell only.                                                                                |
| `addon/content/zoteroPane.css`                | Column warning, match-confirmation block, the item pane shell's padding.                             |
| `src/services/graphViewService.ts`            | Graph host: header, toolbar, external-node actions, calls into the builders.                         |
| `src/services/itemPaneService.ts`             | Item pane host: registration, refresh, match confirmation, calls into the builders.                  |
| `src/services/paperOverviewActionsService.ts` | Open in › + Similar + Refresh only.                                                                  |
| `src/services/graphViewControls.ts`           | `ensureStyles` links both stylesheets.                                                               |
| `src/hooks.ts`                                | `installStyles` links `paperDetail.css` in the main window.                                          |
| `test/unit/paperDetailModel.test.ts`          | Unit tests for the pure module.                                                                      |

---

## Task 1: The pure model — tab labels, entry merging, ignored descriptor

**Files:**

- Create: `src/services/paperDetailModel.ts`
- Test: `test/unit/paperDetailModel.test.ts`

**Interfaces produced:**

```ts
export type DetailTab = "overview" | "cited-by" | "references";
export interface DetailTabLabel {
  name: string;
  count: string | null;
  title: string;
}
export function relationshipTabLabel(
  direction: RelationshipViewDirection,
  state: RelationshipPublicationState | null,
  reportedCount: number | null,
): DetailTabLabel;
export interface RelationEntry {
  work: ExternalWork;
  manualRelation: ManualCitationRelation | null;
  ignoredRelation: IgnoredProviderRelation | null;
  providerOrder: number;
}
export function mergeRelationEntries(
  manual: ReadonlyArray<{
    relation: ManualCitationRelation;
    work: ExternalWork | null;
  }>,
  providerWorks: readonly ExternalWork[],
  resolveIgnored: (work: ExternalWork) => IgnoredProviderRelation | null,
): RelationEntry[];
export type CitationRecordLookup = (
  libraryID: number,
  itemKey: string,
) => { references: RelatedWorkMetadata[] } | null;
export function ignoredRelationDescriptorFor(
  node: CitationGraphNode,
  libraryID: number,
  direction: RelationshipViewDirection,
  work: ExternalWork,
  recordFor: CitationRecordLookup,
  referenceIndex?: RelatedWorkLookupIndex,
): IgnoredRelationDescriptor;
export function formatReportedCount(value: number | null): string;
```

- [ ] **Step 1: Create the branch**

```bash
git checkout -b shared-paper-detail-view 88590a3
```

- [ ] **Step 2: Write the failing tests**

`test/unit/paperDetailModel.test.ts`:

```ts
import { describe, it } from "node:test";
import { expect } from "chai";
import type {
  IgnoredProviderRelation,
  ManualCitationRelation,
  RelatedWorkMetadata,
} from "../../src/domain/citationTypes";
import type { ExternalWork } from "../../src/domain/externalWork";
import type { CitationGraphNode } from "../../src/domain/graphTypes";
import {
  ignoredRelationDescriptorFor,
  mergeRelationEntries,
  relationshipTabLabel,
} from "../../src/services/paperDetailModel";

const work = (overrides: Partial<ExternalWork>): ExternalWork => ({
  provider: "openalex",
  providerWorkID: null,
  doi: null,
  title: "Untitled",
  year: null,
  authors: [],
  sourceTitle: null,
  abstract: null,
  citationCount: null,
  referenceCount: null,
  isOpenAccess: null,
  openAccessStatus: null,
  isRetracted: null,
  ...overrides,
});

const node = (overrides: Partial<CitationGraphNode>): CitationGraphNode =>
  ({
    key: "item:AAAA",
    itemID: 1,
    itemKey: "AAAA",
    title: "Subject paper",
    abstract: null,
    sourceTitle: null,
    authors: [],
    year: 2020,
    publicationDate: null,
    citationSequence: null,
    doi: "10.1/subject",
    tags: [],
    collectionIDs: [],
    citationCount: null,
    referenceCount: null,
    resolvedReferenceCount: 0,
    referenceCoverage: null,
    metricsUpdatedAt: null,
    dataAgeDays: null,
    provider: "openalex",
    citationCountProvider: null,
    referenceCountProvider: null,
    providerWorkID: "W1",
    matchedBy: null,
    matchConfidence: null,
    matchConfirmed: true,
    metricStatus: null,
    fwci: null,
    citationPercentile: null,
    isTop1Percent: null,
    isTop10Percent: null,
    citationsLastYear: null,
    citationVelocity: null,
    citationAcceleration: null,
    influentialCitationCount: null,
    isRetracted: null,
    openAccessStatus: null,
    isOpenAccess: null,
    publicationType: null,
    sourceMetrics: null,
    metadataCompleteness: 1,
    ...overrides,
  }) as CitationGraphNode;

describe("relationshipTabLabel", () => {
  it("shows an ellipsis while membership is being published", () => {
    const label = relationshipTabLabel(
      "cited-by",
      {
        active: true,
        membershipPublished: false,
        reportedCount: null,
        reportedCountProvider: null,
        identifiedCount: 0,
      },
      12,
    );
    expect(label).to.deep.equal({
      name: "Cited by",
      count: "…",
      title: "Cited by (updating…)",
    });
  });

  it("prefers the published count over the reported one", () => {
    const label = relationshipTabLabel(
      "references",
      {
        active: false,
        membershipPublished: true,
        reportedCount: 40,
        reportedCountProvider: "openalex",
        identifiedCount: 40,
      },
      12,
    );
    expect(label.count).to.equal("40");
    expect(label.title).to.equal("References (40 reported)");
  });

  it("falls back to the reported count and an em dash", () => {
    expect(relationshipTabLabel("references", null, 12).count).to.equal("12");
    expect(relationshipTabLabel("references", null, null).count).to.equal("—");
  });
});

describe("mergeRelationEntries", () => {
  const manualRelation: ManualCitationRelation = {
    id: 7,
    libraryID: 1,
    subjectItemKey: "AAAA",
    relatedItemKey: "BBBB",
    direction: "reference",
    createdAt: "2026-01-01T00:00:00Z",
  };

  it("puts manual relations first and drops a provider duplicate", () => {
    const manualWork = work({
      provider: "manual",
      doi: "10.1/b",
      inLibraryItemKey: "BBBB",
      zoteroItemKey: "BBBB",
    });
    const entries = mergeRelationEntries(
      [{ relation: manualRelation, work: manualWork }],
      [work({ doi: "10.1/b" }), work({ doi: "10.1/c" })],
      () => null,
    );
    expect(entries.map((entry) => entry.work.doi)).to.deep.equal([
      "10.1/b",
      "10.1/c",
    ]);
    expect(entries[0].manualRelation).to.equal(manualRelation);
    expect(entries[1].manualRelation).to.equal(null);
    expect(entries.map((entry) => entry.providerOrder)).to.deep.equal([0, 1]);
  });

  it("skips a manual relation whose item could not be loaded", () => {
    const entries = mergeRelationEntries(
      [{ relation: manualRelation, work: null }],
      [work({ doi: "10.1/c" })],
      () => null,
    );
    expect(entries).to.have.length(1);
  });

  it("resolves the ignored relation for provider works only", () => {
    const ignored: IgnoredProviderRelation = {
      id: 3,
      libraryID: 1,
      subjectItemKey: "AAAA",
      direction: "reference",
      provider: "openalex",
      providerWorkID: null,
      doi: "10.1/c",
      normalizedTitle: null,
      createdAt: "2026-01-01T00:00:00Z",
    };
    const entries = mergeRelationEntries(
      [],
      [work({ doi: "10.1/c" })],
      (candidate) => (candidate.doi === "10.1/c" ? ignored : null),
    );
    expect(entries[0].ignoredRelation).to.equal(ignored);
  });
});

describe("ignoredRelationDescriptorFor", () => {
  const reference: RelatedWorkMetadata = {
    provider: "openalex",
    providerWorkID: "W9",
    doi: "10.1/ref",
    title: "A reference",
    year: 2010,
    authors: [],
    sourceTitle: null,
    abstract: null,
    citationCount: null,
    referenceCount: null,
    isOpenAccess: null,
    openAccessStatus: null,
    isRetracted: null,
    zoteroItemKey: null,
  } as RelatedWorkMetadata;

  it("names the subject's own reference record for a references row", () => {
    const descriptor = ignoredRelationDescriptorFor(
      node({}),
      1,
      "references",
      work({ doi: "10.1/ref" }),
      () => ({ references: [reference] }),
    );
    expect(descriptor.subjectItemKey).to.equal("AAAA");
    expect(descriptor.direction).to.equal("reference");
    expect(descriptor.providerWorkID).to.equal("W9");
  });

  it("flips to the citing item's reference for a cited-by row that is in the library", () => {
    const citing = work({ doi: "10.1/citing", inLibraryItemKey: "CCCC" });
    const subjectAsReference = { ...reference, doi: "10.1/subject" };
    const descriptor = ignoredRelationDescriptorFor(
      node({}),
      1,
      "cited-by",
      citing,
      (_libraryID, itemKey) =>
        itemKey === "CCCC" ? { references: [subjectAsReference] } : null,
    );
    expect(descriptor.subjectItemKey).to.equal("CCCC");
    expect(descriptor.direction).to.equal("reference");
    expect(descriptor.doi).to.equal("10.1/subject");
  });

  it("describes the citing work itself when it is not in the library", () => {
    const descriptor = ignoredRelationDescriptorFor(
      node({}),
      1,
      "cited-by",
      work({ doi: "10.1/citing" }),
      () => null,
    );
    expect(descriptor.subjectItemKey).to.equal("AAAA");
    expect(descriptor.direction).to.equal("cited-by");
    expect(descriptor.doi).to.equal("10.1/citing");
  });
});
```

- [ ] **Step 3: Run the tests to see them fail**

Run: `npm run test:unit`
Expected: failure loading `../../src/services/paperDetailModel` (module not found).

- [ ] **Step 4: Write the module**

`src/services/paperDetailModel.ts`:

```ts
/*
 * The decisions behind the paper detail view that need no window and no
 * Zotero: what a tab says, how manual and provider relations become one list,
 * and which stored relation an "ignore" on a row refers to. Both hosts — the
 * graph's detail pane and the item pane section — call these through
 * `paperDetailView.ts`. Kept apart from it so `test/unit` can load this file.
 */
import type {
  IgnoredProviderRelation,
  ManualCitationRelation,
  RelatedWorkMetadata,
} from "../domain/citationTypes";
import type { ExternalWork } from "../domain/externalWork";
import type { CitationGraphNode } from "../domain/graphTypes";
import {
  ignoredRelationDescriptorForRelatedWork,
  ignoredRelationDescriptorFromReference,
  referenceMatchesRelatedWork,
  relationshipDirection,
  type IgnoredRelationDescriptor,
} from "../domain/relationshipDescriptors";
import {
  findMatchingRelatedWork,
  matchRelatedWorkToGraphNode,
  normalizeExactTitle,
  relationshipCandidateIdentity,
  type RelatedWorkLookupIndex,
} from "../domain/workIdentity";
import type { RelationshipPublicationState } from "./relationshipEvents";
import type { RelationshipViewDirection } from "./relationshipViewService";

export type DetailTab = "overview" | "cited-by" | "references";

/**
 * A tab's name and its count are two spans, because the name has to be able
 * to clip and the count has to be able to go, and neither can happen while
 * the two are one string. `title` is the whole phrasing for the tooltip.
 */
export interface DetailTabLabel {
  name: string;
  count: string | null;
  title: string;
}

export function formatReportedCount(value: number | null): string {
  return value === null
    ? "—"
    : new Intl.NumberFormat(undefined, { useGrouping: false }).format(value);
}

export function relationshipTabLabel(
  direction: RelationshipViewDirection,
  state: RelationshipPublicationState | null,
  reportedCount: number | null,
): DetailTabLabel {
  const name = direction === "references" ? "References" : "Cited by";
  if (state?.active && !state.membershipPublished) {
    return { name, count: "…", title: `${name} (updating…)` };
  }
  const count = state?.membershipPublished
    ? state.reportedCount
    : reportedCount;
  const formatted = formatReportedCount(count);
  return { name, count: formatted, title: `${name} (${formatted} reported)` };
}

export interface RelationEntry {
  work: ExternalWork;
  manualRelation: ManualCitationRelation | null;
  ignoredRelation: IgnoredProviderRelation | null;
  providerOrder: number;
}

/**
 * Manual relations first, in their own order, then the provider's works in
 * the provider's order, with a work that appears in both lists shown once, as
 * the manual one. A manual relation whose item could not be loaded is dropped
 * rather than shown as an empty row.
 */
export function mergeRelationEntries(
  manual: ReadonlyArray<{
    relation: ManualCitationRelation;
    work: ExternalWork | null;
  }>,
  providerWorks: readonly ExternalWork[],
  resolveIgnored: (work: ExternalWork) => IgnoredProviderRelation | null,
): RelationEntry[] {
  const entries: RelationEntry[] = [];
  const seen = new Set<string>();
  for (const { relation, work } of manual) {
    if (!work) continue;
    const key = relationshipCandidateIdentity(work);
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push({
      work,
      manualRelation: relation,
      ignoredRelation: null,
      providerOrder: entries.length,
    });
  }
  for (const work of providerWorks) {
    const key = relationshipCandidateIdentity(work);
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push({
      work,
      manualRelation: null,
      ignoredRelation: resolveIgnored(work),
      providerOrder: entries.length,
    });
  }
  return entries;
}

export type CitationRecordLookup = (
  libraryID: number,
  itemKey: string,
) => { references: RelatedWorkMetadata[] } | null;

function referenceMatchesNode(
  reference: RelatedWorkMetadata,
  node: CitationGraphNode,
): boolean {
  if (reference.zoteroItemKey === node.itemKey) return true;
  return matchRelatedWorkToGraphNode(reference, node).decision === "same-work";
}

/**
 * Which stored relation an ignore on this row names. A reference row names
 * the subject's own reference record when one matches. A cited-by row whose
 * work is in the library is really that item's reference to the subject, so
 * the descriptor flips to the citing item as subject; when the citing work is
 * not in the library there is nothing to flip to and the row's own work is
 * described under the subject.
 */
export function ignoredRelationDescriptorFor(
  node: CitationGraphNode,
  libraryID: number,
  direction: RelationshipViewDirection,
  work: ExternalWork,
  recordFor: CitationRecordLookup,
  referenceIndex?: RelatedWorkLookupIndex,
): IgnoredRelationDescriptor {
  const relatedKey = work.inLibraryItemKey ?? work.zoteroItemKey ?? null;
  if (direction === "cited-by" && relatedKey) {
    const reference = recordFor(libraryID, relatedKey)?.references.find(
      (candidate) => referenceMatchesNode(candidate, node),
    );
    if (reference) {
      return ignoredRelationDescriptorFromReference(
        libraryID,
        relatedKey,
        reference,
      );
    }
    return {
      libraryID,
      subjectItemKey: relatedKey,
      direction: "reference",
      provider: node.provider ?? "crossref",
      providerWorkID: node.providerWorkID,
      doi: node.doi,
      normalizedTitle: normalizeExactTitle(node.title) || null,
    };
  }
  if (direction === "references") {
    const reference = referenceIndex
      ? findMatchingRelatedWork(referenceIndex, work)
      : recordFor(libraryID, node.itemKey)?.references.find((candidate) =>
          referenceMatchesRelatedWork(candidate, work),
        );
    if (reference) {
      return ignoredRelationDescriptorFromReference(
        libraryID,
        node.itemKey,
        reference,
      );
    }
  }
  return ignoredRelationDescriptorForRelatedWork(
    libraryID,
    node.itemKey,
    relationshipDirection(direction),
    work,
  );
}
```

Check `relationshipDirection` in `src/domain/relationshipDescriptors.ts:86`
maps `"references" → "reference"` and `"cited-by" → "cited-by"`; if its
signature differs, adapt the call rather than the domain function.

- [ ] **Step 5: Run the tests**

Run: `npm run test:unit`
Expected: all `paperDetailModel` tests pass; the existing suites unchanged.
If a fixture field is rejected by the type checker, add the missing field to
the fixture — do not loosen the module's types.

- [ ] **Step 6: Lint, typecheck, commit**

```bash
npx prettier --write src/services/paperDetailModel.ts test/unit/paperDetailModel.test.ts
npx eslint src/services/paperDetailModel.ts test/unit/paperDetailModel.test.ts
npm run typecheck
git add src/services/paperDetailModel.ts test/unit/paperDetailModel.test.ts
git commit -m "Lift the paper detail view's pure decisions into one tested module"
```

---

## Task 2: One stylesheet for the detail markup, loaded by both hosts

The graph must look identical after this task. Only the file the rules live in
changes, plus a root class on the graph's panel.

**Files:**

- Create: `addon/content/paperDetail.css`
- Modify: `addon/content/graph.css`
- Modify: `src/services/graphViewControls.ts:56-67` (`ensureStyles`)
- Modify: `src/hooks.ts:71-88` (`installStyles`)
- Modify: `src/services/graphViewService.ts:1040` (the `cm-detail-panel` element)

- [ ] **Step 1: Write the new stylesheet's head**

`addon/content/paperDetail.css` begins with the root and its tokens. The values
are the ones `.meristema-root` declares in `graph.css:23-49`, copied so the
item pane — which has no `.meristema-root` ancestor — resolves the same colours.

```css
/*
 * The paper detail view: the tabs, badges, metrics, related-work rows and
 * relationship list that the graph's right pane and the item pane section
 * both draw (src/services/paperDetailView.ts). Loaded by both hosts.
 *
 * `.meristema-paper-detail` is the root. In the graph it sits on
 * `.cm-detail-panel`, inside `.meristema-root`, and these tokens restate the
 * values that root already gives; in the item pane it sits on the section's
 * own shell, and these are the only declarations of them.
 */
.meristema-paper-detail {
  --cm-sidepane: var(--material-sidepane, #f2f2f2);
  --cm-panedivider: var(--color-panedivider, #dadada);
  --cm-border: color-mix(in srgb, CanvasText 18%, transparent);
  --cm-border-soft: color-mix(in srgb, CanvasText 10%, transparent);
  --cm-surface: color-mix(in srgb, Canvas 95%, CanvasText 5%);
  --cm-surface-raised: color-mix(in srgb, Canvas 98%, CanvasText 2%);
  --cm-muted: color-mix(in srgb, CanvasText 68%, transparent);
  --cm-fill-secondary: var(
    --fill-secondary,
    color-mix(in srgb, CanvasText 55%, transparent)
  );
  --cm-fill-quinary: var(
    --fill-quinary,
    color-mix(in srgb, CanvasText 5%, transparent)
  );
  --cm-accent: var(--accent-blue, #2563eb);
  --cm-icon-color: #3f4650;
  color-scheme: light dark;
  box-sizing: border-box;
  color: CanvasText;
  font: menu;
}
.meristema-paper-detail *,
.meristema-paper-detail *::before,
.meristema-paper-detail *::after {
  box-sizing: border-box;
}
.meristema-paper-detail h2,
.meristema-paper-detail h3,
.meristema-paper-detail h4 {
  margin: 0;
}
/*
 * The same button, input and icon base the graph gives its whole window
 * (`.meristema-root button` and friends in graph.css). Restated here under
 * this root so the item pane, which has no `.meristema-root`, draws the same
 * controls. Keep the two blocks in step.
 */
.meristema-paper-detail button,
.cm-primary-button,
.cm-secondary-button,
.cm-detail-tabs button,
.cm-collection-choice {
  min-height: 28px;
  padding: 4px 9px;
  border: 1px solid var(--cm-border);
  border-radius: 6px;
  background: var(--cm-surface-raised);
  color: CanvasText;
  font: inherit;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.meristema-paper-detail button:hover:not(:disabled) {
  background: color-mix(in srgb, var(--cm-accent) 10%, Canvas);
  border-color: color-mix(in srgb, var(--cm-accent) 42%, var(--cm-border));
}
.meristema-paper-detail button:disabled {
  cursor: default;
  opacity: 0.55;
}
.cm-primary-button {
  background: var(--cm-accent);
  border-color: var(--cm-accent);
  color: white;
}
.cm-primary-button:hover:not(:disabled) {
  background: color-mix(in srgb, var(--cm-accent) 84%, black) !important;
}
.meristema-paper-detail input[type="search"],
.cm-collection-search {
  min-height: 30px;
  min-width: 0;
  padding: 4px 8px;
  border: 1px solid var(--cm-border);
  border-radius: 6px;
  background: Field;
  color: FieldText;
  font: inherit;
}
.cm-icon {
  display: inline-block;
  width: 15px;
  height: 15px;
  flex: 0 0 auto;
  vertical-align: -2px;
  color: var(--cm-icon-color) !important;
  fill: currentColor !important;
  stroke: none;
}
.cm-icon path {
  fill: currentColor !important;
}
.cm-detail-meta,
.cm-placeholder {
  margin: 3px 0 0;
  color: var(--cm-muted);
  line-height: 1.35;
}
.cm-detail-meta {
  color: var(--cm-fill-secondary);
}
```

Compare the input block with `graph.css:443-457` and the icon block with
`graph.css:431-441`; copy any declaration listed there that is missing above
(the excerpt in this plan may be shorter than the file).

- [ ] **Step 2: Move the detail rules out of graph.css**

Cut each of these blocks from `addon/content/graph.css` and append it to
`paperDetail.css`, verbatim, in this order. Blocks are named by their first
selector; each runs to its closing brace, comments included.

| Cut from graph.css (line at 88590a3) | Block                                                                                                              |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| 506                                  | `.cm-import-area[hidden]` — remove it from the shared `[hidden]` selector list at 502-508 and write it on its own. |
| 767-772                              | `.cm-detail-body`                                                                                                  |
| 773-779                              | `.cm-detail-body > h2, .cm-detail-body > h3`                                                                       |
| 780-801                              | `.cm-detail-section`, `+`, `:empty`                                                                                |
| 802-812                              | `.cm-detail-heading, .cm-detail-actions, .cm-badges` and `.cm-detail-heading`                                      |
| 813-863                              | `.cm-detail-tabs` through `.cm-detail-tabs button[data-selected="true"] .cm-detail-tab-count`                      |
| 877-895                              | `.cm-badges`, `.cm-badges span`, `.cm-badge-danger`, `.cm-badge-warning`                                           |
| 896-1036                             | `.cm-metric-list` through `.cm-advanced-details > .cm-metric-list`                                                 |
| 1037-1081                            | `.cm-external-list` through `.cm-abstract-disclosure p`                                                            |
| 1082-1108                            | `.cm-import-area`, `.cm-collection-chooser`, `.cm-collection-tree`, `.cm-collection-choice`                        |
| 1129-1132                            | `.cm-success`                                                                                                      |

Then, in the moved text, replace every `.meristema-root ` prefix with
`.meristema-paper-detail ` (the tab-button rule at 834 and the row-button rule
at 1062). Leave the container query at `graph.css:864-876` where it is, but
change its inner selector `.meristema-root .cm-detail-tabs button` to
`.meristema-paper-detail .cm-detail-tabs button`.

Remove `.cm-detail-panel h2, .cm-external-card h3, .cm-import-area h4` from the
margin-reset list at `graph.css:208-213` — `paperDetail.css` covers them.
Remove `.cm-detail-meta` and `.cm-placeholder` from `graph.css:234-247` and
delete the standalone `.cm-detail-meta` rule there — they moved in Step 1.

Do not move: `.cm-detail-shell*`, `.cm-detail-nav`, `.cm-detail-resizer*`,
`.cm-detail-panel`, `.cm-detail-header*`, `.cm-detail-doi*`,
`.cm-detail-title`, `.cm-detail-toolbar`, `.cm-detail-toggle`, or the
`.meristema-root button` base block at 458-495 — the graph's other panes need
that one.

- [ ] **Step 3: Link the stylesheet from both hosts**

`src/services/graphViewControls.ts`, replace `ensureStyles`:

```ts
export const PAPER_DETAIL_STYLESHEET_ID = `${config.addonRef}-paper-detail-stylesheet`;
export const PAPER_DETAIL_STYLESHEET_HREF = `chrome://${config.addonRef}/content/paperDetail.css`;

function ensureStylesheet(document: Document, id: string, href: string): void {
  let link = document.getElementById(id) as HTMLLinkElement | null;
  if (!link) {
    link = element(document, "link");
    link.id = id;
    link.rel = "stylesheet";
    (document.head ?? document.documentElement).appendChild(link);
  }
  if (link.getAttribute("href") !== href) link.setAttribute("href", href);
}

/** The detail view's stylesheet, in whichever document is about to draw one. */
export function ensurePaperDetailStyles(document: Document): void {
  ensureStylesheet(
    document,
    PAPER_DETAIL_STYLESHEET_ID,
    PAPER_DETAIL_STYLESHEET_HREF,
  );
}

export function ensureStyles(document: Document): void {
  ensurePaperDetailStyles(document);
  ensureStylesheet(
    document,
    `${config.addonRef}-graph-stylesheet`,
    `chrome://${config.addonRef}/content/graph.css`,
  );
}
```

`src/hooks.ts`, in `installStyles`, add the pair to the `stylesheets` array,
importing the two constants from `./services/graphViewControls`:

```ts
    [PAPER_DETAIL_STYLESHEET_ID, PAPER_DETAIL_STYLESHEET_HREF],
```

Both writers use the same element id, so a graph tab opened in a main window
that already links the sheet only re-checks the `href`.

- [ ] **Step 4: Put the root class on the graph's panel**

`src/services/graphViewService.ts:1040`:

```ts
const detail = element(
  document,
  "aside",
  "cm-detail-panel meristema-paper-detail",
);
```

- [ ] **Step 5: Verify**

```bash
npx prettier --write addon/content/paperDetail.css addon/content/graph.css src/services/graphViewControls.ts src/hooks.ts src/services/graphViewService.ts
npx eslint src/services/graphViewControls.ts src/hooks.ts src/services/graphViewService.ts
npm run typecheck
grep -c "meristema-root" addon/content/paperDetail.css
```

Expected: typecheck clean; the grep prints `0`.

Then in the running Zotero (`npm start` is already serving; the plugin
reloads on build): open a Collection Graph, select a paper, walk the three
tabs, open Advanced, expand an abstract, click Add to Zotero on an external
row to see the chooser. Everything should look as it did at `88590a3`.

- [ ] **Step 6: Commit**

```bash
git add addon/content/paperDetail.css addon/content/graph.css src/services/graphViewControls.ts src/hooks.ts src/services/graphViewService.ts
git commit -m "Move the detail pane's rules into a stylesheet both hosts can load"
```

---

## Task 3: The builders — tabs, badges, metrics, rows, import, similar

The DOM half of the shared module. Nothing calls it yet; Task 5 and Task 6
switch the hosts over.

**Files:**

- Create: `src/services/paperDetailView.ts`

**Interfaces produced** (the hosts in Tasks 5 and 6 depend on these names):

```ts
export interface RowAction {
  label: string;
  title?: string;
  /** Rendered with `cm-primary-button`; default is secondary. */
  primary?: boolean;
  run(): void | Promise<void>;
}

export interface PaperDetailHost {
  origin: "graph" | "item-pane";
  snapshot: LibrarySnapshot;
  /** Select the library item with this key in Zotero. */
  showInZotero(itemKey: string): void;
  /** Whether Add to Zotero opens the collection chooser first. */
  collectionChooser: boolean;
  /** Extra chip buttons on a row (Explore from this paper, Add as seed). */
  rowActions?(work: ExternalWork): readonly RowAction[];
  /** A click handler for a row when clicking it previews on the plot. */
  previewRow?(
    work: ExternalWork,
    context: RelationshipContext | null,
  ): (() => void) | null;
  clearPreview?(): void;
  /** Called after an ignore or a restore; the host publishes or applies it. */
  onRelationshipMutation(event: RelationshipMutationEvent): void;
}

export interface RelationshipContext {
  node: CitationGraphNode;
  direction: RelationshipViewDirection;
  ignoredIndex: IgnoredRelationIndex;
  referenceIndex?: RelatedWorkLookupIndex;
  /** Redraw the list after a manual relation is removed. */
  rerender(): void;
}

export function runAction(
  button: HTMLButtonElement,
  action: () => void | Promise<void>,
): void;
export function createDetailTabs(
  document,
  options: {
    node;
    libraryID;
    active: DetailTab;
    onSelect(tab: DetailTab): void;
  },
): { root: HTMLDivElement; updateCounts(node: CitationGraphNode): void };
export function createBadges(
  document,
  subject: CitationGraphNode | ExternalWork,
  extra?: { manual?: boolean; ignored?: boolean },
): HTMLDivElement | null;
export function detailSection(
  document,
  ...children: readonly Node[]
): HTMLElement;
export function createOverviewMetrics(document, node): DocumentFragment;
export function createCollectionChooser(
  document,
  snapshot,
): { root: HTMLDivElement; selected: Set<number> };
export function createImportArea(
  document,
  work,
  host,
  onImported: (item: Zotero.Item) => void,
): { root: HTMLElement; addButton: HTMLButtonElement };
export function appendRelatedWorkRows(
  document,
  list: HTMLElement,
  entries: readonly RelationEntry[],
  host,
  context?: RelationshipContext,
): void;
export function createSimilarSection(
  document,
  host,
  load: () => Promise<ExternalWork[]>,
): { root: HTMLElement; start(): Promise<void> };
export function manualWorkForItemKey(
  libraryID: number,
  relatedItemKey: string,
): ExternalWork | null;
```

- [ ] **Step 1: Write the module's head and the small builders**

`src/services/paperDetailView.ts`:

```ts
/*
 * The paper detail view, as both hosts draw it: the graph's right pane
 * (graphViewService.ts) and the item pane section (itemPaneService.ts). Each
 * builder returns plain elements; what differs between the hosts — what "Show
 * in Zotero" does, whether a row can preview on the plot, whether import
 * offers a collection chooser — comes in through `PaperDetailHost`.
 *
 * Decisions that need no DOM are in paperDetailModel.ts.
 */
import type { ExternalWork } from "../domain/externalWork";
import type { CitationGraphNode } from "../domain/graphTypes";
import type { LibrarySnapshot, ZoteroPaper } from "../domain/types";
import {
  createIgnoredRelationIndex,
  findIgnoredRelation,
  type IgnoredRelationIndex,
} from "../domain/relationshipDescriptors";
import {
  createRelatedWorkLookupIndex,
  type RelatedWorkLookupIndex,
} from "../domain/workIdentity";
import {
  getCitationMetricRecord,
  getIgnoredRelations,
  ignoreProviderRelation,
  removeIgnoredRelation,
  removeManualRelation,
} from "./citationMetricsStore";
import { importExternalWork } from "./externalDiscoveryService";
import {
  externalWorkAuthorsText,
  externalWorkMetadataText,
} from "./externalWorkPresentationService";
import { externalWorkDisplayTitle } from "./externalWorkMetadataService";
import { createMetricNodeForItem } from "./itemMetricContext";
import { manualRelationsForSubject } from "./manualRelationshipPickerService";
import {
  formatMetricValue,
  getMetricDefinition,
  METRIC_DEFINITIONS,
  SUPPLEMENTARY_PROPERTY_DEFINITIONS,
} from "./metricRegistry";
import {
  ignoredRelationDescriptorFor,
  mergeRelationEntries,
  relationshipTabLabel,
  type DetailTab,
  type DetailTabLabel,
  type RelationEntry,
} from "./paperDetailModel";
import {
  citationDataSourceLabel,
  externalWorkURL,
} from "./providerPresentation";
import { getRelationshipPublicationState } from "./relationshipEvents";
import {
  getRelationshipReportedCounts,
  type RelationshipMutationEvent,
  type RelationshipViewDirection,
} from "./relationshipViewService";
import { clear, element, normalizeSearch, text } from "./graphViewControls";

export interface RowAction {
  label: string;
  title?: string;
  primary?: boolean;
  run(): void | Promise<void>;
}

export interface RelationshipContext {
  node: CitationGraphNode;
  direction: RelationshipViewDirection;
  ignoredIndex: IgnoredRelationIndex;
  referenceIndex?: RelatedWorkLookupIndex;
  rerender(): void;
}

export interface PaperDetailHost {
  origin: "graph" | "item-pane";
  snapshot: LibrarySnapshot;
  showInZotero(itemKey: string): void;
  collectionChooser: boolean;
  rowActions?(work: ExternalWork): readonly RowAction[];
  previewRow?(
    work: ExternalWork,
    context: RelationshipContext | null,
  ): (() => void) | null;
  clearPreview?(): void;
  onRelationshipMutation(event: RelationshipMutationEvent): void;
}

export function runAction(
  button: HTMLButtonElement,
  action: () => void | Promise<void>,
): void {
  if (button.disabled) return;
  button.disabled = true;
  void Promise.resolve()
    .then(action)
    .catch((error: unknown) => {
      Zotero.logError(
        error instanceof Error ? error : new Error(String(error)),
      );
    })
    .finally(() => {
      if (button.isConnected) button.disabled = false;
    });
}

export function button(
  document: Document,
  label: string | DocumentFragment,
  className: string,
  title?: string,
): HTMLButtonElement {
  const node = element(document, "button", className);
  node.type = "button";
  if (typeof label === "string") node.textContent = label;
  else node.appendChild(label);
  if (title) node.title = title;
  return node;
}

export function externalWorkTitle(work: ExternalWork): string {
  return externalWorkDisplayTitle(work) ?? "Title unavailable";
}

function localPaperByKey(
  snapshot: LibrarySnapshot,
): ReadonlyMap<string, ZoteroPaper> {
  return new Map(snapshot.papers.map((paper) => [paper.itemKey, paper]));
}

/**
 * One block of a body, in the rhythm `.cm-detail-section` sets: padding above
 * and below, and a hairline between it and the block before it.
 */
export function detailSection(
  document: Document,
  ...children: readonly Node[]
): HTMLElement {
  const wrapper = element(document, "section", "cm-detail-section");
  wrapper.append(...children);
  return wrapper;
}

/* ---------------------------------------------------------------- tabs */

function publicationStateFor(
  libraryID: number,
  node: CitationGraphNode,
  direction: RelationshipViewDirection,
) {
  return (
    getRelationshipPublicationState(libraryID, node.itemKey, direction) ??
    getRelationshipPublicationState(
      Zotero.Libraries.userLibraryID,
      node.itemKey,
      direction,
    )
  );
}

function tabLabelFor(
  libraryID: number,
  node: CitationGraphNode,
  tab: DetailTab,
): DetailTabLabel {
  if (tab === "overview") {
    return { name: "Overview", count: null, title: "This paper's metrics" };
  }
  const reported = getRelationshipReportedCounts(libraryID, node);
  return relationshipTabLabel(
    tab,
    publicationStateFor(libraryID, node, tab),
    tab === "references" ? reported.referenceCount : reported.citationCount,
  );
}

function applyTabLabel(target: HTMLButtonElement, label: DetailTabLabel): void {
  const document = target.ownerDocument;
  clear(target);
  target.append(text(document, "span", label.name, "cm-detail-tab-label"));
  if (label.count !== null) {
    target.append(text(document, "span", label.count, "cm-detail-tab-count"));
  }
  target.title = label.title;
}

export function createDetailTabs(
  document: Document,
  options: {
    node: CitationGraphNode;
    libraryID: number;
    active: DetailTab;
    onSelect(tab: DetailTab): void;
  },
): { root: HTMLDivElement; updateCounts(node: CitationGraphNode): void } {
  const root = element(document, "div", "cm-detail-tabs");
  const tabs: DetailTab[] = ["overview", "cited-by", "references"];
  for (const tab of tabs) {
    const entry = button(document, "", "");
    entry.dataset.mode = tab;
    entry.dataset.selected = String(tab === options.active);
    applyTabLabel(entry, tabLabelFor(options.libraryID, options.node, tab));
    entry.addEventListener("click", () => options.onSelect(tab));
    root.appendChild(entry);
  }
  return {
    root,
    updateCounts(node) {
      for (const tab of tabs) {
        const entry = root.querySelector<HTMLButtonElement>(
          `button[data-mode="${tab}"]`,
        );
        if (entry)
          applyTabLabel(entry, tabLabelFor(options.libraryID, node, tab));
      }
    },
  };
}

/* -------------------------------------------------------------- badges */

export function createBadges(
  document: Document,
  subject: CitationGraphNode | ExternalWork,
  extra: { manual?: boolean; ignored?: boolean } = {},
): HTMLDivElement | null {
  const badges = element(document, "div", "cm-badges");
  const add = (label: string, className?: string): void => {
    badges.appendChild(text(document, "span", label, className));
  };
  if (extra.manual) add("Manual");
  if (subject.isOpenAccess) add("Open Access");
  if (extra.ignored) add("Ignored Relationship");
  if (subject.isRetracted) add("Retracted", "cm-badge-danger");
  if ("isTop1Percent" in subject) {
    if (subject.isTop1Percent) add("Top 1%");
    else if (subject.isTop10Percent) add("Top 10%");
    if (!subject.matchConfirmed)
      add("Match needs confirmation", "cm-badge-warning");
  }
  return badges.childElementCount ? badges : null;
}

/* ------------------------------------------------------------- metrics */

function advancedMetrics(
  document: Document,
  node: CitationGraphNode,
): HTMLElement {
  const details = element(document, "details", "cm-advanced-details");
  details.appendChild(text(document, "summary", "Advanced"));
  const rows = element(document, "dl", "cm-metric-list");
  const append = (label: string, value: string, description: string): void => {
    const term = text(document, "dt", label);
    term.title = description;
    rows.append(term, text(document, "dd", value));
  };
  for (const metric of METRIC_DEFINITIONS) {
    if (metric.itemPane !== "advanced") continue;
    append(
      metric.label,
      formatMetricValue(metric.id, metric.value(node)),
      metric.description,
    );
  }
  for (const property of SUPPLEMENTARY_PROPERTY_DEFINITIONS) {
    if (property.itemPane !== "advanced") continue;
    const value = property.value(node);
    append(
      property.label,
      value === null || value === undefined || value === ""
        ? "—"
        : property.format(value),
      property.description,
    );
  }
  details.appendChild(rows);
  return details;
}

/**
 * Three figures — FWCI, citations per year, percentile — or one sentence when
 * none is known, then Advanced with the rest of the registry. The tab row
 * above already states the citation and reference counts.
 */
export function createOverviewMetrics(
  document: Document,
  node: CitationGraphNode,
): DocumentFragment {
  const fragment = document.createDocumentFragment();
  const headline = [
    ["FWCI", formatMetricValue("fwci", node.fwci), "fwci"],
    [
      "Citations / year",
      node.citationVelocity === null
        ? "—"
        : formatMetricValue("citation-rate", node.citationVelocity),
      "citation-rate",
    ],
    [
      "Percentile",
      formatMetricValue("citation-percentile", node.citationPercentile),
      "citation-percentile",
    ],
  ] as const;
  if (headline.every(([, value]) => value === "—")) {
    fragment.appendChild(
      detailSection(
        document,
        text(
          document,
          "p",
          "No impact metrics for this paper yet. Refresh the view to fetch them.",
          "cm-placeholder",
        ),
      ),
    );
  } else {
    const rows = element(document, "dl", "cm-metric-strip cm-metric-list");
    for (const [label, value, metric] of headline) {
      const term = text(document, "dt", label);
      term.title = getMetricDefinition(metric).description;
      rows.append(term, text(document, "dd", value));
    }
    fragment.appendChild(detailSection(document, rows));
  }
  fragment.appendChild(
    detailSection(document, advancedMetrics(document, node)),
  );
  return fragment;
}
```

Take the `advancedMetrics` body from `graphViewService.ts:223-259` and the
`renderOverview` strip from `graphViewService.ts:3630-3670` if the excerpt
above disagrees with the file; the file is the truth.

- [ ] **Step 2: Add the collection chooser and the import area**

Append to `paperDetailView.ts`. The chooser is the one at
`graphViewService.ts:379-420`, moved here whole (copy its body verbatim; the
skeleton below shows the shape):

```ts
/* -------------------------------------------------------------- import */

export function createCollectionChooser(
  document: Document,
  snapshot: LibrarySnapshot,
): { root: HTMLDivElement; selected: Set<number> } {
  const root = element(document, "div", "cm-collection-chooser");
  const selected = new Set<number>();
  const search = element(document, "input", "cm-collection-search");
  search.type = "search";
  search.placeholder = "Search collections";
  const list = element(document, "div", "cm-collection-tree");
  const render = (): void => {
    clear(list);
    const query = normalizeSearch(search.value);
    for (const collection of snapshot.collections) {
      if (query && !normalizeSearch(collection.path).includes(query)) continue;
      const label = element(document, "label", "cm-collection-choice");
      label.style.paddingInlineStart = `${collection.depth * 15 + 5}px`;
      const checkbox = element(document, "input");
      checkbox.type = "checkbox";
      checkbox.checked = selected.has(collection.collectionID);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) selected.add(collection.collectionID);
        else selected.delete(collection.collectionID);
      });
      label.append(checkbox, text(document, "span", collection.name));
      list.appendChild(label);
    }
  };
  search.addEventListener("input", render);
  root.append(search, list);
  render();
  return { root, selected };
}

/**
 * Add to Zotero. With `host.collectionChooser` the button opens an area with
 * the chooser and Cancel / Add paper; without it the work is imported into no
 * collection at once. Either way `onImported` receives the new item.
 */
export function createImportArea(
  document: Document,
  work: ExternalWork,
  host: PaperDetailHost,
  onImported: (item: Zotero.Item) => void,
): { root: HTMLElement; addButton: HTMLButtonElement } {
  const root = element(document, "div", "cm-import-area");
  root.hidden = true;
  const addButton = button(document, "Add to Zotero", "cm-primary-button");
  const finish = async (collectionIDs: number[]): Promise<void> => {
    const items = await importExternalWork(
      work,
      host.snapshot.libraryID,
      collectionIDs,
    );
    const imported = items[0];
    if (!imported) throw new Error("No item was imported.");
    work.inLibraryItemKey = String(imported.key);
    root.replaceChildren(text(document, "p", "Added to Zotero.", "cm-success"));
    root.hidden = false;
    addButton.remove();
    onImported(imported);
  };
  if (!host.collectionChooser) {
    addButton.addEventListener("click", () => {
      addButton.textContent = "Adding…";
      runAction(addButton, async () => {
        try {
          await finish([]);
        } catch (error) {
          addButton.textContent = "Import failed — try again";
          throw error;
        }
      });
    });
    return { root, addButton };
  }
  const chooser = createCollectionChooser(document, host.snapshot);
  const confirm = button(document, "Add paper", "cm-primary-button");
  const cancel = button(document, "Cancel", "cm-secondary-button");
  confirm.addEventListener("click", () => {
    confirm.textContent = "Adding…";
    runAction(confirm, async () => {
      try {
        await finish([...chooser.selected]);
      } catch (error) {
        confirm.textContent = "Import failed — try again";
        throw error;
      }
    });
  });
  cancel.addEventListener("click", () => {
    root.hidden = true;
    addButton.hidden = false;
  });
  const buttons = element(document, "div", "cm-detail-actions");
  buttons.append(cancel, confirm);
  root.append(
    text(document, "h4", "Choose collections"),
    chooser.root,
    buttons,
  );
  addButton.addEventListener("click", () => {
    addButton.hidden = true;
    root.hidden = false;
  });
  return { root, addButton };
}
```

- [ ] **Step 3: Add the rows**

Append to `paperDetailView.ts`. This is `appendExternalWorkCards`
(`graphViewService.ts:2753-3090`) and `renderRelationCard`
(`itemPaneService.ts:958-1150`) made one. Where they differed, the choice:

- Title: the local library title when the work is in the library, else the
  work's title (both hosts did this; the graph via `paperByKey`).
- No "In Zotero" badge (the graph dropped it; the button already says which).
- Manual rows: Manual badge, Remove manual relation button, no ignore toggle.
- Ignore toggle only when the context's node is a library item and the work
  is not a manual one.

```ts
/* ---------------------------------------------------------------- rows */

function ignoredRelationFor(
  context: RelationshipContext,
  libraryID: number,
  work: ExternalWork,
) {
  return findIgnoredRelation(
    context.ignoredIndex,
    ignoredRelationDescriptorFor(
      context.node,
      libraryID,
      context.direction,
      work,
      getCitationMetricRecord,
      context.referenceIndex,
    ),
  );
}

export function appendRelatedWorkRows(
  document: Document,
  list: HTMLElement,
  entries: readonly RelationEntry[],
  host: PaperDetailHost,
  context?: RelationshipContext,
): void {
  const libraryID = host.snapshot.libraryID;
  const paperByKey = localPaperByKey(host.snapshot);
  const subjectIsLibraryItem =
    context !== undefined &&
    context.node.kind !== "external" &&
    context.node.itemID > 0;

  for (const entry of entries) {
    const { work, manualRelation } = entry;
    const card = element(document, "article", "cm-external-card");
    if (work.isRetracted) card.classList.add("cm-external-retracted");
    const localKey = work.inLibraryItemKey ?? work.zoteroItemKey ?? null;
    const localTitle = localKey
      ? paperByKey.get(localKey)?.title?.trim()
      : null;
    const title = text(document, "h3", localTitle || externalWorkTitle(work));
    if (manualRelation) {
      title.title =
        context?.direction === "references"
          ? "Reference added manually in Meristema"
          : "Citing paper added manually in Meristema";
    }
    card.appendChild(title);
    card.appendChild(
      text(document, "p", externalWorkAuthorsText(work), "cm-detail-meta"),
    );
    const metadataText = externalWorkMetadataText(
      work,
      work.recommendationScore,
    );
    if (metadataText)
      card.appendChild(text(document, "p", metadataText, "cm-detail-meta"));

    const identityRow = element(document, "div", "cm-detail-actions");
    identityRow.style.justifyContent = "space-between";
    identityRow.style.width = "100%";
    const url = externalWorkURL(work);
    if (url) {
      const link = element(document, "a");
      link.href = url;
      link.textContent = work.doi?.trim()
        ? `DOI: ${work.doi.trim()}`
        : `Open ${citationDataSourceLabel(work.provider)} record`;
      link.style.minWidth = "0";
      link.style.overflowWrap = "anywhere";
      link.addEventListener("click", (event) => {
        event.preventDefault();
        Zotero.launchURL(url);
      });
      identityRow.appendChild(link);
    }

    const actions = element(document, "div", "cm-detail-actions");
    let importArea: { root: HTMLElement; addButton: HTMLButtonElement } | null =
      null;
    if (localKey) {
      const show = button(document, "Show in Zotero", "cm-primary-button");
      show.addEventListener("click", () => host.showInZotero(localKey));
      actions.appendChild(show);
    } else {
      importArea = createImportArea(document, work, host, () => {
        const show = button(document, "Show in Zotero", "cm-primary-button");
        show.addEventListener("click", () => {
          if (work.inLibraryItemKey) host.showInZotero(work.inLibraryItemKey);
        });
        actions.prepend(show);
      });
      actions.appendChild(importArea.addButton);
    }
    for (const action of host.rowActions?.(work) ?? []) {
      const extra = button(
        document,
        action.label,
        action.primary ? "cm-primary-button" : "cm-secondary-button",
        action.title,
      );
      extra.addEventListener("click", () =>
        runAction(extra, () => action.run()),
      );
      actions.appendChild(extra);
    }

    let activeIgnoredRelation = entry.ignoredRelation;
    let ignoredBadge: HTMLElement | null = null;
    const badges = element(document, "div", "cm-badges");
    const syncBadges = (): void => {
      clear(badges);
      const fresh = createBadges(document, work, {
        manual: Boolean(manualRelation),
        ignored: Boolean(activeIgnoredRelation),
      });
      if (fresh) badges.append(...Array.from(fresh.childNodes));
      ignoredBadge = null;
      if (badges.childElementCount) {
        if (!badges.parentElement) card.insertBefore(badges, identityRow);
      } else {
        badges.remove();
      }
    };

    if (manualRelation && context) {
      const remove = button(
        document,
        "Remove manual relation",
        "cm-secondary-button",
      );
      remove.addEventListener("click", () =>
        runAction(remove, async () => {
          await removeManualRelation(manualRelation.id);
          context.rerender();
        }),
      );
      actions.appendChild(remove);
    } else if (context && subjectIsLibraryItem && work.provider !== "manual") {
      const toggle = button(document, "", "cm-secondary-button");
      const syncToggle = (): void => {
        toggle.textContent = activeIgnoredRelation
          ? "Restore relationship"
          : "Mark incorrect";
        toggle.title = activeIgnoredRelation
          ? "Restore this relationship to the citation graph"
          : "Hide only this relationship edge from the citation graph";
      };
      toggle.addEventListener("click", () =>
        runAction(toggle, async () => {
          if (activeIgnoredRelation) {
            await removeIgnoredRelation(activeIgnoredRelation.id);
            activeIgnoredRelation = null;
          } else {
            const descriptor = ignoredRelationDescriptorFor(
              context.node,
              libraryID,
              context.direction,
              work,
              getCitationMetricRecord,
              context.referenceIndex,
            );
            await ignoreProviderRelation({
              ...descriptor,
              providerWorkID: descriptor.providerWorkID ?? "",
              doi: descriptor.doi ?? "",
              normalizedTitle: descriptor.normalizedTitle ?? "",
            });
            activeIgnoredRelation = findIgnoredRelation(
              createIgnoredRelationIndex(getIgnoredRelations(libraryID)),
              descriptor,
            );
          }
          host.clearPreview?.();
          syncToggle();
          syncBadges();
          host.onRelationshipMutation({
            origin: host.origin,
            libraryID,
            subjectItemKey: context.node.itemKey,
            direction: context.direction,
            work,
            ignored: Boolean(activeIgnoredRelation),
          });
        }),
      );
      syncToggle();
      actions.appendChild(toggle);
    }
    identityRow.appendChild(actions);
    if (importArea) card.appendChild(importArea.root);
    card.appendChild(identityRow);
    syncBadges();

    if (work.abstract) {
      const disclosure = element(document, "details", "cm-abstract-disclosure");
      disclosure.append(
        text(document, "summary", "Abstract"),
        text(document, "p", work.abstract),
      );
      card.appendChild(disclosure);
    }

    const preview = host.previewRow?.(work, context ?? null) ?? null;
    if (preview) {
      const show = (): void => {
        if (activeIgnoredRelation) host.clearPreview?.();
        else preview();
      };
      card.style.cursor = "pointer";
      card.tabIndex = 0;
      card.setAttribute("role", "button");
      card.title = "Click to preview this paper on the graph";
      card.addEventListener("click", (event) => {
        const target = event.target as Element | null;
        if (target?.closest("a, button, input, select, summary")) return;
        show();
      });
      card.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        show();
      });
    }
    list.appendChild(card);
  }
}

export function manualWorkForItemKey(
  libraryID: number,
  relatedItemKey: string,
): ExternalWork | null {
  const related = Zotero.Items.getByLibraryAndKey?.(
    libraryID,
    relatedItemKey,
  ) as Zotero.Item | false | undefined;
  if (!related) return null;
  const node = createMetricNodeForItem(related);
  return {
    provider: "manual",
    providerWorkID: null,
    doi: node.doi,
    title: node.title,
    year: node.year,
    authors: node.authors,
    sourceTitle: node.sourceTitle,
    abstract: null,
    citationCount: node.citationCount,
    referenceCount: node.referenceCount,
    isOpenAccess: node.isOpenAccess,
    openAccessStatus: node.openAccessStatus,
    isRetracted: node.isRetracted,
    zoteroItemKey: relatedItemKey,
    inLibraryItemKey: relatedItemKey,
  };
}

/** Manual relations for a subject, as entries the rows can draw. */
export function manualEntriesFor(
  libraryID: number,
  node: CitationGraphNode,
  direction: RelationshipViewDirection,
) {
  if (node.kind === "external" || node.itemID <= 0) return [];
  return manualRelationsForSubject(
    libraryID,
    node.itemKey,
    direction === "references" ? "reference" : "cited-by",
  ).map(({ relation, relatedItemKey }) => ({
    relation,
    work: manualWorkForItemKey(libraryID, relatedItemKey),
  }));
}

/** The entries for a relationship list, ready for `appendRelatedWorkRows`. */
export function relationshipEntries(
  libraryID: number,
  context: RelationshipContext,
  providerWorks: readonly ExternalWork[],
): RelationEntry[] {
  return mergeRelationEntries(
    manualEntriesFor(libraryID, context.node, context.direction),
    providerWorks,
    (work) => ignoredRelationFor(context, libraryID, work),
  );
}

export function relationshipContextFor(
  libraryID: number,
  node: CitationGraphNode,
  direction: RelationshipViewDirection,
  rerender: () => void,
): RelationshipContext {
  return {
    node,
    direction,
    ignoredIndex: createIgnoredRelationIndex(getIgnoredRelations(libraryID)),
    referenceIndex:
      direction === "references"
        ? createRelatedWorkLookupIndex(
            getCitationMetricRecord(libraryID, node.itemKey)?.references ?? [],
          )
        : undefined,
    rerender,
  };
}
```

`ExternalWork.recommendationScore` — check `src/domain/externalWork.ts`; if the
field is optional there, the call compiles as written.

- [ ] **Step 4: Add the similar section**

```ts
/* ------------------------------------------------------------- similar */

export function createSimilarSection(
  document: Document,
  host: PaperDetailHost,
  load: () => Promise<ExternalWork[]>,
): { root: HTMLElement; start(): Promise<void> } {
  const root = element(document, "section", "cm-inline-similar-results");
  let generation = 0;
  const heading = (): HTMLElement => text(document, "h3", "Similar papers");
  return {
    root,
    async start() {
      const mine = ++generation;
      clear(root);
      root.append(
        heading(),
        text(document, "p", "Finding similar papers…", "cm-placeholder"),
      );
      try {
        const works = await load();
        if (mine !== generation || !root.isConnected) return;
        clear(root);
        root.appendChild(heading());
        if (!works.length) {
          root.appendChild(
            text(
              document,
              "p",
              "No external works were found.",
              "cm-placeholder",
            ),
          );
          return;
        }
        const list = element(document, "div", "cm-external-list");
        appendRelatedWorkRows(
          document,
          list,
          works.map((work, providerOrder) => ({
            work,
            manualRelation: null,
            ignoredRelation: null,
            providerOrder,
          })),
          host,
        );
        root.appendChild(list);
      } catch (error) {
        if (mine === generation && root.isConnected) {
          clear(root);
          root.append(
            heading(),
            text(
              document,
              "p",
              "Similar-paper search failed.",
              "cm-placeholder",
            ),
          );
        }
        throw error;
      }
    },
  };
}
```

- [ ] **Step 5: Verify and commit**

```bash
npx prettier --write src/services/paperDetailView.ts
npx eslint src/services/paperDetailView.ts
npm run typecheck
git add src/services/paperDetailView.ts
git commit -m "Build the paper detail view's tabs, badges, metrics and rows in one module"
```

Nothing calls the module yet, so the running Zotero is unchanged.

---

## Task 4: The relationship list

**Files:**

- Modify: `src/services/paperDetailView.ts` (append)

**Interfaces produced:**

```ts
export interface RelationshipListOptions {
  host: PaperDetailHost;
  node: CitationGraphNode;
  direction: RelationshipViewDirection;
  /** The current provider works, re-read on every refresh. */
  readSnapshot(refreshing?: boolean): RelationshipViewSnapshot;
  /** Fetch new relationships from the providers; the host owns side effects. */
  refreshRelationships(signal: CancellationSignal): Promise<void>;
  /** After a manual relation is added or removed through the picker. */
  onManualChange?(changes: ManualRelationshipChange[]): void;
  /** The tab row to update after an update changes the counts. */
  updateCounts?(node: CitationGraphNode): void;
}
export interface RelationshipList {
  root: HTMLElement;
  refresh(): void;
  destroy(): void;
}
export function createRelationshipList(
  document,
  options: RelationshipListOptions,
): RelationshipList;
export const RELATIONSHIP_CARD_BATCH_SIZE = 36;
```

- [ ] **Step 1: Append the list builder**

This is `showRelationList` (`graphViewService.ts:3222-3595`) and
`renderRelations` (`itemPaneService.ts:1152-1405`) as one. Add these imports
at the top of the file:

```ts
import type { CancellationSignal } from "./cancellationScope";
import { createCancellationScope } from "./cancellationScope";
import {
  createManualRelationshipPicker,
  type ManualRelationshipChange,
} from "./manualRelationshipPickerService";
import {
  createPaperListToolbar,
  describeExternalWork,
  type PaperListDescriptor,
} from "./paperListViewService";
import {
  newlyRetrievedRelationshipWorkCount,
  relationshipStatusText,
  type RelationshipViewSnapshot,
} from "./relationshipViewService";
import { createUpdateProgress } from "./updateProgressService";
import { icon } from "./graphViewControls";
```

(merge into the existing import statements from the same modules). Then:

```ts
/* --------------------------------------------------------- relationships */

export const RELATIONSHIP_CARD_BATCH_SIZE = 36;
const RELATIONSHIP_FILTER_DEBOUNCE_MS = 120;

export interface RelationshipListOptions {
  host: PaperDetailHost;
  node: CitationGraphNode;
  direction: RelationshipViewDirection;
  readSnapshot(refreshing?: boolean): RelationshipViewSnapshot;
  refreshRelationships(signal: CancellationSignal): Promise<void>;
  onManualChange?(changes: ManualRelationshipChange[]): void;
  updateCounts?(node: CitationGraphNode): void;
}

export interface RelationshipList {
  root: HTMLElement;
  refresh(): void;
  destroy(): void;
}

export function createRelationshipList(
  document: Document,
  options: RelationshipListOptions,
): RelationshipList {
  const { host, node, direction } = options;
  const libraryID = host.snapshot.libraryID;
  const root = element(document, "div", "cm-relationship-list");
  const listHost = element(document, "div");
  const win = document.defaultView;

  let relationshipSnapshot = options.readSnapshot();
  let works = relationshipSnapshot.works;
  let updating = false;
  let updateOutcome: string | null = null;
  let shownCount = works.length;
  let filtered = false;
  let renderGeneration = 0;
  let destroyed = false;
  let descriptorCache = new Map<ExternalWork, PaperListDescriptor>();
  let renderList = (): void => undefined;

  let filterTimer = 0;
  const scheduleRender = (): void => {
    if (filterTimer) win?.clearTimeout(filterTimer);
    filterTimer =
      win?.setTimeout(() => {
        filterTimer = 0;
        if (!destroyed && listHost.isConnected) renderList();
      }, RELATIONSHIP_FILTER_DEBOUNCE_MS) ?? 0;
  };

  const controls = element(document, "div", "cm-relationship-controls");
  const toolbar = createPaperListToolbar({
    document,
    searchPlaceholder:
      direction === "references" ? "Search references" : "Search citing papers",
    collections: host.snapshot.collections,
    buttonClassName: "cm-secondary-button",
    inputClassName: "cm-search",
    onChange: scheduleRender,
  });
  toolbar.searchInput.style.maxWidth = "none";

  const updateLabel =
    direction === "references"
      ? "Update reference papers"
      : "Update citing papers";
  const update = button(
    document,
    "",
    "cm-secondary-button cm-icon-button",
    updateLabel,
  );
  update.setAttribute("aria-label", updateLabel);
  update.appendChild(icon(document, "refresh"));
  const publicationActive = (): boolean =>
    publicationStateFor(libraryID, node, direction)?.active ?? false;
  update.disabled = publicationActive();

  const currentRelatedItemKeys = (): Set<string> =>
    new Set(
      works
        .map((work) => work.inLibraryItemKey ?? work.zoteroItemKey ?? null)
        .filter((key): key is string => Boolean(key)),
    );
  const picker =
    node.kind === "external" || node.itemID <= 0
      ? null
      : createManualRelationshipPicker({
          document,
          snapshot: host.snapshot,
          subjectItemKey: node.itemKey,
          direction: direction === "references" ? "reference" : "cited-by",
          getAlreadyRelatedItemKeys: currentRelatedItemKeys,
          buttonClassName: "cm-secondary-button",
          inputClassName: "cm-search",
          onApplied: (changes) => {
            options.onManualChange?.(changes);
            refresh();
          },
        });
  controls.append(toolbar.root, update);
  if (picker) controls.appendChild(picker.button);
  root.appendChild(controls);
  if (picker) root.appendChild(picker.overlay);

  const status = text(document, "p", "", "cm-detail-meta");
  const updateStatus = (): void => {
    const base = relationshipStatusText(
      relationshipSnapshot,
      shownCount,
      filtered,
      updating || publicationActive(),
    );
    status.textContent = updateOutcome ? `${base} · ${updateOutcome}` : base;
  };
  root.append(status, listHost);

  renderList = (): void => {
    const generation = ++renderGeneration;
    clear(listHost);
    const context = relationshipContextFor(libraryID, node, direction, refresh);
    const entries = relationshipEntries(libraryID, context, works);
    const ordered = toolbar.apply(entries, (entry) => {
      const cached = descriptorCache.get(entry.work);
      if (cached) return cached;
      const descriptor = describeExternalWork(
        entry.work,
        libraryID,
        true,
        Boolean(entry.manualRelation),
        localPaperByKey(host.snapshot),
      );
      descriptorCache.set(entry.work, descriptor);
      return descriptor;
    });
    filtered = toolbar.hasActiveQueryOrFilters();
    if (!ordered.length) {
      shownCount = 0;
      updateStatus();
      listHost.appendChild(
        text(document, "p", "No external works were found.", "cm-placeholder"),
      );
      return;
    }
    const list = element(document, "div", "cm-external-list");
    const loadMore = button(document, "", "cm-secondary-button");
    loadMore.style.margin = "10px auto";
    loadMore.style.display = "block";
    let index = 0;
    const appendNextBatch = (): void => {
      if (generation !== renderGeneration || !list.isConnected) return;
      const batch = ordered.slice(index, index + RELATIONSHIP_CARD_BATCH_SIZE);
      appendRelatedWorkRows(document, list, batch, host, context);
      index += batch.length;
      shownCount = index;
      updateStatus();
      const remaining = ordered.length - index;
      if (remaining <= 0) {
        loadMore.remove();
        return;
      }
      loadMore.textContent = `Show ${Math.min(RELATIONSHIP_CARD_BATCH_SIZE, remaining)} more`;
    };
    loadMore.addEventListener("click", appendNextBatch);
    listHost.append(list, loadMore);
    appendNextBatch();
  };

  function refresh(): void {
    if (destroyed) return;
    relationshipSnapshot = options.readSnapshot(true);
    works = relationshipSnapshot.works;
    descriptorCache = new Map();
    update.disabled = updating || publicationActive();
    options.updateCounts?.(node);
    renderList();
  }

  update.addEventListener("click", () => {
    if (update.disabled) return;
    const scope = createCancellationScope(
      `${direction} relationship update for ${node.itemKey}`,
    );
    update.disabled = true;
    updating = true;
    updateOutcome = null;
    updateStatus();
    const cancelUpdate = (): void => {
      scope.cancel();
      updating = false;
      updateOutcome = "Update cancelled";
      if (update.isConnected) update.disabled = false;
      updateStatus();
    };
    const progress = createUpdateProgress({
      document,
      title: updateLabel,
      message: "Checking provider pages for new relationships…",
      onCancel: cancelUpdate,
    });
    void (async () => {
      const previousWorks = works;
      try {
        await options.refreshRelationships(scope.signal);
        if (scope.signal.cancelled) {
          updateOutcome = "Update cancelled";
          progress.dismiss();
          return;
        }
        relationshipSnapshot = options.readSnapshot();
        works = relationshipSnapshot.works;
        descriptorCache = new Map();
        const added = newlyRetrievedRelationshipWorkCount(previousWorks, works);
        updateOutcome = added
          ? `${added} new paper${added === 1 ? "" : "s"} added`
          : "No new papers returned";
        progress.finish(updateOutcome);
      } catch (error) {
        if (scope.signal.cancelled) {
          updateOutcome = "Update cancelled";
          progress.dismiss();
          return;
        }
        updateOutcome = "Update failed";
        progress.fail(updateOutcome);
        Zotero.logError(
          error instanceof Error ? error : new Error(String(error)),
        );
      } finally {
        updating = false;
        update.disabled = publicationActive();
        options.updateCounts?.(node);
        if (!destroyed) renderList();
      }
    })();
  });

  renderList();
  return {
    root,
    refresh,
    destroy() {
      destroyed = true;
      if (filterTimer) win?.clearTimeout(filterTimer);
      toolbar.destroy();
      picker?.destroy();
    },
  };
}
```

- [ ] **Step 2: Style the controls row and the icon button**

Append to `addon/content/paperDetail.css`, replacing the inline styles both
hosts set on these today:

```css
/* Search, refresh, add — one row, the search taking what the two 30px
 * buttons leave. */
.cm-relationship-controls {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 30px 30px;
  gap: 6px;
  align-items: center;
  margin: 7px 0 2px;
}
.meristema-paper-detail .cm-icon-button {
  width: 30px;
  min-width: 30px;
  padding: 4px;
  justify-content: center;
}
```

- [ ] **Step 3: Verify and commit**

```bash
npx prettier --write src/services/paperDetailView.ts addon/content/paperDetail.css
npx eslint src/services/paperDetailView.ts
npm run typecheck
git add src/services/paperDetailView.ts addon/content/paperDetail.css
git commit -m "Build the relationship list — toolbar, status, rows and update — once"
```

---

## Task 5: The graph becomes a host

**Files:**

- Modify: `src/services/graphViewService.ts`

Read the whole of the current `appendPaperHeader` (2431-2490), `renderOverview`
(3598-3900), `showRelationList` (3222-3595), `appendExternalWorkCards`
(2753-3090), `loadInlineSimilarResults` (3096-3150) and the helpers at 293-420
before editing. The list below says what replaces each.

- [ ] **Step 1: Define the graph host and the tab handle**

Inside `createGraphViewController`, after `selectedNode` is declared (~458):

```ts
let detailTabs: ReturnType<typeof createDetailTabs> | null = null;

const graphHost: PaperDetailHost = {
  origin: "graph",
  snapshot,
  collectionChooser: true,
  showInZotero: (itemKey) => {
    const paper = paperByKey.get(itemKey);
    if (paper) void selectPaper(paper.itemID);
  },
  rowActions: (work) => {
    const focusNode = focusNodeForWork(work);
    const actions: RowAction[] = [
      {
        label: "Explore from this paper",
        run: () => {
          focusOnPaper(focusNode);
        },
      },
    ];
    if (focusProjection && !focusProjection.seedKeys.has(focusNode.key)) {
      actions.push({
        label: "Add as seed",
        title:
          "Add this paper to the current Explore view without adding it to Zotero.",
        run: () => {
          addFocusSeed(focusNode);
        },
      });
    }
    return actions;
  },
  previewRow: (work, context) => {
    const sourceKeys = context
      ? relationshipPreviewSourceKeys(model, context.node, work, visibleKeys)
      : (work.citingNodeKeys ?? []).filter((key) => visibleKeys.has(key));
    if (!sourceKeys.length) return null;
    return () =>
      renderer?.setGhostPreview({
        key: work.providerWorkID ?? work.doi ?? work.title ?? "external",
        title: externalWorkTitle(work),
        authors: work.authors ?? [],
        year: work.year,
        citationCount: work.citationCount ?? null,
        referenceCount: work.referenceCount ?? null,
        sourceKeys,
      });
  },
  clearPreview: () => renderer?.setGhostPreview(null),
  onRelationshipMutation: (event) => {
    applyRelationshipMutationToGraph(event);
    notifyRelationshipMutation(event);
  },
};
```

`snapshot` here is the controller's `LibrarySnapshot`. If the graph reassigns
it on refresh, make `snapshot` a getter on the host object instead of a field
(`get snapshot() { return snapshot; }`) so rows built later see the new one.
Check with `grep -n "snapshot = " src/services/graphViewService.ts`.

`visibleKeys`: confirm the name of the set the old `appendExternalWorkCards`
read (`grep -n "visibleKeys" src/services/graphViewService.ts`). If it is a
function or a getter, call it.

- [ ] **Step 2: Rewrite `appendPaperHeader`**

Replace the tabs block (from `const tabs = element(document, "div",
"cm-detail-tabs")` to `setDetailNav(tabs)`) with:

```ts
detailTabs = createDetailTabs(document, {
  node,
  libraryID: snapshot.libraryID,
  active: activeMode,
  onSelect: (tab) => {
    if (tab === "overview") renderOverview(node);
    else showRelationList(node, tab);
  },
});
setDetailNav(detailTabs.root);
```

Replace the badges block with:

```ts
const badges = createBadges(document, node);
if (badges) detailHeader.appendChild(badges);
```

Delete `interface DetailTabLabel`, `relationshipTabLabel`, `applyTabLabel`
and `updateRelationshipTabLabels` (2343-2392). Replace each remaining call to
`updateRelationshipTabLabels(node)` with `detailTabs?.updateCounts(node)`.

- [ ] **Step 3: Rewrite `renderOverview`'s metrics and similar section**

Replace the block from `const rows = element(document, "dl", "cm-metric-strip
cm-metric-list")` to the `detailSection(rows)` append (the headline strip and
its empty state), and the `detailBody.appendChild(advancedMetrics(...))`
further down, with one line right after `appendPaperHeader(node, "overview")`:

```ts
detailBody.appendChild(createOverviewMetrics(document, node));
```

Keep the external-node action row and the local-node "Find similar papers"
button as they are, except that they now feed a shared section. Replace
`inlineSimilarResults`, `ensureInlineSimilarResults` and
`loadInlineSimilarResults` with:

```ts
let similarSection: ReturnType<typeof createSimilarSection> | null = null;
const loadInlineSimilarResults = (
  seedNodes: CitationGraphNode[],
): Promise<void> => {
  if (!similarSection?.root.isConnected) {
    similarSection = createSimilarSection(document, graphHost, () =>
      getMissingPaperRecommendations(
        seedNodes,
        model.nodes,
        50,
        seedNodes.length <= 1 ? 1 : 2,
      ),
    );
    similarSection.root.style.marginTop = "10px";
    detailBody.appendChild(similarSection.root);
  }
  return similarSection.start();
};
```

Where `renderOverview` and `showRelationList` used to set `inlineSimilarResults
= null` and bump `similarRequestGeneration`, set `similarSection = null`.
`showGraphSimilarResults` keeps `similarRequestGeneration` for its own
generation check; leave that variable if it still has a reader, else delete it.

In `showGraphSimilarResults`, replace `appendExternalWorkCards(works, undefined,
results)` with:

```ts
const list = element(document, "div", "cm-external-list");
appendRelatedWorkRows(
  document,
  list,
  works.map((work, providerOrder) => ({
    work,
    manualRelation: null,
    ignoredRelation: null,
    providerOrder,
  })),
  graphHost,
);
results.appendChild(list);
```

and its `appendExternalWorkCards([], ...)` empty path with the placeholder
paragraph `No external works were found.` in `cm-placeholder`.

The external-node import in `renderOverview` (the `Add to Zotero` /
`importArea` block, ~3690-3750) becomes:

```ts
const importArea = createImportArea(document, work, graphHost, (imported) => {
  if (node.externalWork)
    node.externalWork.inLibraryItemKey = String(imported.key);
  const show = button(document, "Show in Zotero", "cm-secondary-button");
  show.addEventListener("click", () => void selectPaper(imported.id));
  actions.prepend(show);
});
actions.appendChild(importArea.addButton);
detailBody.appendChild(importArea.root);
```

(`button` is the helper exported from `paperDetailView.ts`.)

- [ ] **Step 4: Rewrite `showRelationList`**

Replace the whole function body after the first four lines (the ones that set
`activeRelationshipView`, clear the preview, and clear the body) with:

```ts
appendPaperHeader(node, direction);
activeRelationshipList?.destroy();
const list = createRelationshipList(document, {
  host: graphHost,
  node,
  direction,
  readSnapshot: () =>
    getRelationshipViewSnapshot(
      model,
      node,
      direction,
      snapshot.libraryID,
      RELATIONSHIP_VIEW_LIMIT,
    ),
  refreshRelationships: async (signal) => {
    await refreshExternalRelationships(node, model.nodes, direction, {
      maximum: RELATIONSHIP_VIEW_LIMIT,
      refreshMembership: true,
      silent: true,
      mode: "manual",
      queueBackgroundHydration: true,
      signal,
      onMembershipResolved: (resolution) => {
        if (resolution.reportedCount === null) return;
        if (direction === "references")
          node.referenceCount = resolution.reportedCount;
        else node.citationCount = resolution.reportedCount;
      },
    });
    if (signal.cancelled) return;
    if (focusProjection?.seedKeys.has(node.key)) {
      const works = getRelationshipViewSnapshot(
        model,
        node,
        direction,
        snapshot.libraryID,
        RELATIONSHIP_VIEW_LIMIT,
      ).works;
      const relationships = ensureFocusRelationships(node);
      if (direction === "references") relationships.references = works;
      else relationships.citedBy = works;
      cacheFocusRelationships(node.key, relationships);
      rebuildCurrentFocus();
    }
  },
  onManualChange: (changes) => {
    if (!changes.length) return;
    invalidateCitationGraphSnapshot(snapshot.libraryID);
    invalidateFocusRelationshipFragment(snapshot.libraryID, node.key);
    replaceLibraryGraph(buildCitationGraph(snapshot));
    renderer?.setLayout(renderer.getLayout());
    updateSummary();
  },
  updateCounts: (current) => detailTabs?.updateCounts(current),
});
activeRelationshipList = list;
detailBody.appendChild(list.root);
refreshActiveRelationshipView = (): void => {
  if (
    cleaned ||
    activeRelationshipView?.itemKey !== node.itemKey ||
    activeRelationshipView.direction !== direction
  )
    return;
  list.refresh();
};
```

Declare `let activeRelationshipList: RelationshipList | null = null;` beside
`refreshActiveRelationshipView`, and call `activeRelationshipList?.destroy();
activeRelationshipList = null;` wherever `refreshActiveRelationshipView` is set
to `null` (in `renderOverview` and `showGraphSimilarResults`) and in the
controller's cleanup.

The old `refreshActiveRelationshipView` passed `{ queueBackgroundHydration:
false }` to `getRelationshipViewSnapshot`. The list calls
`readSnapshot(true)` from `refresh()`, so honour the flag:

```ts
      readSnapshot: (refreshing) =>
        getRelationshipViewSnapshot(
          model,
          node,
          direction,
          snapshot.libraryID,
          RELATIONSHIP_VIEW_LIMIT,
          refreshing ? { queueBackgroundHydration: false } : undefined,
        ),
```

- [ ] **Step 5: Delete what the module replaced**

Remove from `graphViewService.ts`: `referenceMatchesGraphNode`,
`ignoredRelationDescriptorForExternalWork`, `ignoredRelationForExternalWork`,
`createCollectionChooser`, `advancedMetrics`, `appendExternalWorkCards`, the
`detailSection` closure (use the exported one), and `RELATIONSHIP_CARD_BATCH_SIZE`
/ `RELATIONSHIP_FILTER_DEBOUNCE_MS` if nothing else reads them. Then delete the
imports that ESLint now flags as unused. Add the imports from
`./paperDetailView`:

```ts
import {
  appendRelatedWorkRows,
  button,
  createBadges,
  createDetailTabs,
  createImportArea,
  createOverviewMetrics,
  createRelationshipList,
  createSimilarSection,
  detailSection,
  type PaperDetailHost,
  type RelationshipList,
  type RowAction,
} from "./paperDetailView";
```

- [ ] **Step 6: Verify in the running graph**

```bash
npx prettier --write src/services/graphViewService.ts
npx eslint src/services/graphViewService.ts
npm run typecheck
npm run test:unit
```

Then in Zotero, on a Collection Graph: select a paper; Overview shows the
strip and Advanced; Cited by lists rows with Show in Zotero / Add to Zotero /
Explore / Mark incorrect; Mark incorrect greys the edge on the plot and adds
the badge; Restore removes it; the refresh button runs the update with its
progress dialog; the picker adds a manual relation and the row appears at the
top with a Manual badge and Remove manual relation; clicking a row ghosts it
on the plot; Find similar papers fills the section. On an Explore view, an
external node's Overview still has its action row and Add to Zotero opens the
chooser.

- [ ] **Step 7: Commit**

```bash
git add src/services/graphViewService.ts
git commit -m "Draw the graph's detail pane from the shared paper detail view"
```

---

## Task 6: The item pane becomes a host

**Files:**

- Modify: `src/services/itemPaneService.ts`
- Modify: `src/services/paperOverviewActionsService.ts`
- Modify: `addon/content/zoteroPane.css`

- [ ] **Step 1: Trim the overview action bar**

In `paperOverviewActionsService.ts`, remove `doi`, `onShowInZotero`,
`showInZoteroButton` and `openDOIButton` from the two interfaces, and delete
the code that builds those two buttons. `getOpenInActions` becomes required.
The result:

```ts
export interface PaperOverviewActionOptions {
  document: Document;
  actionsClass: string;
  primaryButtonClass: string;
  secondaryButtonClass?: string;
  getOpenInActions: () => readonly PaperOverviewOpenInAction[];
  onSimilar: Action;
  onRefresh: Action;
}

export interface PaperOverviewActionBar {
  root: HTMLDivElement;
  openInButton: HTMLButtonElement;
  similarButton: HTMLButtonElement;
  refreshButton: HTMLButtonElement;
}
```

Give the refresh button the class `cm-icon-button` alongside
`secondaryButtonClass` and drop its four inline width/padding styles; the
stylesheet from Task 4 sets them. Check for any other caller with
`grep -rn "createPaperOverviewActionBar" src` — the item pane is the only one.

- [ ] **Step 2: Rewrite the item pane's rendering**

In `itemPaneService.ts`, delete `createTabs`, `renderOverviewSimilarResults`,
`renderOverview`, `relationKey`, `ignoredRelationDescriptor`,
`ignoredRelationForWork`, `manualWorkForItemKey`, `manualRelationsForItem`,
`RelationEntry`, `relationEntriesForWorks`, `renderRelationCard`,
`renderRelations`, `referenceMatchesNode`, `externalWorkTitle`, `row`,
`count` and `configureIconButton`. Keep `renderMatchConfirmation` but change
its class names: the section `meristema-match-warning` stays, the buttons
take `cm-primary-button` (Confirm match) and `cm-secondary-button` (Use this
match), the candidate card stays `meristema-candidate`, and the secondary text
takes `cm-detail-meta`.

Add these functions:

```ts
function itemPaneHost(
  document: Document,
  snapshot: LibrarySnapshot,
): PaperDetailHost {
  return {
    origin: "item-pane",
    snapshot,
    collectionChooser: false,
    showInZotero: (itemKey) => {
      const related = itemByKey(snapshot.libraryID, itemKey);
      if (related) Zotero.getActiveZoteroPane?.()?.selectItem?.(related.id);
    },
    onRelationshipMutation: (event) => notifyRelationshipMutation(event),
  };
}

function renderOverview(
  document: Document,
  container: HTMLElement,
  item: Zotero.Item,
  host: PaperDetailHost,
  rerender: () => void,
): void {
  const node = createMetricNodeForItem(item);
  renderMatchConfirmation(document, container, item, rerender);
  const badges = createBadges(document, node);
  if (badges) container.appendChild(detailSection(document, badges));
  container.appendChild(createOverviewMetrics(document, node));

  void ensureSourceMetricsForNodes([node])
    .then((updated) => {
      if (updated > 0 && container.isConnected) rerender();
    })
    .catch((error: unknown) => {
      Zotero.logError(
        error instanceof Error ? error : new Error(String(error)),
      );
    });

  const similar = createSimilarSection(document, host, async () => {
    const { node: selected, graph } = await graphNodeForItem(item);
    return getMissingPaperRecommendations([selected], graph.nodes, 50, 2);
  });
  const actions = createPaperOverviewActionBar({
    document,
    actionsClass: "cm-detail-actions",
    primaryButtonClass: "cm-primary-button",
    secondaryButtonClass: "cm-secondary-button",
    getOpenInActions: () => openInActionsFor(document, item),
    onSimilar: () => similar.start(),
    onRefresh: async () => {
      await updateCitationDataForItems([item], {
        force: false,
        progressDocument: document,
      });
      rerender();
    },
  });
  container.append(detailSection(document, actions.root), similar.root);
}
```

`openInActionsFor(document, item)` is the current `getOpenInActions` closure
body from `itemPaneService.ts:695-728`, lifted into a function that returns the
array.

Rewrite `renderPane`:

```ts
function renderPane(
  document: Document,
  body: HTMLElement,
  item: Zotero.Item,
  setSectionSummary?: (summary: string) => void,
): void {
  const itemKey = String(item.key);
  const libraryID = Number(item.libraryID);
  const previousState = paneTabState.get(body);
  let active: DetailTab =
    previousState?.itemKey === itemKey ? previousState.active : "overview";
  paneTabState.set(body, { itemKey, active });
  activeLists.get(body)?.destroy();
  activeLists.delete(body);

  const render = (): void => {
    setSectionSummary?.(summaryForItem(item));
    activeLists.get(body)?.destroy();
    activeLists.delete(body);
    clear(body);
    const shell = el(
      document,
      "div",
      "meristema-paper-detail meristema-item-pane",
    );
    const content = el(document, "div", "meristema-pane-content");
    const node = createMetricNodeForItem(item);
    const tabs = createDetailTabs(document, {
      node,
      libraryID,
      active,
      onSelect: (tab) => {
        active = tab;
        paneTabState.set(body, { itemKey, active });
        render();
      },
    });
    shell.append(tabs.root, content);
    body.appendChild(shell);

    void relationshipLibrarySnapshot(libraryID)
      .then((snapshot) => {
        if (!content.isConnected) return;
        const host = itemPaneHost(document, snapshot);
        if (active === "overview") {
          renderOverview(document, content, item, host, render);
          return;
        }
        const graph = getCachedCitationGraph(libraryID);
        const libraryWorks = graph?.nodes ?? snapshot.papers;
        const direction = active;
        const list = createRelationshipList(document, {
          host,
          node,
          direction,
          readSnapshot: () =>
            graph
              ? getRelationshipViewSnapshot(
                  graph,
                  node,
                  direction,
                  libraryID,
                  RELATION_LIMIT,
                )
              : getRelationshipViewSnapshotFromWorks(
                  node,
                  direction,
                  libraryID,
                  libraryWorks,
                  direction === "references" ? node.references : [],
                  RELATION_LIMIT,
                ),
          refreshRelationships: (signal) =>
            refreshExternalRelationships(node, libraryWorks, direction, {
              maximum: RELATIONSHIP_VIEW_LIMIT,
              refreshMembership: true,
              silent: true,
              mode: "manual",
              queueBackgroundHydration: true,
              signal,
            }).then(() => undefined),
          onManualChange: () => void refreshOpenGraphViews(),
          updateCounts: (current) => tabs.updateCounts(current),
        });
        activeLists.set(body, list);
        content.appendChild(list.root);
      })
      .catch((error: unknown) => {
        if (content.isConnected) {
          clear(content);
          content.appendChild(
            text(
              document,
              "p",
              "Unable to load relationships.",
              "cm-placeholder",
            ),
          );
        }
        Zotero.logError(
          error instanceof Error ? error : new Error(String(error)),
        );
      });
    if (active !== "overview") {
      content.appendChild(text(document, "p", "Loading…", "cm-placeholder"));
    }
  };
  render();
}
```

Declare `const activeLists = new WeakMap<HTMLElement, RelationshipList>();`
beside `paneTabState`, change `PaneTabState.active` to `DetailTab`, and in
`onDestroy` add `activeLists.get(body)?.destroy(); activeLists.delete(body);`.
The Overview tab used to render synchronously; it now waits for the cached
library snapshot, which resolves at once after the first load. If the first
paint flickers, render the overview synchronously with a host built from
`{ libraryID, papers: [], collections: [] }`-shaped snapshot — but only if the
flicker is visible; do not pre-empt it.

`node.references` — check `CitationGraphNode` has that field
(`grep -n "references" src/domain/graphTypes.ts`); the old code read it, so
it should.

Replace the `text` helper: import `clear`, `text` from `./graphViewControls`
and delete the local `txt` and `clear`. Import from `./paperDetailView`:

```ts
import {
  createBadges,
  createDetailTabs,
  createOverviewMetrics,
  createRelationshipList,
  createSimilarSection,
  detailSection,
  type PaperDetailHost,
  type RelationshipList,
} from "./paperDetailView";
import type { DetailTab } from "./paperDetailModel";
```

Delete the imports ESLint reports unused.

- [ ] **Step 3: Cut zoteroPane.css to what only the section needs**

Replace the file with:

```css
.meristema-column-warning {
  color: #dc2626;
  font-weight: 700;
}
/*
 * The section's shell. The detail rules come from paperDetail.css; this is
 * only the padding the rows' negative margins assume (8px each side, as the
 * graph's `.cm-detail-body` gives them) and the gap under the tab row.
 */
.meristema-item-pane {
  display: grid;
  gap: 4px;
  padding: 4px 8px 12px;
}
.meristema-item-pane .cm-detail-tabs {
  margin-bottom: 4px;
}
/* The match-confirmation block: amber, like the "Match needs confirmation"
 * badge, on the raised surface. */
.meristema-match-warning {
  display: grid;
  gap: 6px;
  padding: 9px;
  border: 1px solid color-mix(in srgb, #b45309 60%, var(--cm-border));
  border-radius: 7px;
  background: color-mix(in srgb, #f59e0b 9%, Canvas);
  line-height: 1.4;
}
.meristema-match-warning p {
  margin: 0;
}
.meristema-candidate {
  display: grid;
  gap: 4px;
  padding: 7px;
  border: 1px solid var(--cm-border-soft);
  border-radius: 6px;
  background: var(--cm-surface-raised);
}
.meristema-candidate-title {
  font-weight: 600;
}
/* Zotero's item pane is narrower than the graph's default pane: drop the
 * counts under 320px the way the graph's container query does. */
@container (max-width: 320px) {
  .meristema-item-pane .cm-detail-tab-count {
    display: none;
  }
}
.meristema-item-pane {
  container-type: inline-size;
}
```

- [ ] **Step 4: Verify in the item pane**

```bash
npx prettier --write src/services/itemPaneService.ts src/services/paperOverviewActionsService.ts addon/content/zoteroPane.css
npx eslint src/services/itemPaneService.ts src/services/paperOverviewActionsService.ts
npm run typecheck
npm run test:unit
```

In Zotero's library: select a paper with citation data; click the network icon
in the sidenav. Overview shows badges, the strip, Advanced, then Open in › /
Similar / refresh; Similar fills the section; Open in › lists graph targets.
Cited by lists rows; Mark incorrect and Restore work and the badge follows;
the refresh runs the update; the picker adds a manual relation that shows at
the top with Manual and Remove manual relation. Narrow the item pane to its
minimum: the tab names stay whole and the counts drop. Switch Zotero to dark
mode and check both tabs again. Select an item with no citation data: the
section is disabled as before.

With a Collection Graph open in another tab showing the same paper's Cited
by list: mark a relation incorrect in the item pane, switch to the graph tab,
and confirm the row carries the Ignored badge and the edge is greyed. Do the
reverse from the graph and confirm the item pane list refreshed.

- [ ] **Step 5: Commit**

```bash
git add src/services/itemPaneService.ts src/services/paperOverviewActionsService.ts addon/content/zoteroPane.css
git commit -m "Draw the item pane section from the shared paper detail view"
```

---

## Task 7: Whole-suite verification and closing the spec

**Files:**

- Modify: `docs/superpowers/specs/2026-09-04-shared-paper-detail-view-design.md`

- [ ] **Step 1: Full checks**

```bash
npm run check
npm test
```

Expected: `check` clean; `test` passes, including
`test/zotero/graphViewVisual.test.ts`. If the visual test compares against
stored images and the only difference is the moved stylesheet resolving
identically, it passes; a real difference means a rule was dropped in Task 2 —
diff `paperDetail.css` + `graph.css` against `git show 88590a3:addon/content/graph.css`
selector by selector.

- [ ] **Step 2: Dead code sweep**

```bash
npx eslint . --rule '{"@typescript-eslint/no-unused-vars":"error"}'
grep -rn "meristema-pane-\|meristema-relation-\|meristema-secondary-text\|meristema-primary-button\|meristema-data-details" src addon
```

Expected: no matches from the grep; ESLint clean.

- [ ] **Step 3: Mark the spec implemented and commit**

Change `Status: approved` to `Status: implemented` in the spec.

```bash
git add docs/superpowers/specs/2026-09-04-shared-paper-detail-view-design.md
git commit -m "Mark the shared paper detail view design as implemented"
```
