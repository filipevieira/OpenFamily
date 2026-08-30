# Handoff Report: Kiosk API & WebSocket Specialist (Milestone 1)

**Agent**: Explorer M1-2  
**Date**: 2026-08-30  
**Target Milestone**: Milestone 1 (Backend Database, Auth & Kiosk Devices API)

---

## 1. Observation

1. **`server/src/routes/kioskToken.ts`**:
   - Lines 6–14: Pair sessions are stored only in an ephemeral in-memory Map `pairSessions = new Map<string, PairSession>()`.
   - Lines 30–40: `GET /token` returns a 10-year JWT signed by `generateKioskToken(req.userId, req.userId)` without creating any database record.
   - Lines 46–61: `POST /pair/init` creates a random 6-digit session with 10-minute expiry.
   - Lines 67–85: `GET /pair/status` checks `session.authorized` and returns `session.token`.
   - Lines 91–118: `POST /pair/authorize` verifies the code, creates a token via `generateKioskToken(req.userId, req.userId)`, and sets `session.token`.
   - There are **no endpoints** currently for `GET /devices`, `DELETE /devices/:id`, or `POST /heartbeat`.

2. **`server/src/middleware/auth.ts`**:
   - Lines 28–32:
     ```ts
     const decoded = jwt.verify(token, getJwtSecret()) as { userId: string; ownerId?: string; isKiosk?: boolean };
     req.actualUserId = decoded.userId;
     req.userId = decoded.ownerId ?? decoded.userId;
     req.isOwner = !decoded.ownerId || decoded.ownerId === decoded.userId;
     ```
   - Line 42: `generateKioskToken` embeds `{ userId, ownerId, isKiosk: true }` without a `deviceId` claim.
   - `authMiddleware` does not query any table to check if a kiosk token or device is active or revoked.

3. **`server/src/lib/broadcaster.ts`**:
   - Lines 3–16: `WsEntity` union currently contains: `'tasks' | 'shopping' | 'appointments' | 'family' | 'budget' | 'recipes' | 'meal-plans' | 'planning' | 'notifications' | 'integrations' | 'rewards' | 'notes'`. `'kiosk'` is not present.
   - Lines 19–23: `WsUpdatePayload` has `{ type: 'update', entity: WsEntity, action: WsAction }`.

4. **`server/src/index.ts`**:
   - Lines 33–39: WebSocket authentication decodes `token` as `{ userId: string }` and registers the socket under `decoded.userId`.
   - If `decoded.ownerId` is present (for kiosk or family members), registering under `decoded.ownerId ?? decoded.userId` is required so that family-wide broadcasts sent to `req.userId` (owner ID) reach the client socket.

5. **`server/src/db.ts`**:
   - `runMigrations()` runs sequential DDL queries during startup (`await pool.query(migration)`).
   - Migration for `kiosk_devices` table and indexes is needed.

---

## 2. Logic Chain

1. **Device Persistence & Tracking**:
   - Because `pairSessions` in `kioskToken.ts` is ephemeral, displays cannot be listed, managed, or remotely unlinked across restarts or in dashboard settings.
   - Adding the `kiosk_devices` table in `server/src/db.ts` provides persistent state (`id`, `user_id`, `device_name`, `device_type`, `user_agent`, `ip_address`, `last_active_at`, `revoked_at`, `created_at`).

2. **Authorization & Device Linking**:
   - When a user on mobile/dashboard authorizes pairing via `POST /api/kiosk/pair/authorize`, the server must insert a row into `kiosk_devices` capturing the device metadata.
   - The resulting `device.id` (UUID) must be embedded into the Kiosk JWT claim (`deviceId`).
   - The session map stores `session.deviceId` and `session.token` so that polling `GET /pair/status` receives both.

3. **Revocation & Instant Enforcement**:
   - When a user clicks "Desvincular" in Settings, `DELETE /api/kiosk/devices/:id` sets `revoked_at = NOW()`.
   - In `server/src/middleware/auth.ts`, whenever a token has `isKiosk: true` and `deviceId`, the middleware queries `SELECT revoked_at FROM kiosk_devices WHERE id = $1 AND user_id = $2`.
   - If `revoked_at IS NOT NULL` (or row missing), `authMiddleware` immediately responds with `401 Unauthorized` (`{ success: false, error: 'Kiosk device has been unlinked or revoked', code: 'DEVICE_REVOKED' }`).
   - This single check in `authMiddleware` instantly invalidates access across all existing API routes (`/api/appointments`, `/api/tasks`, `/api/shopping`, `/api/notes`, `/api/planning`, etc.).

4. **Real-time WebSocket Notification**:
   - When a device is revoked (`DELETE /api/kiosk/devices/:id`), the server calls `broadcast(req.userId, { type: 'update', entity: 'kiosk', action: 'deleted', id: req.params.id, data: { revoked: true, deviceId: req.params.id } })`.
   - When a device is paired (`POST /api/kiosk/pair/authorize`), the server calls `broadcast(req.userId, { type: 'update', entity: 'kiosk', action: 'created' })`.
   - Adding `'kiosk'` to `WsEntity` in `broadcaster.ts` (and updating client `WebSocketContext.tsx`) ensures live sync in Settings.tsx and immediate eviction in Kiosk.tsx.

5. **Heartbeat & Liveness**:
   - Kiosk calls `POST /api/kiosk/heartbeat` periodically (e.g. every 30s).
   - This executes `UPDATE kiosk_devices SET last_active_at = NOW() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`.
   - This provides real-time "last active" metadata in `/settings` and gives the kiosk an active channel to catch 401 revocation responses.

---

## 3. Caveats

1. **Legacy Kiosk Tokens**: Existing long-lived kiosk tokens issued before this milestone will not have a `deviceId` claim. `authMiddleware` handles them gracefully without failing if `!decoded.deviceId`, while new tokens generated via pairing or `GET /token` will always carry `deviceId`.
2. **WebSocket Keepalive / Reconnection**: When a display network hiccups, WebSocket reconnect logic will re-authenticate with the stored JWT; if revoked during the disconnect, WS auth (`4001 Unauthorized`) or the next API request/heartbeat will catch the revocation.
3. **Database Concurrency**: The query checking revocation in `authMiddleware` is lightweight and indexed on `(user_id, id)`. In high-traffic scenarios, caching could be added, but for homelab/family concurrency (a few kiosks per family), direct indexed PostgreSQL lookup provides 100% authoritative consistency.

---

## 4. Conclusion

The design for Milestone 1 is completely specified and ready for implementation.
The files to modify in Milestone 1 are:
1. `server/src/db.ts`: Add `kiosk_devices` migration and indexes.
2. `server/src/middleware/auth.ts`: Update `generateKioskToken`, `AuthRequest` interface, and `authMiddleware` revocation verification.
3. `server/src/routes/kioskToken.ts`: Implement `GET /devices`, `DELETE /devices/:id`, `POST /heartbeat`, enhanced `pair/authorize` with device persistence, and `parseDeviceType`.
4. `server/src/lib/broadcaster.ts`: Add `'kiosk'` to `WsEntity` and extend `WsUpdatePayload`.
5. `server/src/index.ts`: Map WebSocket auth to `decoded.ownerId ?? decoded.userId`.
6. `shared/src/types.ts`: Export `KioskDevice` interface.

---

## 5. Verification Method

To independently verify after implementation:
1. **Compilation & Type Check**:
   - `npm run build` from root (must compile `server`, `client`, and `shared` with zero TypeScript errors).
2. **Database Migration Check**:
   - Start server (`npm run dev` or test script) and verify `kiosk_devices` table and indexes exist in PostgreSQL (`\d kiosk_devices`).
3. **API Endpoint Verification**:
   - `POST /api/kiosk/pair/init` -> Returns `{ success: true, code: "XXXXXX" }`.
   - `POST /api/kiosk/pair/authorize` (with Bearer User token and code) -> Returns `{ success: true, token: "...", deviceId: "..." }`.
   - `GET /api/kiosk/devices` (with Bearer User token) -> Returns list containing the newly paired device.
   - `POST /api/kiosk/heartbeat` (with Bearer Kiosk token) -> Returns `{ success: true, active: true }`.
   - `DELETE /api/kiosk/devices/:id` (with Bearer User token) -> Returns `{ success: true, message: "Dispositivo desvinculado com sucesso" }`.
   - Repeated `POST /api/kiosk/heartbeat` (with now-revoked Bearer Kiosk token) -> Returns `401 Unauthorized`.
   - `GET /api/kiosk/devices` -> Returns empty list (or non-revoked devices only).
4. **WebSocket Revocation Broadcast**:
   - Connect client WebSocket to `/ws`, authenticate with family token.
   - Revoke device via `DELETE /api/kiosk/devices/:id`.
   - Assert WebSocket received `{ type: 'update', entity: 'kiosk', action: 'deleted', ... }`.
