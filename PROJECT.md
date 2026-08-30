# Project: OpenFamily Universal Kiosk Mode & Remote Device Management

## Architecture
- **Monorepo Structure**:
  - `client`: React 19 + Vite + TailwindCSS + Radix UI + Capacitor mobile shell + i18n (`en`, `pt`, `fr`, `zh`).
  - `server`: Node.js + Express 4.22 + PostgreSQL (`pg` pool) + WebSocket (`ws` broadcaster).
  - `shared`: Shared TypeScript types (`@openfamily/shared`).
- **Data Flow & Auth Lifecycle**:
  - Kiosk displays open `/kiosk`. If unauthenticated, initiates pairing code via `POST /api/kiosk/pair/init`.
  - User on mobile/dashboard accesses `/pair?code=XXXXXX` or scans QR code, calls `POST /api/kiosk/pair/authorize`.
  - Server persists device in `kiosk_devices` table and issues JWT with `deviceId` and `isKiosk: true`.
  - Kiosk receives token, stores in `localStorage['openfamily.kioskToken']`, and enters full dashboard view.
  - Server validates `kiosk_devices.revoked_at IS NULL` on kiosk API requests.
  - User revokes device from `/settings` via `DELETE /api/kiosk/devices/:id`.
  - Server marks `revoked_at = NOW()` and broadcasts WebSocket revocation event.
  - Kiosk catches 401 / WebSocket event / auth-expired, purges stored token, and immediately returns to QR code pairing screen.

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | `kiosk_devices` Database Table & Schema Migration | Add PostgreSQL migration for `kiosk_devices` (id, user_id, device_name, device_type, user_agent, ip_address, device_token, last_active_at, revoked_at, created_at) | M1 | ORIGINAL_REQUEST §R2 |
| 2 | Kiosk JWT with Device Tracking & Revocation Middleware | Embed `deviceId` in Kiosk JWT; verify `revoked_at IS NULL` in `authMiddleware` returning 401 when revoked | M1 | ORIGINAL_REQUEST §R2 |
| 3 | Kiosk Device Management API Endpoints | Implement `GET /api/kiosk/devices`, `DELETE /api/kiosk/devices/:id`, `POST /api/kiosk/heartbeat`, and device recording in `pair/authorize` | M1 | ORIGINAL_REQUEST §R2 |
| 4 | WebSocket Kiosk Revocation Broadcast | Add `'kiosk'` to `WsEntity` in `server/src/lib/broadcaster.ts` and broadcast unlinking events | M1 | ORIGINAL_REQUEST §R2 |
| 5 | Remove Hardcoded 42" Smart Display Labels & Localize | Remove `Modo Smart Display 42"` and TV-only references in `Kiosk.tsx`; add i18n keys across `en`, `pt`, `fr`, `zh` | M2 | ORIGINAL_REQUEST §R1 |
| 6 | Ultra-Responsive QR & 6-Digit Pairing Layout | Dynamic responsive layout for pairing screen scaling seamlessly from 7" fridges (800x1280, 1024x600) to 75" 4K TVs without clipping | M2 | ORIGINAL_REQUEST §R1 |
| 7 | Lean Header Controls | Keep header controls focused on essential display features: Night Dimmer, Zoom, Dark Mode, Weather | M2 | ORIGINAL_REQUEST §R1 |
| 8 | Sticky Modal Headers & Footers | Standardize Display Settings and Ambient Sounds modals with `max-h-[85vh] flex flex-col overflow-hidden` and sticky `[X]` / `[Fechar]` buttons | M2 | ORIGINAL_REQUEST §R1 |
| 9 | Client-Side Instant Revocation Handling in Kiosk | Listen to `openfamily:auth-expired`, WebSocket events, and 401 errors; clear localStorage token and reset to pairing screen | M2 | ORIGINAL_REQUEST §R2 |
| 10 | Dashboard Kiosk Devices Management UI (`/settings`) | Add Kiosk Devices section in `Settings.tsx` listing active displays (name, last active timestamp, IP/browser details) | M3 | ORIGINAL_REQUEST §R2 |
| 11 | "Desvincular Dispositivo" (Unlink Device) Action | Action button in `/settings` to call `DELETE /api/kiosk/devices/:id`, revoke token, and update UI with toast feedback | M3 | ORIGINAL_REQUEST §R2 |
| 12 | TypeScript & Monorepo Build Integrity | Ensure full monorepo compiles cleanly with `npm run build` with zero TypeScript errors | M1, M2, M3, Final | ORIGINAL_REQUEST §Acceptance Criteria |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Backend Database, Auth & Kiosk Devices API | Database migration `kiosk_devices`, JWT `deviceId` claim, revocation middleware, API endpoints (`GET /devices`, `DELETE /devices/:id`, `heartbeat`), WebSocket broadcast | none | DONE |
| M2 | Universal & Responsive Kiosk UI (`/kiosk`) | Remove hardcoded 42" labels, i18n localization, fluid responsive QR/code scaling for 7" fridges to 75" TVs, lean header controls, sticky modal headers/footers, instant revocation redirect | M1 | DONE |
| M3 | Kiosk Devices Management UI (`/settings`) | Linked displays list in Settings, metadata display, "Desvincular Dispositivo" action button, WebSocket live updates, i18n | M1 | DONE |
| M-Final | E2E Test Suite & Adversarial Hardening | Pass 100% of E2E tests (Tiers 1-4) published by E2E Testing Track, followed by Tier 5 adversarial coverage hardening | M1, M2, M3 | DONE |

## Interface Contracts

### Backend ↔ Frontend Kiosk Device API
- `GET /api/kiosk/devices`
  - Headers: `Authorization: Bearer <user_or_owner_jwt>`
  - Response (200 OK):
    ```json
    [
      {
        "id": "uuid",
        "userId": "uuid",
        "deviceName": "Smart Display Sala",
        "deviceType": "Chrome on Linux / Smart TV",
        "userAgent": "Mozilla/5.0 ...",
        "ipAddress": "192.168.1.50",
        "lastActiveAt": "2026-08-30T07:15:00Z",
        "createdAt": "2026-08-30T07:00:00Z"
      }
    ]
    ```

- `DELETE /api/kiosk/devices/:id`
  - Headers: `Authorization: Bearer <user_or_owner_jwt>`
  - Response (200 OK):
    ```json
    { "success": true, "message": "Dispositivo desvinculado com sucesso" }
    ```
  - Side effect: Marks `revoked_at = NOW()`, broadcasts WebSocket `{ type: 'DELETE', entity: 'kiosk', id: '<deviceId>' }`.

- `POST /api/kiosk/pair/authorize`
  - Body: `{ "code": "123456", "deviceName": "Display Cozinha (opcional)" }`
  - Response: `{ "success": true, "token": "<jwt>", "deviceId": "<uuid>" }`

- `POST /api/kiosk/heartbeat`
  - Headers: `Authorization: Bearer <kiosk_jwt>`
  - Response: `{ "success": true, "active": true }` (or 401 if revoked)

### WebSocket Contract
- `WsEntity`: `'tasks' | 'shopping' | 'appointments' | 'family' | 'budget' | 'recipes' | 'meal-plans' | 'planning' | 'notifications' | 'integrations' | 'rewards' | 'notes' | 'kiosk'`
- Event: `{ type: 'DELETE', entity: 'kiosk', id: '<deviceId>', data: { revoked: true } }`

## Code Layout
- `server/src/db.ts`: Database connection, schema migrations (add migration for `kiosk_devices`).
- `server/src/middleware/auth.ts`: JWT verification, Kiosk device active/revocation check.
- `server/src/routes/kioskToken.ts`: Pairing routes, device listing and deletion routes.
- `server/src/lib/broadcaster.ts`: WebSocket broadcaster entity types.
- `client/src/pages/Kiosk.tsx`: Universal Kiosk page, pairing screen, display controls, modals.
- `client/src/pages/Settings.tsx`: Dashboard settings, Kiosk Devices management card.
- `client/src/contexts/WebSocketContext.tsx`: WebSocket client entity subscription.
- `client/src/i18n/locales/{en,pt,fr,zh}/*.json`: Localization files.
- `tests/e2e/`: E2E test suite (Tiers 1-4).
