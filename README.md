# S.E.N.T.R.A. Trading Journal

MT5 거래 내역을 동기화하고 매매 분석, 차트 이미지, 통계를 계좌별로 관리하는 트레이딩 저널입니다.

## 주요 기능

- 사용자 가입 승인 및 세션 기반 인증
- 여러 MT5 계좌 등록과 읽기 전용 자격 증명 암호화
- MT5 주문·체결 내역 동기화 및 포지션별 매매 기록 생성
- 브로커 서버 시간과 한국 시간의 계좌별 시간 보정
- 진입·청산 계획, 복기, 기술적 분석 기록
- 포지션 묶음별 차트 이미지 관리
- 손익, 승률, 시간대 및 기준 차트 통계

## 기술 구성

- **Web:** React, Vite, TypeScript
- **API:** NestJS, Prisma, PostgreSQL
- **Shared:** 프론트엔드·백엔드 공통 TypeScript 계약
- **Proxy:** Caddy
- **Package manager:** `pnpm@10.26.0`

```text
apps/web/          React SPA
apps/api/          NestJS API와 Prisma 스키마
packages/shared/   공통 DTO와 도메인 타입
infra/caddy/       리버스 프록시 설정
poc/               MT5 히스토리 리더 실험 코드
```

## 요구 사항

- Node.js 22 이상
- Corepack
- Docker 및 Docker Compose를 사용하는 것을 권장

## Docker Compose로 실행

```bash
cp .env.example .env
```

`.env`에서 다음 값은 반드시 안전한 값으로 변경합니다.

- `AUTH_THROTTLE_KEY`: 32자 이상의 임의 문자열
- `MT5_CREDENTIAL_ENCRYPTION_KEY`: `openssl rand -base64 32`로 생성한 키
- `POSTGRES_PASSWORD`
- `MT5_SYNC_TOKEN`
- `MT5_BRIDGE_TOKEN`
- `MT5_BRIDGE_BASE_URL`

스택을 실행합니다.

```bash
docker compose up -d --build
```

- Web: <http://localhost>
- API health: <http://localhost/health>
- API 경로: `/api`

PostgreSQL, API, Web 포트는 외부에 직접 노출되지 않으며 Caddy를 통해 접근합니다. API 컨테이너는 시작할 때 Prisma 마이그레이션을 자동 적용합니다.

## 로컬 개발

의존성을 설치하고 전체 패키지를 빌드합니다.

```bash
corepack enable
pnpm install
pnpm build
pnpm dev
```

호스트에서 `pnpm dev`를 실행할 때는 호스트에서 접근 가능한 `DATABASE_URL`과 마이그레이션이 적용된 PostgreSQL이 필요합니다. 루트 `.env`는 Docker Compose 입력 파일이며 NestJS가 자동으로 읽지 않습니다.

## 검사 명령

```bash
pnpm typecheck
pnpm test
pnpm build
```

API만 검사하려면 다음 명령을 사용합니다.

```bash
pnpm --filter @trading-journal/api test
pnpm --filter @trading-journal/api prisma:generate
pnpm --filter @trading-journal/api prisma:migrate
```

현재 `pnpm lint`는 실행할 패키지 lint 스크립트가 없어 실질적인 검사를 수행하지 않습니다.

## 운영 배포

운영 오버레이는 필수 환경 변수를 검증하고 Caddy의 80/443 포트만 공개합니다.

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

`WEB_ORIGIN`과 `CADDY_SITE_ADDRESS`를 실제 도메인에 맞게 설정해야 합니다. Cloudflare Tunnel을 사용하는 경우 공개 호스트의 원본 서비스를 `http://localhost:80`으로 지정합니다.

## MT5 동기화 보안

브라우저에 `MT5_SYNC_TOKEN`을 노출하면 안 됩니다. Web은 `/api` 경로로 동기화를 요청하고 Caddy가 신뢰된 `X-MT5-Sync-Token` 헤더를 API 요청에 추가합니다. 브라우저에서 API 동기화 엔드포인트를 직접 호출하는 구성은 지원하지 않습니다.

MT5 브리지는 `MT5_BRIDGE_BASE_URL`에서 bearer 인증 HTTP 계약을 제공해야 합니다. `poc/mt5-history-reader`는 별도 실험 코드이며 운영 API가 사용하는 인증 브리지가 아닙니다.

## 데이터 보관

Docker 볼륨에는 PostgreSQL 데이터와 거래 차트 이미지가 저장됩니다. 운영 마이그레이션 전에는 중요한 데이터를 백업하고, 적용된 Prisma 마이그레이션 파일은 수정하지 마세요.
