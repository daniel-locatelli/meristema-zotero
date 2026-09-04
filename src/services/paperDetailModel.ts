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
