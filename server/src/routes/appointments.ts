import { Router } from 'express';
import { query } from '../db';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { toNullIfEmpty } from '../lib/normalize';
import { broadcast } from '../lib/broadcaster';
import {
    getValidAccessToken,
    createGoogleCalendarEvent,
    updateGoogleCalendarEvent,
    deleteGoogleCalendarEvent,
} from '../services/integrations/googlecalendar';

const router = Router();
router.use(authMiddleware);

const ensureMembersBelongToUser = async (memberIds: string[], userId: string) => {
    for (const memberId of memberIds) {
        const member = await query(
            'SELECT id FROM family_members WHERE id = $1 AND user_id = $2',
            [memberId, userId]
        );
        if (member.rows.length === 0) {
            throw new Error('INVALID_MEMBER');
        }
    }
};

const enrichAppointmentsWithMembers = async (appointments: any[], userId: string) => {
    if (appointments.length === 0) return appointments;
    const membersResult = await query(
        'SELECT id, name, color FROM family_members WHERE user_id = $1',
        [userId]
    );
    const membersById = new Map(membersResult.rows.map((m: any) => [m.id, m]));
    return appointments.map((apt) => {
        const familyMemberIds: string[] = Array.isArray(apt.family_member_ids) ? apt.family_member_ids : [];
        return {
            ...apt,
            family_member_ids: familyMemberIds,
            family_members_data: familyMemberIds.map((id) => membersById.get(id)).filter(Boolean),
        };
    });
};

// Get all appointments
router.get('/', async (req: AuthRequest, res) => {
    try {
        const { start_date, end_date } = req.query;

        let queryText = 'SELECT * FROM appointments WHERE user_id = $1';
        const params: any[] = [req.userId];

        if (start_date) {
            params.push(start_date);
            queryText += ` AND COALESCE(end_time, start_time) >= $${params.length}`;
        }

        if (end_date) {
            params.push(end_date);
            queryText += ` AND start_time <= $${params.length}`;
        }

        queryText += ' ORDER BY start_time ASC';

        const result = await query(queryText, params);
        const appointments = await enrichAppointmentsWithMembers(result.rows, req.userId!);
        res.json({ success: true, data: appointments });
    } catch (error) {
        console.error('Get appointments error:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// Create appointment
router.post('/', async (req: AuthRequest, res) => {
    try {
        const {
            title,
            description,
            start_time,
            end_time,
            location,
            family_member_ids,
            reminder_30min,
            reminder_1hour,
            notes,
        } = req.body;

        const cleanedTitle = typeof title === 'string' ? title.trim() : '';
        const startTime = toNullIfEmpty(start_time);

        if (!cleanedTitle || !startTime) {
            return res.status(400).json({ success: false, error: 'Title and start_time are required' });
        }

        const memberIds: string[] = Array.isArray(family_member_ids)
            ? family_member_ids.filter((id: any) => typeof id === 'string' && id.trim())
            : [];
        await ensureMembersBelongToUser(memberIds, req.userId!);

        const result = await query(
            `INSERT INTO appointments (user_id, title, description, start_time, end_time, location, family_member_ids, reminder_30min, reminder_1hour, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10) RETURNING *`,
            [
                req.userId,
                cleanedTitle,
                toNullIfEmpty(description),
                startTime,
                toNullIfEmpty(end_time),
                toNullIfEmpty(location),
                JSON.stringify(memberIds),
                Boolean(reminder_30min),
                Boolean(reminder_1hour),
                toNullIfEmpty(notes),
            ]
        );

        // Trigger instant Google Calendar creation if connected
        try {
            const { accessToken, calendarId } = await getValidAccessToken('', req.userId!);
            const gres = await createGoogleCalendarEvent(accessToken, calendarId, {
                title: cleanedTitle,
                location: (toNullIfEmpty(location) as string | undefined) || undefined,
                notes: (toNullIfEmpty(notes) as string | undefined) || undefined,
                specificDate: typeof startTime === 'string' ? startTime.split('T')[0] : undefined,
                startTime: typeof startTime === 'string' && startTime.includes('T') ? startTime.split('T')[1] : '09:00:00',
                endTime: typeof end_time === 'string' && end_time.includes('T') ? end_time.split('T')[1] : undefined,
            });
            if (gres.googleEventId) {
                await query("UPDATE appointments SET google_event_id = $1, sync_source = 'google' WHERE id = $2", [gres.googleEventId, result.rows[0].id]);
            }
        } catch {}

        const [enriched] = await enrichAppointmentsWithMembers([result.rows[0]], req.userId!);
        broadcast(req.userId!, { type: 'update', entity: 'appointments', action: 'created' });
        res.json({ success: true, data: enriched });
    } catch (error) {
        if (error instanceof Error && error.message === 'INVALID_MEMBER') {
            return res.status(400).json({ success: false, error: 'Family member not found' });
        }

        console.error('Create appointment error:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// Update appointment
router.put('/:id', async (req: AuthRequest, res) => {
    try {
        const { id } = req.params;
        const {
            title,
            description,
            start_time,
            end_time,
            location,
            family_member_ids,
            reminder_30min,
            reminder_1hour,
            notes,
        } = req.body;

        const existingApt = await query('SELECT title, google_event_id, start_time, end_time, location, notes FROM appointments WHERE id = $1 AND user_id = $2', [id, req.userId]);
        const currentApt = existingApt.rows[0];

        const updates: string[] = [];
        const values: any[] = [];

        const pushUpdate = (field: string, value: any) => {
            values.push(value);
            updates.push(`${field} = $${values.length}`);
        };

        if (title !== undefined) {
            const cleanedTitle = typeof title === 'string' ? title.trim() : '';
            if (!cleanedTitle) {
                return res.status(400).json({ success: false, error: 'Title cannot be empty' });
            }
            pushUpdate('title', cleanedTitle);
        }

        if (description !== undefined) {
            pushUpdate('description', toNullIfEmpty(description));
        }

        if (start_time !== undefined) {
            const startTime = toNullIfEmpty(start_time);
            if (!startTime) {
                return res.status(400).json({ success: false, error: 'start_time cannot be empty' });
            }
            pushUpdate('start_time', startTime);
        }

        if (end_time !== undefined) {
            pushUpdate('end_time', toNullIfEmpty(end_time));
        }

        if (location !== undefined) {
            pushUpdate('location', toNullIfEmpty(location));
        }

        if (family_member_ids !== undefined) {
            const memberIds: string[] = Array.isArray(family_member_ids)
                ? family_member_ids.filter((mid: any) => typeof mid === 'string' && mid.trim())
                : [];
            await ensureMembersBelongToUser(memberIds, req.userId!);
            values.push(JSON.stringify(memberIds));
            updates.push(`family_member_ids = $${values.length}::jsonb`);
        }

        if (reminder_30min !== undefined) {
            pushUpdate('reminder_30min', Boolean(reminder_30min));
        }

        if (reminder_1hour !== undefined) {
            pushUpdate('reminder_1hour', Boolean(reminder_1hour));
        }

        if (notes !== undefined) {
            pushUpdate('notes', toNullIfEmpty(notes));
        }

        if (updates.length === 0) {
            return res.status(400).json({ success: false, error: 'No fields to update' });
        }

        const result = await query(
            `UPDATE appointments
       SET ${updates.join(', ')}
       WHERE id = $${values.length + 1} AND user_id = $${values.length + 2}
       RETURNING *`,
            [...values, id, req.userId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Appointment not found' });
        }

        // Trigger instant Google Calendar update if connected
        try {
            const { accessToken, calendarId } = await getValidAccessToken('', req.userId!);
            const gEventId = currentApt?.google_event_id;
            const updatedTitle = typeof title === 'string' ? title.trim() : (currentApt?.title || '');
            const updatedStart = start_time || currentApt?.start_time;
            const updatedEnd = end_time !== undefined ? end_time : currentApt?.end_time;
            const updatedLoc = location !== undefined ? location : currentApt?.location;
            const updatedNotes = notes !== undefined ? notes : currentApt?.notes;

            const specificDate = typeof updatedStart === 'string' ? updatedStart.split('T')[0] : undefined;
            const startTimeStr = typeof updatedStart === 'string' && updatedStart.includes('T') ? updatedStart.split('T')[1] : '09:00:00';
            const endTimeStr = typeof updatedEnd === 'string' && updatedEnd.includes('T') ? updatedEnd.split('T')[1] : undefined;

            if (gEventId) {
                await updateGoogleCalendarEvent(accessToken, calendarId, gEventId, {
                    title: updatedTitle,
                    location: updatedLoc || undefined,
                    notes: updatedNotes || undefined,
                    specificDate,
                    startTime: startTimeStr,
                    endTime: endTimeStr,
                });
            } else {
                const gres = await createGoogleCalendarEvent(accessToken, calendarId, {
                    title: updatedTitle,
                    location: updatedLoc || undefined,
                    notes: updatedNotes || undefined,
                    specificDate,
                    startTime: startTimeStr,
                    endTime: endTimeStr,
                });
                if (gres.googleEventId) {
                    await query("UPDATE appointments SET google_event_id = $1, sync_source = 'google' WHERE id = $2", [gres.googleEventId, id]);
                }
            }
        } catch {}

        const [enriched] = await enrichAppointmentsWithMembers([result.rows[0]], req.userId!);
        broadcast(req.userId!, { type: 'update', entity: 'appointments', action: 'updated' });
        res.json({ success: true, data: enriched });
    } catch (error) {
        if (error instanceof Error && error.message === 'INVALID_MEMBER') {
            return res.status(400).json({ success: false, error: 'Family member not found' });
        }

        console.error('Update appointment error:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// Delete appointment
router.delete('/:id', async (req: AuthRequest, res) => {
    try {
        const { id } = req.params;

        const existingApt = await query('SELECT google_event_id FROM appointments WHERE id = $1 AND user_id = $2', [id, req.userId]);
        const gEventId = existingApt.rows[0]?.google_event_id;

        const result = await query(
            'DELETE FROM appointments WHERE id = $1 AND user_id = $2 RETURNING id',
            [id, req.userId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Appointment not found' });
        }

        if (gEventId) {
            try {
                const { accessToken, calendarId } = await getValidAccessToken('', req.userId!);
                await deleteGoogleCalendarEvent(accessToken, calendarId, gEventId);
            } catch {}
        }

        broadcast(req.userId!, { type: 'update', entity: 'appointments', action: 'deleted' });
        res.json({ success: true, message: 'Appointment deleted' });
    } catch (error) {
        console.error('Delete appointment error:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

export default router;
