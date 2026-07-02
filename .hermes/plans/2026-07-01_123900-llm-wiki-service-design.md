# S.E.N.T.R.A. LLM Wiki Service Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Build a filesystem-first LLM wiki service inside S.E.N.T.R.A. that follows the stronger `llm-wiki` operating discipline, is readable on the web, and supports images/assets without giving up future OKF-compatible export.

**Architecture:** Treat the markdown wiki directory as the source of truth and the web app/API as a consumer/editor over that directory. Keep raw sources immutable under `raw/`, store derived wiki pages as markdown with YAML frontmatter, and add a lightweight ingest/index/render layer in the Nest API plus a read-oriented UI in the web app. Use Postgres only for operational metadata when necessary, not as the canonical page store.

**Tech Stack:** NestJS API, React/Vite web app, PostgreSQL + Prisma (for operational metadata only), filesystem-backed markdown wiki, gray-matter/yaml parser, markdown renderer with custom wikilink and image handling.

---

## 1. Current Context

### Existing repo state
- Trade log is already persisted with PostgreSQL + Prisma.
- Wiki is still placeholder-only.
- Current wiki backend files:
  - `apps/api/src/wiki/wiki.controller.ts`
  - `apps/api/src/wiki/wiki.service.ts`
  - `apps/api/src/wiki/wiki.service.spec.ts`
- Current shared wiki type is too thin:
  - `packages/shared/src/index.ts` only exposes `WikiPageSummary`
- Current web UI only lists page summaries:
  - `apps/web/src/App.tsx`

### Design constraints from `.hermes.md`
- Bottom-up development.
- TDD first.
- `pnpm build && pnpm typecheck && pnpm test` is mandatory.
- Web/wiki can now move beyond skeleton, but changes must stay incremental and verifiable.

### Core product decision
The wiki should follow the **LLM Wiki operating model**:
- raw source preservation
- `SCHEMA.md`, `index.md`, `log.md`
- curated entity/concept/comparison/query pages
- contradiction and provenance discipline

Not OKF-first. OKF compatibility should be a downstream benefit, not the primary operating model.

---

## 2. Recommended Service Design

## 2.1 Source of truth
Use a dedicated wiki directory on disk as the canonical store.

**Recommended path:**
- production/runtime setting via env: `WIKI_PATH`
- local default fallback: `/data/wiki` inside container, mapped from host volume

**Why:**
- matches llm-wiki operating model
- easy to inspect manually
- git-friendly later
- supports images/assets naturally
- avoids prematurely flattening rich markdown knowledge into relational tables

## 2.2 Three-layer content model

```text
wiki/
├── SCHEMA.md
├── index.md
├── log.md
├── raw/
│   ├── articles/
│   ├── papers/
│   ├── transcripts/
│   └── assets/
├── entities/
├── concepts/
├── comparisons/
└── queries/
```

### Layer rules
1. `raw/` is immutable after ingest.
2. all derived pages are markdown with frontmatter.
3. `index.md` is navigation, not the only index.
4. `log.md` is append-only operational history.
5. assets live under `raw/assets/` and are served by HTTP.

## 2.3 Web service responsibility split

### Filesystem wiki layer
Responsible for:
- reading/writing markdown files
- frontmatter parsing/validation
- wikilink extraction
- asset path resolution
- updating `index.md` and `log.md`

### API layer
Responsible for:
- page listing
- page detail retrieval
- rendered HTML response or markdown+AST response
- search
- ingest requests
- lint/health reports
- asset serving

### Web UI layer
Responsible for:
- page browser
- page detail reader
- backlinks/related links
- raw source visibility
- asset rendering
- search and filters
- eventually admin ingest/lint screens

## 2.4 Where Postgres fits
Do **not** put canonical page bodies into Postgres first.

Use Postgres only for optional operational tables such as:
- ingest job history
- background task state
- cached search index metadata
- audit events

If there is no immediate need, defer DB additions for wiki until phase 2.

**Rule:** markdown files remain the truth; DB is derivative support state.

---

## 3. Image / Asset Design

## 3.1 Supported image model
The llm-wiki skill explicitly supports assets under:
- `raw/assets/`

Support both authoring styles:
- Obsidian style: `![[image.png]]`
- Standard markdown: `![alt](./relative/path.png)` or `![alt](/wiki/assets/...)`

## 3.2 Normalization rule
On read/render:
- parse markdown
- detect `![[...]]`
- resolve to canonical HTTP URL
- render as standard HTML `<img>`

Canonical public URL form:
```text
/wiki/assets/<relative-path-from-raw-assets>
```

Examples:
- `![[image.png]]` → `/wiki/assets/image.png`
- `![[charts/btc-setup.png]]` → `/wiki/assets/charts/btc-setup.png`

## 3.3 Asset constraints
- allow only files under `raw/assets/`
- block `..` path traversal
- infer content-type from extension
- expose `alt` text when available; otherwise fall back to filename
- cap upload size if upload is added later

## 3.4 Future-safe extension
Later, support image references in raw source pages and rendered concept pages without changing storage shape.

---

## 4. API Design

Start read-only first, then ingest/admin.

## 4.1 Phase 1 read APIs

### `GET /wiki/health`
Current endpoint; keep.

### `GET /wiki/pages`
Return normalized page summaries from filesystem.

**Response shape (proposed):**
```ts
interface WikiPageSummary {
  slug: string;
  title: string;
  type: 'entity' | 'concept' | 'comparison' | 'query' | 'summary' | 'raw';
  updatedAt: string;
  tags: string[];
  excerpt?: string;
}
```

### `GET /wiki/pages/:slug`
Return full page detail.

```ts
interface WikiPageDetail {
  slug: string;
  title: string;
  type: string;
  created?: string;
  updated?: string;
  tags: string[];
  sources: string[];
  confidence?: 'high' | 'medium' | 'low';
  contested?: boolean;
  contradictions?: string[];
  bodyMarkdown: string;
  bodyHtml: string;
  outboundLinks: string[];
  inboundLinks: string[];
  assetUrls: string[];
}
```

### `GET /wiki/index`
Return parsed high-level catalog for the landing page.

### `GET /wiki/assets/*`
Serve files from `raw/assets/`.

### `GET /wiki/search?q=`
Filesystem-backed search over title, tags, slug, excerpt, and markdown body.
Start simple; no vector search.

## 4.2 Phase 2 write/admin APIs

### `POST /wiki/ingest/url`
Input:
```ts
{ url: string, kind?: 'article' | 'paper' | 'reference' }
```

### `POST /wiki/ingest/text`
Input:
```ts
{ title: string, text: string, source?: string, kind?: 'transcript' | 'note' }
```

### `POST /wiki/pages`
Create a derived page directly.

### `PATCH /wiki/pages/:slug`
Controlled page update.

### `POST /wiki/lint`
Run wiki lint checks and return report.

### `GET /wiki/log`
Read `log.md` or parsed log entries.

---

## 5. Internal API/Service Modules

Add clear service boundaries in Nest.

## 5.1 Proposed backend modules

### `WikiModule`
HTTP wiring only.

### `WikiFilesystemService`
Responsibilities:
- resolve safe wiki paths
- read/write files
- list pages
- read assets
- update `index.md` / `log.md`

### `WikiParserService`
Responsibilities:
- parse frontmatter
- validate page schema
- parse Obsidian image and wikilink syntax
- extract outbound links and asset references

### `WikiRenderService`
Responsibilities:
- markdown → HTML
- transform `[[page]]` to `/wiki/page/<slug>` or frontend route
- transform `![[asset]]` to `/wiki/assets/...`
- sanitize HTML output

### `WikiIndexService`
Responsibilities:
- build summary list
- compute inbound backlinks
- parse `index.md`
- optionally cache graph data

### `WikiIngestService` (later phase)
Responsibilities:
- store raw source into `raw/...`
- create/update derived pages
- append `log.md`
- preserve provenance markers

### `WikiLintService` (later phase)
Responsibilities:
- orphan detection
- broken link detection
- frontmatter validation
- tag taxonomy check
- stale content detection
- source drift detection

---

## 6. Frontend Design

## 6.1 Initial UI structure
Replace placeholder wiki list with a three-pane read experience.

### Wiki landing view
- left: sections / filters
- center: page list
- right or main: selected page content

### Minimum features
1. page list with type/tag filter
2. page detail reader with rendered markdown
3. backlinks block
4. sources block
5. images rendered inline
6. links navigable in-app

## 6.2 Proposed route shape
If frontend routing is added:
- `/wiki` — wiki landing
- `/wiki/:slug` — page detail
- `/wiki/raw/:slug` — raw source page detail

If not adding router yet, use query-string state first.

## 6.3 UI components to add
Likely under `apps/web/src/wiki/`:
- `WikiPageList.tsx`
- `WikiPageDetail.tsx`
- `WikiTagFilter.tsx`
- `WikiBacklinks.tsx`
- `WikiSearchBox.tsx`

---

## 7. Shared Types to Add

Modify `packages/shared/src/index.ts`.

Add at minimum:
- `WikiPageType`
- `WikiPageSummary`
- `WikiPageDetail`
- `WikiSearchResponse`
- `WikiLink`
- `WikiAssetRef`
- `WikiIndexSection`
- `WikiLintReport` (phase 2)
- `WikiIngestRequest/Response` (phase 2)

---

## 8. File Changes Likely Needed

## Backend
- Modify: `apps/api/src/wiki/wiki.controller.ts`
- Replace/expand: `apps/api/src/wiki/wiki.service.ts`
- Modify: `apps/api/src/wiki/wiki.service.spec.ts`
- Create: `apps/api/src/wiki/wiki.filesystem.service.ts`
- Create: `apps/api/src/wiki/wiki.parser.service.ts`
- Create: `apps/api/src/wiki/wiki.render.service.ts`
- Create: `apps/api/src/wiki/wiki.index.service.ts`
- Create later: `apps/api/src/wiki/wiki.ingest.service.ts`
- Create later: `apps/api/src/wiki/wiki.lint.service.ts`
- Modify if needed: `apps/api/src/wiki/wiki.module.ts`

## Shared
- Modify: `packages/shared/src/index.ts`

## Frontend
- Modify: `apps/web/src/App.tsx`
- Create: `apps/web/src/wiki/*`
- Modify: `apps/web/src/styles.css`

## Runtime/config
- Modify: `.env.example`
- Modify: `docker-compose.yml`
- Modify: `docker-compose.prod.yml`
- Possibly modify: `apps/api/Dockerfile`

## Content seed / bootstrap
- Create runtime bootstrap examples or fixture wiki under one of:
  - `apps/api/src/wiki/bootstrap/` for templates only
  - `infra/wiki/seed/` for sample bundle

Do **not** hardcode production content into the compiled app.

---

## 9. Phased Delivery Order

## Phase 0 — schema and bootstrap rules only
**Objective:** define file layout and env wiring before adding logic.

Steps:
1. add `WIKI_PATH` to config examples and compose
2. define shared wiki response types
3. add wiki bootstrap template location and path resolver
4. write tests for path resolution and missing wiki directory behavior

## Phase 1 — read-only wiki filesystem service
**Objective:** replace empty wiki placeholders with real filesystem-backed reads.

Steps:
1. write failing tests for listing pages from markdown files
2. implement frontmatter parsing and summary extraction
3. add `GET /wiki/pages/:slug`
4. add tests for missing page / malformed frontmatter
5. verify API returns real markdown-backed data

## Phase 2 — markdown rendering + wikilinks + images
**Objective:** make the wiki readable in the web app.

Steps:
1. write failing tests for `[[wikilink]]` and `![[image.png]]` transformations
2. implement render service with sanitized HTML
3. add asset-serving endpoint
4. update frontend to render detail view and inline assets
5. smoke test with a sample page and sample image

## Phase 3 — index/backlinks/search
**Objective:** make navigation usable.

Steps:
1. compute outbound/inbound links
2. parse `index.md` for landing-page sections
3. add simple search endpoint
4. update frontend with filters and backlinks

## Phase 4 — ingest workflow
**Objective:** let Hermes and the user add sources without hand-editing files.

Steps:
1. add raw source write path
2. write `source_url/ingested/sha256` frontmatter
3. append `log.md`
4. create minimal derived-page creation flow
5. defer autonomous synthesis until contract is stable

## Phase 5 — lint and operational discipline
**Objective:** protect wiki quality as it grows.

Steps:
1. orphan and broken-link checks
2. frontmatter validation
3. taxonomy validation via `SCHEMA.md`
4. drift detection for raw files
5. expose lint report in API/UI

---

## 10. Testing Strategy

Follow bottom-up + TDD.

## 10.1 Backend tests first

### Unit tests
Add/expand:
- `apps/api/src/wiki/wiki.service.spec.ts`
- `apps/api/src/wiki/wiki.parser.service.spec.ts`
- `apps/api/src/wiki/wiki.render.service.spec.ts`
- `apps/api/src/wiki/wiki.filesystem.service.spec.ts`
- `apps/api/src/wiki/wiki.controller.spec.ts`

### Cases to cover
1. page list from valid markdown files
2. malformed frontmatter fails clearly
3. `index.md` and `log.md` are not treated as concept pages
4. slug resolution is safe
5. missing page returns 404
6. `[[page]]` becomes internal app link
7. `![[image.png]]` becomes asset URL
8. asset path traversal is rejected
9. backlinks are computed correctly
10. raw/assets image files are served with correct content type

## 10.2 Frontend tests
If lightweight frontend tests are introduced, cover:
- summary list rendering
- page detail rendering
- image rendering
- link navigation state
- error and empty states

## 10.3 Smoke test sequence
After implementation phase 2:
1. start compose
2. ensure sample wiki exists under mounted `WIKI_PATH`
3. call:
   - `GET /api/wiki/pages`
   - `GET /api/wiki/pages/<slug>`
   - `GET /api/wiki/assets/<asset>`
4. open web app and verify page + image render

## 10.4 Full verification command
```bash
pnpm build && pnpm typecheck && pnpm test
```

Then:
```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml config
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

---

## 11. Key Tradeoffs

## Choose filesystem-first over DB-first
**Why:** fits llm-wiki, better provenance, easier manual inspection, native asset support.

**Risk:** filesystem mutation logic is more careful than CRUD tables.

## Support Obsidian syntax at render time, not storage rewrite
**Why:** keeps authoring natural while preserving web portability.

**Risk:** custom parser layer required.

## Delay autonomous ingest synthesis until read path is stable
**Why:** avoids mixing content-generation bugs with reader/renderer bugs.

**Risk:** initial service is read-heavy, not full workflow.

## Keep OKF compatibility secondary
**Why:** user prefers llm-wiki operations.

**Risk:** if external interchange becomes urgent, an exporter may be needed later.

---

## 12. Open Questions

1. Should wiki pages be editable from the web UI initially, or read-only first?
   - Recommendation: read-only first.

2. Should the wiki directory be committed into git or mounted as runtime content?
   - Recommendation: mounted runtime directory first; add optional git sync later.

3. Should search remain grep-like or later add embeddings/vector search?
   - Recommendation: lexical search first.

4. Should page slugs mirror directory paths exactly?
   - Recommendation: yes. Use `concepts/foo.md` → slug `concepts/foo`.

5. Should raw source pages be visible in the UI?
   - Recommendation: yes, but visually distinct from curated pages.

---

## 13. Recommended First Increment

Build this exact slice first:

1. add `WIKI_PATH` env/config + compose mount
2. create sample wiki fixture with:
   - `SCHEMA.md`
   - `index.md`
   - `log.md`
   - one `concepts/*.md`
   - one image in `raw/assets/`
3. implement filesystem-backed `GET /wiki/pages`
4. implement `GET /wiki/pages/:slug`
5. implement render of `![[image.png]]`
6. expose `GET /wiki/assets/:path`
7. update frontend wiki tab to show real page detail + image
8. verify in browser and compose

This gives a true end-to-end proof that:
- llm-wiki structure works in the repo
- web reading works
- images work
- the service shape is sound before ingest complexity is added

---

## 14. Suggested Commit Sequence

1. `feat: add wiki path config and shared page types`
2. `feat: read wiki pages from filesystem`
3. `feat: render wiki page detail and asset links`
4. `feat: serve wiki assets in web reader`
5. `feat: add wiki search and backlinks`
6. `feat: add wiki ingest skeleton`
7. `feat: add wiki lint reports`

---

## 15. Execution Handoff

This design is strong enough to implement incrementally.

**Recommended next move:** execute Phase 0 + Phase 1 only, verify with sample pages, then stop and review before adding ingest.
