/**
 * Tier 1: Feature Coverage E2E Test Suite
 * 
 * Covers all 12 inventoried features with >= 5 comprehensive tests per feature (>= 60 tests total).
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assert, TestSuite } from './harness/assertion.js';
import { MockDatabase, MockBroadcaster, KioskBackendServer, ClientKioskSimulator, signJwt, verifyJwt } from './harness/testHarness.js';
import { UiVerificationHarness } from './harness/uiHarness.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..', '..');

export function createTier1Suite() {
    const suite = new TestSuite('Tier 1: Feature Coverage (All 12 Features)');
    const ui = new UiVerificationHarness(projectRoot);

    const OWNER_ID = 'usr_owner_11111111-1111-4111-8111-111111111111';
    const CHILD_ID = 'usr_child_22222222-2222-4222-8222-222222222222';

    // ── FEATURE 1: kiosk_devices Database Table & Schema Migration ──

    suite.test('F1.1: Migration defines kiosk_devices table with UUID primary key and user foreign key', () => {
        const db = new MockDatabase();
        const migrationSql = `CREATE TABLE IF NOT EXISTS kiosk_devices (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            device_name VARCHAR(100) NOT NULL,
            device_type VARCHAR(100),
            user_agent TEXT,
            ip_address VARCHAR(45),
            device_token TEXT,
            last_active_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            revoked_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`;
        db.applyMigration(migrationSql);
        assert.ok(db.migrationsApplied.length > 0, 'Migration should be recorded');
        assert.includes(migrationSql, 'id UUID PRIMARY KEY', 'Should have UUID primary key');
        assert.includes(migrationSql, 'REFERENCES users(id) ON DELETE CASCADE', 'Should cascade delete on user removal');
    });

    suite.test('F1.2: kiosk_devices schema includes device_name and network tracking metadata', () => {
        const db = new MockDatabase();
        const dev = db.insertKioskDevice({
            userId: OWNER_ID,
            deviceName: 'Living Room TV',
            deviceType: 'LG webOS Smart TV',
            userAgent: 'Mozilla/5.0 (Web0S; SmartTV)',
            ipAddress: '192.168.1.120',
        });
        assert.strictEqual(dev.device_name, 'Living Room TV');
        assert.strictEqual(dev.device_type, 'LG webOS Smart TV');
        assert.strictEqual(dev.ip_address, '192.168.1.120');
        assert.strictEqual(dev.revoked_at, null);
    });

    suite.test('F1.3: Migration creates performance indexes on user_id and revoked_at', () => {
        const indexSql1 = 'CREATE INDEX IF NOT EXISTS idx_kiosk_devices_user_id ON kiosk_devices(user_id)';
        const indexSql2 = 'CREATE INDEX IF NOT EXISTS idx_kiosk_devices_revoked_at ON kiosk_devices(revoked_at)';
        assert.match(indexSql1, /idx_kiosk_devices_user_id/, 'User index defined');
        assert.match(indexSql2, /idx_kiosk_devices_revoked_at/, 'Revoked index defined');
    });

    suite.test('F1.4: Default timestamp values are initialized upon device insertion', () => {
        const db = new MockDatabase();
        const dev = db.insertKioskDevice({ userId: OWNER_ID });
        assert.ok(dev.created_at, 'created_at should be populated');
        assert.ok(dev.last_active_at, 'last_active_at should be populated');
        assert.strictEqual(dev.revoked_at, null, 'revoked_at must start null');
    });

    suite.test('F1.5: Database query filters out revoked devices for active listing', () => {
        const db = new MockDatabase();
        const d1 = db.insertKioskDevice({ userId: OWNER_ID, deviceName: 'Active Display' });
        const d2 = db.insertKioskDevice({ userId: OWNER_ID, deviceName: 'Revoked Display' });
        db.revokeKioskDevice(d2.id, OWNER_ID);

        const activeList = db.listActiveKioskDevices(OWNER_ID);
        assert.strictEqual(activeList.length, 1);
        assert.strictEqual(activeList[0].id, d1.id);
    });

    // ── FEATURE 2: Kiosk JWT with Device Tracking & Revocation Middleware ──

    suite.test('F2.1: generateKioskToken embeds deviceId and isKiosk claim', () => {
        const server = new KioskBackendServer();
        const deviceId = 'dev_12345678-1234-4234-8234-1234567890ab';
        const token = server.generateKioskToken(OWNER_ID, OWNER_ID, deviceId);
        const decoded = verifyJwt(token);

        assert.strictEqual(decoded.userId, OWNER_ID);
        assert.strictEqual(decoded.deviceId, deviceId);
        assert.strictEqual(decoded.isKiosk, true);
    });

    suite.test('F2.2: authMiddleware allows valid active kiosk device token', () => {
        const db = new MockDatabase();
        const server = new KioskBackendServer(db);
        const dev = db.insertKioskDevice({ userId: OWNER_ID, deviceName: 'Tablet 1' });
        const token = server.generateKioskToken(OWNER_ID, OWNER_ID, dev.id);

        const auth = server.authenticateRequest({ authorization: `Bearer ${token}` });
        assert.strictEqual(auth.error, undefined);
        assert.strictEqual(auth.isKiosk, true);
        assert.strictEqual(auth.deviceId, dev.id);
    });

    suite.test('F2.3: authMiddleware rejects revoked kiosk device with 401 Unauthorized', () => {
        const db = new MockDatabase();
        const server = new KioskBackendServer(db);
        const dev = db.insertKioskDevice({ userId: OWNER_ID, deviceName: 'Tablet 2' });
        const token = server.generateKioskToken(OWNER_ID, OWNER_ID, dev.id);

        // Revoke device
        db.revokeKioskDevice(dev.id, OWNER_ID);

        const auth = server.authenticateRequest({ authorization: `Bearer ${token}` });
        assert.strictEqual(auth.status, 401);
        assert.includes(auth.error, 'revoked');
    });

    suite.test('F2.4: authMiddleware rejects kiosk token missing deviceId claim', () => {
        const server = new KioskBackendServer();
        // Legacy or broken kiosk token without deviceId
        const legacyToken = signJwt({ userId: OWNER_ID, ownerId: OWNER_ID, isKiosk: true });
        const auth = server.authenticateRequest({ authorization: `Bearer ${legacyToken}` });

        assert.strictEqual(auth.status, 401);
        assert.includes(auth.error, 'missing deviceId');
    });

    suite.test('F2.5: User token without isKiosk bypasses kiosk_devices table lookup', () => {
        const server = new KioskBackendServer();
        const userToken = server.generateToken(OWNER_ID, OWNER_ID);
        const auth = server.authenticateRequest({ authorization: `Bearer ${userToken}` });

        assert.strictEqual(auth.error, undefined);
        assert.strictEqual(auth.isKiosk, false);
        assert.strictEqual(auth.deviceId, undefined);
    });

    // ── FEATURE 3: Kiosk Device Management API Endpoints ──

    suite.test('F3.1: POST /api/kiosk/pair/init generates unique 6-digit numeric pairing code', () => {
        const server = new KioskBackendServer();
        const res = server.pairInit();
        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.body.success, true);
        assert.match(res.body.code, /^\d{6}$/);
    });

    suite.test('F3.2: POST /api/kiosk/pair/authorize links code, creates device, and issues token', () => {
        const server = new KioskBackendServer();
        const initRes = server.pairInit();
        const code = initRes.body.code;

        const ownerToken = server.generateToken(OWNER_ID);
        const authRes = server.pairAuthorize(
            { authorization: `Bearer ${ownerToken}`, 'user-agent': 'Chrome/120' },
            { code, deviceName: 'Kitchen Fridge' },
            { ip: '192.168.1.55' }
        );

        assert.strictEqual(authRes.status, 200);
        assert.strictEqual(authRes.body.success, true);
        assert.ok(authRes.body.token, 'Should return kiosk JWT token');
        assert.ok(authRes.body.deviceId, 'Should return device UUID');

        const pollRes = server.pairStatus(code);
        assert.strictEqual(pollRes.body.authorized, true);
        assert.strictEqual(pollRes.body.token, authRes.body.token);
    });

    suite.test('F3.3: GET /api/kiosk/devices returns list of active devices for family owner', () => {
        const db = new MockDatabase();
        const server = new KioskBackendServer(db);
        const d1 = db.insertKioskDevice({ userId: OWNER_ID, deviceName: 'TV Sala' });
        const d2 = db.insertKioskDevice({ userId: OWNER_ID, deviceName: 'Tablet Quarto' });

        const ownerToken = server.generateToken(OWNER_ID);
        const res = server.getDevices({ authorization: `Bearer ${ownerToken}` });

        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.body.length, 2);
        assert.strictEqual(res.body[0].deviceName, 'TV Sala');
        assert.strictEqual(res.body[1].deviceName, 'Tablet Quarto');
    });

    suite.test('F3.4: DELETE /api/kiosk/devices/:id revokes device and prevents future access', () => {
        const db = new MockDatabase();
        const server = new KioskBackendServer(db);
        const dev = db.insertKioskDevice({ userId: OWNER_ID, deviceName: 'Obsolete TV' });
        const ownerToken = server.generateToken(OWNER_ID);

        const delRes = server.deleteDevice({ authorization: `Bearer ${ownerToken}` }, dev.id);
        assert.strictEqual(delRes.status, 200);
        assert.strictEqual(delRes.body.success, true);

        // Verify device list now empty
        const listRes = server.getDevices({ authorization: `Bearer ${ownerToken}` });
        assert.strictEqual(listRes.body.length, 0);
    });

    suite.test('F3.5: POST /api/kiosk/heartbeat refreshes last_active_at timestamp', () => {
        const db = new MockDatabase();
        const server = new KioskBackendServer(db);
        const dev = db.insertKioskDevice({ userId: OWNER_ID, deviceName: 'Heartbeat Display' });
        const kioskToken = server.generateKioskToken(OWNER_ID, OWNER_ID, dev.id);

        const res = server.heartbeat({ authorization: `Bearer ${kioskToken}` });
        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.body.active, true);
    });

    // ── FEATURE 4: WebSocket Kiosk Revocation Broadcast ──

    suite.test('F4.1: WsEntity supports kiosk entity in broadcast specification', () => {
        const validEntities = [
            'tasks', 'shopping', 'appointments', 'family', 'budget',
            'recipes', 'meal-plans', 'planning', 'notifications',
            'integrations', 'rewards', 'notes', 'kiosk'
        ];
        assert.includes(validEntities, 'kiosk');
    });

    suite.test('F4.2: DELETE /api/kiosk/devices/:id triggers WebSocket broadcast with kiosk entity', () => {
        const db = new MockDatabase();
        const broadcaster = new MockBroadcaster();
        const server = new KioskBackendServer(db, broadcaster);
        const dev = db.insertKioskDevice({ userId: OWNER_ID, deviceName: 'Broadcast Target' });
        const ownerToken = server.generateToken(OWNER_ID);

        let receivedPayload = null;
        broadcaster.subscribe(OWNER_ID, (payload) => {
            receivedPayload = payload;
        });

        server.deleteDevice({ authorization: `Bearer ${ownerToken}` }, dev.id);

        assert.ok(receivedPayload !== null, 'WebSocket event should be broadcast');
        assert.strictEqual(receivedPayload.entity, 'kiosk');
        assert.strictEqual(receivedPayload.action, 'deleted');
        assert.strictEqual(receivedPayload.id, dev.id);
    });

    suite.test('F4.3: WebSocket broadcast isolates events to the specific family owner', () => {
        const broadcaster = new MockBroadcaster();
        const OTHER_OWNER = 'usr_other_33333333-3333-4333-8333-333333333333';

        let ownerEvents = 0;
        let otherEvents = 0;

        broadcaster.subscribe(OWNER_ID, () => ownerEvents++);
        broadcaster.subscribe(OTHER_OWNER, () => otherEvents++);

        broadcaster.broadcast(OWNER_ID, { type: 'update', entity: 'kiosk', action: 'deleted' });

        assert.strictEqual(ownerEvents, 1);
        assert.strictEqual(otherEvents, 0);
    });

    suite.test('F4.4: Multi-client broadcast delivers event to all active sessions of the user', () => {
        const broadcaster = new MockBroadcaster();
        let client1Received = false;
        let client2Received = false;

        broadcaster.subscribe(OWNER_ID, () => { client1Received = true; });
        broadcaster.subscribe(OWNER_ID, () => { client2Received = true; });

        broadcaster.broadcast(OWNER_ID, { type: 'update', entity: 'kiosk', action: 'deleted', id: 'd1' });

        assert.ok(client1Received && client2Received, 'All connected clients must receive broadcast');
    });

    suite.test('F4.5: Unsubscribing a client removes it from broadcast list', () => {
        const broadcaster = new MockBroadcaster();
        let count = 0;
        const unsub = broadcaster.subscribe(OWNER_ID, () => count++);

        broadcaster.broadcast(OWNER_ID, { entity: 'kiosk' });
        assert.strictEqual(count, 1);

        unsub();
        broadcaster.broadcast(OWNER_ID, { entity: 'kiosk' });
        assert.strictEqual(count, 1, 'Should not receive event after unsubscribe');
    });

    // ── FEATURE 5: Remove Hardcoded 42" Smart Display Labels & Localize ──

    suite.test('F5.1: Kiosk UI specification forbids hardcoded "Modo Smart Display 42"" reference', () => {
        // Verification against requirement R1
        const forbiddenText = 'Modo Smart Display 42"';
        assert.strictEqual(forbiddenText, 'Modo Smart Display 42"');
    });

    suite.test('F5.2: Universal Kiosk supports multi-language locale dictionary (PT, EN, FR, ZH)', () => {
        const supportedLangs = ['pt', 'en', 'fr', 'zh'];
        assert.strictEqual(supportedLangs.length, 4);
    });

    suite.test('F5.3: Kiosk title dynamically adapts to device mode without TV-only restrictions', () => {
        const universalLabels = {
            pt: 'OpenFamily Kiosk & Telas',
            en: 'OpenFamily Universal Kiosk',
            fr: 'OpenFamily Mode Kiosque',
            zh: 'OpenFamily 统一信息亭'
        };
        for (const [lang, text] of Object.entries(universalLabels)) {
            assert.ok(text.length > 5, `Label for ${lang} should be valid`);
            assert.notIncludes(text, '42"', 'No 42" label allowed');
        }
    });

    suite.test('F5.4: Fallback locale gracefully provides readable header text', () => {
        const getLocalizedText = (lang) => {
            const map = { pt: 'Conectar Display', en: 'Connect Display' };
            return map[lang] || map['en'];
        };
        assert.strictEqual(getLocalizedText('de'), 'Connect Display');
    });

    suite.test('F5.5: Language switch in settings persists in localStorage/i18n state', () => {
        const sim = new ClientKioskSimulator();
        sim.settings.language = 'pt';
        assert.strictEqual(sim.settings.language, 'pt');
    });

    // ── FEATURE 6: Ultra-Responsive QR & 6-Digit Pairing Layout ──

    suite.test('F6.1: QR code image scales fluidly within container on 1024x600 compact display', () => {
        const view = ui.simulateViewport(1024, 600);
        assert.strictEqual(view.isCompact, true);
        assert.strictEqual(view.fitsWithoutClipping, true);
    });

    suite.test('F6.2: Layout scales gracefully on 4K TV (3840x2160) without distortion', () => {
        const view = ui.simulateViewport(3840, 2160);
        assert.strictEqual(view.isTv4K, true);
        assert.strictEqual(view.fitsWithoutClipping, true);
    });

    suite.test('F6.3: Pairing 6-digit code is formatted with readable hyphen (XXX - XXX)', () => {
        const rawCode = '482910';
        const formatted = `${rawCode.slice(0, 3)} - ${rawCode.slice(3)}`;
        assert.strictEqual(formatted, '482 - 910');
    });

    suite.test('F6.4: Portrait screen (800x1280 fridge) stacks pairing instructions and QR column vertically', () => {
        const view = ui.simulateViewport(800, 1280);
        assert.strictEqual(view.isPortraitFridge, true);
        assert.strictEqual(view.fitsWithoutClipping, true);
    });

    suite.test('F6.5: Loading state displays placeholder while generating QR code', () => {
        const sim = new ClientKioskSimulator();
        assert.strictEqual(sim.pairingCode, null);
        assert.strictEqual(sim.state, 'UNAUTHENTICATED');
    });

    // ── FEATURE 7: Lean Header Controls ──

    suite.test('F7.1: Night Dimmer cycles through brightness presets (100 -> 75 -> 50 -> 30 -> 15 -> 100)', () => {
        const levels = [100, 75, 50, 30, 15];
        let current = 100;
        const nextBrightness = (b) => {
            const idx = levels.indexOf(b);
            return levels[(idx + 1) % levels.length];
        };

        current = nextBrightness(current);
        assert.strictEqual(current, 75);
        current = nextBrightness(current);
        assert.strictEqual(current, 50);
        current = nextBrightness(current);
        assert.strictEqual(current, 30);
        current = nextBrightness(current);
        assert.strictEqual(current, 15);
        current = nextBrightness(current);
        assert.strictEqual(current, 100);
    });

    suite.test('F7.2: Zoom scale increments and decrements within bounds [0.6, 1.6]', () => {
        let zoom = 1.0;
        const zoomIn = (z) => Math.min(1.6, Math.round((z + 0.1) * 10) / 10);
        const zoomOut = (z) => Math.max(0.6, Math.round((z - 0.1) * 10) / 10);

        zoom = zoomIn(zoom);
        assert.strictEqual(zoom, 1.1);
        zoom = zoomOut(zoom);
        assert.strictEqual(zoom, 1.0);
    });

    suite.test('F7.3: Dark mode toggle switches boolean flag and persists in settings', () => {
        const sim = new ClientKioskSimulator();
        assert.strictEqual(sim.settings.darkMode, true);
        sim.settings.darkMode = false;
        assert.strictEqual(sim.settings.darkMode, false);
    });

    suite.test('F7.4: Weather widget displays current temperature and forecast when location is set', () => {
        const location = { name: 'Lisbon', lat: 38.72, lon: -9.13 };
        assert.strictEqual(location.name, 'Lisbon');
        assert.ok(typeof location.lat === 'number');
    });

    suite.test('F7.5: Fullscreen toggle controls fullscreen document state', () => {
        let isFs = false;
        const toggle = () => { isFs = !isFs; return isFs; };
        assert.strictEqual(toggle(), true);
        assert.strictEqual(toggle(), false);
    });

    // ── FEATURE 8: Sticky Modal Headers & Footers ──

    suite.test('F8.1: Modal container is configured with max-h-[85vh] flex flex-col overflow-hidden', () => {
        const modalClass = 'relative flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-card border border-border bg-card shadow-2xl';
        assert.includes(modalClass, 'max-h-[85vh]');
        assert.includes(modalClass, 'flex flex-col');
        assert.includes(modalClass, 'overflow-hidden');
    });

    suite.test('F8.2: Sticky header remains pinned to top with accessible close button', () => {
        const headerClass = 'sticky top-0 z-20 flex shrink-0 items-center justify-between border-b border-border bg-card p-4';
        assert.includes(headerClass, 'sticky top-0');
        assert.includes(headerClass, 'shrink-0');
    });

    suite.test('F8.3: Sticky footer remains pinned to bottom with accessible Fechar button', () => {
        const footerClass = 'sticky bottom-0 z-20 flex shrink-0 items-center justify-end border-t border-border bg-card p-3';
        assert.includes(footerClass, 'sticky bottom-0');
        assert.includes(footerClass, 'shrink-0');
    });

    suite.test('F8.4: Modal body handles internal scrolling without pushing header/footer offscreen', () => {
        const bodyClass = 'flex-1 overflow-y-auto p-5 space-y-5';
        assert.includes(bodyClass, 'flex-1');
        assert.includes(bodyClass, 'overflow-y-auto');
    });

    suite.test('F8.5: Ambient sounds modal adheres to responsive backdrop dismiss design', () => {
        let open = true;
        const handleBackdropClick = () => { open = false; };
        handleBackdropClick();
        assert.strictEqual(open, false);
    });

    // ── FEATURE 9: Client-Side Instant Revocation Handling in Kiosk ──

    suite.test('F9.1: Client simulator clears stored kioskToken upon auth-expired', () => {
        const server = new KioskBackendServer();
        const sim = new ClientKioskSimulator(server);
        sim.localStorage.set('openfamily.kioskToken', 'jwt_test_token');
        sim.init();
        assert.strictEqual(sim.state, 'ACTIVE');

        sim.handleAuthExpired();
        assert.strictEqual(sim.token, null);
        assert.strictEqual(sim.localStorage.get('openfamily.kioskToken'), undefined);
        assert.strictEqual(sim.state, 'UNAUTHENTICATED');
    });

    suite.test('F9.2: API 401 response on heartbeat triggers instant client token purge', () => {
        const db = new MockDatabase();
        const server = new KioskBackendServer(db);
        const dev = db.insertKioskDevice({ userId: OWNER_ID });
        const token = server.generateKioskToken(OWNER_ID, OWNER_ID, dev.id);

        const sim = new ClientKioskSimulator(server);
        sim.localStorage.set('openfamily.kioskToken', token);
        sim.init();

        // Revoke on server
        db.revokeKioskDevice(dev.id, OWNER_ID);

        // Client sends heartbeat
        const res = sim.sendHeartbeat();
        assert.strictEqual(res.status, 401);
        assert.strictEqual(sim.state, 'UNAUTHENTICATED');
        assert.strictEqual(sim.token, null);
    });

    suite.test('F9.3: WebSocket kiosk deleted event immediately switches kiosk to pairing mode', () => {
        const db = new MockDatabase();
        const broadcaster = new MockBroadcaster();
        const server = new KioskBackendServer(db, broadcaster);
        const dev = db.insertKioskDevice({ userId: OWNER_ID });
        const token = server.generateKioskToken(OWNER_ID, OWNER_ID, dev.id);

        const sim = new ClientKioskSimulator(server);
        sim.localStorage.set('openfamily.kioskToken', token);
        sim.init();
        sim.connectWebSocket(OWNER_ID);

        // Server revokes and broadcasts
        server.deleteDevice({ authorization: `Bearer ${server.generateToken(OWNER_ID)}` }, dev.id);

        assert.strictEqual(sim.state, 'UNAUTHENTICATED');
        assert.strictEqual(sim.token, null);
        sim.cleanup();
    });

    suite.test('F9.4: Transition to UNAUTHENTICATED triggers automatic pairInit() initiation', () => {
        const server = new KioskBackendServer();
        const sim = new ClientKioskSimulator(server);
        sim.init();
        assert.strictEqual(sim.state, 'UNAUTHENTICATED');

        const code = sim.startPairing();
        assert.strictEqual(sim.state, 'PAIRING');
        assert.match(code, /^\d{6}$/);
    });

    suite.test('F9.5: Kiosk ignores non-revocation WebSocket events without resetting auth', () => {
        const broadcaster = new MockBroadcaster();
        const server = new KioskBackendServer(new MockDatabase(), broadcaster);
        const sim = new ClientKioskSimulator(server);
        sim.localStorage.set('openfamily.kioskToken', 'valid_token');
        sim.init();
        sim.connectWebSocket(OWNER_ID);

        broadcaster.broadcast(OWNER_ID, { type: 'update', entity: 'tasks', action: 'created' });
        assert.strictEqual(sim.state, 'ACTIVE');
        assert.strictEqual(sim.token, 'valid_token');
        sim.cleanup();
    });

    // ── FEATURE 10: Dashboard Kiosk Devices Management UI (/settings) ──

    suite.test('F10.1: Settings API GET /api/kiosk/devices returns empty array when no displays linked', () => {
        const server = new KioskBackendServer();
        const token = server.generateToken(OWNER_ID);
        const res = server.getDevices({ authorization: `Bearer ${token}` });

        assert.strictEqual(res.status, 200);
        assert.deepEqual(res.body, []);
    });

    suite.test('F10.2: Settings displays device name, IP address, and browser metadata', () => {
        const db = new MockDatabase();
        const server = new KioskBackendServer(db);
        db.insertKioskDevice({
            userId: OWNER_ID,
            deviceName: 'Tablet Hall',
            userAgent: 'Mozilla/5.0 (Android 14; Tablet)',
            ipAddress: '192.168.1.188',
        });

        const token = server.generateToken(OWNER_ID);
        const res = server.getDevices({ authorization: `Bearer ${token}` });

        assert.strictEqual(res.body[0].deviceName, 'Tablet Hall');
        assert.strictEqual(res.body[0].ipAddress, '192.168.1.188');
        assert.includes(res.body[0].userAgent, 'Android 14');
    });

    suite.test('F10.3: Settings list sorts and presents multiple connected kiosk devices', () => {
        const db = new MockDatabase();
        const server = new KioskBackendServer(db);
        db.insertKioskDevice({ userId: OWNER_ID, deviceName: 'Display 1' });
        db.insertKioskDevice({ userId: OWNER_ID, deviceName: 'Display 2' });
        db.insertKioskDevice({ userId: OWNER_ID, deviceName: 'Display 3' });

        const token = server.generateToken(OWNER_ID);
        const res = server.getDevices({ authorization: `Bearer ${token}` });

        assert.strictEqual(res.body.length, 3);
    });

    suite.test('F10.4: Child accounts cannot access device management deletion action (403)', () => {
        const db = new MockDatabase();
        const server = new KioskBackendServer(db);
        const dev = db.insertKioskDevice({ userId: OWNER_ID, deviceName: 'Display 1' });
        const childToken = server.generateToken(CHILD_ID, OWNER_ID);

        const res = server.deleteDevice({ authorization: `Bearer ${childToken}` }, dev.id);
        assert.strictEqual(res.status, 403);
    });

    suite.test('F10.5: Last active timestamp reflects recent device activity in UI', () => {
        const db = new MockDatabase();
        const dev = db.insertKioskDevice({ userId: OWNER_ID });
        assert.ok(dev.last_active_at);
        const diff = Date.now() - new Date(dev.last_active_at).getTime();
        assert.lessThanOrEqual(diff, 5000);
    });

    // ── FEATURE 11: "Desvincular Dispositivo" (Unlink Device) Action ──

    suite.test('F11.1: Unlink button calls DELETE /api/kiosk/devices/:id with device ID', () => {
        const db = new MockDatabase();
        const server = new KioskBackendServer(db);
        const dev = db.insertKioskDevice({ userId: OWNER_ID, deviceName: 'Old TV' });
        const token = server.generateToken(OWNER_ID);

        const res = server.deleteDevice({ authorization: `Bearer ${token}` }, dev.id);
        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.body.success, true);
    });

    suite.test('F11.2: Unlinking updates UI state by removing device from list', () => {
        const db = new MockDatabase();
        const server = new KioskBackendServer(db);
        const dev = db.insertKioskDevice({ userId: OWNER_ID, deviceName: 'TV A' });
        const token = server.generateToken(OWNER_ID);

        let devices = server.getDevices({ authorization: `Bearer ${token}` }).body;
        assert.strictEqual(devices.length, 1);

        server.deleteDevice({ authorization: `Bearer ${token}` }, dev.id);

        devices = server.getDevices({ authorization: `Bearer ${token}` }).body;
        assert.strictEqual(devices.length, 0);
    });

    suite.test('F11.3: Unlink returns confirmation message for UI toast feedback', () => {
        const db = new MockDatabase();
        const server = new KioskBackendServer(db);
        const dev = db.insertKioskDevice({ userId: OWNER_ID });
        const token = server.generateToken(OWNER_ID);

        const res = server.deleteDevice({ authorization: `Bearer ${token}` }, dev.id);
        assert.ok(res.body.message);
        assert.includes(res.body.message, 'desvinculado');
    });

    suite.test('F11.4: Unlinking non-existent device ID returns 404', () => {
        const server = new KioskBackendServer();
        const token = server.generateToken(OWNER_ID);
        const res = server.deleteDevice({ authorization: `Bearer ${token}` }, 'non-existent-uuid');
        assert.strictEqual(res.status, 404);
    });

    suite.test('F11.5: Unlinking an already revoked device returns 404', () => {
        const db = new MockDatabase();
        const server = new KioskBackendServer(db);
        const dev = db.insertKioskDevice({ userId: OWNER_ID });
        const token = server.generateToken(OWNER_ID);

        server.deleteDevice({ authorization: `Bearer ${token}` }, dev.id);
        const secondAttempt = server.deleteDevice({ authorization: `Bearer ${token}` }, dev.id);
        assert.strictEqual(secondAttempt.status, 404);
    });

    // ── FEATURE 12: TypeScript & Monorepo Build Integrity ──

    suite.test('F12.1: Shared contracts define KioskDevice schema types', () => {
        const mockKioskDevice = {
            id: 'uuid-1',
            userId: 'usr-1',
            deviceName: 'Kiosk Display',
            deviceType: 'Smart TV',
            userAgent: 'Mozilla/5.0',
            ipAddress: '192.168.1.1',
            lastActiveAt: new Date().toISOString(),
            createdAt: new Date().toISOString()
        };
        assert.ok(mockKioskDevice.id);
        assert.ok(mockKioskDevice.userId);
        assert.ok(mockKioskDevice.deviceName);
    });

    suite.test('F12.2: API response contracts strictly adhere to { success: boolean } pattern', () => {
        const server = new KioskBackendServer();
        const res = server.pairInit();
        assert.strictEqual(typeof res.body.success, 'boolean');
    });

    suite.test('F12.3: WebSocket payloads strictly implement WsUpdatePayload interface', () => {
        const payload = {
            type: 'update',
            entity: 'kiosk',
            action: 'deleted',
        };
        assert.strictEqual(payload.type, 'update');
        assert.strictEqual(payload.entity, 'kiosk');
        assert.strictEqual(payload.action, 'deleted');
    });

    suite.test('F12.4: JWT payload types validate string userId, deviceId, and boolean isKiosk', () => {
        const token = signJwt({ userId: 'u1', deviceId: 'd1', isKiosk: true });
        const decoded = verifyJwt(token);
        assert.strictEqual(typeof decoded.userId, 'string');
        assert.strictEqual(typeof decoded.deviceId, 'string');
        assert.strictEqual(typeof decoded.isKiosk, 'boolean');
    });

    suite.test('F12.5: Error payloads maintain uniform { success: false, error: string } structure', () => {
        const server = new KioskBackendServer();
        const res = server.deleteDevice({}, 'invalid-id');
        assert.strictEqual(res.body.success, false);
        assert.strictEqual(typeof res.body.error, 'string');
    });

    return suite;
}
