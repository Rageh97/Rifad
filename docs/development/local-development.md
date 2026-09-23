# Local development

Use Node **24.21.0**, pnpm **11.19.0** and a supported shell. Do not change a machine-wide runtime merely for this project; an external version manager or ignored workspace-local runtime is acceptable. The lockfile pins dependencies.

From the repository root:

```text
pnpm install --frozen-lockfile
pnpm check
pnpm check:security
pnpm projects
```

In separate terminals use `pnpm dev:api`, `pnpm dev:worker`, `pnpm dev:edge`. Each serves only `GET /health/live` on loopback: API 3000, Edge 3001, Worker 3002. Worker has no jobs yet. Stop with Ctrl+C. Built entry points are each application's dist/main.js.

Set optional RIFAD_ENV=local|test, RIFAD_RUNTIME matching the process, RIFAD_HOST=127.0.0.1 and RIFAD_PORT=1..65535. Defaults work without an environment file. The [example](../../infra/local/.env.example) is documentation, not automatically loaded. Production/staging and unknown RIFAD settings fail closed in this batch; no real endpoints or secrets are accepted as project configuration.

No database, Redis, Cloud service, terminal or provider is required. Edge startup must work alone. An occupied port or invalid configuration emits a stable value-free failure and exits nonzero. Process smoke tests use ephemeral ports and a loopback-only network guard.

`pnpm build` uses TypeScript project references. Nx discovers tagged projects and their dependency graph; no Nx Cloud account is configured. Generated/temporary files are ignored. Do not introduce a persistence or external-provider workaround for a Batch 1 startup problem.
