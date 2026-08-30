## 2026-08-30T07:21:09Z

You are Explorer M1-2 (Kiosk API & WebSocket Specialist).
Your working directory is: c:\Users\filip\.gemini\antigravity\scratch\homelab-management\OpenFamily\.agents\explorer_m1_2
Project root: c:\Users\filip\.gemini\antigravity\scratch\homelab-management\OpenFamily
Original User Request: c:\Users\filip\.gemini\antigravity\scratch\homelab-management\OpenFamily\.agents\ORIGINAL_REQUEST.md
Master Project Plan: c:\Users\filip\.gemini\antigravity\scratch\homelab-management\OpenFamily\PROJECT.md

MANDATORY: Read ORIGINAL_REQUEST.md and PROJECT.md first.

Your mission for Milestone 1 (Backend Database, Auth & Kiosk Devices API):
1. Investigate server/src/routes/kioskToken.ts and server/src/app.ts.
2. Define the exact implementation details for:
   - GET /api/kiosk/devices: list all active (non-revoked) devices for the family/user.
   - DELETE /api/kiosk/devices/:id: revoke device (evoked_at = NOW()), verify authorization, broadcast event.
   - POST /api/kiosk/pair/authorize: insert record in kiosk_devices, link device ID to generated token.
   - POST /api/kiosk/heartbeat: update last_active_at timestamp.
3. Investigate server/src/lib/broadcaster.ts: add 'kiosk' entity to WsEntity, define broadcast payload for device unlinking/revocation.
4. Detail error handling, validation, status codes (400, 401, 403, 404, 500).
5. Write your findings to nalysis.md and handoff.md in your working directory.

Send a message to parent when done.
