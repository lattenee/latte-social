# Meta App Review preparation

Status: preparation only. No Meta developer-account operations have been
performed and none are owned by this document — the developer app and
Business Verification are tracked in issue #1. Everything below assumes the
reviewer will exercise the **live deployment** once credentials exist.

## Public legal surfaces

| Surface | Route | Notes |
| --- | --- | --- |
| Privacy Policy | `/legal/privacy` | Operator name + contact email come from deployment env, not hard-coded |
| Terms of Service | `/legal/terms` | Same env-driven operator block |
| Data deletion | `/legal/data-deletion` | Describes the process and submits `POST /legal/data-deletion-request` |

Required deployment config (explicitly legal facts — do not invent values):

- `NEXT_PUBLIC_LEGAL_OPERATOR` — the legal entity operating the service.
- `NEXT_PUBLIC_LEGAL_CONTACT_EMAIL` — privacy contact inbox.

If unset, the pages render a visible "not configured" notice instead of
fabricated facts. Deletion requests persist to `DataDeletionRequest` and are
actionable by a super-admin via `GET /admin/deletion-requests` +
`POST /admin/deletion-requests/:id/resolve`. The human steps are described
on the page (verify ownership, delete account + tokens + posts + media +
analytics, ≤30 days); nothing auto-deletes on submission.

## OAuth scope audit (least privilege)

The integration registry only enables providers whose `scopes` match
implemented functionality:

| Provider | Declared scopes | Used for | Trimmed? |
| --- | --- | --- | --- |
| Facebook page | `pages_show_list`, `pages_manage_posts`, `pages_read_engagement`, `business_management` (required by Meta for Page tokens) | Page listing, post publish, engagement analytics | Review against Meta's current required set at submission |
| Instagram | `instagram_business_basic`, `instagram_business_content_publish` | Content publishing + basic analytics | OK — no messaging/comment scopes |
| Zalo OA | none (permission link grants at OA level) | Article publish + counters | OK |
| Other enabled providers | provider-specific publish + read scopes | Publish + analytics only | Each provider's `scopes` field in `*.provider.ts` is the source of truth |

Method: `grep -n "scopes" libraries/nestjs-libraries/src/integrations/social/*.provider.ts`
and compare each entry with the features actually implemented in the same
file (`post`/`postPending`/`postAnalytics`). Before submitting App Review,
re-run that audit and drop any scope with no implementing feature.

## Reviewer / demo setup

1. Deploy the stack (docker compose or the documented VPS flow) with
   `FRONTEND_URL`, `DATABASE_URL`, `REDIS_URL`, Temporal, and the provider
   app credentials.
2. Create a reviewer account (email + password). Mark a Latte operator user
   `isSuperAdmin = true` for admin tooling (impersonation, debug
   endpoints, plan activation) — never hand this to the Meta reviewer.
3. Connect the Meta test assets: a Facebook Page and an Instagram Business
   account owned by the reviewer's Facebook user added as an app
   tester/developer until App Review completes (dev-mode apps only grant to
   app roles).
4. Seed 1–2 scheduled posts + media so the reviewer sees the calendar and
   analytics populated.
5. Reviewer path to record: connect channel → compose post → schedule →
   post publishes → analytics counters appear → disconnect channel →
   deletion-request flow on `/legal/data-deletion`.

## Recording runbook

1. Record at 1080p, show URL bar (social.lattee.me) throughout.
2. Show the privacy/terms/data-deletion pages first (Meta checks them
   early), then the OAuth connect flow with the permission dialog visible,
   then publish + analytics.
3. Keep the recording under 3 minutes; Meta reviewers skim.

## Open items

- Issues #1–#3 (Meta/TikTok/Zalo developer apps) are human-owned gates.
- Live credential verification of the Zalo pending-publish flow is pending
  issue #3.
- The `DataDeletionRequest` table requires `prisma db push` (or an
  equivalent migration) on the deployment before the deletion form works.
