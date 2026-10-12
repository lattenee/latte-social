# Glossary

## Actors

- **Workspace** — tenant boundary. One customer = one workspace; owns channels, posts, media, and settings. The internal content farm is just another workspace.
- **Channel** — a connected social account inside a workspace (e.g. a Facebook Page, a TikTok account, a Zalo OA). Created via OAuth flow.

## Content side (engine — proprietary service)

- **Content engine** — the separate service that turns a topic into a publishable post: script → media generation → assembly. Talks to the publishing core only through its public API.
- **Niche** — a repeatable content format + topic area the engine generates for (e.g. "EN history shorts", "VN cafe promos").
- **Content job** — one end-to-end generation run: keyword/trend input → script → voiceover → render → QA → hand to publishing core.
- **Performance record** — post-level metrics pulled back from platforms, tagged to the content job that produced it. Feeds the loop.

## Publishing side (Postiz fork — public)

- **Publishing core** — the forked Postiz codebase: OAuth, scheduling, calendar, channel posting. Owns nothing about content generation.
- **Provider** — per-platform integration implementing publish + auth for a channel type (TikTok provider, Facebook provider...).
- **Post** — one composed item (text + media + per-channel settings) that can be scheduled/published to selected channels.
- **Auto-schedule** — filling the next empty time slot of each selected channel's posting schedule.

## Loop

- **Closed loop** — performance records flowing back into the engine to condition the next generation round (hook style, niche, format selection).
