import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
    Calendar, UtensilsCrossed, CheckSquare, Users, Maximize2, Minimize2, X, MapPin,
    Settings as SettingsIcon, ShoppingCart, Check, Undo2, Search, StickyNote, Copy, Tv, Globe, Download, ZoomIn, ZoomOut,
    Sun, Moon, CloudSun, CloudMoon, Cloud, CloudFog, CloudDrizzle, CloudRain, CloudSnow, CloudLightning, Music, Sparkles, Square,
    SkipForward,
} from 'lucide-react';
import { api } from '../lib/api';
import { useWebSocketUpdates } from '../hooks/useWebSocketUpdates';
import { useAuth } from '../contexts/AuthContext';
import { intlLocale } from '../i18n/format';
import { changeAppLanguage } from '../lib/language';
import { cn } from '../lib/utils';
import FamilyNotes, { type FamilyNote } from '../components/app/FamilyNotes';
import { soundEngine, PRESETS, type PresetDef } from '../lib/soundEngine';

interface Member { id: string; name: string; color: string }
interface Appointment { id: string; title: string; start_time: string; end_time?: string; location?: string; family_members_data?: Member[] }
interface Task { id: string; title: string; is_completed: boolean; priority?: string; due_date?: string; points?: number; assigned_to_members?: Member[] }
interface MealPlan { id: string; date: string; meal_type: string; custom_meal?: string; recipe?: { name: string } }
interface PlanningEntry { id: string; family_member_name: string; family_member_color: string; schedule_type: string; title: string; day_of_week: number; start_time: string; end_time: string; location?: string }
interface ShoppingItem { id: string; name: string; quantity?: number; unit?: string; is_checked: boolean }

const MEAL_ORDER = ['Petit-déjeuner', 'Déjeuner', 'Dîner', 'Snack'];

const isoDay = (d: Date) => ((d.getDay() + 6) % 7) + 1; // Mon=1 … Sun=7
const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hhmm = (iso: string) => new Intl.DateTimeFormat(intlLocale(), { hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

// ── Per-device kiosk settings (localStorage — the right scope for a wall display) ──

interface KioskLocation { name: string; lat: number; lon: number }
interface KioskSettings { location: KioskLocation | null; photoBackground: boolean; darkMode: boolean; zoom: number; brightness: number }

const SETTINGS_KEY = 'openfamily.kioskSettings';

const loadKioskSettings = (): KioskSettings => {
    try {
        const raw = localStorage.getItem(SETTINGS_KEY);
        if (raw) {
            const parsed = JSON.parse(raw) as Partial<KioskSettings>;
            const loc = parsed.location;
            return {
                location: loc && typeof loc.lat === 'number' && typeof loc.lon === 'number' && typeof loc.name === 'string' ? loc : null,
                photoBackground: Boolean(parsed.photoBackground),
                darkMode: typeof parsed.darkMode === 'boolean' ? parsed.darkMode : true,
                zoom: typeof parsed.zoom === 'number' && parsed.zoom >= 0.5 && parsed.zoom <= 2.0 ? parsed.zoom : 1.0,
                brightness: typeof parsed.brightness === 'number' && parsed.brightness >= 15 && parsed.brightness <= 100 ? parsed.brightness : 100,
            };
        }
    } catch { /* corrupted settings → defaults */ }
    return { location: null, photoBackground: false, darkMode: true, zoom: 1.0, brightness: 100 };
};

// ── Weather (Open-Meteo, no API key, public CORS — also works in the static demo) ──

interface WeatherHour { time: string; temp: number; code: number }
interface WeatherState { temp: number; code: number; isDay: boolean; min: number; max: number; hours: WeatherHour[] }

// WMO weather codes → lucide icon
const weatherIcon = (code: number, isDay: boolean, className: string): React.ReactElement => {
    if (code === 0) return isDay ? <Sun className={className} /> : <Moon className={className} />;
    if (code === 1 || code === 2) return isDay ? <CloudSun className={className} /> : <CloudMoon className={className} />;
    if (code === 45 || code === 48) return <CloudFog className={className} />;
    if (code >= 51 && code <= 57) return <CloudDrizzle className={className} />;
    if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return <CloudRain className={className} />;
    if ((code >= 71 && code <= 77) || code === 85 || code === 86) return <CloudSnow className={className} />;
    if (code >= 95) return <CloudLightning className={className} />;
    return <Cloud className={className} />;
};

const fetchWeather = async (loc: KioskLocation): Promise<WeatherState> => {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}`
        + '&current=temperature_2m,weather_code,is_day'
        + '&hourly=temperature_2m,weather_code'
        + '&daily=temperature_2m_max,temperature_2m_min'
        + '&forecast_days=2&timezone=auto';
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const d = await resp.json() as {
        current: { temperature_2m: number; weather_code: number; is_day: number };
        hourly: { time: string[]; temperature_2m: number[]; weather_code: number[] };
        daily: { temperature_2m_max: number[]; temperature_2m_min: number[] };
    };
    // hourly.time is local to the location (timezone=auto) — a kiosk lives in the
    // same timezone as its location, so comparing against the device clock is fine.
    const now = new Date();
    const hours: WeatherHour[] = [];
    for (let i = 0; i < d.hourly.time.length && hours.length < 4; i++) {
        if (new Date(d.hourly.time[i]) > now) {
            hours.push({ time: d.hourly.time[i], temp: d.hourly.temperature_2m[i], code: d.hourly.weather_code[i] });
        }
    }
    return {
        temp: d.current.temperature_2m,
        code: d.current.weather_code,
        isDay: d.current.is_day === 1,
        min: d.daily.temperature_2m_min[0],
        max: d.daily.temperature_2m_max[0],
        hours,
    };
};

interface GeoResult { id: number; name: string; latitude: number; longitude: number; admin1?: string; country?: string }

// ── Photo background layer (gentle crossfade on mount) ──

const PhotoLayer: React.FC<{ url: string }> = ({ url }) => {
    const [visible, setVisible] = useState(false);
    useEffect(() => {
        // Double rAF so the opacity-0 frame is painted before the transition starts.
        let raf2 = 0;
        const raf1 = requestAnimationFrame(() => { raf2 = requestAnimationFrame(() => setVisible(true)); });
        return () => { cancelAnimationFrame(raf1); cancelAnimationFrame(raf2); };
    }, []);
    return (
        <div
            className="absolute inset-0 bg-cover bg-center transition-opacity duration-1000 ease-in-out"
            style={{ backgroundImage: `url(${url})`, opacity: visible ? 1 : 0 }}
        />
    );
};

const Kiosk: React.FC = () => {
    const { t, i18n } = useTranslation(['kiosk', 'meals', 'notes', 'common']);
    const { isModuleEnabled } = useAuth();
    const [now, setNow] = useState(new Date());
    const [appointments, setAppointments] = useState<Appointment[]>([]);
    const [tasks, setTasks] = useState<Task[]>([]);
    const [meals, setMeals] = useState<MealPlan[]>([]);
    const [planning, setPlanning] = useState<PlanningEntry[]>([]);
    const [shopping, setShopping] = useState<ShoppingItem[]>([]);
    const [notes, setNotes] = useState<FamilyNote[]>([]);
    const [isFullscreen, setIsFullscreen] = useState(false);

    // Per-device settings + weather + photo background
    const [settings, setSettings] = useState<KioskSettings>(loadKioskSettings);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [soundsOpen, setSoundsOpen] = useState(false);
    const [soundsState, setSoundsState] = useState(() => soundEngine.getState());
    const [weather, setWeather] = useState<WeatherState | null>(null);

    useEffect(() => {
        return soundEngine.subscribe(() => setSoundsState(soundEngine.getState()));
    }, []);
    const [photos, setPhotos] = useState<{ id: number; url: string }[]>([]);
    const photosRef = useRef(photos);
    photosRef.current = photos;

    // City search (settings overlay)
    const [citySearch, setCitySearch] = useState('');
    const [cityResults, setCityResults] = useState<GeoResult[]>([]);
    const [searchingCity, setSearchingCity] = useState(false);

    const [kioskToken, setKioskToken] = useState<string | null>(null);
    const [copiedToken, setCopiedToken] = useState(false);

    const loadKioskToken = async () => {
        try {
            const res = await api.get<{ success: boolean; token: string }>('/api/kiosk/token');
            if (res.success && res.token) {
                setKioskToken(res.token);
            }
        } catch { /* token load error */ }
    };

    // Tap-to-complete confirmations ("✓ done — undo", visible ~5s)
    const [doneTasks, setDoneTasks] = useState<{ id: string; title: string }[]>([]);
    const [doneShopping, setDoneShopping] = useState<{ id: string; name: string }[]>([]);
    const [dismissedNotes, setDismissedNotes] = useState<{ id: string; content: string }[]>([]);
    const noteTimers = useRef(new Map<string, number>());

    const [pairingCode, setPairingCode] = useState<string | null>(null);
    const [hasToken, setHasToken] = useState<boolean>(() => {
        const urlParams = new URLSearchParams(window.location.search);
        const queryToken = urlParams.get('token');
        const storedToken = localStorage.getItem('openfamily.kioskToken');
        const activeToken = queryToken || storedToken || api.getToken();
        if (activeToken) {
            api.setToken(activeToken);
            localStorage.setItem('openfamily.kioskToken', activeToken);
            return true;
        }
        return false;
    });

    const handleInvalidateToken = useCallback(() => {
        localStorage.removeItem('openfamily.kioskToken');
        localStorage.removeItem('token');
        api.setToken(null);
        setHasToken(false);
        setPairingCode(null);
        if (typeof window !== 'undefined' && window.location.search.includes('token=')) {
            const url = new URL(window.location.href);
            url.searchParams.delete('token');
            window.history.replaceState({}, '', url.pathname + (url.search ? url.search : '') + url.hash);
        }
    }, []);

    // Remote revocation & token invalidation listener
    useEffect(() => {
        const onAuthExpired = () => {
            handleInvalidateToken();
        };
        window.addEventListener('openfamily:auth-expired', onAuthExpired);
        return () => {
            window.removeEventListener('openfamily:auth-expired', onAuthExpired);
        };
    }, [handleInvalidateToken]);

    // WebSocket instant revocation listener
    useWebSocketUpdates('kiosk', (event: any) => {
        if (event && (event.action === 'deleted' || event.data?.revoked)) {
            handleInvalidateToken();
        }
    });

    // 30s Periodic heartbeat
    useEffect(() => {
        if (!hasToken) return;

        const sendHeartbeat = async () => {
            try {
                await api.post('/api/kiosk/heartbeat', {});
            } catch (e: any) {
                if (e?.message?.includes('401') || e?.status === 401) {
                    handleInvalidateToken();
                }
            }
        };

        sendHeartbeat();
        const id = setInterval(sendHeartbeat, 30_000);
        return () => clearInterval(id);
    }, [hasToken, handleInvalidateToken]);

    // TV Pairing (Netflix / HBO style) when no token is present
    useEffect(() => {
        if (hasToken) return;

        let pollInterval: number;

        const startPairing = async () => {
            try {
                const res = await api.post<{ success: boolean; code: string }>('/api/kiosk/pair/init', {});
                if (res.success && res.code) {
                    setPairingCode(res.code);

                    pollInterval = window.setInterval(async () => {
                        try {
                            const statusRes = await api.get<{ success: boolean; authorized: boolean; token?: string; expired?: boolean }>(`/api/kiosk/pair/status?code=${res.code}`);
                            if (statusRes.success && statusRes.authorized && statusRes.token) {
                                clearInterval(pollInterval);
                                api.setToken(statusRes.token);
                                localStorage.setItem('openfamily.kioskToken', statusRes.token);
                                setHasToken(true);
                            } else if (statusRes.expired) {
                                clearInterval(pollInterval);
                                void startPairing();
                            }
                        } catch { /* glitch */ }
                    }, 2000);
                }
            } catch { /* offline */ }
        };

        void startPairing();

        return () => {
            if (pollInterval) clearInterval(pollInterval);
        };
    }, [hasToken]);

    useEffect(() => {
        try {
            localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
        } catch { /* storage full */ }

        if (settings.darkMode) {
            document.documentElement.classList.add('dark');
        } else {
            document.documentElement.classList.remove('dark');
        }
    }, [settings]);

    // Live clock (updates every 15s — enough to flip the minute)
    useEffect(() => {
        const urlParams = new URLSearchParams(window.location.search);
        const urlLang = urlParams.get('lang');
        if (urlLang && ['pt', 'en', 'fr', 'zh'].includes(urlLang)) {
            void changeAppLanguage(urlLang);
        }

        const id = setInterval(() => setNow(new Date()), 15_000);
        return () => clearInterval(id);
    }, []);

    const loadAll = async () => {
        if (!hasToken) return;
        const today = new Date();
        // Naive local bounds — appointment times are stored as local
        // "YYYY-MM-DDTHH:mm:ss" strings, so the window must not be UTC.
        const start = `${ymd(today)}T00:00:00`;
        const end = `${ymd(today)}T23:59:59`;
        const weekStart = new Date(today);
        weekStart.setDate(today.getDate() - ((today.getDay() + 6) % 7));
        try {
            const [apptRes, taskRes, mealRes, planRes, shopRes, notesRes] = await Promise.all([
                api.get<{ success: boolean; data: Appointment[] }>(`/api/appointments?start_date=${start}&end_date=${end}`),
                api.get<{ success: boolean; data: Task[] }>('/api/tasks'),
                api.get<{ success: boolean; data: MealPlan[] }>(`/api/meal-plans?start_date=${ymd(today)}&end_date=${ymd(today)}`),
                api.get<{ success: boolean; data: PlanningEntry[] }>(`/api/planning?week_start=${ymd(weekStart)}`),
                api.get<{ success: boolean; data: ShoppingItem[] }>('/api/shopping'),
                api.get<{ success: boolean; data: FamilyNote[] }>('/api/notes'),
            ]);
            if (apptRes.success) setAppointments(apptRes.data);
            if (taskRes.success) setTasks(taskRes.data);
            if (mealRes.success) setMeals(mealRes.data);
            if (planRes.success) setPlanning(planRes.data);
            if (shopRes.success) setShopping(shopRes.data);
            if (notesRes.success) setNotes(notesRes.data);
        } catch (e: any) {
            console.error('Kiosk load error:', e);
            if (e?.message?.includes('401') || e?.status === 401) {
                handleInvalidateToken();
            }
        }
    };

    useEffect(() => {
        if (hasToken) {
            void loadAll();
            const id = setInterval(() => void loadAll(), 60_000); // refresh every minute
            return () => clearInterval(id);
        }
    }, [hasToken]);
    useWebSocketUpdates('appointments', () => void loadAll());
    useWebSocketUpdates('tasks', () => void loadAll());
    useWebSocketUpdates('meal-plans', () => void loadAll());
    useWebSocketUpdates('planning', () => void loadAll());
    useWebSocketUpdates('shopping', () => void loadAll());
    useWebSocketUpdates('notes', () => void loadAll());

    // Persist per-device settings
    useEffect(() => {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    }, [settings]);

    // Weather — refresh every 30 min; on failure hide the card, retry next cycle
    useEffect(() => {
        const loc = settings.location;
        if (!loc) { setWeather(null); return; }
        const load = () => { fetchWeather(loc).then(setWeather).catch(() => setWeather(null)); };
        load();
        const id = setInterval(load, 30 * 60_000);
        return () => clearInterval(id);
    }, [settings.location]);

    // Immich photo background — new photo every ~2 min, crossfaded.
    // Errors (no integration, demo mode, server down) silently keep the plain background.
    useEffect(() => {
        if (!settings.photoBackground) {
            setPhotos((prev) => { prev.forEach((p) => URL.revokeObjectURL(p.url)); return []; });
            return;
        }
        const loadPhoto = async () => {
            try {
                const blob = await api.getBlob('/api/integrations/immich/photo');
                const url = URL.createObjectURL(blob);
                setPhotos((prev) => {
                    const next = [...prev, { id: Date.now(), url }];
                    while (next.length > 2) URL.revokeObjectURL(next.shift()!.url);
                    return next;
                });
            } catch { /* graceful fallback to the plain background */ }
        };
        void loadPhoto();
        const id = setInterval(() => void loadPhoto(), 120_000);
        return () => clearInterval(id);
    }, [settings.photoBackground]);

    // Revoke any remaining object URLs on unmount
    useEffect(() => () => { photosRef.current.forEach((p) => URL.revokeObjectURL(p.url)); }, []);

    // City search — debounced geocoding lookup (Open-Meteo, no API key)
    useEffect(() => {
        if (!settingsOpen) return;
        const q = citySearch.trim();
        if (q.length < 2) { setCityResults([]); return; }
        const lang = (i18n.language || 'en').slice(0, 2);
        const id = setTimeout(() => {
            setSearchingCity(true);
            fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=6&language=${lang}&format=json`)
                .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
                .then((d: { results?: GeoResult[] }) => setCityResults(d.results || []))
                .catch(() => setCityResults([]))
                .finally(() => setSearchingCity(false));
        }, 350);
        return () => clearTimeout(id);
    }, [citySearch, settingsOpen, i18n.language]);

    // ── Touch interactions (optimistic, with a ~5s undo affordance) ──

    const completeTask = (task: Task) => {
        setTasks((prev) => prev.map((x) => (x.id === task.id ? { ...x, is_completed: true } : x)));
        setDoneTasks((prev) => [...prev.filter((d) => d.id !== task.id), { id: task.id, title: task.title }]);
        window.setTimeout(() => setDoneTasks((prev) => prev.filter((d) => d.id !== task.id)), 5_000);
        api.put(`/api/tasks/${task.id}`, { is_completed: true }).catch(() => void loadAll());
    };

    const undoTask = (id: string) => {
        setDoneTasks((prev) => prev.filter((d) => d.id !== id));
        setTasks((prev) => prev.map((x) => (x.id === id ? { ...x, is_completed: false } : x)));
        api.put(`/api/tasks/${id}`, { is_completed: false }).catch(() => void loadAll());
    };

    const checkShoppingItem = (item: ShoppingItem) => {
        setShopping((prev) => prev.map((x) => (x.id === item.id ? { ...x, is_checked: true } : x)));
        setDoneShopping((prev) => [...prev.filter((d) => d.id !== item.id), { id: item.id, name: item.name }]);
        window.setTimeout(() => setDoneShopping((prev) => prev.filter((d) => d.id !== item.id)), 5_000);
        api.put(`/api/shopping/${item.id}`, { is_checked: true }).catch(() => void loadAll());
    };

    const undoShoppingItem = (id: string) => {
        setDoneShopping((prev) => prev.filter((d) => d.id !== id));
        setShopping((prev) => prev.map((x) => (x.id === id ? { ...x, is_checked: false } : x)));
        api.put(`/api/shopping/${id}`, { is_checked: false }).catch(() => void loadAll());
    };

    // Notes: a delete can't be re-posted, so the DELETE only fires AFTER the
    // 5s undo window — "undo" simply cancels the pending removal.
    const dismissNote = (note: FamilyNote) => {
        setDismissedNotes((prev) => [...prev.filter((d) => d.id !== note.id), { id: note.id, content: note.content }]);
        const timer = window.setTimeout(() => {
            noteTimers.current.delete(note.id);
            setDismissedNotes((prev) => prev.filter((d) => d.id !== note.id));
            setNotes((prev) => prev.filter((x) => x.id !== note.id)); // no flash while the DELETE lands
            api.delete(`/api/notes/${note.id}`).catch(() => void loadAll());
        }, 5_000);
        noteTimers.current.set(note.id, timer);
    };

    const undoNote = (id: string) => {
        const timer = noteTimers.current.get(id);
        if (timer !== undefined) {
            window.clearTimeout(timer);
            noteTimers.current.delete(id);
        }
        setDismissedNotes((prev) => prev.filter((d) => d.id !== id));
    };

    useEffect(() => {
        const onChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
        document.addEventListener('fullscreenchange', onChange);
        return () => document.removeEventListener('fullscreenchange', onChange);
    }, []);

    const toggleFullscreen = () => {
        if (document.fullscreenElement) void document.exitFullscreen();
        else void document.documentElement.requestFullscreen().catch(() => {});
    };

    const todayAppointments = useMemo(
        () => [...appointments].sort((a, b) => a.start_time.localeCompare(b.start_time)),
        [appointments]
    );
    const pendingTasks = useMemo(() => tasks.filter((t) => !t.is_completed).slice(0, 8), [tasks]);
    const pendingShopping = useMemo(() => shopping.filter((s) => !s.is_checked).slice(0, 6), [shopping]);
    const todayMeals = useMemo(
        () => [...meals].sort((a, b) => MEAL_ORDER.indexOf(a.meal_type) - MEAL_ORDER.indexOf(b.meal_type)),
        [meals]
    );
    const todayPlanning = useMemo(() => {
        const day = isoDay(new Date());
        return planning
            .filter((p) => p.day_of_week === day)
            .sort((a, b) => a.start_time.localeCompare(b.start_time));
    }, [planning]);
    // Keep the fridge glanceable: hide pending-dismissed notes, cap at the 6 most recent
    const visibleNotes = useMemo(
        () => notes.filter((n) => !dismissedNotes.some((d) => d.id === n.id)).slice(0, 6),
        [notes, dismissedNotes]
    );

    const clock = new Intl.DateTimeFormat(intlLocale(), { hour: '2-digit', minute: '2-digit' }).format(now);
    const dateLabel = new Intl.DateTimeFormat(intlLocale(), { weekday: 'long', day: 'numeric', month: 'long' }).format(now);

    const mealLabel = (v: string) => t(`meals:mealTypes.${v}`, { defaultValue: v });

    const photoActive = settings.photoBackground && photos.length > 0;
    // Panels become translucent + blurred over the photo so they stay readable.
    const panelClass = cn(
        'rounded-card border p-6',
        photoActive ? 'border-white/10 bg-card/80 backdrop-blur-md' : 'border-border bg-card'
    );

    if (!hasToken) {
        return (
            <div className="min-h-screen bg-[#110a18] text-[#f2eaee] flex flex-col justify-between p-3 sm:p-6 lg:p-10 select-none font-sans overflow-x-hidden">
                {/* Top Header */}
                <div className="flex items-center justify-between max-w-6xl mx-auto w-full">
                    <div className="flex items-center gap-2.5 sm:gap-3">
                        <img src={`${import.meta.env.BASE_URL}OpenFamily.png`} alt="OpenFamily" className="h-8 w-8 sm:h-10 sm:w-10 lg:h-12 lg:w-12 object-contain" />
                        <span className="font-serif text-xl sm:text-2xl lg:text-3xl font-bold tracking-tight text-white">
                            {t('kiosk:pairing.appTitle', 'OpenFamily TV')}
                        </span>
                    </div>
                    <div className="text-micro sm:text-caption font-medium text-muted-foreground bg-surface/40 px-3 py-1 sm:px-4 sm:py-1.5 rounded-full border border-white/10">
                        {t('kiosk:pairing.modeBadge', 'Smart Display')}
                    </div>
                </div>

                {/* Main Content (Netflix / HBO style 2 Columns) */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-8 lg:gap-12 items-center max-w-6xl mx-auto w-full my-auto py-2 sm:py-4">
                    <div className="space-y-4 sm:space-y-6 lg:space-y-8">
                        <div className="space-y-1.5 sm:space-y-3">
                            <span className="text-primary font-bold uppercase tracking-widest text-micro sm:text-caption">
                                {t('kiosk:pairing.easyAuth', 'Autenticação Fácil de TV')}
                            </span>
                            <h1 className="text-2xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight text-white leading-tight">
                                {t('kiosk:pairing.heading', 'Conecte sua TV em segundos')}
                            </h1>
                            <p className="text-caption sm:text-base lg:text-lg text-text-muted-base leading-relaxed">
                                {t('kiosk:pairing.subtitle', 'Não precisa usar o controle remoto para digitar sua senha. Use a câmera do seu celular!')}
                            </p>
                        </div>

                        <div className="space-y-2.5 sm:space-y-4 lg:space-y-5 border-l-2 border-primary/40 pl-4 sm:pl-6">
                            <div className="space-y-0.5 sm:space-y-1">
                                <span className="text-micro sm:text-caption font-bold text-primary">
                                    {t('kiosk:pairing.step1Title', 'PASSO 1')}
                                </span>
                                <p className="text-caption sm:text-base text-white">
                                    {t('kiosk:pairing.step1Desc', 'Abra a câmera do seu celular')}
                                </p>
                            </div>
                            <div className="space-y-0.5 sm:space-y-1">
                                <span className="text-micro sm:text-caption font-bold text-primary">
                                    {t('kiosk:pairing.step2Title', 'PASSO 2')}
                                </span>
                                <p className="text-caption sm:text-base text-white">
                                    {t('kiosk:pairing.step2Desc', 'Aponte para o QR Code ao lado')}
                                </p>
                            </div>
                            <div className="space-y-0.5 sm:space-y-1">
                                <span className="text-micro sm:text-caption font-bold text-primary">
                                    {t('kiosk:pairing.step3Title', 'PASSO 3')}
                                </span>
                                <p className="text-caption sm:text-base text-white">
                                    {t('kiosk:pairing.step3Desc', 'Toque em "Autorizar esta TV" no celular')}
                                </p>
                            </div>
                        </div>
                    </div>

                    <div className="bg-[#1b1126] border border-[#2c1e38] rounded-2xl sm:rounded-3xl p-4 sm:p-6 lg:p-8 flex flex-col items-center text-center shadow-2xl space-y-3 sm:space-y-5">
                        {pairingCode ? (
                            <div className="bg-white p-2.5 sm:p-4 rounded-xl sm:rounded-2xl shadow-inner w-[clamp(140px,20vw,260px)] h-[clamp(140px,20vw,260px)] max-h-[28vh] aspect-square flex items-center justify-center">
                                <img
                                    src={`https://api.qrserver.com/v1/create-qr-code/?size=260x260&data=${encodeURIComponent(`${window.location.origin}/pair?code=${pairingCode}`)}`}
                                    alt={t('kiosk:pairing.qrAlt', 'QR Code de Pareamento')}
                                    className="w-full h-full object-contain"
                                />
                            </div>
                        ) : (
                            <div className="w-[clamp(140px,20vw,260px)] h-[clamp(140px,20vw,260px)] max-h-[28vh] aspect-square bg-surface-2 animate-pulse rounded-xl sm:rounded-2xl flex items-center justify-center text-caption text-muted-foreground">
                                {t('kiosk:pairing.generatingQr', 'Gerando QR Code...')}
                            </div>
                        )}

                        <div className="space-y-1.5 sm:space-y-2">
                            <p className="text-micro sm:text-caption text-text-muted-foreground uppercase tracking-wider font-medium">
                                {t('kiosk:pairing.orAccess', 'Ou acesse no celular:')}
                            </p>
                            <p className="text-micro sm:text-caption text-primary font-mono">{window.location.origin}/pair</p>
                            <div className="text-2xl sm:text-3xl lg:text-4xl font-mono font-bold tracking-widest text-white bg-[#110a18] py-2 sm:py-3 px-4 sm:px-6 rounded-xl sm:rounded-2xl border border-primary/30 shadow-inner">
                                {pairingCode ? `${pairingCode.slice(0, 3)} - ${pairingCode.slice(3)}` : '...'}
                            </div>
                        </div>

                        <div className="flex items-center gap-2 text-micro text-text-muted-base animate-pulse">
                            <div className="w-2 h-2 sm:w-2.5 sm:h-2.5 rounded-full bg-primary" />
                            <span>{t('kiosk:pairing.waitingAuth', 'Aguardando autorização pelo celular...')}</span>
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="text-center text-micro text-text-muted-base border-t border-white/5 pt-2 sm:pt-4 max-w-6xl mx-auto w-full">
                    {t('kiosk:pairing.footer', 'OpenFamily Smart Display')} • {window.location.hostname}
                </div>
            </div>
        );
    }

    return (
        <div
            className="relative min-h-screen bg-background text-foreground transition-all duration-300"
            style={{ filter: settings.brightness < 100 ? `brightness(${settings.brightness}%)` : undefined }}
        >
            {/* Immich photo background (soft, dimmed, behind everything) */}
            {photoActive && (
                <div className="fixed inset-0 z-0" aria-hidden="true">
                    {photos.map((p) => <PhotoLayer key={p.id} url={p.url} />)}
                    <div className="absolute inset-0 bg-gradient-to-b from-black/50 via-black/40 to-black/60" />
                </div>
            )}

            <div className="relative z-10" style={{ zoom: settings.zoom }}>
            {/* Top bar */}
            <header className="flex flex-wrap items-end justify-between gap-4 px-6 pt-6 lg:px-12 lg:pt-10">
                <div>
                    <div className={cn(
                        'font-serif text-[clamp(3rem,9vw,7rem)] font-semibold leading-none tracking-tight tabular-nums',
                        photoActive && 'text-white drop-shadow-md'
                    )}>
                        {clock}
                    </div>
                    <p className={cn(
                        'mt-2 text-[clamp(1rem,2.2vw,1.6rem)] capitalize',
                        photoActive ? 'text-white/85' : 'text-muted-foreground'
                    )}>{dateLabel}</p>
                </div>

                {/* Weather — only when a location is configured and the API answered */}
                {weather && settings.location && (
                    <div className={cn(panelClass, 'hidden items-center gap-4 px-5 py-3 sm:flex')}>
                        {weatherIcon(weather.code, weather.isDay, 'h-10 w-10 shrink-0 text-primary')}
                        <div>
                            <div className="font-serif text-[clamp(1.6rem,3vw,2.4rem)] font-semibold leading-none tabular-nums">
                                {Math.round(weather.temp)}°
                            </div>
                            <p className="mt-1 whitespace-nowrap text-caption text-muted-foreground">
                                {settings.location.name} · ↑ {Math.round(weather.max)}° ↓ {Math.round(weather.min)}°
                            </p>
                        </div>
                        {weather.hours.length > 0 && (
                            <div className={cn('hidden items-center gap-4 border-l pl-4 xl:flex', photoActive ? 'border-white/10' : 'border-border')}>
                                {weather.hours.map((h) => (
                                    <div key={h.time} className="flex flex-col items-center gap-1">
                                        <span className="whitespace-nowrap text-micro text-muted-foreground">
                                            {new Intl.DateTimeFormat(intlLocale(), { hour: 'numeric' }).format(new Date(h.time))}
                                        </span>
                                        {weatherIcon(h.code, true, 'h-4 w-4 text-muted-foreground')}
                                        <span className="text-caption tabular-nums">{Math.round(h.temp)}°</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {/* Floating Organic Action Bar */}
                <div className={cn(
                    'flex items-center gap-1 p-1 rounded-full border shadow-sm backdrop-blur-md transition-all',
                    photoActive
                        ? 'border-white/20 bg-black/40 text-white'
                        : 'border-border bg-card/90 text-foreground'
                )}>
                    <img src={`${import.meta.env.BASE_URL}OpenFamily.png`} alt="OpenFamily" className="hidden h-7 w-7 object-contain ml-1 sm:block" />

                    {/* Ambient Sounds Button */}
                    <button
                        type="button"
                        onClick={() => setSoundsOpen(true)}
                        aria-label="Sons Relaxantes & Ruído Branco"
                        title="Sons Relaxantes & Ruído Branco"
                        className={cn(
                            'h-8 w-8 rounded-full flex items-center justify-center transition-colors',
                            soundsState.anyActive
                                ? 'bg-primary text-primary-foreground animate-pulse shadow'
                                : 'hover:bg-surface-2 text-muted-foreground hover:text-foreground'
                        )}
                    >
                        <Music className="h-4 w-4" />
                    </button>

                    {/* Quick Dimmer Brightness Button */}
                    <button
                        type="button"
                        onClick={() => {
                            const levels = [100, 75, 50, 30, 15];
                            const idx = levels.indexOf(settings.brightness);
                            const next = levels[(idx + 1) % levels.length];
                            setSettings((s) => ({ ...s, brightness: next }));
                        }}
                        aria-label="Ajustar Brilho Noturno"
                        title={`Brilho Noturno: ${settings.brightness}%`}
                        className={cn(
                            'h-8 px-2 rounded-full flex items-center gap-1 transition-colors text-micro font-bold',
                            settings.brightness < 100
                                ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                                : 'hover:bg-surface-2 text-muted-foreground hover:text-foreground'
                        )}
                    >
                        <Sun className="h-4 w-4" />
                        {settings.brightness < 100 && <span>{settings.brightness}%</span>}
                    </button>

                    {/* Display Settings Button */}
                    <button
                        type="button"
                        onClick={() => setSettingsOpen(true)}
                        aria-label={t('kiosk:displaySettings.open')}
                        title={t('kiosk:displaySettings.open')}
                        className="h-8 w-8 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-surface-2 transition-colors"
                    >
                        <SettingsIcon className="h-4 w-4" />
                    </button>

                    {/* Fullscreen Button */}
                    <button
                        type="button"
                        onClick={toggleFullscreen}
                        aria-label={isFullscreen ? t('kiosk:exitFullscreen') : t('kiosk:fullscreen')}
                        title={isFullscreen ? t('kiosk:exitFullscreen') : t('kiosk:fullscreen')}
                        className="h-8 w-8 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-surface-2 transition-colors"
                    >
                        {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                    </button>

                    {/* Exit Kiosk Link */}
                    <Link
                        to="/"
                        aria-label={t('kiosk:exit')}
                        title={t('kiosk:exit')}
                        className="h-8 w-8 rounded-full flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                    >
                        <X className="h-4 w-4" />
                    </Link>
                </div>
            </header>

            {/* TV Main Screen Ambient Sound Player Widget */}
            {soundsState.anyActive && (
                <div className="mx-6 mt-4 lg:mx-12">
                    <div className="flex flex-wrap items-center justify-between gap-4 rounded-card border border-primary/40 bg-card/90 p-4 shadow-xl backdrop-blur-md">
                        <div className="flex items-center gap-3">
                            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary animate-pulse">
                                <Music className="h-6 w-6 text-primary" />
                            </div>
                            <div>
                                <div className="flex items-center gap-2">
                                    <span className="font-serif text-lg font-bold text-foreground">
                                        {soundsState.activePreset ? t(soundsState.activePreset.nameKey) : t('kiosk:ambientSounds.active', 'Sons Relaxantes Ativos')}
                                    </span>
                                    <span className="rounded-full bg-primary/20 px-2.5 py-0.5 font-mono text-micro font-bold text-primary">
                                        {t('kiosk:ambientSounds.soundCount', { count: soundsState.activeCount, defaultValue: `${soundsState.activeCount} som(ns)` })}
                                    </span>
                                </div>
                                <p className="text-caption text-muted-foreground">{t('kiosk:ambientSounds.playingSub', 'Tocando no ambiente em segundo plano')}</p>
                            </div>
                        </div>

                        <div className="flex items-center gap-3">
                            {/* Next Preset */}
                            <button
                                type="button"
                                onClick={() => soundEngine.nextPreset()}
                                className="flex items-center gap-1.5 rounded-full border border-border bg-surface-2 px-3 py-2 text-caption font-semibold text-foreground hover:bg-surface-3 transition-colors active:scale-95"
                            >
                                <SkipForward className="h-4 w-4 text-primary" /> {t('kiosk:ambientSounds.nextPreset', 'Trocar Preset')}
                            </button>

                            {/* Stop */}
                            <button
                                type="button"
                                onClick={() => soundEngine.stopAll()}
                                className="flex items-center gap-1.5 rounded-full border border-destructive/30 bg-destructive/10 px-3 py-2 text-caption font-semibold text-destructive hover:bg-destructive/20 transition-colors active:scale-95"
                            >
                                <Square className="h-4 w-4" /> {t('kiosk:ambientSounds.stop', 'Parar')}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <main className="grid grid-cols-1 gap-5 px-6 pb-10 pt-6 lg:grid-cols-3 lg:gap-6 lg:px-12">
                {/* Schedule — wide column */}
                <section className={cn(panelClass, 'lg:col-span-2 lg:p-8')}>
                    <h2 className="mb-5 flex items-center gap-3 font-serif text-h1">
                        <Calendar className="h-7 w-7 text-primary" /> {t('kiosk:schedule')}
                    </h2>
                    {todayAppointments.length === 0 ? (
                        <p className="py-10 text-center text-h2 text-muted-foreground">{t('kiosk:empty.appointments')}</p>
                    ) : (
                        <div className="divide-y divide-border">
                            {todayAppointments.map((a) => (
                                <div key={a.id} className="grid grid-cols-[110px_1fr] items-baseline gap-4 py-4">
                                    <div className="font-serif text-[clamp(1.4rem,2.4vw,2rem)] tabular-nums text-muted-foreground">
                                        {hhmm(a.start_time)}
                                    </div>
                                    <div className="min-w-0">
                                        <p className="truncate text-[clamp(1.2rem,2.2vw,1.9rem)] font-semibold">{a.title}</p>
                                        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-body text-muted-foreground">
                                            {a.location && (
                                                <span className="inline-flex items-center gap-1"><MapPin className="h-4 w-4" />{a.location}</span>
                                            )}
                                            {(a.family_members_data || []).map((m) => (
                                                <span key={m.id} className="inline-flex items-center gap-1.5">
                                                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: m.color }} />
                                                    {m.name}
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </section>

                {/* Right column */}
                <div className="flex flex-col gap-5 lg:gap-6">
                    {/* Meals */}
                    <section className={panelClass}>
                        <h2 className="mb-4 flex items-center gap-2.5 font-serif text-h2">
                            <UtensilsCrossed className="h-6 w-6 text-primary" /> {t('kiosk:meals')}
                        </h2>
                        {todayMeals.length === 0 ? (
                            <p className="py-4 text-center text-body text-muted-foreground">{t('kiosk:empty.meals')}</p>
                        ) : (
                            <ul className="space-y-2.5">
                                {todayMeals.map((m) => (
                                    <li key={m.id} className="flex items-baseline justify-between gap-3">
                                        <span className="text-caption uppercase tracking-wide text-muted-foreground">{mealLabel(m.meal_type)}</span>
                                        <span className="min-w-0 flex-1 truncate text-right text-body font-medium">{m.recipe?.name || m.custom_meal}</span>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </section>

                    {/* Who's where */}
                    <section className={panelClass}>
                        <h2 className="mb-4 flex items-center gap-2.5 font-serif text-h2">
                            <Users className="h-6 w-6 text-primary" /> {t('kiosk:whereabouts')}
                        </h2>
                        {todayPlanning.length === 0 ? (
                            <p className="py-4 text-center text-body text-muted-foreground">{t('kiosk:empty.whereabouts')}</p>
                        ) : (
                            <ul className="space-y-2.5">
                                {todayPlanning.map((p) => (
                                    <li key={p.id} className="flex items-center gap-3">
                                        <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: p.family_member_color }} />
                                        <span className="font-medium">{p.family_member_name}</span>
                                        <span className="min-w-0 flex-1 truncate text-muted-foreground">{p.title}</span>
                                        <span className="shrink-0 tabular-nums text-muted-foreground">{p.start_time.slice(0, 5)}–{p.end_time.slice(0, 5)}</span>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </section>

                    {/* Tasks — tap to complete (large hit areas, no hover needed) */}
                    <section className={panelClass}>
                        <h2 className="mb-3 flex items-center gap-2.5 font-serif text-h2">
                            <CheckSquare className="h-6 w-6 text-primary" /> {t('kiosk:tasks')}
                        </h2>
                        {pendingTasks.length === 0 && doneTasks.length === 0 ? (
                            <p className="py-4 text-center text-body text-muted-foreground">{t('kiosk:empty.tasks')}</p>
                        ) : (
                            <ul className="space-y-1">
                                {doneTasks.map((d) => (
                                    <li key={`done-${d.id}`} className="flex items-center gap-3 rounded-input bg-success/10 px-3 py-2.5 text-success">
                                        <Check className="h-5 w-5 shrink-0" />
                                        <span className="min-w-0 flex-1 truncate line-through">{d.title}</span>
                                        <button
                                            type="button"
                                            onClick={() => undoTask(d.id)}
                                            className="flex shrink-0 items-center gap-1.5 rounded-input px-2.5 py-1.5 text-caption font-medium underline-offset-2 active:underline"
                                        >
                                            <Undo2 className="h-4 w-4" /> {t('kiosk:undo')}
                                        </button>
                                    </li>
                                ))}
                                {pendingTasks.map((task) => (
                                    <li key={task.id}>
                                        <button
                                            type="button"
                                            onClick={() => completeTask(task)}
                                            className="flex w-full items-center gap-3 rounded-input px-3 py-2.5 text-left transition-colors active:bg-surface-2"
                                        >
                                            <span className="h-5 w-5 shrink-0 rounded-full border-2 border-muted-foreground/50" />
                                            <span className="min-w-0 flex-1 truncate">{task.title}</span>
                                            {(task.points ?? 0) > 0 && (
                                                <span className="shrink-0 text-caption text-amber-500">⭐ {task.points}</span>
                                            )}
                                            {(task.assigned_to_members || []).slice(0, 1).map((m) => (
                                                <span key={m.id} className="shrink-0 text-caption text-muted-foreground">{m.name}</span>
                                            ))}
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </section>

                    {/* Shopping — top unchecked items, tap to check off */}
                    <section className={panelClass}>
                        <h2 className="mb-3 flex items-center gap-2.5 font-serif text-h2">
                            <ShoppingCart className="h-6 w-6 text-primary" /> {t('kiosk:shopping')}
                        </h2>
                        {pendingShopping.length === 0 && doneShopping.length === 0 ? (
                            <p className="py-4 text-center text-body text-muted-foreground">{t('kiosk:empty.shopping')}</p>
                        ) : (
                            <ul className="space-y-1">
                                {doneShopping.map((d) => (
                                    <li key={`done-${d.id}`} className="flex items-center gap-3 rounded-input bg-success/10 px-3 py-2.5 text-success">
                                        <Check className="h-5 w-5 shrink-0" />
                                        <span className="min-w-0 flex-1 truncate line-through">{d.name}</span>
                                        <button
                                            type="button"
                                            onClick={() => undoShoppingItem(d.id)}
                                            className="flex shrink-0 items-center gap-1.5 rounded-input px-2.5 py-1.5 text-caption font-medium underline-offset-2 active:underline"
                                        >
                                            <Undo2 className="h-4 w-4" /> {t('kiosk:undo')}
                                        </button>
                                    </li>
                                ))}
                                {pendingShopping.map((item) => (
                                    <li key={item.id}>
                                        <button
                                            type="button"
                                            onClick={() => checkShoppingItem(item)}
                                            className="flex w-full items-center gap-3 rounded-input px-3 py-2.5 text-left transition-colors active:bg-surface-2"
                                        >
                                            <span className="h-5 w-5 shrink-0 rounded-[6px] border-2 border-muted-foreground/50" />
                                            <span className="min-w-0 flex-1 truncate">{item.name}</span>
                                            {item.quantity ? (
                                                <span className="shrink-0 text-caption text-muted-foreground">
                                                    {item.quantity}{item.unit ? ` ${item.unit}` : ''}
                                                </span>
                                            ) : null}
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </section>
                </div>

                {/* Family notes — post-its, shown only when there's something on the fridge */}
                {isModuleEnabled('notes') && (visibleNotes.length > 0 || dismissedNotes.length > 0) && (
                    <section className={cn(panelClass, 'lg:col-span-3')}>
                        <h2 className="mb-5 flex items-center gap-3 font-serif text-h1">
                            <StickyNote className="h-7 w-7 text-primary" /> {t('notes:title')}
                        </h2>
                        {dismissedNotes.map((d) => (
                            <div key={`done-${d.id}`} className="mb-3 flex items-center gap-3 rounded-input bg-success/10 px-3 py-2.5 text-success">
                                <Check className="h-5 w-5 shrink-0" />
                                <span className="min-w-0 flex-1 truncate line-through">{d.content}</span>
                                <button
                                    type="button"
                                    onClick={() => undoNote(d.id)}
                                    className="flex shrink-0 items-center gap-1.5 rounded-input px-2.5 py-1.5 text-caption font-medium underline-offset-2 active:underline"
                                >
                                    <Undo2 className="h-4 w-4" /> {t('kiosk:undo')}
                                </button>
                            </div>
                        ))}
                        <FamilyNotes notes={visibleNotes} variant="kiosk" onDismiss={dismissNote} />
                    </section>
                )}
            </main>
            </div>

            {/* Settings overlay (per-device) */}
            {settingsOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setSettingsOpen(false)} />
                    <div className="relative flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-card border border-border bg-card shadow-2xl">
                        {/* Sticky Header with Close button (always visible on TV) */}
                        <div className="sticky top-0 z-20 flex shrink-0 items-center justify-between border-b border-border bg-card p-4">
                            <h2 className="font-serif text-h2">{t('kiosk:displaySettings.title')}</h2>
                            <button
                                type="button"
                                onClick={() => setSettingsOpen(false)}
                                aria-label={t('kiosk:displaySettings.close')}
                                className="rounded-input border border-border bg-surface-2 p-2 text-foreground transition-colors hover:bg-surface-3"
                            >
                                <X className="h-5 w-5" />
                            </button>
                        </div>

                        {/* Scrollable Body */}
                        <div className="flex-1 overflow-y-auto p-5 space-y-5">
                            {/* Weather location */}
                            <div className="space-y-2">
                                <p className="text-caption font-medium">{t('kiosk:displaySettings.location')}</p>
                                {settings.location ? (
                                    <div className="flex items-center justify-between gap-3 rounded-input border border-border bg-surface-2 px-3 py-2.5">
                                        <span className="inline-flex min-w-0 items-center gap-2">
                                            <MapPin className="h-4 w-4 shrink-0 text-primary" />
                                            <span className="truncate font-medium">{settings.location.name}</span>
                                        </span>
                                        <button
                                            type="button"
                                            onClick={() => setSettings((s) => ({ ...s, location: null }))}
                                            className="shrink-0 rounded-input px-2 py-1 text-caption text-muted-foreground underline-offset-2 active:underline"
                                        >
                                            {t('kiosk:displaySettings.change')}
                                        </button>
                                    </div>
                                ) : (
                                    <>
                                        <div className="relative">
                                            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                                            <input
                                                value={citySearch}
                                                onChange={(e) => setCitySearch(e.target.value)}
                                                placeholder={t('kiosk:displaySettings.searchPlaceholder')}
                                                className="w-full rounded-input border border-border bg-surface-2 py-2 pl-9 pr-3 text-caption outline-none focus:border-primary"
                                            />
                                        </div>
                                        {citySearch.trim().length >= 2 && !searchingCity && (
                                            cityResults.length === 0 ? (
                                                <p className="px-1 text-caption text-muted-foreground">{t('kiosk:displaySettings.noResults')}</p>
                                            ) : (
                                                <div className="divide-y divide-border overflow-hidden rounded-input border border-border">
                                                    {cityResults.map((r) => (
                                                        <button
                                                            key={r.id}
                                                            type="button"
                                                            onClick={() => {
                                                                setSettings((s) => ({ ...s, location: { name: r.name, lat: r.latitude, lon: r.longitude } }));
                                                                setCitySearch('');
                                                                setCityResults([]);
                                                            }}
                                                            className="flex w-full items-baseline gap-2 px-3 py-2.5 text-left active:bg-surface-2"
                                                        >
                                                            <span className="font-medium">{r.name}</span>
                                                            <span className="min-w-0 flex-1 truncate text-caption text-muted-foreground">
                                                                {[r.admin1, r.country].filter(Boolean).join(', ')}
                                                            </span>
                                                        </button>
                                                    ))}
                                                </div>
                                            )
                                        )}
                                        <p className="text-caption text-muted-foreground">{t('kiosk:displaySettings.noLocation')}</p>
                                    </>
                                )}
                            </div>

                            {/* Photo background toggle */}
                            <div className="flex items-start justify-between gap-4 border-t border-border pt-4">
                                <div>
                                    <p className="text-caption font-medium">{t('kiosk:displaySettings.photoBackground')}</p>
                                    <p className="mt-0.5 text-micro text-muted-foreground">{t('kiosk:displaySettings.photoBackgroundHint')}</p>
                                </div>
                                <button
                                    type="button"
                                    role="switch"
                                    aria-checked={settings.photoBackground}
                                    aria-label={t('kiosk:displaySettings.photoBackground')}
                                    onClick={() => setSettings((s) => ({ ...s, photoBackground: !s.photoBackground }))}
                                    className={cn(
                                        'relative h-7 w-12 shrink-0 rounded-full transition-colors',
                                        settings.photoBackground ? 'bg-primary' : 'border border-border bg-surface-2'
                                    )}
                                >
                                    <span className={cn(
                                        'absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all',
                                        settings.photoBackground ? 'left-6' : 'left-1'
                                    )} />
                                </button>
                            </div>

                            {/* Dark Mode toggle */}
                            <div className="flex items-start justify-between gap-4 border-t border-border pt-4">
                                <div>
                                    <p className="text-caption font-medium flex items-center gap-1.5">
                                        <Moon className="h-4 w-4 text-primary" /> {t('kiosk:displaySettings.darkMode', 'Modo Escuro (Dark Mode)')}
                                    </p>
                                    <p className="mt-0.5 text-micro text-muted-foreground">{t('kiosk:displaySettings.darkModeHint', 'Recomendado para telas de TV e visibilidade noturna')}</p>
                                </div>
                                <button
                                    type="button"
                                    role="switch"
                                    aria-checked={settings.darkMode}
                                    onClick={() => setSettings((s) => ({ ...s, darkMode: !s.darkMode }))}
                                    className={cn(
                                        'relative h-7 w-12 shrink-0 rounded-full transition-colors',
                                        settings.darkMode ? 'bg-primary' : 'border border-border bg-surface-2'
                                    )}
                                >
                                    <span className={cn(
                                        'absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all',
                                        settings.darkMode ? 'left-6' : 'left-1'
                                    )} />
                                </button>
                            </div>

                            {/* Zoom level control */}
                            <div className="flex items-center justify-between gap-4 border-t border-border pt-4">
                                <div>
                                    <p className="text-caption font-medium flex items-center gap-1.5">
                                        <ZoomIn className="h-4 w-4 text-primary" /> {t('kiosk:displaySettings.zoom', 'Zoom / Tamanho da Tela')}
                                    </p>
                                    <p className="mt-0.5 text-micro text-muted-foreground">{t('kiosk:displaySettings.zoomHint', 'Ajuste a escala dos elementos para sua TV')}</p>
                                </div>
                                <div className="flex items-center gap-1.5 bg-surface-2 p-1 rounded-input border border-border">
                                    <button
                                        type="button"
                                        onClick={() => setSettings((s) => ({ ...s, zoom: Math.max(0.6, Math.round((s.zoom - 0.1) * 10) / 10) }))}
                                        className="p-1.5 rounded-input hover:bg-surface border border-border text-foreground font-bold active:bg-primary/20 transition-colors"
                                        title="Diminuir Zoom (-)"
                                    >
                                        <ZoomOut className="h-4 w-4" />
                                    </button>
                                    <span className="text-caption font-mono font-bold px-2 w-12 text-center text-primary">
                                        {Math.round(settings.zoom * 100)}%
                                    </span>
                                    <button
                                        type="button"
                                        onClick={() => setSettings((s) => ({ ...s, zoom: Math.min(1.6, Math.round((s.zoom + 0.1) * 10) / 10) }))}
                                        className="p-1.5 rounded-input hover:bg-surface border border-border text-foreground font-bold active:bg-primary/20 transition-colors"
                                        title="Aumentar Zoom (+)"
                                    >
                                        <ZoomIn className="h-4 w-4" />
                                    </button>
                                </div>
                            </div>

                            {/* Brightness control */}
                            <div className="flex items-center justify-between gap-4 border-t border-border pt-4">
                                <div>
                                    <p className="text-caption font-medium flex items-center gap-1.5">
                                        <Sun className="h-4 w-4 text-primary" /> {t('kiosk:displaySettings.brightness', 'Brilho Noturno (Dimmer)')}
                                    </p>
                                    <p className="mt-0.5 text-micro text-muted-foreground">{t('kiosk:displaySettings.brightnessHint', 'Reduza a luminosidade da TV à noite')}</p>
                                </div>
                                <div className="flex items-center gap-1 bg-surface-2 p-1 rounded-input border border-border">
                                    {[100, 75, 50, 30, 15].map((lvl) => (
                                        <button
                                            key={lvl}
                                            type="button"
                                            onClick={() => setSettings((s) => ({ ...s, brightness: lvl }))}
                                            className={cn(
                                                'px-2 py-1 rounded-input text-micro font-bold transition-colors',
                                                settings.brightness === lvl
                                                    ? 'bg-primary text-primary-foreground shadow'
                                                    : 'text-muted-foreground hover:bg-surface'
                                            )}
                                        >
                                            {lvl}%
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Kiosk TV Link section */}
                            <div className="border-t border-border pt-4">
                                <div className="flex items-center justify-between gap-3 mb-2">
                                    <p className="text-caption font-medium flex items-center gap-1.5">
                                        <Tv className="h-4 w-4 text-primary" /> {t('kiosk:displaySettings.kioskLink', 'Link Kiosk da TV')}
                                    </p>
                                    {!kioskToken && (
                                        <button
                                            type="button"
                                            onClick={loadKioskToken}
                                            className="text-micro font-medium text-primary underline-offset-2 hover:underline"
                                        >
                                            {t('kiosk:displaySettings.generateToken', 'Gerar Token Perm.')}
                                        </button>
                                    )}
                                </div>
                                {kioskToken && (
                                    <div className="space-y-2">
                                        <input
                                            readOnly
                                            value={`${window.location.origin}/kiosk?token=${kioskToken}`}
                                            className="w-full rounded-input border border-border bg-surface-2 p-2 text-micro font-mono outline-none"
                                        />
                                        <button
                                            type="button"
                                            onClick={() => {
                                                void navigator.clipboard.writeText(`${window.location.origin}/kiosk?token=${kioskToken}`);
                                                setCopiedToken(true);
                                                setTimeout(() => setCopiedToken(false), 2000);
                                            }}
                                            className="flex items-center justify-center gap-1.5 w-full py-1.5 rounded-input border border-primary/30 bg-primary/10 text-primary text-micro font-medium hover:bg-primary/20 transition-colors"
                                        >
                                            {copiedToken ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                                            {copiedToken ? t('kiosk:displaySettings.copied', 'Copiado!') : t('kiosk:displaySettings.copyUrl', 'Copiar URL para TV')}
                                        </button>
                                    </div>
                                )}
                                <a
                                    href="/OpenFamily-TV.apk"
                                    download
                                    className="flex items-center justify-center gap-2 w-full mt-3 py-2 rounded-input border border-primary/40 bg-primary/10 text-primary font-semibold text-caption hover:bg-primary/20 transition-colors"
                                >
                                    <Download className="h-4 w-4" /> {t('kiosk:displaySettings.downloadApk', 'Baixar App Android TV (APK)')}
                                </a>
                            </div>

                            {/* Language Selector */}
                            <div className="border-t border-border pt-4 space-y-2">
                                <p className="text-caption font-medium flex items-center gap-1.5">
                                    <Globe className="h-4 w-4 text-primary" /> {t('kiosk:displaySettings.language', 'Idioma / Language')}
                                </p>
                                <div className="grid grid-cols-2 gap-2">
                                    {[
                                        { code: 'pt', label: 'Português' },
                                        { code: 'en', label: 'English' },
                                        { code: 'fr', label: 'Français' },
                                        { code: 'zh', label: '中文' },
                                    ].map((lang) => (
                                        <button
                                            key={lang.code}
                                            type="button"
                                            onClick={() => void changeAppLanguage(lang.code)}
                                            className={cn(
                                                'py-2 px-3 rounded-input text-caption font-medium border text-left flex items-center justify-between transition-colors',
                                                i18n.language?.startsWith(lang.code)
                                                    ? 'border-primary bg-primary/10 text-primary'
                                                    : 'border-border bg-surface-2 hover:bg-surface-2/80'
                                            )}
                                        >
                                            <span>{lang.label}</span>
                                            {i18n.language?.startsWith(lang.code) && <Check className="h-3.5 w-3.5 text-primary" />}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>

                        {/* Sticky Footer with big close button for TV */}
                        <div className="sticky bottom-0 z-20 flex shrink-0 items-center justify-end border-t border-border bg-card p-3">
                            <button
                                type="button"
                                onClick={() => setSettingsOpen(false)}
                                className="flex items-center gap-2 rounded-input bg-primary px-5 py-2.5 text-caption font-bold text-primary-foreground shadow transition-colors active:scale-95"
                            >
                                <X className="h-4 w-4" /> {t('kiosk:displaySettings.closeButton', 'Fechar Configurações')}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Ambient Sound Modal overlay in Kiosk */}
            {soundsOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-black/60 backdrop-blur-md" onClick={() => setSoundsOpen(false)} />
                    <div className="relative flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-card border border-border bg-card shadow-2xl">
                        {/* Sticky Header with Close button (always visible on TV / small viewports) */}
                        <div className="sticky top-0 z-20 flex shrink-0 items-center justify-between border-b border-border bg-card p-4">
                            <div className="flex items-center gap-2">
                                <Sparkles className="h-6 w-6 text-primary" />
                                <h2 className="font-serif text-h2">{t('kiosk:ambientSounds.title', 'Sons Relaxantes & Ruídos')}</h2>
                            </div>
                            <button
                                type="button"
                                onClick={() => setSoundsOpen(false)}
                                aria-label={t('kiosk:ambientSounds.close', 'Fechar')}
                                className="rounded-input border border-border bg-surface-2 p-2 text-foreground transition-colors hover:bg-surface-3"
                            >
                                <X className="h-5 w-5" />
                            </button>
                        </div>

                        {/* Scrollable Body */}
                        <div className="flex-1 overflow-y-auto p-5 space-y-4">
                            <p className="text-caption text-muted-foreground">
                                {t('kiosk:ambientSounds.subtitle', 'Sons sintetizados em segundo plano para sono, relaxamento e acalmar cães e gatos.')}
                            </p>

                            {/* Presets Grid */}
                            <div className="grid grid-cols-2 gap-2.5">
                                {PRESETS.map((preset: PresetDef) => (
                                    <button
                                        key={preset.id}
                                        type="button"
                                        onClick={() => soundEngine.applyPreset(preset)}
                                        className="flex items-center gap-2.5 rounded-input border border-border bg-surface p-3 text-left hover:border-primary active:scale-[0.98] transition-all"
                                    >
                                        <span className="text-xl">{preset.icon}</span>
                                        <span className="text-caption font-semibold">{t(preset.nameKey)}</span>
                                    </button>
                                ))}
                            </div>

                            {/* Controls */}
                            {soundsState.anyActive ? (
                                <div className="flex items-center justify-between border-t border-border pt-4">
                                    <span className="text-caption font-bold text-primary animate-pulse">
                                        🎵 {t('kiosk:ambientSounds.playing', 'Tocando em segundo plano')}
                                    </span>
                                    <button
                                        type="button"
                                        onClick={() => soundEngine.stopAll()}
                                        className="flex items-center gap-1.5 rounded-input bg-destructive/10 px-3 py-1.5 text-caption font-medium text-destructive active:bg-destructive/20"
                                    >
                                        <Square className="h-4 w-4" /> {t('kiosk:ambientSounds.stop', 'Parar Sons')}
                                    </button>
                                </div>
                            ) : (
                                <p className="text-center text-caption text-muted-foreground border-t border-border pt-4">
                                    {t('kiosk:ambientSounds.startHint', 'Toque em um preset para iniciar o som na TV')}
                                </p>
                            )}
                        </div>

                        {/* Sticky Footer with Close button */}
                        <div className="sticky bottom-0 z-20 flex shrink-0 items-center justify-end border-t border-border bg-card p-3">
                            <button
                                type="button"
                                onClick={() => setSoundsOpen(false)}
                                className="flex items-center gap-2 rounded-input bg-primary px-5 py-2.5 text-caption font-bold text-primary-foreground shadow transition-colors active:scale-95"
                            >
                                <X className="h-4 w-4" /> {t('kiosk:ambientSounds.close', 'Fechar')}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Kiosk;
