# Handoff Report: Frontend Kiosk Survey & Technical Specification

**Author:** Explorer 1 (Frontend Kiosk Explorer)  
**Recipient:** Lead Orchestrator / Planner Agent  
**Date:** 2026-08-30  
**Handoff Type:** Hard (Survey Phase Complete)

---

## 1. Observation

1. **Hardcoded References in Pairing Screen:**
   - File `client/src/pages/Kiosk.tsx`, Line 446:
     ```tsx
     <div className="text-caption font-medium text-muted-foreground bg-surface/40 px-4 py-1.5 rounded-full border border-white/10">
         Modo Smart Display 42"
     </div>
     ```
   - Lines 444–511 contain un-localized Portuguese text strings (`"OpenFamily TV"`, `"Autenticação Fácil de TV"`, `"Conecte sua TV em segundos"`, `"Não precisa usar o controle remoto para digitar sua senha..."`, `"PASSO 1"`, `"PASSO 2"`, `"PASSO 3"`, `"Gerando QR Code..."`, `"Ou acesse no celular:"`, `"Aguardando autorização pelo celular..."`).
   - File `client/src/i18n/locales/{en,fr,pt,zh}/kiosk.json` currently lacks `kiosk:pairing.*` translation keys.

2. **Fixed Dimensions & Viewport Overflow:**
   - File `client/src/pages/Kiosk.tsx`, Lines 480–492:
     ```tsx
     <img
         src={`https://api.qrserver.com/v1/create-qr-code/?size=260x260&data=${encodeURIComponent(`${window.location.origin}/pair?code=${pairingCode}`)}`}
         alt="QR Code de Pareamento"
         className="w-60 h-60 object-contain"
     />
     ```
   - On a 1024x600 display (7" fridge screen), the outer padding (`p-8 lg:p-14`), 2-column grid (`gap-12`), 240px QR box, 6-digit code box, step list, and footer together exceed 600px vertical height, causing overflow and clipping.
   - On 4K displays (3840x2160), `max-w-6xl` restricts content to 1152px width, and 240px QR code is too small for living room couch scanning.

3. **Modal Density & Scroll Defects:**
   - Display Settings Modal (`Kiosk.tsx`, lines 893–908 & 1152–1160) implements `max-h-[85vh] flex flex-col overflow-hidden` with `sticky top-0` header and `sticky bottom-0` footer.
   - Ambient Sounds Modal (`Kiosk.tsx`, lines 1166–1223) uses a raw unconstrained container (`relative w-full max-w-lg rounded-card border bg-card p-6`) without `max-h`, without `overflow-y-auto`, and without sticky header/footer. On 600px viewports, bottom presets and stop controls are clipped offscreen.

4. **Missing Kiosk Devices Management in Settings:**
   - File `client/src/pages/Settings.tsx`, Lines 860–878 only renders a static link card:
     ```tsx
     <h3 className="text-caption font-semibold text-foreground">{t('kiosk:settings.title')}</h3>
     <p className="mt-1 text-micro text-muted-foreground">{t('kiosk:settings.subtitle')}</p>
     <Link to="/kiosk">
         <Button variant="secondary" size="sm" className="mt-4">
             <MonitorPlay className="mr-2 h-4 w-4" />
             {t('kiosk:settings.open')}
         </Button>
     </Link>
     ```
   - There is no device list, no last-active metadata, and no "Desvincular Dispositivo" (Unlink Device) action.

5. **Token Invalidation Handling in Kiosk Frontend:**
   - File `client/src/lib/api.ts` (lines 60–70) catches 401 Unauthorized, calls `this.setToken(null)`, and dispatches `openfamily:auth-expired`.
   - `client/src/pages/Kiosk.tsx` does NOT listen to `openfamily:auth-expired`, does NOT remove `localStorage['openfamily.kioskToken']`, and catches `loadAll()` errors silently without setting `hasToken = false`.

---

## 2. Logic Chain

1. **From Observation 1 & 2 to Universal Viewport Responsiveness:**
   - Because OpenFamily must run on 7" fridge screens (1024x600), wall tablets (800x1280), desktop displays (1080p), and 75" 4K TVs, hardcoding `42"` or fixed pixel heights/widths (`w-60 h-60`, `p-8 lg:p-14`, `gap-12`) directly causes display degradation and clipping on small devices while under-utilizing large screens.
   - Therefore, the pairing screen requires fluid typography (`clamp()`), dynamic QR sizing (`max-h-[30vh]` / `w-[clamp(140px,22vw,360px)]`), compact layout classes (`p-4 sm:p-8`), and i18n keys for all strings across `en`, `fr`, `pt`, and `zh`.

2. **From Observation 3 to Modal Stability:**
   - The Display Settings modal successfully proves that `max-h-[85vh] flex flex-col overflow-hidden` with `sticky top-0` and `sticky bottom-0` guarantees header `[X]` and footer `[Fechar]` visibility on any screen height.
   - The Ambient Sounds modal currently fails on small viewports because it lacks this exact pattern. Standardizing both modals to this flex-column structure guarantees accessibility across TV and appliance viewports.

3. **From Observation 4 & 5 to Remote Device Management & Invalidation:**
   - Fulfilling requirement R2 requires a two-way synchronization:
     - Dashboard `/settings` must list linked Kiosk displays and provide an unlinking button (`DELETE /api/kiosk/devices/:id`).
     - Once unlinked, the Kiosk screen must immediately react to 401 unauthorized errors or `openfamily:auth-expired` events, purge `localStorage['openfamily.kioskToken']`, and reset `hasToken` to `false`, instantly returning to the QR pairing screen.

---

## 3. Caveats

1. **Node Modules Installation:** `node_modules` is not yet installed in the current environment (`npm install` must be run before `npm run build`).
2. **Server-Side Device Registry:** The backend currently generates stateless JWTs in `server/src/routes/kioskToken.ts` without storing device records in PostgreSQL/SQLite. Implementing R2 requires adding device tracking and token revocation checks on the backend as well as frontend UI.
3. **Web Audio Autoplay Policies:** Some TV browsers require user interaction before playing Web Audio. The Ambient Sounds feature correctly binds to explicit click events.

---

## 4. Conclusion

The frontend codebase is well-structured with clear separation of concerns (Tailwind CSS tokens, Radix UI primitives, Lucide icons, and React 19). Universal Kiosk Mode can be achieved by:
1. **Refactoring `client/src/pages/Kiosk.tsx` Pairing Screen:**
   - Remove `42"` label, replace with generic/translated indicator.
   - Extract all strings to `src/i18n/locales/{en,fr,pt,zh}/kiosk.json`.
   - Implement fluid responsive layout with `clamp()` and height-constrained QR code.
   - Add auth expiration listener to reset `hasToken` upon remote unlinking.
2. **Standardizing Modals in `Kiosk.tsx`:**
   - Apply sticky header `[X]` and sticky footer `[Fechar]` with `max-h-[85vh] flex flex-col overflow-hidden` to both Display Settings and Ambient Sounds modals.
3. **Adding Kiosk Devices Management to `client/src/pages/Settings.tsx`:**
   - Create a `KioskDevicesCard` listing active displays with metadata and "Desvincular Dispositivo" actions.

---

## 5. Verification Method

To verify these findings and future implementation:
1. **Codebase Inspection:**
   - Verify `client/src/pages/Kiosk.tsx` lines 438–515 (pairing screen) and lines 890–1223 (modals).
   - Verify `client/src/pages/Settings.tsx` lines 860–878 (kiosk settings card).
2. **Viewport Simulation Testing:**
   - Test at **1024x600** (7" fridge screen): ensure no vertical clipping or inaccessible buttons.
   - Test at **800x1280** (portrait tablet): ensure stacked 1-col layout renders cleanly.
   - Test at **1920x1080** and **3840x2160** (HD and 4K TVs): verify QR code readability and layout scale.
3. **Build Command:**
   - `cd client && npm run build` (or `npm run build` from root after `npm install`) to ensure zero TypeScript errors.

