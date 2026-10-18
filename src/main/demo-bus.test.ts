import { describe, expect, test, vi } from "vitest";
import { DemoBus } from "./demo-bus";

describe("DemoBus", () => {
  test("delivers an emitted payload to a listener", () => {
    const bus = new DemoBus();
    const handler = vi.fn();
    bus.on("tg:status", handler);

    bus.emit("tg:status", { state: "offline" });

    expect(handler).toHaveBeenCalledExactlyOnceWith({ state: "offline" });
  });

  test("delivers to multiple listeners on the same event", () => {
    const bus = new DemoBus();
    const a = vi.fn();
    const b = vi.fn();
    bus.on("tg:status", a);
    bus.on("tg:status", b);

    bus.emit("tg:status", { state: "connected" });

    expect(a).toHaveBeenCalledOnce();
    expect(b).toHaveBeenCalledOnce();
  });

  test("does not deliver to a listener on a different event", () => {
    const bus = new DemoBus();
    const handler = vi.fn();
    bus.on("tg:status", handler);

    bus.emit("tg:dialogs", { dialogs: [] });

    expect(handler).not.toHaveBeenCalled();
  });

  test("the unsubscribe function stops further delivery", () => {
    const bus = new DemoBus();
    const handler = vi.fn();
    const off = bus.on("tg:status", handler);

    off();
    bus.emit("tg:status", { state: "offline" });

    expect(handler).not.toHaveBeenCalled();
  });

  test("emitting with no listeners does not throw", () => {
    const bus = new DemoBus();
    expect(() => bus.emit("tg:status", { state: "offline" })).not.toThrow();
  });
});
