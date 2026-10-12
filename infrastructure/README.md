# Infrastructure

Current deployment target: VPS `hgsg` (cloud.hgsg.vn, 103.221.222.52).

## Layout on the VPS

```
~/latte/
├── infrastructure/compose/postiz/   ← gitroomhq/postiz-docker-compose clone
│   └── latte.override.yaml          ← env + resource caps (secrets NOT in repo)
├── runtime/nginx/                   ← (unused; nginx lives in /opt/company)
└── backups/
```

## Stack

- Postiz app + postgres + redis + temporal stack via docker compose project `latte`
- Compose cmd: `docker compose -f docker-compose.yaml -f latte.override.yaml -p latte up -d`
- Resource caps: postiz 3G/2cpu, postgres 1G, redis 512M, temporal 1G, ES 640M — keeps the shared box safe for the ERP workload.

## Ingress

- `social.lattee.me` → 103.221.222.52, TLS via Let's Encrypt (certbot webroot in `/opt/company/infrastructure/secrets/certs`, auto-renewed by the box's existing `renew-cert.sh` cron).
- Vhost: `/opt/company/infrastructure/config/nginx/conf.d/social.lattee.me.conf` (copy in `infrastructure/nginx/`). `hgsg-nginx` container is attached to `latte_postiz-network` and proxies `postiz:5000` via Docker DNS — copy this pattern (variable `proxy_pass` + `resolver 127.0.0.11`) or a container recreate will 502 until nginx reload.

## Secrets

`latte.override.example.yaml` has placeholders. On a fresh box: generate `JWT_SECRET` (48 chars) and the postgres password, write the real `latte.override.yaml` next to `docker-compose.yaml` on the VPS. Never commit it.
