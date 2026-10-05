import { observable, observe, unobserve } from "@nx-js/observer-util";
import * as reference from "rxjs";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Channel } from "./channel";
import * as replacement from "./streams";

describe.each([
  ["observer-util", replacement],
  ["RxJS reference", reference as unknown as typeof replacement],
])("streams: %s", (_name, api) => {
  afterEach(() => vi.useRealTimers());

  it("stops synchronous producers and tears down exactly once", async () => {
    const teardown = vi.fn();
    const produced: number[] = [];
    const source = new api.Observable<number>((sink) => {
      for (const value of [1, 2, 3]) {
        if (sink.closed) break;
        produced.push(value);
        sink.next(value);
      }
      return teardown;
    });
    expect(await api.firstValueFrom(source)).toBe(1);
    expect(produced).toEqual([1]);
    expect(teardown).toHaveBeenCalledTimes(1);
    produced.length = 0;
    expect(
      await api.lastValueFrom(source.pipe(api.take(2), api.toArray())),
    ).toEqual([1, 2]);
    expect(produced).toEqual([1, 2]);
    expect(teardown).toHaveBeenCalledTimes(2);
  });

  it("unsubscribes first/take before notifying reentrant consumers", () => {
    for (const operator of [api.first<number>(), api.take<number>(1)]) {
      const source = new api.Subject<number>();
      const trace: number[] = [];
      source.pipe(operator).subscribe((value) => {
        trace.push(value);
        if (value === 1) source.next(2);
      });
      source.next(1);
      expect(trace).toEqual([1]);
    }
  });

  it("disposes a reentrantly replaced inner subscription", () => {
    const source = new api.Subject<number>();
    const cleanup: number[] = [];
    const trace: number[] = [];
    const subscription = source
      .pipe(
        api.switchMap(
          (value) =>
            new api.Observable<number>((sink) => {
              sink.next(value);
              return () => cleanup.push(value);
            }),
        ),
      )
      .subscribe((value) => {
        trace.push(value);
        if (value === 1) source.next(2);
      });
    source.next(1);
    expect(cleanup).toEqual([1]);
    subscription.unsubscribe();
    expect(trace).toEqual([1, 2]);
    expect(cleanup).toEqual([1, 2]);
  });

  it("preserves object identity, duplicate emissions, and reentrant order", () => {
    const subject = new api.Subject<object>();
    const first = {};
    const second = {};
    const trace: object[] = [];
    subject.subscribe((value) => {
      if (value === first) subject.next(second);
    });
    subject.subscribe((value) => trace.push(value));
    subject.next(first);
    subject.next(second);
    expect(trace).toEqual([second, first, second]);
    expect(trace[1]).toBe(first);
  });

  it("unsubscribes during dispatch and does not notify new listeners retroactively", () => {
    const subject = new api.Subject<number>();
    const trace: string[] = [];
    subject.subscribe((value) => {
      trace.push(`first:${value}`);
      second.unsubscribe();
      subject.subscribe((next) => trace.push(`new:${next}`));
    });
    const second = subject.subscribe((value) => trace.push(`second:${value}`));
    subject.next(1);
    subject.next(2);
    expect(trace).toEqual(["first:1", "first:2", "new:2"]);
  });

  it("replays before terminal notifications without wrapping values", () => {
    const subject = new api.ReplaySubject<object>(2);
    const values = [{}, {}, {}];
    values.forEach((value) => subject.next(value));
    subject.complete();
    const trace: unknown[] = [];
    subject.subscribe({
      next: (value) => trace.push(value),
      complete: () => trace.push("done"),
    });
    expect(trace).toEqual([values[1], values[2], "done"]);
    expect(trace[0]).toBe(values[1]);
    const failure = new Error("failed");
    const failed = new api.ReplaySubject<number>();
    failed.next(4);
    failed.error(failure);
    failed.subscribe({
      next: (value) => trace.push(value),
      error: (error) => trace.push(error),
    });
    expect(trace.slice(-2)).toEqual([4, failure]);
  });

  it("keeps BehaviorSubject terminal semantics", () => {
    const subject = new api.BehaviorSubject(1);
    const trace: unknown[] = [];
    subject.subscribe((value) => trace.push(value));
    subject.next(1);
    subject.next(2);
    subject.complete();
    subject.subscribe({
      next: (value) => trace.push(value),
      complete: () => trace.push("done"),
    });
    expect(trace).toEqual([1, 1, 2, "done"]);
    expect(subject.getValue()).toBe(2);
    const failed = new api.BehaviorSubject(1);
    failed.error(new Error("failed"));
    expect(() => failed.value).toThrow("failed");
  });

  it("isolates operator state per subscription and propagates exceptions", async () => {
    const source = api.of(1, 1, 2, 3).pipe(
      api.distinctUntilChanged(),
      api.filter((value) => value > 1),
      api.map((value, index) => value + index),
      api.scan((sum, value) => sum + value, 0),
      api.startWith(0),
      api.toArray(),
    );
    expect(await api.lastValueFrom(source)).toEqual([0, 2, 6]);
    expect(await api.lastValueFrom(source)).toEqual([0, 2, 6]);
    await expect(
      api.lastValueFrom(
        api.of(1).pipe(
          api.map(() => {
            throw new Error("bad projection");
          }),
        ),
      ),
    ).rejects.toThrow("bad projection");
    await expect(api.firstValueFrom(api.of<number>())).rejects.toMatchObject({
      name: "EmptyError",
    });
    await expect(
      api.lastValueFrom(api.of(1).pipe(api.first(() => false))),
    ).rejects.toMatchObject({ name: "EmptyError" });
  });

  it("switches away from stale work and waits for the last inner completion", () => {
    const outer = new api.Subject<number>();
    const inners = [new api.Subject<number>(), new api.Subject<number>()];
    const cleanup: number[] = [];
    const trace: unknown[] = [];
    outer
      .pipe(
        api.switchMap((index) =>
          inners[index]!.pipe(api.finalize(() => cleanup.push(index))),
        ),
      )
      .subscribe({
        next: (value) => trace.push(value),
        complete: () => trace.push("done"),
      });
    outer.next(0);
    inners[0]!.next(10);
    outer.next(1);
    inners[0]!.next(11);
    outer.complete();
    inners[1]!.next(20);
    expect(trace).toEqual([10, 20]);
    inners[1]!.complete();
    expect(trace).toEqual([10, 20, "done"]);
    expect(cleanup).toEqual([0, 1]);
  });

  it("handles synchronous inner completion", async () => {
    expect(
      await api.lastValueFrom(
        api.of(1, 2).pipe(
          api.switchMap((value) => api.of(value, value + 10)),
          api.toArray(),
        ),
      ),
    ).toEqual([1, 11, 2, 12]);
    expect(
      await api.lastValueFrom(
        api.of(1, 2).pipe(
          api.mergeMap((value) => [value, value + 10]),
          api.toArray(),
        ),
      ),
    ).toEqual([1, 11, 2, 12]);
  });

  it("finalizes the source before synchronous recovery", async () => {
    const trace: string[] = [];
    const source = new api.Observable<number>((sink) => {
      sink.error(new Error("failed"));
      return () => trace.push("teardown");
    });
    const result = await api.lastValueFrom(
      source.pipe(
        api.catchError(() =>
          api.defer(() => {
            trace.push("recover");
            return api.of(42);
          }),
        ),
        api.finalize(() => trace.push("finalize")),
      ),
    );
    expect(result).toBe(42);
    expect(trace).toEqual(["teardown", "recover", "finalize"]);
  });

  it.each([false, true])(
    "finalizes concatenated sources before subscribing to the next (async: %s)",
    (asynchronous) => {
      const trace: string[] = [];
      let complete!: () => void;
      const source = new api.Observable<number>((sink) => {
        complete = () => sink.complete();
        if (!asynchronous) complete();
        return () => trace.push("teardown");
      });
      api
        .concat(
          source,
          api.defer(() => {
            trace.push("next");
            return api.of(42);
          }),
        )
        .subscribe();
      if (asynchronous) complete();
      expect(trace).toEqual(["teardown", "next"]);
    },
  );

  it("retries with a fresh producer and tears down every attempt", async () => {
    let attempts = 0;
    const teardown = vi.fn();
    const source = new api.Observable<number>((sink) => {
      attempts++;
      if (attempts < 3) sink.error(new Error("retry"));
      else {
        sink.next(7);
        sink.complete();
      }
      return teardown;
    });
    expect(await api.lastValueFrom(source.pipe(api.retry(2)))).toBe(7);
    expect(attempts).toBe(3);
    expect(teardown).toHaveBeenCalledTimes(3);
  });

  it("concatenates synchronous sources without recursion and stops on cancellation or error", async () => {
    expect(
      await api.lastValueFrom(
        api.concat(
          ...Array.from({ length: 5000 }, () => api.of<number>()),
          api.of(42),
        ),
      ),
    ).toBe(42);
    const next = vi.fn(() => api.of(2));
    await expect(
      api.firstValueFrom(api.concat(api.of(1), api.defer(next))),
    ).resolves.toBe(1);
    await expect(
      api.lastValueFrom(
        api.concat(
          api.throwError(() => new Error("failed")),
          api.defer(next),
        ),
      ),
    ).rejects.toThrow("failed");
    expect(next).not.toHaveBeenCalled();
  });

  it("shares one producer, disconnects at zero subscribers, and reconnects", () => {
    const subject = new api.Subject<number>();
    const teardown = vi.fn();
    const start = vi.fn();
    const shared = new api.Observable<number>((sink) => {
      start();
      const subscription = subject.subscribe(sink);
      return () => {
        subscription.unsubscribe();
        teardown();
      };
    }).pipe(api.share());
    const first = shared.subscribe();
    const second = shared.subscribe();
    expect(start).toHaveBeenCalledTimes(1);
    first.unsubscribe();
    expect(teardown).not.toHaveBeenCalled();
    second.unsubscribe();
    expect(teardown).toHaveBeenCalledTimes(1);
    shared.subscribe().unsubscribe();
    expect(start).toHaveBeenCalledTimes(2);
    expect(teardown).toHaveBeenCalledTimes(2);
  });

  it("resets a shared synchronous terminal source", async () => {
    const shared = api.of(1, 2).pipe(api.share());
    expect(await api.lastValueFrom(shared.pipe(api.toArray()))).toEqual([1, 2]);
    expect(await api.lastValueFrom(shared.pipe(api.toArray()))).toEqual([1, 2]);
  });

  it("cancels timers and times out after inactivity rather than total duration", async () => {
    vi.useFakeTimers();
    const subject = new api.Subject<number>();
    const trace: unknown[] = [];
    subject.pipe(api.timeout({ each: 10, with: () => api.of(99) })).subscribe({
      next: (value) => trace.push(value),
      complete: () => trace.push("done"),
    });
    await vi.advanceTimersByTimeAsync(9);
    subject.next(1);
    await vi.advanceTimersByTimeAsync(9);
    expect(trace).toEqual([1]);
    await vi.advanceTimersByTimeAsync(1);
    expect(trace).toEqual([1, 99, "done"]);
    const subscription = api.timer(1, 5).subscribe();
    subscription.unsubscribe();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("samples the latest session state and suppresses duplicate keys", () => {
    const source = new api.Subject<number>();
    const latest = new api.Subject<string>();
    const trace: unknown[] = [];
    source
      .pipe(
        api.withLatestFrom(latest),
        api.distinct(([value]) => value),
      )
      .subscribe((value) => trace.push(value));
    source.next(1);
    latest.next("ready");
    source.next(1);
    source.next(1);
    latest.next("busy");
    source.next(2);
    expect(trace).toEqual([
      [1, "ready"],
      [2, "busy"],
    ]);
  });

  it("debounces bursts, flushes on completion, and throttles the leading value", async () => {
    vi.useFakeTimers();
    const source = new api.Subject<number>();
    const debounce: number[] = [];
    const throttle: number[] = [];
    source
      .pipe(api.debounceTime(10))
      .subscribe((value) => debounce.push(value));
    source
      .pipe(api.throttleTime(10))
      .subscribe((value) => throttle.push(value));
    source.next(1);
    source.next(2);
    await vi.advanceTimersByTimeAsync(10);
    source.next(3);
    source.complete();
    expect(debounce).toEqual([2, 3]);
    expect(throttle).toEqual([1, 3]);
    expect(vi.getTimerCount()).toBe(0);
  });
});

it("releases observer-util listeners", () => {
  const channel = new Channel<number>();
  const listener = vi.fn();
  const dispose = channel.listen(listener);
  channel.emit(1);
  dispose();
  channel.emit(2);
  expect(listener.mock.calls).toEqual([[1]]);
});

it("does not accidentally track stream dispatch as reactive state", () => {
  const state = observable({ value: 1 });
  const source = new replacement.Subject<number>();
  const producer = vi.fn(() => source.next(state.value));
  const reaction = observe(producer);
  source.next(2);
  expect(producer).toHaveBeenCalledTimes(1);
  state.value = 3;
  expect(producer).toHaveBeenCalledTimes(2);
  unobserve(reaction);
});
