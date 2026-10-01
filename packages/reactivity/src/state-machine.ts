import { Channel } from "./channel";
import {
  type Observable,
  type Observer,
  Subscriber,
  Subscription,
} from "./streams";

export type EventObject = { type: string };
export type AnyEventObject = EventObject & Record<string, any>;
export type MachineContext = Record<string, any>;
type OneOrMany<Value> = Value | readonly Value[];

export type Snapshot<Context, Output> = {
  context: Context;
  value: string;
} & (
  | { status: "active" | "stopped"; output: undefined; error: undefined }
  | { status: "done"; output: Output; error: undefined }
  | { status: "error"; output: undefined; error: unknown }
);

export type ActorLogic<Input = any, Output = any, Context = any> = {
  kind: "machine" | "promise" | "observable" | "callback";
  inputType?: Input;
  outputType?: Output;
  contextType?: Context;
};
type Actors = Record<string, ActorLogic>;
type InputValue<Input> = unknown extends Input
  ? object | string | number | boolean | bigint | symbol | null | undefined
  : Input;
type InputFrom<Logic> = Logic extends ActorLogic<infer Input> ? Input : never;
type OutputFrom<Logic> =
  Logic extends ActorLogic<any, infer Output> ? Output : never;
export type SnapshotFrom<Logic> =
  Logic extends ActorLogic<any, infer Output, infer Context>
    ? Snapshot<Context, Output>
    : never;
type ActorRef<Context, Event extends EventObject> = {
  send(event: Event): void;
  getSnapshot(): Snapshot<Context, unknown>;
};
export type ActionArgs<Context, Event extends EventObject> = {
  context: Context;
  event: Event;
  self: ActorRef<Context, Event>;
};
type Assignment<Context, Event extends EventObject> =
  | Partial<{
      [Key in keyof Context]:
        | Context[Key]
        | ((args: ActionArgs<Context, Event>) => Context[Key]);
    }>
  | ((args: ActionArgs<Context, Event>) => Partial<Context>);
type Enqueue<Context, Event extends EventObject> = {
  assign(assignment: Assignment<Context, Event>): void;
  raise(event: Event): void;
};
export type ActionFunction<Context, Event extends EventObject> = (
  args: ActionArgs<Context, Event>,
  params: any,
) => void;
type Action<Context, Event extends EventObject> =
  | string
  | {
      type: string;
      params?:
        | Record<string, unknown>
        | ((args: ActionArgs<Context, Event>) => unknown);
    }
  | ActionFunction<Context, Event>;
type Guard<Context, Event extends EventObject> =
  | string
  | ((args: ActionArgs<Context, Event>) => boolean);
type Transition<Context, Event extends EventObject> =
  | string
  | {
      target?: string;
      guard?: Guard<Context, Event>;
      actions?: OneOrMany<Action<Context, Event>>;
      reenter?: boolean;
    };
type Transitions<Context, Event extends EventObject> = OneOrMany<
  Transition<Context, Event>
>;
type Invocation<
  Context,
  Event extends EventObject,
  Definitions extends Actors,
> = {
  [Key in keyof Definitions]: {
    id?: string;
    src: Key;
    input?:
      | InputValue<InputFrom<Definitions[Key]>>
      | ((args: ActionArgs<Context, Event>) => InputFrom<Definitions[Key]>);
    onDone?: Transitions<
      Context,
      { type: string; output: OutputFrom<Definitions[Key]> }
    >;
    onError?: Transitions<Context, { type: string; error: unknown }>;
    onSnapshot?: Transitions<
      Context,
      { type: string; snapshot: SnapshotFrom<Definitions[Key]> }
    >;
  };
}[keyof Definitions];
type StateNode<
  Context,
  Event extends EventObject,
  Definitions extends Actors,
> = {
  description?: string;
  type?: "final";
  entry?: OneOrMany<Action<Context, Event>>;
  exit?: OneOrMany<Action<Context, Event>>;
  always?: Transitions<Context, Event>;
  on?: {
    [Type in Event["type"]]?: Transitions<
      Context,
      Extract<Event, { type: Type }>
    >;
  };
  after?: Record<string, Transitions<Context, Event>>;
  invoke?: OneOrMany<Invocation<Context, Event, Definitions>>;
};
type MachineConfig<
  Context,
  Input,
  Output,
  Event extends EventObject,
  Definitions extends Actors,
> = {
  id?: string;
  initial: string;
  states: Record<string, StateNode<Context, Event, Definitions>>;
  context?:
    | Context
    | ((args: { input: Input; self: ActorRef<Context, Event> }) => Context);
  output?: Output | ((args: ActionArgs<Context, Event>) => Output);
};
type Implementations<
  Context,
  Event extends EventObject,
  Definitions extends Actors,
> = {
  actors?: Definitions;
  actions?: Record<string, ActionFunction<Context, Event>>;
  guards?: Record<string, (args: ActionArgs<Context, Event>) => boolean>;
  delays?: Record<string, number>;
};

export class StateMachine<
  Context,
  Input,
  Output,
  Event extends EventObject = AnyEventObject,
> implements ActorLogic<Input, Output, Context>
{
  readonly kind = "machine";
  declare readonly inputType?: Input;
  declare readonly outputType?: Output;
  declare readonly contextType?: Context;

  constructor(
    readonly config: MachineConfig<Context, Input, Output, Event, any>,
    readonly implementations: Implementations<Context, Event, any>,
  ) {}

  get id(): string | undefined {
    return this.config.id;
  }
}

export function setup<
  Context extends MachineContext,
  Input = unknown,
  Output = unknown,
  Event extends EventObject = AnyEventObject,
  Definitions extends Actors = Actors,
>(
  implementations: Implementations<
    NoInfer<Context>,
    NoInfer<Event>,
    Definitions
  > & {
    types: { context: Context; input?: Input; output?: Output; events?: Event };
  },
) {
  return {
    createMachine: (
      config: MachineConfig<Context, Input, Output, Event, Definitions>,
    ) =>
      new StateMachine<Context, Input, Output, Event>(config, implementations),
  };
}

export function createMachine<
  Context extends MachineContext = MachineContext,
  Input = unknown,
  Output = unknown,
>(
  config: MachineConfig<Context, Input, Output, AnyEventObject, Actors>,
): StateMachine<Context, Input, Output> {
  return new StateMachine(config, {});
}

export function assign<Context, Event extends EventObject = AnyEventObject>(
  assignment: Assignment<NoInfer<Context>, NoInfer<Event>>,
): ActionFunction<Context, Event> {
  return (args) => {
    const partial =
      typeof assignment === "function"
        ? assignment(args)
        : Object.fromEntries(
            Object.entries(assignment).map(([key, value]) => [
              key,
              typeof value === "function" ? value(args) : value,
            ]),
          );
    (args.self as unknown as Actor<AnyMachine>).assignContext(partial);
  };
}

export function enqueueActions<Context, Event extends EventObject>(
  collect: (
    args: ActionArgs<Context, Event> & { enqueue: Enqueue<Context, Event> },
  ) => void,
): ActionFunction<Context, Event> {
  return (args) => {
    const assignments: ActionFunction<Context, Event>[] = [];
    collect({
      ...args,
      enqueue: {
        assign: (assignment) => assignments.push(assign(assignment)),
        raise: (event) =>
          (args.self as unknown as Actor<AnyMachine>).raise(event),
      },
    });
    for (const action of assignments)
      action(
        {
          ...args,
          context: (args.self as unknown as Actor<AnyMachine>).currentContext(),
        },
        undefined,
      );
  };
}

export function emit<Context, Event extends EventObject>(
  event: EventObject,
): ActionFunction<Context, Event> {
  return (args) => (args.self as unknown as Actor<AnyMachine>).emit(event);
}

export function and<Context, Event extends EventObject>(
  guards: Guard<Context, Event>[],
): Guard<Context, Event> {
  const guard = (args: ActionArgs<Context, Event>) =>
    guards.every((entry) => {
      if (typeof entry === "function") return entry(args);
      return (args.self as unknown as Actor<AnyMachine>).checkGuard(
        entry,
        args.event,
      );
    });
  return guard;
}

type PromiseLogic<Input, Output> = ActorLogic<Input, Output, undefined> & {
  kind: "promise";
  run(args: { input: Input; signal: AbortSignal }): PromiseLike<Output>;
};
export function fromPromise<Output, Input = unknown>(
  run: PromiseLogic<Input, Output>["run"],
): PromiseLogic<Input, Output> {
  return { kind: "promise", run };
}
type ObservableLogic<Input, Value> = ActorLogic<
  Input,
  undefined,
  Value | undefined
> & {
  kind: "observable";
  run(args: { input: Input }): Observable<Value>;
};
export function fromObservable<Value, Input = unknown>(
  run: ObservableLogic<Input, Value>["run"],
): ObservableLogic<Input, Value> {
  return { kind: "observable", run };
}
type CallbackLogic<Input> = ActorLogic<Input, undefined, undefined> & {
  kind: "callback";
  run(args: {
    input: Input;
    sendBack: (event: AnyEventObject) => void;
  }): void | (() => void);
};
export function fromCallback<Input>(
  run: CallbackLogic<Input>["run"],
): CallbackLogic<Input> {
  return { kind: "callback", run };
}

type AnyMachine = StateMachine<any, any, any, any>;
type RuntimeNode = {
  key: string;
  config: StateNode<any, AnyEventObject, Actors>;
};
type RuntimeEvent = {
  event: AnyEventObject;
  owner?: RuntimeNode;
  transitions?: Transitions<any, AnyEventObject>;
  valid?: () => boolean;
  failure?: { error: unknown };
};

const list = <Value>(value: OneOrMany<Value> | undefined): readonly Value[] =>
  value === undefined ? [] : Array.isArray(value) ? value : [value as Value];

export class Actor<Machine extends AnyMachine> {
  private readonly changes = new Channel<SnapshotFrom<Machine>>();
  private readonly emitted = new Channel<EventObject>();
  private readonly subscribers = new Set<Subscriber<SnapshotFrom<Machine>>>();
  private readonly eventSubscriptions = new Subscription();
  private readonly nodes = new Map<string, RuntimeNode>();
  private readonly resources = new Map<RuntimeNode, Subscription>();
  private readonly pending = new Map<RuntimeNode, AnyEventObject>();
  private readonly queue: RuntimeEvent[] = [];
  private readonly raised: AnyEventObject[] = [];
  private current: RuntimeNode;
  private snapshot: SnapshotFrom<Machine>;
  private started = false;
  private processing = false;
  private context: SnapshotFrom<Machine>["context"];

  constructor(
    private readonly machine: Machine,
    options: { input?: InputFrom<Machine> } = {},
  ) {
    if (machine.kind !== "machine")
      throw new Error("Expected an SDK state machine");
    for (const [key, config] of Object.entries(machine.config.states) as [
      string,
      RuntimeNode["config"],
    ][]) {
      if (
        "states" in config ||
        (config.type !== undefined && config.type !== "final")
      ) {
        throw new Error(
          "Only sequential states are supported; compose workflows with invoked machines",
        );
      }
      this.nodes.set(key, { key, config });
    }
    const initial = this.nodes.get(machine.config.initial);
    if (!initial)
      throw new Error(`Unknown initial state: ${machine.config.initial}`);
    this.current = initial;
    this.context =
      typeof machine.config.context === "function"
        ? machine.config.context({ input: options.input, self: this })
        : (machine.config.context ?? {});
    this.snapshot = {
      status: "active",
      context: this.context,
      value: machine.config.initial,
      output: undefined,
      error: undefined,
    } as SnapshotFrom<Machine>;
  }

  getSnapshot(): SnapshotFrom<Machine> {
    return this.snapshot;
  }

  subscribe(
    observer:
      | Partial<Observer<SnapshotFrom<Machine>>>
      | ((snapshot: SnapshotFrom<Machine>) => void),
  ): Subscription {
    const subscriber = new Subscriber(
      typeof observer === "function" ? { next: observer } : observer,
    );
    if (this.snapshot.status !== "active") {
      if (this.snapshot.status === "error")
        subscriber.error(this.snapshot.error);
      else subscriber.complete();
      return subscriber;
    }
    this.subscribers.add(subscriber);
    subscriber.add(() => this.subscribers.delete(subscriber));
    subscriber.add(
      this.changes.listen((snapshot) => {
        if (snapshot.status === "error") subscriber.error(snapshot.error);
        else {
          subscriber.next(snapshot);
          if (snapshot.status === "done") subscriber.complete();
        }
      }),
    );
    return subscriber;
  }

  on(type: string, handler: (event: EventObject) => void): Subscription {
    const subscriber = new Subscriber({ next: handler });
    this.eventSubscriptions.add(subscriber);
    subscriber.add(() => this.eventSubscriptions.remove(subscriber));
    subscriber.add(
      this.emitted.listen((event) => {
        if (event.type === type) subscriber.next(event);
      }),
    );
    return subscriber;
  }

  start(): this {
    if (this.started || this.snapshot.status !== "active") return this;
    this.started = true;
    this.processing = true;
    try {
      this.enter(this.current, { type: "xstate.init" });
      this.settle({ type: "xstate.init" });
      this.startPending();
      this.publish();
    } catch (error) {
      this.fail(error);
    }
    this.processing = false;
    this.drain();
    return this;
  }

  send(
    event: Machine extends StateMachine<any, any, any, infer Event>
      ? Event
      : never,
  ): void {
    this.enqueue({ event });
  }

  stop(): this {
    if (this.snapshot.status !== "active") return this;
    try {
      this.cleanup();
    } finally {
      this.snapshot = {
        ...this.snapshot,
        status: "stopped",
        output: undefined,
        error: undefined,
      } as SnapshotFrom<Machine>;
      for (const subscriber of this.subscribers) subscriber.complete();
    }
    return this;
  }

  checkGuard(
    guard: Guard<any, AnyEventObject>,
    event: AnyEventObject,
  ): boolean {
    const predicate =
      typeof guard === "string"
        ? this.machine.implementations.guards?.[guard]
        : guard;
    if (!predicate) throw new Error(`Unknown guard: ${String(guard)}`);
    return predicate(this.args(event));
  }

  assignContext(partial: object): void {
    this.context = { ...this.context, ...partial };
  }
  currentContext(): SnapshotFrom<Machine>["context"] {
    return this.context;
  }
  raise(event: AnyEventObject): void {
    this.raised.push(event);
  }
  emit(event: EventObject): void {
    this.emitted.emit(event);
  }

  private args(event: AnyEventObject): ActionArgs<any, AnyEventObject> {
    return { context: this.context, event, self: this };
  }

  private actions(
    actions: OneOrMany<Action<any, AnyEventObject>> | undefined,
    event: AnyEventObject,
  ): void {
    for (const action of list(actions)) {
      if (
        typeof action === "string" ||
        (typeof action === "object" && "type" in action)
      ) {
        const name = typeof action === "string" ? action : action.type;
        const implementation = this.machine.implementations.actions?.[name];
        if (!implementation) throw new Error(`Unknown action: ${name}`);
        const params =
          typeof action === "string"
            ? undefined
            : typeof action.params === "function"
              ? action.params(this.args(event))
              : action.params;
        implementation(this.args(event), params);
      } else action(this.args(event), undefined);
    }
  }

  private enter(node: RuntimeNode, event: AnyEventObject): void {
    this.current = node;
    this.resources.set(node, new Subscription());
    this.pending.set(node, event);
    this.actions(node.config.entry, event);
  }

  private exit(event: AnyEventObject): void {
    const node = this.current;
    this.actions(node.config.exit, event);
    this.resources.get(node)?.unsubscribe();
    this.resources.delete(node);
    this.pending.delete(node);
  }

  private select(
    transitions: Transitions<any, AnyEventObject> | undefined,
    event: AnyEventObject,
  ): Exclude<Transition<any, AnyEventObject>, string> | undefined {
    for (const candidate of list(transitions)) {
      const transition =
        typeof candidate === "string" ? { target: candidate } : candidate;
      if (!transition.guard || this.checkGuard(transition.guard, event))
        return transition;
    }
    return undefined;
  }

  private transition(
    owner: RuntimeNode,
    transitions: Transitions<any, AnyEventObject> | undefined,
    event: AnyEventObject,
  ): boolean {
    const selected = this.select(transitions, event);
    if (!selected) return false;
    if (!selected.target) {
      this.actions(selected.actions, event);
      return true;
    }
    const target = this.nodes.get(selected.target);
    if (!target) throw new Error(`Unknown target: ${selected.target}`);
    if (target === owner && !selected.reenter) {
      this.actions(selected.actions, event);
      return true;
    }
    this.exit(event);
    this.actions(selected.actions, event);
    this.enter(target, event);
    return true;
  }

  private dispatch(event: AnyEventObject): boolean {
    return this.transition(
      this.current,
      this.current.config.on?.[event.type],
      event,
    );
  }

  private settle(event: AnyEventObject): void {
    for (let steps = 0; steps < 10000; steps++) {
      if (this.current.config.type === "final") {
        const output = this.machine.config.output;
        this.snapshot = {
          ...this.snapshot,
          status: "done",
          output:
            typeof output === "function" ? output(this.args(event)) : output,
          error: undefined,
        } as SnapshotFrom<Machine>;
        this.cleanup();
        return;
      }
      if (this.transition(this.current, this.current.config.always, event))
        continue;
      const raised = this.raised.shift();
      if (!raised) return;
      this.dispatch(raised);
      event = raised;
    }
    throw new Error("Non-terminating eventless state transition");
  }

  private enqueue(event: RuntimeEvent): void {
    if (this.snapshot.status !== "active") return;
    this.queue.push(event);
    this.drain();
  }

  private drain(): void {
    if (!this.started || this.processing) return;
    this.processing = true;
    try {
      while (this.queue.length && this.snapshot.status === "active") {
        const next = this.queue.shift()!;
        if (next.valid && !next.valid()) continue;
        if (next.failure) throw next.failure.error;
        if (next.owner)
          this.transition(next.owner, next.transitions, next.event);
        else this.dispatch(next.event);
        this.settle(next.event);
        this.startPending();
        this.publish();
      }
    } catch (error) {
      this.fail(error);
    }
    this.processing = false;
  }

  private startPending(): void {
    if (this.snapshot.status !== "active") return;
    for (const [node, event] of this.pending) {
      this.pending.delete(node);
      const resources = this.resources.get(node)!;
      const valid = () =>
        !resources.closed && this.snapshot.status === "active";
      for (const [delay, transitions] of Object.entries(
        node.config.after ?? {},
      )) {
        const duration =
          this.machine.implementations.delays?.[delay] ?? Number(delay);
        if (!Number.isFinite(duration))
          throw new Error(`Unknown delay: ${delay}`);
        const handle = setTimeout(
          () =>
            this.enqueue({
              owner: node,
              transitions,
              event: { type: `xstate.after.${delay}` },
              valid,
            }),
          duration,
        );
        resources.add(() => clearTimeout(handle));
      }
      for (const invoke of list(node.config.invoke)) {
        const logic = this.machine.implementations.actors?.[
          invoke.src
        ] as ActorLogic;
        if (!logic) throw new Error(`Unknown actor: ${String(invoke.src)}`);
        const input =
          typeof invoke.input === "function"
            ? invoke.input(this.args(event))
            : invoke.input;
        const emit = (
          kind: "onDone" | "onError" | "onSnapshot",
          data: Record<string, unknown>,
        ) => {
          if (!valid()) return;
          if (kind === "onError" && !invoke.onError) {
            this.enqueue({
              event: { type: "xstate.error.actor" },
              failure: { error: data["error"] },
              valid,
            });
            return;
          }
          if (invoke[kind])
            this.enqueue({
              owner: node,
              transitions: invoke[kind] as Transitions<any, AnyEventObject>,
              event: {
                type: `xstate.${kind}.${invoke.id ?? String(invoke.src)}`,
                ...data,
              },
              valid,
            });
        };
        try {
          if (logic.kind === "machine") {
            const child = createActor(logic as AnyMachine, { input });
            resources.add(() => child.stop());
            resources.add(
              child.subscribe({
                next: (snapshot) => {
                  if (snapshot.status === "active")
                    emit("onSnapshot", { snapshot });
                  else if (snapshot.status === "done")
                    emit("onDone", { output: snapshot.output });
                },
                error: (error) => emit("onError", { error }),
              }),
            );
            child.start();
          } else if (logic.kind === "promise") {
            const controller = new AbortController();
            let settled = false;
            resources.add(() => {
              if (!settled) controller.abort();
            });
            emit("onSnapshot", {
              snapshot: {
                context: undefined,
                status: "active",
                output: undefined,
                error: undefined,
              },
            });
            try {
              Promise.resolve(
                (logic as PromiseLogic<any, any>).run({
                  input,
                  signal: controller.signal,
                }),
              ).then(
                (output) => {
                  settled = true;
                  emit("onDone", { output });
                },
                (error: unknown) => {
                  settled = true;
                  emit("onError", { error });
                },
              );
            } catch (error) {
              settled = true;
              emit("onError", { error });
            }
          } else if (logic.kind === "observable") {
            emit("onSnapshot", {
              snapshot: {
                context: undefined,
                status: "active",
                output: undefined,
                error: undefined,
              },
            });
            resources.add(
              (logic as ObservableLogic<any, any>).run({ input }).subscribe({
                next: (context) =>
                  emit("onSnapshot", {
                    snapshot: {
                      context,
                      status: "active",
                      output: undefined,
                      error: undefined,
                    },
                  }),
                error: (error) => emit("onError", { error }),
                complete: () => emit("onDone", { output: undefined }),
              }),
            );
          } else
            resources.add(
              (logic as CallbackLogic<any>).run({
                input,
                sendBack: (event) => {
                  if (valid()) this.enqueue({ event, valid });
                },
              }),
            );
        } catch (error) {
          emit("onError", { error });
        }
      }
    }
  }

  private publish(): void {
    this.snapshot = {
      ...this.snapshot,
      context: this.context,
      value: this.current.key,
    };
    this.changes.emit(this.snapshot);
  }

  private cleanup(): void {
    const resources = new Subscription();
    for (const subscription of this.resources.values())
      resources.add(subscription);
    resources.add(this.eventSubscriptions);
    this.resources.clear();
    this.pending.clear();
    this.queue.length = 0;
    this.raised.length = 0;
    resources.unsubscribe();
  }

  private fail(error: unknown): void {
    try {
      this.cleanup();
    } catch (cleanupError) {
      error = new AggregateError([error, cleanupError], "Actor cleanup failed");
    }
    this.snapshot = {
      ...this.snapshot,
      status: "error",
      error,
      output: undefined,
    } as SnapshotFrom<Machine>;
    this.publish();
  }
}

export function createActor<Machine extends AnyMachine>(
  machine: Machine,
  options?: { input?: InputFrom<Machine> },
): Actor<Machine> {
  return new Actor(machine, options);
}
