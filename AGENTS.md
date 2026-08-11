# Repository Guidelines

## Project Overview

S.E.N.T.R.A. is a strict-TypeScript trading-journal monorepo: a React/Vite SPA, NestJS API, PostgreSQL/Prisma persistence, chart-image storage, authentication, and MT5 account/history synchronization. Cross-package request/response types live in `packages/shared`.

## Architecture & Data Flow

- `apps/web/src/main.tsx` mounts `App`; `apps/web/src/App.tsx` is the UI composition root. It owns hook state and switches views with a local `AppView` value—there is no URL router, global store, or query cache.
- `apps/web/src/api/client.ts` centralizes credentialed API requests. Components receive data and callbacks through props and update state immutably.
- `apps/api/src/main.ts` boots Nest on `0.0.0.0:${PORT:-3000}`, configures credentialed CORS, and requires an exact `WEB_ORIGIN`. `app.module.ts` composes auth, MT5 accounts, trade log, and health modules.
- API requests flow controller/guard → feature service → `PrismaService` → PostgreSQL. Controllers stay thin; validation, authorization, transactions, DTO conversion, sync, and domain behavior belong in services.
- `packages/shared/src/index.ts` contains compile-time contracts only. Runtime input checks use feature-local `validate*Request` functions.
- MT5 sync uses the authenticated bridge client, transactionally stores raw orders/deals and sync state, then projects positions into trades. New trades receive a required empty analysis; projection must not overwrite user analysis.
- Trade creation and required `TradeAnalysis` creation are atomic. Scale-ins remain separate trades linked to a root trade.
- Image metadata is stored in PostgreSQL; image bytes live under `TRADE_IMAGE_DIR`.
- Never expose `MT5_SYNC_TOKEN` to the browser. Production uses `/api`; Caddy injects the trusted sync header.

## Key Directories

- `apps/api/src/auth/`: credentials, sessions, guards, and authorization.
- `apps/api/src/mt5-accounts/`: encrypted account management, bridge access, sync leases/state, and projection orchestration.
- `apps/api/src/trade-log/`: trade CRUD, analysis, statistics, campaigns, chart images, and assistant actions.
- `apps/api/src/prisma/`: injectable Prisma client lifecycle.
- `apps/api/prisma/`: PostgreSQL schema and ordered migration history.
- `apps/api/scripts/`: one-time migration preparation, verification, recovery, and backfill programs.
- `apps/web/src/`: SPA shell, API client, auth UI, feature components, tests, and global CSS.
- `packages/shared/src/`: public frontend/backend TypeScript contracts.
- `infra/caddy/`: production reverse proxy and trusted sync-token injection.
- `docs/operations/`: MT5 and analysis cutover/runbook documentation.
- `poc/mt5-history-reader/`: isolated Python/Wine socket-RPC experiment; it is outside the pnpm workspace and is not the API's authenticated HTTP bridge.

## Development Commands

Requires Node.js 22+ and pinned `pnpm@10.26.0`.

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm dev         # API watch mode + Vite
pnpm build       # shared → API → web
pnpm typecheck   # shared → API → web
pnpm test        # API Jest + web Vitest
```

Focused commands:

```bash
pnpm --filter @trading-journal/api test
pnpm --filter @trading-journal/web test
pnpm --filter @trading-journal/api prisma:generate
pnpm --filter @trading-journal/api prisma:migrate
```

Local Compose stack:

```bash
cp .env.example .env
docker compose up -d --build
```

Production overlay:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

Host-local `pnpm dev` needs process environment variables and a host-reachable migrated PostgreSQL database; Nest does not load the root `.env` automatically. `pnpm lint` currently has no package lint scripts, and no repository formatter is configured—do not claim lint or format coverage.

## Code Conventions & Common Patterns

- TypeScript is strict. API uses CommonJS/ES2022, web uses ESNext/Bundler resolution, and shared uses NodeNext ESM with declarations.
- Use kebab-case feature directories and Nest suffixes (`*.module.ts`, `*.controller.ts`, `*.service.ts`).
- Use PascalCase for classes, React components, and DTO types; camelCase for functions/state; `handle*` for UI handlers; `UPPER_SNAKE_CASE` for constants.
- Name shared contracts explicitly, for example `PatchTradeAnalysisRequest`, `TradeAnalysis`, and `TradeStatsResponse`.
- Use constructor injection at Nest boundaries. Keep controllers thin and implement business behavior in services.
- Validate unknown request data explicitly. Use Nest exceptions such as `BadRequestException`, `NotFoundException`, `UnauthorizedException`, and `BadGatewayException`.
- Convert Prisma `Decimal`, `bigint`, enum, and `Date` values explicitly before returning shared DTOs.
- Use `async`/`await` and Prisma `$transaction` for related persistence changes; preserve trade/analysis atomicity and sync lease invariants.
- Frontend code uses React hooks, prop-driven components, immutable updates, and explicit loading/error state.
- CSS is global in `apps/web/src/styles.css`; reuse existing tokens and kebab-case semantic classes. UI/domain copy intentionally mixes English and Korean.
- Never rewrite an applied file in `apps/api/prisma/migrations`; add a timestamped migration and account for existing data.

## Important Files

- `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`: runtime, workspace commands, boundaries, and dependency lock.
- `apps/api/src/main.ts`, `apps/api/src/app.module.ts`: API bootstrap and root DI graph.
- `apps/api/src/auth/auth.service.ts`, `apps/api/src/auth/session.service.ts`: authentication and session lifecycle.
- `apps/api/src/mt5-accounts/mt5-sync.service.ts`, `mt5-bridge.client.ts`: sync orchestration and bridge boundary.
- `apps/api/src/trade-log/trade-log.service.ts`: primary journal domain/application service.
- `apps/api/prisma/schema.prisma`: data model, relations, and cascade semantics.
- `apps/web/src/App.tsx`, `apps/web/src/api/client.ts`: SPA composition/state and API boundary.
- `packages/shared/src/index.ts`: public cross-package contracts.
- `docker-compose.yml`, `docker-compose.prod.yml`, `infra/caddy/Caddyfile`: deployment topology and `/api` routing.
- `.env.example`: environment contract; never commit a real `.env`.

## Runtime/Tooling Preferences

- Use pnpm only. Keep `pnpm-lock.yaml` authoritative and use frozen installs in reproducible environments.
- Build `@trading-journal/shared` before consumers when not using root scripts.
- Prisma is PostgreSQL-only. API containers run `prisma migrate deploy` before startup; review SQL and back up data before deployment.
- Base Compose serves web and `/api` through Caddy; PostgreSQL, API, and web ports remain internal. Persistent volumes hold database and chart-image data.
- Replace development database credentials in production; the production overlay can otherwise inherit base Compose defaults.
- Secrets include credential-encryption material, `MT5_SYNC_TOKEN`, and `MT5_BRIDGE_TOKEN`. Never put secrets in `VITE_*` variables.
- Treat migrations, recovery tooling, deployment config, persistent data, and audit evidence as protected operational assets.
- Before running `apps/api/scripts/recover-empty-mt5-campaigns.ts`, reconcile it with the current `mt5_position_entry_balances` schema; it still references the dropped legacy `mt5_position_balances` table.

## Testing & QA

- API tests use Jest with `ts-jest` and Node (`apps/api/jest.config.cjs`). Discovery is limited to `apps/api/src/**/*.spec.ts`; colocate unit and integration specs with source.
- Controller tests usually instantiate controllers with `jest.fn` service doubles. Service/sync tests use Prisma-shaped stateful fakes and mocked `global.fetch`.
- `apps/api/src/auth/auth.http.spec.ts` is real HTTP-adapter acceptance coverage using an ephemeral Nest server; the repository does not use Supertest.
- Tests touching environment variables, globals, timers, temporary files, or databases must restore state explicitly.
- Web tests use Vitest, jsdom, and Testing Library (`apps/web/vitest.config.ts`, `apps/web/src/test/setup.ts`); colocate `*.test.ts(x)` files with components.
- There is no configured coverage threshold, coverage command, Playwright suite, or real-browser E2E suite. Root tests are not complete system coverage.
- Migration verification scripts require an isolated PostgreSQL database. Never point destructive verification or recovery scripts at production.
- For behavioral changes, run the focused Jest/Vitest suite plus `pnpm typecheck`; run `pnpm build` when package boundaries, Prisma generation, or frontend output are affected.

## Delivery

- After completing and verifying development work, deploy with `docker compose up -d --build`, verify the Compose services and public health/UI endpoints, then commit the completed change and push it to the current remote branch.
