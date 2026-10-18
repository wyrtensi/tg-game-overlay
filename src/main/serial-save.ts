export type SaveOutcome<R> =
  | { status: "saved"; result: R }
  | { status: "failed"; error: unknown }
  /** A newer value was submitted meanwhile; its outcome is the one that counts. */
  | { status: "superseded" };

/**
 * Sends saves one at a time, in submission order, and reports only the
 * newest one: an older response that arrives late must never overwrite a
 * newer edit. A queued save that a newer one replaces before it starts is
 * not sent at all, since every save carries the whole settings section.
 */
export class SerialSaver<T, R> {
  private tail: Promise<unknown> = Promise.resolve();
  private sequence = 0;
  private inFlight = 0;

  constructor(private readonly save: (value: T) => Promise<R>) {}

  /** True while a submitted save has not settled yet. */
  get busy(): boolean {
    return this.inFlight > 0;
  }

  submit(value: T): Promise<SaveOutcome<R>> {
    const sequence = ++this.sequence;
    this.inFlight += 1;
    const run = this.tail.then(async (): Promise<SaveOutcome<R>> => {
      if (sequence !== this.sequence) return { status: "superseded" };
      try {
        return { status: "saved", result: await this.save(value) };
      } catch (error) {
        return { status: "failed", error };
      }
    });
    this.tail = run;
    return run.then((outcome) => {
      this.inFlight -= 1;
      return sequence === this.sequence ? outcome : { status: "superseded" };
    });
  }
}
