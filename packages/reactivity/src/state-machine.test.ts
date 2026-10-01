import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import * as reference from "xstate";

import * as replacement from "./state-machine";
import { Subject } from "./streams";

it("rejects unused hierarchical state features rather than partially executing them", () => {
  const config = {
    initial: "parent",
    states: { parent: { initial: "child", states: { child: {} } } },
  } as unknown as Parameters<typeof replacement.createMachine>[0];
  expect(() =>
    replacement.createActor(replacement.createMachine(config)),
  ).toThrow("Only sequential states");
});

describe.each([
  ["observer-util", replacement],
  ["XState reference", reference as unknown as typeof replacement],
])("state machines: %s", (_name, api) => {
  afterEach(() => vi.useRealTimers());

  it("runs ordered assignments, guards, eventless states, and final output", () => {
    const trace: unknown[] = [];
    const machine = api
      .setup({
        types: {} as {
          context: { count: number };
          input: number;
          output: number;
          events: { type: "increment" };
        },
        guards: { enough: ({ context }) => context.count === 2 },
        actions: {
          increment: api.assign({ count: ({ context }) => context.count + 1 }),
        },
      })
      .createMachine({
        initial: "waiting",
        context: ({ input }) => ({ count: input }),
        states: {
          waiting: {
            on: {
              increment: {
                target: "checking",
                actions: [
                  "increment",
                  ({ context }) => trace.push(context.count),
                ],
              },
            },
          },
          checking: {
            always: [
              { guard: "enough", target: "done" },
              { target: "waiting" },
            ],
          },
          done: { type: "final" },
        },
        output: ({ context }) => context.count,
      });
    const actor = api.createActor(machine, { input: 0 });
    actor.subscribe((snapshot) =>
      trace.push([snapshot.value, snapshot.status, snapshot.context.count]),
    );
    actor.start();
    actor.send({ type: "increment" });
    actor.send({ type: "increment" });
    expect(trace).toEqual([
      ["waiting", "active", 0],
      1,
      ["waiting", "active", 1],
      2,
      ["done", "done", 2],
    ]);
    expect(actor.getSnapshot().output).toBe(2);
  });

  it("does not reenter a self transition unless requested", () => {
    const entry = vi.fn();
    const exit = vi.fn();
    const actor = api.createActor(
      api.createMachine({
        initial: "ready",
        states: {
          ready: {
            entry,
            exit,
            on: { keep: "ready", restart: { target: "ready", reenter: true } },
          },
        },
      }),
    );
    actor.start();
    actor.send({ type: "keep" });
    expect(entry).toHaveBeenCalledTimes(1);
    expect(exit).not.toHaveBeenCalled();
    actor.send({ type: "restart" });
    expect(entry).toHaveBeenCalledTimes(2);
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it("cancels invoked promises and ignores late results", async () => {
    let finish!: (value: number) => void;
    let signal!: AbortSignal;
    const machine = api
      .setup({
        types: {} as { context: { value: number }; output: number },
        actors: {
          work: api.fromPromise(({ signal: current }) => {
            signal = current;
            return new Promise<number>((resolve) => {
              finish = resolve;
            });
          }),
        },
      })
      .createMachine({
        context: { value: 0 },
        initial: "running",
        states: {
          running: {
            invoke: {
              src: "work",
              onDone: {
                target: "done",
                actions: api.assign({ value: ({ event }) => event.output }),
              },
            },
            on: { cancel: "done" },
          },
          done: { type: "final" },
        },
        output: ({ context }) => context.value,
      });
    const actor = api.createActor(machine).start();
    actor.send({ type: "cancel" });
    expect(signal.aborted).toBe(true);
    finish(42);
    await Promise.resolve();
    expect(actor.getSnapshot().output).toBe(0);
  });

  it("forwards child snapshots and its final output", async () => {
    vi.useFakeTimers();
    const trace: unknown[] = [];
    const child = api.createMachine({
      context: { progress: 1 },
      initial: "working",
      states: { working: { after: { 5: "done" } }, done: { type: "final" } },
      output: () => 42,
    });
    const parent = api
      .setup({
        types: {} as {
          context: { progress: number; result: number };
          output: number;
        },
        actors: { child },
      })
      .createMachine({
        context: { progress: 0, result: 0 },
        initial: "working",
        states: {
          working: {
            invoke: {
              src: "child",
              onSnapshot: {
                actions: api.assign({
                  progress: ({ event }) => event.snapshot.context.progress,
                }),
              },
              onDone: {
                target: "done",
                actions: api.assign({ result: ({ event }) => event.output }),
              },
            },
          },
          done: { type: "final" },
        },
        output: ({ context }) => context.result,
      });
    const actor = api.createActor(parent);
    actor.subscribe((snapshot) =>
      trace.push([snapshot.status, snapshot.context.progress, snapshot.output]),
    );
    actor.start();
    await vi.advanceTimersByTimeAsync(5);
    expect(trace).toEqual([
      ["active", 0, undefined],
      ["active", 1, undefined],
      ["done", 1, 42],
    ]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cleans observable and callback actors on exit and stop", () => {
    const source = new Subject<number>();
    const cleanup = vi.fn();
    const actor = api
      .createActor(
        api
          .setup({
            types: {} as { context: { value: number } },
            actors: {
              values: api.fromObservable(() => source),
              callback: api.fromCallback(({ sendBack }) => {
                sendBack({ type: "ready" });
                return cleanup;
              }),
            },
          })
          .createMachine({
            context: { value: 0 },
            initial: "starting",
            states: {
              starting: {
                invoke: { src: "callback" },
                on: { ready: "listening" },
              },
              listening: {
                invoke: {
                  src: "values",
                  onSnapshot: {
                    actions: api.assign({
                      value: ({ event, context }) =>
                        event.snapshot.context ?? context.value,
                    }),
                  },
                },
              },
            },
          }),
      )
      .start();
    source.next(2);
    expect(actor.getSnapshot().context.value).toBe(2);
    expect(cleanup).toHaveBeenCalledTimes(1);
    actor.stop();
    source.next(3);
    expect(actor.getSnapshot().context.value).toBe(2);
    expect(actor.getSnapshot().status).toBe("stopped");
  });

  it("assigns before processing raised events", () => {
    const actor = api
      .createActor(
        api
          .setup({
            types: {} as { context: { count: number }; output: number },
          })
          .createMachine({
            context: { count: 0 },
            initial: "first",
            states: {
              first: {
                entry: api.enqueueActions(({ enqueue }) => {
                  enqueue.assign({ count: 10 });
                  enqueue.raise({ type: "next" });
                }),
                on: {
                  next: {
                    target: "done",
                    guard: ({ context }) => context.count === 10,
                  },
                },
              },
              done: { type: "final" },
            },
            output: ({ context }) => context.count,
          }),
      )
      .start();
    expect(actor.getSnapshot().output).toBe(10);
  });

  it("starts work before notifying pending subscribers and preserves triggering input", async () => {
    const work = vi.fn(async ({ input }: { input: number }) => input + 1);
    const machine = api
      .setup({
        types: {} as {
          context: { result: number };
          output: number;
          events: { type: "start"; input: number };
        },
        actors: { work: api.fromPromise(work) },
      })
      .createMachine({
        context: { result: 0 },
        initial: "ready",
        states: {
          ready: { on: { start: "running" } },
          running: {
            invoke: {
              src: "work",
              input: ({ event }) => event.input,
              onDone: {
                target: "done",
                actions: api.assign({
                  result: ({ context, event }) => {
                    expectTypeOf(context.result).toEqualTypeOf<number>();
                    expectTypeOf(event.output).toEqualTypeOf<number>();
                    return event.output;
                  },
                }),
              },
            },
          },
          done: { type: "final" },
        },
        output: ({ context }) => context.result,
      });
    const actor = api.createActor(machine);
    actor.subscribe((snapshot) => {
      if (snapshot.value === "running") expect(work).toHaveBeenCalledTimes(1);
    });
    actor.start();
    actor.send({ type: "start", input: 41 });
    await Promise.resolve();
    expect(actor.getSnapshot().output).toBe(42);
  });

  it("completes subscribers on stop without running exit actions", () => {
    const exit = vi.fn();
    const complete = vi.fn();
    const actor = api.createActor(
      api.createMachine({ initial: "running", states: { running: { exit } } }),
    );
    actor.subscribe({ complete });
    actor.start();
    actor.stop();
    actor.stop();
    expect(exit).not.toHaveBeenCalled();
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it("handles synchronous invocation factory errors through onError", () => {
    const fail = () => {
      throw new Error("factory failed");
    };
    const actor = api
      .createActor(
        api
          .setup({
            types: {} as { context: Record<string, never> },
            actors: { fail: api.fromObservable(fail) },
          })
          .createMachine({
            initial: "running",
            states: {
              running: { invoke: { src: "fail", onError: "done" } },
              done: { type: "final" },
            },
          }),
      )
      .start();
    expect(actor.getSnapshot().status).toBe("done");
  });

  it("does not abort a successfully resolved promise actor", async () => {
    let signal!: AbortSignal;
    const actor = api
      .createActor(
        api
          .setup({
            types: {} as { context: Record<string, never> },
            actors: {
              work: api.fromPromise(async ({ signal: current }) => {
                signal = current;
                return 1;
              }),
            },
          })
          .createMachine({
            initial: "running",
            states: {
              running: { invoke: { src: "work", onDone: "done" } },
              done: { type: "final" },
            },
          }),
      )
      .start();
    await Promise.resolve();
    expect(actor.getSnapshot().status).toBe("done");
    expect(signal.aborted).toBe(false);
  });

  it("routes invocation failures and reports unhandled errors", async () => {
    const failure = new Error("failed");
    const create = (handled: boolean) =>
      api
        .setup({
          types: {} as { context: Record<string, never> },
          actors: {
            fail: api.fromPromise(async () => {
              throw failure;
            }),
          },
        })
        .createMachine({
          initial: "running",
          states: {
            running: {
              invoke: { src: "fail", ...(handled ? { onError: "done" } : {}) },
            },
            done: { type: "final" },
          },
        });
    const handled = api.createActor(create(true)).start();
    const error = vi.fn();
    const unhandled = api.createActor(create(false));
    unhandled.subscribe({ error });
    unhandled.start();
    await Promise.resolve();
    await Promise.resolve();
    expect(handled.getSnapshot().status).toBe("done");
    expect(unhandled.getSnapshot().status).toBe("error");
    expect(error).toHaveBeenCalledWith(failure);
  });
});
