import { Channel } from "./channel";

export type Observer<Value> = {
  next(value: Value): void;
  error(error: unknown): void;
  complete(): void;
};
export type Teardown = void | (() => void) | { unsubscribe(): void };
export type ObservableInput<Value> =
  | Observable<Value>
  | PromiseLike<Value>
  | Iterable<Value>;
export type OperatorFunction<Input, Output> = (
  source: Observable<Input>,
) => Observable<Output>;

export class Subscription {
  closed = false;
  private readonly teardowns = new Set<Exclude<Teardown, void>>();

  constructor(teardown?: () => void) {
    this.add(teardown);
  }

  add(teardown: Teardown): void {
    if (!teardown || teardown === this) return;
    if (this.closed) {
      if (typeof teardown === "function") teardown();
      else teardown.unsubscribe();
    } else this.teardowns.add(teardown);
  }

  remove(teardown: Exclude<Teardown, void>): void {
    this.teardowns.delete(teardown);
  }

  unsubscribe(): void {
    if (this.closed) return;
    this.closed = true;
    const errors: unknown[] = [];
    for (const teardown of this.teardowns) {
      try {
        if (typeof teardown === "function") teardown();
        else teardown.unsubscribe();
      } catch (error) {
        errors.push(error);
      }
    }
    this.teardowns.clear();
    if (errors.length)
      throw new AggregateError(errors, "Unsubscription failed");
  }
}

function reportError(error: unknown): void {
  setTimeout(() => {
    throw error;
  });
}

export class Subscriber<Value> extends Subscription implements Observer<Value> {
  private stopped = false;

  constructor(private readonly observer: Partial<Observer<Value>>) {
    super();
  }

  next(value: Value): void {
    if (this.closed || this.stopped) return;
    try {
      this.observer.next?.(value);
    } catch (error) {
      reportError(error);
    }
  }

  error(error: unknown): void {
    if (this.closed || this.stopped) return;
    this.stopped = true;
    try {
      if (this.observer.error) this.observer.error(error);
      else reportError(error);
    } catch (observerError) {
      reportError(observerError);
    } finally {
      this.unsubscribe();
    }
  }

  complete(): void {
    if (this.closed || this.stopped) return;
    this.stopped = true;
    try {
      this.observer.complete?.();
    } catch (error) {
      reportError(error);
    } finally {
      this.unsubscribe();
    }
  }
}

export class Observable<Value> {
  constructor(
    private readonly producer: (sink: Subscriber<Value>) => Teardown,
  ) {}

  subscribe(
    observer: Partial<Observer<Value>> | ((value: Value) => void) = {},
  ): Subscription {
    const sink =
      observer instanceof Subscriber
        ? observer
        : new Subscriber(
            typeof observer === "function" ? { next: observer } : observer,
          );
    if (!sink.closed) {
      try {
        sink.add(this.producer(sink));
      } catch (error) {
        sink.error(error);
      }
    }
    return sink;
  }

  ["@@observable"](): Observable<Value> {
    return this;
  }

  pipe(): Observable<Value>;
  pipe<Output1>(op1: OperatorFunction<Value, Output1>): Observable<Output1>;
  pipe<Output1, Output2>(
    op1: OperatorFunction<Value, Output1>,
    op2: OperatorFunction<Output1, Output2>,
  ): Observable<Output2>;
  pipe<Output1, Output2, Output3>(
    op1: OperatorFunction<Value, Output1>,
    op2: OperatorFunction<Output1, Output2>,
    op3: OperatorFunction<Output2, Output3>,
  ): Observable<Output3>;
  pipe<Output1, Output2, Output3, Output4>(
    op1: OperatorFunction<Value, Output1>,
    op2: OperatorFunction<Output1, Output2>,
    op3: OperatorFunction<Output2, Output3>,
    op4: OperatorFunction<Output3, Output4>,
  ): Observable<Output4>;
  pipe<Output1, Output2, Output3, Output4, Output5>(
    op1: OperatorFunction<Value, Output1>,
    op2: OperatorFunction<Output1, Output2>,
    op3: OperatorFunction<Output2, Output3>,
    op4: OperatorFunction<Output3, Output4>,
    op5: OperatorFunction<Output4, Output5>,
  ): Observable<Output5>;
  pipe<Output1, Output2, Output3, Output4, Output5, Output6>(
    op1: OperatorFunction<Value, Output1>,
    op2: OperatorFunction<Output1, Output2>,
    op3: OperatorFunction<Output2, Output3>,
    op4: OperatorFunction<Output3, Output4>,
    op5: OperatorFunction<Output4, Output5>,
    op6: OperatorFunction<Output5, Output6>,
  ): Observable<Output6>;
  pipe<Output1, Output2, Output3, Output4, Output5, Output6, Output7>(
    op1: OperatorFunction<Value, Output1>,
    op2: OperatorFunction<Output1, Output2>,
    op3: OperatorFunction<Output2, Output3>,
    op4: OperatorFunction<Output3, Output4>,
    op5: OperatorFunction<Output4, Output5>,
    op6: OperatorFunction<Output5, Output6>,
    op7: OperatorFunction<Output6, Output7>,
  ): Observable<Output7>;
  pipe<Output1, Output2, Output3, Output4, Output5, Output6, Output7, Output8>(
    op1: OperatorFunction<Value, Output1>,
    op2: OperatorFunction<Output1, Output2>,
    op3: OperatorFunction<Output2, Output3>,
    op4: OperatorFunction<Output3, Output4>,
    op5: OperatorFunction<Output4, Output5>,
    op6: OperatorFunction<Output5, Output6>,
    op7: OperatorFunction<Output6, Output7>,
    op8: OperatorFunction<Output7, Output8>,
  ): Observable<Output8>;
  pipe<
    Output1,
    Output2,
    Output3,
    Output4,
    Output5,
    Output6,
    Output7,
    Output8,
    Output9,
  >(
    op1: OperatorFunction<Value, Output1>,
    op2: OperatorFunction<Output1, Output2>,
    op3: OperatorFunction<Output2, Output3>,
    op4: OperatorFunction<Output3, Output4>,
    op5: OperatorFunction<Output4, Output5>,
    op6: OperatorFunction<Output5, Output6>,
    op7: OperatorFunction<Output6, Output7>,
    op8: OperatorFunction<Output7, Output8>,
    op9: OperatorFunction<Output8, Output9>,
  ): Observable<Output9>;
  pipe(...operators: OperatorFunction<never, unknown>[]): Observable<unknown> {
    return operators.reduce<Observable<unknown>>(
      (source, operator) => operator(source as Observable<never>),
      this,
    );
  }
}

type Notification<Value> =
  | { type: "next"; value: Value }
  | { type: "error"; error: unknown }
  | { type: "complete" };

export class Subject<Value>
  extends Observable<Value>
  implements Observer<Value>
{
  private readonly channel = new Channel<Notification<Value>>();
  protected terminal?: Exclude<Notification<Value>, { type: "next" }>;

  constructor() {
    super((sink) => this.attach(sink));
  }

  protected attach(sink: Subscriber<Value>): Teardown {
    if (this.terminal) {
      this.deliver(sink, this.terminal);
      return;
    }
    return this.channel.listen((notification) =>
      this.deliver(sink, notification),
    );
  }

  private deliver(
    sink: Subscriber<Value>,
    notification: Notification<Value>,
  ): void {
    if (notification.type === "next") sink.next(notification.value);
    else if (notification.type === "error") sink.error(notification.error);
    else sink.complete();
  }

  next(value: Value): void {
    if (!this.terminal) this.channel.emit({ type: "next", value });
  }

  error(error: unknown): void {
    if (this.terminal) return;
    this.terminal = { type: "error", error };
    this.channel.emit(this.terminal);
  }

  complete(): void {
    if (this.terminal) return;
    this.terminal = { type: "complete" };
    this.channel.emit(this.terminal);
  }

  asObservable(): Observable<Value> {
    return new Observable((sink) => this.subscribe(sink));
  }
}

export class BehaviorSubject<Value> extends Subject<Value> {
  constructor(private currentValue: Value) {
    super();
  }

  get value(): Value {
    if (this.terminal?.type === "error") throw this.terminal.error;
    return this.currentValue;
  }

  getValue(): Value {
    return this.value;
  }

  protected override attach(sink: Subscriber<Value>): Teardown {
    const teardown = super.attach(sink);
    if (!sink.closed) sink.next(this.currentValue);
    return teardown;
  }

  override next(value: Value): void {
    this.currentValue = value;
    super.next(value);
  }
}

export class ReplaySubject<Value> extends Subject<Value> {
  private readonly values: Value[] = [];

  constructor(private readonly bufferSize = Infinity) {
    super();
  }

  protected override attach(sink: Subscriber<Value>): Teardown {
    const teardown = this.terminal ? undefined : super.attach(sink);
    for (const value of [...this.values]) {
      if (sink.closed) break;
      sink.next(value);
    }
    if (this.terminal) super.attach(sink);
    return teardown;
  }

  override next(value: Value): void {
    if (this.terminal) return;
    this.values.push(value);
    if (this.values.length > Math.max(1, this.bufferSize)) this.values.shift();
    super.next(value);
  }
}

function connect<Input, Output>(
  source: Observable<Input>,
  sink: Subscriber<Output>,
  handlers: Partial<Observer<Input>>,
  beforeSubscribe?: (upstream: Subscriber<Input>) => void,
): Subscriber<Input> {
  const upstream = new Subscriber<Input>({
    next: (value) => {
      try {
        handlers.next?.(value);
      } catch (error) {
        sink.error(error);
      }
    },
    error: (error) => {
      try {
        upstream.unsubscribe();
        if (handlers.error) handlers.error(error);
        else sink.error(error);
      } catch (caught) {
        sink.error(caught);
      }
    },
    complete: () => {
      try {
        if (handlers.complete) handlers.complete();
        else sink.complete();
      } catch (error) {
        sink.error(error);
      }
    },
  });
  sink.add(upstream);
  upstream.add(() => sink.remove(upstream));
  beforeSubscribe?.(upstream);
  source.subscribe(upstream);
  return upstream;
}

export function of<Value>(...values: Value[]): Observable<Value> {
  return from(values);
}

export function from<Value>(input: ObservableInput<Value>): Observable<Value> {
  if (input instanceof Observable) return input;
  return new Observable((sink) => {
    if ("then" in input) {
      input.then(
        (value) => {
          sink.next(value);
          sink.complete();
        },
        (error: unknown) => sink.error(error),
      );
    } else {
      for (const value of input) {
        if (sink.closed) break;
        sink.next(value);
      }
      sink.complete();
    }
  });
}

export function defer<Value>(
  factory: () => ObservableInput<Value>,
): Observable<Value> {
  return new Observable((sink) => from(factory()).subscribe(sink));
}

export function throwError(factory: () => unknown): Observable<never> {
  return new Observable((sink) => sink.error(factory()));
}

export function map<Input, Output>(
  project: (value: Input, index: number) => Output,
): OperatorFunction<Input, Output> {
  return (source) =>
    new Observable((sink) => {
      let index = 0;
      return connect(source, sink, {
        next: (value) => sink.next(project(value, index++)),
      });
    });
}

export function filter<Value, Result extends Value>(
  predicate: (value: Value, index: number) => value is Result,
): OperatorFunction<Value, Result>;
export function filter<Value>(
  predicate: (value: Value, index: number) => boolean,
): OperatorFunction<Value, Value>;
export function filter<Value>(
  predicate: (value: Value, index: number) => boolean,
): OperatorFunction<Value, Value> {
  return (source) =>
    new Observable((sink) => {
      let index = 0;
      return connect(source, sink, {
        next: (value) => {
          if (predicate(value, index++)) sink.next(value);
        },
      });
    });
}

export function tap<Value>(
  observer: Partial<Observer<Value>> | ((value: Value) => void),
): OperatorFunction<Value, Value> {
  const handlers =
    typeof observer === "function" ? { next: observer } : observer;
  return (source) =>
    new Observable((sink) =>
      connect(source, sink, {
        next: (value) => {
          handlers.next?.(value);
          sink.next(value);
        },
        error: (error) => {
          handlers.error?.(error);
          sink.error(error);
        },
        complete: () => {
          handlers.complete?.();
          sink.complete();
        },
      }),
    );
}

export function finalize<Value>(
  callback: () => void,
): OperatorFunction<Value, Value> {
  return (source) =>
    new Observable((sink) => {
      source.subscribe(sink);
      sink.add(callback);
    });
}

export function startWith<Value>(
  ...values: Value[]
): OperatorFunction<Value, Value> {
  return (source) => concat(of(...values), source);
}

export function scan<Value, Accumulator>(
  reduce: (
    accumulator: Accumulator,
    value: Value,
    index: number,
  ) => Accumulator,
  seed: Accumulator,
): OperatorFunction<Value, Accumulator> {
  return (source) =>
    new Observable((sink) => {
      let accumulator = seed;
      let index = 0;
      return connect(source, sink, {
        next: (value) => {
          accumulator = reduce(accumulator, value, index++);
          sink.next(accumulator);
        },
      });
    });
}

export function distinctUntilChanged<Value>(
  compare: (previous: Value, current: Value) => boolean = (previous, current) =>
    previous === current,
): OperatorFunction<Value, Value> {
  return (source) =>
    new Observable((sink) => {
      let seen = false;
      let previous: Value;
      return connect(source, sink, {
        next: (value) => {
          if (!seen || !compare(previous, value)) {
            seen = true;
            previous = value;
            sink.next(value);
          }
        },
      });
    });
}

export function distinct<Value, Key>(
  keySelector: (value: Value) => Key,
): OperatorFunction<Value, Value> {
  return (source) =>
    new Observable((sink) => {
      const keys = new Set<Key>();
      return connect(source, sink, {
        next: (value) => {
          const key = keySelector(value);
          if (!keys.has(key)) {
            keys.add(key);
            sink.next(value);
          }
        },
      });
    });
}

export function take<Value>(count: number): OperatorFunction<Value, Value> {
  return (source) =>
    new Observable((sink) => {
      if (count <= 0) {
        sink.complete();
        return;
      }
      let remaining = count;
      let upstream: Subscriber<Value>;
      return connect(
        source,
        sink,
        {
          next: (value) => {
            remaining--;
            if (remaining === 0) upstream.unsubscribe();
            sink.next(value);
            if (remaining === 0) sink.complete();
          },
        },
        (subscriber) => {
          upstream = subscriber;
        },
      );
    });
}

export class EmptyError extends Error {
  constructor() {
    super("no elements in sequence");
    this.name = "EmptyError";
  }
}

export class TimeoutError extends Error {
  constructor() {
    super("Timeout has occurred");
    this.name = "TimeoutError";
  }
}

export function first<Value>(
  predicate: (value: Value, index: number) => boolean = () => true,
): OperatorFunction<Value, Value> {
  return (source) =>
    new Observable((sink) => {
      let index = 0;
      let upstream: Subscriber<Value>;
      return connect(
        source,
        sink,
        {
          next: (value) => {
            if (predicate(value, index++)) {
              upstream.unsubscribe();
              sink.next(value);
              sink.complete();
            }
          },
          complete: () => sink.error(new EmptyError()),
        },
        (subscriber) => {
          upstream = subscriber;
        },
      );
    });
}

export function toArray<Value>(): OperatorFunction<Value, Value[]> {
  return (source) =>
    new Observable((sink) => {
      const values: Value[] = [];
      return connect(source, sink, {
        next: (value) => values.push(value),
        complete: () => {
          sink.next(values);
          sink.complete();
        },
      });
    });
}

export function firstValueFrom<Value>(
  source: Observable<Value>,
): Promise<Value> {
  return new Promise((resolve, reject) => {
    const sink = new Subscriber<Value>({
      next: (value) => {
        resolve(value);
        sink.unsubscribe();
      },
      error: reject,
      complete: () => reject(new EmptyError()),
    });
    source.subscribe(sink);
  });
}

export function lastValueFrom<Value>(
  source: Observable<Value>,
): Promise<Value> {
  return new Promise((resolve, reject) => {
    let seen = false;
    let latest: Value;
    source.subscribe({
      next: (value) => {
        seen = true;
        latest = value;
      },
      error: reject,
      complete: () => {
        if (seen) resolve(latest);
        else reject(new EmptyError());
      },
    });
  });
}

export function mergeMap<Input, Output>(
  project: (value: Input, index: number) => ObservableInput<Output>,
): OperatorFunction<Input, Output> {
  return (source) =>
    new Observable((sink) => {
      let active = 0;
      let done = false;
      let index = 0;
      const complete = () => {
        if (done && active === 0) sink.complete();
      };
      return connect(source, sink, {
        next: (value) => {
          active++;
          connect(from(project(value, index++)), sink, {
            next: (result) => sink.next(result),
            complete: () => {
              active--;
              complete();
            },
          });
        },
        complete: () => {
          done = true;
          complete();
        },
      });
    });
}

export function switchMap<Input, Output>(
  project: (value: Input, index: number) => ObservableInput<Output>,
): OperatorFunction<Input, Output> {
  return (source) =>
    new Observable((sink) => {
      let inner: Subscription | undefined;
      let active = false;
      let done = false;
      let index = 0;
      return connect(source, sink, {
        next: (value) => {
          inner?.unsubscribe();
          active = true;
          connect(
            from(project(value, index++)),
            sink,
            {
              next: (result) => sink.next(result),
              complete: () => {
                active = false;
                if (done) sink.complete();
              },
            },
            (upstream) => {
              inner = upstream;
            },
          );
        },
        complete: () => {
          done = true;
          if (!active) sink.complete();
        },
      });
    });
}

export function merge<Value>(
  ...sources: ObservableInput<Value>[]
): Observable<Value> {
  return from(sources).pipe(mergeMap((source) => source));
}

export function concat<Value>(
  ...sources: ObservableInput<Value>[]
): Observable<Value> {
  return new Observable((sink) => {
    let index = 0;
    let subscribing = false;
    const next = () => {
      if (subscribing) return;
      while (!sink.closed) {
        if (index === sources.length) {
          sink.complete();
          return;
        }
        let completed = false;
        let upstream: Subscriber<Value>;
        subscribing = true;
        connect(
          from(sources[index++]!),
          sink,
          {
            next: (value) => sink.next(value),
            complete: () => {
              upstream.unsubscribe();
              completed = true;
              next();
            },
          },
          (subscriber) => {
            upstream = subscriber;
          },
        );
        subscribing = false;
        if (!completed) return;
      }
    };
    next();
  });
}

export function catchError<Value, Recovery>(
  recover: (error: unknown) => ObservableInput<Recovery>,
): OperatorFunction<Value, Value | Recovery> {
  return (source) =>
    new Observable((sink) => {
      let upstream: Subscription | null = null;
      let synchronous: (() => void) | undefined;
      upstream = connect(source, sink, {
        next: (value) => sink.next(value),
        error: (error) => {
          const replacement = from(recover(error));
          const resume = () => {
            upstream?.unsubscribe();
            replacement.subscribe(sink);
          };
          if (upstream) resume();
          else synchronous = resume;
        },
      });
      synchronous?.();
    });
}

export function retry<Value>(count: number): OperatorFunction<Value, Value> {
  return (source) =>
    new Observable((sink) => {
      let remaining = count;
      const attempt = () => {
        let again = true;
        while (again && !sink.closed) {
          again = false;
          let synchronous = true;
          connect(source, sink, {
            next: (value) => sink.next(value),
            error: (error) => {
              if (remaining-- <= 0) sink.error(error);
              else if (synchronous) again = true;
              else attempt();
            },
          });
          synchronous = false;
        }
      };
      attempt();
    });
}

export function timer(due: number, period?: number): Observable<number> {
  return new Observable((sink) => {
    let count = 0;
    let handle: ReturnType<typeof setTimeout>;
    const tick = () => {
      sink.next(count++);
      if (period === undefined) sink.complete();
      else if (!sink.closed) handle = setTimeout(tick, Math.max(0, period));
    };
    handle = setTimeout(tick, Math.max(0, due));
    return () => clearTimeout(handle);
  });
}

export function interval(period: number): Observable<number> {
  return timer(period, period);
}

export function withLatestFrom<Value, Latest>(
  latest: Observable<Latest>,
): OperatorFunction<Value, [Value, Latest]> {
  return (source) =>
    new Observable((sink) => {
      let seen = false;
      let value: Latest;
      connect(latest, sink, {
        next: (next) => {
          seen = true;
          value = next;
        },
        complete: () => {},
      });
      return connect(source, sink, {
        next: (next) => {
          if (seen) sink.next([next, value]);
        },
      });
    });
}

export function debounceTime<Value>(
  duration: number,
): OperatorFunction<Value, Value> {
  return (source) =>
    new Observable((sink) => {
      let handle: ReturnType<typeof setTimeout> | undefined;
      let latest: Value;
      const flush = () => {
        if (handle !== undefined) {
          clearTimeout(handle);
          handle = undefined;
          sink.next(latest);
        }
      };
      sink.add(() => clearTimeout(handle));
      return connect(source, sink, {
        next: (value) => {
          latest = value;
          clearTimeout(handle);
          handle = setTimeout(flush, duration);
        },
        complete: () => {
          flush();
          sink.complete();
        },
      });
    });
}

export function throttleTime<Value>(
  duration: number,
): OperatorFunction<Value, Value> {
  return (source) =>
    new Observable((sink) => {
      let handle: ReturnType<typeof setTimeout> | undefined;
      sink.add(() => clearTimeout(handle));
      return connect(source, sink, {
        next: (value) => {
          if (handle !== undefined) return;
          handle = setTimeout(() => {
            handle = undefined;
          }, duration);
          sink.next(value);
        },
      });
    });
}

export function delay<Value>(duration: number): OperatorFunction<Value, Value> {
  return mergeMap((value) => timer(duration).pipe(map(() => value)));
}

export function timeout<Value>(
  config: number | { each: number; with?: () => ObservableInput<Value> },
): OperatorFunction<Value, Value> {
  const { each, with: fallback } =
    typeof config === "number" ? { each: config } : config;
  return (source) =>
    new Observable((sink) => {
      let handle: ReturnType<typeof setTimeout>;
      const reset = () => {
        clearTimeout(handle);
        if (sink.closed) return;
        handle = setTimeout(() => {
          upstream?.unsubscribe();
          try {
            if (fallback) from(fallback()).subscribe(sink);
            else sink.error(new TimeoutError());
          } catch (error) {
            sink.error(error);
          }
        }, each);
      };
      sink.add(() => clearTimeout(handle));
      reset();
      const upstream = connect(source, sink, {
        next: (value) => {
          clearTimeout(handle);
          sink.next(value);
          reset();
        },
      });
    });
}

export function share<Value>(): OperatorFunction<Value, Value> {
  return (source) => {
    let subject: Subject<Value> | undefined;
    let connection: Subscriber<Value> | undefined;
    let references = 0;
    const reset = () => {
      subject = undefined;
      connection = undefined;
    };
    return new Observable((sink) => {
      references++;
      const current = (subject ??= new Subject<Value>());
      sink.add(() => {
        if (--references === 0) {
          const previous = connection;
          reset();
          previous?.unsubscribe();
        }
      });
      current.subscribe(sink);
      if (!connection && !sink.closed) {
        connection = new Subscriber({
          next: (value) => current.next(value),
          error: (error) => {
            reset();
            current.error(error);
          },
          complete: () => {
            reset();
            current.complete();
          },
        });
        source.subscribe(connection);
      }
    });
  };
}
