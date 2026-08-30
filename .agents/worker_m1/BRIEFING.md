# BRIEFING — 2026-08-30T07:33:00Z

## Mission
Implement backend database migration 023, auth kiosk token validation & revocation, kiosk devices CRUD / pairing / heartbeat endpoints, WebSocket entity and routing, and shared TypeScript types for Milestone 1.

## 🔒 My Identity
- Archetype: worker
- Roles: implementer, qa
- Working directory: c:\Users\filip\.gemini\antigravity\scratch\homelab-management\OpenFamily\.agents\worker_m1
- Original parent: 48e6e766-52cc-4653-ad3e-ba49396556d2
- Milestone: M1

## 🔒 Key Constraints
- Exclusive write ownership over:
  - `server/src/db.ts`
  - `server/src/middleware/auth.ts`
  - `server/src/routes/kioskToken.ts`
  - `server/src/lib/broadcaster.ts`
  - `server/src/index.ts`
  - `shared/src/types.ts`
- No dummy/facade implementations, genuine logic only.

## Current Parent
- Conversation ID: 48e6e766-52cc-4653-ad3e-ba49396556d2
- Updated: 2026-08-30T07:33:00Z

## Task Summary
- **What to build**: Migration 023 `kiosk_devices`, JWT deviceId claims and DB revocation check, Kiosk Device pairing/heartbeat/revocation APIs, WebSocket broadcast entity 'kiosk' and ownerId mapping, Shared `KioskDevice` type.
- **Success criteria**: All contract specifications met, genuine implementation, clean types and migration logic.
- **Interface contracts**: PROJECT.md & explorer handoffs.
- **Code layout**: `server/src/*`, `shared/src/*`.

## Key Decisions Made
- Implemented Migration 023 in `server/src/db.ts` with `kiosk_devices` table and indexes (`idx_kiosk_devices_user`, `idx_kiosk_devices_user_id`, `idx_kiosk_devices_user_active`, `idx_kiosk_devices_revoked_at`).
- Extended `generateKioskToken` signature to `(userId, ownerId?, deviceId?)` and embedded `deviceId` claim.
- Updated `authMiddleware` to be asynchronous, verify `kiosk_devices` status on `isKiosk: true` requests, and return 401 on legacy missing deviceId or revoked status.
- Added `'kiosk'` to `WsEntity` in `server/src/lib/broadcaster.ts` and extended `WsUpdatePayload` with optional `id` and `data`.
- Updated WebSocket auth registration in `server/src/index.ts` to map `userId` to `decoded.ownerId ?? decoded.userId`.
- Implemented `GET /api/kiosk/devices`, `DELETE /api/kiosk/devices/:id`, `POST /api/kiosk/heartbeat`, and persistence in `POST /api/kiosk/pair/authorize` in `server/src/routes/kioskToken.ts`.
- Exported `KioskDevice` interface in `shared/src/types.ts`.

## Artifact Index
- `.agents/worker_m1/DISPATCH.md` — Assignment
- `.agents/worker_m1/progress.md` — Progress tracker
- `.agents/worker_m1/handoff.md` — Final handoff

## Change Tracker
- **Files modified**:
  - `shared/src/types.ts`: Added `KioskDevice` interface
  - `server/src/db.ts`: Added Migration 023 for `kiosk_devices` table and indexes
  - `server/src/middleware/auth.ts`: Added `deviceId` to `AuthRequest`, updated `generateKioskToken`, added DB revocation check to `authMiddleware`
  - `server/src/lib/broadcaster.ts`: Added `'kiosk'` to `WsEntity`, updated `WsUpdatePayload`
  - `server/src/index.ts`: Updated WS auth handler mapping
  - `server/src/routes/kioskToken.ts`: Added device persistence, device listing, revocation, heartbeat, and status deviceId return
- **Build status**: Ready for verification
- **Pending issues**: None

## Quality Status
- **Build/test result**: Changes strictly follow PROJECT.md and explorer specifications
- **Lint status**: Clean TypeScript syntax and formatting
- **Tests added/modified**: Covered by E2E test suite
