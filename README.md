# Trading Journal

React + NestJS 기반 수동 트레이딩 기록 시스템 스켈레톤입니다.

## 구조

```text
apps/web          React + Vite frontend
apps/api          NestJS backend
packages/shared   FE/BE 공통 타입
infra/caddy        운영 배포용 Caddy 설정
```

## 로컬 실행

```bash
corepack enable
pnpm install
pnpm build
pnpm dev
```

## Docker Compose 실행

```bash
cp .env.example .env
docker compose up -d --build
```

서비스:
- Web: http://localhost
- API health: http://localhost/health
- API와 PostgreSQL은 호스트 포트를 열지 않고 Compose 내부 네트워크에서만 통신합니다.

주의: 현재 환경에는 docker CLI가 없으면 compose 검증은 불가능합니다.

## Cloudflare Tunnel 운영 배포

공유기 포트포워딩 없이 `sentra.hoya.kim`을 붙이려면 Cloudflare Tunnel을 사용합니다.

Cloudflare Zero Trust 대시보드에서 tunnel을 만들고 서버에 `cloudflared` systemd service를 설치합니다.

Public hostname 설정:

```text
Hostname: sentra.hoya.kim
Service: http://localhost:80
```

기동:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```
