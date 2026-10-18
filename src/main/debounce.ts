/** A small debounce with cancel/flush, used to throttle invoke() calls while a slider is being dragged. */
export interface Debounced<Args extends unknown[]> {
  (...args: Args): void;
  cancel(): void;
  flush(): void;
}

export function debounce<Args extends unknown[]>(fn: (...args: Args) => void, delayMs: number): Debounced<Args> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pendingArgs: Args | undefined;

  const wrapped = ((...args: Args) => {
    pendingArgs = args;
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      const callArgs = pendingArgs;
      pendingArgs = undefined;
      if (callArgs) fn(...callArgs);
    }, delayMs);
  }) as Debounced<Args>;

  wrapped.cancel = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    pendingArgs = undefined;
  };

  wrapped.flush = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    const callArgs = pendingArgs;
    pendingArgs = undefined;
    if (callArgs) fn(...callArgs);
  };

  return wrapped;
}
