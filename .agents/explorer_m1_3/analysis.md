# Milestone 1 Backend Verification & Edge Cases Analysis

**Author:** Explorer M1-3 (Backend Verification & Edge Cases Specialist)  
**Target Milestone:** M1 — Backend Database, Auth & Kiosk Devices API  
**Date:** 2026-08-30  
**Status:** Complete  

---

## 1. Executive Summary & Problem Boundary

Milestone 1 introduces persistent device tracking (`kiosk_devices`), revocation enforcement in authentication middleware, and device lifecycle management endpoints (`GET /api/kiosk/devices`, `DELETE /api/kiosk/devices/:id`, `POST /api/kiosk/heartbeat`).

This report provides an exhaustive, evidence-based investigation into:
1. **Backward Compatibility:** Handling of legacy kiosk tokens issued prior to Milestone 1, transition semantics, and database migration safety.
2. **Edge Cases & Adversarial Scenarios:** Concurrency races, code expiration, idempotent device deletion, multi-tenant cross-family isolation, role-based access control, and malformed JWTs.
3. **Backend Test Suite & Verification Strategy:** Comprehensive 7-tier test matrix covering migrations, pairing lifecycle, listing, revocation, middleware enforcement, and adversarial security validation.

---

## 2. Backward Compatibility & Legacy Token Handling

### 2.1 Current Codebase State
Direct inspection of `server/src/middleware/auth.ts` (lines 38–44) and `server/src/routes/kioskToken.ts` (lines 30–40, 109–114) reveals:
- `generateKioskToken(userId, ownerId)` produces a 10-year (`3650d`) JWT containing:
  ```json
  { "userId": "...", "ownerId": "...", "isKiosk": true }
  ```
- No `deviceId` is embedded in the JWT payload.
- `authMiddleware` (lines 15–36) verifies the JWT cryptographic signature and sets `req.userId`, `req.actualUserId`, and `req.isOwner`, but performs **no database lookup** against any device registry or revocation table.
- Kiosk tokens generated before Milestone 1 are completely stateless and un-tracked in PostgreSQL.

### 2.2 The "Ghost Device" Problem
If existing legacy tokens continue to be accepted without validation:
1. They cannot be linked to any row in `kiosk_devices` because no `deviceId` exists in the token.
2. They will **never appear** in the Dashboard Settings device list (`GET /api/kiosk/devices`).
3. They **cannot be remotely revoked** individually via `DELETE /api/kiosk/devices/:id`.
4. If a user revokes all devices or expects an unlinked TV to lose access, legacy displays would continue functioning until 10 years expire or the JWT secret is rotated.

### 2.3 Evaluation of Migration & Compatibility Strategies

| Strategy | Mechanism | Security & Revocability | User Experience | Recommendation |
|---|---|---|---|---|
| **Option A: Strict Cutover (Auto Re-Pair)** | `authMiddleware` rejects kiosk tokens lacking `deviceId` with `401 Unauthorized`. | **High**: Eliminates ghost devices. 100% of active displays are tracked and revokable. | **Seamless**: Kiosk catches 401 via `openfamily:auth-expired`, clears `localStorage`, shows QR code. User re-pairs in 5s. | **RECOMMENDED** |
| **Option B: Graceful Auto-Backfill on First Request** | `authMiddleware` detects missing `deviceId`, inserts a fallback row in `kiosk_devices`. | **Low**: Middleware cannot change the client's already-stored JWT without an active refresh protocol. | **Confusing**: Creates duplicate "Legacy Display" rows on every different connection if IP/UA changes. | Not recommended |
| **Option C: Permissive Legacy Pass** | If `isKiosk: true` and `!deviceId`, bypass DB revocation check. | **Critical Flaw**: Legacy displays can never be revoked from `/settings`. | **Insecure**: Defeats requirement R2. | Strictly rejected |

### 2.4 Recommended Specification for `authMiddleware`
When `decoded.isKiosk === true`:
1. If `!decoded.deviceId` or `typeof decoded.deviceId !== 'string'`:
   - Return `401 Unauthorized`:
     ```json
     { "success": false, "error": "Legacy kiosk session expired. Please re-pair your display." }
     ```
2. If `decoded.deviceId` is present:
   - Query `SELECT id, revoked_at FROM kiosk_devices WHERE id = $1 AND user_id = $2`:
     - If row does not exist OR `row.revoked_at IS NOT NULL`:
       - Return `401 Unauthorized`:
         ```json
         { "success": false, "error": "Kiosk device revoked or not recognized." }
         ```
     - If active (`revoked_at IS NULL`):
       - Attach `req.kioskDeviceId = decoded.deviceId` to `req` and call `next()`.

### 2.5 Handling `GET /api/kiosk/token` Direct Minting
In `server/src/routes/kioskToken.ts` (lines 30–40), `GET /api/kiosk/token` was previously a direct endpoint to mint a raw kiosk JWT.
- **Requirement**: This endpoint must be updated to insert a row into `kiosk_devices` (e.g. `device_name = 'Direct API Display'`, `ip_address = req.ip`, `user_agent = req.headers['user-agent']`) and embed the generated UUID in the token.
- Alternatively, mark `GET /api/kiosk/token` as deprecated and require `POST /api/kiosk/pair/authorize` as the canonical entry point.

### 2.6 Database Migration Backward Compatibility
- Migration 023 in `server/src/db.ts` uses `CREATE TABLE IF NOT EXISTS kiosk_devices` and `CREATE INDEX IF NOT EXISTS`.
- All fields (`user_agent`, `ip_address`, `device_type`, `device_token`) are nullable or have sensible defaults.
- Foreign key `user_id REFERENCES users(id) ON DELETE CASCADE` ensures clean referential integrity when user accounts are removed.
- Running `runMigrations()` on existing databases is 100% non-destructive and idempotent.

---

## 3. Edge Cases & Adversarial Scenarios

### 3.1 Concurrent Pairing Requests & Race Conditions

#### Scenario 1: 6-Digit Code Collision on `/pair/init`
- **Mechanism**: `server/src/routes/kioskToken.ts` generates 6-digit codes:
  ```typescript
  do {
      code = Math.floor(100000 + Math.random() * 900000).toString();
  } while (pairSessions.has(code));
  ```
- **Analysis**: The `do...while` loop prevents code collisions in the `pairSessions` Map. In a single-instance Node.js process, JavaScript's single-threaded event loop ensures synchronous map checks and insertions are atomic.
- **Capacity**: With 900,000 possible codes and 10-minute expiry, memory footprint is negligible (< 100 bytes per session).

#### Scenario 2: Concurrent Duplicate Authorization (`POST /pair/authorize`)
- **Race Condition**: Two parents simultaneously scan the same QR code on a newly installed TV and click "Autorizar" at the exact same moment.
- **Edge Behavior**:
  - Request 1 creates the `kiosk_devices` record, sets `session.token = token; session.authorized = true;`.
  - Request 2 arrives:
    - If `session.authorized` is already `true`:
      - Option A: Reject with `400 Bad Request: { success: false, error: "Este código já foi autorizado." }`.
      - Option B: Overwrite or return existing success.
    - **Recommended Behavior**: Check `if (session.authorized) return res.status(400).json({ success: false, error: 'Código já autorizado.' });`.

#### Scenario 3: Polling Consumption Race in `GET /pair/status`
- **Race Condition**: TV polls `GET /api/kiosk/pair/status?code=XXXXXX` every 2s.
- **Edge Behavior**:
  - When `session.authorized && session.token` is true, `/pair/status` consumes the session via `pairSessions.delete(code)`.
  - If the TV receives the response, it immediately stores the token and loads the dashboard.
  - If an attacker attempts to poll the same code later, `pairSessions.has(code)` is `false`, returning `authorized: false, expired: true`. The token is never exposed to subsequent callers.

#### Scenario 4: Multiple Displays Pairing Concurrently in Same Household
- Display A gets code `111111`, Display B gets code `222222`.
- Both sessions exist independently in `pairSessions`.
- Authorizing `111111` mints JWT with `deviceId_A`; authorizing `222222` mints JWT with `deviceId_B`.
- Both rows exist in `kiosk_devices` under the same `user_id`. Each display has an isolated, individually revokable lifecycle.

---

### 3.2 Expired 6-Digit Codes & Polling Semantics

#### Scenario 1: Display Left on Pairing Screen for > 10 Minutes
- In-memory `session.expiresAt` is set to `Date.now() + 600_000`.
- On next poll to `GET /pair/status?code=XXXXXX`:
  - `Date.now() > session.expiresAt` triggers `pairSessions.delete(code)` and returns:
    ```json
    { "success": true, "authorized": false, "expired": true }
    ```
- Frontend detects `expired: true`, triggers a fresh `POST /pair/init`, and updates the QR code without user intervention.

#### Scenario 2: User Authorizes an Expired Code on Phone
- User enters 6-digit code after 11 minutes:
- `POST /pair/authorize` verifies `session.expiresAt < Date.now()`:
  - Deletes expired session from map.
  - Returns `400 Bad Request`:
    ```json
    { "success": false, "error": "Este código de pareamento já expirou." }
    ```

#### Scenario 3: Server Restart During Pending Pairing
- In-memory `pairSessions` is wiped on process restart.
- Next poll from TV returns `{ success: true, authorized: false, expired: true }`.
- TV automatically calls `/pair/init` and gets a new valid code.
- Already-linked displays are unaffected because their JWTs and `kiosk_devices` rows are safely in PostgreSQL.

---

### 3.3 Deleting Already Revoked Devices & Idempotency

#### Scenario 1: Double-Click or Concurrent Unlink Requests
- User clicks "Desvincular" twice quickly in `/settings`, or two dashboard sessions click "Desvincular" on the same device.
- Endpoint: `DELETE /api/kiosk/devices/:id`
- **SQL Execution**:
  ```sql
  UPDATE kiosk_devices
  SET revoked_at = CURRENT_TIMESTAMP
  WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL
  RETURNING id, device_name;
  ```
- If `result.rowCount === 0`:
  - Run fallback check: `SELECT id, revoked_at FROM kiosk_devices WHERE id = $1 AND user_id = $2;`
  - If row not found: Return `404 Not Found` (`{ success: false, error: "Dispositivo não encontrado." }`).
  - If row found and `revoked_at IS NOT NULL`: Return `200 OK` (`{ success: true, message: "Dispositivo já estava desvinculado." }`).
  - **Idempotency Guarantee**: Subsequent DELETE requests succeed safely without errors or state corruption.

#### Scenario 2: WebSocket Revocation Broadcast
- When `revoked_at` is set, server calls:
  ```typescript
  broadcast(req.userId!, {
      type: 'update',
      entity: 'kiosk',
      action: 'deleted',
  });
  ```
- Connected Kiosk displays listening on WebSocket receive the event, compare `id` (or refresh auth), clear `localStorage['openfamily.kioskToken']`, and redirect to `/kiosk`.

---

### 3.4 Cross-Tenant & Unauthorized Access Attacks

#### Scenario 1: Cross-Family Device Deletion (Tenant Isolation)
- **Attack**: User from Family A (`userId_A`) sends `DELETE /api/kiosk/devices/<UUID_of_Family_B>`.
- **Enforcement**:
  - The SQL statement explicitly filters `WHERE id = $1 AND user_id = $2` with params `[req.params.id, req.userId]`.
  - The query returns `0` rows.
  - API returns `404 Not Found`.
  - Family B's device remains completely untouched. No information leakage.

#### Scenario 2: Child Account (`role: 'enfant'`) Attempting Device Revocation
- **Attack**: A child user logs in on their phone and sends `DELETE /api/kiosk/devices/:id`.
- **Enforcement**:
  - Apply `requireParent` middleware to `DELETE /api/kiosk/devices/:id`.
  - `requireParent` checks the database role of `req.actualUserId`.
  - Returns `403 Forbidden`:
    ```json
    { "success": false, "error": "Action réservée aux parents." }
    ```

#### Scenario 3: Non-Owner Parent Listing Family Devices
- When a spouse/parent in a shared family account accesses `/settings`, `req.userId` is resolved by `authMiddleware` to `decoded.ownerId ?? decoded.userId`.
- `GET /api/kiosk/devices` lists all devices linked to the family owner's account (`user_id = req.userId`).
- All parents in the family can view and manage household displays.

---

### 3.5 Malformed JWTs, Signature Tampering & Database Failure Modes

#### Scenario 1: Tampered JWT Signature
- An attacker modifies the JWT header or payload (e.g. changing `userId` or `deviceId`).
- `jwt.verify(token, getJwtSecret())` throws `JsonWebTokenError: invalid signature`.
- `authMiddleware` catches the exception and returns `401 Unauthorized` (`{ success: false, error: "Invalid token" }`).

#### Scenario 2: SQL Injection / Malformed UUID in `deviceId` Claim
- An attacker crafts a JWT with `deviceId: "'; DROP TABLE kiosk_devices; --"` signed with stolen key, or sends an invalid UUID string.
- Database parameterization (`$1`) prevents SQL injection.
- If Postgres rejects invalid UUID syntax, `try/catch` in `authMiddleware` catches the database error, logs the security warning, and returns `401 Unauthorized`.

#### Scenario 3: Database Connection Timeout / Outage During Auth Check
- If the PostgreSQL pool is temporarily overloaded or down:
- `authMiddleware`'s `query(...)` throws an exception.
- The middleware must **FAIL CLOSED**: catch error, log `logger.error('auth.db_error', ...)`, and return `500 Internal Server Error` (or `401`). Under no circumstance does it call `next()`.

---

## 4. Backend Unit & Integration Test Strategy for Milestone 1

### 4.1 Test Architecture & Harness

The test suite is organized into 7 distinct tiers using an automated integration test script (`tests/integration/kiosk_backend_test.ts` or standalone runnable via `tsx`):

```
                               ┌──────────────────────────────────────────────┐
                               │       Milestone 1 Test Suite Matrix          │
                               └──────────────────────┬───────────────────────┘
                                                      │
         ┌───────────────────┬────────────────────────┼────────────────────────┬───────────────────┐
         ▼                   ▼                        ▼                        ▼                   ▼
    [ Tier 1 ]          [ Tier 2 ]               [ Tier 3 ]               [ Tier 4 ]          [ Tier 5 ]
Database Migrations    Pairing Flow            Device Listing          Revocation & WS      Auth Enforcement
- Idempotency check    - /pair/init             - GET /devices          - DELETE /devices    - Active token (200)
- Table constraints    - /pair/status (poll)    - Filter revoked        - Idempotent delete  - Revoked token (401)
- Indexes & FKs        - /pair/authorize        - Cross-tenant hidden   - WS broadcast       - Legacy token (401)
                       - Session consumption                                                 - Malformed JWT (401)
                                                      │
                                   ┌──────────────────┴──────────────────┐
                                   ▼                                     ▼
                              [ Tier 6 ]                            [ Tier 7 ]
                         Multi-Tenant & RBAC                   Adversarial & Edge
                         - Cross-family DELETE (404)           - Code expiration (10m)
                         - Enfant deletion (403)               - Duplicate authorization (400)
                         - Parent authorization                - Invalid 6-digit code (400)
```

---

### 4.2 Detailed Test Specification per Tier

#### Tier 1: Database Migration & Schema Integrity
1. **Test 1.1 — Idempotent Migration Execution**:
   - Execute `runMigrations()` twice consecutively.
   - Assert promise resolves with zero errors.
2. **Test 1.2 — Table & Column Existence**:
   - Query `information_schema.columns` for table `kiosk_devices`.
   - Assert presence of: `id` (uuid), `user_id` (uuid), `device_name` (character varying), `device_type` (character varying), `user_agent` (text), `ip_address` (character varying), `device_token` (character varying), `last_active_at` (timestamp with time zone), `revoked_at` (timestamp with time zone), `created_at` (timestamp with time zone).
3. **Test 1.3 — Referential Integrity on Cascade Delete**:
   - Insert temporary user and associated `kiosk_devices` row.
   - Delete user.
   - Assert associated `kiosk_devices` row is automatically deleted (`ON DELETE CASCADE`).

#### Tier 2: Pairing Lifecycle & Session State Machine
1. **Test 2.1 — Pairing Init (`POST /api/kiosk/pair/init`)**:
   - Call endpoint without auth headers.
   - Expect HTTP 200 `{ success: true, code: "XXXXXX" }`.
   - Assert `code` matches `/^\d{6}$/`.
2. **Test 2.2 — Pairing Status Pending (`GET /api/kiosk/pair/status?code=XXXXXX`)**:
   - Poll endpoint with generated code.
   - Expect HTTP 200 `{ success: true, authorized: false }`.
3. **Test 2.3 — Pairing Authorization (`POST /api/kiosk/pair/authorize`)**:
   - Authenticate as User 1.
   - Post `{ code: "XXXXXX", deviceName: "Living Room Display" }`.
   - Expect HTTP 200 `{ success: true, message: "...", token: "<jwt>", deviceId: "<uuid>" }`.
   - Verify `kiosk_devices` contains new row with `device_name = 'Living Room Display'`, `user_id = User 1.id`, `revoked_at IS NULL`.
4. **Test 2.4 — Pairing Status Completion (`GET /api/kiosk/pair/status?code=XXXXXX`)**:
   - Poll endpoint again with authorized code.
   - Expect HTTP 200 `{ success: true, authorized: true, token: "<jwt>" }`.
5. **Test 2.5 — Session Single-Use Consumption**:
   - Poll endpoint a second time with the same code.
   - Expect HTTP 200 `{ success: true, authorized: false, expired: true }`.

#### Tier 3: Device Listing & Metadata Verification
1. **Test 3.1 — List Active Devices (`GET /api/kiosk/devices`)**:
   - Authenticate as User 1.
   - Call endpoint.
   - Expect HTTP 200 with array containing the newly authorized device with fields: `id`, `userId`, `deviceName`, `deviceType`, `userAgent`, `ipAddress`, `lastActiveAt`, `createdAt`.
2. **Test 3.2 — Multi-Device Listing**:
   - Authorize a second device ("Kitchen Tablet").
   - Call `GET /api/kiosk/devices`.
   - Expect array length of 2.
3. **Test 3.3 — Exclude Revoked Devices from Default List**:
   - Revoke device 1.
   - Call `GET /api/kiosk/devices`.
   - Expect array length of 1 (only "Kitchen Tablet").

#### Tier 4: Device Revocation & WebSocket Event
1. **Test 4.1 — Revoke Active Device (`DELETE /api/kiosk/devices/:id`)**:
   - Authenticate as User 1.
   - Delete device ID.
   - Expect HTTP 200 `{ success: true, message: "..." }`.
   - Verify DB row has `revoked_at IS NOT NULL`.
2. **Test 4.2 — Idempotent Re-Deletion**:
   - Send `DELETE /api/kiosk/devices/:id` on the same ID again.
   - Expect HTTP 200 (or graceful idempotent message).
3. **Test 4.3 — Non-Existent Device Deletion**:
   - Send `DELETE /api/kiosk/devices/00000000-0000-0000-0000-000000000000`.
   - Expect HTTP 404 `{ success: false, error: "..." }`.

#### Tier 5: Authentication & Revocation Enforcement in `authMiddleware`
1. **Test 5.1 — Active Kiosk Token Access**:
   - Call `GET /api/dashboard` or `POST /api/kiosk/heartbeat` with active Kiosk JWT.
   - Expect HTTP 200 OK.
2. **Test 5.2 — Revoked Kiosk Token Access**:
   - Revoke the device in database.
   - Call `GET /api/dashboard` or `POST /api/kiosk/heartbeat` with the same Kiosk JWT.
   - Expect HTTP 401 Unauthorized `{ success: false, error: "..." }`.
3. **Test 5.3 — Legacy Kiosk Token (Missing `deviceId`)**:
   - Mint a JWT with `{ userId: User1.id, isKiosk: true }` without `deviceId`.
   - Call `GET /api/dashboard` with this token.
   - Expect HTTP 401 Unauthorized.
4. **Test 5.4 — Regular User Token Unaffected**:
   - Call `GET /api/dashboard` with regular user JWT (7d expiry, no `isKiosk`).
   - Expect HTTP 200 OK (regular user tokens do not require `kiosk_devices` lookup).

#### Tier 6: Multi-Tenant Isolation & Role Authorization
1. **Test 6.1 — Cross-Tenant List Isolation**:
   - User 2 calls `GET /api/kiosk/devices`.
   - Expect HTTP 200 with `[]` (empty array, zero leakage of User 1's devices).
2. **Test 6.2 — Cross-Tenant Revocation Prevention**:
   - User 2 sends `DELETE /api/kiosk/devices/:User1_DeviceId`.
   - Expect HTTP 404 Not Found.
   - Verify User 1's device `revoked_at` remains NULL.
3. **Test 6.3 — Child Account Revocation Blocked**:
   - Authenticate as child user (`role = 'enfant'`).
   - Child sends `DELETE /api/kiosk/devices/:id`.
   - Expect HTTP 403 Forbidden (`{ success: false, error: "Action réservée aux parents." }`).

#### Tier 7: Adversarial & Edge Case Attacks
1. **Test 7.1 — Invalid 6-Digit Code on Authorize**:
   - Post `{ code: "999999" }` to `/api/kiosk/pair/authorize`.
   - Expect HTTP 400 Bad Request.
2. **Test 7.2 — Expired Code on Authorize**:
   - Manually insert expired session in pairSessions map (`expiresAt = Date.now() - 1000`).
   - Call `/pair/authorize` with this code.
   - Expect HTTP 400 Bad Request.
3. **Test 7.3 — Malformed JWT Signature**:
   - Send `Authorization: Bearer invalid.token.value`.
   - Expect HTTP 401 Unauthorized.
4. **Test 7.4 — Tampered Payload with Forged `deviceId`**:
   - Sign a JWT with valid secret but non-existent random UUID in `deviceId`.
   - Expect HTTP 401 Unauthorized.

---

## 5. Concrete Implementation Guidance & Code Contracts

### 5.1 Database Migration (`server/src/db.ts`)
Add to `migrations` array in `runMigrations()`:
```sql
-- Migration 023: Kiosk Devices persistent registry and remote revocation tracking
CREATE TABLE IF NOT EXISTS kiosk_devices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_name VARCHAR(100) NOT NULL,
    device_type VARCHAR(100),
    user_agent TEXT,
    ip_address VARCHAR(45),
    device_token VARCHAR(255),
    last_active_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_kiosk_devices_user ON kiosk_devices(user_id);
CREATE INDEX IF NOT EXISTS idx_kiosk_devices_user_active ON kiosk_devices(user_id) WHERE revoked_at IS NULL;
```

### 5.2 Middleware Update (`server/src/middleware/auth.ts`)
```typescript
export interface AuthRequest extends Request {
    userId?: string;
    actualUserId?: string;
    isOwner?: boolean;
    kioskDeviceId?: string;
}

export const authMiddleware = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const authHeader = req.headers.authorization;
        let token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';

        if (!token && req.query.token && typeof req.query.token === 'string') {
            token = req.query.token;
        }

        if (!token) {
            return res.status(401).json({ success: false, error: 'No token provided' });
        }

        const decoded = jwt.verify(token, getJwtSecret()) as {
            userId: string;
            ownerId?: string;
            isKiosk?: boolean;
            deviceId?: string;
        };

        // Kiosk Device Validation & Revocation Check
        if (decoded.isKiosk) {
            if (!decoded.deviceId) {
                return res.status(401).json({
                    success: false,
                    error: 'Legacy kiosk session expired. Please re-pair your display.',
                });
            }

            const deviceResult = await query(
                'SELECT id, revoked_at FROM kiosk_devices WHERE id = $1 AND user_id = $2',
                [decoded.deviceId, decoded.ownerId ?? decoded.userId]
            );

            const device = deviceResult.rows[0];
            if (!device || device.revoked_at) {
                return res.status(401).json({
                    success: false,
                    error: 'Kiosk device revoked or not recognized.',
                });
            }

            req.kioskDeviceId = decoded.deviceId;
        }

        req.actualUserId = decoded.userId;
        req.userId = decoded.ownerId ?? decoded.userId;
        req.isOwner = !decoded.ownerId || decoded.ownerId === decoded.userId;
        next();
    } catch (error) {
        return res.status(401).json({ success: false, error: 'Invalid token' });
    }
};

export const generateKioskToken = (userId: string, ownerId: string | undefined, deviceId: string): string => {
    return jwt.sign(
        { userId, ownerId: ownerId ?? userId, isKiosk: true, deviceId },
        getJwtSecret(),
        { expiresIn: '3650d' }
    );
};
```

### 5.3 Broadcaster Union Extension (`server/src/lib/broadcaster.ts`)
```typescript
export type WsEntity =
    | 'tasks'
    | 'shopping'
    | 'appointments'
    | 'family'
    | 'budget'
    | 'recipes'
    | 'meal-plans'
    | 'planning'
    | 'notifications'
    | 'integrations'
    | 'rewards'
    | 'notes'
    | 'kiosk';
```

---

## 6. Summary of Key Findings & Recommendations

1. **Legacy Token Handling:**
   - Strict cutover via `401 Unauthorized` on missing `deviceId` is strongly recommended. This guarantees 100% device auditability and security compliance without zombie sessions.
2. **Race-Proof Pairing:**
   - In-memory `pairSessions` Map is atomic for single-process Node. Single-use deletion on `/pair/status` prevents code reuse.
3. **Idempotent Revocation:**
   - `DELETE /api/kiosk/devices/:id` returns 200 for active revocation, 200 idempotent for already revoked, 404 for non-existent or foreign devices.
4. **Access Control:**
   - Protect `DELETE /api/kiosk/devices/:id` with `requireParent` to prevent children from unlinking household displays.
5. **Fail-Closed Security:**
   - Any database error during `authMiddleware` kiosk check fails closed with 401/500, never leaking unauthorized access.
