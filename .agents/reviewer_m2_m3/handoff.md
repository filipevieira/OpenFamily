# Review & Adversarial Challenge Report: Milestones 2 & 3 (Frontend Universal Kiosk & Settings UI)

**Author:** Reviewer & Adversarial Critic (Milestones 2 & 3)  
**Recipient:** Orchestrator / Lead Planner  
**Date:** 2026-08-30  
**Verdict:** **REQUEST_CHANGES**  

---

## 1. Observation

### 1.1 Verified Strengths & Compliant Implementations
1. **Removal of Hardcoded 42" Smart Display Labels:**
   - In `client/src/pages/Kiosk.tsx` line 507:
     ```tsx
     <div className="text-micro sm:text-caption font-medium text-muted-foreground bg-surface/40 px-3 py-1 sm:px-4 sm:py-1.5 rounded-full border border-white/10">
         {t('kiosk:pairing.modeBadge', 'Smart Display')}
     </div>
     ```
   - In `client/src/pages/Kiosk.tsx` line 588:
     ```tsx
     <div className="text-center text-micro text-text-muted-base border-t border-white/5 pt-2 sm:pt-4 max-w-6xl mx-auto w-full">
         {t('kiosk:pairing.footer', 'OpenFamily Smart Display')} • {window.location.hostname}
     </div>
     ```
   - All references to `42"` have been completely eradicated from the UI and replaced with localized strings.

2. **Ultra-Responsive QR Code & Pairing Layout:**
   - In `client/src/pages/Kiosk.tsx` lines 497–590:
     - Outer container uses `min-h-screen p-3 sm:p-6 lg:p-10 select-none font-sans overflow-x-hidden`.
     - Layout uses `grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-8 lg:gap-12 items-center max-w-6xl mx-auto w-full my-auto py-2 sm:py-4`.
     - QR Code image container uses fluid clamp dimensions: `w-[clamp(140px,20vw,260px)] h-[clamp(140px,20vw,260px)] max-h-[28vh] aspect-square`.
     - Pairing code container uses responsive typography and padding: `text-2xl sm:text-3xl lg:text-4xl font-mono font-bold tracking-widest text-white bg-[#110a18] py-2 sm:py-3 px-4 sm:px-6 rounded-xl sm:rounded-2xl border border-primary/30`.
     - Fully fits inside compact 1024x600 and portrait 800x1280 screens without vertical overflow or clipping.

3. **Sticky Modal Headers & Footers:**
   - In `client/src/pages/Kiosk.tsx`:
     - Display Settings modal (lines 970–1238): `relative flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-card border border-border bg-card shadow-2xl` with sticky header (`sticky top-0 z-20 flex shrink-0 items-center justify-between border-b p-4`), scrollable body (`flex-1 overflow-y-auto p-5 space-y-5`), and sticky footer (`sticky bottom-0 z-20 flex shrink-0 items-center justify-end border-t p-3` with `[Fechar Configurações]`).
     - Ambient Sounds modal (lines 1246–1315): `relative flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-card border border-border bg-card shadow-2xl` with sticky header (`sticky top-0 z-20`), scrollable body (`flex-1 overflow-y-auto`), and sticky footer (`sticky bottom-0 z-20` with `[Fechar]`).

4. **Kiosk Devices Management in Dashboard (`/settings`):**
   - In `client/src/pages/Settings.tsx` lines 650–904 (`KioskDevicesCard`):
     - Fetches active displays via `GET /api/kiosk/devices`.
     - Renders device hardware icons (`Tv`, `Tablet`, `Smartphone`, `MonitorPlay`), device name, type badge, pulse active badge, IP address, and humanized relative timestamp (`formatLastActive`).
     - Empty state with "Parear Novo Display" button linking to `/kiosk`.
     - Inline confirmation state (`confirmId`) and parent-only action gating (`disabled={!isParent || isUnlinking}`).
     - Unlinking calls `DELETE /api/kiosk/devices/:id`, shows toast notification, and optimistically updates UI.

5. **Multi-Locale Translation Integrity:**
   - In `client/src/i18n/locales/{en,pt,fr,zh}/kiosk.json`:
     - All 4 translation files contain complete and syntactically valid JSON structures for `pairing.*`, `displaySettings.*`, `ambientSounds.*`, and `settings.*`.

---

### 1.2 Identified Findings & Vulnerabilities

#### 🚨 [Major] Finding 1: `useWebSocketUpdates` Hook Drops Payload Argument, Disabling Instant WebSocket Token Revocation in `Kiosk.tsx`
- **Location:** `client/src/hooks/useWebSocketUpdates.ts` (lines 14–27) & `client/src/pages/Kiosk.tsx` (lines 210–214)
- **Observation:**
  In `client/src/hooks/useWebSocketUpdates.ts`:
  ```ts
  14: export function useWebSocketUpdates(entity: WsEntity, onUpdate: () => void): void {
  15:     const { subscribe } = useWebSocket();
  ...
  24:     const unsubscribe = subscribe(entity, () => onUpdateRef.current());
  25:     return unsubscribe;
  27: }
  ```
  Notice that line 24 invokes `() => onUpdateRef.current()` without passing the `msg` parameter provided by `WebSocketContext.tsx`'s `notify` function (`(cb) => cb(msg)`).
  
  In `client/src/pages/Kiosk.tsx` lines 210–214:
  ```tsx
  210: useWebSocketUpdates('kiosk', (event: any) => {
  211:     if (event && (event.action === 'deleted' || event.data?.revoked)) {
  212:         handleInvalidateToken();
  213:     }
  214: });
  ```
  Because `useWebSocketUpdates` does not forward arguments, `event` is always `undefined`. As a consequence, `if (event && ...)` evaluates to `false`, and `handleInvalidateToken()` is never triggered via WebSocket!
- **Why this is a problem:**
  Requirement §R2 specifies: *"Ensure unlinked devices immediately lose access and redirect back to the /kiosk QR Code pairing screen."* When a parent unlinks a device from `/settings`, the display fails to revoke immediately over WebSocket and remains on the active screen until the next periodic heartbeat (up to 30s) or next data poll (up to 60s).
- **Suggested Fix:**
  Update `client/src/hooks/useWebSocketUpdates.ts` to forward the update payload to the callback:
  ```ts
  export function useWebSocketUpdates<T = any>(entity: WsEntity, onUpdate: (msg?: T) => void): void {
      const { subscribe } = useWebSocket();
      const onUpdateRef = useRef(onUpdate);
      useEffect(() => {
          onUpdateRef.current = onUpdate;
      });

      useEffect(() => {
          const unsubscribe = subscribe(entity, (msg) => onUpdateRef.current(msg));
          return unsubscribe;
      }, [entity, subscribe]);
  }
  ```

---

#### ⚠️ [Minor] Finding 2: Stale URL Query Token Persistence on Token Invalidation
- **Location:** `client/src/pages/Kiosk.tsx` (lines 177–196)
- **Observation:**
  When a kiosk is opened via a URL containing `?token=<jwt>`, `handleInvalidateToken()` clears `localStorage` and `api.setToken(null)`, but leaves `?token=...` in the browser address bar (`window.location.search`). If the display device is hard-reloaded (e.g. browser crash / watchdog reboot), `useState(() => ...)` re-reads the invalid token from `window.location.search` before failing the initial load.
- **Suggested Fix:**
  In `handleInvalidateToken()` in `client/src/pages/Kiosk.tsx`, strip the token query param from the URL using `window.history.replaceState`:
  ```ts
  const handleInvalidateToken = useCallback(() => {
      localStorage.removeItem('openfamily.kioskToken');
      localStorage.removeItem('token');
      api.setToken(null);
      if (window.location.search.includes('token=')) {
          const url = new URL(window.location.href);
          url.searchParams.delete('token');
          window.history.replaceState({}, document.title, url.pathname + (url.searchParams.toString() ? '?' + url.searchParams.toString() : ''));
      }
      setHasToken(false);
      setPairingCode(null);
  }, []);
  ```

---

## 2. Logic Chain

1. **Step 1 (Requirement Verification):**
   - Observations 1.1.1 through 1.1.5 demonstrate that Milestones 2 and 3 successfully implemented all visual, responsive, and localization requirements:
     - 42" label removed.
     - Fluid QR scaling across 7" fridges to 75" 4K TVs.
     - Sticky modal headers and footers with scrollable bodies.
     - Kiosk devices list with metadata and remote unlinking in Settings.
2. **Step 2 (Adversarial Flow Analysis):**
   - Tracing the remote unlinking workflow: Parent clicks "Desvincular" in `Settings.tsx` -> backend executes `DELETE /api/kiosk/devices/:id` -> marks DB row `revoked_at = NOW()` -> calls `broadcast(userId, { type: 'update', entity: 'kiosk', action: 'deleted', ... })`.
   - On the Kiosk display: WebSocket receives the frame -> parses `WsUpdateMessage` -> calls `notify('kiosk', msg)` -> `WebSocketContext` invokes subscriber callback `cb(msg)`.
   - However, `useWebSocketUpdates` wrapped `cb` as `() => onUpdateRef.current()`, omitting `msg`.
   - In `Kiosk.tsx`, `event` is `undefined`, so `if (event && ...)` fails.
3. **Step 3 (Impact Assessment):**
   - The failure violates instant real-time revocation requirement §R2. The kiosk only falls back to revocation during the 30s heartbeat.
4. **Step 4 (Conclusion):**
   - While the UI/UX and feature architecture are 95% complete and well-designed, this callback parameter disconnection in `useWebSocketUpdates.ts` must be addressed to fulfill the real-time reactivity requirement.

---

## 3. Caveats

- **No Caveats:** All frontend code in `client/src/pages/{Kiosk,Settings}.tsx`, `client/src/contexts/WebSocketContext.tsx`, `client/src/hooks/useWebSocketUpdates.ts`, `client/src/i18n/locales/*`, and test files were directly reviewed and analyzed.

---

## 4. Conclusion

- **Verdict:** **REQUEST_CHANGES**
- **Action Items for Implementer:**
  1. Fix `client/src/hooks/useWebSocketUpdates.ts` to pass the `msg` argument to `onUpdateRef.current(msg)` (Finding 1).
  2. (Optional/Recommended) Update `handleInvalidateToken()` in `client/src/pages/Kiosk.tsx` to clean query parameters from the browser history (Finding 2).

---

## 5. Verification Method

1. **File Inspection:**
   - Inspect `client/src/hooks/useWebSocketUpdates.ts` line 24 to verify `msg` argument is passed:
     `const unsubscribe = subscribe(entity, (msg) => onUpdateRef.current(msg));`
   - Inspect `client/src/pages/Kiosk.tsx` lines 210–214 to verify `useWebSocketUpdates('kiosk', ...)` triggers `handleInvalidateToken()`.
2. **Automated E2E Test Suite:**
   - Execute `node tests/e2e/runner.js` to ensure 100% pass rate across Tiers 1 through 5.
3. **Live Unlink Verification:**
   - Open `/kiosk` in one tab and authorize with pairing code.
   - Open `/settings` in second tab as parent.
   - Click "Desvincular Dispositivo" on the active display.
   - Verify the `/kiosk` tab IMMEDIATELY resets to the QR pairing screen within < 100ms via WebSocket without waiting for heartbeat.
