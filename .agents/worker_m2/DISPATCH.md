## 2026-08-30T07:39:54Z
You are Worker M2 (Universal & Responsive Kiosk UI Developer).
Your working directory is: c:\Users\filip\.gemini\antigravity\scratch\homelab-management\OpenFamily\.agents\worker_m2
Project root: c:\Users\filip\.gemini\antigravity\scratch\homelab-management\OpenFamily
Original User Request: c:\Users\filip\.gemini\antigravity\scratch\homelab-management\OpenFamily\.agents\ORIGINAL_REQUEST.md
Master Project Plan: c:\Users\filip\.gemini\antigravity\scratch\homelab-management\OpenFamily\PROJECT.md
Explorer Survey 1: c:\Users\filip\.gemini\antigravity\scratch\homelab-management\OpenFamily\.agents\explorer_survey_1\handoff.md

MANDATORY: Read ORIGINAL_REQUEST.md and PROJECT.md first.

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

File Ownership: You have exclusive write ownership over:
- `client/src/pages/Kiosk.tsx`
- `client/src/contexts/WebSocketContext.tsx`
- `client/src/i18n/locales/en/kiosk.json`
- `client/src/i18n/locales/pt/kiosk.json`
- `client/src/i18n/locales/fr/kiosk.json`
- `client/src/i18n/locales/zh/kiosk.json`

Your mission:
1. `Kiosk.tsx` Pairing UI & Responsiveness:
   - Remove hardcoded `Modo Smart Display 42"` label (line 446). Use localized badge `{t('kiosk:pairing.modeBadge', 'Smart Display')}`.
   - Localize all hardcoded Portuguese pairing strings with `t('kiosk:pairing.*')` and populate `client/src/i18n/locales/{en,pt,fr,zh}/kiosk.json`.
   - Implement ultra-responsive fluid layout for the pairing view:
     - Fluid container with responsive padding (`p-3 sm:p-6 lg:p-10 max-w-6xl mx-auto`).
     - QR code image and wrapper scaled fluidly (`w-[clamp(140px,20vw,260px)] h-[clamp(140px,20vw,260px)] max-h-[28vh] object-contain`).
     - 6-digit code with fluid tracking and sizing (`text-2xl sm:text-3xl lg:text-4xl font-mono font-bold tracking-widest`).
     - Fits seamlessly on 7" smart fridge viewports (1024x600, 800x1280), desktop (1080p), and 75" 4K TVs without vertical clipping or overflow.
   - Header Controls:
     - Keep header controls focused on essential display features: Night Dimmer, Zoom, Dark Mode, Weather.
   - Modals:
     - Display Settings modal: ensure `max-h-[85vh] flex flex-col overflow-hidden` with sticky top `[X]` header and sticky bottom `[Fechar]` footer.
     - Ambient Sounds modal: refactor container to `max-h-[85vh] flex flex-col overflow-hidden` with sticky top `[X]` header and sticky bottom `[Fechar]` footer with `overflow-y-auto` body, preventing clipped close buttons on short viewports.
   - Token Invalidation & Instant Revocation:
     - Add window event listener for `openfamily:auth-expired`.
     - When received (or when an API error returns 401), remove `localStorage.removeItem('openfamily.kioskToken')`, set `hasToken = false`, and immediately transition to the pairing screen.
     - Also subscribe to WebSocket `kiosk` updates: if `event.action === 'deleted'` and `event.data?.revoked` or matching device, clear token and reset `hasToken = false`.
     - Add a periodic heartbeat interval calling `/api/kiosk/heartbeat` every 30s.
2. `WebSocketContext.tsx`:
   - Add `'kiosk'` to `WsEntity` in `client/src/contexts/WebSocketContext.tsx`.
3. Verify:
   - Run `node tests/e2e/runner.js`.
   - Output detailed handoff report to `c:\Users\filip\.gemini\antigravity\scratch\homelab-management\OpenFamily\.agents\worker_m2\handoff.md`.

Send a message to parent when done.
