# SDK reactivity

Small, SDK-specific replacements for RxJS streams and XState actors. The only
runtime dependency is `@nx-js/observer-util`. RxJS and XState are development-only
test oracles; neither is imported by the published runtime.

## Streams

Import `Observable`, subjects, subscriptions, and operators from
`@ledgerhq/device-sdk-reactivity`. The SDK retains its `subscribe`, `pipe`, and
`unsubscribe` API, including synchronous delivery, completion/error handling,
reference-counted sharing, replay, timers, and cancellation.

The supported operators are exactly those used in the SDK and its tests:
`catchError`, `debounceTime`, `delay`, `distinct`, `distinctUntilChanged`, `filter`,
`finalize`, `first`, `map`, `mergeMap`, `retry`, `scan`, `share`, `startWith`,
`switchMap`, `take`, `tap`, `throttleTime`, `timeout`, `toArray`, and
`withLatestFrom`. Creation/conversion helpers are `concat`, `defer`, `firstValueFrom`,
`from`, `interval`, `lastValueFrom`, `merge`, `of`, `throwError`, and `timer`.
Only the argument forms exercised by the SDK are supported: no custom schedulers,
operator concurrency options, time-windowed replay, or other RxJS extensions.

Subjects dispatch through observer-util reactions. Values are kept outside its
proxies: byte arrays, error objects, class instances, and repeated values retain
their identity. Cancellation releases reactions, timers, and upstream work.
Completed inner subscriptions are detached from long-lived streams.

## State machines

Import `setup`, `createMachine`, `createActor`, `assign`, `enqueueActions`, `and`,
`emit`, `fromPromise`, `fromObservable`, and `fromCallback` from
`@ledgerhq/device-sdk-reactivity/state-machine`.

The interpreter supports sequential states, entry/exit actions,
ordered guards, eventless transitions, numeric/named delays, raised events,
invoked children, snapshots, final output, and actor cancellation. Promise actors
receive an abort signal; exited/stopped actors cannot deliver stale results.
Observer-util reactions dispatch actor snapshots as well as stream notifications.

This is not a general-purpose XState replacement. Nested/parallel/history states,
persistence, spawning, inspector integration, and the rest of XState's API are
intentionally absent. The SDK keeps `XStateDeviceAction` as a legacy export name
so existing device action subclasses do not need renaming.

Context, input, output, invocation, and event types are checked at machine
construction. The interpreter erases heterogeneous node/action types internally;
that is the reason for the file-scoped explicit-`any` lint allowance. This does
not turn off TypeScript's strict checks for consumers or other packages.

## Consumer migration

- Replace imports from `rxjs` and `rxjs/operators` with
  `@ledgerhq/device-sdk-reactivity`.
- Replace imports from `xstate` with
  `@ledgerhq/device-sdk-reactivity/state-machine` for the supported API above.
- Add the reactivity package as a direct dependency when importing its operators.
  RxJS is no longer an SDK peer dependency.
- Do not mix RxJS operators with these observables: they are not RxJS instances
  and do not implement its internal `lift` API. To bridge to an existing RxJS
  consumer, explicitly adapt with `new RxObservable(sink => sdk.subscribe(sink))`
  and return the subscription so teardown is preserved.

The SDK monorepo consumers and signer generator are migrated together. Custom
device actions using XState features beyond this subset require an explicit
rewrite; do not pass an XState machine to the new interpreter.

## Verification

Run `pnpm --filter @ledgerhq/device-sdk-reactivity test` for differential lifecycle
tests against the previous RxJS/XState versions. Run the affected SDK package
tests for the device, connection, and signing state sequences. Both sets matter:
operator-level equivalence alone does not verify the signing workflows.
