# 5-Component Handoff Report: Milestone 1 Backend Database, Auth & Kiosk Devices API

**Worker**: Worker M1 (Backend Database, Auth & Kiosk Devices API Developer)  
**Recipient**: Sub-Orchestrator M1 / Lead Orchestrator  
**Milestone**: M1 (Backend Database, Auth & Kiosk Devices API)  
**Date**: 2026-08-30  
**Handoff Type**: Hard (Milestone 1 Complete)

---

## 1. Observation

Direct observations and file modifications made in the OpenFamily backend repository:

1. **Shared Types (`shared/src/types.ts`)**:
   - Added `KioskDevice` interface (lines 194–213) with properties: `id`, `userId`, `deviceName`, `deviceType`, `userAgent`, `ipAddress`, `lastActiveAt`, `createdAt`, `revokedAt`, along with snake_case aliases for full database compatibility.

2. **Database Migrations (`server/src/db.ts`)**:
   - Appended Migration 023 (lines 370–385) into `migrations` array executed by `runMigrations()`:
     - Created table `kiosk_devices` with columns `id UUID PRIMARY KEY DEFAULT uuid_generate_v4()`, `user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE`, `device_name VARCHAR(100) NOT NULL`, `device_type VARCHAR(100)`, `user_agent TEXT`, `ip_address VARCHAR(45)`, `device_token TEXT`, `last_active_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`, `revoked_at TIMESTAMP`, `created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`.
     - Created performance indexes: `idx_kiosk_devices_user`, `idx_kiosk_devices_user_id`, `idx_kiosk_devices_user_active` (`WHERE revoked_at IS NULL`), and `idx_kiosk_devices_revoked_at`.

3. **Authentication & Revocation Middleware (`server/src/middleware/auth.ts`)**:
   - Extended `AuthRequest` interface with `deviceId?: string`.
   - Updated `generateKioskToken` signature to `(userId: string, ownerId?: string, deviceId?: string): string`, embedding `{ userId, ownerId: ownerId ?? userId, deviceId, isKiosk: true }` in JWT payload with 10-year validity.
   - Converted `authMiddleware` to asynchronous execution (`async (req: AuthRequest, res: Response, next: NextFunction)`).
   - Added DB revocation check: when `decoded.isKiosk` is true, if `!decoded.deviceId` returns 401 (`LEGACY_KIOSK_TOKEN`). If `decoded.deviceId`, queries `SELECT id, revoked_at FROM kiosk_devices WHERE id = $1 AND user_id = $2`. If missing or `revoked_at IS NOT NULL`, immediately terminates with 401 (`DEVICE_REVOKED`).

4. **WebSocket Broadcaster & Server Auth (`server/src/lib/broadcaster.ts` & `server/src/index.ts`)**:
   - Added `'kiosk'` to `WsEntity` union in `server/src/lib/broadcaster.ts`.
   - Extended `WsUpdatePayload` to include optional `id?: string` and `data?: any`.
   - Updated `server/src/index.ts` WebSocket message handler to decode tokens and register connections under `decoded.ownerId ?? decoded.userId`, ensuring kiosk screens and family members receive broadcasts sent to the owner ID.

5. **Kiosk Routes & Pairing API (`server/src/routes/kioskToken.ts`)**:
   - Added `parseDeviceType(ua?: string): string` helper identifying LG webOS, Samsung Tizen, Google TV, Android TV, Sony BRAVIA, Roku, Apple TV, iPad, and desktop browsers.
   - Updated `POST /api/kiosk/pair/init` to capture client IP and user agent into `pairSessions`.
   - Updated `GET /api/kiosk/pair/status` to return `{ success: true, authorized: true, token, deviceId }`.
   - Implemented `POST /api/kiosk/pair/authorize` with SQL `INSERT INTO kiosk_devices (...)`, generating JWT token with `deviceId`, and broadcasting `{ type: 'update', entity: 'kiosk', action: 'created', id: deviceId }`.
   - Implemented `GET /api/kiosk/devices` returning active (`revoked_at IS NULL`) devices for `req.userId`.
   - Implemented `DELETE /api/kiosk/devices/:id` guarded by `authMiddleware` and `requireParent`, marking `revoked_at = CURRENT_TIMESTAMP`, and broadcasting `{ type: 'update', entity: 'kiosk', action: 'deleted', id: deviceId, data: { revoked: true, deviceId } }`.
   - Implemented `POST /api/kiosk/heartbeat` updating `last_active_at` timestamp in `kiosk_devices`.
   - Implemented `GET /api/kiosk/token` direct endpoint inserting device row and returning token with `deviceId`.

---

## 2. Logic Chain

1. **State Persistence**:
   - *Premise*: Display devices paired via ephemeral in-memory maps cannot be listed, managed, or revoked remotely across server reboots.
   - *Logic*: Persisting device metadata upon authorization into `kiosk_devices` with foreign key `user_id REFERENCES users(id) ON DELETE CASCADE` provides persistent state and multi-tenant isolation.
2. **Authoritative Revocation**:
   - *Premise*: Long-lived JWT tokens (10 years) are stateless by default.
   - *Logic*: By embedding `deviceId` in the JWT and executing an indexed query (`idx_kiosk_devices_user_active`) in `authMiddleware` whenever `isKiosk === true`, any unlinked display is blocked with `401 Unauthorized` across all endpoints (`/api/kiosk/heartbeat`, `/api/tasks`, `/api/appointments`, `/api/shopping`, `/api/dashboard`, etc.).
3. **Real-time Eviction**:
   - *Premise*: When a user clicks "Desvincular" in dashboard settings, the display should exit kiosk mode immediately without waiting for token expiration.
   - *Logic*: Triggering `broadcast(req.userId, { type: 'update', entity: 'kiosk', action: 'deleted', id: deviceId })` over WebSocket on device deletion notifies all connected clients immediately. Registering sockets under `decoded.ownerId ?? decoded.userId` in `server/src/index.ts` ensures family broadcasts reach all devices in that household.
4. **Tenant & Role Protection**:
   - *Premise*: Child accounts or users from other families must not be able to delete or modify display links.
   - *Logic*: `DELETE /api/kiosk/devices/:id` verifies `user_id = req.userId` in SQL and uses `requireParent` middleware to reject non-parent accounts with `403 Forbidden`.

---

## 3. Caveats

1. **Legacy Kiosk Tokens**: Tokens created before Migration 023 lack a `deviceId` claim. `authMiddleware` rejects them with `401 Unauthorized`, prompting the kiosk display to re-pair and establish a tracked, revokable database entry.
2. **Reverse Proxy Headers**: `req.headers['x-forwarded-for']` is checked first when capturing IP addresses to ensure correct IP logging behind Nginx/Traefik reverse proxies.

---

## 4. Conclusion

Milestone 1 backend requirements are 100% complete and fully implemented:
- Migration 023 created in `server/src/db.ts` with all required indexes.
- `AuthRequest`, `generateKioskToken`, and async `authMiddleware` implemented in `server/src/middleware/auth.ts`.
- `WsEntity` union updated and `server/src/index.ts` auth mapping fixed.
- Complete Kiosk Device management endpoints (`GET /devices`, `DELETE /devices/:id`, `POST /heartbeat`, `POST /pair/authorize`, `GET /pair/status`) implemented in `server/src/routes/kioskToken.ts`.
- `KioskDevice` interface exported in `shared/src/types.ts`.

---

## 5. Verification Method

To independently verify the Milestone 1 backend implementation:

1. **Static Type & Code Inspection**:
   - Inspect `shared/src/types.ts` for `KioskDevice`.
   - Inspect `server/src/db.ts` for Migration 023 `kiosk_devices` schema and indexes.
   - Inspect `server/src/middleware/auth.ts` for `generateKioskToken(userId, ownerId, deviceId)` and async `authMiddleware` DB revocation check.
   - Inspect `server/src/lib/broadcaster.ts` for `WsEntity` containing `'kiosk'`.
   - Inspect `server/src/routes/kioskToken.ts` for endpoints:
     - `POST /api/kiosk/pair/init`
     - `GET /api/kiosk/pair/status`
     - `POST /api/kiosk/pair/authorize`
     - `GET /api/kiosk/devices`
     - `DELETE /api/kiosk/devices/:id`
     - `POST /api/kiosk/heartbeat`
     - `GET /api/kiosk/token`
   - Inspect `server/src/index.ts` for WebSocket connection mapping to `decoded.ownerId ?? decoded.userId`.

2. **Integration Flow**:
   - Pair a display via `POST /api/kiosk/pair/init` -> `POST /api/kiosk/pair/authorize` with `deviceName: 'Sala TV'`.
   - Call `GET /api/kiosk/devices` -> confirms device is listed with `deviceName`, `deviceType`, `ipAddress`, `lastActiveAt`.
   - Call `POST /api/kiosk/heartbeat` with kiosk JWT -> returns `200 OK` and updates `last_active_at`.
   - Call `DELETE /api/kiosk/devices/:id` -> returns `200 OK`, marks `revoked_at`, and broadcasts WebSocket event.
   - Subsequent calls with revoked kiosk JWT -> returns `401 Unauthorized` (`DEVICE_REVOKED`).
