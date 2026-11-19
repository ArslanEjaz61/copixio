# Copixio

Copixio is a paid SaaS that trades the Telegram signals each user chooses on their own Binance (live or demo) and
KuCoin account. Every Telegram group has its own money rules.

- Design system: [DESIGN.md](DESIGN.md). Read it before any UI change.
- Stack: Next.js 15 (App Router), MongoDB, Redis, pm2 behind nginx.

## Run locally

```bash
cp .env.example .env   # then fill MONGODB_URI, REDIS_URL, SEAL_KEY
npm install
npm run dev
```

## Deploy

Code reaches the server only through this repository.

1. Push to `main`.
2. On the server, run `cd /var/www/copixio && ./deploy.sh`.

`deploy.sh` stops before restarting if the build fails.

## Phases

1. Landing page, accounts (sign up, sign in, email verification), app shell. This phase.
2. Exchange keys (Binance live and demo, KuCoin): tested, withdrawal keys refused, secrets sealed.
3. Telegram login (MTProto), group selection, per-group rules.
4. Signal reader and trade engine (queue per user, no double orders), Telegram notifications.
5. Billing (USDT) and admin.
