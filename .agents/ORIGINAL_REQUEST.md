# Original User Request

## 2026-08-30T07:11:30Z

Implement a Universal Kiosk Mode for OpenFamily that works in any web browser (Smart TVs, Smart Refrigerators, Wall Tablets) with ultra-responsive QR Code pairing, lean display settings, and remote device unlinking management in the main Dashboard Settings.

Working directory: c:\Users\filip\.gemini\antigravity\scratch\homelab-management\OpenFamily
Integrity mode: development

## Requirements

### R1. Universal & Responsive Kiosk Mode (`/kiosk`)
- Remove hardcoded 42" Smart Display labels from the unauthenticated pairing screen.
- Ensure the QR Code and 6-digit pairing code layout is ultra-responsive across display viewports from 7-inch smart fridge screens (e.g. 800x1280, 1024x600) to 75-inch 4K TVs.
- Keep header controls focused on essential display features: Night Dimmer, Zoom, Dark Mode, and Weather.
- Fix modal scroll and density issues so Close `[X]` headers and footers remain sticky and accessible on all TV/screen viewports.

### R2. Kiosk Devices Management & Remote Unlinking
- Add a Kiosk Devices management section to the main OpenFamily Dashboard (`/settings`).
- Display a list of currently linked Kiosk display devices (name, last active timestamp, IP/browser details).
- Provide a "Desvincular Dispositivo" (Unlink Device) action button that revokes the kiosk token.
- Ensure unlinked devices immediately lose access and redirect back to the `/kiosk` QR Code pairing screen.

## Acceptance Criteria

### Functionality & Responsiveness
- [ ] `/kiosk` displays a clean, responsive pairing UI without hardcoded screen size references.
- [ ] QR code and pairing code scale fluidly without overflowing or clipping on compact viewports (7") and large TVs.
- [ ] Settings modal has sticky header `[X]` and sticky footer `[Fechar]`, preventing clipped close buttons.
- [ ] Dashboard `/settings` lists linked kiosk displays and revokes access when "Desvincular" is clicked.
- [ ] Frontend code compiles cleanly with `npm run build` with zero TypeScript errors.
