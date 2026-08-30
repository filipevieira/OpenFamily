# System Architecture & API Exploration Report

## 1. Executive Summary

This investigation surveys the **OpenFamily** system architecture, API routes, database models, build/test setups, and authentication mechanisms with a primary focus on preparing the foundation for the **Universal Kiosk Mode** (`/kiosk`) and **Remote Device Management** (`/settings`).

OpenFamily is organized as a clean TypeScript npm monorepo (`client`, `server`, `shared`) utilizing React 19 + Vite on the frontend, Express + PostgreSQL + WebSocket on the backend, and shared TypeScript models in `@openfamily/shared`.

---

## 2. Monorepo & Project Structure

### Monorepo Layout
```
OpenFamily/
├── client/                     # Vite + React 19 Frontend SPA & Capacitor Android shell
│   ├── src/
│   │   ├── components/         # Radix UI + Tailwind reusable UI components
│   │   ├── contexts/           # AuthContext, ThemeContext, WebSocketContext
│   │   ├── pages/              # Kiosk.tsx, PairTV.tsx, Settings.tsx, Dashboard.tsx, etc.
│   │   ├── hooks/              # useWebSocketUpdates, useCategories, useNotifications
│   │   ├── i18n/               # locales (en, fr, pt, zh)
│   │   └── lib/                # api.ts, serverConfig.ts, soundEngine.ts, utils.ts
│   ├── package.json
│   ├── tsconfig.json
│   └── vite.config.ts
├── server/                     # Node.js + Express + PostgreSQL + WebSocket Backend
│   ├── src/
│   │   ├── app.ts              # Express configuration, middlewares, helmet/CORS/CSP, routing
│   │   ├── index.ts            # HTTP + WebSocket server initialization, schedulers
│   │   ├── db.ts               # PostgreSQL Pool, migration runner (runMigrations)
│   │   ├── middleware/         # authMiddleware, requireParent, token generators
│   │   ├── routes/             # kioskToken.ts, auth.ts, userSettings.ts, etc.
│   │   └── lib/                # broadcaster.ts, logger.ts, mailer.ts, pushService.ts
│   ├── package.json
│   ├── tsconfig.json
│   └── schema.sql
├── shared/                     # Shared TypeScript interfaces and domain constants
│   ├── src/
│   │   ├── types.ts            # BaseEntity, User, FamilyMember, Task, Appointment, etc.
│   │   ├── constants.ts        # Categories, priorities, meal types, blood types
│   │   └── index.ts
│   ├── package.json
│   └── tsconfig.json
├── android-tv/                 # Native Android TV WebView wrapper
├── scripts/                    # smoke-api.sh, build-site.mjs, screenshots.mjs, etc.
├── package.json                # Workspaces root
└── tsconfig.json               # Root TSConfig with project references
```

### Package Scripts & Build System
- `npm run dev`: Concurrently runs `dev:server` (`tsx watch src/index.ts`) and `dev:client` (`vite`).
- `npm run build`: Sequentially compiles `shared` (`tsc`), `server` (`tsc`), and `client` (`tsc && vite build`).
- `npm run smoke:api`: Executes the integration API test script (`scripts/smoke-api.sh`).
- TypeScript compiler configurations:
  - Root `tsconfig.json` defines composite project references.
  - `shared/tsconfig.json`: Emits types to `dist/`.
  - `server/tsconfig.json`: Emits CommonJS build to `dist/`.
  - `client/tsconfig.json`: Bundler resolution mode, `noEmit: true`, strict type checks (`strict: true`, `noUnusedLocals: true`, `noUnusedParameters: true`).

---

## 3. Backend Architecture & API Routes

### HTTP & WebSocket Server (`server/src/index.ts` & `server/src/app.ts`)
- **HTTP Server**: Express 4.22 with JSON/URL-encoded body parsers (1MB limit), Helmet CSP, CORS configuration for LAN and Capacitor origins.
- **WebSocket Server**: `ws` listening on `/ws`. Clients authenticate with `{ type: 'auth', token: '...' }`. `broadcaster.ts` maintains a mapping of `userId` (owner ID) -> Set of active WebSocket connections, broadcasting entity updates in real time.

### Database Layer (`server/src/db.ts`)
- PostgreSQL using `pg.Pool`.
- Schema migrations are automated in `runMigrations()` in `server/src/db.ts`, keeping startup idempotent.
- Type parsers configured for DATE (1082) and TIMESTAMP without timezone (1114) to prevent timezone drift across client/server boundaries.

### Authentication & Authorization (`server/src/middleware/auth.ts`)
- **JWT Token Structure**:
  - Regular user token: `{ userId, ownerId }`, expiration `7d`.
  - Kiosk token: `{ userId, ownerId, isKiosk: true, [deviceId] }`, expiration `3650d` (10 years).
- **Middlewares**:
  - `authMiddleware`: Extracts token from `Authorization: Bearer <token>` or `?token=<token>`. Populates `req.actualUserId`, `req.userId` (family owner ID), and `req.isOwner`.
  - `requireParent`: Database-backed verification ensuring the requesting user is either the family owner or has the role `parent` (blocks `enfant` accounts with 403).

---

## 4. Current Kiosk & Pairing Implementation

### Existing Endpoints (`server/src/routes/kioskToken.ts`)
1. `GET /api/kiosk/token` (auth required): Generates a long-lived 10-year Kiosk JWT token for the authenticated family.
2. `POST /api/kiosk/pair/init` (public): Generates a random 6-digit pairing code stored in an in-memory `Map<string, PairSession>` (10-minute expiry).
3. `GET /api/kiosk/pair/status?code=...` (public): Polled every 2s by the unauthenticated display. Returns `{ authorized: true, token }` once paired.
4. `POST /api/kiosk/pair/authorize` (auth required): Authenticated mobile phone submits 6-digit code from `/pair`. Links the family's 10-year kiosk JWT into the session.

### Identified Gaps for Universal Kiosk Mode:
1. **Device Persistence & Inventory (Requirement R2)**:
   - Currently, kiosk tokens are generated statelessly without DB records of linked devices.
   - A `kiosk_devices` table is needed in PostgreSQL to store: `id`, `user_id` (family owner), `device_name`, `device_type`/`browser_info`, `ip_address`, `device_token` (or token identifier/hash), `last_active_at`, `revoked_at`, `created_at`.
   - New management endpoints required:
     - `GET /api/kiosk/devices`: Lists linked kiosk devices for the family.
     - `DELETE /api/kiosk/devices/:id`: Revokes a kiosk device.
     - Optional `PUT /api/kiosk/devices/:id`: Renames a kiosk device.
   - Revocation verification:
     - Server must validate that the kiosk token has not been revoked (via DB check in `authMiddleware` or a kiosk validation/heartbeat endpoint).
     - Revoking a device must broadcast via WebSocket (`ws`) or cause the next API query to return 401 Unauthorized, prompting the kiosk client to clear storage and return to `/kiosk` pairing screen.

2. **Responsiveness & Hardcoded References (Requirement R1)**:
   - Hardcoded label `Modo Smart Display 42"` in `Kiosk.tsx` line 446.
   - TV-only text ("Autenticação Fácil de TV", "Conecte sua TV em segundos", "Autorizar esta TV").
   - Layout in `Kiosk.tsx`:
     - Fixed `grid-cols-2` with `gap-12` and fixed `w-60 h-60` QR code causes vertical/horizontal overflow on compact 7" screens (e.g. 1024x600 or 800x1280 smart fridges and tablets).
     - Settings modal header and footer need sticky CSS positioning (`sticky top-0`, `sticky bottom-0`) with well-defined `overflow-y-auto` body to ensure Close (`[X]` / `[Fechar]`) buttons are never cut off.
   - QR Code generation: Currently loads from `https://api.qrserver.com/v1/create-qr-code/...`. Using a local SVG/Canvas QR generator or robust inline approach prevents external network dependency for local homelabs.

---

## 5. Frontend Architecture & State Management

### Key Pages:
- `client/src/pages/Kiosk.tsx`: Kiosk view. Supports unauthenticated QR pairing mode and authenticated multi-widget dashboard (Schedule, Meals, Tasks, Whereabouts, Shopping, Notes, Weather, Ambient Sounds, Dimmer, Zoom, Dark Mode).
- `client/src/pages/PairTV.tsx`: Mobile authorization view at `/pair` to input the 6-digit code.
- `client/src/pages/Settings.tsx`: System settings page. Currently has a simple "Modo Quiosque" link card; must be augmented with the **Kiosk Devices Management & Remote Unlinking** section.

### Client Auth Lifecycle:
- `AuthContext.tsx`: Manages session bootstrap (`/api/auth/me`), language sync, dashboard preferences, and disabled module filters.
- `api.ts`: Central `ApiClient` handling Bearer tokens, JSON serialization, 401 handling (`openfamily:auth-expired` custom event).
- `useWebSocketUpdates.ts`: Subscribes to backend entity mutations to trigger automatic data re-fetching.

---

## 6. Verification & Test Strategy

1. **Static Analysis & Type Checking**:
   - `npm run build:shared` -> verifies shared types.
   - `npm run build:server` -> verifies backend compilation.
   - `npm run build:client` -> runs TypeScript check (`tsc`) and Vite bundling. Zero TypeScript errors required.
2. **API Verification**:
   - Verify `POST /api/kiosk/pair/init`, `GET /api/kiosk/pair/status`, `POST /api/kiosk/pair/authorize`.
   - Verify new endpoints `GET /api/kiosk/devices` and `DELETE /api/kiosk/devices/:id`.
   - Verify that revoking a device invalidates requests with that kiosk token and forces client redirection.
3. **Viewport Responsiveness**:
   - 7" smart fridge portrait/landscape (800x1280, 1024x600).
   - 10" wall tablet (1280x800, 1920x1200).
   - Standard 1080p and 4K TV viewports (1920x1080, 3840x2160).
