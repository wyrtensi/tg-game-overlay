import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { debounce } from "./debounce";

describe("debounce", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("delays the call until the wait time passes", () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 300);

    debounced("a");
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(299);
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledExactlyOnceWith("a");
  });

  test("only fires once for a burst of calls, with the last arguments", () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 300);

    debounced(1);
    debounced(2);
    debounced(3);
    vi.advanceTimersByTime(300);

    expect(fn).toHaveBeenCalledExactlyOnceWith(3);
  });

  test("cancel drops a pending call", () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 300);

    debounced("a");
    debounced.cancel();
    vi.advanceTimersByTime(300);

    expect(fn).not.toHaveBeenCalled();
  });

  test("flush runs a pending call immediately", () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 300);

    debounced("a");
    debounced.flush();

    expect(fn).toHaveBeenCalledExactlyOnceWith("a");
  });

  test("flush is a no-op when nothing is pending", () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 300);

    debounced.flush();

    expect(fn).not.toHaveBeenCalled();
  });
});
