/**
 * When the seed-link check asks OpenAlex, and for what (ADR 0018). One per
 * Zotero window set: graphs register as clients, and the scheduler sends at
 * most one check at a time, for papers no graph has an answer for, none in
 * flight and none backing off. A rebuild per fill landing only marks it
 * dirty; collection happens at dispatch.
 */
import {
  createCancellationScope,
  type CancellationScope,
  type CancellationSignal,
} from "./cancellationScope";
import type { SeedLinkCheck } from "./graphSeedLinks";
import {
  checkPaperAliases,
  type CheckPaper,
  type ReferenceListRow,
} from "./openAlexReferenceLists";
import type { CheckOutcome } from "./openAlexSeedLinkService";

export interface SeedLinkCheckStore {
  lookup(alias: string): SeedLinkCheck | null | undefined;
  save(rows: readonly ReferenceListRow[]): Promise<void>;
}

export interface SeedLinkCheckClient {
  /** The papers this graph wants checked; empty outside the check's gate. */
  papers(): readonly CheckPaper[];
  /** A check stored an answer for one of this graph's papers. */
  landed(): void;
}

export interface SeedLinkCheckDeps {
  store: SeedLinkCheckStore;
  check(
    papers: readonly CheckPaper[],
    signal: CancellationSignal,
  ): Promise<CheckOutcome>;
  defer(run: () => void): void;
  now(): number;
}

export interface SeedLinkCheckScheduler {
  register(client: SeedLinkCheckClient): () => void;
  markDirty(): void;
}

/** As `failureRetryAt` in externalWorkCacheService.ts. */
export const CHECK_BACKOFF_MS: readonly number[] = [
  5 * 60000,
  30 * 60000,
  6 * 3600000,
  86400000,
];

export function createSeedLinkCheckScheduler(
  deps: SeedLinkCheckDeps,
): SeedLinkCheckScheduler {
  const clients = new Set<SeedLinkCheckClient>();
  const inFlight = new Set<string>();
  const backoff = new Map<string, { failures: number; until: number }>();
  let scope: CancellationScope | null = null;
  let dirty = false;
  let deferred = false;

  const blocked = (alias: string): boolean =>
    deps.store.lookup(alias) !== undefined ||
    inFlight.has(alias) ||
    (backoff.get(alias)?.until ?? 0) > deps.now();

  const collect = (): CheckPaper[] => {
    const chosen = new Map<string, CheckPaper>();
    for (const client of clients) {
      for (const paper of client.papers()) {
        const aliases = checkPaperAliases(paper);
        if (!aliases.length || aliases.some(blocked)) continue;
        if (aliases.some((alias) => chosen.has(alias))) continue;
        for (const alias of aliases) chosen.set(alias, paper);
      }
    }
    return [...new Set(chosen.values())];
  };

  const backOff = (paper: CheckPaper): void => {
    for (const alias of checkPaperAliases(paper)) {
      const failures = (backoff.get(alias)?.failures ?? 0) + 1;
      const delay =
        CHECK_BACKOFF_MS[Math.min(failures - 1, CHECK_BACKOFF_MS.length - 1)];
      backoff.set(alias, { failures, until: deps.now() + delay });
    }
  };

  const wants = (client: SeedLinkCheckClient, aliases: Set<string>): boolean =>
    client
      .papers()
      .some((paper) =>
        checkPaperAliases(paper).some((alias) => aliases.has(alias)),
      );

  const schedule = (): void => {
    if (deferred) return;
    deferred = true;
    deps.defer(() => {
      deferred = false;
      void dispatch();
    });
  };

  const dispatch = async (): Promise<void> => {
    if (scope) return;
    dirty = false;
    const papers = collect();
    if (!papers.length) return;
    const aliases = papers.flatMap(checkPaperAliases);
    for (const alias of aliases) inFlight.add(alias);
    const current = createCancellationScope("seed-link-check");
    scope = current;
    let saved: readonly ReferenceListRow[] = [];
    try {
      const outcome = await deps.check(papers, current.signal);
      if (!current.signal.cancelled) {
        if (outcome.rows.length) {
          await deps.store.save(outcome.rows);
          saved = outcome.rows;
        }
        for (const paper of outcome.failed) backOff(paper);
      }
    } catch {
      if (!current.signal.cancelled) for (const paper of papers) backOff(paper);
    } finally {
      for (const alias of aliases) inFlight.delete(alias);
      scope = null;
    }
    if (saved.length) {
      const savedAliases = new Set(saved.map((row) => row.identityKey));
      for (const client of [...clients]) {
        if (wants(client, savedAliases)) client.landed();
      }
    }
    if (dirty) schedule();
  };

  return {
    register(client) {
      clients.add(client);
      return () => {
        clients.delete(client);
        if (scope && ![...clients].some((other) => wants(other, inFlight))) {
          scope.cancel();
        }
      };
    },
    markDirty() {
      dirty = true;
      schedule();
    },
  };
}
