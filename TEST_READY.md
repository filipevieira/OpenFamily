# TEST_READY — Universal Kiosk Mode E2E Test Suite

**Status**: ✅ READY (100% Comprehensive Coverage Published)  
**Date**: 2026-08-30  
**Test Suite Path**: `tests/e2e/`  
**Test Runner**: `node tests/e2e/runner.js` / `npm test`

---

## 1. Test Suite Summary

The End-to-End (E2E) Test Suite for OpenFamily Universal Kiosk Mode and Remote Device Management is complete and ready for execution.

| Test Tier | Test Scope | Number of Tests | Target Features Covered |
|---|---|---|---|
| **Tier 1** | Feature Coverage (Happy Path & Interface Contracts) | **60 Tests** | Features 1–12 (5 tests each) |
| **Tier 2** | Boundary & Corner Cases (Extreme inputs, Security, Viewports) | **60 Tests** | Features 1–12 (5 tests each) |
| **Tier 3** | Cross-Feature Combinations & Pairwise Interactions | **5 Tests** | Full Pairing Lifecycle, Fleet Management, RBAC, Tenant Isolation, Persistence |
| **Tier 4** | Real-World Homelab Application Scenarios | **5 Scenarios** | Wall Tablet, Smart TV 4K, Remote Deauth, Smart Fridge Compact, Power Outage Recovery |
| **Total** | **All Tiers Combined** | **130 Tests** | **All 12 Features Fully Covered** |

---

## 2. Test Execution Command

To execute all test tiers in a single run:

```bash
# Using Node directly
node tests/e2e/runner.js

# Or via npm script
npm test
npm run test:e2e
```

### Expected Output
- Formatted console output showing each tier and test suite.
- Symbol markers: `✔ [PASS]` and `✖ [FAIL]` with execution timing per test.
- Summary block with Total Tests Run, Passed, Failed, and Execution Time.
- **Exit Code 0** on success.

---

## 3. Test Suite Inventory

```
tests/e2e/
├── harness/
│   ├── assertion.js                   # Custom assertion engine & test suite runner
│   ├── testHarness.js                 # Contract emulator (DB, Server, WebSocket, Simulator)
│   └── uiHarness.js                   # Viewport simulator, sticky layout & i18n validator
├── tier1-feature-coverage.test.js     # 60 tests (F1.1 to F12.5)
├── tier2-boundary-corner.test.js      # 60 tests (B1.1 to B12.5)
├── tier3-cross-feature.test.js        # 5 complex interaction tests (P1 to P5)
├── tier4-real-world-scenarios.test.js # 5 homelab workflows (S1 to S5)
└── runner.js                          # Master test runner
```

---

## 4. Key Contracts & Validation Criteria

1. **Database & Schema**:
   - `kiosk_devices` table with UUID primary key, `user_id` foreign key cascade, metadata fields, `revoked_at` timestamp, and query indexes.
2. **Kiosk Auth & Revocation Middleware**:
   - `generateKioskToken` embeds `deviceId` and `isKiosk: true`.
   - `authMiddleware` queries `kiosk_devices` to verify `revoked_at IS NULL`, returning HTTP 401 when revoked.
3. **API Endpoints**:
   - `POST /api/kiosk/pair/init`: 6-digit numeric pairing code.
   - `GET /api/kiosk/pair/status`: polling endpoint.
   - `POST /api/kiosk/pair/authorize`: device registration and 10-year kiosk JWT issuance.
   - `GET /api/kiosk/devices`: returns active non-revoked devices for family owner.
   - `DELETE /api/kiosk/devices/:id`: sets `revoked_at = NOW()` and broadcasts WebSocket revocation.
   - `POST /api/kiosk/heartbeat`: refreshes `last_active_at` timestamp.
4. **WebSocket Entity**:
   - `WsEntity` includes `'kiosk'`. Broadcasts `{ type: 'update', entity: 'kiosk', action: 'deleted', id: '<deviceId>' }`.
5. **Universal Kiosk UI & Responsiveness**:
   - Removal of hardcoded `Modo Smart Display 42"`.
   - Responsive scaling from 7" smart fridges (1024x600, 800x1280) to 75" 4K TVs (3840x2160).
   - Sticky header `[X]` and sticky footer `[Fechar]` on Display Settings modal.
   - Client token purge and instant redirection to pairing UI on 401 / WebSocket revocation.
6. **Dashboard Device Management (`/settings`)**:
   - Active displays list with metadata and "Desvincular Dispositivo" action button.
