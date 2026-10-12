# Content engine as a separate sidecar service

Content generation (trend radar -> LLM script -> video render -> publish push -> analytics pull) lives in `latte-engine`, a private Python/FastAPI service, not inside the Postiz fork. MoneyPrinterTurbo runs as an unmodified container; the engine calls its HTTP API. Rationale: keeps AGPL-contained code out of the moat, keeps the fork diff near zero, and lets engine + renderer scale/deploy independently of the web app.
