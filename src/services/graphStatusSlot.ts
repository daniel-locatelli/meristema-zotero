/**
 * The toolbar's one status slot, as data (D15).
 *
 * The slot carries two kinds of message: a sticky notice that must stay up
 * (the read-only notice, the migration notice) and a transient confirmation
 * that must pass ("Copied", "Saved"). A transient shows over the sticky one
 * and, when it expires, the sticky one comes back: the one that was showing,
 * or one set while the transient was up. A null clears both.
 */

export interface StatusSlot {
  readonly sticky: string | null;
  readonly transient: string | null;
}

export const EMPTY_STATUS_SLOT: StatusSlot = { sticky: null, transient: null };

/** Posts a message to the slot; null or an empty message clears it. */
export function postStatus(
  slot: StatusSlot,
  message: string | null,
  options: { sticky?: boolean } = {},
): StatusSlot {
  if (!message) return EMPTY_STATUS_SLOT;
  return options.sticky
    ? { ...slot, sticky: message }
    : { ...slot, transient: message };
}

/** The transient message's time is up. */
export function expireTransient(slot: StatusSlot): StatusSlot {
  return { ...slot, transient: null };
}

/** What the toolbar shows: the transient over the sticky, or nothing. */
export function shownStatus(slot: StatusSlot): string | null {
  return slot.transient ?? slot.sticky;
}
