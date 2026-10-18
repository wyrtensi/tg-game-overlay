/** Shares an expensive request while it is still running. */
export class SingleFlight<T> {
  private pending: Promise<T> | null = null;

  run(task: () => Promise<T>): Promise<T> {
    if (this.pending) return this.pending;

    const pending = task();
    this.pending = pending;
    void pending.finally(() => {
      if (this.pending === pending) this.pending = null;
    });
    return pending;
  }

  reset(): void {
    this.pending = null;
  }
}
