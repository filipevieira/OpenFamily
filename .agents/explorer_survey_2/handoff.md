# Handoff Report — Explorer 2 (Kiosk Auth & Device Management)

## 1. Observation

Direct observations from examining the codebase:

1. **In-Memory Pair Sessions in `server/src/routes/kioskToken.ts`**:
   - Lines 13–14:
     ```typescript
     // In-memory store for 6-digit TV pairing codes (valid for 10 minutes)
     const pairSessions = new Map<string, PairSession>();
     ```
   - Lines 46–61: `POST /api/kiosk/pair/init` generates a random 6-digit number and stores it only in `pairSessions` (RAM).
   - Lines 88–118: `POST /api/kiosk/pair/authorize` generates a token via `generateKioskToken(req.userId, req.userId)` and assigns `session.token = token; session.authorized = true;`.

2. **Stateless 10-Year Token Generation in `server/src/middleware/auth.ts`**:
   - Lines 42–44:
     ```typescript
     export const generateKioskToken = (userId: string, ownerId?: string): string => {
         return jwt.sign({ userId, ownerId: ownerId ?? userId, isKiosk: true }, getJwtSecret(), { expiresIn: '3650d' });
     };
     ```
   - Lines 15–36: `authMiddleware` verifies the JWT signature and extracts `decoded.userId` and `decoded.ownerId`, but performs no database check against a device registry or revocation list.

3. **Absence of Kiosk Device Table in Database (`server/src/db.ts`)**:
   - `server/src/db.ts` contains migrations 001 through 022, but no table exists for `kiosk_devices`.

4. **Hardcoded Screen Size & Layout in `client/src/pages/Kiosk.tsx`**:
   - Line 447: `<div className="text-caption font-medium text-muted-foreground bg-surface/40 px-4 py-1.5 rounded-full border border-white/10">Modo Smart Display 42"</div>`
   - Lines 451–507: 2-column grid (`grid-cols-1 lg:grid-cols-2 gap-12`) without vertical height constraints, causing overflow on compact displays like 1024x600 or 800x1280.
   - Lines 893–905 & 1152–1160: Display settings modal has `max-h-[85vh]` with sticky header and footer, but needs explicit overflow containment to prevent clipping on small screen heights.

5. **Current `/settings` UI in `client/src/pages/Settings.tsx`**:
   - Lines 859–878: Kiosk section is currently a static card with only a button linking to `/kiosk`. There is no device listing, device status, or unlinking control.

6. **WebSocket Broadcaster in `server/src/lib/broadcaster.ts` and `client/src/contexts/WebSocketContext.tsx`**:
   - `WsEntity` union type currently lists:
     `'tasks' | 'shopping' | 'appointments' | 'family' | 'budget' | 'recipes' | 'meal-plans' | 'planning' | 'notifications' | 'integrations' | 'rewards' | 'notes'`.
   - `'kiosk'` is not yet in `WsEntity`.

---

## 2. Logic Chain

1. **Lack of Device Persistence → Impossibility of Remote Revocation**:
   - Because `pairSessions` is stored only in RAM and `generateKioskToken` produces generic stateless JWTs with no device ID, individual kiosk screens cannot be distinguished or audited.
   - Therefore, revoking an individual screen's access requires a persistent database table (`kiosk_devices`) and embedding a unique `deviceId` in the JWT claim.

2. **Revocation Verification Strategy**:
   - To invalidate access upon unlinking, `authMiddleware` must query `kiosk_devices` when `decoded.isKiosk` is true to check `revoked_at IS NULL`.
   - To make revocation instantaneous on the active display (rather than waiting for a poll or page refresh), the server must broadcast a WebSocket update (`entity: 'kiosk'`, `action: 'deleted'`) to the family's active connections.
   - In addition, the client's `api.ts` 401 handler (`AUTH_EXPIRED_EVENT`) and a periodic heartbeat ping serve as fail-safes if the WebSocket connection is interrupted.

3. **Dashboard Settings Integration**:
   - Integrating a "Kiosk Devices" section in `/settings` (lines 859–878 of `Settings.tsx`) allows the family owner to view all active displays, see their last active status, and click "Desvincular Dispositivo" (calling `DELETE /api/kiosk/devices/:id`).

4. **Universal Kiosk Responsiveness**:
   - Removing hardcoded `"42\""` references in `Kiosk.tsx` and adding responsive layout classes allows `/kiosk` to scale smoothly across 7" smart fridge screens (800x1280, 1024x600) up to 75" 4K TVs.
   - Ensuring `overflow-hidden` on the modal wrapper and `overflow-y-auto` on the modal body guarantees that the `[X]` header and `[Fechar]` footer remain permanently sticky and visible on all viewport heights.

---

## 3. Caveats

1. **Legacy Tokens**: Any existing Kiosk tokens generated before this update without a `deviceId` claim will not have an associated row in `kiosk_devices`. The implementation can gracefully treat them as valid or prompt re-pairing.
2. **WebSocket Keep-Alive on Sleepy Displays**: Some Smart TV web browsers sleep or throttle background WebSockets when dimmed; the fallback API 401 check and heartbeat ensure immediate unlinking detection when the screen wakes or performs any action.
3. **QR Code Generator**: QR code generation currently uses `https://api.qrserver.com/v1/create-qr-code/`. If full offline self-hosted operation is desired, a client-side SVG generator (e.g. `qrcode.react`) could be used, or the existing QR service can be retained.

---

## 4. Conclusion

The architecture for Universal Kiosk Mode and Device Management is clear, robust, and cleanly modularized:
1. **Backend**:
   - Migration in `server/src/db.ts` for `kiosk_devices` table.
   - Update `server/src/middleware/auth.ts` to include `deviceId` in Kiosk JWTs and check `kiosk_devices.revoked_at IS NULL`.
   - Update `server/src/routes/kioskToken.ts` with `GET /devices`, `DELETE /devices/:id`, `POST /heartbeat`, and metadata handling in `/pair/init`, `/pair/status`, `/pair/authorize`.
   - Add `'kiosk'` entity to `server/src/lib/broadcaster.ts`.
2. **Frontend**:
   - Add `'kiosk'` entity to `client/src/contexts/WebSocketContext.tsx`.
   - Add Kiosk Devices management card to `client/src/pages/Settings.tsx` with device listing and "Desvincular" button.
   - Update `client/src/pages/Kiosk.tsx` for responsive pairing layout, removal of hardcoded labels, sticky modal headers/footers, and instant revocation detection.
   - Add i18n keys across `en`, `pt`, `fr`, `zh`.

---

## 5. Verification Method

To verify the implementation once built:
1. **Pairing & Database Persistence**:
   - Open `/kiosk` in a browser window. Observe 6-digit code and QR code.
   - On another device, open `/pair?code=...` while logged in and click "Autorizar esta TV".
   - Verify that a new row is created in `kiosk_devices` with device metadata (IP, User-Agent, last active timestamp) and that the kiosk screen automatically transitions to the full dashboard.
2. **Settings Device Management**:
   - Navigate to `/settings` on the main dashboard.
   - Verify that the linked Kiosk device appears in the "Dispositivos Kiosk Vinculados" list with status, IP, and details.
3. **Remote Unlinking & Instant Redirection**:
   - On `/settings`, click "Desvincular Dispositivo" on the active display.
   - Observe that the active `/kiosk` window immediately clears its stored token and redirects back to the QR code pairing screen without manual refresh.
4. **Responsive Viewport Test**:
   - Test `/kiosk` at 800x1280, 1024x600, 1920x1080, and 3840x2160 to verify no layout overflow or clipped buttons.
5. **Build Verification**:
   - Execute `npm run build` to confirm zero TypeScript compilation errors.
