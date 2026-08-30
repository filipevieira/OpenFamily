import { Router, Response } from 'express';
import { authMiddleware, AuthRequest, generateKioskToken } from '../middleware/auth';

const router = Router();

interface PairSession {
    code: string;
    token: string | null;
    authorized: boolean;
    expiresAt: number;
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

/**
 * GET /api/kiosk/token
 * Generates or returns a 10-year long-lived Kiosk JWT Token for TV/Display screens.
 */
router.get('/token', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        if (!req.userId) {
            return res.status(401).json({ success: false, error: 'Unauthorized' });
        }
        const token = generateKioskToken(req.userId, req.userId);
        return res.json({ success: true, token });
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

    pairSessions.set(code, {
        code,
        token: null,
        authorized: false,
        expiresAt: Date.now() + 600_000, // 10 minutes
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
        pairSessions.delete(code); // Consume pairing code once authorized
        return res.json({ success: true, authorized: true, token: session.token });
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
        const { code } = req.body;
        const cleanCode = String(code || '').replace(/\D/g, '').trim();

        if (!cleanCode || !pairSessions.has(cleanCode)) {
            return res.status(400).json({ success: false, error: 'Código de pareamento inválido ou expirado.' });
        }

        const session = pairSessions.get(cleanCode)!;
        if (Date.now() > session.expiresAt) {
            pairSessions.delete(cleanCode);
            return res.status(400).json({ success: false, error: 'Este código de pareamento já expirou.' });
        }

        // Generate 10-year Kiosk token for this family
        const token = generateKioskToken(req.userId, req.userId);
        session.token = token;
        session.authorized = true;

        return res.json({ success: true, message: 'TV conectada com sucesso!' });
    } catch (err: any) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

export default router;
