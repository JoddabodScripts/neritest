/**
 * A small, dependency-free assertion library.
 *
 * Deliberately Jest/Vitest-shaped (`expect(x).toBe(y)`, `.toContain`, `.not`,
 * `.rejects`) so it reads familiar and drops into any test runner, but it works
 * standalone too (throws `AssertionError` on failure). NeriTest ships it so the
 * cookbook examples run with zero extra setup; use your own runner's `expect` if
 * you prefer.
 */

export class AssertionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssertionError";
  }
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) {
    return false;
  }
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  return ka.every((k) =>
    deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
  );
}

function fmt(v: unknown): string {
  if (typeof v === "string") return JSON.stringify(v);
  if (typeof v === "object") {
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  }
  return String(v);
}

export interface Matchers<T> {
  toBe(expected: T): void;
  toEqual(expected: unknown): void;
  toContain(item: unknown): void;
  toContainEqual(item: unknown): void;
  toHaveLength(len: number): void;
  toBeTruthy(): void;
  toBeFalsy(): void;
  toBeDefined(): void;
  toBeUndefined(): void;
  toBeNull(): void;
  toBeGreaterThan(n: number): void;
  toBeLessThan(n: number): void;
  toMatch(re: RegExp | string): void;
  toThrow(expected?: string | RegExp): void;
  toContainHtml(fragment: string): void;
}

export interface AsyncMatchers {
  toBe(expected: unknown): Promise<void>;
  toEqual(expected: unknown): Promise<void>;
  toThrow(expected?: string | RegExp): Promise<void>;
}

export interface Expectation<T> extends Matchers<T> {
  not: Matchers<T>;
  resolves: AsyncMatchers;
  rejects: AsyncMatchers;
}

export function expect<T>(actual: T): Expectation<T> {
  const make = (negate: boolean): Matchers<T> => {
    const check = (pass: boolean, message: string) => {
      if (pass === negate) {
        throw new AssertionError(negate ? `Expected NOT: ${message}` : message);
      }
    };
    return {
      toBe(expected) {
        check(Object.is(actual, expected), `expected ${fmt(actual)} to be ${fmt(expected)}`);
      },
      toEqual(expected) {
        check(deepEqual(actual, expected), `expected ${fmt(actual)} to equal ${fmt(expected)}`);
      },
      toContain(item) {
        const arr = actual as unknown;
        const pass = typeof arr === "string"
          ? arr.includes(item as string)
          : Array.isArray(arr) && arr.some((x) => Object.is(x, item));
        check(pass, `expected ${fmt(actual)} to contain ${fmt(item)}`);
      },
      toContainEqual(item) {
        const arr = actual as unknown[];
        check(Array.isArray(arr) && arr.some((x) => deepEqual(x, item)),
          `expected ${fmt(actual)} to contain equal ${fmt(item)}`);
      },
      toHaveLength(len) {
        const a = actual as { length?: number };
        check(a?.length === len, `expected length ${a?.length} to be ${len}`);
      },
      toBeTruthy() {
        check(!!actual, `expected ${fmt(actual)} to be truthy`);
      },
      toBeFalsy() {
        check(!actual, `expected ${fmt(actual)} to be falsy`);
      },
      toBeDefined() {
        check(actual !== undefined, `expected value to be defined`);
      },
      toBeUndefined() {
        check(actual === undefined, `expected value to be undefined`);
      },
      toBeNull() {
        check(actual === null, `expected ${fmt(actual)} to be null`);
      },
      toBeGreaterThan(n) {
        check((actual as number) > n, `expected ${fmt(actual)} > ${n}`);
      },
      toBeLessThan(n) {
        check((actual as number) < n, `expected ${fmt(actual)} < ${n}`);
      },
      toMatch(re) {
        const str = String(actual);
        const pass = typeof re === "string" ? str.includes(re) : re.test(str);
        check(pass, `expected ${fmt(str)} to match ${re}`);
      },
      toContainHtml(fragment) {
        const str = String(actual ?? "");
        check(str.includes(fragment), `expected HTML ${fmt(str)} to contain ${fmt(fragment)}`);
      },
      toThrow(expected) {
        let threw = false;
        let error: Error | undefined;
        try {
          (actual as () => unknown)();
        } catch (e) {
          threw = true;
          error = e as Error;
        }
        if (!expected) {
          check(threw, `expected function to throw`);
          return;
        }
        const msg = error?.message ?? "";
        const pass = threw && (typeof expected === "string" ? msg.includes(expected) : expected.test(msg));
        check(pass, `expected function to throw matching ${expected}`);
      },
    };
  };

  const asyncMatchers = (expectReject: boolean): AsyncMatchers => {
    const settle = async (): Promise<{ value?: unknown; error?: Error; threw: boolean }> => {
      try {
        const value = await (actual as Promise<unknown>);
        return { value, threw: false };
      } catch (error) {
        return { error: error as Error, threw: true };
      }
    };
    return {
      async toBe(expected) {
        const r = await settle();
        if (expectReject) {
          if (!r.threw) throw new AssertionError("expected promise to reject");
        } else {
          if (r.threw) throw new AssertionError(`expected promise to resolve, got rejection ${r.error?.message}`);
          if (!Object.is(r.value, expected)) {
            throw new AssertionError(`expected resolved ${fmt(r.value)} to be ${fmt(expected)}`);
          }
        }
      },
      async toEqual(expected) {
        const r = await settle();
        if (expectReject) {
          if (!r.threw) throw new AssertionError("expected promise to reject");
        } else if (!deepEqual(r.value, expected)) {
          throw new AssertionError(`expected resolved ${fmt(r.value)} to equal ${fmt(expected)}`);
        }
      },
      async toThrow(expected) {
        const r = await settle();
        if (!r.threw) throw new AssertionError("expected promise to reject");
        if (expected) {
          const msg = r.error?.message ?? "";
          const pass = typeof expected === "string" ? msg.includes(expected) : expected.test(msg);
          if (!pass) throw new AssertionError(`expected rejection matching ${expected}, got ${msg}`);
        }
      },
    };
  };

  const base = make(false) as Expectation<T>;
  base.not = make(true);
  base.resolves = asyncMatchers(false);
  base.rejects = asyncMatchers(true);
  return base;
}
