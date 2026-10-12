# latte-social — Architecture

Closed-loop social content pipeline for the Vietnam market. Keyword/trend → AI script/caption → video generation → multi-channel scheduling/publishing → analytics feedback.

## Repositories

| Repo | Visibility | Contents |
|---|---|---|
| `latte-social` | **public** | Fork of `gitroomhq/postiz-app` (AGPL-3.0). Publishing core: OAuth, scheduling, calendar, channel posting. Custom Zalo OA provider + vi locale + rebrand live here. Keep upstream diff minimal. |
| `latte-engine` | **private** | Content engine (Python/FastAPI). Trend radar → script → render → push to Postiz API → analytics → loop. Proprietary; not a derived work of Postiz. |

## Services (docker-compose on 1 VPS, ~8GB)

```
┌──────────────────────── VPS ──────────────────────────────┐
│                                                           │
│  latte-social (Postiz fork, public AGPL)                  │
│  ├─ Next.js web + NestJS API                              │
│  ├─ Postgres (db: postiz + db: latte_engine)              │
│  ├─ Redis + Temporal (scheduler)                          │
│  └─ Public API  ◄──────────┐  (API key per workspace)     │
│                            │                              │
│  latte-engine (private)    │                              │
│  ├─ trends    — Google Trends VN, TikTok trending, manual │
│  ├─ script    — Gemini → hook/body/CTA + caption          │
│  ├─ render_client — calls MoneyPrinterTurbo FastAPI       │
│  ├─ postiz_client — upload media, create scheduled post   │
│  ├─ analytics — pull views/likes/retention → performance  │
│  └─ loop      — performance report per niche/format       │
│         │                                                 │
│         ▼                                                 │
│  MoneyPrinterTurbo container (unmodified)                 │
│  └─ FastAPI :8080 — script → TTS → footage → sub → 9:16   │
│                                                           │
└───────────────────────────────────────────────────────────┘
```

## Content job lifecycle

1. **Input**: manual keyword OR trend radar suggestion (niche config selects sources).
2. **Script**: Gemini generates hook → body → CTA + per-channel caption (structured output).
3. **Render**: engine calls MPT (`POST /api/v1/videos`, poll `GET /api/v1/tasks/{id}`). Output: 9:16 ~45s mp4, karaoke-style sub, Edge-TTS `vi-VN-*` or EN voice per niche.
4. **Hand-off**: engine uploads media via Postiz public API, creates post in **scheduled** state with review buffer (~+12h) on selected channels.
5. **QA gate**: human reviews in Postiz calendar UI; pulls bad renders before publish.
6. **Publish**: Postiz executes at slot time via its existing Temporal pipelines.
7. **Feedback**: engine pulls metrics per post → performance record tagged to the content job → niche/format report (manual conditioning for MVP).

## Channel rollout

| Phase | Channels | Notes |
|---|---|---|
| MVP | FB Page, IG (Reels), TikTok via `video.upload` draft mode | Meta app covers FB+IG; TikTok draft works pre-audit (≤5 users/day) |
| 1.5 | Zalo OA (custom provider in fork), Threads | Zalo: OAuth v4+PKCE, token 25h needs refresh job, OA article API; Threads after Meta Business Verification |
| 2 | TikTok Direct Post (after audit), YouTube, LinkedIn | Start TikTok audit + Meta Business Verification early — weeks of lead time |

## MVP product surface

- Customers see: rebranded Postiz (vi locale) — compose, calendar, auto-schedule, channel connect.
- Content generation is **internal-only** at MVP: dogfood workspaces + optional "managed content" service (we generate, customer approves in UI).
- Billing deferred: `plan` field on workspace, manual activation; VN payment (PayOS/SePay) later.

## Key constraints discovered

- TikTok: unaudited = SELF_ONLY + ≤5 creators/day; media must be on verified public domain or FILE_UPLOAD. Buy domain early.
- Meta: Advanced Access needs App Review + Business Verification (weeks) — start immediately.
- Zalo: OA article API only (no personal feed); token 25h; per-permission approval in Zalo for Developers.
- VN media defaults: diacritic-safe fonts (Be Vietnam Pro/Inter), Edge-TTS version pin, `soe-vinorm` before TTS.
- License hygiene: Postiz fork public (AGPL); engine proprietary; avoid Remotion/MoneyPrinterV2/XTTSv2/F5-TTS-weights/Flux-dev.
