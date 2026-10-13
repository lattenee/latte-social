# Status — as of 2026-10-13

## Done

- [x] Product direction decided (closed-loop pipeline: keyword → gen → schedule → publish → feedback). See `docs/design/architecture.md`.
- [x] Postiz stack deployed on VPS `hgsg` and live at **https://social.lattee.me** (first registered account = admin; register before `DISABLE_REGISTRATION` gets flipped).
- [x] DNS + TLS: `social.lattee.me` → 103.221.222.52, Let's Encrypt cert, auto-renews via the box's `renew-cert.sh` cron.
- [x] Resource caps applied so the stack can't starve the co-located ERP (see `infrastructure/README.md`).
- [x] Repo config: GitHub issues tracker, 5 triage labels, AGENTS.md, GLOSSARY.md, ADR-0001/0002, mattpocock skills in `.devin/skills/`.

## Pending (next actions)

Tracked as GitHub issues on `lattenee/latte-social` (use `-R lattenee/latte-social` — gh resolves to `upstream` otherwise).

- [ ] **Platform developer apps** (human, weeks of lead time — start now): #1 Meta + Business Verification, #2 TikTok Content Posting API, #3 Zalo app + OA. Put returned keys into `latte.override.yaml` on the VPS and restart postiz.
- [x] Fork `gitroomhq/postiz-app` source into this repo — upstream merged into `master` (`git remote upstream`; rebase custom commits on `upstream/main` to update). vi locale ships upstream already.
- [ ] #4 Rebrand → "Latte" + vi locale wiring in fork
- [ ] #5 Zalo OA provider stub in fork (OAuth v4+PKCE, 25h-token refresh, OA article API)
- [ ] #6 Scaffold `latte-engine` (private repo, Python/FastAPI) per `docs/design/architecture.md` — lives at `D:\Project\latte-engine`
- [ ] #7 Phase 2 engine modules (trends/analytics/loop), #8 Phase 3 SaaS readiness — needs-triage
- [ ] Decide billing/payment later (deferred by design).
- [ ] **Repo visibility**: repo is currently PRIVATE; architecture/ADR-0001 call for public (AGPL network-use means users of social.lattee.me must be able to get the fork's source). Flip to public once comfortable, or document an alternative source-offer mechanism.

## Access cheat-sheet

- VPS hgsg: `ssh latte@cloud.hgsg.vn` (ed25519 key; on the old machine the alias `hgsg` exists in `~/.ssh/config`). Stack files: `~/latte/infrastructure/compose/postiz/`.
- Compose: `cd ~/latte/infrastructure/compose/postiz && docker compose -f docker-compose.yaml -f latte.override.yaml -p latte up -d`
- Second box `server.lattee.me` (home server, 8GB/55GB — too small for this stack): SSH as `root` with `id_ed25519`; was intermittently unreachable.
- GitHub: account `lattenee`/`popotu1996` owns this repo.

## Known gotchas

- Never commit `latte.override.yaml` (contains JWT_SECRET + DB password) — gitignored.
- nginx proxy uses Docker DNS + variable `proxy_pass`; if `postiz` container is recreated and the site 502s, reload `hgsg-nginx` (see vhost comments).
- MoneyPrinterTurbo render must be capped (mem 4g, concurrency 1) on this shared box.
