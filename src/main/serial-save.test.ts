import { describe, expect, test } from "vitest";
import { SerialSaver } from "./serial-save";

function deferredSave() {
  const started: string[] = [];
  const resolvers: Array<(value: string) => void> = [];
  const saver = new SerialSaver((value: string) => {
    started.push(value);
    return new Promise<string>((resolve) => resolvers.push(resolve));
  });
  return { saver, started, resolvers };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("SerialSaver", () => {
  test("sends one save at a time and reports only the newest", async () => {
    const { saver, started, resolvers } = deferredSave();
    const first = saver.submit("edit");
    await flush();
    const second = saver.submit("edit + remove");
    const third = saver.submit("edit + remove + add");
    await flush();
    expect(started).toEqual(["edit"]);
    expect(saver.busy).toBe(true);

    resolvers[0]("saved edit");
    await flush();
    // The second save was replaced before it started and is never sent.
    expect(started).toEqual(["edit", "edit + remove + add"]);
    resolvers[1]("saved all");

    expect(await first).toEqual({ status: "superseded" });
    expect(await second).toEqual({ status: "superseded" });
    expect(await third).toEqual({ status: "saved", result: "saved all" });
    expect(saver.busy).toBe(false);
  });

  test("reports the failure of the newest save", async () => {
    const saver = new SerialSaver(async () => {
      throw new Error("rejected");
    });
    const outcome = await saver.submit("value");
    expect(outcome.status).toBe("failed");
  });
});
