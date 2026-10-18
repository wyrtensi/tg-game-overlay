import { describe, expect, test } from "vitest";
import { SingleFlight } from "./single-flight";

describe("SingleFlight", () => {
  test("shares one in-progress load between callers", async () => {
    let release: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    let calls = 0;
    const flight = new SingleFlight<string[]>();

    const first = flight.run(async () => {
      calls += 1;
      await pending;
      return ["recent"];
    });
    const second = flight.run(async () => {
      calls += 1;
      return ["duplicate"];
    });

    expect(calls).toBe(1);
    release?.();
    await expect(Promise.all([first, second])).resolves.toEqual([["recent"], ["recent"]]);
  });

  test("allows another load after the first one settles", async () => {
    const flight = new SingleFlight<number>();
    await expect(flight.run(async () => 1)).resolves.toBe(1);
    await expect(flight.run(async () => 2)).resolves.toBe(2);
  });

  test("does not make a new session wait for an obsolete request", async () => {
    let release: ((value: number) => void) | undefined;
    const obsolete = new Promise<number>((resolve) => { release = resolve; });
    const flight = new SingleFlight<number>();

    const first = flight.run(async () => obsolete);
    flight.reset();
    await expect(flight.run(async () => 2)).resolves.toBe(2);
    release?.(1);
    await expect(first).resolves.toBe(1);
  });
});
