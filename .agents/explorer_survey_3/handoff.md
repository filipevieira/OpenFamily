# 5-Component Handoff Report: System Architecture & API Survey (Explorer 3)

## 1. Observation

- **Monorepo Architecture**:
  - `package.json` (lines 6-10) defines npm workspaces for `client`, `server`, and `shared`.
  - `tsconfig.json` defines composite project references linking `shared`, `server`, and `client`.
  - Build script `npm run build` runs `npm run build:shared && npm run build:server && npm run build:client`.

- **Backend Architecture & Routes**:
  - Express app in `server/src/app.ts` registers routes under `/api/*`, including `/api/kiosk` mapped to `server/src/routes/kioskToken.ts` (line 189), `/api/auth` (lines 168-169), and `/health` (line 131).
  - PostgreSQL database pool and migrations in `server/src/db.ts`: `runMigrations()` executes sequential idempotent SQL statements on server startup.
  - WebSocket server in `server/src/index.ts` operates on `/ws` and broadcasts entity changes via `server/src/lib/broadcaster.ts`.

- **Authentication & Kiosk Token Flow**:
  - `server/src/middleware/auth.ts`: `generateKioskToken` generates a 10-year JWT `{ userId, ownerId, isKiosk: true }` (lines 42-44).
  - `server/src/routes/kioskToken.ts`:
    - `POST /api/kiosk/pair/init` generates random 6-digit codes stored in memory `pairSessions` (lines 46-61).
    - `GET /api/kiosk/pair/status` polls for pairing completion (lines 67-85).
    - `POST /api/kiosk/pair/authorize` authorizes the code and assigns the 10-year JWT (lines 91-118).
    - No database table or tracking exists for linked kiosk devices, and no unlinking/revocation mechanism is implemented.

- **Frontend & Kiosk Display**:
  - `client/src/pages/Kiosk.tsx`:
    - Unauthenticated pairing screen contains hardcoded `Modo Smart Display 42"` (line 446) and TV-specific text (lines 454-476).
    - Uses external QR code service `https://api.qrserver.com/v1/create-qr-code/?size=260x260&data=...` (line 483).
    - Unauthenticated view layout has fixed 2-column grid and sizing that overflows compact 7" screens.
    - Settings modal in `Kiosk.tsx` contains sticky header (line 895) and sticky footer (line 1152), but requires verified density and touch/scroll responsiveness across compact viewports.
  - `client/src/pages/Settings.tsx`:
    - Only contains a link card to open `/kiosk` (lines 859-878); lacks device management, listing, and unlinking controls.

- **Test Infrastructure**:
  - Integration smoke test available at `scripts/smoke-api.sh` executing curl/jq against API endpoints.
  - Playwright listed in `client/package.json` devDependencies.

---

## 2. Logic Chain

1. **R1 (Universal & Responsive Kiosk Mode)**:
   - *Observation*: Hardcoded `Modo Smart Display 42"` and TV-specific copy in `Kiosk.tsx` (lines 446, 454-476) break universal compatibility for wall tablets and smart fridges.
   - *Logic*: Refactoring text to neutral/universal terminology ("Display da Família" / "Smart Display") and adjusting Tailwind responsive breakpoints (using clamp sizing and flexible column wrapping) will allow the pairing screen to scale smoothly from 7" viewports (800x1280, 1024x600) to 75" 4K TVs.
   - *Observation*: The QR code depends on an external third-party URL (`api.qrserver.com`).
   - *Logic*: Generating QR codes locally or using lightweight offline SVGs guarantees reliable local homelab operation without internet connectivity.

2. **R2 (Kiosk Devices Management & Remote Unlinking)**:
   - *Observation*: Kiosk pairing is currently ephemeral and tokens are purely stateless JWTs without database tracking in PostgreSQL.
   - *Logic*:
     - A database migration in `server/src/db.ts` must introduce a `kiosk_devices` table tracking `id`, `user_id`, `device_name`, `device_type`/`user_agent`, `ip_address`, `device_token` (or token hash/id), `last_active_at`, `revoked_at`, `created_at`.
     - `server/src/routes/kioskToken.ts` needs endpoints:
       - `GET /api/kiosk/devices` (list active devices for family).
       - `DELETE /api/kiosk/devices/:id` (revoke device token).
     - Token validation in `authMiddleware` (or a dedicated kiosk heartbeat) must check if the device token has been revoked, returning 401 when revoked.
     - When a device is unlinked, broadcasting a revocation event via WebSocket or returning 401 on next request forces `Kiosk.tsx` to wipe local storage and immediately return to the QR code pairing screen.
     - In `client/src/pages/Settings.tsx`, a new "Dispositivos Kiosk Vinculados" card must list active displays with device metadata and a "Desvincular Dispositivo" button.

---

## 3. Caveats

1. **Capacitor Mobile Shell**:
   - The client has Capacitor configuration for Android/mobile; any new dependencies or changes to `api.ts` must maintain compatibility with `capacitor://localhost` and native HTTP interceptors.
2. **Offline Homelab Deployments**:
   - OpenFamily is self-hosted in homelabs (often air-gapped or on local subnets). The QR code generator must not rely on external cloud APIs.
3. **Database Migration Safety**:
   - Migrations in `server/src/db.ts` must remain fully idempotent using `CREATE TABLE IF NOT EXISTS` and `ADD COLUMN IF NOT EXISTS` to ensure zero downtime on existing installations.

---

## 4. Conclusion

The system architecture of OpenFamily is well-structured, modular, and directly amenable to the Universal Kiosk Mode and Device Management requirements.

**Action Plan for Implementation**:
1. **Database & Backend**:
   - Add `kiosk_devices` table migration in `server/src/db.ts`.
   - Update `server/src/routes/kioskToken.ts` to record device details upon pairing and expose `GET /api/kiosk/devices` and `DELETE /api/kiosk/devices/:id`.
   - Add revocation enforcement so unlinked devices are rejected with 401.
2. **Frontend Settings (`/settings`)**:
   - Add Kiosk Devices Management table/list in `client/src/pages/Settings.tsx` with "Desvincular Dispositivo" action.
3. **Frontend Kiosk (`/kiosk`)**:
   - Clean up hardcoded 42" labels and TV-only text.
   - Implement fluid responsive layout for QR code and 6-digit code for all viewports (7" fridges to 75" TVs).
   - Ensure sticky modal header/footer and smooth unlinking redirect.

---

## 5. Verification Method

1. **Compile & Type Check**:
   - Run `npm run build` from the project root. Verify zero TypeScript errors in `shared`, `server`, and `client`.
2. **API Verification**:
   - `POST /api/kiosk/pair/init` -> verify 6-digit code generation.
   - `POST /api/kiosk/pair/authorize` -> verify device record created in `kiosk_devices`.
   - `GET /api/kiosk/devices` -> verify device listed with name, IP, User-Agent, last active.
   - `DELETE /api/kiosk/devices/:id` -> verify device revoked.
   - Authenticated kiosk query with revoked token -> verify 401 Unauthorized response.
3. **UI & Responsiveness Verification**:
   - Open `/kiosk` in browser devtools at:
     - 800x1280 (7" fridge portrait)
     - 1024x600 (7" fridge landscape)
     - 1920x1080 (Desktop / 1080p TV)
     - 3840x2160 (4K TV with zoom scaling)
   - Verify Settings Modal close buttons `[X]` and `[Fechar]` remain sticky and accessible on all viewport sizes.
