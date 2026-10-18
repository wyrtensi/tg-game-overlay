import { reconnectDelayMs } from "./reconnect-policy";

export interface ReconnectTimer {
  set(callback: () => void, delayMs: number): unknown;
  clear(handle: unknown): void;
}

export type ReconnectOutcome =
  | { kind: "connected" }
  | { kind: "retry"; floodWaitSeconds?: number }
  | { kind: "reauth_required" };

export interface ReconnectWaitingState {
  attempt: number;
  waitSeconds: number;
}

export interface ReconnectLoopOptions {
  timer?: ReconnectTimer;
  runAttempt: () => Promise<ReconnectOutcome>;
  onWaiting: (state: ReconnectWaitingState) => void;
  onConnected: () => void;
  onReauthRequired: () => void;
}

const browserTimer: ReconnectTimer = {
  set: (callback, delayMs) => setTimeout(callback, delayMs),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** Owns one delayed reconnect attempt and prevents overlapping connection calls. */
export class ReconnectLoop {
  private readonly timer: ReconnectTimer;
  private timerHandle: unknown | null = null;
  private attemptRunning = false;
  private stopped = false;
  private attempt = 0;
  private generation = 0;

  constructor(private readonly options: ReconnectLoopOptions) {
    this.timer = options.timer ?? browserTimer;
  }

  get isWaiting(): boolean {
    return this.timerHandle !== null;
  }

  get isRecovering(): boolean {
    return this.timerHandle !== null || this.attemptRunning;
  }

  schedule(floodWaitSeconds?: number): void {
    if (this.stopped || this.isRecovering) return;
    this.scheduleAfter(reconnectDelayMs(this.attempt, floodWaitSeconds));
  }

  retryNow(): void {
    if (this.stopped || this.attemptRunning) return;
    this.cancelTimer();
    this.scheduleAfter(0);
  }

  reset(): void {
    this.cancelTimer();
    this.generation += 1;
    this.attemptRunning = false;
    this.stopped = false;
    this.attempt = 0;
  }

  stop(): void {
    this.cancelTimer();
    this.generation += 1;
    this.stopped = true;
    this.attempt = 0;
  }

  private scheduleAfter(delayMs: number): void {
    const generation = this.generation;
    const waitSeconds = Math.ceil(delayMs / 1000);
    this.options.onWaiting({ attempt: this.attempt, waitSeconds });
    this.timerHandle = this.timer.set(() => {
      if (generation !== this.generation) return;
      this.timerHandle = null;
      void this.run(generation);
    }, delayMs);
  }

  private async run(generation: number): Promise<void> {
    if (generation !== this.generation || this.stopped || this.attemptRunning) return;
    this.attemptRunning = true;
    try {
      const outcome = await this.options.runAttempt();
      if (generation !== this.generation || this.stopped) return;
      if (outcome.kind === "connected") {
        this.attempt = 0;
        this.options.onConnected();
        return;
      }
      if (outcome.kind === "reauth_required") {
        this.stopped = true;
        this.options.onReauthRequired();
        return;
      }
      this.attempt += 1;
      this.attemptRunning = false;
      this.schedule(outcome.floodWaitSeconds);
    } finally {
      if (this.attemptRunning) this.attemptRunning = false;
    }
  }

  private cancelTimer(): void {
    if (this.timerHandle === null) return;
    this.timer.clear(this.timerHandle);
    this.timerHandle = null;
  }
}
