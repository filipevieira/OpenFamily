/**
 * Tier 3: Cross-Feature Combinations & Pairwise Interaction E2E Test Suite
 * 
 * Tests complex interactions between Database, JWT Middleware, API Endpoints,
 * WebSocket Broadcaster, Client State Machine, and Dashboard Settings UI.
 */

import { assert, TestSuite } from './harness/assertion.js';
import { MockDatabase, MockBroadcaster, KioskBackendServer, ClientKioskSimulator } from './harness/testHarness.js';

export function createTier3Suite() {
    const suite = new TestSuite('Tier 3: Cross-Feature Combinations & Pairwise Interactions');

    const OWNER_ID = 'usr_owner_11111111-1111-4111-8111-111111111111';
    const CHILD_ID = 'usr_child_22222222-2222-4222-8222-222222222222';
    const OTHER_OWNER_ID = 'usr_other_33333333-3333-4333-8333-333333333333';

    suite.test('P1: Full Lifecycle (Pair -> Authorize -> Active -> Remote Unlink -> WS / 401 Redirection -> Re-Pair)', () => {
        const db = new MockDatabase();
        const broadcaster = new MockBroadcaster();
        const server = new KioskBackendServer(db, broadcaster);
        const kiosk = new ClientKioskSimulator(server);

        // 1. Kiosk starts unauthenticated
        kiosk.init();
        assert.strictEqual(kiosk.state, 'UNAUTHENTICATED');

        // 2. Kiosk requests pairing code
        const pairingCode = kiosk.startPairing();
        assert.strictEqual(kiosk.state, 'PAIRING');
        assert.match(pairingCode, /^\d{6}$/);

        // 3. User on mobile authorizes pairing code
        const ownerToken = server.generateToken(OWNER_ID);
        const authRes = server.pairAuthorize(
            { authorization: `Bearer ${ownerToken}`, 'user-agent': 'Chrome/Android' },
            { code: pairingCode, deviceName: 'Living Room TV' },
            { ip: '192.168.1.150' }
        );
        assert.strictEqual(authRes.status, 200);
        const deviceId = authRes.body.deviceId;
        assert.ok(deviceId);

        // 4. Kiosk polls pairing status and transitions to ACTIVE
        const pollRes = kiosk.pollPairingStatus();
        assert.strictEqual(pollRes.authorized, true);
        assert.strictEqual(kiosk.state, 'ACTIVE');
        assert.ok(kiosk.token);
        assert.strictEqual(kiosk.localStorage.get('openfamily.kioskToken'), kiosk.token);

        // 5. Kiosk connects to WebSocket and sends regular heartbeats
        kiosk.connectWebSocket(OWNER_ID);
        const hb1 = kiosk.sendHeartbeat();
        assert.strictEqual(hb1.status, 200);

        // 6. User opens Settings on mobile and unlinks device
        const delRes = server.deleteDevice({ authorization: `Bearer ${ownerToken}` }, deviceId);
        assert.strictEqual(delRes.status, 200);

        // 7. Kiosk immediately catches WebSocket revocation, purges token, and resets
        assert.strictEqual(kiosk.state, 'UNAUTHENTICATED');
        assert.strictEqual(kiosk.token, null);
        assert.strictEqual(kiosk.localStorage.get('openfamily.kioskToken'), undefined);

        // 8. Subsequent heartbeat attempt returns 401
        const hbAfter = server.heartbeat({ authorization: `Bearer ${authRes.body.token}` });
        assert.strictEqual(hbAfter.status, 401);

        // 9. Kiosk can immediately re-initiate pairing for new session
        const newCode = kiosk.startPairing();
        assert.strictEqual(kiosk.state, 'PAIRING');
        assert.notStrictEqual(newCode, pairingCode);

        kiosk.cleanup();
    });

    suite.test('P2: Multi-Kiosk Fleet Management (3 simultaneous kiosks, selective unlinking of 1)', () => {
        const db = new MockDatabase();
        const broadcaster = new MockBroadcaster();
        const server = new KioskBackendServer(db, broadcaster);
        const ownerToken = server.generateToken(OWNER_ID);

        // Setup 3 Kiosks
        const tvKiosk = new ClientKioskSimulator(server);
        const fridgeKiosk = new ClientKioskSimulator(server);
        const tabletKiosk = new ClientKioskSimulator(server);

        // Pair TV
        const tvCode = tvKiosk.startPairing();
        const tvAuth = server.pairAuthorize({ authorization: `Bearer ${ownerToken}` }, { code: tvCode, deviceName: 'TV Sala' });
        tvKiosk.pollPairingStatus();
        tvKiosk.connectWebSocket(OWNER_ID);

        // Pair Fridge
        const fridgeCode = fridgeKiosk.startPairing();
        const fridgeAuth = server.pairAuthorize({ authorization: `Bearer ${ownerToken}` }, { code: fridgeCode, deviceName: 'Geladeira Cozinha' });
        fridgeKiosk.pollPairingStatus();
        fridgeKiosk.connectWebSocket(OWNER_ID);

        // Pair Tablet
        const tabletCode = tabletKiosk.startPairing();
        const tabletAuth = server.pairAuthorize({ authorization: `Bearer ${ownerToken}` }, { code: tabletCode, deviceName: 'Tablet Quarto' });
        tabletKiosk.pollPairingStatus();
        tabletKiosk.connectWebSocket(OWNER_ID);

        // Verify all 3 are active
        assert.strictEqual(tvKiosk.state, 'ACTIVE');
        assert.strictEqual(fridgeKiosk.state, 'ACTIVE');
        assert.strictEqual(tabletKiosk.state, 'ACTIVE');

        // Check device list in Settings
        let list = server.getDevices({ authorization: `Bearer ${ownerToken}` }).body;
        assert.strictEqual(list.length, 3);

        // Selectively unlink ONLY Fridge
        const delRes = server.deleteDevice({ authorization: `Bearer ${ownerToken}` }, fridgeAuth.body.deviceId);
        assert.strictEqual(delRes.status, 200);

        // Verify ONLY fridge is unauthenticated
        assert.strictEqual(fridgeKiosk.state, 'UNAUTHENTICATED');
        assert.strictEqual(fridgeKiosk.token, null);

        // TV and Tablet remain fully ACTIVE and operational
        assert.strictEqual(tvKiosk.state, 'ACTIVE');
        assert.strictEqual(tabletKiosk.state, 'ACTIVE');
        assert.strictEqual(tvKiosk.sendHeartbeat().status, 200);
        assert.strictEqual(tabletKiosk.sendHeartbeat().status, 200);

        // Check device list now has 2
        list = server.getDevices({ authorization: `Bearer ${ownerToken}` }).body;
        assert.strictEqual(list.length, 2);

        tvKiosk.cleanup();
        fridgeKiosk.cleanup();
        tabletKiosk.cleanup();
    });

    suite.test('P3: Role-Based Access Control (Owner vs Child Permissions on Device Unlinking)', () => {
        const db = new MockDatabase();
        const server = new KioskBackendServer(db);
        const ownerToken = server.generateToken(OWNER_ID);
        const childToken = server.generateToken(CHILD_ID, OWNER_ID);

        // Create active device
        const dev = db.insertKioskDevice({ userId: OWNER_ID, deviceName: 'Living Room TV' });

        // Both owner and child can view connected devices
        const ownerList = server.getDevices({ authorization: `Bearer ${ownerToken}` });
        assert.strictEqual(ownerList.status, 200);
        assert.strictEqual(ownerList.body.length, 1);

        const childList = server.getDevices({ authorization: `Bearer ${childToken}` });
        assert.strictEqual(childList.status, 200);
        assert.strictEqual(childList.body.length, 1);

        // Child CANNOT unlink device (403)
        const childUnlink = server.deleteDevice({ authorization: `Bearer ${childToken}` }, dev.id);
        assert.strictEqual(childUnlink.status, 403);

        // Device remains active in DB
        const devCheck = db.getKioskDevice(dev.id);
        assert.strictEqual(devCheck.revoked_at, null);

        // Owner CAN unlink device (200)
        const ownerUnlink = server.deleteDevice({ authorization: `Bearer ${ownerToken}` }, dev.id);
        assert.strictEqual(ownerUnlink.status, 200);
        assert.strictEqual(devCheck.revoked_at !== null, true);
    });

    suite.test('P4: Cross-Tenant Isolation (Family A vs Family B Security Boundary)', () => {
        const db = new MockDatabase();
        const server = new KioskBackendServer(db);
        const ownerTokenA = server.generateToken(OWNER_ID);
        const ownerTokenB = server.generateToken(OTHER_OWNER_ID);

        // Pair device for Family A
        const devA = db.insertKioskDevice({ userId: OWNER_ID, deviceName: 'Family A Display' });
        // Pair device for Family B
        const devB = db.insertKioskDevice({ userId: OTHER_OWNER_ID, deviceName: 'Family B Display' });

        // Family A views only Family A devices
        const listA = server.getDevices({ authorization: `Bearer ${ownerTokenA}` }).body;
        assert.strictEqual(listA.length, 1);
        assert.strictEqual(listA[0].id, devA.id);

        // Family B views only Family B devices
        const listB = server.getDevices({ authorization: `Bearer ${ownerTokenB}` }).body;
        assert.strictEqual(listB.length, 1);
        assert.strictEqual(listB[0].id, devB.id);

        // Family A cannot unlink Family B device
        const hackAttempt = server.deleteDevice({ authorization: `Bearer ${ownerTokenA}` }, devB.id);
        assert.strictEqual(hackAttempt.status, 404);

        // Device B is intact
        assert.strictEqual(db.getKioskDevice(devB.id).revoked_at, null);
    });

    suite.test('P5: Display Settings Persistence & Reboot State Recovery', () => {
        const server = new KioskBackendServer();
        const kiosk = new ClientKioskSimulator(server);
        const ownerToken = server.generateToken(OWNER_ID);

        // Pair device
        const code = kiosk.startPairing();
        server.pairAuthorize({ authorization: `Bearer ${ownerToken}` }, { code, deviceName: 'Persistent Kiosk' });
        kiosk.pollPairingStatus();
        assert.strictEqual(kiosk.state, 'ACTIVE');

        // User customizes kiosk display settings
        kiosk.settings.brightness = 30;
        kiosk.settings.zoom = 1.3;
        kiosk.settings.darkMode = false;
        kiosk.localStorage.set('openfamily.kioskSettings', JSON.stringify(kiosk.settings));

        // Simulate browser reload / power cycle
        const rebootedKiosk = new ClientKioskSimulator(server);
        // Transfer localStorage state
        rebootedKiosk.localStorage.set('openfamily.kioskToken', kiosk.localStorage.get('openfamily.kioskToken'));
        rebootedKiosk.localStorage.set('openfamily.kioskSettings', kiosk.localStorage.get('openfamily.kioskSettings'));

        // Initialize rebooted kiosk
        rebootedKiosk.init();
        assert.strictEqual(rebootedKiosk.state, 'ACTIVE');

        // Restore settings
        const parsed = JSON.parse(rebootedKiosk.localStorage.get('openfamily.kioskSettings'));
        rebootedKiosk.settings = parsed;
        assert.strictEqual(rebootedKiosk.settings.brightness, 30);
        assert.strictEqual(rebootedKiosk.settings.zoom, 1.3);
        assert.strictEqual(rebootedKiosk.settings.darkMode, false);

        // Heartbeat continues to work seamlessly
        const hb = rebootedKiosk.sendHeartbeat();
        assert.strictEqual(hb.status, 200);
    });

    return suite;
}
