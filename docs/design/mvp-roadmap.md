# MVP Roadmap

## Phase 0 — Foundation (parallel with approvals)

- [ ] Buy domain, point at VPS (Caddy/HTTPS) — prerequisite for all OAuth + TikTok domain verification
- [ ] Start Meta Business Verification + TikTok developer app + Zalo developer app (weeks of lead time)
- [ ] Fork Postiz → deploy stock stack on VPS → dogfood as plain scheduler
- [ ] Rebrand + vi locale + Zalo provider stub in the fork

## Phase 1 — Engine thin path

- [ ] `latte-engine` skeleton (FastAPI, Postgres db `latte_engine`)
- [ ] `postiz_client`: API key auth, media upload, create scheduled post
- [ ] MPT container + `render_client` (submit job, poll, fetch mp4)
- [ ] `script` module: Gemini structured output (hook/body/CTA/caption), VN templates
- [ ] First niche config (VN content), QA gate = +12h review buffer
- [ ] Dogfood: 1 VN channel, daily generation, human approval in Postiz UI

## Phase 2 — Loop + channels

- [ ] `trends`: Google Trends VN + TikTok trending input
- [ ] `analytics` + `loop`: per-post metrics → performance report per niche/format
- [ ] Zalo OA provider (public, in fork) + Threads
- [ ] Second dogfood niche (EN faceless) if capacity allows

## Phase 3 — SaaS readiness

- [ ] Open signup, workspace onboarding, plan field
- [ ] TikTok Direct Post once audited
- [ ] Decide: expose generation UI vs managed-content offering
