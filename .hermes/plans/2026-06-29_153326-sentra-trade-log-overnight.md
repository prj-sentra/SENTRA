# S.E.N.T.R.A. Trade Log Overnight Implementation Plan

> **For Hermes:** Use `sentra-trading-journal` and `test-driven-development`. Implement bottom-up with small verified commits.

**Goal:** Make the trade-log side usable for conversation-driven journaling: assistant actions can create independent CFD-style trades, record entries/exits, reject invalid state transitions, and persist records in Postgres if time allows.

**Architecture:** Keep the API small and agent-friendly. Treat `Trade` as one independent CFD-style position. Entry and exit remain separate. Same-symbol/same-side position additions create new trades, never scale into an existing trade. Build from service tests upward, then controller/API smoke tests, then persistence.

**Tech Stack:** NestJS, TypeScript, pnpm workspace, Jest, Docker Compose, Postgres. Prefer Prisma for persistence when reaching DB phase.

---

## Current Context

- Repo: `/home/hoya/trading-journal`
- Public app: `https://sentra.hoya.kim`
- API public prefix through Caddy: `https://sentra.hoya.kim/api`
- Current trade-log endpoints:
  - `GET /trade-log/trades`
  - `GET /trade-log/trades/:id`
  - `POST /trade-log/trades`
  - `POST /trade-log/trades/:id/entry`
  - `POST /trade-log/trades/:id/exit`
- Current storage: in-memory only.
- Current tests: 8 total, basic trade creation/entry/exit behavior.
- Important domain rule: **포지션 추가 = new independent trade**, not additional buy / not scale-in.

---

## Overnight Priorities

Work in this order. Stop only after a verified commit or if blocked by a real error.

1. Domain invariant tests and validation.
2. Assistant-action contract API.
3. Public API smoke tests.
4. Persistence with Prisma/Postgres if time remains.
5. Frontend read-only update if API has durable records.

Do not build statistics, exchange reconciliation, or wiki features tonight.

---

## Task 1: Add Domain Invariant Tests

**Objective:** Prevent corrupt trade states before adding more features.

**Files:**
- Modify: `apps/api/src/trade-log/trade-log.service.spec.ts`
- Modify: `apps/api/src/trade-log/trade-log.service.ts`

**Step 1: Write failing tests**

Add tests:

```ts
it('rejects exit before entry and keeps trade planned', () => {
  const service = new TradeLogService();
  const trade = service.createTrade({ symbol: 'BTCUSDT', side: 'long' });

  expect(() =>
    service.recordExit(trade.id, {
      price: 67400,
      quantity: 0.05,
      occurredAt: '2026-06-29T00:00:00.000Z',
      reason: 'manual',
    }),
  ).toThrow('Cannot exit before entry');

  expect(service.getTrade(trade.id).status).toBe('planned');
});

it('rejects a second entry on the same trade', () => {
  const service = new TradeLogService();
  const trade = service.createTrade({ symbol: 'BTCUSDT', side: 'long' });
  service.recordEntry(trade.id, {
    price: 67320,
    quantity: 0.05,
    occurredAt: '2026-06-29T00:00:00.000Z',
  });

  expect(() =>
    service.recordEntry(trade.id, {
      price: 67400,
      quantity: 0.05,
      occurredAt: '2026-06-29T00:10:00.000Z',
    }),
  ).toThrow('Trade already has an entry');
});

it('rejects a second exit on a closed trade', () => {
  const service = new TradeLogService();
  const trade = service.createTrade({ symbol: 'BTCUSDT', side: 'long' });
  service.recordEntry(trade.id, {
    price: 67320,
    quantity: 0.05,
    occurredAt: '2026-06-29T00:00:00.000Z',
  });
  service.recordExit(trade.id, {
    price: 67400,
    quantity: 0.05,
    occurredAt: '2026-06-29T00:10:00.000Z',
    reason: 'manual',
  });

  expect(() =>
    service.recordExit(trade.id, {
      price: 67500,
      quantity: 0.05,
      occurredAt: '2026-06-29T00:20:00.000Z',
      reason: 'manual',
    }),
  ).toThrow('Trade already has an exit');
});
```

**Step 2: Verify RED**

Run:

```bash
pnpm --filter @trading-journal/api test -- trade-log.service.spec.ts
```

Expected: FAIL because validation is not implemented.

**Step 3: Minimal implementation**

In `TradeLogService.recordEntry`:
- if `trade.entry` exists, throw `BadRequestException('Trade already has an entry')`
- if `trade.status === 'closed'`, throw `BadRequestException('Cannot enter a closed trade')`

In `TradeLogService.recordExit`:
- if no `trade.entry`, throw `BadRequestException('Cannot exit before entry')`
- if `trade.exit` exists, throw `BadRequestException('Trade already has an exit')`

**Step 4: Verify GREEN**

Run:

```bash
pnpm --filter @trading-journal/api test -- trade-log.service.spec.ts
pnpm build && pnpm typecheck && pnpm test
```

Expected: all tests pass.

**Step 5: Commit**

```bash
git add apps/api/src/trade-log/trade-log.service.ts apps/api/src/trade-log/trade-log.service.spec.ts
git commit -m "test: enforce trade state transitions"
```

---

## Task 2: Add Assistant Action Types

**Objective:** Define the contract that lets S.E.N.T.R.A. transform chat into explicit API actions.

**Files:**
- Modify: `packages/shared/src/index.ts`
- Test: `apps/api/src/trade-log/trade-log.service.spec.ts`

**Contract:**

```ts
export type TradeLogAssistantAction =
  | { type: 'create_trade'; payload: CreateTradeRequest }
  | { type: 'record_entry'; tradeRef?: string; payload: TradeEntryRequest }
  | { type: 'record_exit'; tradeId: string; payload: TradeExitRequest };

export interface TradeLogAssistantActionsRequest {
  rawText: string;
  source: 'telegram' | 'manual' | 'api';
  actions: TradeLogAssistantAction[];
}

export interface TradeLogAssistantActionsResponse {
  rawText: string;
  source: 'telegram' | 'manual' | 'api';
  trades: TradeRecord[];
}
```

`tradeRef` lets the first `record_entry` target the trade just created by the preceding `create_trade` action. Use `'last_created'` as the initial supported value.

**Tests:**

- `applies assistant actions to create and open a new trade`
- `creates separate trades for same symbol same side assistant actions`
- `preserves rawText in the created trade note when note is otherwise absent`

**Verify:**

```bash
pnpm --filter @trading-journal/shared build
pnpm --filter @trading-journal/api test -- trade-log.service.spec.ts
```

**Commit:**

```bash
git add packages/shared/src/index.ts apps/api/src/trade-log/trade-log.service.spec.ts apps/api/src/trade-log/trade-log.service.ts
git commit -m "feat: add assistant trade-log actions"
```

---

## Task 3: Add Assistant Actions API Endpoint

**Objective:** Expose the action contract over HTTP for the assistant to use.

**Files:**
- Modify: `apps/api/src/trade-log/trade-log.controller.ts`
- Modify/test: service tests first. Controller tests optional if fast.

**Endpoint:**

```text
POST /trade-log/assistant-actions
```

Body example:

```json
{
  "rawText": "BTC 15분봉 롱 진입했어. 67320에 0.05개. 런던 세션 스윕 리클레임 보고 들어감.",
  "source": "telegram",
  "actions": [
    {
      "type": "create_trade",
      "payload": {
        "symbol": "BTCUSDT",
        "side": "long",
        "timeframe": "15m",
        "session": "London",
        "thesis": "런던 세션 스윕 리클레임 보고 진입"
      }
    },
    {
      "type": "record_entry",
      "tradeRef": "last_created",
      "payload": {
        "price": 67320,
        "quantity": 0.05,
        "occurredAt": "2026-06-29T00:00:00.000Z",
        "note": "BTC 15분봉 롱 진입"
      }
    }
  ]
}
```

**Expected response:** one open trade, raw context preserved.

**Smoke test after deploy:**

```bash
curl -sS -X POST https://sentra.hoya.kim/api/trade-log/assistant-actions \
  -H 'Content-Type: application/json' \
  --data '{...}'
```

Then restart API to clear in-memory smoke data until persistence is implemented:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml restart api
```

**Commit:**

```bash
git add apps/api/src/trade-log packages/shared/src/index.ts
git commit -m "feat: expose assistant trade-log actions"
```

---

## Task 4: Add Minimal Request Validation

**Objective:** Reject obviously invalid records before persistence.

**Validation rules:**

- `symbol` required and non-empty.
- `side` must be `long` or `short`.
- entry/exit `price` must be positive.
- `quantity`, if provided, must be positive.
- `occurredAt` must be valid ISO-ish date string (`Date.parse` not NaN).

**Files:**
- Create: `apps/api/src/trade-log/trade-log.validation.ts`
- Modify: `apps/api/src/trade-log/trade-log.service.ts`
- Test: `apps/api/src/trade-log/trade-log.service.spec.ts`

Use Nest `BadRequestException` with clear messages.

**Commit:**

```bash
git add apps/api/src/trade-log packages/shared/src/index.ts
git commit -m "feat: validate trade-log inputs"
```

---

## Task 5: Deploy and Public Smoke Test

**Objective:** Verify public endpoint works after each API feature.

**Commands:**

```bash
pnpm build && pnpm typecheck && pnpm test
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.yml -f docker-compose.prod.yml ps
curl -sS https://sentra.hoya.kim/api/trade-log/trades
```

Smoke assistant action:

```bash
curl -sS -X POST https://sentra.hoya.kim/api/trade-log/assistant-actions \
  -H 'Content-Type: application/json' \
  --data '{"rawText":"BTC 15분봉 롱 진입했어. 67320에 0.05개.","source":"telegram","actions":[{"type":"create_trade","payload":{"symbol":"BTCUSDT","side":"long","timeframe":"15m","note":"BTC 15분봉 롱 진입했어. 67320에 0.05개."}},{"type":"record_entry","tradeRef":"last_created","payload":{"price":67320,"quantity":0.05,"occurredAt":"2026-06-29T00:00:00.000Z"}}]}'
```

Expected: response includes one trade with `status: open`.

Clear smoke data if storage remains in-memory:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml restart api
```

---

## Task 6: Persistence Spike/Implementation If Time Remains

**Objective:** Move from in-memory to Postgres only after assistant action contract is tested.

**Preferred dependency:** Prisma.

**Install:**

```bash
pnpm --filter @trading-journal/api add @prisma/client
pnpm --filter @trading-journal/api add -D prisma
```

**Files:**
- Create: `apps/api/prisma/schema.prisma`
- Create: `apps/api/src/prisma/prisma.service.ts`
- Modify: `apps/api/src/app.module.ts`
- Modify: `apps/api/src/trade-log/trade-log.service.ts`
- Modify: `apps/api/Dockerfile`
- Modify: `docker-compose.yml` or startup command if migrations needed

**Minimal schema:**

```prisma
model Trade {
  id        String   @id @default(uuid())
  symbol    String
  side      String
  status    String
  timeframe String?
  session   String?
  strategy  String?
  thesis    String?
  note      String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  entry     TradeEntry?
  exit      TradeExit?
}

model TradeEntry {
  id         String   @id @default(uuid())
  tradeId    String   @unique
  trade      Trade    @relation(fields: [tradeId], references: [id], onDelete: Cascade)
  price      Decimal
  quantity   Decimal?
  occurredAt DateTime
  note       String?
  createdAt  DateTime @default(now())
}

model TradeExit {
  id         String   @id @default(uuid())
  tradeId    String   @unique
  trade      Trade    @relation(fields: [tradeId], references: [id], onDelete: Cascade)
  price      Decimal
  quantity   Decimal?
  occurredAt DateTime
  reason     String?
  note       String?
  createdAt  DateTime @default(now())
}
```

**Persistence tests:**

Prefer a repository interface first. If integration DB testing is too slow tonight, do not fake success. Leave persistence branch incomplete and report blocker.

**Commit only when verified:**

```bash
git commit -m "feat: persist trade log in postgres"
```

---

## Nightly Completion Report

At the end, report:

- Latest git commit hash.
- Commands run and pass/fail.
- Public endpoints smoke-tested.
- What works now.
- What remains in-memory or blocked.
- Any data intentionally cleared after smoke tests.

Do not claim durable journaling until Postgres persistence is implemented and verified.
