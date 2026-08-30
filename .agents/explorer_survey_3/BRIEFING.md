# BRIEFING — 2026-08-30T07:20:00Z

## Mission
Thoroughly explore OpenFamily project architecture, API structure, database/backend models, test setup, build scripts, authentication, and dependencies relevant to Universal Kiosk Mode.

## 🔒 My Identity
- Archetype: explorer
- Roles: System Architecture & API Explorer
- Working directory: c:\Users\filip\.gemini\antigravity\scratch\homelab-management\OpenFamily\.agents\explorer_survey_3
- Original parent: 48e6e766-52cc-4653-ad3e-ba49396556d2
- Milestone: Survey Phase

## 🔒 Key Constraints
- Read-only investigation — do NOT implement
- Explore architecture, API, database, authentication, test setups, build commands, and kiosk requirements
- Document in analysis.md and handoff.md

## Current Parent
- Conversation ID: 48e6e766-52cc-4653-ad3e-ba49396556d2
- Updated: 2026-08-30T07:20:00Z

## Investigation State
- **Explored paths**:
  - `package.json`, `tsconfig.json`, `client/`, `server/`, `shared/`, `android-tv/`, `scripts/`
  - `server/src/app.ts`, `server/src/index.ts`, `server/src/db.ts`, `server/schema.sql`
  - `server/src/routes/kioskToken.ts`, `server/src/routes/auth.ts`, `server/src/routes/userSettings.ts`, `server/src/middleware/auth.ts`
  - `client/src/App.tsx`, `client/src/pages/Kiosk.tsx`, `client/src/pages/PairTV.tsx`, `client/src/pages/Settings.tsx`
  - `client/src/contexts/AuthContext.tsx`, `client/src/lib/api.ts`
  - `client/src/i18n/locales/*/kiosk.json`, `client/src/i18n/locales/*/settings.json`
- **Key findings**:
  - OpenFamily is a TypeScript npm monorepo with React 19/Vite frontend, Express 4.22 + PostgreSQL backend, and shared domain models.
  - `/kiosk` pairing screen currently contains hardcoded 42" smart display labels and TV-only text, plus external dependency on `api.qrserver.com`.
  - Kiosk tokens are 10-year JWTs generated statelessly; no database table (`kiosk_devices`) or revocation mechanism exists currently.
  - Device unlinking requires: PostgreSQL table migration (`kiosk_devices`), `GET /api/kiosk/devices`, `DELETE /api/kiosk/devices/:id`, token validation/revocation in `authMiddleware` or kiosk heartbeat, WebSocket revocation broadcast, and a new settings section in `Settings.tsx`.
- **Unexplored areas**: None. Architectural and API survey complete.

## Key Decisions Made
- Fully documented architecture, build commands, test setup, API/middleware flows, and kiosk implementation plan in `analysis.md` and `handoff.md`.

## Artifact Index
- analysis.md — Full architectural and API survey report
- handoff.md — 5-component handoff report for planner and team
