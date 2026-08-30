# Handoff Report — Milestone 1: Backend Database, Auth & Kiosk Devices API

## 1. Observation

### 1.1 Database Migration System (`server/src/db.ts`)
- **File**: `server/src/db.ts` (lines 95–376).
- Migrations are defined as an inline string array `const migrations = [ ... ]` executed sequentially via `await pool.query(migration)` during `runMigrations()`.
- Existing migration sequence runs up to Migration 022 (`schedule_entry_exceptions` and `appointments.google_event_id` / `sync_source`, lines 360–369).
- Triggers use the existing PostgreSQL function `update_updated_at_column()`.
- `server/schema.sql` (lines 1–308) contains the baseline schema for new installations, including tables, indexes, and triggers.

### 1.2 Auth Middleware & Token Generation (`server/src/middleware/auth.ts`)
- **File**: `server/src/middleware/auth.ts` (lines 1–45).
- `authMiddleware` is currently synchronous (`(req: AuthRequest, res: Response, next: NextFunction) => { ... }`), decoding tokens using `jwt.verify(token, getJwtSecret())`.
- `generateKioskToken` signature is currently `(userId: string, ownerId?: string): string` producing a JWT payload `{ userId, ownerId, isKiosk: true }` with no `deviceId`.
- `AuthRequest` interface (lines 6–13) exposes `userId`, `actualUserId`, and `isOwner`.

### 1.3 Kiosk Routes (`server/src/routes/kioskToken.ts`)
- **File**: `server/src/routes/kioskToken.ts` (lines 1–120).
- Pairing sessions are managed in an in-memory `pairSessions = new Map<string, PairSession>()`.
- `POST /api/kiosk/pair/authorize` generates a kiosk token but does not persist any device record in PostgreSQL.
- There are currently no endpoints for listing devices (`GET /devices`), revoking devices (`DELETE /devices/:id`), or recording heartbeats (`POST /heartbeat`).

### 1.4 Broadcaster (`server/src/lib/broadcaster.ts`)
- **File**: `server/src/lib/broadcaster.ts` (lines 3–15).
- `WsEntity` union currently covers `'tasks' | 'shopping' | 'appointments' | 'family' | 'budget' | 'recipes' | 'meal-plans' | 'planning' | 'notifications' | 'integrations' | 'rewards' | 'notes'`, omitting `'kiosk'`.

---

## 2. Logic Chain

1. **Database Schema Design**:
   - Remote display management requires tracking individual display instances with metadata (name, IP, user-agent, last active timestamp, creation timestamp) and a revocation state (`revoked_at`).
   - Adding `kiosk_devices` with `user_id REFERENCES users(id) ON DELETE CASCADE` ensures data integrity and automatic cascading cleanup when accounts are deleted.
   - Primary key B-Tree index on `id` and partial index `WHERE revoked_at IS NULL` guarantees sub-millisecond lookup latency.

2. **Token & Middleware Architecture**:
   - To associate requests with specific physical displays, `generateKioskToken` must accept and embed `deviceId: string` into the JWT payload.
   - Converting `authMiddleware` to `async` allows querying `kiosk_devices` when `decoded.isKiosk === true`.
   - By querying `SELECT id, revoked_at FROM kiosk_devices WHERE id = $1`, any revoked display immediately receives a `401 Unauthorized` response on its next HTTP request, triggering immediate client redirection to the QR pairing screen.

3. **Performance Decoupling**:
   - Updating `last_active_at` on every GET/POST through `authMiddleware` would introduce unnecessary write lock contention on PostgreSQL.
   - Decoupling activity timestamps to a dedicated `POST /api/kiosk/heartbeat` and `pair/authorize` keeps routine auth checks purely read-only ($<0.2\text{ ms}$).

4. **Real-Time Revocation Propagation**:
   - Adding `'kiosk'` to `WsEntity` in `server/src/lib/broadcaster.ts` enables `broadcast(userId, { type: 'update', entity: 'kiosk', action: 'deleted' })` on `DELETE /api/kiosk/devices/:id`.
   - Displays subscribed to the WebSocket connection receive immediate notification to purge local tokens and return to the pairing screen.

---

## 3. Caveats

1. **Legacy Tokens**: Pre-existing kiosk tokens generated prior to this migration lack a `deviceId` claim. When evaluated by the updated `authMiddleware`, they will return `401 Unauthorized` with a clear message instructing the kiosk to re-pair. This is intentional and necessary to ensure all active kiosks are tracked and revocable.
2. **IP Resolution behind Reverse Proxies**: OpenFamily uses `app.set('trust proxy', 1)` in `server/src/app.ts:34`. When resolving client IPs for `ip_address`, handlers should check `req.headers['x-forwarded-for']` first, falling back to `req.socket.remoteAddress` or `req.ip`.
3. **Demo Mode (VITE_DEMO)**: In demo environments where static mocks are used (`IS_DEMO = true`), database operations are bypassed, so real backend tests require PostgreSQL.

---

## 4. Conclusion

The specification for Milestone 1 is complete and actionable. The implementation requires:
1. Adding Migration 023 to `server/src/db.ts` and updating `server/schema.sql`.
2. Extending `AuthRequest`, updating `generateKioskToken`, and implementing async revocation checks in `server/src/middleware/auth.ts`.
3. Implementing `GET /api/kiosk/devices`, `DELETE /api/kiosk/devices/:id`, `POST /api/kiosk/heartbeat`, and updating `pair/authorize` in `server/src/routes/kioskToken.ts`.
4. Adding `'kiosk'` to `WsEntity` in `server/src/lib/broadcaster.ts`.
5. Adding TypeScript interfaces in `shared/src/types.ts`.

---

## 5. Verification Method

### 5.1 Code Inspection
- Inspect `server/src/db.ts` to confirm Migration 023 syntax, table name, column types, and trigger creation.
- Inspect `server/src/middleware/auth.ts` to confirm `generateKioskToken(userId, ownerId, deviceId)` and `authMiddleware` async query.
- Inspect `server/src/routes/kioskToken.ts` for endpoints `/devices`, `/devices/:id`, `/heartbeat`, and `/pair/authorize`.

### 5.2 Test Commands
1. **Shared Build**:
   ```bash
   cd shared && npm run build
   ```
2. **Server TypeScript Compilation**:
   ```bash
   cd server && npm run build
   ```
3. **Full Project Build**:
   ```bash
   npm run build
   ```
4. **API Integration Verification**:
   - Call `POST /api/kiosk/pair/init` to obtain a pairing code.
   - Call `POST /api/kiosk/pair/authorize` with `{ "code": "...", "deviceName": "Test Kiosk" }` -> verify 200 OK and `deviceId` returned.
   - Call `GET /api/kiosk/devices` with user auth -> verify the device appears in list.
   - Make an authenticated request with the kiosk token -> verify 200 OK.
   - Call `DELETE /api/kiosk/devices/:id` -> verify 200 OK and revocation.
   - Make an authenticated request with the revoked kiosk token -> verify 401 Unauthorized (`Kiosk device access has been revoked.`).
