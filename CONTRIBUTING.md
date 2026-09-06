# Contributing

## Running the suites

```sh
npm ci
npm test                 # offline unit tests, in-memory transport and exporter
npm run test:integration # two processes over stdio, then Jaeger (docker run command in the README)
npm run conformance      # official conformance suite, bare server against instrumented server
npm run typecheck && npm run lint && npm run build
```

CI runs the unit suite on Node 20, 22 and 24, and the integration suite against a Jaeger service container.

## What a pull request needs

- A test for every behavior it adds or changes, written so that it fails without the change.
- No em dash or en dash anywhere; `npm run lint` checks that.
- Attribute names go through `src/semconv.ts`, `_meta` keys through `src/keys.ts`.
- A line in `CHANGELOG.md` under Unreleased.

## Reporting a bug

Open an issue with the SDK version, the transport, and, if possible, the JSON of the spans you got (the `StderrJsonLinesExporter` of `examples/telemetry.ts` prints them).
