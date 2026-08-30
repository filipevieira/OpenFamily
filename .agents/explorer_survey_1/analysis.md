# Comprehensive Survey & Frontend Analysis: Universal Kiosk Mode

**Date:** 2026-08-30  
**Target:** OpenFamily Frontend Kiosk (`/kiosk`), Pairing Screen (`/pair` & `/kiosk`), Header Controls, Settings Modal, and Device Management  
**Author:** Explorer 1 (Frontend Kiosk Explorer)

---

## 1. Executive Summary

OpenFamily contains an existing dedicated Kiosk mode located at `/kiosk` (`client/src/pages/Kiosk.tsx`), implemented as a chrome-less, full-screen dashboard suitable for wall displays and smart home appliances. When a device accesses `/kiosk` without a valid token in localStorage or URL parameters, it renders a TV pairing screen (Netflix/HBO style 6-digit code and QR code).

However, our investigation reveals several critical issues:
1. **Hardcoded Device References & Localization Gaps:** The unauthenticated pairing screen contains hardcoded references such as the label **`Modo Smart Display 42"`** and raw, non-internationalized Portuguese strings, breaking support for 7" smart fridges, small wall tablets, and multilingual households.
2. **Viewport Scaling & Clipping on Compact / Large Displays:** The pairing screen uses fixed pixel dimensions (`w-60 h-60` for QR codes), large rigid paddings (`p-8 lg:p-14`), and a 2-column grid triggered at `lg:` (1024px) without viewport height awareness. On a 1024x600 (7" fridge screen) or 800x1280 (portrait tablet), the layout overflows and clips. On a 75" 4K TV (3840x2160), the QR code is too small to scan from couch distance and constrained by `max-w-6xl`.
3. **Modal Density & Overflow Inconsistencies:** While the Display Settings modal has sticky headers and footers, the **Ambient Sounds modal** lacks `max-h` containment, sticky headers/footers, and scrollability, causing severe truncation on viewports with height <= 600px.
4. **Lack of Remote Unlinking / Device Invalidation Handling in Frontend:** The dashboard (`/settings`) currently only links to `/kiosk` without listing connected devices or offering an "Unlink Device" (Desvincular) button. Moreover, `Kiosk.tsx` does not listen to `AUTH_EXPIRED_EVENT` or 401 response statuses to clear `openfamily.kioskToken` and switch back to `hasToken = false`.

---

## 2. Detailed Architecture of Kiosk Mode (`/kiosk`)

### 2.1 Routing & Authentication Gate
- **Route Definition (`client/src/App.tsx`, lines 64–68):**
  Mounted before the standard `!isAuthenticated` check:
  ```tsx
  // Kiosk is a full-screen, chrome-less display — render it outside the Layout.
  // Must be evaluated BEFORE !isAuthenticated so unauthenticated TVs show the Netflix QR pairing screen!
  if (location.pathname === '/kiosk') {
      return isModuleEnabled('kiosk') ? <Kiosk /> : <Navigate to="/" replace />;
  }
  ```
- **State Initialization (`client/src/pages/Kiosk.tsx`, lines 177–180):**
  ```tsx
  const [hasToken, setHasToken] = useState<boolean>(() => {
      const urlParams = new URLSearchParams(window.location.search);
      return Boolean(urlParams.get('token') || api.getToken() || localStorage.getItem('openfamily.kioskToken'));
  });
  ```
- **Pairing Polling Loop (`client/src/pages/Kiosk.tsx`, lines 183–217):**
  When `!hasToken`, it issues `POST /api/kiosk/pair/init` to receive a temporary 6-digit `code`, then polls `GET /api/kiosk/pair/status?code=...` every 2000ms. Once authorized, it stores the token in `localStorage['openfamily.kioskToken']` and `api.setToken()`, setting `hasToken = true`.

### 2.2 Data Fetching & Real-Time Sync
- **Aggregated Load (`client/src/pages/Kiosk.tsx`, lines 243–275):**
  Executes `Promise.all` across 6 endpoints:
  - `/api/appointments?start_date=...&end_date=...` (Today's events)
  - `/api/tasks` (Pending family chores)
  - `/api/meal-plans?start_date=...&end_date=...` (Today's breakfast, lunch, dinner, snacks)
  - `/api/planning?week_start=...` (Who's where / whereabouts)
  - `/api/shopping` (Unchecked shopping items)
  - `/api/notes` (Family post-it notes)
- **Live Updates:** Polled every 60s + subscribed to WebSocket channels via `useWebSocketUpdates` for all 6 entities.
- **Clock & Date:** Updates every 15s using `Intl.DateTimeFormat` with `intlLocale()`.

### 2.3 Audio Engine & Background Sounds
- Uses `client/src/lib/soundEngine.ts` to synthesize procedural ambient noise (Rain, Campfire, Waves, White Noise, Forest, Cat Purr).
- Accessible via header action bar button (`Music` icon) and ambient sound modal.
- Active sound widget displayed at top of Kiosk view when audio is playing.

---

## 3. The Pairing Screen: Analysis of Flaws & Hardcoded Values

### 3.1 Hardcoded Strings & Labels
In `client/src/pages/Kiosk.tsx` (lines 438–514):
1. **Line 446:** `Modo Smart Display 42"` — Rigidly asserts a 42" display size regardless of device.
2. **Line 444:** `OpenFamily TV` — Fixed text.
3. **Line 454:** `Autenticação Fácil de TV`
4. **Line 456:** `Conecte sua TV em segundos`
5. **Line 459:** `Não precisa usar o controle remoto para digitar sua senha. Use a câmera do seu celular!`
6. **Lines 465–475:** `PASSO 1: Abra a câmera do seu celular`, `PASSO 2: Aponte para o QR Code ao lado`, `PASSO 3: Toque em "Autorizar esta TV" no celular`
7. **Line 490:** `Gerando QR Code...`
8. **Line 495:** `Ou acesse no celular:`
9. **Line 504:** `Aguardando autorização pelo celular...`
10. **Line 511:** `OpenFamily Smart Display • {window.location.hostname}`

*Recommendation:* All pairing screen text must be extracted to `client/src/i18n/locales/{en,fr,pt,zh}/kiosk.json` under `kiosk:pairing.*` keys. The hardcoded `42"` badge should be replaced with a generic or viewport-aware label (e.g. `Modo Kiosk Universal` / `Universal Kiosk Display`).

### 3.2 Viewport Responsiveness Breakdown

| Target Device | Typical Resolution | Aspect Ratio | Current Behavior / Issues | Recommended Fix |
|---|---|---|---|---|
| **7" Smart Fridge / Compact Countertop** | 1024 x 600 | ~17:10 | Triggers `lg:` (2 columns), but height (600px) is severely constrained. Large padding (`p-8 lg:p-14`), 240px QR box, step headers, and footer cause vertical clipping. | Compact vertical layout; reduce padding to `p-3 md:p-6`; clamp QR code (`clamp(120px, 20vh, 220px)`); compact steps. |
| **7"–10" Wall Tablet (Portrait)** | 800 x 1280 | 10:16 | Collapses to 1 column (`grid-cols-1`). Steps and QR card stack. 1280px height fits, but vertical spacing feels loose and header/footer margins are disproportionate. | Centered 1-col layout with fluid gap (`gap-4 md:gap-8`); prominent QR and 6-digit code. |
| **Standard Smart TV (1080p)** | 1920 x 1080 | 16:9 | 2-column layout renders well, but 240px QR code is somewhat small at 3 meters viewing distance. | QR code fluid size up to 280–320px; font size clamp for high visibility. |
| **Large Smart TV (4K)** | 3840 x 2160 | 16:9 | Constrained by `max-w-6xl` (1152px) creating huge empty side margins. 240px QR code is minuscule (1/16th screen height). | Remove or expand `max-w-7xl` / `max-w-[1600px]`; scale QR code up to 400px+; scale 6-digit code font to `text-6xl` or `clamp()`. |

---

## 4. QR Code and 6-Digit Pairing Code Strategy

### 4.1 QR Code Generation
- **Current Generator URL:**
  `https://api.qrserver.com/v1/create-qr-code/?size=260x260&data=${encodeURIComponent(`${window.location.origin}/pair?code=${pairingCode}`)}`
- **Current Image Rendering:** `className="w-60 h-60 object-contain"`
- **Assessment:**
  - `api.qrserver.com` provides clean PNG QR codes without client-side canvas dependencies.
  - To support responsive scaling without pixelation, the requested size parameter should match or exceed high DPI (e.g. `size=400x400` or `size=500x500`), while the CSS container scales smoothly with `w-[clamp(140px,25vw,360px)] h-[clamp(140px,25vw,360px)]` or `max-h-[35vh] max-w-[35vh] aspect-square`.

### 4.2 6-Digit Pairing Code
- **Formatting:** `${code.slice(0, 3)} - ${code.slice(3)}` with monospace font.
- **Card Styling:** `bg-[#110a18] py-3 px-6 rounded-2xl border border-primary/30 shadow-inner font-mono font-bold tracking-widest text-white`.
- **Scaling:** Use `text-[clamp(1.75rem,4vw,3.5rem)]` so the code remains readable on small 7" screens without line-wrapping, and bold and clear on 75" TVs.

---

## 5. Header Controls & Accessibility

### 5.1 Controls Inventory
1. **Clock & Date:** Fraunces serif font with `clamp(3rem, 9vw, 7rem)`. Tabular figures prevent jitter.
2. **Weather Widget:** Open-Meteo REST API (`https://api.open-meteo.com/v1/forecast`), refreshed every 30 mins. Shows current temperature, WMO weather icon, high/low, and 4-hour forecast when width permits (`xl:flex`).
3. **Floating Action Bar:**
   - **Ambient Sounds:** Pulsing indicator when active; opens audio modal.
   - **Quick Night Dimmer:** Cycles `[100, 75, 50, 30, 15]%` directly from header; applies CSS filter `brightness(X%)` on the whole page.
   - **Display Settings:** Opens configuration modal.
   - **Fullscreen Toggle:** Native HTML5 fullscreen API (`requestFullscreen` / `exitFullscreen`).
   - **Exit Button:** Navigates to `/`.

### 5.2 Per-Device Settings Schema (`localStorage['openfamily.kioskSettings']`)
```typescript
interface KioskSettings {
    location: { name: string; lat: number; lon: number } | null;
    photoBackground: boolean;
    darkMode: boolean;
    zoom: number;       // 0.6 to 1.6 (default 1.0)
    brightness: number; // 15 to 100 (default 100)
}
```

---

## 6. Modals Deep-Dive: Scroll, Density & Sticky Controls

### 6.1 Display Settings Modal (`settingsOpen`)
- **Structure:**
  - Outer: `fixed inset-0 z-50 flex items-center justify-center p-4`
  - Dialog Box: `max-h-[85vh] w-full max-w-md flex flex-col overflow-hidden rounded-card border bg-card shadow-2xl`
  - Header: `sticky top-0 z-20 flex shrink-0 items-center justify-between border-b p-4`
  - Body: `flex-1 overflow-y-auto p-5 space-y-5`
  - Footer: `sticky bottom-0 z-20 flex shrink-0 items-center justify-end border-t p-3`
- **Assessment:** Sticky header `[X]` and sticky footer `[Fechar Configurações]` work well, but the body contains 7 dense sections. Adding smooth scrollbar utilities (`scrollbar-thin` or custom styling) and compact padding on small heights (`sm:p-5 p-3.5`) improves usability.

### 6.2 Ambient Sounds Modal (`soundsOpen`) — Critical Bug Identified!
- **Current Structure (Lines 1166–1223):**
  ```tsx
  <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-md" onClick={() => setSoundsOpen(false)} />
      <div className="relative w-full max-w-lg rounded-card border border-border bg-card p-6 shadow-2xl">
          {/* Missing max-h, missing overflow-y-auto, missing flex-col, missing sticky footer */}
      </div>
  </div>
  ```
- **Defect:** On screens with height <= 600px (e.g. 1024x600 smart fridges), this modal exceeds the viewport height. The active sound controls and bottom presets become unreachable because the dialog box cannot scroll.
- **Remedy:** Convert `soundsOpen` modal to use the exact same flex-column container pattern with `max-h-[85vh] flex flex-col overflow-hidden`, sticky header with close `[X]`, `flex-1 overflow-y-auto p-5`, and sticky footer `[Fechar]`.

---

## 7. Kiosk Devices Management & Remote Unlinking (R2)

### 7.1 Current State in Dashboard Settings (`client/src/pages/Settings.tsx`)
- Lines 860–878 currently contain only a basic informational card:
  - Title: `Modo Quiosque / Tela da Casa`
  - Subtitle: Description of kiosk mode
  - Action: Button "Abrir modo quiosque" (`<Link to="/kiosk">`)
- There is **no list of connected devices**, no device metadata (IP, browser, last active), and **no unlinking/revocation action**.

### 7.2 Requirements for Device Management Section
1. **Device List Component (`KioskDevicesCard`):**
   - Query connected kiosk displays for the family (`GET /api/kiosk/devices`).
   - For each device, render:
     - Device display name / user-agent summary (e.g. "Samsung Smart TV", "Kitchen Wall Tablet - Chrome")
     - Last active relative timestamp (e.g. "Ativo há 2 minutos")
     - IP Address / connection metadata
     - Action button: **"Desvincular Dispositivo"** (Unlink Device) with confirmation dialog or direct destructive action.
2. **Immediate Remote Invalidation Flow:**
   - When "Desvincular" is clicked, client sends `DELETE /api/kiosk/devices/:id` (or `POST /api/kiosk/devices/:id/revoke`).
   - Server revokes the token / device session.
   - On the Kiosk display:
     - When the next periodic poll (`loadAll()`) or WebSocket message fails with 401 Unauthorized, `api.ts` fires `openfamily:auth-expired`.
     - `Kiosk.tsx` must handle this event:
       1. Clear `localStorage.removeItem('openfamily.kioskToken')`
       2. Clear `api.setToken(null)`
       3. Reset state: `setHasToken(false)`
       4. Transition immediately to the QR Code pairing screen.

---

## 8. Catalog of Relevant Files & Styling Patterns

### 8.1 Relevant Files

| File Path | Role / Content |
|---|---|
| `client/src/pages/Kiosk.tsx` | Main Kiosk view, unauthenticated pairing screen, header controls, display settings modal, sounds modal. |
| `client/src/pages/PairTV.tsx` | Authenticated mobile screen where family member enters 6-digit code or approves TV from scanned QR code. |
| `client/src/pages/Settings.tsx` | Main Dashboard settings; integration site for Kiosk Devices Management & remote unlinking list. |
| `client/src/App.tsx` | Route definitions (`/kiosk`, `/pair`, `/settings`). |
| `client/src/lib/api.ts` | API client with token storage, 401 interception, and `AUTH_EXPIRED_EVENT`. |
| `client/src/lib/soundEngine.ts` | Web Audio API ambient sound generator and preset definitions. |
| `client/src/components/app/FamilyNotes.tsx` | Post-it notes rendered on kiosk dashboard. |
| `client/src/i18n/locales/*/kiosk.json` | Internationalization strings for kiosk display and pairing (en, fr, pt, zh). |
| `client/src/i18n/locales/*/settings.json` | Internationalization strings for settings and device management. |
| `server/src/routes/kioskToken.ts` | Server endpoints for pairing init, status polling, authorization, and token issuance. |
| `server/src/middleware/auth.ts` | JWT auth verification, kiosk token generation (`generateKioskToken`). |

### 8.2 UI Framework & Styling Conventions
- **Tailwind CSS v3.4.0** with semantic tokens (`bg-card`, `bg-surface-2`, `text-primary`, `border-border`, etc.).
- **Typography:**
  - `Fraunces` (Editorial Serif) for headers, clock, section titles, note contents.
  - `Instrument Sans` for body copy, labels, metadata, captions.
  - `font-mono` for 6-digit pairing codes and tokens.
- **Icons:** `lucide-react` (e.g. `Tv`, `QrCode`, `Sun`, `Moon`, `ZoomIn`, `ZoomOut`, `Maximize2`, `Minimize2`, `X`, `Music`, `Trash2`).
- **Translations:** `useTranslation(['kiosk', 'settings', 'common'])` using `react-i18next`.

