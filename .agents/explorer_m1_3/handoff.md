# 5-Component Handoff Report: Milestone 1 Backend Verification & Edge Cases

**Agent:** Explorer M1-3 (Backend Verification & Edge Cases Specialist)  
**Recipient:** Sub-Orchestrator M1 (`sub_orch_m1`) & Lead Orchestrator  
**Milestone:** M1 — Backend Database, Auth & Kiosk Devices API  
**Date:** 2026-08-30  
**Handoff Type:** Hard (Complete Milestone 1 Backend Verification & Edge Cases Specification)  

---

## 1. Observation

Direct observations from examining the codebase:

1. **Current Token & Session Structure**:
   - In `server/src/middleware/auth.ts` (lines 42–44):
     ```typescript
     export const generateKioskToken = (userId: string, ownerId?: string): string => {
         return jwt.sign({ userId, ownerId: ownerId ?? userId, isKiosk: true }, getJwtSecret(), { expiresIn: '3650d' });
     };
     ```
     Kiosk JWTs currently contain `{ userId, ownerId, isKiosk: true }` with no `deviceId` claim.
   - In `server/src/middleware/auth.ts` (lines 15–36):
     `authMiddleware` verifies the cryptographic signature with `jwt.verify(token, getJwtSecret())` and sets `req.userId`, `req.actualUserId`, `req.isOwner`, but performs **no database lookup** against any device registry or revocation list.
   - In `server/src/routes/kioskToken.ts` (lines 13–24):
     Pairing codes are held in an ephemeral RAM Map (`pairSessions = new Map<string, PairSession>()`) with a 5-minute cleanup interval (`setInterval(..., 300_000)`). No device records are saved in PostgreSQL upon authorization.

2. **Database Schema & Migrations (`server/src/db.ts`)**:
   - `server/src/db.ts` contains migrations 001 through 022. No table or index exists for `kiosk_devices`.

3. **WebSocket Broadcaster (`server/src/lib/broadcaster.ts`)**:
   - Lines 3–15 define `WsEntity` as `'tasks' | 'shopping' | 'appointments' | 'family' | 'budget' | 'recipes' | 'meal-plans' | 'planning' | 'notifications' | 'integrations' | 'rewards' | 'notes'`. `'kiosk'` is not present in the type union.

4. **Integration Test Suite Baseline**:
   - `scripts/smoke-api.sh` tests health, register, family, shopping, tasks, appointments, planning, recipes, meal-plans, budget, dashboard, and cleanup, but has no tests for kiosk pairing, device listing, or revocation.

---

## 2. Logic Chain

1. **Backward Compatibility & Legacy Token Invalidation**:
   - *Observation*: Existing kiosk tokens minted prior to M1 do not have a `deviceId` claim and have a 10-year expiration.
   - *Logic*: If `authMiddleware` allowed legacy tokens without `deviceId` to bypass the revocation check, those displays could never be revoked remotely from `/settings`, violating core requirement R2.
   - *Conclusion*: When `decoded.isKiosk === true`, if `!decoded.deviceId`, `authMiddleware` must reject the request with `401 Unauthorized` (`'Legacy kiosk session expired. Please re-pair your display.'`). The client's 401 handler immediately triggers `openfamily:auth-expired`, clears `localStorage['openfamily.kioskToken']`, and presents the QR code pairing UI. The user re-pairs in 5 seconds, creating a registered, revokable row in `kiosk_devices`.

2. **Edge Cases & Race Conditions**:
   - *Concurrency*: Single-threaded Node.js event loop ensures `pairSessions.has(code)` and `pairSessions.set(code)` in `POST /pair/init` are atomic, preventing code collisions.
   - *Single-Use Code Consumption*: In `GET /pair/status`, deleting `pairSessions.delete(code)` upon returning the authorized token prevents subsequent replay attacks.
   - *Idempotent Deletion*: `DELETE /api/kiosk/devices/:id` updating `revoked_at = CURRENT_TIMESTAMP WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL` returns 200 on first revocation, 200 on subsequent calls (idempotent), and 404 only if the device belongs to another tenant or does not exist.
   - *Tenant Isolation & RBAC*: `user_id = req.userId` in all SQL queries prevents cross-family device deletion. Applying `requireParent` middleware to `DELETE /api/kiosk/devices/:id` blocks child accounts (`role: 'enfant'`) from unlinking family displays.

3. **Backend Test Matrix**:
   - To guarantee complete functional and security compliance for Milestone 1, the test suite must execute a 7-tier test harness verifying database migrations, pair session state transitions, multi-device listing, revocation idempotency, WebSocket event dispatch, middleware 401 enforcement, cross-tenant isolation, and adversarial attack scenarios.

---

## 3. Caveats

1. **Server Restart In-Flight Pairing**:
   - Because `pairSessions` is kept in RAM, restarting the backend during an active pairing attempt invalidates the in-flight 6-digit code. The TV's next poll to `/pair/status` receives `expired: true` and automatically regenerates a new code via `/pair/init`. Already paired displays are stored in PostgreSQL and completely unaffected.
2. **Database Performance on High-Traffic Kiosk Setups**:
   - Adding a DB query in `authMiddleware` for `isKiosk: true` requests introduces a single index lookup (`idx_kiosk_devices_user_active`). Given that homelab deployments typically have 1–5 displays polling occasionally, the latency impact is <1ms. For large enterprise scale, an in-memory Redis or LRU cache could cache active device IDs.
3. **Fail-Closed Principle**:
   - If PostgreSQL is temporarily unreachable during `authMiddleware` execution, the middleware must fail closed (return 401 or 500), never allowing unvalidated kiosk traffic through.

---

## 4. Conclusion

Milestone 1 backend verification and edge cases are fully analyzed and structured into an actionable implementation and test specification:

1. **Migration 023 (`server/src/db.ts`)**:
   - Create `kiosk_devices` table with `(id, user_id, device_name, device_type, user_agent, ip_address, device_token, last_active_at, revoked_at, created_at)` and indexes `idx_kiosk_devices_user` and `idx_kiosk_devices_user_active`.
2. **Auth Middleware (`server/src/middleware/auth.ts`)**:
   - Reject legacy tokens lacking `deviceId` with 401.
   - Query `kiosk_devices` for `id = decoded.deviceId AND user_id = req.userId AND revoked_at IS NULL`. Return 401 if revoked or missing.
3. **Kiosk Routes (`server/src/routes/kioskToken.ts`)**:
   - Update `POST /pair/authorize` to insert a row in `kiosk_devices` and embed `deviceId` in the JWT.
   - Implement `GET /api/kiosk/devices` (returning active displays).
   - Implement `DELETE /api/kiosk/devices/:id` (guarded by `requireParent`, sets `revoked_at = NOW()`, broadcasts WebSocket `'kiosk'` deletion).
   - Implement `POST /api/kiosk/heartbeat` (updates `last_active_at`).
4. **Broadcaster (`server/src/lib/broadcaster.ts`)**:
   - Add `'kiosk'` to `WsEntity`.
5. **Backend Verification Suite**:
   - Implement 7-tier test coverage covering migrations, pairing lifecycle, listing, revocation, auth enforcement, RBAC, and adversarial attacks.

---

## 5. Verification Method

Independent verification of the Milestone 1 backend implementation:

1. **Schema & Migration Verification**:
   - Inspect PostgreSQL schema after startup:
     ```sql
     SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'kiosk_devices';
     ```
   - Verify indexes `idx_kiosk_devices_user` and `idx_kiosk_devices_user_active`.

2. **Full Pairing & Revocation API Verification**:
   - `POST /api/kiosk/pair/init` -> returns 6-digit code `{"success": true, "code": "123456"}`.
   - `GET /api/kiosk/pair/status?code=123456` -> returns `{"success": true, "authorized": false}`.
   - `POST /api/kiosk/pair/authorize` with Bearer token and `{"code": "123456", "deviceName": "Living Room TV"}` -> returns `{"success": true, "token": "...", "deviceId": "..."}`.
   - `GET /api/kiosk/pair/status?code=123456` -> returns `{"success": true, "authorized": true, "token": "..."}`.
   - `GET /api/kiosk/devices` -> returns array with the linked device.
   - `POST /api/kiosk/heartbeat` with kiosk token -> returns `{"success": true, "active": true}`.
   - `DELETE /api/kiosk/devices/:deviceId` with parent token -> returns `{"success": true}`.
   - `POST /api/kiosk/heartbeat` with same kiosk token -> returns `401 Unauthorized`.
   - `GET /api/dashboard` with same kiosk token -> returns `401 Unauthorized`.

3. **Adversarial & Multi-Tenant Security Verification**:
   - User B attempting `DELETE /api/kiosk/devices/:UserA_DeviceId` -> returns `404 Not Found`.
   - Child account (`role = 'enfant'`) attempting `DELETE /api/kiosk/devices/:id` -> returns `403 Forbidden`.
   - Token with missing `deviceId` or tampered signature -> returns `401 Unauthorized`.

4. **TypeScript Build Verification**:
   - Run `npm run build` from root to confirm zero compilation errors across `shared`, `server`, and `client`.
