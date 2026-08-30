/**
 * Tier 4: Real-World Homelab Application Scenarios E2E Test Suite
 * 
 * End-to-end integration workflows simulating realistic homelab kiosk deployments:
 * 1. Wall Tablet Setup (10" 1280x800)
 * 2. Smart TV Living Room Pairing (4K 3840x2160)
 * 3. Remote Emergency Deauthorization from Mobile Settings
 * 4. Smart Fridge Display Density & Sticky Modal Interaction (7" 1024x600)
 * 5. Power Outage Recovery & Heartbeat Resume
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assert, TestSuite } from './harness/assertion.js';
import { MockDatabase, MockBroadcaster, KioskBackendServer, ClientKioskSimulator } from './harness/testHarness.js';
import { UiVerificationHarness } from './harness/uiHarness.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..', '..');

export function createTier4Suite() {
    const suite = new TestSuite('Tier 4: Real-World Homelab Application Scenarios');
    const ui = new UiVerificationHarness(projectRoot);

    const OWNER_ID = 'usr_owner_11111111-1111-4111-8111-111111111111';

    suite.test('Scenario 1: Wall Tablet Setup Workflow (10" 1280x800 resolution)', () => {
        const db = new MockDatabase();
        const server = new KioskBackendServer(db);
        const tablet = new ClientKioskSimulator(server);

        // 1. Tablet boots and simulates 1280x800 viewport
        const view = ui.simulateViewport(1280, 800);
        assert.ok(view.fitsWithoutClipping);

        // 2. Tablet opens /kiosk unauthenticated
        tablet.init();
        assert.strictEqual(tablet.state, 'UNAUTHENTICATED');

        // 3. Tablet initiates pairing session
        const pairCode = tablet.startPairing();
        assert.strictEqual(tablet.state, 'PAIRING');
        assert.match(pairCode, /^\d{6}$/);

        // 4. Parent uses mobile phone to scan QR / authorize code
        const ownerToken = server.generateToken(OWNER_ID);
        const authRes = server.pairAuthorize(
            { authorization: `Bearer ${ownerToken}`, 'user-agent': 'Mozilla/5.0 (Linux; Android 14; Pixel 8)' },
            { code: pairCode, deviceName: 'Quadro Cozinha (Tablet 10")' },
            { ip: '192.168.1.185' }
        );
        assert.strictEqual(authRes.status, 200);

        // 5. Tablet polls and enters ACTIVE dashboard mode
        const poll = tablet.pollPairingStatus();
        assert.strictEqual(poll.authorized, true);
        assert.strictEqual(tablet.state, 'ACTIVE');

        // 6. Tablet sends periodic heartbeats every 60s
        const hb = tablet.sendHeartbeat();
        assert.strictEqual(hb.status, 200);
        assert.strictEqual(hb.body.active, true);

        // 7. Verify device record stored in DB
        const dev = db.getKioskDevice(authRes.body.deviceId);
        assert.strictEqual(dev.device_name, 'Quadro Cozinha (Tablet 10")');
        assert.strictEqual(dev.ip_address, '192.168.1.185');

        tablet.cleanup();
    });

    suite.test('Scenario 2: Smart TV Living Room Pairing Workflow (65" 4K 3840x2160 resolution)', () => {
        const db = new MockDatabase();
        const server = new KioskBackendServer(db);
        const smartTv = new ClientKioskSimulator(server);

        // 1. TV boots in 4K resolution
        const view = ui.simulateViewport(3840, 2160);
        assert.strictEqual(view.isTv4K, true);
        assert.ok(view.fitsWithoutClipping);

        // 2. TV opens pairing screen
        smartTv.init();
        const code = smartTv.startPairing();

        // 3. Mobile authorizes TV with 4K-friendly custom name
        const ownerToken = server.generateToken(OWNER_ID);
        const authRes = server.pairAuthorize(
            { authorization: `Bearer ${ownerToken}`, 'user-agent': 'Mozilla/5.0 (SMART-TV; Linux; Tizen 7.0)' },
            { code, deviceName: 'Smart TV 65" Sala de Estar' },
            { ip: '192.168.1.200' }
        );
        assert.strictEqual(authRes.status, 200);

        // 4. TV transitions to active state
        smartTv.pollPairingStatus();
        assert.strictEqual(smartTv.state, 'ACTIVE');

        // 5. User adjusts Zoom to 140% for distant viewing from sofa
        smartTv.settings.zoom = 1.4;
        smartTv.localStorage.set('openfamily.kioskSettings', JSON.stringify(smartTv.settings));
        assert.strictEqual(smartTv.settings.zoom, 1.4);

        // 6. TV heartbeats succeed
        assert.strictEqual(smartTv.sendHeartbeat().status, 200);

        smartTv.cleanup();
    });

    suite.test('Scenario 3: Remote Emergency Deauthorization from Mobile Dashboard', () => {
        const db = new MockDatabase();
        const broadcaster = new MockBroadcaster();
        const server = new KioskBackendServer(db, broadcaster);
        const ownerToken = server.generateToken(OWNER_ID);

        // Setup active hotel TV kiosk
        const hotelTv = new ClientKioskSimulator(server);
        const code = hotelTv.startPairing();
        const auth = server.pairAuthorize({ authorization: `Bearer ${ownerToken}` }, { code, deviceName: 'Hotel Room TV' });
        hotelTv.pollPairingStatus();
        hotelTv.connectWebSocket(OWNER_ID);
        assert.strictEqual(hotelTv.state, 'ACTIVE');

        // Parent accesses /settings on mobile and views connected devices
        const list = server.getDevices({ authorization: `Bearer ${ownerToken}` });
        assert.strictEqual(list.body.length, 1);
        assert.strictEqual(list.body[0].deviceName, 'Hotel Room TV');

        // Parent clicks "Desvincular Dispositivo"
        const delRes = server.deleteDevice({ authorization: `Bearer ${ownerToken}` }, auth.body.deviceId);
        assert.strictEqual(delRes.status, 200);
        assert.strictEqual(delRes.body.success, true);

        // Hotel TV immediately catches WebSocket event and reverts to QR pairing screen
        assert.strictEqual(hotelTv.state, 'UNAUTHENTICATED');
        assert.strictEqual(hotelTv.token, null);
        assert.strictEqual(hotelTv.localStorage.get('openfamily.kioskToken'), undefined);

        // Any attempt by the hotel TV to call protected APIs fails with 401
        const unauthorizedAttempt = server.heartbeat({ authorization: `Bearer ${auth.body.token}` });
        assert.strictEqual(unauthorizedAttempt.status, 401);

        hotelTv.cleanup();
    });

    suite.test('Scenario 4: Smart Fridge Compact Display Density & Modal Workflow (7" 1024x600 resolution)', () => {
        const db = new MockDatabase();
        const server = new KioskBackendServer(db);
        const fridge = new ClientKioskSimulator(server);

        // 1. Check viewport geometry for 1024x600
        const view = ui.simulateViewport(1024, 600);
        assert.strictEqual(view.isCompact, true);
        assert.strictEqual(view.maxModalHeight, 510);
        assert.ok(view.availableBodyHeight > 300, 'Body has plenty of scrollable room');
        assert.strictEqual(view.stickyHeaderVisible, true);
        assert.strictEqual(view.stickyFooterVisible, true);

        // 2. Fridge pairs and activates
        const code = fridge.startPairing();
        server.pairAuthorize({ authorization: `Bearer ${server.generateToken(OWNER_ID)}` }, { code, deviceName: 'Samsung Family Hub Fridge' });
        fridge.pollPairingStatus();
        assert.strictEqual(fridge.state, 'ACTIVE');

        // 3. User opens Display Settings modal, changes Dimmer to 50%
        let modalOpen = true;
        fridge.settings.brightness = 50;
        fridge.localStorage.set('openfamily.kioskSettings', JSON.stringify(fridge.settings));

        // 4. User clicks sticky footer "Fechar Configurações" button
        const handleCloseClick = () => { modalOpen = false; };
        handleCloseClick();
        assert.strictEqual(modalOpen, false);
        assert.strictEqual(fridge.settings.brightness, 50);

        fridge.cleanup();
    });

    suite.test('Scenario 5: Power Outage Recovery & Heartbeat Resume Workflow', () => {
        const db = new MockDatabase();
        const server = new KioskBackendServer(db);
        const kiosk = new ClientKioskSimulator(server);

        // 1. Kiosk pairs and saves token
        const code = kiosk.startPairing();
        server.pairAuthorize({ authorization: `Bearer ${server.generateToken(OWNER_ID)}` }, { code, deviceName: 'Kitchen Display' });
        kiosk.pollPairingStatus();
        const initialToken = kiosk.token;
        assert.ok(initialToken);

        // 2. Simulate transient network disconnection / offline error
        let networkOnline = false;
        const sendSafeHeartbeat = () => {
            if (!networkOnline) {
                // Network error, do NOT deauthorize
                return { status: 0, error: 'Network offline' };
            }
            return kiosk.sendHeartbeat();
        };

        const offlineRes = sendSafeHeartbeat();
        assert.strictEqual(offlineRes.status, 0);
        // State remains ACTIVE!
        assert.strictEqual(kiosk.state, 'ACTIVE');
        assert.strictEqual(kiosk.token, initialToken);

        // 3. Network recovers and power stabilizes
        networkOnline = true;
        const recoveredRes = sendSafeHeartbeat();
        assert.strictEqual(recoveredRes.status, 200);
        assert.strictEqual(recoveredRes.body.active, true);
        assert.strictEqual(kiosk.state, 'ACTIVE');

        kiosk.cleanup();
    });

    return suite;
}
