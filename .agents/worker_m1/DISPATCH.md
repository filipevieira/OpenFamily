## 2026-08-30T07:28:22Z

You are Worker M1 (Backend Database, Auth & Kiosk Devices API Developer).
Your working directory is: c:\Users\filip\.gemini\antigravity\scratch\homelab-management\OpenFamily\.agents\worker_m1
Project root: c:\Users\filip\.gemini\antigravity\scratch\homelab-management\OpenFamily
Original User Request: c:\Users\filip\.gemini\antigravity\scratch\homelab-management\OpenFamily\.agents\ORIGINAL_REQUEST.md
Master Project Plan: c:\Users\filip\.gemini\antigravity\scratch\homelab-management\OpenFamily\PROJECT.md

MANDATORY: Read ORIGINAL_REQUEST.md and PROJECT.md first.
Also read the detailed Explorer specifications at:
- c:\Users\filip\.gemini\antigravity\scratch\homelab-management\OpenFamily\.agents\explorer_m1_1\handoff.md
- c:\Users\filip\.gemini\antigravity\scratch\homelab-management\OpenFamily\.agents\explorer_m1_2\handoff.md
- c:\Users\filip\.gemini\antigravity\scratch\homelab-management\OpenFamily\.agents\explorer_m1_3\handoff.md

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

File Ownership: You have exclusive write ownership over:
- `server/src/db.ts`
- `server/src/middleware/auth.ts`
- `server/src/routes/kioskToken.ts`
- `server/src/lib/broadcaster.ts`
- `server/src/index.ts`
- `shared/src/types.ts`

Your mission:
1. Implement Migration 023 in `server/src/db.ts` creating the `kiosk_devices` table and indexes (`idx_kiosk_devices_user`, `idx_kiosk_devices_user_active`).
2. Update `server/src/middleware/auth.ts`:
   - Update `generateKioskToken` to accept `(userId: string, ownerId?: string, deviceId?: string): string`.
   - Update `AuthRequest` interface with `deviceId?: string`.
   - Make `authMiddleware` check `kiosk_devices` in database when `decoded.isKiosk` is true to verify `revoked_at IS NULL`. Return 401 when revoked.
3. Update `server/src/routes/kioskToken.ts`:
   - In `POST /api/kiosk/pair/authorize`: insert record in `kiosk_devices` capturing IP, user agent, device name/type; issue token with `deviceId`.
   - Implement `GET /api/kiosk/devices`: return all active devices for the user/owner.
   - Implement `DELETE /api/kiosk/devices/:id`: verify ownership/requireParent, set `revoked_at = NOW()`, call `broadcast(req.userId, { type: 'update', entity: 'kiosk', action: 'deleted', id: req.params.id })`.
   - Implement `POST /api/kiosk/heartbeat`: update `last_active_at`.
   - Update `GET /api/kiosk/pair/status` to return `token` and `deviceId`.
4. Update `server/src/lib/broadcaster.ts` to add `'kiosk'` to `WsEntity`.
5. Update `server/src/index.ts` WS auth mapping to `decoded.ownerId ?? decoded.userId`.
6. Update `shared/src/types.ts` with `KioskDevice` interface.
7. Run build (`npm run build:shared && npm run build:server`) and tests (`node tests/e2e/runner.js`). Ensure everything compiles cleanly and backend tests pass.
8. Output a detailed 5-component handoff report to:
   `c:\Users\filip\.gemini\antigravity\scratch\homelab-management\OpenFamily\.agents\worker_m1\handoff.md`.

Send a message to parent when done.
