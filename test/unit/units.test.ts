import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { Clock, parseDuration } from "../../src/time/clock";
import { expect, AssertionError } from "../../src/assertions/expect";
import { permissions, hasBit, RolePermissions } from "../../src/model/permissions";
import { Recorder } from "../../src/recorder/recorder";

describe("Clock / virtual time", () => {
  test("parseDuration understands unit strings and raw ms", () => {
    assert.equal(parseDuration("5m"), 300_000);
    assert.equal(parseDuration("1h30m"), 5_400_000);
    assert.equal(parseDuration("2d"), 172_800_000);
    assert.equal(parseDuration(1234), 1234);
  });

  test("advance fires one-shot timers in order without real waiting", () => {
    const clock = new Clock(0);
    const fired: string[] = [];
    clock.setTimeout(() => fired.push("b"), "2m");
    clock.setTimeout(() => fired.push("a"), "1m");
    clock.advance("90s");
    assert.deepEqual(fired, ["a"]);
    clock.advance("90s");
    assert.deepEqual(fired, ["a", "b"]);
  });

  test("intervals re-arm across advances", () => {
    const clock = new Clock(0);
    let count = 0;
    clock.setInterval(() => count++, "10s");
    clock.advance("35s");
    assert.equal(count, 3);
  });
});

describe("permissions", () => {
  test("combine names and bits into a field", () => {
    const p = permissions("KICK", "BAN");
    assert.equal(p, RolePermissions.KICK | RolePermissions.BAN);
    assert.equal(hasBit(p, RolePermissions.KICK), true);
    assert.equal(hasBit(p, RolePermissions.ADMIN), false);
  });
});

describe("expect helpers", () => {
  test("passing matchers do not throw", () => {
    expect(1).toBe(1);
    expect({ a: 1 }).toEqual({ a: 1 });
    expect([1, 2, 3]).toContain(2);
    expect("Pong!").toMatch(/Pong/);
    expect("<b>hi</b>").toContainHtml("<b>");
    expect([1, 2]).toHaveLength(2);
  });

  test("failing matchers throw AssertionError", () => {
    assert.throws(() => expect(1).toBe(2), AssertionError);
    assert.throws(() => expect([1]).toContain(9), AssertionError);
  });

  test("not inverts", () => {
    expect(1).not.toBe(2);
    assert.throws(() => expect(1).not.toBe(1), AssertionError);
  });

  test("async resolves/rejects", async () => {
    await expect(Promise.resolve(5)).resolves.toBe(5);
    await expect(Promise.reject(new Error("boom"))).rejects.toThrow("boom");
  });
});

describe("Recorder", () => {
  test("captures and replays out-bound packets", async () => {
    const recorder = new Recorder(() => Date.now());
    recorder.start();
    recorder.capture("out", "message:created", { message: { id: "1" } });
    recorder.capture("in", "user:authenticate", { token: "x" });
    recorder.capture("out", "message:created", { message: { id: "2" } });
    const session = recorder.stop();
    assert.equal(session.entries.length, 3);

    const replayed: string[] = [];
    await Recorder.replay(session, {
      emit: (_event, payload) => replayed.push((payload as any).message.id),
    });
    // Only 'out' packets are replayed.
    assert.deepEqual(replayed, ["1", "2"]);
  });
});
