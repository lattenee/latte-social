# Fork Postiz as the publishing core

We fork `gitroomhq/postiz-app` (AGPL-3.0) as the scheduler/publishing layer instead of building it fresh. The fork stays public — AGPL compliance is cheap since the moat is platform approvals, VN market fit, and the feedback loop, not the code. All differentiating logic lives in `latte-engine`, a separate private service that talks to the fork only via its public API — it is not a derived work and stays proprietary.

Consequences: we inherit Postiz's stack (NestJS + Next.js + Temporal + Postgres + Redis) and must keep the fork diff minimal to ease upstream rebases. Custom channel providers (e.g. Zalo OA) go into the fork and are public.
