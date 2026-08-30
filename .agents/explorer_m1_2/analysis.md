# Analysis Report: Kiosk Devices API & WebSocket Architecture (Milestone 1)

**Agent**: Explorer M1-2 (Kiosk API & WebSocket Specialist)  
**Date**: 2026-08-30  
**Project**: OpenFamily Universal Kiosk Mode & Remote Device Management  
**Scope**: `server/src/routes/kioskToken.ts`, `server/src/app.ts`, `server/src/lib/broadcaster.ts`, `server/src/middleware/auth.ts`, `server/src/db.ts`

---

## 1. Executive Summary

Milestone 1 establishes the backend database, authentication lifecycle, device management API, and real-time WebSocket revocation for Kiosk displays.
Currently, `server/src/routes/kioskToken.ts` only provides in-memory pairing (`pairSessions`) and static 10-year token generation without device persistence or revocation.
This analysis specifies:
1. **Database Schema**: `kiosk_devices` table and migration in `server/src/db.ts`.
2. **Auth & Revocation Middleware**: Embedding `deviceId` into Kiosk JWT and authoritative `revoked_at IS NULL` verification in `server/src/middleware/auth.ts`.
3. **Kiosk Devices REST API**: Complete endpoint specifications for `GET /api/kiosk/devices`, `DELETE /api/kiosk/devices/:id`, `POST /api/kiosk/pair/authorize`, `POST /api/kiosk/heartbeat`, and `GET /api/kiosk/token`.
4. **WebSocket Real-time Broadcast**: Updating `server/src/lib/broadcaster.ts` and `server/src/index.ts` to support the `'kiosk'` entity and propagate revocation / pairing events instantly.
5. **Robust Error Handling & Status Codes**: Detailed matrix of HTTP status codes (200, 400, 401, 403, 404, 500).

---

## 2. Database Schema Specification (`server/src/db.ts`)

### 2.1 Table Definition: `kiosk_devices`

Migration query to add to `runMigrations()` in `server/src/db.ts`:

```sql
CREATE TABLE IF NOT EXISTS kiosk_devices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_name VARCHAR(255) NOT NULL DEFAULT 'Smart Display',
    device_type VARCHAR(100),
    user_agent TEXT,
    ip_address VARCHAR(45),
    device_token TEXT,
    last_active_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    revoked_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_kiosk_devices_user_id ON kiosk_devices(user_id);
CREATE INDEX IF NOT EXISTS idx_kiosk_devices_active ON kiosk_devices(user_id) WHERE revoked_at IS NULL;
```

### 2.2 Field Descriptions
| Field | Type | Description |
|---|---|---|
| `id` | `UUID PRIMARY KEY` | Unique device identifier, embedded into JWT as `deviceId`. |
| `user_id` | `UUID REFERENCES users(id)` | Family owner user ID to whom this display belongs. |
| `device_name` | `VARCHAR(255)` | User-customizable or default name (e.g. 'Display Sala', 'Cozinha Tablet'). |
| `device_type` | `VARCHAR(100)` | Detected device category (e.g. 'Samsung Smart TV', 'LG webOS', 'iPad / Tablet', 'Chrome on Linux'). |
| `user_agent` | `TEXT` | Raw User-Agent string from the display client. |
| `ip_address` | `VARCHAR(45)` | IPv4 / IPv6 address of the kiosk display. |
| `device_token` | `TEXT` | Optional hash or token reference. |
| `last_active_at` | `TIMESTAMPTZ` | Timestamp updated on each heartbeat or active kiosk request. |
| `revoked_at` | `TIMESTAMPTZ` | NULL when active; set to NOW() upon remote unlinking. |
| `created_at` | `TIMESTAMPTZ` | Creation / pairing timestamp. |

---

## 3. Authentication & Revocation Lifecycle (`server/src/middleware/auth.ts`)

### 3.1 Kiosk JWT Payload
The Kiosk JWT generated during authorization must include:
```ts
export interface KioskJwtPayload {
    userId: string;       // Family owner ID
    ownerId: string;      // Family owner ID
    isKiosk: true;        // Kiosk flag
    deviceId: string;     // UUID from kiosk_devices.id
}
```

### 3.2 Token Generation Helper Update
```ts
export const generateKioskToken = (userId: string, ownerId?: string, deviceId?: string): string => {
    return jwt.sign(
        { userId, ownerId: ownerId ?? userId, isKiosk: true, deviceId },
        getJwtSecret(),
        { expiresIn: '3650d' }
    );
};
```

### 3.3 Auth Middleware Revocation Check
In `authMiddleware` (`server/src/middleware/auth.ts`):
```ts
export interface AuthRequest extends Request {
    userId?: string;
    actualUserId?: string;
    isOwner?: boolean;
    isKiosk?: boolean;
    deviceId?: string;
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

        req.actualUserId = decoded.userId;
        req.userId = decoded.ownerId ?? decoded.userId;
        req.isOwner = !decoded.ownerId || decoded.ownerId === decoded.userId;
        req.isKiosk = Boolean(decoded.isKiosk);
        req.deviceId = decoded.deviceId;

        // If this is a Kiosk token with an associated deviceId, verify device is not revoked
        if (decoded.isKiosk && decoded.deviceId) {
            const devCheck = await query(
                'SELECT revoked_at FROM kiosk_devices WHERE id = $1 AND user_id = $2',
                [decoded.deviceId, req.userId]
            );

            if (devCheck.rows.length === 0 || devCheck.rows[0].revoked_at !== null) {
                return res.status(401).json({
                    success: false,
                    error: 'Kiosk device has been unlinked or revoked',
                    code: 'DEVICE_REVOKED',
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

## 4. Kiosk API Routes Implementation (`server/src/routes/kioskToken.ts`)

### 4.1 In-Memory Pairing Session Structure
```ts
interface PairSession {
    code: string;
    token: string | null;
    deviceId: string | null;
    authorized: boolean;
    expiresAt: number;
    userAgent: string;
    ipAddress: string;
    deviceType: string;
}
```

### 4.2 Helper: User-Agent & Device Type Detection
```ts
export const parseDeviceType = (ua: string): string => {
    if (!ua) return 'Smart Display';
    if (/Tizen/i.test(ua)) return 'Samsung Smart TV (Tizen)';
    if (/Web0S|webOS/i.test(ua)) return 'LG Smart TV (webOS)';
    if (/BRAVIA|Android.*TV|AFT|Shield/i.test(ua)) return 'Android TV / Smart Display';
    if (/iPad/i.test(ua)) return 'iPad / Tablet';
    if (/Tablet|Android(?!.*Mobile)/i.test(ua)) return 'Android Tablet';
    if (/CrOS/i.test(ua)) return 'ChromeOS Display';
    if (/Linux/i.test(ua)) return 'Linux / Wall Display';
    if (/Windows/i.test(ua)) return 'Windows PC / Display';
    if (/Macintosh/i.test(ua)) return 'Mac Display';
    return 'Smart Display';
};
```

### 4.3 Endpoint Specifications

#### 1. `POST /api/kiosk/pair/init`
- **Auth**: Public (called by display)
- **Action**: Generates unique 6-digit pairing code, extracts display User-Agent and IP, records in `pairSessions`.
- **Response** (200 OK):
  ```json
  { "success": true, "code": "648192" }
  ```

#### 2. `GET /api/kiosk/pair/status`
- **Auth**: Public (polled every 2s by display)
- **Parameters**: `?code=648192`
- **Response**:
  - If authorized: `{ "success": true, "authorized": true, "token": "<jwt>", "deviceId": "<uuid>" }` (consumes pairing code)
  - If pending: `{ "success": true, "authorized": false }`
  - If expired / not found: `{ "success": true, "authorized": false, "expired": true }`

#### 3. `POST /api/kiosk/pair/authorize`
- **Auth**: `authMiddleware` (User JWT from mobile/dashboard)
- **Body**:
  ```json
  {
    "code": "648192",
    "deviceName": "Smart Display Sala"
  }
  ```
- **Execution Flow**:
  1. Validate `req.userId`.
  2. Clean and look up `code` in `pairSessions`.
  3. Validate expiration (`Date.now() <= session.expiresAt`).
  4. Determine `deviceName` (default: `'Smart Display'`), `userAgent` (from `session.userAgent`), `ipAddress` (from `session.ipAddress`), and `deviceType` (`parseDeviceType(session.userAgent)`).
  5. Insert record into `kiosk_devices`:
     ```sql
     INSERT INTO kiosk_devices (user_id, device_name, device_type, user_agent, ip_address, last_active_at, created_at)
     VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
     RETURNING id, user_id, device_name, device_type, user_agent, ip_address, last_active_at, created_at;
     ```
  6. Generate Kiosk JWT embedding `deviceId`:
     `const token = generateKioskToken(req.userId, req.userId, device.id);`
  7. Store `token` and `deviceId` in `session`, set `session.authorized = true`.
  8. Broadcast WebSocket event: `broadcast(req.userId, { type: 'update', entity: 'kiosk', action: 'created' });`
- **Response** (200 OK):
  ```json
  {
    "success": true,
    "message": "Dispositivo conectado com sucesso!",
    "deviceId": "uuid",
    "token": "<jwt>"
  }
  ```

#### 4. `GET /api/kiosk/devices`
- **Auth**: `authMiddleware` (User JWT)
- **Execution Flow**:
  ```sql
  SELECT 
      id,
      user_id AS "userId",
      device_name AS "deviceName",
      device_type AS "deviceType",
      user_agent AS "userAgent",
      ip_address AS "ipAddress",
      last_active_at AS "lastActiveAt",
      created_at AS "createdAt"
  FROM kiosk_devices
  WHERE user_id = $1 AND revoked_at IS NULL
  ORDER BY last_active_at DESC, created_at DESC;
  ```
- **Response** (200 OK):
  ```json
  {
    "success": true,
    "data": [
      {
        "id": "e2c0e81c-9bf5-4ceb-8521-364239ec2f8b",
        "userId": "7b0b92db-5c6a-4d76-bf25-502a3a0e101f",
        "deviceName": "Smart Display Sala",
        "deviceType": "Samsung Smart TV (Tizen)",
        "userAgent": "Mozilla/5.0 (SMART-TV; Linux; Tizen 6.0) ...",
        "ipAddress": "192.168.1.50",
        "lastActiveAt": "2026-08-30T07:15:00.000Z",
        "createdAt": "2026-08-30T07:00:00.000Z"
      }
    ]
  }
  ```

#### 5. `DELETE /api/kiosk/devices/:id`
- **Auth**: `authMiddleware` (User JWT; optionally `requireParent`)
- **Params**: `id` (device UUID)
- **Execution Flow**:
  1. Validate UUID format: `/^[0-9a-fA-F-]{36}$/.test(id)`. If invalid, return 400 Bad Request.
  2. Update database:
     ```sql
     UPDATE kiosk_devices
     SET revoked_at = NOW()
     WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL
     RETURNING id, device_name;
     ```
  3. If no row returned:
     - Check if device exists: `SELECT id, revoked_at FROM kiosk_devices WHERE id = $1 AND user_id = $2;`
     - If not found -> 404 Not Found `{ "success": false, "error": "Dispositivo não encontrado." }`
     - If already revoked -> 400 Bad Request `{ "success": false, "error": "Dispositivo já desvinculado." }`
  4. Broadcast WebSocket revocation event:
     ```ts
     broadcast(req.userId!, {
         type: 'update',
         entity: 'kiosk',
         action: 'deleted',
         id: req.params.id,
         data: { revoked: true, deviceId: req.params.id }
     });
     ```
- **Response** (200 OK):
  ```json
  {
    "success": true,
    "message": "Dispositivo desvinculado com sucesso"
  }
  ```

#### 6. `POST /api/kiosk/heartbeat`
- **Auth**: `authMiddleware` (Kiosk JWT)
- **Execution Flow**:
  1. If `req.deviceId`:
     ```sql
     UPDATE kiosk_devices
     SET last_active_at = NOW()
     WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL
     RETURNING id, last_active_at;
     ```
     If row updated:
     Return 200 OK `{ "success": true, "active": true, "lastActiveAt": result.rows[0].last_active_at }`.
     If no row updated (was revoked):
     Return 401 Unauthorized `{ "success": false, "error": "Device revoked", "code": "DEVICE_REVOKED" }`.
  2. If legacy token without `deviceId`:
     Return 200 OK `{ "success": true, "active": true }`.

#### 7. `GET /api/kiosk/token` (Direct Long-Lived Token)
- **Auth**: `authMiddleware`
- **Action**: When generating a manual long-lived token, create a corresponding `kiosk_devices` entry (e.g. `device_name = 'Manual Display Token'`, `device_type = 'Web Browser'`) and embed the generated `deviceId` into the JWT.
- **Response** (200 OK): `{ "success": true, "token": "<jwt>", "deviceId": "<uuid>" }`.

---

## 5. WebSocket Broadcaster & Server Updates

### 5.1 `server/src/lib/broadcaster.ts`
1. Add `'kiosk'` to `WsEntity`:
   ```ts
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
2. Extend `WsUpdatePayload` to support optional `id` and `data`:
   ```ts
   export interface WsUpdatePayload {
       type: 'update';
       entity: WsEntity;
       action: WsAction;
       id?: string;
       data?: Record<string, unknown>;
   }
   ```

### 5.2 `server/src/index.ts` (WebSocket Connection Authentication)
When Kiosk displays or family members authenticate with WebSocket (`{ type: 'auth', token }`), ensure the connection is mapped to the effective family owner ID:
```ts
const decoded = jwt.verify(data.token, getJwtSecret()) as { userId: string; ownerId?: string };
userId = decoded.ownerId ?? decoded.userId;
```
This guarantees that `broadcast(req.userId, ...)` reaches all active WebSocket connections across all family members and kiosk screens simultaneously.

---

## 6. Error Handling & HTTP Status Code Matrix

| Endpoint | HTTP Status | Scenario | Response Payload |
|---|---|---|---|
| `GET /api/kiosk/devices` | **200 OK** | Success | `{ "success": true, "data": [...] }` |
| `GET /api/kiosk/devices` | **401 Unauthorized** | Missing or invalid auth token | `{ "success": false, "error": "No token provided" }` |
| `GET /api/kiosk/devices` | **500 Internal Error** | Database error | `{ "success": false, "error": "..." }` |
| `DELETE /api/kiosk/devices/:id` | **200 OK** | Device revoked & event broadcasted | `{ "success": true, "message": "Dispositivo desvinculado com sucesso" }` |
| `DELETE /api/kiosk/devices/:id` | **400 Bad Request** | Invalid UUID format or already revoked | `{ "success": false, "error": "ID de dispositivo inválido." }` |
| `DELETE /api/kiosk/devices/:id` | **401 Unauthorized** | Missing/invalid user auth | `{ "success": false, "error": "Unauthorized" }` |
| `DELETE /api/kiosk/devices/:id` | **403 Forbidden** | Non-parent account (if restricted) | `{ "success": false, "error": "Action réservée aux parents." }` |
| `DELETE /api/kiosk/devices/:id` | **404 Not Found** | Device does not exist for family | `{ "success": false, "error": "Dispositivo não encontrado." }` |
| `POST /api/kiosk/pair/authorize` | **200 OK** | Linked device & generated token | `{ "success": true, "message": "...", "deviceId": "...", "token": "..." }` |
| `POST /api/kiosk/pair/authorize` | **400 Bad Request** | Code missing, invalid, or expired | `{ "success": false, "error": "Código de pareamento inválido ou expirado." }` |
| `POST /api/kiosk/pair/authorize` | **401 Unauthorized** | User unauthenticated | `{ "success": false, "error": "Unauthorized" }` |
| `POST /api/kiosk/heartbeat` | **200 OK** | Device active & timestamp updated | `{ "success": true, "active": true, "lastActiveAt": "..." }` |
| `POST /api/kiosk/heartbeat` | **401 Unauthorized** | Device revoked, token invalid | `{ "success": false, "error": "Kiosk device has been unlinked or revoked", "code": "DEVICE_REVOKED" }` |
| Any Kiosk API Request | **401 Unauthorized** | Kiosk device revoked in DB | `{ "success": false, "error": "Kiosk device has been unlinked or revoked", "code": "DEVICE_REVOKED" }` |

---

## 7. Shared Types Contract (`shared/src/types.ts`)

Add to `shared/src/types.ts`:
```ts
export interface KioskDevice {
    id: string;
    userId: string;
    deviceName: string;
    deviceType?: string;
    userAgent?: string;
    ipAddress?: string;
    lastActiveAt: string | Date;
    revokedAt?: string | Date | null;
    createdAt: string | Date;
}
```
