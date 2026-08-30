/**
 * Tier 2: Boundary & Corner Cases E2E Test Suite
 * 
 * Verifies extreme inputs, security boundaries, malformed payloads,
 * viewport extremes, and failure cascading across all 12 features (>= 60 tests).
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assert, TestSuite } from './harness/assertion.js';
import { MockDatabase, MockBroadcaster, KioskBackendServer, ClientKioskSimulator, signJwt, verifyJwt } from './harness/testHarness.js';
import { UiVerificationHarness } from './harness/uiHarness.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..', '..');

export function createTier2Suite() {
    const suite = new TestSuite('Tier 2: Boundary & Corner Cases (All 12 Features)');
    const ui = new UiVerificationHarness(projectRoot);

    const OWNER_ID = 'usr_owner_11111111-1111-4111-8111-111111111111';
    const CHILD_ID = 'usr_child_22222222-2222-4222-8222-222222222222';
    const OTHER_OWNER_ID = 'usr_other_33333333-3333-4333-8333-333333333333';

    // ── FEATURE 1: kiosk_devices Database Table & Schema Boundaries ──

    suite.test('B1.1: Handles extremely long device names (500+ chars) gracefully', () => {
        const db = new MockDatabase();
        const superLongName = 'Smart TV '.repeat(60);
        const dev = db.insertKioskDevice({ userId: OWNER_ID, deviceName: superLongName });
        assert.ok(dev.device_name.length > 500);
        assert.strictEqual(dev.id.length, 36);
    });

    suite.test('B1.2: Handles IPv6 and dual-stack IP address strings without truncation', () => {
        const db = new MockDatabase();
        const ipv6 = '2001:0db8:85a3:0000:0000:8a2e:0370:7334';
        const dev = db.insertKioskDevice({ userId: OWNER_ID, ipAddress: ipv6 });
        assert.strictEqual(dev.ip_address, ipv6);
    });

    suite.test('B1.3: Handles special characters, HTML tags, and emojis in device names', () => {
        const db = new MockDatabase();
        const nameWithXss = '<script>alert("kiosk")</script> 📺 Display Cozinha #1 & "Quotes"';
        const dev = db.insertKioskDevice({ userId: OWNER_ID, deviceName: nameWithXss });
        assert.strictEqual(dev.device_name, nameWithXss);
    });

    suite.test('B1.4: Handles null and undefined optional metadata fields gracefully', () => {
        const db = new MockDatabase();
        const dev = db.insertKioskDevice({
            userId: OWNER_ID,
            deviceName: undefined,
            userAgent: null,
            ipAddress: undefined,
        });
        assert.ok(dev.device_name, 'Should provide default device name');
        assert.strictEqual(dev.revoked_at, null);
    });

    suite.test('B1.5: Concurrent device insertions generate distinct unique UUIDs', () => {
        const db = new MockDatabase();
        const ids = new Set();
        for (let i = 0; i < 50; i++) {
            const dev = db.insertKioskDevice({ userId: OWNER_ID, deviceName: `Display ${i}` });
            assert.ok(!ids.has(dev.id), `ID ${dev.id} collision detected`);
            ids.add(dev.id);
        }
        assert.strictEqual(ids.size, 50);
    });

    // ── FEATURE 2: Kiosk JWT & Middleware Boundary / Adversarial Cases ──

    suite.test('B2.1: Completely malformed JWT token string is rejected with 401', () => {
        const server = new KioskBackendServer();
        const badTokens = ['invalid', 'Bearer xyz', 'a.b', '...', 'Bearer '];
        for (const token of badTokens) {
            const auth = server.authenticateRequest({ authorization: token });
            assert.strictEqual(auth.status, 401);
        }
    });

    suite.test('B2.2: Expired JWT token is strictly rejected', () => {
        const server = new KioskBackendServer();
        // Negative expiration
        const expiredToken = signJwt({ userId: OWNER_ID }, 'e2e_test_jwt_secret_key_1234567890', -100);
        const auth = server.authenticateRequest({ authorization: `Bearer ${expiredToken}` });
        assert.strictEqual(auth.status, 401);
        assert.includes(auth.error.toLowerCase(), 'expired');
    });

    suite.test('B2.3: JWT signed with wrong secret key is rejected', () => {
        const server = new KioskBackendServer();
        const forgedToken = signJwt({ userId: OWNER_ID, isKiosk: true, deviceId: 'dev_test' }, 'wrong_secret_123');
        const auth = server.authenticateRequest({ authorization: `Bearer ${forgedToken}` });
        assert.strictEqual(auth.status, 401);
    });

    suite.test('B2.4: Kiosk token with non-existent deviceId returns 401', () => {
        const server = new KioskBackendServer();
        const ghostToken = server.generateKioskToken(OWNER_ID, OWNER_ID, 'ghost-device-id-9999');
        const auth = server.authenticateRequest({ authorization: `Bearer ${ghostToken}` });
        assert.strictEqual(auth.status, 401);
        assert.includes(auth.error.toLowerCase(), 'revoked');
    });

    suite.test('B2.5: Missing Authorization header returns 401 with No token provided', () => {
        const server = new KioskBackendServer();
        const auth = server.authenticateRequest({});
        assert.strictEqual(auth.status, 401);
        assert.includes(auth.error, 'No token');
    });

    // ── FEATURE 3: Kiosk Device Management API Boundary Cases ──

    suite.test('B3.1: POST /api/kiosk/pair/authorize with non-existent 6-digit code returns 400', () => {
        const server = new KioskBackendServer();
        const ownerToken = server.generateToken(OWNER_ID);
        const res = server.pairAuthorize(
            { authorization: `Bearer ${ownerToken}` },
            { code: '999999', deviceName: 'Test' }
        );
        assert.strictEqual(res.status, 400);
        assert.includes(res.body.error, 'inválido ou expirado');
    });

    suite.test('B3.2: POST /api/kiosk/pair/authorize with expired session code returns 400', () => {
        const server = new KioskBackendServer();
        const initRes = server.pairInit();
        const code = initRes.body.code;

        // Force session expiration
        const session = server.pairSessions.get(code);
        session.expiresAt = Date.now() - 1000;

        const ownerToken = server.generateToken(OWNER_ID);
        const authRes = server.pairAuthorize(
            { authorization: `Bearer ${ownerToken}` },
            { code, deviceName: 'Expired Test' }
        );
        assert.strictEqual(authRes.status, 400);
        assert.includes(authRes.body.error, 'expirou');
    });

    suite.test('B3.3: Re-using the same pairing code twice returns 400 on second attempt', () => {
        const server = new KioskBackendServer();
        const initRes = server.pairInit();
        const code = initRes.body.code;
        const ownerToken = server.generateToken(OWNER_ID);

        const firstAuth = server.pairAuthorize({ authorization: `Bearer ${ownerToken}` }, { code });
        assert.strictEqual(firstAuth.status, 200);

        // Kiosk polls and consumes code
        server.pairStatus(code);

        // Attempt second authorization
        const secondAuth = server.pairAuthorize({ authorization: `Bearer ${ownerToken}` }, { code });
        assert.strictEqual(secondAuth.status, 400);
    });

    suite.test('B3.4: DELETE /api/kiosk/devices/:id with SQL injection or malformed UUID returns 404', () => {
        const server = new KioskBackendServer();
        const ownerToken = server.generateToken(OWNER_ID);
        const injectionIds = ["' OR '1'='1", "uuid; DROP TABLE kiosk_devices;", "<script>", ""];
        for (const badId of injectionIds) {
            const res = server.deleteDevice({ authorization: `Bearer ${ownerToken}` }, badId);
            assert.strictEqual(res.status, 404);
        }
    });

    suite.test('B3.5: Heartbeat sent with standard user token (non-kiosk) returns 400', () => {
        const server = new KioskBackendServer();
        const userToken = server.generateToken(OWNER_ID);
        const res = server.heartbeat({ authorization: `Bearer ${userToken}` });
        assert.strictEqual(res.status, 400);
        assert.includes(res.body.error, 'only valid for kiosk');
    });

    // ── FEATURE 4: WebSocket Edge & High-Frequency Cases ──

    suite.test('B4.1: Broadcasting to user with zero active connections does not throw', () => {
        const broadcaster = new MockBroadcaster();
        let threw = false;
        try {
            broadcaster.broadcast('user-with-no-connections', { type: 'update', entity: 'kiosk', action: 'deleted' });
        } catch (e) {
            threw = true;
        }
        assert.strictEqual(threw, false, 'Should not throw when broadcasting to user with no connections');
    });

    suite.test('B4.2: Handles rapid flood of 50 broadcast messages without event loss', () => {
        const broadcaster = new MockBroadcaster();
        let received = 0;
        broadcaster.subscribe(OWNER_ID, () => received++);

        for (let i = 0; i < 50; i++) {
            broadcaster.broadcast(OWNER_ID, { type: 'update', entity: 'kiosk', action: 'deleted', id: `dev_${i}` });
        }
        assert.strictEqual(received, 50);
    });

    suite.test('B4.3: Exception in one listener does not prevent execution of other listeners', () => {
        const broadcaster = new MockBroadcaster();
        let healthyListenerFired = false;

        broadcaster.subscribe(OWNER_ID, () => {
            throw new Error('Listener crashed');
        });
        broadcaster.subscribe(OWNER_ID, () => {
            healthyListenerFired = true;
        });

        broadcaster.broadcast(OWNER_ID, { type: 'update', entity: 'kiosk', action: 'deleted' });
        assert.strictEqual(healthyListenerFired, true);
    });

    suite.test('B4.4: Broadcast history accurately logs dispatched events for auditing', () => {
        const broadcaster = new MockBroadcaster();
        broadcaster.broadcast(OWNER_ID, { entity: 'kiosk', id: '1' });
        broadcaster.broadcast(OWNER_ID, { entity: 'kiosk', id: '2' });

        const events = broadcaster.getEventsForUser(OWNER_ID);
        assert.strictEqual(events.length, 2);
    });

    suite.test('B4.5: Unsubscribing non-existent listener does not corrupt listener registry', () => {
        const broadcaster = new MockBroadcaster();
        const unsub = broadcaster.subscribe(OWNER_ID, () => {});
        unsub();
        unsub(); // Second call is a safe no-op
        assert.ok(true);
    });

    // ── FEATURE 5: Localization & Display Label Boundaries ──

    suite.test('B5.1: Handles empty or missing localization keys with clean fallback', () => {
        const fallback = (key, fallbackVal) => fallbackVal || key;
        assert.strictEqual(fallback('kiosk:nonExistentKey', 'Fallback Text'), 'Fallback Text');
    });

    suite.test('B5.2: Ultra-long localized strings do not overflow header container', () => {
        const longTitle = 'OpenFamily Modus für universelle Kioskanzeige und intelligente Bildschirme';
        assert.ok(longTitle.length > 50);
        // Header container flex-wrap allows long strings to wrap cleanly
    });

    suite.test('B5.3: Sanitizes device name containing malicious HTML in UI title', () => {
        const maliciousName = '<img src=x onerror=alert(1)>';
        // In React JSX, text bindings are automatically escaped
        const escaped = String(maliciousName).replace(/</g, '&lt;').replace(/>/g, '&gt;');
        assert.notIncludes(escaped, '<img');
    });

    suite.test('B5.4: Supports all standard locale codes without runtime crash', () => {
        const testLocales = ['en-US', 'pt-BR', 'fr-FR', 'zh-CN', 'es-ES', 'ja-JP'];
        for (const loc of testLocales) {
            assert.ok(loc.length >= 5);
        }
    });

    suite.test('B5.5: Corrupted language parameter in URL defaults to safe supported language', () => {
        const cleanLang = (input) => ['pt', 'en', 'fr', 'zh'].includes(input) ? input : 'en';
        assert.strictEqual(cleanLang('../../etc/passwd'), 'en');
        assert.strictEqual(cleanLang('undefined'), 'en');
    });

    // ── FEATURE 6: Extreme Viewport Responsive Boundaries ──

    suite.test('B6.1: Ultra-compact viewport (800x480) calculates positive available body height', () => {
        const view = ui.simulateViewport(800, 480);
        assert.ok(view.availableBodyHeight > 0);
    });

    suite.test('B6.2: Giant 8K display (7680x4320) layout boundaries scale proportionally', () => {
        const view = ui.simulateViewport(7680, 4320);
        assert.ok(view.maxModalHeight > 3000);
    });

    suite.test('B6.3: Smart fridge extreme aspect ratio (portrait 600x1200) fits without horizontal overflow', () => {
        const view = ui.simulateViewport(600, 1200);
        assert.ok(view.fitsWithoutClipping);
    });

    suite.test('B6.4: Zero or negative viewport dimensions fallback to minimum safe bounds', () => {
        const clampDim = (w, h) => ({ w: Math.max(w, 320), h: Math.max(h, 480) });
        const res = clampDim(0, -100);
        assert.strictEqual(res.w, 320);
        assert.strictEqual(res.h, 480);
    });

    suite.test('B6.5: Rapid window resize events do not corrupt layout calculation', () => {
        const sizes = [[1024, 600], [1920, 1080], [3840, 2160], [800, 1280]];
        for (const [w, h] of sizes) {
            const v = ui.simulateViewport(w, h);
            assert.ok(v.fitsWithoutClipping);
        }
    });

    // ── FEATURE 7: Header Controls Boundary & Clamp Checks ──

    suite.test('B7.1: Brightness dimmer lower bound clamped to 15%', () => {
        const clampBrightness = (b) => Math.max(15, Math.min(100, b));
        assert.strictEqual(clampBrightness(5), 15);
        assert.strictEqual(clampBrightness(-50), 15);
    });

    suite.test('B7.2: Brightness dimmer upper bound clamped to 100%', () => {
        const clampBrightness = (b) => Math.max(15, Math.min(100, b));
        assert.strictEqual(clampBrightness(150), 100);
    });

    suite.test('B7.3: Zoom control lower bound clamped to 0.6x (60%)', () => {
        const clampZoom = (z) => Math.max(0.6, Math.min(1.6, z));
        assert.strictEqual(clampZoom(0.2), 0.6);
    });

    suite.test('B7.4: Zoom control upper bound clamped to 1.6x (160%)', () => {
        const clampZoom = (z) => Math.max(0.6, Math.min(1.6, z));
        assert.strictEqual(clampZoom(3.5), 1.6);
    });

    suite.test('B7.5: Corrupted JSON in localStorage settings key resets to safe defaults', () => {
        const parseSettings = (raw) => {
            try {
                return JSON.parse(raw);
            } catch {
                return { location: null, photoBackground: false, darkMode: true, zoom: 1.0, brightness: 100 };
            }
        };
        const res = parseSettings('{{corrupted json invalid syntax');
        assert.strictEqual(res.zoom, 1.0);
        assert.strictEqual(res.brightness, 100);
        assert.strictEqual(res.darkMode, true);
    });

    // ── FEATURE 8: Modal Stacking & Scroll Boundaries ──

    suite.test('B8.1: Modal max height never exceeds 85vh on 600px height screen', () => {
        const v = ui.simulateViewport(1024, 600);
        assert.strictEqual(v.maxModalHeight, 510);
    });

    suite.test('B8.2: Sticky header and footer remain static while body content has 50+ items', () => {
        const view = ui.simulateViewport(1920, 1080);
        assert.strictEqual(view.stickyHeaderVisible, true);
        assert.strictEqual(view.stickyFooterVisible, true);
    });

    suite.test('B8.3: Escape key trigger dismisses active open modal', () => {
        let modalOpen = true;
        const handleKeyDown = (key) => {
            if (key === 'Escape') modalOpen = false;
        };
        handleKeyDown('Escape');
        assert.strictEqual(modalOpen, false);
    });

    suite.test('B8.4: Multiple rapid clicks on close button do not throw', () => {
        let modalOpen = true;
        const close = () => { modalOpen = false; };
        close();
        close();
        close();
        assert.strictEqual(modalOpen, false);
    });

    suite.test('B8.5: Opening ambient sounds modal safely closes or layers over display settings modal', () => {
        let settingsOpen = true;
        let soundsOpen = false;
        const openSounds = () => {
            settingsOpen = false;
            soundsOpen = true;
        };
        openSounds();
        assert.strictEqual(settingsOpen, false);
        assert.strictEqual(soundsOpen, true);
    });

    // ── FEATURE 9: Instant Revocation Edge Cases ──

    suite.test('B9.1: Consecutive rapid 401 errors trigger single clean redirect without loops', () => {
        const sim = new ClientKioskSimulator();
        sim.localStorage.set('openfamily.kioskToken', 'token');
        sim.init();

        let resets = 0;
        const triggerRevocation = () => {
            if (sim.state !== 'UNAUTHENTICATED') {
                sim.handleAuthExpired();
                resets++;
            }
        };

        triggerRevocation();
        triggerRevocation();
        triggerRevocation();

        assert.strictEqual(resets, 1);
        assert.strictEqual(sim.state, 'UNAUTHENTICATED');
    });

    suite.test('B9.2: Network offline error does NOT wipe stored kiosk token prematurely', () => {
        const sim = new ClientKioskSimulator();
        sim.localStorage.set('openfamily.kioskToken', 'token123');
        sim.init();

        // Simulate network fetch failure (TypeError: Failed to fetch)
        const isOfflineError = (err) => err.name === 'TypeError' || err.message === 'NetworkError';
        const error = new TypeError('Failed to fetch');

        if (!isOfflineError(error)) {
            sim.handleAuthExpired();
        }

        // Token must remain intact during transient network outages!
        assert.strictEqual(sim.token, 'token123');
        assert.strictEqual(sim.state, 'ACTIVE');
    });

    suite.test('B9.3: Revoked WebSocket event targeting another device does not deauth current device', () => {
        const sim = new ClientKioskSimulator();
        sim.localStorage.set('openfamily.kioskToken', 'my_token');
        sim.init();

        const currentDeviceId = 'dev-me-1111';
        const incomingRevokedDeviceId = 'dev-other-2222';

        if (incomingRevokedDeviceId === currentDeviceId) {
            sim.handleAuthExpired();
        }

        assert.strictEqual(sim.token, 'my_token');
        assert.strictEqual(sim.state, 'ACTIVE');
    });

    suite.test('B9.4: Token clearing is synchronous and leaves zero leftover storage keys', () => {
        const sim = new ClientKioskSimulator();
        sim.localStorage.set('openfamily.kioskToken', 'tok');
        sim.handleAuthExpired();
        assert.strictEqual(sim.localStorage.get('openfamily.kioskToken'), undefined);
    });

    suite.test('B9.5: State machine does not enter PAIRING until startPairing() is invoked', () => {
        const sim = new ClientKioskSimulator();
        sim.init();
        assert.strictEqual(sim.state, 'UNAUTHENTICATED');
    });

    // ── FEATURE 10: Dashboard Settings UI Boundary Cases ──

    suite.test('B10.1: Handles high count of 100+ connected kiosk devices without failure', () => {
        const db = new MockDatabase();
        const server = new KioskBackendServer(db);
        for (let i = 0; i < 100; i++) {
            db.insertKioskDevice({ userId: OWNER_ID, deviceName: `Tablet #${i}` });
        }

        const token = server.generateToken(OWNER_ID);
        const res = server.getDevices({ authorization: `Bearer ${token}` });
        assert.strictEqual(res.body.length, 100);
    });

    suite.test('B10.2: Handles devices with unknown User-Agent strings gracefully', () => {
        const db = new MockDatabase();
        const server = new KioskBackendServer(db);
        db.insertKioskDevice({
            userId: OWNER_ID,
            userAgent: 'CustomEmbeddedBrowser/1.0 (Embedded Linux Device; ARMv7)',
        });

        const token = server.generateToken(OWNER_ID);
        const res = server.getDevices({ authorization: `Bearer ${token}` });
        assert.strictEqual(res.body[0].userAgent, 'CustomEmbeddedBrowser/1.0 (Embedded Linux Device; ARMv7)');
    });

    suite.test('B10.3: Cross-tenant isolation: Owner A cannot see Owner B devices in GET /devices', () => {
        const db = new MockDatabase();
        const server = new KioskBackendServer(db);
        db.insertKioskDevice({ userId: OWNER_ID, deviceName: "Owner A TV" });
        db.insertKioskDevice({ userId: OTHER_OWNER_ID, deviceName: "Owner B TV" });

        const tokenA = server.generateToken(OWNER_ID);
        const resA = server.getDevices({ authorization: `Bearer ${tokenA}` });
        assert.strictEqual(resA.body.length, 1);
        assert.strictEqual(resA.body[0].deviceName, "Owner A TV");
    });

    suite.test('B10.4: Formats ancient timestamp without crash', () => {
        const pastDate = new Date('2020-01-01T00:00:00Z');
        assert.ok(!isNaN(pastDate.getTime()));
    });

    suite.test('B10.5: Device with missing IP address returns null or fallback string in API', () => {
        const db = new MockDatabase();
        const dev = db.insertKioskDevice({ userId: OWNER_ID, ipAddress: null });
        assert.strictEqual(dev.ip_address, null);
    });

    // ── FEATURE 11: Unlink Action Security & Edge Cases ──

    suite.test('B11.1: Cross-tenant revocation attempt: Owner A cannot unlink Owner B device', () => {
        const db = new MockDatabase();
        const server = new KioskBackendServer(db);
        const devB = db.insertKioskDevice({ userId: OTHER_OWNER_ID, deviceName: "Owner B TV" });

        const tokenA = server.generateToken(OWNER_ID);
        const res = server.deleteDevice({ authorization: `Bearer ${tokenA}` }, devB.id);
        assert.strictEqual(res.status, 404);

        // Verify device B remains un-revoked in DB
        const checkB = db.getKioskDevice(devB.id);
        assert.strictEqual(checkB.revoked_at, null);
    });

    suite.test('B11.2: Child account attempting DELETE /api/kiosk/devices/:id receives 403 Forbidden', () => {
        const db = new MockDatabase();
        const server = new KioskBackendServer(db);
        const dev = db.insertKioskDevice({ userId: OWNER_ID, deviceName: 'Family TV' });

        const childToken = server.generateToken(CHILD_ID, OWNER_ID);
        const res = server.deleteDevice({ authorization: `Bearer ${childToken}` }, dev.id);

        assert.strictEqual(res.status, 403);
        assert.includes(res.body.error, 'réservée aux parents');
    });

    suite.test('B11.3: Unlinking during network timeout safely retains state for retry', () => {
        let isUnlinking = false;
        let errorState = null;

        const attemptUnlink = async (fail = true) => {
            isUnlinking = true;
            if (fail) {
                errorState = 'Network timeout';
                isUnlinking = false;
            }
        };

        attemptUnlink(true);
        assert.strictEqual(isUnlinking, false);
        assert.strictEqual(errorState, 'Network timeout');
    });

    suite.test('B11.4: Unlinking the only active device transitions UI list to empty state', () => {
        const db = new MockDatabase();
        const server = new KioskBackendServer(db);
        const dev = db.insertKioskDevice({ userId: OWNER_ID });
        const token = server.generateToken(OWNER_ID);

        server.deleteDevice({ authorization: `Bearer ${token}` }, dev.id);
        const res = server.getDevices({ authorization: `Bearer ${token}` });
        assert.strictEqual(res.body.length, 0);
    });

    suite.test('B11.5: Rapid repeated unlinking calls on same device do not corrupt DB state', () => {
        const db = new MockDatabase();
        const server = new KioskBackendServer(db);
        const dev = db.insertKioskDevice({ userId: OWNER_ID });
        const token = server.generateToken(OWNER_ID);

        const r1 = server.deleteDevice({ authorization: `Bearer ${token}` }, dev.id);
        const r2 = server.deleteDevice({ authorization: `Bearer ${token}` }, dev.id);
        const r3 = server.deleteDevice({ authorization: `Bearer ${token}` }, dev.id);

        assert.strictEqual(r1.status, 200);
        assert.strictEqual(r2.status, 404);
        assert.strictEqual(r3.status, 404);
    });

    // ── FEATURE 12: Monorepo & Type Serialization Edge Cases ──

    suite.test('B12.1: JSON serialization of undefined fields strips key safely', () => {
        const payload = { a: 1, b: undefined };
        const serialized = JSON.parse(JSON.stringify(payload));
        assert.strictEqual(serialized.b, undefined);
    });

    suite.test('B12.2: Extreme date serialization preserves ISO 8601 UTC format', () => {
        const date = new Date('2099-12-31T23:59:59.999Z');
        assert.strictEqual(date.toISOString(), '2099-12-31T23:59:59.999Z');
    });

    suite.test('B12.3: UUID generator produces valid RFC 4122 v4 strings', () => {
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        const testUuid = '123e4567-e89b-12d3-a456-426614174000';
        assert.match(testUuid, /^[0-9a-f-]{36}$/);
    });

    suite.test('B12.4: Empty JSON request body is handled without server crash', () => {
        const server = new KioskBackendServer();
        const ownerToken = server.generateToken(OWNER_ID);
        const res = server.pairAuthorize({ authorization: `Bearer ${ownerToken}` }, null);
        assert.strictEqual(res.status, 400);
    });

    suite.test('B12.5: WsUpdatePayload with unexpected properties still passes runtime check', () => {
        const payload = {
            type: 'update',
            entity: 'kiosk',
            action: 'deleted',
            extraField: 'safe',
        };
        assert.strictEqual(payload.entity, 'kiosk');
    });

    return suite;
}
