# TEST_INFRA — Universal Kiosk Mode & Remote Device Management

This document defines the End-to-End (E2E) testing infrastructure, opaque-box test methodology, reference emulator architecture, and contract verification matrix for OpenFamily's Universal Kiosk Mode and Remote Device Management.

---

## 1. Architecture & Testing Methodology

The E2E test suite adheres to **requirement-driven, opaque-box testing** principles:
- **Specification-Authoritative**: Test expectations are derived strictly from `ORIGINAL_REQUEST.md` and `PROJECT.md` interface contracts.
- **Zero-External-Dependency Runtime**: Built on native Node.js (v20+) standard modules (`node:crypto`, `node:assert`, `node:fs`, `node:path`), eliminating flaky browser dependencies, database connection locks, and network latency in CI/CD.
- **Contract-Strict**: Verifies database schemas, JWT claims, HTTP status codes, JSON payload schemas, WebSocket broadcasts, client state machines, and viewport layout constraints.

```
┌────────────────────────────────────────────────────────────────────────┐
│                          E2E Test Runner                               │
│                     (node tests/e2e/runner.js)                         │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │
       ┌───────────────────────────┼───────────────────────────┐
       ▼                           ▼                           ▼
┌──────────────┐            ┌──────────────┐            ┌──────────────┐
│    Tier 1    │            │    Tier 2    │            │  Tier 3 & 4  │
│   Feature    │            │  Boundaries  │            │  Pairwise &  │
│   Coverage   │            │  & Security  │            │  Real-World  │
│  (60 tests)  │            │  (60 tests)  │            │ (10+ tests)  │
└──────┬───────┘            └──────┬───────┘            └──────┬───────┘
       │                           │                           │
       └───────────────────────────┼───────────────────────────┘
                                   ▼
             ┌───────────────────────────────────────────┐
             │       Isolated Test Harness Emulator      │
             ├─────────────────────┬─────────────────────┤
             │ KioskBackendServer  │ MockDatabase        │
             │ MockBroadcaster(WS) │ ClientKioskSim      │
             │ UiVerification      │ JwtEngine (HS256)   │
             └───────────────────────────────────────────┘
```

---

## 2. Test Tiers Overview

The test suite is partitioned into four distinct tiers:

### Tier 1: Feature Coverage (60 Test Cases)
Comprehensive verification of all 12 inventoried features (>= 5 tests per feature):
- **Feature 1**: `kiosk_devices` Database Table & Schema Migration.
- **Feature 2**: Kiosk JWT with Device Tracking & Revocation Middleware.
- **Feature 3**: Kiosk Device Management API Endpoints (`GET /devices`, `DELETE /devices/:id`, `POST /heartbeat`, `POST /pair/authorize`, `POST /pair/init`).
- **Feature 4**: WebSocket Kiosk Revocation Broadcast (`WsEntity: 'kiosk'`, multi-client broadcast).
- **Feature 5**: Remove Hardcoded 42" Smart Display Labels & Localize (`en`, `pt`, `fr`, `zh`).
- **Feature 6**: Ultra-Responsive QR & 6-Digit Pairing Layout (7" fridge to 75" 4K TV).
- **Feature 7**: Lean Header Controls (Night Dimmer presets, Zoom bounds, Dark Mode, Weather).
- **Feature 8**: Sticky Modal Headers & Footers (`max-h-[85vh]`, sticky `[X]`, sticky `[Fechar]`).
- **Feature 9**: Client-Side Instant Revocation Handling in Kiosk (401 interceptor, WS event, token purge).
- **Feature 10**: Dashboard Kiosk Devices Management UI (`/settings` device listing & metadata).
- **Feature 11**: "Desvincular Dispositivo" (Unlink Device) Action (DELETE invocation, toast feedback).
- **Feature 12**: TypeScript & Monorepo Build Integrity (Shared types, API contracts, JSON schemas).

### Tier 2: Boundary & Corner Cases (60 Test Cases)
Adversarial verification and extreme boundary conditions (>= 5 tests per feature):
- Extreme input lengths (500+ character device names, IPv6 addresses, XSS payloads).
- Security boundaries (malformed JWTs, expired tokens, forged secrets, deleted users, ghost devices).
- API error handling (expired 6-digit codes, re-used pairing codes, SQL injection in UUID parameters).
- WebSocket resilience (zero-listener broadcasts, 50+ message flood storms, error isolation).
- Viewport extremes (800x480 ultra-compact, 7680x4320 8K display, 600x1200 vertical fridge).
- Control clamps (Dimmer min 15% / max 100%, Zoom min 0.6x / max 1.6x, corrupted JSON fallback).
- Modal resilience (Escape dismissal, rapid clicking, dual modal overlap prevention).
- Network error handling (transient offline errors do NOT wipe stored tokens prematurely).
- High density scaling (100+ connected devices in Settings without crash).
- Role security (child account 403 Forbidden on device revocation, cross-tenant isolation).

### Tier 3: Cross-Feature Combinations (5 Comprehensive Tests)
Multi-component lifecycle and interaction testing:
- **P1**: Full Lifecycle (Pairing Init -> Mobile Authorize -> Device Insert -> Kiosk Active -> Remote Unlink -> WS Revocation -> 401 Redirection -> Re-Pairing).
- **P2**: Multi-Kiosk Fleet Management (3 simultaneous kiosks: Living Room TV, Kitchen Fridge, Bedroom Tablet; selective unlinking of 1 leaves remaining 2 fully operational).
- **P3**: Role-Based Access Control (Owner vs Child Permissions on Device Unlinking).
- **P4**: Cross-Tenant Isolation (Family A cannot view or revoke Family B displays).
- **P5**: Display Settings Persistence across Browser Reload and Power Cycles.

### Tier 4: Real-World Homelab Application Scenarios (5 Scenarios)
Realistic end-to-end homelab operational workflows:
1. **Scenario 1**: *Wall Tablet Setup Workflow (10" 1280x800 resolution)*.
2. **Scenario 2**: *Smart TV Living Room Pairing Workflow (65" 4K 3840x2160 resolution)*.
3. **Scenario 3**: *Remote Emergency Deauthorization from Mobile Dashboard*.
4. **Scenario 4**: *Smart Fridge Compact Display Density & Modal Workflow (7" 1024x600 resolution)*.
5. **Scenario 5**: *Power Outage Recovery & Heartbeat Resume Workflow*.

---

## 3. Test Harness & Reference Infrastructure

Located in `tests/e2e/harness/`:

| Module | Description |
|---|---|
| `assertion.js` | Zero-dependency assertion engine (`strictEqual`, `deepEqual`, `includes`, `match`, `throws`) with `TestSuite` runner. |
| `testHarness.js` | Complete contract emulator containing `MockDatabase`, `KioskBackendServer`, `MockBroadcaster`, `ClientKioskSimulator`, and HMAC-SHA256 `JwtEngine`. |
| `uiHarness.js` | DOM layout, viewport geometry calculator, responsive breakpoint simulator, and i18n locale dictionary validator. |

---

## 4. Execution Instructions

### Running All Tests
```bash
# Direct Node runner
node tests/e2e/runner.js

# Or via npm script
npm test
npm run test:e2e
```

### Exit Codes & Output
- **Exit Code 0**: All test suites passed (100% pass rate).
- **Exit Code 1**: Any test failure detected, with detailed stack trace and mismatch report.

---

## 5. Contract & Feature Traceability Matrix

| Feature | Requirement Ref | API / DB Contract | Tier 1 Tests | Tier 2 Tests | Tier 3/4 Tests |
|---|---|---|---|---|---|
| 1. DB Table & Migration | ORIGINAL_REQUEST §R2 | `kiosk_devices` schema | F1.1 - F1.5 | B1.1 - B1.5 | P1, S1 |
| 2. Kiosk JWT & Middleware | ORIGINAL_REQUEST §R2 | `deviceId` claim + `authMiddleware` | F2.1 - F2.5 | B2.1 - B2.5 | P1, P2 |
| 3. Kiosk Device Management API | ORIGINAL_REQUEST §R2 | `GET /devices`, `DELETE /devices/:id`, `heartbeat` | F3.1 - F3.5 | B3.1 - B3.5 | P1, P2, S3 |
| 4. WebSocket Broadcast | ORIGINAL_REQUEST §R2 | `WsEntity: 'kiosk'`, payload `{ entity, action }` | F4.1 - F4.5 | B4.1 - B4.5 | P1, P2, S3 |
| 5. Remove 42" & Localize | ORIGINAL_REQUEST §R1 | i18n keys across `en, pt, fr, zh` | F5.1 - F5.5 | B5.1 - B5.5 | S2 |
| 6. Ultra-Responsive QR | ORIGINAL_REQUEST §R1 | Viewport scaling `1024x600` to `3840x2160` | F6.1 - F6.5 | B6.1 - B6.5 | S1, S2, S4 |
| 7. Lean Header Controls | ORIGINAL_REQUEST §R1 | Dimmer (15-100%), Zoom (0.6-1.6x), Dark Mode | F7.1 - F7.5 | B7.1 - B7.5 | S2, S4 |
| 8. Sticky Modal Headers/Footers | ORIGINAL_REQUEST §R1 | `max-h-[85vh]`, sticky `[X]`, sticky `[Fechar]` | F8.1 - F8.5 | B8.1 - B8.5 | S4 |
| 9. Client Instant Revocation | ORIGINAL_REQUEST §R2 | 401 / WS deleted -> clear token -> pairing UI | F9.1 - F9.5 | B9.1 - B9.5 | P1, P2, S3 |
| 10. Dashboard Management UI | ORIGINAL_REQUEST §R2 | `/settings` active kiosk devices list | F10.1 - F10.5 | B10.1 - B10.5 | P2, S3 |
| 11. "Desvincular" Action | ORIGINAL_REQUEST §R2 | UI unlink button, toast confirmation | F11.1 - F11.5 | B11.1 - B11.5 | P1, P2, S3 |
| 12. Monorepo Build Integrity | ORIGINAL_REQUEST §Acceptance | Type contracts, JSON schemas, build safety | F12.1 - F12.5 | B12.1 - B12.5 | P5, S5 |
