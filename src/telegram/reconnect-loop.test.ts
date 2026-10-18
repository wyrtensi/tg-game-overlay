import { describe, expect, test, vi } from "vitest";
import { ReconnectLoop, type ReconnectOutcome, type ReconnectTimer } from "./reconnect-loop";

class FakeReconnectTimer implements ReconnectTimer {
  private readonly pendingCallbacks = new Map<object, () => void>();
  readonly scheduledDelays: number[] = [];

  set(callback: () => void, delayMs: number): object {
    const handle = {};
    this.pendingCallbacks.set(handle, callback);
    this.scheduledDelays.push(delayMs);
    return handle;
  }

  clear(handle: object): void {
    this.pendingCallbacks.delete(handle);
  }

  pending(): number {
    return this.pendingCallbacks.size;
  }

  async runNext(): Promise<void> {
    const next = this.pendingCallbacks.entries().next().value as [object, () => void] | undefined;
    if (!next) return;
    this.pendingCallbacks.delete(next[0]);
    next[1]();
    await Promise.resolve();
    await Promise.resolve();
  }
}

function createLoop(outcomes: ReconnectOutcome[] = [{ kind: "retry" }]) {
  const timer = new FakeReconnectTimer();
  const runAttempt = vi.fn(async () => outcomes.shift() ?? { kind: "retry" as const });
  const waiting = vi.fn();
  const connected = vi.fn();
  const reauthRequired = vi.fn();
  const loop = new ReconnectLoop({ timer, runAttempt, onWaiting: waiting, onConnected: connected, onReauthRequired: reauthRequired });
  return { loop, timer, runAttempt, waiting, connected, reauthRequired };
}

describe("ReconnectLoop", () => {
  test("never schedules two timers for the same gap", () => {
    const { loop, timer } = createLoop();
    loop.schedule();
    loop.schedule();
    expect(timer.pending()).toBe(1);
    expect(timer.scheduledDelays).toEqual([1_000]);
  });

  test("retry now replaces the delay with one immediate attempt", () => {
    const { loop, timer } = createLoop();
    loop.schedule();
    loop.retryNow();
    expect(timer.pending()).toBe(1);
    expect(timer.scheduledDelays).toEqual([1_000, 0]);
  });

  test("stop cancels a pending reconnect permanently", async () => {
    const { loop, timer, runAttempt } = createLoop();
    loop.schedule();
    loop.stop();
    await timer.runNext();
    expect(runAttempt).not.toHaveBeenCalled();
  });

  test("schedules the next exponential delay after a recoverable failure", async () => {
    const { loop, timer, waiting } = createLoop([{ kind: "retry" }]);
    loop.schedule();
    await timer.runNext();
    expect(timer.scheduledDelays).toEqual([1_000, 2_000]);
    expect(waiting).toHaveBeenLastCalledWith({ attempt: 1, waitSeconds: 2 });
  });

  test("stops after an authorization failure", async () => {
    const { loop, timer, reauthRequired } = createLoop([{ kind: "reauth_required" }]);
    loop.schedule();
    await timer.runNext();
    expect(reauthRequired).toHaveBeenCalledTimes(1);
    expect(timer.pending()).toBe(0);
  });

  test("ignores an old attempt after logout and a new login reset", async () => {
    let resolveAttempt: ((outcome: ReconnectOutcome) => void) | undefined;
    const timer = new FakeReconnectTimer();
    const runAttempt = vi.fn(() => new Promise<ReconnectOutcome>((resolve) => {
      resolveAttempt = resolve;
    }));
    const loop = new ReconnectLoop({
      timer,
      runAttempt,
      onWaiting: vi.fn(),
      onConnected: vi.fn(),
      onReauthRequired: vi.fn(),
    });

    loop.schedule();
    const running = timer.runNext();
    await Promise.resolve();
    loop.stop();
    loop.reset();
    resolveAttempt?.({ kind: "retry" });
    await running;
    await Promise.resolve();

    expect(runAttempt).toHaveBeenCalledTimes(1);
    expect(timer.pending()).toBe(0);
  });
});
