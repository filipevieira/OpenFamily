# Milestone 1: Database Schema Migration, Auth Middleware & Kiosk Devices API Specification

## 1. Executive Summary
This document specifies the exact technical architecture, database schema migrations, auth middleware enhancements, performance optimizations, and API contracts required to implement **Milestone 1: Backend Database, Auth & Kiosk Devices API** for OpenFamily Universal Kiosk Mode.

---

## 2. Database Migration System (`server/src/db.ts` & `server/schema.sql`)

### 2.1 Context & Existing Architecture
In OpenFamily, database migrations are defined in `server/src/db.ts` within the `runMigrations()` function. Migrations are written as an array of idempotent SQL statements executed sequentially at server startup.
In addition, `server/schema.sql` holds the canonical full schema for fresh PostgreSQL initializations.

### 2.2 Proposed Migration: Migration 023 (`kiosk_devices`)
Add the following SQL migrations to the end of the `migrations` array in `server/src/db.ts` (immediately following Migration 022, line 369):

```sql
// Migration 023: Kiosk Devices table and indexes for remote display management and token revocation
`CREATE TABLE IF NOT EXISTS kiosk_devices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_name VARCHAR(255) NOT NULL DEFAULT 'Kiosk Display',
    device_type VARCHAR(100),
    user_agent TEXT,
    ip_address VARCHAR(45),
    device_token TEXT,
    last_active_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    revoked_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)`,
'CREATE INDEX IF NOT EXISTS idx_kiosk_devices_user_id ON kiosk_devices(user_id)',
'CREATE INDEX IF NOT EXISTS idx_kiosk_devices_revoked_at ON kiosk_devices(revoked_at)',
'CREATE INDEX IF NOT EXISTS idx_kiosk_devices_active_user ON kiosk_devices(user_id) WHERE revoked_at IS NULL',
`DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgname = 'update_kiosk_devices_updated_at'
    ) THEN
        CREATE TRIGGER update_kiosk_devices_updated_at
        BEFORE UPDATE ON kiosk_devices
        FOR EACH ROW
        EXECUTE FUNCTION update_updated_at_column();
    END IF;
END
$$`,
```

### 2.3 Field Specification & Design Rationale
| Column | Type | Nullable | Default | Rationale |
|---|---|---|---|---|
| `id` | `UUID` | No | `uuid_generate_v4()` | Primary key; embedded as `deviceId` in Kiosk JWTs. B-Tree indexed by default for $O(\log N)$ lookup. |
| `user_id` | `UUID` | No | None | References `users(id)` with `ON DELETE CASCADE`. Links display to the family account. |
| `device_name` | `VARCHAR(255)` | No | `'Kiosk Display'` | User-editable or default display label (e.g., "Smart Display Sala", "Samsung Smart Fridge 7-inch"). |
| `device_type` | `VARCHAR(100)` | Yes | `NULL` | Device category/hardware form-factor (e.g., "Smart TV", "Tablet", "Refrigerator", "Browser"). |
| `user_agent` | `TEXT` | Yes | `NULL` | Browser User-Agent header captured from the kiosk screen at initialization or heartbeat. |
| `ip_address` | `VARCHAR(45)` | Yes | `NULL` | Client IP address. Length 45 accommodates full IPv6 strings or IPv4-mapped IPv6 notation (`::ffff:192.168.1.1`). |
| `device_token` | `TEXT` | Yes | `NULL` | Optional reference token / legacy storage. |
| `last_active_at` | `TIMESTAMP` | Yes | `CURRENT_TIMESTAMP` | Last communication timestamp. Updated by `POST /api/kiosk/heartbeat` and `pair/authorize`. |
| `revoked_at` | `TIMESTAMP` | Yes | `NULL` | Soft-delete revocation marker. `NULL` = Active; Timestamp = Revoked/Unlinked. |
| `created_at` | `TIMESTAMP` | Yes | `CURRENT_TIMESTAMP` | Device initial pairing timestamp. |
| `updated_at` | `TIMESTAMP` | Yes | `CURRENT_TIMESTAMP` | Auto-updated on modification via PostgreSQL trigger `update_updated_at_column()`. |

### 2.4 Canonical Schema Update (`server/schema.sql`)
Append to `server/schema.sql`:
```sql
-- Kiosk Devices table (remote display pairing and lifecycle tracking)
CREATE TABLE kiosk_devices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_name VARCHAR(255) NOT NULL DEFAULT 'Kiosk Display',
    device_type VARCHAR(100),
    user_agent TEXT,
    ip_address VARCHAR(45),
    device_token TEXT,
    last_active_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    revoked_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_kiosk_devices_user_id ON kiosk_devices(user_id);
CREATE INDEX idx_kiosk_devices_revoked_at ON kiosk_devices(revoked_at);
CREATE INDEX idx_kiosk_devices_active_user ON kiosk_devices(user_id) WHERE revoked_at IS NULL;

CREATE TRIGGER update_kiosk_devices_updated_at BEFORE UPDATE ON kiosk_devices FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
```

---

## 3. Auth Middleware (`server/src/middleware/auth.ts`)

### 3.1 Interface Updates
Extend `AuthRequest` to include Kiosk metadata:

```typescript
// Target file: server/src/middleware/auth.ts (Lines 6-13)
export interface AuthRequest extends Request {
    /** Effective family-owner user ID — used by all data queries */
    userId?: string;
    /** Actual logged-in user's ID (may differ from userId when the user is a family member) */
    actualUserId?: string;
    /** True when the logged-in user IS the family owner (or a standalone user) */
    isOwner?: boolean;
    /** True when the request is authenticated with a Kiosk token */
    isKiosk?: boolean;
    /** Unique Kiosk device ID from kiosk_devices table */
    deviceId?: string;
}
```

### 3.2 Token Generator Updates
Enhance `generateKioskToken` to embed `deviceId`:

```typescript
// Target file: server/src/middleware/auth.ts (Lines 42-44)
export const generateKioskToken = (userId: string, ownerId?: string, deviceId?: string): string => {
    const payload: { userId: string; ownerId: string; isKiosk: boolean; deviceId?: string } = {
        userId,
        ownerId: ownerId ?? userId,
        isKiosk: true,
    };
    if (deviceId) {
        payload.deviceId = deviceId;
    }
    return jwt.sign(payload, getJwtSecret(), { expiresIn: '3650d' });
};
```

### 3.3 Middleware Verification (`authMiddleware`)
Convert `authMiddleware` to `async` and query `kiosk_devices` when `isKiosk: true`:

```typescript
// Target file: server/src/middleware/auth.ts (Lines 15-36)
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

        req.actualUserId = decoded.userId;
        req.userId = decoded.ownerId ?? decoded.userId;
        req.isOwner = !decoded.ownerId || decoded.ownerId === decoded.userId;
        req.isKiosk = Boolean(decoded.isKiosk);
        req.deviceId = decoded.deviceId;

        // If this is a Kiosk token, verify device is tracked and not revoked
        if (decoded.isKiosk) {
            if (!decoded.deviceId) {
                return res.status(401).json({
                    success: false,
                    error: 'Kiosk device unlinked or missing device tracking. Please re-pair.',
                });
            }

            const deviceCheck = await query(
                'SELECT id, revoked_at FROM kiosk_devices WHERE id = $1',
                [decoded.deviceId]
            );

            if (deviceCheck.rowCount === 0) {
                return res.status(401).json({
                    success: false,
                    error: 'Kiosk device not found.',
                });
            }

            const device = deviceCheck.rows[0];
            if (device.revoked_at !== null) {
                return res.status(401).json({
                    success: false,
                    error: 'Kiosk device access has been revoked.',
                });
            }
        }

        next();
    } catch (error) {
        return res.status(401).json({ success: false, error: 'Invalid token' });
    }
};
```

---

## 4. Performance & Caching Analysis

### 4.1 Latency & Query Cost of Direct DB Verification
- **Indexed PK Scan**: `SELECT id, revoked_at FROM kiosk_devices WHERE id = $1` runs against the primary key B-Tree index (`kiosk_devices_pkey`).
- **PostgreSQL Execution Time**: Single-row index lookup overhead is **< 0.2ms**.
- **Connection Pool**: OpenFamily's `pg.Pool` configuration (max 20 connections, idle timeout 30s) comfortably supports **>2,000 req/sec** on standard homelab hardware (Raspberry Pi 4 / Intel Celeron N5105 / VPS).

### 4.2 Why Direct DB Lookup is Superior to In-Memory / Redis Caching Here
1. **Zero-Stale-Window Requirement**: When a user clicks "Desvincular Dispositivo" on their phone or dashboard, the TV/display must immediately lose access on its next request. Direct DB queries guarantee instantaneous consistency without distributed cache invalidation hooks.
2. **Homelab Simplicity**: Zero external cache dependency (like Redis).
3. **Low Write Contention**: Decoupling `last_active_at` updates to a dedicated heartbeat endpoint ensures that routine GET requests through `authMiddleware` remain pure read-only lookups, incurring no row-level write locks.

---

## 5. Kiosk Device API Endpoints (`server/src/routes/kioskToken.ts`)

### 5.1 Endpoint Specifications

#### 1. `GET /api/kiosk/devices`
- **Auth**: Required (`authMiddleware`).
- **Query**:
  ```sql
  SELECT id, user_id, device_name, device_type, user_agent, ip_address, last_active_at, created_at
  FROM kiosk_devices
  WHERE user_id = $1 AND revoked_at IS NULL
  ORDER BY last_active_at DESC, created_at DESC
  ```
- **Response** (200 OK):
  ```json
  {
    "success": true,
    "data": [
      {
        "id": "18f9ef94-912b-42ef-9f37-12b2db841f39",
        "userId": "d74e892c-81b4-4e2b-bbd8-f80e72bb3a12",
        "deviceName": "Smart Display Sala",
        "deviceType": "Chrome on Linux / Smart TV",
        "userAgent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36...",
        "ipAddress": "192.168.1.50",
        "lastActiveAt": "2026-08-30T07:15:00.000Z",
        "createdAt": "2026-08-30T07:00:00.000Z"
      }
    ]
  }
  ```

#### 2. `DELETE /api/kiosk/devices/:id`
- **Auth**: Required (`authMiddleware`, `requireParent` or family owner).
- **Operation**: Soft delete (`revoked_at = CURRENT_TIMESTAMP`).
- **Query**:
  ```sql
  UPDATE kiosk_devices
  SET revoked_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
  WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL
  RETURNING id, device_name
  ```
- **WebSocket Broadcast**:
  ```typescript
  broadcast(req.userId, {
      type: 'update',
      entity: 'kiosk',
      action: 'deleted',
  });
  ```
- **Response** (200 OK):
  ```json
  {
    "success": true,
    "message": "Dispositivo desvinculado com sucesso"
  }
  ```
- **Error Response** (404 Not Found):
  ```json
  {
    "success": false,
    "error": "Dispositivo não encontrado ou já desvinculado."
  }
  ```

#### 3. `POST /api/kiosk/pair/authorize`
- **Auth**: Required (`authMiddleware`).
- **Body**: `{ "code": "123456", "deviceName": "Display Cozinha", "deviceType": "Smart TV" }`
- **Logic**:
  1. Validate code from in-memory `pairSessions` map.
  2. Extract client IP and user agent.
  3. Insert row into `kiosk_devices`:
     ```sql
     INSERT INTO kiosk_devices (user_id, device_name, device_type, user_agent, ip_address, last_active_at)
     VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
     RETURNING id, device_name, created_at
     ```
  4. Generate token: `const token = generateKioskToken(req.userId, req.userId, newDevice.id)`.
  5. Set `session.token = token`, `session.deviceId = newDevice.id`, `session.authorized = true`.
  6. Broadcast WS update:
     ```typescript
     broadcast(req.userId, {
         type: 'update',
         entity: 'kiosk',
         action: 'created',
     });
     ```
- **Response** (200 OK):
  ```json
  {
    "success": true,
    "message": "Dispositivo vinculado com sucesso!",
    "token": "<kiosk_jwt>",
    "deviceId": "<uuid>"
  }
  ```

#### 4. `POST /api/kiosk/heartbeat`
- **Auth**: Required (`authMiddleware` with Kiosk token).
- **Operation**: Updates `last_active_at`.
- **Query**:
  ```sql
  UPDATE kiosk_devices
  SET last_active_at = CURRENT_TIMESTAMP
  WHERE id = $1 AND revoked_at IS NULL
  ```
- **Response** (200 OK):
  ```json
  {
    "success": true,
    "active": true
  }
  ```

---

## 6. Real-Time WebSocket Updates (`server/src/lib/broadcaster.ts`)

### 6.1 `WsEntity` Type Extension
Update `WsEntity` union in `server/src/lib/broadcaster.ts` (Line 3):
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

## 7. Shared Types (`shared/src/types.ts`)

Add TypeScript interfaces to `shared/src/types.ts`:
```typescript
export interface KioskDevice {
    id: string;
    userId: string;
    deviceName: string;
    deviceType?: string;
    userAgent?: string;
    ipAddress?: string;
    lastActiveAt?: string;
    revokedAt?: string;
    createdAt: string;
    updatedAt?: string;
}

export interface KioskPairInitResponse {
    success: boolean;
    code: string;
}

export interface KioskPairStatusResponse {
    success: boolean;
    authorized: boolean;
    expired?: boolean;
    token?: string;
    deviceId?: string;
}

export interface KioskPairAuthorizeRequest {
    code: string;
    deviceName?: string;
    deviceType?: string;
}

export interface KioskPairAuthorizeResponse {
    success: boolean;
    token?: string;
    deviceId?: string;
    message?: string;
    error?: string;
}
```

---

## 8. Summary of Affected Files
| File Path | Nature of Modification |
|---|---|
| `server/src/db.ts` | Add Migration 023 to `migrations` array (creates table `kiosk_devices`, indexes, trigger). |
| `server/schema.sql` | Add table `kiosk_devices`, indexes, and trigger for fresh installs. |
| `server/src/middleware/auth.ts` | Extend `AuthRequest`, update `generateKioskToken` signature, convert `authMiddleware` to async with active check. |
| `server/src/routes/kioskToken.ts` | Implement `GET /devices`, `DELETE /devices/:id`, `POST /heartbeat`, update `pair/authorize` to persist device. |
| `server/src/lib/broadcaster.ts` | Add `'kiosk'` to `WsEntity` type union. |
| `shared/src/types.ts` | Add `KioskDevice` and pairing request/response interfaces. |
