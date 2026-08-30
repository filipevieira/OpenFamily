# Kiosk Auth & Device Management — Survey & Technical Analysis

## 1. Executive Summary

This report provides a comprehensive technical investigation of OpenFamily's Kiosk Mode (`/kiosk`), TV pairing flow (`/pair`, `/api/kiosk/pair/*`), session authentication, device metadata management, and remote revocation mechanics.

Currently, the Kiosk implementation uses an in-memory ephemeral map for pairing codes and issues stateless 10-year JWT tokens. While this provides a low-friction initial pairing experience, it lacks persistent device identification, metadata tracking, and any mechanism for remote unlinking or token revocation.

To meet the requirements for **Universal Kiosk Mode** and **Device Management & Remote Unlinking**, this analysis outlines the complete architectural design:
- A database-backed `kiosk_devices` model for tracking linked screens (name, type, IP, user-agent, last active timestamp, revocation status).
- Enhanced JWT issuance incorporating `deviceId`.
- A 3-layer instantaneous revocation detection pipeline (WebSocket broadcast + API 401 interception + heartbeat).
- A rich device management UI in the main Dashboard Settings (`/settings`).
- Fluid, ultra-responsive UI adjustments on `/kiosk` (removing hardcoded 42" labels and fixing modal sticky headers/footers for 7" fridge displays to 75" TVs).

---

## 2. Current State Analysis

### 2.1 Current Backend Implementation (`server/src/routes/kioskToken.ts`, `server/src/middleware/auth.ts`)

| Component | Current Implementation | Limitation / Gap |
|---|---|---|
| **Pairing State** | `const pairSessions = new Map<string, PairSession>()` (in-memory map) | Volatile: server restart clears pending pairing sessions. |
| **Token Type** | Stateless JWT signed with `{ userId, ownerId, isKiosk: true }` and `expiresIn: '3650d'` | All kiosk tokens are identical per user. No device ID or session identifier is attached. |
| **Device Storage** | None | The database has no record of which displays or devices have been paired. |
| **Revocation** | Impossible without rotating `JWT_SECRET` (which invalidates all user accounts) | No mechanism exists to unlink or revoke individual kiosk screens. |
| **Auth Middleware** | `authMiddleware` checks `jwt.verify(token, getJwtSecret())` | Does not check DB to verify if a kiosk token/device is revoked. |

### 2.2 Current Frontend Implementation (`client/src/pages/Kiosk.tsx`, `client/src/pages/PairTV.tsx`)

| Component | Current Implementation | Limitation / Gap |
|---|---|---|
| **Token Detection** | `urlParams.get('token') \|\| api.getToken() \|\| localStorage.getItem('openfamily.kioskToken')` | Doesn't monitor token validity after initial mount or handle revocation resets cleanly. |
| **Pairing Initiation** | Calls `POST /api/kiosk/pair/init`, receives 6-digit code, polls `GET /api/kiosk/pair/status?code=...` every 2s | No client metadata (browser, screen hints) is passed during init. |
| **Pairing UI** | Hardcoded label `"Modo Smart Display 42\""`, fixed 2-column layout | Text assumes 42" display; layout risks vertical clipping on compact viewports (e.g. 1024x600 or 800x1280 fridge screens). |
| **Settings Modal** | Modal with `max-h-[85vh]` and `sticky top-0` / `sticky bottom-0` | Requires robust overflow containment to prevent close `[X]` header or footer clipping on low vertical heights. |
| **Settings Page (`/settings`)** | Basic card with link button to `/kiosk` | No list of linked devices, no metadata view, no "Desvincular" action. |

---

## 3. Architecture & Technical Design for Device Management

### 3.1 Database Schema (`kiosk_devices` Table)

A new migration in `server/src/db.ts` (`runMigrations()`) will create the `kiosk_devices` table:

```sql
CREATE TABLE IF NOT EXISTS kiosk_devices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_name VARCHAR(100) NOT NULL DEFAULT 'Display Kiosk',
    device_type VARCHAR(50) DEFAULT 'browser',
    ip_address VARCHAR(45),
    user_agent TEXT,
    last_active_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    revoked_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_kiosk_devices_user_id ON kiosk_devices(user_id);
CREATE INDEX IF NOT EXISTS idx_kiosk_devices_active ON kiosk_devices(user_id) WHERE revoked_at IS NULL;
```

#### Field Specifications:
- `id` (UUID): Unique device/session identifier, embedded in the Kiosk JWT claim as `deviceId`.
- `user_id` (UUID): Family owner account ID.
- `device_name` (VARCHAR): User-friendly display name (e.g. "Smart TV Sala", "Tablet Cozinha", "Geladeira Inteligente"). Auto-inferred or user-provided.
- `device_type` (VARCHAR): Classified device category (`tv`, `tablet`, `fridge`, `browser`).
- `ip_address` (VARCHAR): Last observed client IP address (`req.ip` or forwarded IP).
- `user_agent` (TEXT): Full User-Agent string from the kiosk display browser.
- `last_active_at` (TIMESTAMPTZ): Timestamp of the most recent API call / heartbeat / data load.
- `created_at` (TIMESTAMPTZ): Timestamp when pairing was confirmed.
- `revoked_at` (TIMESTAMPTZ): Timestamp of remote unlinking (NULL for active devices).

---

### 3.2 Token Issuance & Device Binding

When generating a Kiosk token:
1. `generateKioskToken(userId: string, ownerId?: string, deviceId?: string)`
2. JWT Payload:
   ```json
   {
     "userId": "uuid",
     "ownerId": "uuid",
     "isKiosk": true,
     "deviceId": "kiosk-device-uuid"
   }
   ```
3. Expiration remains long-lived (10 years / 3650d), but authorization is dynamically verified against the database.

---

### 3.3 End-to-End Pairing Flow Lifecycle

```
[Kiosk Display (/kiosk)]               [Backend (/api/kiosk/*)]             [Mobile User (/pair)]
          |                                       |                                    |
          | 1. POST /pair/init                    |                                    |
          |    (headers: User-Agent, IP)          |                                    |
          |-------------------------------------->|                                    |
          |    Returns { code: "849201" }         |                                    |
          |<--------------------------------------|                                    |
          |                                       |                                    |
          | 2. Displays QR code & 6-digit code    |                                    |
          |    URL: /pair?code=849201             |                                    |
          |                                       |                                    |
          | 3. Polls GET /pair/status?code=849201 |                                    |
          |    every 2 seconds                    |                                    |
          |-------------------------------------->|                                    |
          |                                       |  4. Scans QR / opens /pair         |
          |                                       |     Clicks "Autorizar esta TV"     |
          |                                       |     POST /pair/authorize           |
          |                                       |     { code: "849201", name: "TV" } |
          |                                       |<-----------------------------------|
          |                                       |                                    |
          |                                       |  5. Creates kiosk_devices record   |
          |                                       |     Generates JWT with deviceId    |
          |                                       |     session.token = token          |
          |                                       |     session.authorized = true      |
          |                                       |----------------------------------->|
          |                                       |     Returns { success: true }      |
          | 6. Next Poll:                         |                                    |
          |    GET /pair/status?code=849201       |                                    |
          |-------------------------------------->|                                    |
          |    Returns { authorized: true, token }|                                    |
          |<--------------------------------------|                                    |
          |                                       |                                    |
          | 7. Stores token in localStorage       |                                    |
          |    Connects WebSocket & loads data    |                                    |
          v                                       v                                    v
```

---

## 4. Remote Unlinking & Instant Revocation Pipeline

### 4.1 Backend Endpoints (`server/src/routes/kioskToken.ts`)

| Method | Path | Auth Guard | Description |
|---|---|---|---|
| `GET` | `/api/kiosk/devices` | `authMiddleware`, `requireParent` | Returns all active linked kiosk devices for the family (`WHERE revoked_at IS NULL`). |
| `DELETE` | `/api/kiosk/devices/:id` | `authMiddleware`, `requireParent` | Sets `revoked_at = NOW()` for device `:id`. Broadcasts WebSocket event `'kiosk'` with `action: 'deleted'`. |
| `POST` | `/api/kiosk/heartbeat` | `authMiddleware` | Updates `last_active_at` and `ip_address` for the calling device. Returns 401 if revoked. |
| `POST` | `/api/kiosk/pair/init` | Public | Initiates a temporary 6-digit pairing session (records IP & UA). |
| `GET` | `/api/kiosk/pair/status` | Public | Polls status for pairing session. |
| `POST` | `/api/kiosk/pair/authorize`| `authMiddleware` | Links device, creates `kiosk_devices` row, returns token with `deviceId`. |
| `GET` | `/api/kiosk/token` | `authMiddleware` | (Legacy/direct) Creates a registered device and returns a permanent token with `deviceId`. |

### 4.2 Auth Middleware Revocation Check (`server/src/middleware/auth.ts`)

In `authMiddleware`:
```typescript
if (decoded.isKiosk && decoded.deviceId) {
    const devCheck = await query(
        'SELECT id FROM kiosk_devices WHERE id = $1 AND revoked_at IS NULL',
        [decoded.deviceId]
    );
    if (devCheck.rows.length === 0) {
        return res.status(401).json({
            success: false,
            error: 'DEVICE_REVOKED',
            message: 'Este dispositivo Kiosk foi desvinculado.',
        });
    }
}
```

### 4.3 3-Layer Revocation Detection on Active Kiosk

```
+-----------------------------------------------------------------------------------+
|                            Remote Unlinking Trigger                               |
|        (Owner clicks "Desvincular Dispositivo" in /settings on Mobile/PC)         |
+-----------------------------------------------------------------------------------+
                                          |
                                          v
                    +-------------------------------------------+
                    |  Server updates kiosk_devices.revoked_at  |
                    |  Server calls broadcast(userId, ...)      |
                    +-------------------------------------------+
                                          |
         +--------------------------------+--------------------------------+
         |                                |                                |
         v                                v                                v
+--------------------+          +--------------------+          +--------------------+
| Layer 1: WebSocket |          | Layer 2: API 401   |          | Layer 3: Heartbeat |
| Instant Push       |          | Intercept          |          | Periodic Check     |
| (0 - 50ms)         |          | (On next action)   |          | (Every 30-60s)     |
+--------------------+          +--------------------+          +--------------------+
         |                                |                                |
         +--------------------------------+--------------------------------+
                                          |
                                          v
+-----------------------------------------------------------------------------------+
|                           Kiosk Client Immediate Action                           |
| 1. Clear localStorage ('openfamily.kioskToken', 'token')                          |
| 2. Call api.setToken(null)                                                        |
| 3. Set hasToken = false                                                           |
| 4. Instant switch to /kiosk QR Code & 6-digit pairing screen                      |
+-----------------------------------------------------------------------------------+
```

---

## 5. Main Dashboard Settings (`/settings`) Integration

### 5.1 UI Structure in `Settings.tsx`

The current basic Kiosk card (lines 860-878) will be replaced with a feature-rich `KioskDevicesSection`:

```tsx
<Card>
    <CardContent className="p-6">
        <div className="flex items-start gap-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-card bg-primary-soft text-primary">
                <Tv className="h-5 w-5" />
            </div>
            <div className="flex-1 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                        <h3 className="text-caption font-semibold text-foreground">Dispositivos Kiosk Vinculados</h3>
                        <p className="mt-0.5 text-micro text-muted-foreground">Gerencie telas de TV, tablets e geladeiras conectados à sua família.</p>
                    </div>
                    <div className="flex gap-2">
                        <Link to="/kiosk">
                            <Button variant="secondary" size="sm">
                                <MonitorPlay className="mr-2 h-4 w-4" /> Abrir Kiosk
                            </Button>
                        </Link>
                    </div>
                </div>

                {/* Device List Table / Cards */}
                {loadingDevices ? (
                    <Loader2 className="animate-spin" />
                ) : devices.length === 0 ? (
                    <EmptyState />
                ) : (
                    <div className="divide-y divide-border rounded-lg border">
                        {devices.map(device => (
                            <DeviceRow
                                key={device.id}
                                device={device}
                                onUnlink={() => handleUnlinkDevice(device.id)}
                            />
                        ))}
                    </div>
                )}
            </div>
        </div>
    </CardContent>
</Card>
```

### 5.2 Device Item Representation
- **Device Icon**: Determined by `device_type` or parsed User-Agent (Smart TV, Tablet, Fridge, Monitor).
- **Device Name**: "Smart TV Sala", "Tablet Cozinha" (with optional inline rename).
- **Status Indicator**:
  - 🟢 **Online agora** (`last_active_at` < 2 minutes ago)
  - 🟡 **Visto há X min** (`last_active_at` < 60 minutes ago)
  - ⚪ **Offline** (`last_active_at` >= 1 hour ago)
- **Metadata**: IP address (`192.168.1.50`), Browser / Platform summary (e.g. `Chrome 120 • Tizen OS`), Paired date (`Vinculado em 30/08/2026`).
- **Action Button**: "Desvincular Dispositivo" (red outline / ghost button with `Trash2` or `Unlink` icon) with confirmation alert dialog.

---

## 6. Universal & Responsive Kiosk UI (`/kiosk`)

### 6.1 Viewport Responsiveness Matrix

| Viewport Profile | Resolution Example | UI Requirements |
|---|---|---|
| **7" Smart Fridge (Portrait)** | `800 x 1280` | Single-column stacked pairing UI, compact QR code (180-220px), no overflow. |
| **Smart Fridge / Small Tablet (Landscape)** | `1024 x 600` | Compact grid, tight vertical padding, QR code auto-scaled to avoid vertical scrolling. Modal with sticky header/footer and `max-h-[90vh]` scrollable body. |
| **10" - 13" Wall Tablets** | `1920 x 1200`, `1280 x 800` | Balanced 2-column layout with fluid typography (`clamp(...)`). |
| **32" - 75" 4K Smart TVs** | `1920 x 1080`, `3840 x 2160` | High-contrast TV layout, large 6-digit code, remote control-friendly buttons, night dimmer. |

### 6.2 Hardcoded Label Cleanup
- **Remove**: `"Modo Smart Display 42\""` on line 447 of `Kiosk.tsx`.
- **Replace with**: Localized responsive badge `t('kiosk:pairing.badge', 'Painel Kiosk')`.
- **Remove**: `"OpenFamily Smart Display • ..."` on line 511 of `Kiosk.tsx`.
- **Replace with**: Clean universal footer `OpenFamily Kiosk • {window.location.hostname}`.

### 6.3 Modal Sticky Header & Footer Architecture
- Ensure container has `flex flex-col max-h-[85vh] overflow-hidden rounded-card`.
- Header: `sticky top-0 z-20 shrink-0 bg-card border-b` with high-contrast `[X]` close button.
- Body: `flex-1 overflow-y-auto p-5 space-y-5`.
- Footer: `sticky bottom-0 z-20 shrink-0 bg-card border-t p-3` with full-width or prominent `[Fechar]` button.

---

## 7. Inventory of Affected Files & Changes

### Backend Files:
1. `server/src/db.ts`:
   - Add Migration for `kiosk_devices` table and indexes.
2. `server/src/middleware/auth.ts`:
   - Extend `generateKioskToken` to take optional `deviceId`.
   - Update `authMiddleware` to check `kiosk_devices.revoked_at IS NULL` when `decoded.isKiosk && decoded.deviceId`.
3. `server/src/routes/kioskToken.ts`:
   - Implement `GET /devices` (list active devices).
   - Implement `DELETE /devices/:id` (revoke device & broadcast WS event).
   - Implement `POST /heartbeat` (update device activity & verify validity).
   - Update `POST /pair/init`, `GET /pair/status`, `POST /pair/authorize` to manage device metadata & DB insertion.
   - Update `GET /token` to create and return device-bound token.
4. `server/src/lib/broadcaster.ts`:
   - Add `'kiosk'` to `WsEntity` union type.

### Frontend Files:
1. `client/src/contexts/WebSocketContext.tsx`:
   - Add `'kiosk'` to `WsEntity` union type.
2. `client/src/pages/Kiosk.tsx`:
   - Responsive pairing UI (7" to 75" viewports, remove 42" hardcoded text).
   - Revocation listener via WebSocket `'kiosk'` updates + `openfamily:auth-expired` event.
   - Periodic heartbeat ping.
   - Modal sticky header/footer styling fixes.
3. `client/src/pages/Settings.tsx`:
   - Add Kiosk Devices Management Card with device list and "Desvincular Dispositivo" action.
4. `client/src/pages/PairTV.tsx`:
   - Enhanced pairing form with optional device naming and responsive feedback.
5. `client/src/i18n/locales/{en,pt,fr,zh}/kiosk.json`:
   - Add keys for pairing badge, device types, device management, unlinking.
6. `client/src/i18n/locales/{en,pt,fr,zh}/settings.json`:
   - Add keys for Kiosk Devices section, unlinking confirmation, status indicators.
