import { Router, Response } from 'express';
import { authMiddleware, AuthRequest, generateKioskToken } from '../middleware/auth';

const router = Router();

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

export default router;
