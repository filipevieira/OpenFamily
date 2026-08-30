/**
 * OpenFamily E2E Test Suite - Test Harness & Contract Emulator
 * 
 * Provides an authoritative, isolated reference implementation for Universal Kiosk Mode
 * and Remote Device Management based strictly on PROJECT.md and ORIGINAL_REQUEST.md specifications.
 */

import crypto from 'node:crypto';

// ── JWT Engine for Testing (HMAC-SHA256 based, compatible with jsonwebtoken) ──

const TEST_JWT_SECRET = 'e2e_test_jwt_secret_key_1234567890';

export function signJwt(payload, secret = TEST_JWT_SECRET, expiresInSeconds = 3600) {
    const header = { alg: 'HS256', typ: 'JWT' };
    const now = Math.floor(Date.now() / 1000);
    const fullPayload = {
        ...payload,
        iat: now,
        exp: now + expiresInSeconds,
    };
    const encHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
    const encPayload = Buffer.from(JSON.stringify(fullPayload)).toString('base64url');
    const signature = crypto
        .createHmac('sha256', secret)
        .update(`${encHeader}.${encPayload}`)
        .digest('base64url');
    return `${encHeader}.${encPayload}.${signature}`;
}

export function verifyJwt(token, secret = TEST_JWT_SECRET) {
    if (!token || typeof token !== 'string') {
        throw new Error('No token provided');
    }
    const parts = token.split('.');
    if (parts.length !== 3) {
        throw new Error('Invalid token');
    }
    const [encHeader, encPayload, signature] = parts;
    const expectedSig = crypto
        .createHmac('sha256', secret)
        .update(`${encHeader}.${encPayload}`)
        .digest('base64url');
    if (signature !== expectedSig) {
        throw new Error('Invalid token');
    }
    const payload = JSON.parse(Buffer.from(encPayload, 'base64url').toString('utf8'));
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) {
        throw new Error('Token expired');
    }
    return payload;
}

// ── Mock Database & Schema Representation ──

export class MockDatabase {
    constructor() {
        this.users = new Map();
        this.kioskDevices = new Map();
        this.migrationsApplied = [];
        this.initDefaultSeed();
    }

    initDefaultSeed() {
        const ownerId = 'usr_owner_11111111-1111-4111-8111-111111111111';
        const childId = 'usr_child_22222222-2222-4222-8222-222222222222';
        const otherFamilyOwnerId = 'usr_other_33333333-3333-4333-8333-333333333333';

        this.users.set(ownerId, {
            id: ownerId,
            email: 'owner@family.local',
            name: 'Family Owner',
            role: 'parent',
            family_owner_id: null,
        });

        this.users.set(childId, {
            id: childId,
            email: 'child@family.local',
            name: 'Family Child',
            role: 'enfant',
            family_owner_id: ownerId,
        });

        this.users.set(otherFamilyOwnerId, {
            id: otherFamilyOwnerId,
            email: 'other@family.local',
            name: 'Other Family Owner',
            role: 'parent',
            family_owner_id: null,
        });
    }

    applyMigration(sql) {
        this.migrationsApplied.push(sql);
    }

    insertKioskDevice({ id, userId, deviceName, deviceType, userAgent, ipAddress, deviceToken }) {
        const deviceId = id || crypto.randomUUID();
        const now = new Date().toISOString();
        const record = {
            id: deviceId,
            user_id: userId,
            device_name: deviceName || 'Smart Display',
            device_type: deviceType || 'Universal Kiosk Display',
            user_agent: userAgent || 'Mozilla/5.0 (Smart TV; Tizen 6.0)',
            ip_address: ipAddress || '192.168.1.100',
            device_token: deviceToken || null,
            last_active_at: now,
            revoked_at: null,
            created_at: now,
        };
        this.kioskDevices.set(deviceId, record);
        return record;
    }

    getKioskDevice(deviceId) {
        return this.kioskDevices.get(deviceId) || null;
    }

    listActiveKioskDevices(userId) {
        const results = [];
        for (const dev of this.kioskDevices.values()) {
            if (dev.user_id === userId && dev.revoked_at === null) {
                results.push({
                    id: dev.id,
                    userId: dev.user_id,
                    deviceName: dev.device_name,
                    deviceType: dev.device_type,
                    userAgent: dev.user_agent,
                    ipAddress: dev.ip_address,
                    lastActiveAt: dev.last_active_at,
                    createdAt: dev.created_at,
                });
            }
        }
        return results;
    }

    revokeKioskDevice(deviceId, userId) {
        const dev = this.kioskDevices.get(deviceId);
        if (!dev || dev.user_id !== userId) {
            return false;
        }
        if (dev.revoked_at !== null) {
            return false; // already revoked
        }
        dev.revoked_at = new Date().toISOString();
        return true;
    }

    heartbeatKioskDevice(deviceId) {
        const dev = this.kioskDevices.get(deviceId);
        if (!dev || dev.revoked_at !== null) {
            return false;
        }
        dev.last_active_at = new Date().toISOString();
        return true;
    }
}

// ── WebSocket Broadcaster Emulator ──

export class MockBroadcaster {
    constructor() {
        this.listeners = new Map(); // userId -> Set<callback>
        this.events = [];
    }

    subscribe(userId, callback) {
        if (!this.listeners.has(userId)) {
            this.listeners.set(userId, new Set());
        }
        this.listeners.get(userId).add(callback);
        return () => {
            const set = this.listeners.get(userId);
            if (set) set.delete(callback);
        };
    }

    broadcast(userId, payload) {
        this.events.push({ userId, payload, timestamp: Date.now() });
        const userListeners = this.listeners.get(userId);
        if (userListeners) {
            for (const cb of userListeners) {
                try {
                    cb(payload);
                } catch (e) {
                    // Ignore listener errors
                }
            }
        }
    }

    getEventsForUser(userId) {
        return this.events.filter((e) => e.userId === userId);
    }

    clear() {
        this.events = [];
    }
}

// ── Kiosk Backend API Server Emulator ──

export class KioskBackendServer {
    constructor(db = new MockDatabase(), broadcaster = new MockBroadcaster()) {
        this.db = db;
        this.broadcaster = broadcaster;
        this.pairSessions = new Map(); // code -> PairSession
    }

    generateToken(userId, ownerId) {
        return signJwt({ userId, ownerId: ownerId ?? userId }, TEST_JWT_SECRET, 7 * 86400);
    }

    generateKioskToken(userId, ownerId, deviceId) {
        return signJwt(
            { userId, ownerId: ownerId ?? userId, deviceId, isKiosk: true },
            TEST_JWT_SECRET,
            3650 * 86400
        );
    }

    // Middleware check
    authenticateRequest(headers) {
        const authHeader = headers?.authorization || headers?.Authorization;
        let token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
        if (!token) {
            return { error: 'No token provided', status: 401 };
        }

        let decoded;
        try {
            decoded = verifyJwt(token, TEST_JWT_SECRET);
        } catch (err) {
            return { error: err.message || 'Invalid token', status: 401 };
        }

        const user = this.db.users.get(decoded.userId);
        const actualUserId = decoded.userId;
        const effectiveUserId = decoded.ownerId ?? decoded.userId;
        const isOwner = !decoded.ownerId || decoded.ownerId === decoded.userId;

        // If this is a Kiosk token, verify deviceId and revocation status in DB
        if (decoded.isKiosk) {
            if (!decoded.deviceId) {
                return { error: 'Kiosk token missing deviceId claim', status: 401 };
            }
            const device = this.db.getKioskDevice(decoded.deviceId);
            if (!device || device.revoked_at !== null) {
                return { error: 'Kiosk device revoked', status: 401 };
            }
        }

        return {
            user,
            actualUserId,
            effectiveUserId,
            isOwner,
            isKiosk: Boolean(decoded.isKiosk),
            deviceId: decoded.deviceId,
        };
    }

    // POST /api/kiosk/pair/init
    pairInit() {
        let code = '';
        do {
            code = Math.floor(100000 + Math.random() * 900000).toString();
        } while (this.pairSessions.has(code));

        this.pairSessions.set(code, {
            code,
            token: null,
            deviceId: null,
            authorized: false,
            expiresAt: Date.now() + 600_000, // 10 minutes
        });

        return { status: 200, body: { success: true, code } };
    }

    // GET /api/kiosk/pair/status?code=XXXXXX
    pairStatus(code) {
        const cleanCode = String(code || '').trim();
        if (!cleanCode || !this.pairSessions.has(cleanCode)) {
            return { status: 200, body: { success: true, authorized: false, expired: true } };
        }

        const session = this.pairSessions.get(cleanCode);
        if (Date.now() > session.expiresAt) {
            this.pairSessions.delete(cleanCode);
            return { status: 200, body: { success: true, authorized: false, expired: true } };
        }

        if (session.authorized && session.token) {
            this.pairSessions.delete(cleanCode); // One-time consume
            return {
                status: 200,
                body: { success: true, authorized: true, token: session.token, deviceId: session.deviceId },
            };
        }

        return { status: 200, body: { success: true, authorized: false } };
    }

    // POST /api/kiosk/pair/authorize
    pairAuthorize(headers, body, reqMeta = {}) {
        const auth = this.authenticateRequest(headers);
        if (auth.error) {
            return { status: auth.status, body: { success: false, error: auth.error } };
        }

        const { code, deviceName } = body || {};
        const cleanCode = String(code || '').replace(/\D/g, '').trim();

        if (!cleanCode || !this.pairSessions.has(cleanCode)) {
            return { status: 400, body: { success: false, error: 'Código de pareamento inválido ou expirado.' } };
        }

        const session = this.pairSessions.get(cleanCode);
        if (Date.now() > session.expiresAt) {
            this.pairSessions.delete(cleanCode);
            return { status: 400, body: { success: false, error: 'Este código de pareamento já expirou.' } };
        }

        // Register device in DB
        const deviceId = crypto.randomUUID();
        const userAgent = reqMeta.userAgent || headers?.['user-agent'] || 'Mozilla/5.0 (Smart TV; WebOS)';
        const ipAddress = reqMeta.ip || '192.168.1.150';
        const finalDeviceName = deviceName && typeof deviceName === 'string' && deviceName.trim()
            ? deviceName.trim()
            : 'Smart Display Kiosk';

        // Issue 10-year Kiosk token embedding deviceId
        const kioskToken = this.generateKioskToken(auth.effectiveUserId, auth.effectiveUserId, deviceId);

        const device = this.db.insertKioskDevice({
            id: deviceId,
            userId: auth.effectiveUserId,
            deviceName: finalDeviceName,
            deviceType: 'Universal Kiosk Display',
            userAgent,
            ipAddress,
            deviceToken: kioskToken,
        });

        session.token = kioskToken;
        session.deviceId = deviceId;
        session.authorized = true;

        return {
            status: 200,
            body: {
                success: true,
                message: 'TV conectada com sucesso!',
                token: kioskToken,
                deviceId,
            },
        };
    }

    // GET /api/kiosk/devices
    getDevices(headers) {
        const auth = this.authenticateRequest(headers);
        if (auth.error) {
            return { status: auth.status, body: { success: false, error: auth.error } };
        }

        const devices = this.db.listActiveKioskDevices(auth.effectiveUserId);
        return { status: 200, body: devices };
    }

    // DELETE /api/kiosk/devices/:id
    deleteDevice(headers, deviceId) {
        const auth = this.authenticateRequest(headers);
        if (auth.error) {
            return { status: auth.status, body: { success: false, error: auth.error } };
        }

        // Check if user is parent/owner (children cannot revoke)
        if (auth.user && auth.user.role === 'enfant') {
            return { status: 403, body: { success: false, error: 'Action réservée aux parents.' } };
        }

        const success = this.db.revokeKioskDevice(deviceId, auth.effectiveUserId);
        if (!success) {
            return { status: 404, body: { success: false, error: 'Dispositivo não encontrado ou já desvinculado.' } };
        }

        // Broadcast revocation to all user's WebSocket connections
        this.broadcaster.broadcast(auth.effectiveUserId, {
            type: 'update',
            entity: 'kiosk',
            action: 'deleted',
            id: deviceId,
            data: { revoked: true },
        });

        return {
            status: 200,
            body: { success: true, message: 'Dispositivo desvinculado com sucesso' },
        };
    }

    // POST /api/kiosk/heartbeat
    heartbeat(headers) {
        const auth = this.authenticateRequest(headers);
        if (auth.error) {
            return { status: auth.status, body: { success: false, error: auth.error } };
        }

        if (!auth.isKiosk || !auth.deviceId) {
            return { status: 400, body: { success: false, error: 'Heartbeat only valid for kiosk devices' } };
        }

        const success = this.db.heartbeatKioskDevice(auth.deviceId);
        if (!success) {
            return { status: 401, body: { success: false, error: 'Kiosk device revoked or not found' } };
        }

        return { status: 200, body: { success: true, active: true } };
    }
}

// ── Client Kiosk Simulator ──

export class ClientKioskSimulator {
    constructor(server) {
        this.server = server;
        this.localStorage = new Map();
        this.token = null;
        this.pairingCode = null;
        this.state = 'UNAUTHENTICATED'; // UNAUTHENTICATED | PAIRING | ACTIVE | REVOKED
        this.settings = {
            location: null,
            photoBackground: false,
            darkMode: true,
            zoom: 1.0,
            brightness: 100,
        };
        this.eventsReceived = [];
        this.wsUnsubscribe = null;
    }

    init() {
        const storedToken = this.localStorage.get('openfamily.kioskToken');
        if (storedToken) {
            this.token = storedToken;
            this.state = 'ACTIVE';
        } else {
            this.state = 'UNAUTHENTICATED';
        }
    }

    startPairing() {
        const res = this.server.pairInit();
        if (res.status === 200 && res.body.code) {
            this.pairingCode = res.body.code;
            this.state = 'PAIRING';
            return this.pairingCode;
        }
        throw new Error('Failed to init pairing');
    }

    pollPairingStatus() {
        if (!this.pairingCode) return { authorized: false };
        const res = this.server.pairStatus(this.pairingCode);
        if (res.body.authorized && res.body.token) {
            this.token = res.body.token;
            this.localStorage.set('openfamily.kioskToken', this.token);
            this.state = 'ACTIVE';
            this.pairingCode = null;
            return { authorized: true, token: this.token };
        }
        if (res.body.expired) {
            this.state = 'UNAUTHENTICATED';
            this.pairingCode = null;
            return { authorized: false, expired: true };
        }
        return { authorized: false };
    }

    connectWebSocket(userId) {
        this.wsUnsubscribe = this.server.broadcaster.subscribe(userId, (payload) => {
            this.eventsReceived.push(payload);
            // Handle instant revocation
            if (payload.entity === 'kiosk' && (payload.action === 'deleted' || payload.data?.revoked)) {
                this.handleAuthExpired();
            }
        });
    }

    sendHeartbeat() {
        if (!this.token) return { success: false, status: 401 };
        const res = this.server.heartbeat({ authorization: `Bearer ${this.token}` });
        if (res.status === 401) {
            this.handleAuthExpired();
        }
        return res;
    }

    handleAuthExpired() {
        this.token = null;
        this.localStorage.delete('openfamily.kioskToken');
        this.state = 'UNAUTHENTICATED';
    }

    cleanup() {
        if (this.wsUnsubscribe) {
            this.wsUnsubscribe();
            this.wsUnsubscribe = null;
        }
    }
}
