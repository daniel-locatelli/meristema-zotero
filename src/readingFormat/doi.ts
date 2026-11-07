// Meristema's normalizeDOI (`src/domain/workIdentity.ts` in meristema-zotero)
// with locale-independent lowercasing (`toLowerCase`, not `toLocaleLowerCase`,
// which maps `I` to a dotless `ı` under a Turkish locale); keep the two in step
// otherwise, since a paper id is built from it.
export function normalizeDOI(value: unknown): string | null {
  const text = String(value ?? "")
    .trim()
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")
    .replace(/^doi:\s*/i, "")
    .trim()
    .toLowerCase();
  const match = text.match(/10\.\d{4,9}\/[-._;()/:a-z0-9]+/i);
  return match ? match[0].replace(/[.,;]+$/, "").toLowerCase() : null;
}
