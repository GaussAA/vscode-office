/**
 * Request bookkeeping for a webview that asks the host a question and may hear the answer late,
 * out of order, or after it stopped caring. No React, no `vscode`, no timers: a view keeps an
 * instance in a stable place (a ref) and asks it three things: which id to send, whether a
 * reply is still wanted, and which request the host must be told to stop.
 *
 * Two shapes cover every view that does this:
 *
 *  - {@link RequestGuard}: one question at a time, newest wins (profile, column scan, compare,
 *    the selected entry, a search). Issuing a request is what makes the previous one stale.
 *  - {@link PendingRequests}: several questions in flight that all still matter (index windows,
 *    record windows). Each one carries a tag the reply needs, and a reply is claimed once.
 *
 * Ids start at 1 and only grow for the life of the instance; an id is never handed out twice,
 * not even across `cancel()` or `clear()`. A reply that names an id the guard has moved past can
 * therefore never match a later request.
 *
 * What stays in the view: the transport (`handler.emit`), the state a reply writes, debounce
 * timers (owned by an effect's cleanup) and the decision of *when* a document has changed. The
 * guard answers only the id questions. In particular a view must call `cancel()` / `clear()`
 * itself when its document changes: the guard cannot see that, and a reply for the old document
 * is current until someone says otherwise.
 */

export class RequestGuard {
  private latest = 0;
  /** False before the first request and after `cancel()`: no reply is wanted. */
  private live = false;
  /** True once the final reply for the current request has been seen. */
  private settled = true;

  /** Start a request. Every earlier request becomes stale. */
  issue(): number {
    this.latest += 1;
    this.live = true;
    this.settled = false;
    return this.latest;
  }

  /** Is this reply for the request the view is still waiting on? Does not consume it. */
  isCurrent(id: number): boolean {
    return this.live && id === this.latest;
  }

  /**
   * Mark the current request finished (the last batch of a streamed reply). Returns whether
   * `id` was the current request. Replies for the same id stay current afterwards; only a later
   * `cancel()` changes, because there is no longer anything on the host to stop.
   */
  settle(id: number): boolean {
    if (!this.isCurrent(id)) return false;
    this.settled = true;
    return true;
  }

  /**
   * Stop wanting the current request, whatever the reason: a newer search replaces it, the
   * panel closed, the document changed. Every reply issued so far becomes stale.
   *
   * Returns the id the host may still be working on, or `null` when nothing was in flight. The
   * view sends its cancel message only for a non-null id: ignoring a reply is not the same as
   * stopping a scan that would otherwise run to the end unread.
   */
  cancel(): number | null {
    const pending = this.live && !this.settled ? this.latest : null;
    this.live = false;
    this.settled = true;
    return pending;
  }
}

/** What a claimed reply is allowed to do. */
export interface TakenRequest<T> {
  tag: T;
  /** No request has been issued since this one, so its reply is authoritative. */
  newest: boolean;
}

export class PendingRequests<T = void> {
  private latest = 0;
  private readonly waiting = new Map<number, { tag: T }>();

  /** Start a request and remember what its reply is allowed to do. */
  issue(tag: T): number {
    this.latest += 1;
    this.waiting.set(this.latest, { tag });
    return this.latest;
  }

  /**
   * Claim a reply. Returns `undefined` for an id nobody is waiting for (unknown, already
   * claimed, or dropped by `clear()`); otherwise the request's tag and whether it was the newest.
   */
  take(id: number): TakenRequest<T> | undefined {
    const entry = this.waiting.get(id);
    if (!entry) return undefined;
    this.waiting.delete(id);
    return { tag: entry.tag, newest: id === this.latest };
  }

  /** Forget every request in flight (a new document): their replies are no longer wanted. */
  clear(): void {
    this.waiting.clear();
  }
}
