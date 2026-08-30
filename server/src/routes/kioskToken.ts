import { Router, Response } from 'express';
import { authMiddleware, AuthRequest, generateKioskToken, requireParent } from '../middleware/auth';
import { query } from '../db';
import { broadcast } from '../lib/broadcaster';

const router = Router();

export interface PairSession {
    code: string;
    token: string | null;
    deviceId: string | null;
    authorized: boolean;
    expiresAt: number;
    ipAddress?: string | null;
    userAgent?: string;
}

// In-memory store for 6-digit TV pairing codes (valid for 10 minutes)
const pairSessions = new Map<string, PairSession>();

// Clean up expired pairing sessions periodically
setInterval(() => {
    const now = Date.now();
    for (const [code, session] of pairSessions.entries()) {
        if (session.expiresAt < now) {
            pairSessions.delete(code);
        }
    }
}, 300_000);

export const parseDeviceType = (ua?: string): string => {
    if (!ua) return 'Universal Kiosk Display';
    const s = ua.toLowerCase();
    if (s.includes('web0s') || s.includes('webos')) return 'LG webOS Smart TV';
    if (s.includes('tizen')) return 'Samsung Tizen Smart TV';
    if (s.includes('googletv') || s.includes('google tv')) return 'Google TV';
    if (s.includes('android tv')) return 'Android TV';
    if (s.includes('bravia')) return 'Sony BRAVIA TV';
    if (s.includes('roku')) return 'Roku TV';
    if (s.includes('appletv')) return 'Apple TV';
    if (s.includes('ipad')) return 'Apple iPad Tablet';
    if (s.includes('tablet')) return 'Android Tablet';
    if (s.includes('smarttv') || s.includes('smart-tv') || s.includes('smart tv') || s.includes('tv')) return 'Smart TV';
    if (s.includes('mobile') || s.includes('android') || s.includes('iphone')) return 'Mobile Browser';
    if (s.includes('chrome')) return 'Chrome Browser';
    if (s.includes('safari')) return 'Safari Browser';
    if (s.includes('firefox')) return 'Firefox Browser';
    if (s.includes('edge')) return 'Edge Browser';
    return 'Universal Kiosk Display';
};

/**
 * GET /api/kiosk/token
 * Generates or returns a 10-year long-lived Kiosk JWT Token for TV/Display screens.
 */
router.get('/token', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        if (!req.userId) {
            return res.status(401).json({ success: false, error: 'Unauthorized' });
        }
        const userAgent = req.headers['user-agent'] || 'Direct Kiosk Display';
        const deviceType = parseDeviceType(userAgent);
        const ipAddress = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.socket.remoteAddress || req.ip || null;

        const result = await query(
            `INSERT INTO kiosk_devices (user_id, device_name, device_type, user_agent, ip_address, last_active_at, created_at)
             VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
             RETURNING id`,
            [req.userId, 'Direct Display', deviceType, userAgent, ipAddress]
        );
        const deviceId = result.rows[0].id;
        const token = generateKioskToken(req.userId, req.userId, deviceId);
        return res.json({ success: true, token, deviceId });
    } catch (err: any) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * POST /api/kiosk/pair/init
 * Public endpoint called by the TV screen to obtain a temporary 6-digit pairing code.
 */
router.post('/pair/init', (req: AuthRequest, res: Response) => {
    let code = '';
    // Generate a unique 6-digit code
    do {
        code = Math.floor(100000 + Math.random() * 900000).toString();
    } while (pairSessions.has(code));

    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.socket.remoteAddress || req.ip || null;
    const userAgent = req.headers['user-agent'] || undefined;

    pairSessions.set(code, {
        code,
        token: null,
        deviceId: null,
        authorized: false,
        expiresAt: Date.now() + 600_000, // 10 minutes
        ipAddress: ip,
        userAgent,
    });

    return res.json({ success: true, code });
});

/**
 * GET /api/kiosk/pair/status
 * Public endpoint polled by the TV screen every 2s to check if the pairing code was authorized.
 */
router.get('/pair/status', (req: AuthRequest, res: Response) => {
    const code = String(req.query.code || '').trim();
    if (!code || !pairSessions.has(code)) {
        return res.json({ success: true, authorized: false, expired: true });
    }

    const session = pairSessions.get(code)!;
    if (Date.now() > session.expiresAt) {
        pairSessions.delete(code);
        return res.json({ success: true, authorized: false, expired: true });
    }

    if (session.authorized && session.token) {
        const token = session.token;
        const deviceId = session.deviceId;
        pairSessions.delete(code); // Consume pairing code once authorized
        return res.json({ success: true, authorized: true, token, deviceId });
    }

    return res.json({ success: true, authorized: false });
});

/**
 * POST /api/kiosk/pair/authorize
 * Authenticated endpoint called by the user's mobile device to link their family token to the TV pairing code.
 */
router.post('/pair/authorize', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        if (!req.userId) {
            return res.status(401).json({ success: false, error: 'Unauthorized' });
        }
        const { code, deviceName } = req.body;
        const cleanCode = String(code || '').replace(/\D/g, '').trim();

        if (!cleanCode || !pairSessions.has(cleanCode)) {
            return res.status(400).json({ success: false, error: 'Código de pareamento inválido ou expirado.' });
        }

        const session = pairSessions.get(cleanCode)!;
        if (Date.now() > session.expiresAt) {
            pairSessions.delete(cleanCode);
            return res.status(400).json({ success: false, error: 'Este código de pareamento já expirou.' });
        }

        const finalDeviceName = String(deviceName || '').trim() || 'Smart Display';
        const userAgent = session.userAgent || req.headers['user-agent'] || 'Universal Kiosk Display';
        const deviceType = parseDeviceType(userAgent);
        const ipAddress = session.ipAddress !== undefined ? session.ipAddress : ((req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.socket.remoteAddress || req.ip || null);

        const result = await query(
            `INSERT INTO kiosk_devices (user_id, device_name, device_type, user_agent, ip_address, last_active_at, created_at)
             VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
             RETURNING id, user_id, device_name, device_type, user_agent, ip_address, last_active_at, created_at`,
            [req.userId, finalDeviceName, deviceType, userAgent, ipAddress]
        );

        const device = result.rows[0];
        const deviceId = device.id;

        // Generate 10-year Kiosk token for this family
        const token = generateKioskToken(req.userId, req.userId, deviceId);
        session.token = token;
        session.deviceId = deviceId;
        session.authorized = true;

        // Broadcast device created event
        broadcast(req.userId, {
            type: 'update',
            entity: 'kiosk',
            action: 'created',
            id: deviceId,
            data: { deviceId, deviceName: finalDeviceName },
        });

        return res.json({
            success: true,
            message: 'TV conectada com sucesso!',
            token,
            deviceId,
        });
    } catch (err: any) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /api/kiosk/devices
 * Returns all active (non-revoked) kiosk devices linked to this user/family.
 */
router.get('/devices', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        if (!req.userId) {
            return res.status(401).json({ success: false, error: 'Unauthorized' });
        }

        const result = await query(
            `SELECT id, user_id, device_name, device_type, user_agent, ip_address, last_active_at, created_at
             FROM kiosk_devices
             WHERE user_id = $1 AND revoked_at IS NULL
             ORDER BY created_at DESC`,
            [req.userId]
        );

        const devices = result.rows.map((row) => ({
            id: row.id,
            userId: row.user_id,
            deviceName: row.device_name,
            deviceType: row.device_type,
            userAgent: row.user_agent,
            ipAddress: row.ip_address,
            lastActiveAt: row.last_active_at,
            createdAt: row.created_at,
        }));

        return res.json(devices);
    } catch (err: any) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * DELETE /api/kiosk/devices/:id
 * Revokes an active kiosk device and broadcasts websocket notification.
 */
router.delete('/devices/:id', authMiddleware, requireParent, async (req: AuthRequest, res: Response) => {
    try {
        if (!req.userId) {
            return res.status(401).json({ success: false, error: 'Unauthorized' });
        }

        const deviceId = req.params.id;

        const existing = await query(
            'SELECT id, user_id, revoked_at FROM kiosk_devices WHERE id = $1 AND user_id = $2',
            [deviceId, req.userId]
        );

        if (existing.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Dispositivo não encontrado.' });
        }

        await query(
            'UPDATE kiosk_devices SET revoked_at = CURRENT_TIMESTAMP WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL',
            [deviceId, req.userId]
        );

        broadcast(req.userId, {
            type: 'update',
            entity: 'kiosk',
            action: 'deleted',
            id: deviceId,
            data: { revoked: true, deviceId },
        });

        return res.json({
            success: true,
            message: 'Dispositivo desvinculado com sucesso',
        });
    } catch (err: any) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * POST /api/kiosk/heartbeat
 * Kiosk display heartbeat endpoint to update last_active_at timestamp.
 */
router.post('/heartbeat', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        if (!req.userId) {
            return res.status(401).json({ success: false, error: 'Unauthorized' });
        }

        if (req.deviceId) {
            await query(
                'UPDATE kiosk_devices SET last_active_at = CURRENT_TIMESTAMP WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL',
                [req.deviceId, req.userId]
            );
        }

        return res.json({ success: true, active: true });
    } catch (err: any) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

export default router;
