// Google Calendar integration service — OAuth 2.0 + REST API v3.
// Uses native safeFetch for zero-dependency, lightweight REST calls.

import { query } from '../../db';
import { safeFetch } from '../../lib/safeFetch';
import { assertSafeIntegrationUrl } from '../../utils/urlGuard';
import { encryptCredentials, decryptCredentials } from '../../utils/crypto';
import logger from '../../lib/logger';

export const GOOGLE_OAUTH_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const GOOGLE_CALENDAR_API_BASE = 'https://www.googleapis.com/calendar/v3';

export const GOOGLE_CALENDAR_SCOPES = [
    'https://www.googleapis.com/auth/calendar.events',
    'https://www.googleapis.com/auth/calendar.readonly',
].join(' ');

export interface GoogleOAuthTokens {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    token_type: string;
    scope?: string;
    expiry_date?: number;
}

export interface GoogleCalendarConfig {
    client_id: string;
    client_secret: string;
    calendar_id?: string;
    sync_direction?: 'bidirectional' | 'import_only' | 'export_only';
    auto_sync?: boolean;
}

export interface GoogleCalendarEvent {
    id: string;
    summary: string;
    description?: string;
    location?: string;
    start: { dateTime?: string; date?: string };
    end: { dateTime?: string; date?: string };
    status?: string;
}

/** Generate the OAuth 2.0 authorization URL for Google login. */
export function generateGoogleAuthUrl(clientId: string, redirectUri: string, state?: string): string {
    const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: GOOGLE_CALENDAR_SCOPES,
        access_type: 'offline',
        prompt: 'consent',
    });
    if (state) {
        params.append('state', state);
    }
    return `${GOOGLE_OAUTH_AUTH_URL}?${params.toString()}`;
}

/** Exchange authorization code for access and refresh tokens. */
export async function exchangeCodeForTokens(
    code: string,
    clientId: string,
    clientSecret: string,
    redirectUri: string
): Promise<GoogleOAuthTokens> {
    await assertSafeIntegrationUrl(GOOGLE_OAUTH_TOKEN_URL);

    const body = new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
    });

    const response = await safeFetch(GOOGLE_OAUTH_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
        timeoutMs: 15_000,
    });

    if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        logger.error('google_calendar.token_exchange_failed', { status: response.status, errorText });
        throw new Error(`Google OAuth token exchange failed: HTTP ${response.status}`);
    }

    const data = (await response.json()) as GoogleOAuthTokens;
    data.expiry_date = Date.now() + data.expires_in * 1000;
    return data;
}

/** Refresh access token using stored refresh token. */
export async function refreshGoogleAccessToken(
    refreshToken: string,
    clientId: string,
    clientSecret: string
): Promise<GoogleOAuthTokens> {
    await assertSafeIntegrationUrl(GOOGLE_OAUTH_TOKEN_URL);

    const body = new URLSearchParams({
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'refresh_token',
    });

    const response = await safeFetch(GOOGLE_OAUTH_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
        timeoutMs: 15_000,
    });

    if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        logger.error('google_calendar.token_refresh_failed', { status: response.status, errorText });
        throw new Error(`Google OAuth token refresh failed: HTTP ${response.status}`);
    }

    const data = (await response.json()) as GoogleOAuthTokens;
    data.expiry_date = Date.now() + data.expires_in * 1000;
    if (!data.refresh_token) {
        data.refresh_token = refreshToken; // Retain original refresh_token
    }
    return data;
}

/** Test connection by retrieving user's primary calendar metadata or calendar list. */
export async function testGoogleCalendarConnection(
    accessToken: string
): Promise<{ success: boolean; calendarTitle?: string; error?: string }> {
    try {
        await assertSafeIntegrationUrl(GOOGLE_CALENDAR_API_BASE);

        const response = await safeFetch(`${GOOGLE_CALENDAR_API_BASE}/users/me/calendarList/primary`, {
            method: 'GET',
            headers: { Authorization: `Bearer ${accessToken}` },
            timeoutMs: 15_000,
        });

        if (!response.ok) {
            return { success: false, error: `Google API HTTP ${response.status}` };
        }

        const data = (await response.json()) as { summary?: string };
        return { success: true, calendarTitle: data.summary || 'Primary Calendar' };
    } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
}

/** Fetch upcoming events from Google Calendar. */
export async function fetchGoogleCalendarEvents(
    accessToken: string,
    calendarId: string = 'primary',
    timeMin?: string
): Promise<GoogleCalendarEvent[]> {
    await assertSafeIntegrationUrl(GOOGLE_CALENDAR_API_BASE);

    const params = new URLSearchParams({
        singleEvents: 'true',
        orderBy: 'startTime',
        maxResults: '250',
    });

    if (timeMin) {
        params.append('timeMin', timeMin);
    } else {
        const startOfWeek = new Date();
        startOfWeek.setDate(startOfWeek.getDate() - 7);
        params.append('timeMin', startOfWeek.toISOString());
    }

    const url = `${GOOGLE_CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`;
    const response = await safeFetch(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}` },
        timeoutMs: 15_000,
    });

    if (!response.ok) {
        throw new Error(`Google Calendar list events failed: HTTP ${response.status}`);
    }

    const data = (await response.json()) as { items?: GoogleCalendarEvent[] };
    return data.items || [];
}

/** Sync Google Calendar events to OpenFamily schedule entries / appointments. */
export async function syncGoogleCalendar(
    integrationId: string,
    familyId: string,
    baseUrl: string,
    encryptedCredentials: string | null,
    config: Record<string, unknown> = {}
): Promise<{ imported: number; errors: number }> {
    if (!encryptedCredentials) {
        throw new Error('Google Calendar tokens missing');
    }

    const tokens = decryptCredentials(encryptedCredentials) as unknown as GoogleOAuthTokens;
    let accessToken = tokens.access_token;

    // Check if token expired and refresh if necessary
    if (tokens.expiry_date && Date.now() >= tokens.expiry_date - 60_000 && tokens.refresh_token) {
        const clientConfig = config as unknown as GoogleCalendarConfig;
        if (clientConfig.client_id && clientConfig.client_secret) {
            const newTokens = await refreshGoogleAccessToken(
                tokens.refresh_token,
                clientConfig.client_id,
                clientConfig.client_secret
            );
            accessToken = newTokens.access_token;
            // Update stored encrypted credentials
            const updatedEncrypted = encryptCredentials(newTokens as unknown as Record<string, string>);
            await query('UPDATE integrations SET encrypted_credentials = $1 WHERE id = $2', [updatedEncrypted, integrationId]);
        }
    }

    const events = await fetchGoogleCalendarEvents(accessToken, (config.calendar_id as string) || 'primary');
    let imported = 0;
    let errors = 0;

    for (const event of events) {
        try {
            if (!event.summary || !event.start) continue;

            const title = event.summary.slice(0, 255);
            const location = event.location ? event.location.slice(0, 255) : null;
            const userNotes = event.description ? event.description.slice(0, 450) : '';
            const gcalMarker = `[gcal:${event.id}]`;
            const fullNotes = userNotes ? `${userNotes}\n${gcalMarker}` : gcalMarker;

            // Handle date vs dateTime
            let specificDate: string | null = null;
            let startTime = '09:00:00';
            let endTime = '10:00:00';
            let dayOfWeek = 1;

            if (event.start.date) {
                specificDate = event.start.date;
                const d = new Date(event.start.date);
                dayOfWeek = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
            } else if (event.start.dateTime) {
                const startDate = new Date(event.start.dateTime);
                specificDate = startDate.toISOString().split('T')[0];
                const pad = (n: number) => String(n).padStart(2, '0');
                startTime = `${pad(startDate.getHours())}:${pad(startDate.getMinutes())}:00`;
                dayOfWeek = startDate.getDay() === 0 ? 7 : startDate.getDay();

                if (event.end?.dateTime) {
                    const endDate = new Date(event.end.dateTime);
                    endTime = `${pad(endDate.getHours())}:${pad(endDate.getMinutes())}:00`;
                }
            }

            // Check if entry already exists by matching title + date OR Google Event ID marker in notes
            const existing = await query(
                `SELECT id FROM schedule_entries WHERE user_id = $1 AND (notes LIKE $2 OR (title = $3 AND specific_date = $4))`,
                [familyId, `%${gcalMarker}%`, title, specificDate]
            );

            if (existing.rows.length > 0) {
                // Update existing event details in OpenFamily (time, location, notes, title)
                const existingId = existing.rows[0].id;
                await query(
                    `UPDATE schedule_entries
                     SET title = $1, start_time = $2, end_time = $3, specific_date = $4, location = $5, notes = $6, updated_at = NOW()
                     WHERE id = $7`,
                    [title, startTime, endTime, specificDate, location, fullNotes, existingId]
                );
            } else {
                // Insert new event
                const memberRes = await query('SELECT id FROM family_members WHERE user_id = $1 LIMIT 1', [familyId]);
                const memberId = memberRes.rows[0]?.id;

                if (memberId) {
                    await query(
                        `INSERT INTO schedule_entries
                         (user_id, family_member_id, schedule_type, title, day_of_week, start_time, end_time, specific_date, location, notes)
                         VALUES ($1, $2, 'other', $3, $4, $5, $6, $7, $8, $9)`,
                        [familyId, memberId, title, dayOfWeek, startTime, endTime, specificDate, location, fullNotes]
                    );
                    imported++;
                }
            }
        } catch (e) {
            errors++;
        }
    }

    return { imported, errors };
}
