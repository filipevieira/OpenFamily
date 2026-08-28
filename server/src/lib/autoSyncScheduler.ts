import cron from 'node-cron';
import { query } from '../db';
import logger from './logger';
import { syncGoogleCalendar } from '../services/integrations/googlecalendar';
import { syncNextcloud } from '../services/integrations/nextcloud';
import { syncMealie } from '../services/integrations/mealie';
import { syncTandoor } from '../services/integrations/tandoor';
import { syncHomeAssistant } from '../services/integrations/homeassistant';
import { syncGrocy } from '../services/integrations/grocy';
import { syncImmich } from '../services/integrations/immich';
import { broadcast } from './broadcaster';

interface ConnectedIntegration {
    id: string;
    family_id: string;
    type: string;
    base_url: string;
    encrypted_credentials: string | null;
    config: Record<string, unknown> | null;
}

async function runAutoSync(): Promise<void> {
    try {
        const { rows } = await query(
            `SELECT id, family_id, type, base_url, encrypted_credentials, config
             FROM integrations
             WHERE status = 'connected'`
        );

        if (rows.length === 0) return;

        logger.info('auto_sync.start', { count: rows.length });

        for (const integ of rows as ConnectedIntegration[]) {
            try {
                let res: { imported: number; errors: number } | undefined;
                switch (integ.type) {
                    case 'google_calendar':
                    case 'googlecalendar':
                        res = await syncGoogleCalendar(integ.id, integ.family_id, integ.base_url, integ.encrypted_credentials, integ.config || {});
                        break;
                    case 'nextcloud':
                        if (integ.encrypted_credentials) {
                            res = await syncNextcloud(integ.id, integ.family_id, integ.base_url, integ.encrypted_credentials, integ.config || {});
                        }
                        break;
                    case 'mealie':
                        if (integ.encrypted_credentials) {
                            res = await syncMealie(integ.id, integ.family_id, integ.base_url, integ.encrypted_credentials);
                        }
                        break;
                    case 'tandoor':
                        if (integ.encrypted_credentials) {
                            res = await syncTandoor(integ.id, integ.family_id, integ.base_url, integ.encrypted_credentials);
                        }
                        break;
                    case 'homeassistant':
                        if (integ.encrypted_credentials) {
                            res = await syncHomeAssistant(integ.id, integ.family_id, integ.base_url, integ.encrypted_credentials, integ.config || {});
                        }
                        break;
                    case 'grocy':
                        if (integ.encrypted_credentials) {
                            res = await syncGrocy(integ.id, integ.family_id, integ.base_url, integ.encrypted_credentials);
                        }
                        break;
                    case 'immich':
                        if (integ.encrypted_credentials) {
                            res = await syncImmich(integ.id, integ.family_id, integ.base_url, integ.encrypted_credentials);
                        }
                        break;
                }

                await query(
                    "UPDATE integrations SET last_synced_at = NOW(), last_error = NULL, updated_at = NOW() WHERE id = $1",
                    [integ.id]
                );

                if (res) {
                    broadcast(integ.family_id, { type: 'update', entity: 'integrations', action: 'synced' });
                }
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                logger.warn('auto_sync.integration_failed', { integrationId: integ.id, type: integ.type, error: msg });
                await query(
                    "UPDATE integrations SET status = 'error', last_error = $2, updated_at = NOW() WHERE id = $1",
                    [integ.id, msg]
                );
            }
        }
    } catch (err) {
        logger.error('auto_sync.error', { error: err instanceof Error ? err.message : String(err) });
    }
}

export function startAutoSyncScheduler(): void {
    const tz = process.env.TZ ?? 'America/Sao_Paulo';

    // Run every 15 minutes
    cron.schedule('*/15 * * * *', () => {
        void runAutoSync();
    }, { timezone: tz });

    // Also run an initial sync 10 seconds after server startup
    setTimeout(() => {
        void runAutoSync();
    }, 10_000);

    logger.info('auto_sync.scheduler_started', { timezone: tz, interval: 'every 15 minutes' });
}
