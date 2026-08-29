import { Router } from 'express';
import { query } from '../db';
import { authMiddleware, requireParent, AuthRequest } from '../middleware/auth';
import { encryptCredentials, decryptCredentials } from '../utils/crypto';
import { assertSafeIntegrationUrl, UnsafeUrlError } from '../utils/urlGuard';
import { testMealieConnection, syncMealie } from '../services/integrations/mealie';
import { testTandoorConnection, syncTandoor } from '../services/integrations/tandoor';
import { testHomeAssistantConnection, syncHomeAssistant } from '../services/integrations/homeassistant';
import { testGrocyConnection, syncGrocy } from '../services/integrations/grocy';
import { testNextcloudConnection, syncNextcloud } from '../services/integrations/nextcloud';
import { testImmichConnection, syncImmich, fetchImmichRandomPhoto } from '../services/integrations/immich';
import {
    generateGoogleAuthUrl,
    exchangeCodeForTokens,
    testGoogleCalendarConnection,
    fetchGoogleCalendarEvents,
    fetchUserCalendars,
    getValidAccessToken,
    syncGoogleCalendar,
    type GoogleCalendarConfig,
    type GoogleOAuthTokens,
} from '../services/integrations/googlecalendar';
import { broadcast } from '../lib/broadcaster';

const router = Router();
router.use(authMiddleware);

// GET /api/integrations
router.get('/', async (req: AuthRequest, res) => {
    try {
        const result = await query(
            `SELECT id, type, display_name, base_url, config, status, last_synced_at, last_error, created_at
             FROM integrations WHERE family_id = $1 ORDER BY type`,
            [req.userId]
        );
        res.json({ success: true, data: result.rows });
    } catch {
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// GET /api/integrations/immich/photo - proxy a random photo from the family's
// Immich instance (the Immich API key never reaches the browser).
router.get('/immich/photo', async (req: AuthRequest, res) => {
    try {
        const result = await query(
            `SELECT base_url, encrypted_credentials FROM integrations
             WHERE family_id = $1 AND type = 'immich'`,
            [req.userId]
        );
        const integ = result.rows[0] as { base_url: string; encrypted_credentials: string | null } | undefined;
        if (!integ || !integ.encrypted_credentials) {
            return res.status(404).json({ success: false, error: 'Aucune integration Immich configuree' });
        }

        // Re-validate the stored URL at use time (DNS answers can change).
        await assertSafeIntegrationUrl(integ.base_url);

        const photo = await fetchImmichRandomPhoto(integ.base_url, integ.encrypted_credentials);
        res.set('Content-Type', photo.contentType);
        res.set('Cache-Control', 'no-store');
        res.send(photo.buffer);
    } catch (e) {
        if (e instanceof UnsafeUrlError) {
            return res.status(400).json({ success: false, error: e.message });
        }
        res.status(502).json({ success: false, error: 'Immich indisponible' });
    }
});

// POST /api/integrations/test - test without saving
router.post('/test', requireParent, async (req: AuthRequest, res) => {
    const { type, base_url, apiKey, token } = req.body as Record<string, string>;
    const cleanUrl = (base_url || '').replace(/\/$/, '');

    try {
        await assertSafeIntegrationUrl(cleanUrl);

        let result: { success: boolean; message: string };
        switch (type) {
            case 'mealie':        result = await testMealieConnection(cleanUrl, apiKey); break;
            case 'tandoor':       result = await testTandoorConnection(cleanUrl, apiKey); break;
            case 'homeassistant': result = await testHomeAssistantConnection(cleanUrl, token); break;
            case 'grocy':         result = await testGrocyConnection(cleanUrl, apiKey); break;
            case 'nextcloud':     result = await testNextcloudConnection(cleanUrl, (req.body as Record<string, string>).username, (req.body as Record<string, string>).password); break;
            case 'immich':        result = await testImmichConnection(cleanUrl, apiKey); break;
            default:              result = { success: false, message: "Type d'integration inconnu" };
        }
        res.json(result);
    } catch (e) {
        res.json({ success: false, message: e instanceof Error ? e.message : 'Erreur inconnue' });
    }
});

// POST /api/integrations - connect
router.post('/', requireParent, async (req: AuthRequest, res) => {
    const { type, base_url, display_name, config: configFromBody, apiKey, token, username, password, ha_entity_id } = req.body as Record<string, string> & { config?: object };

    if (!type || !base_url) {
        return res.status(400).json({ success: false, error: 'type et base_url sont requis' });
    }

    const credentials: Record<string, string> = {};
    if (apiKey) credentials.apiKey = apiKey;
    if (token) credentials.token = token;
    if (username) credentials.username = username;
    if (password) credentials.password = password;

    // Merge any integration-specific config fields
    const extraConfig: Record<string, string> = {};
    if (ha_entity_id) extraConfig.ha_entity_id = ha_entity_id;
    const config = Object.keys(extraConfig).length > 0 ? { ...(configFromBody || {}), ...extraConfig } : (configFromBody || {});

    const cleanUrl = base_url.replace(/\/$/, '');

    // Validate the URL at save time (it is validated again at every use).
    try {
        await assertSafeIntegrationUrl(cleanUrl);
    } catch (e) {
        return res.status(400).json({ success: false, error: e instanceof UnsafeUrlError ? e.message : 'URL invalide' });
    }

    const encrypted = Object.keys(credentials).length > 0 ? encryptCredentials(credentials) : null;

    try {
        const result = await query(
            `INSERT INTO integrations (family_id, type, display_name, base_url, encrypted_credentials, config, status)
             VALUES ($1, $2, $3, $4, $5, $6::jsonb, 'connected')
             ON CONFLICT (family_id, type) DO UPDATE SET
               display_name = EXCLUDED.display_name,
               base_url = EXCLUDED.base_url,
               encrypted_credentials = COALESCE(EXCLUDED.encrypted_credentials, integrations.encrypted_credentials),
               config = EXCLUDED.config,
               status = 'connected',
               last_error = NULL,
               updated_at = NOW()
             RETURNING id, type, display_name, base_url, config, status, last_synced_at, created_at`,
            [req.userId, type, display_name || type, cleanUrl, encrypted, JSON.stringify(config || {})]
        );
        res.json({ success: true, data: result.rows[0] });
    } catch {
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// POST /api/integrations/:id/sync
router.post('/:id/sync', requireParent, async (req: AuthRequest, res) => {
    try {
        const integResult = await query(
            'SELECT * FROM integrations WHERE id = $1 AND family_id = $2',
            [req.params.id, req.userId]
        );
        if (integResult.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Integration introuvable' });
        }

        const integ = integResult.rows[0] as {
            id: string; type: string; base_url: string;
            encrypted_credentials: string; config: Record<string, unknown>;
        };

        await query("UPDATE integrations SET status = 'syncing', updated_at = NOW() WHERE id = $1", [integ.id]);

        try {
            // Re-validate the stored URL at use time (DNS answers can change).
            await assertSafeIntegrationUrl(integ.base_url);

            let syncResult: { imported: number; errors: number };

            switch (integ.type) {
                case 'mealie':        syncResult = await syncMealie(integ.id, req.userId!, integ.base_url, integ.encrypted_credentials); break;
                case 'tandoor':       syncResult = await syncTandoor(integ.id, req.userId!, integ.base_url, integ.encrypted_credentials); break;
                case 'homeassistant': syncResult = await syncHomeAssistant(integ.id, req.userId!, integ.base_url, integ.encrypted_credentials, integ.config || {}); break;
                case 'grocy':         syncResult = await syncGrocy(integ.id, req.userId!, integ.base_url, integ.encrypted_credentials); break;
                case 'nextcloud':     syncResult = await syncNextcloud(integ.id, req.userId!, integ.base_url, integ.encrypted_credentials, integ.config || {}); break;
                case 'immich':        syncResult = await syncImmich(integ.id, req.userId!, integ.base_url, integ.encrypted_credentials); break;
                case 'google_calendar': syncResult = await syncGoogleCalendar(integ.id, req.userId!, integ.base_url, integ.encrypted_credentials, integ.config || {}); break;
                default: throw new Error('Type inconnu');
            }

            await query(
                "UPDATE integrations SET status = 'connected', last_synced_at = NOW(), last_error = NULL, updated_at = NOW() WHERE id = $1",
                [integ.id]
            );

            broadcast(req.userId!, { type: 'update', entity: 'integrations', action: 'synced' });
            res.json({ success: true, data: syncResult });
        } catch (syncError) {
            const msg = syncError instanceof Error ? syncError.message : 'Sync error';
            await query("UPDATE integrations SET status = 'error', last_error = $2, updated_at = NOW() WHERE id = $1", [integ.id, msg]);
            res.status(500).json({ success: false, error: msg });
        }
    } catch {
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// GET /api/integrations/google/auth-url
router.get('/google/auth-url', requireParent, async (req: AuthRequest, res) => {
    try {
        const { redirectUri } = req.query as { redirectUri?: string };
        const result = await query(
            "SELECT config FROM integrations WHERE family_id = $1 AND type = 'google_calendar'",
            [req.userId]
        );
        const integ = result.rows[0] as { config?: GoogleCalendarConfig } | undefined;
        if (!integ?.config?.client_id) {
            return res.status(400).json({
                success: false,
                error: 'GOOGLE_NOT_CONFIGURED',
                message: 'Veuillez configurer votre Client ID et Client Secret dans les paramètres',
            });
        }

        const effectiveRedirectUri = redirectUri || `${req.protocol}://${req.get('host')}/settings/integrations/google/callback`;
        const authUrl = generateGoogleAuthUrl(integ.config.client_id, effectiveRedirectUri, req.userId);
        res.json({ success: true, authUrl });
    } catch {
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// POST /api/integrations/google/config - Save Client ID and Client Secret
router.post('/google/config', requireParent, async (req: AuthRequest, res) => {
    try {
        const { client_id, client_secret } = req.body as { client_id?: string; client_secret?: string };
        if (!client_id || !client_secret) {
            return res.status(400).json({ success: false, error: 'Client ID and Client Secret are required' });
        }

        const existing = await query(
            "SELECT id, config FROM integrations WHERE family_id = $1 AND type = 'google_calendar'",
            [req.userId]
        );

        const existingConfig = (existing.rows[0]?.config || {}) as GoogleCalendarConfig;

        const config: GoogleCalendarConfig = {
            ...existingConfig,
            client_id: client_id.trim(),
            client_secret: client_secret.trim(),
            calendar_id: existingConfig.calendar_id || 'primary',
            auto_sync: true,
        };

        if (existing.rows.length > 0) {
            await query(
                `UPDATE integrations
                 SET config = $1, updated_at = NOW()
                 WHERE family_id = $2 AND type = 'google_calendar'`,
                [JSON.stringify(config), req.userId]
            );
        } else {
            await query(
                `INSERT INTO integrations (family_id, type, display_name, base_url, config, status)
                 VALUES ($1, 'google_calendar', 'Google Calendar', 'https://calendar.google.com', $2, 'disconnected')`,
                [req.userId, JSON.stringify(config)]
            );
        }

        broadcast(req.userId!, { type: 'update', entity: 'integrations', action: 'updated' });
        res.json({ success: true });
    } catch {
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// POST /api/integrations/google/select-calendar - Select active Google Calendar
router.post('/google/select-calendar', requireParent, async (req: AuthRequest, res) => {
    try {
        const { calendar_id, calendar_title } = req.body as { calendar_id?: string; calendar_title?: string };
        if (!calendar_id) {
            return res.status(400).json({ success: false, error: 'calendar_id is required' });
        }

        const existing = await query(
            "SELECT id, config FROM integrations WHERE family_id = $1 AND type = 'google_calendar'",
            [req.userId]
        );

        if (existing.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Google Calendar integration not found' });
        }

        const currentConfig = (existing.rows[0].config || {}) as GoogleCalendarConfig;
        const updatedConfig: GoogleCalendarConfig = {
            ...currentConfig,
            calendar_id: calendar_id,
            calendar_title: calendar_title || calendar_id,
        };

        await query(
            `UPDATE integrations
             SET config = $1, updated_at = NOW()
             WHERE family_id = $2 AND type = 'google_calendar'`,
            [JSON.stringify(updatedConfig), req.userId]
        );

        broadcast(req.userId!, { type: 'update', entity: 'integrations', action: 'updated' });
        res.json({ success: true, calendar_id, calendar_title });
    } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to select calendar';
        res.status(500).json({ success: false, error: msg });
    }
});

// GET /api/integrations/google/callback - Handle OAuth redirect code from Google
router.get('/google/callback', async (req: AuthRequest, res) => {
    try {
        const { code, redirectUri } = req.query as { code?: string; redirectUri?: string };
        if (!code) {
            return res.status(400).json({ success: false, error: 'Authorization code missing' });
        }

        const result = await query(
            "SELECT id, config FROM integrations WHERE family_id = $1 AND type = 'google_calendar'",
            [req.userId]
        );

        const integ = result.rows[0] as { id: string; config?: GoogleCalendarConfig } | undefined;
        if (!integ?.config?.client_id || !integ?.config?.client_secret) {
            return res.status(400).json({ success: false, error: 'Google Calendar credentials not configured' });
        }

        const effectiveRedirectUri = redirectUri || `${req.protocol}://${req.get('host')}/settings/integrations/google/callback`;
        const tokens = await exchangeCodeForTokens(
            code,
            integ.config.client_id,
            integ.config.client_secret,
            effectiveRedirectUri
        );

        const encrypted = encryptCredentials(tokens as unknown as Record<string, string>);

        await query(
            `UPDATE integrations
             SET encrypted_credentials = $1, status = 'connected', last_error = NULL, updated_at = NOW()
             WHERE id = $2`,
            [encrypted, integ.id]
        );

        broadcast(req.userId!, { type: 'update', entity: 'integrations', action: 'updated' });
        res.json({ success: true });
    } catch (error) {
        const msg = error instanceof Error ? error.message : 'OAuth exchange error';
        res.status(500).json({ success: false, error: msg });
    }
});

// GET /api/integrations/google/calendars - Fetch list of user's Google Calendars
router.get('/google/calendars', async (req: AuthRequest, res) => {
    try {
        const { accessToken } = await getValidAccessToken('', req.userId!);
        const calendars = await fetchUserCalendars(accessToken);
        res.json({ success: true, calendars });
    } catch (error) {
        const msg = error instanceof Error ? error.message : 'Failed to fetch Google Calendars';
        res.status(500).json({ success: false, error: msg });
    }
});

// POST /api/integrations/google/clean - Safely wipe local schedule entries for clean start
router.post('/google/clean', requireParent, async (req: AuthRequest, res) => {
    try {
        await query('DELETE FROM schedule_entries WHERE user_id = $1', [req.userId]);
        broadcast(req.userId!, { type: 'update', entity: 'planning', action: 'deleted' });
        res.json({ success: true, message: 'Local schedule entries safely wiped' });
    } catch (error) {
        const msg = error instanceof Error ? error.message : 'Failed to wipe local entries';
        res.status(500).json({ success: false, error: msg });
    }
});

// DELETE /api/integrations/:id
router.delete('/:id', requireParent, async (req: AuthRequest, res) => {
    try {
        const result = await query(
            'DELETE FROM integrations WHERE id = $1 AND family_id = $2 RETURNING id',
            [req.params.id, req.userId]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Integration introuvable' });
        }
        res.json({ success: true });
    } catch {
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

export default router;
