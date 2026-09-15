export interface CancellationSignal {
  readonly cancelled: boolean;
  subscribe(listener: () => void): () => void;
}

export interface CancellationScope {
  readonly label: string;
  readonly signal: CancellationSignal;
  cancel(): void;
}

class MutableCancellationSignal implements CancellationSignal {
  private listeners = new Set<() => void>();
  private requested = false;

  get cancelled(): boolean {
    return this.requested;
  }

  subscribe(listener: () => void): () => void {
    if (this.requested) {
      listener();
      return () => undefined;
    }
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  cancel(): void {
    if (this.requested) return;
    this.requested = true;
    const listeners = [...this.listeners];
    this.listeners.clear();
    for (const listener of listeners) {
      try {
        listener();
      } catch {
        // Cancellation is best-effort; one listener must not block the rest.
      }
    }
  }
}

export function createCancellationScope(label: string): CancellationScope {
  const signal = new MutableCancellationSignal();
  return {
    label,
    signal,
    cancel: () => signal.cancel(),
  };
}

export function cancellationRequested(
  signal?: CancellationSignal | null,
): boolean {
  return signal?.cancelled === true;
}

/**
 * Run `operation` under a scope that the timer, or the parent's cancel,
 * cancels. Resolves the operation's value, or null once `ms` has passed; the
 * timer cancels what it abandoned instead of leaving it retrying behind the
 * caller (B50). A rejection passes through.
 */
export async function withTimeoutScope<T>(
  operation: (signal: CancellationSignal) => Promise<T>,
  ms: number,
  parentSignal: CancellationSignal | undefined,
  onTimeout: () => void,
): Promise<T | null> {
  const scope = createCancellationScope("timeout");
  const unsubscribe = parentSignal?.subscribe(() => scope.cancel());
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      operation(scope.signal),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => {
          timer = null;
          scope.cancel();
          onTimeout();
          resolve(null);
        }, ms);
      }),
    ]);
  } finally {
    if (timer !== null) clearTimeout(timer);
    unsubscribe?.();
  }
}
