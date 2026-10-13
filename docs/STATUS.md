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
- [x] Fork `gitroomhq/postiz-app` source — upstream merged into `master` and pushed (`git remote upstream`; rebase custom commits on `upstream/main` to update). Repo now **public** (AGPL compliance per ADR-0001).
- [x] #4 Rebrand → "Latte" (cc95a8d9) + vi locale verified (100% coverage, shipped upstream). Gap: non-en locales still show "Postiz".
- [x] #5 Zalo OA provider stub (c698233b): OAuth v4+PKCE, 25h-token refreshCron, article create/verify. Real-keys verification gated on #3.
- [x] #6 `latte-engine` scaffolded — https://github.com/lattenee/latte-engine (private). Postiz+MPT+Gemini clients, vn-cafe-promo niche, 9 tests green.
- [x] Dogfood Phase 1 end-to-end: FB Page "Tiệm Hoa Thanh Hương" (`cmv68t6m70001lo7wnv6bzy7l`) + IG "Nguyễn Hoàng Tuấn Anh" (`cmv68u9x90003lo7wkdh1f92p`) connected via dev-mode Meta app 810699631212046; Google OAuth client for `/integrations/social/youtube`; first engine job scheduled both channels (+12h review buffer). Engine runs locally via SSH tunnel; MPT container `mpt` on hgsg (127.0.0.1:18080, video_source=local, 4g/2cpu cap).
  Gotchas found: Postiz public API mounts under `/api` (`POSTIZ_API_URL` must be `https://social.lattee.me/api`); MPT `video_script` is a string and `videos` entries are strings; empty `video_terms` triggers MPT's internal LLM (needs llm_provider configured — set to gemini); `vi-VN-*` voices route to broken azure_tts_v1 — use `gemini:` voices; IG settings require `post_type`.
- [ ] #7 Phase 2 engine modules (trends/analytics/loop), #8 Phase 3 SaaS readiness — needs-triage
- [ ] Decide billing/payment later (deferred by design).

## Access cheat-sheet

- VPS hgsg: `ssh latte@cloud.hgsg.vn` (ed25519 key; on the old machine the alias `hgsg` exists in `~/.ssh/config`). Stack files: `~/latte/infrastructure/compose/postiz/`.
- Compose: `cd ~/latte/infrastructure/compose/postiz && docker compose -f docker-compose.yaml -f latte.override.yaml -p latte up -d`
- Second box `server.lattee.me` (home server, 8GB/55GB — too small for this stack): SSH as `root` with `id_ed25519`; was intermittently unreachable.
- GitHub: account `lattenee`/`popotu1996` owns this repo.

## Known gotchas

- Never commit `latte.override.yaml` (contains JWT_SECRET + DB password) — gitignored.
- nginx proxy uses Docker DNS + variable `proxy_pass`; if `postiz` container is recreated and the site 502s, reload `hgsg-nginx` (see vhost comments).
- MoneyPrinterTurbo render must be capped (mem 4g, concurrency 1) on this shared box.
