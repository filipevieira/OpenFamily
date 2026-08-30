import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card';
import { CheckCircle2, AlertCircle, RefreshCw, Unplug, Trash2, Calendar, X } from 'lucide-react';
import { cn } from '../lib/utils';

// Brand SVG icons (Simple Icons paths, viewBox 0 0 24 24)
const BRAND_SVG: Record<string, { path: string; hex: string }> = {
    mealie: {
        hex: 'E58325',
        path: 'M6.619 13.59 1.444 8.427c-1.925-1.939-1.925-5.063 0-6.989l8.666 8.642-3.491 3.51m6.551-.42 8.51 8.49-1.76 1.74-8.48-8.48-8.502 8.48-1.741-1.74L13.12 9.739l-.25-.272a2.448 2.448 0 0 1 0-3.472L18.23.6l1.14 1.135-3.99 4.024 1.18 1.161 3.99-4.012 1.15 1.136-4.01 4 1.15 1.189 4.03-4.017L24 6.377l-5.4 5.353c-.95.96-2.51.96-3.46 0l-.27-.25z',
    },
    homeassistant: {
        hex: '18BCF2',
        path: 'M22.939 10.627 13.061.749a1.505 1.505 0 0 0-2.121 0l-9.879 9.878C.478 11.21 0 12.363 0 13.187v9c0 .826.675 1.5 1.5 1.5h9.227l-4.063-4.062a2.034 2.034 0 0 1-.664.113c-1.13 0-2.05-.92-2.05-2.05s.92-2.05 2.05-2.05 2.05.92 2.05 2.05c0 .233-.041.456-.113.665l3.163 3.163V9.928a2.05 2.05 0 0 1-1.15-1.84c0-1.13.92-2.05 2.05-2.05s2.05.92 2.05 2.05a2.05 2.05 0 0 1-1.15 1.84v8.127l3.146-3.146A2.051 2.051 0 0 1 18 12.239c1.13 0 2.05.92 2.05 2.05s-.92 2.05-2.05 2.05c-.25 0-.488-.047-.709-.13L12.9 20.602v3.088h9.6c.825 0 1.5-.675 1.5-1.5v-9c0-.825-.477-1.977-1.061-2.561z',
    },
    grocy: {
        hex: '337AB7',
        path: 'M12.621.068C7.527.786 3.608 4.618 2.345 10.082c-.316 1.35-.392 3.896-.163 5.203.62 3.57 2.96 6.574 6.15 7.913 1.36.577 2.1.73 3.842.784 1.22.043 1.862.01 2.722-.13 2.688-.447 5.399-1.699 6.65-3.092l.403-.447-.054-1.872a481.92 481.92 0 0 1-.12-5.344l-.065-3.473-2.907.087c-1.589.033-3.722.098-4.746.142l-1.85.065-.087 2.319c-.055 1.284-.076 2.34-.055 2.362.022.022.882.076 1.916.12l1.872.076v.294c0 .707-.13.98-.555 1.208-.653.326-1.872.479-2.623.326-2.71-.566-3.777-4.55-1.96-7.369C11.86 7.48 13.873 6.62 16.562 6.74c.74.043 1.665.163 2.123.272.446.12.838.174.87.12.098-.142.468-5.726.403-5.9-.087-.24-1.35-.697-2.569-.947-1.252-.25-3.722-.37-4.767-.218z',
    },
    immich: {
        hex: '4250AF',
        path: 'M11.9863.2695c-2.409 0-5.207 1.091-5.207 3.8946v.1523c1.3428.597 2.9347 1.6629 4.4121 2.9707 1.5713 1.3912 2.8374 2.8821 3.6524 4.2871 1.3997-2.5034 2.3358-5.4784 2.3476-7.373V4.164c0-2.8035-2.796-3.8946-5.205-3.8946m7.5117 4.4903c-.3778-.0081-.7747.0502-1.1914.1855-.0366.0118-.086.0278-.1445.0469-.1525 1.4611-.6756 3.304-1.4629 5.1133-.8373 1.9243-1.8627 3.5898-2.9472 4.7988 2.8132.558 5.9307.5273 7.7363-.0469.0126-.004.0246-.0065.0351-.0097 2.6665-.8666 2.84-3.8636 2.0957-6.1543-.6279-1.9332-2.081-3.89-4.121-3.9336m-14.996.039C2.4618 4.8424 1.0088 6.7973.3809 8.7305c-.7442 2.291-.5708 5.288 2.0957 6.1543l.1445.0468c.982-1.0926 2.4873-2.2761 4.1875-3.2773 1.8088-1.0646 3.619-1.808 5.207-2.1484-1.9483-2.1049-4.4884-3.9132-6.287-4.5098l-.0352-.0117c-.4167-.1354-.8136-.1936-1.1914-.1856m4.6718 6.7578c-2.6038 1.2025-5.1088 3.0598-6.2324 4.586l-.0215.0293c-1.6478 2.2683-.0272 4.7953 1.9219 6.211 1.9487 1.4159 4.8518 2.1765 6.5-.0919.0228-.0309.0536-.071.0898-.121-.7356-1.2717-1.396-3.0718-1.8222-4.9981-.4534-2.0492-.6023-4-.4356-5.6153m1.0723 3.338c.3387 2.8478 1.3315 5.8037 2.4355 7.3437l.0215.0293c1.6478 2.2683 4.551 1.5078 6.5.0918 1.9487-1.416 3.5697-3.943 1.9219-6.211-.0228-.0309-.0517-.073-.0879-.123-1.4367.3066-3.3522.3794-5.3164.1894-2.089-.2017-3.9895-.6623-5.4746-1.3203',
    },
    nextcloud: {
        hex: '0082C9',
        path: 'M12.018 6.537c-2.5 0-4.6 1.712-5.241 4.015-.56-1.232-1.793-2.105-3.225-2.105A3.569 3.569 0 0 0 0 12a3.569 3.569 0 0 0 3.552 3.553c1.432 0 2.664-.874 3.224-2.106.641 2.304 2.742 4.016 5.242 4.016 2.487 0 4.576-1.693 5.231-3.977.569 1.21 1.783 2.067 3.198 2.067A3.568 3.568 0 0 0 24 12a3.569 3.569 0 0 0-3.553-3.553c-1.416 0-2.63.858-3.199 2.067-.654-2.284-2.743-3.978-5.23-3.977zm0 2.085c1.878 0 3.378 1.5 3.378 3.378 0 1.878-1.5 3.378-3.378 3.378A3.362 3.362 0 0 1 8.641 12c0-1.878 1.5-3.378 3.377-3.378zm-8.466 1.91c.822 0 1.467.645 1.467 1.468s-.644 1.467-1.467 1.468A1.452 1.452 0 0 1 2.085 12c0-.823.644-1.467 1.467-1.467zm16.895 0c.823 0 1.468.645 1.468 1.468s-.645 1.468-1.468 1.468A1.452 1.452 0 0 1 18.98 12c0-.823.644-1.467 1.467-1.467z',
    },
    google_calendar: {
        hex: '4285F4',
        path: 'M19 4h-1V2h-2v2H8V2H6v2H5c-1.11 0-1.99.9-1.99 2L3 20c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V10h14v10zm0-12H5V6h14v2zm-7 5h5v5h-5z',
    },
};

const IMG_ICONS: Record<string, string> = {
    tandoor: `${import.meta.env.BASE_URL}tandoor.png`,
};

const BrandIcon: React.FC<{ id: string; size?: number }> = ({ id, size = 20 }) => {
    if (IMG_ICONS[id]) {
        return (
            <img
                src={IMG_ICONS[id]}
                alt={id}
                width={size}
                height={size}
                style={{ objectFit: 'contain', flexShrink: 0 }}
            />
        );
    }
    const icon = BRAND_SVG[id];
    if (!icon) return null;
    return (
        <svg viewBox="0 0 24 24" width={size} height={size} fill={`#${icon.hex}`} aria-hidden="true" style={{ flexShrink: 0 }}>
            <path d={icon.path} />
        </svg>
    );
};

interface Integration {
    id: string;
    type: string;
    display_name: string;
    base_url: string;
    config?: Record<string, unknown>;
    status: 'connected' | 'syncing' | 'error';
    last_synced_at: string | null;
    last_error: string | null;
}

interface FieldDef {
    key: string;
    label: string;
    placeholder: string;
    type: 'text' | 'url' | 'password';
    optional?: boolean;
}

interface CatalogItem {
    id: string;
    name: string;
    tagline: string;
    description: string;
    syncs: string[];
    fields: FieldDef[];
}

const statusBadge = (status: string) => {
    if (status === 'error') {
        return <span className="inline-flex items-center gap-1 text-micro text-danger"><AlertCircle className="h-3 w-3" /> Erro</span>;
    }
    return <span className="inline-flex items-center gap-1 text-micro text-success"><CheckCircle2 className="h-3 w-3" /> Conectado</span>;
};

const Integrations: React.FC = () => {
    const { t } = useTranslation(['integrations', 'common']);
    const CATALOG: CatalogItem[] = [
        {
            id: 'mealie',
            name: 'Mealie',
            tagline: t('integrations:catalog.mealie.tagline'),
            description: t('integrations:catalog.mealie.description'),
            syncs: [t('integrations:syncs.recipes'), t('integrations:syncs.menus')],
            fields: [
                { key: 'base_url', label: t('integrations:catalog.mealie.urlLabel'), placeholder: t('integrations:catalog.mealie.urlPlaceholder'), type: 'url' },
                { key: 'apiKey', label: t('integrations:catalog.mealie.keyLabel'), placeholder: t('integrations:catalog.mealie.keyPlaceholder'), type: 'password' },
            ],
        },
        {
            id: 'tandoor',
            name: 'Tandoor',
            tagline: t('integrations:catalog.tandoor.tagline'),
            description: t('integrations:catalog.tandoor.description'),
            syncs: [t('integrations:syncs.recipes')],
            fields: [
                { key: 'base_url', label: t('integrations:catalog.tandoor.urlLabel'), placeholder: t('integrations:catalog.tandoor.urlPlaceholder'), type: 'url' },
                { key: 'apiKey', label: t('integrations:catalog.tandoor.keyLabel'), placeholder: t('integrations:catalog.tandoor.keyPlaceholder'), type: 'password' },
            ],
        },
        {
            id: 'homeassistant',
            name: 'Home Assistant',
            tagline: t('integrations:catalog.homeassistant.tagline'),
            description: t('integrations:catalog.homeassistant.description'),
            syncs: [t('integrations:syncs.calendar'), t('integrations:syncs.shopping')],
            fields: [
                { key: 'base_url', label: t('integrations:catalog.homeassistant.urlLabel'), placeholder: t('integrations:catalog.homeassistant.urlPlaceholder'), type: 'url' },
                { key: 'apiKey', label: t('integrations:catalog.homeassistant.keyLabel'), placeholder: t('integrations:catalog.homeassistant.keyPlaceholder'), type: 'password' },
            ],
        },
        {
            id: 'grocy',
            name: 'Grocy',
            tagline: t('integrations:catalog.grocy.tagline'),
            description: t('integrations:catalog.grocy.description'),
            syncs: [t('integrations:syncs.pantry'), t('integrations:syncs.chores')],
            fields: [
                { key: 'base_url', label: t('integrations:catalog.grocy.urlLabel'), placeholder: t('integrations:catalog.grocy.urlPlaceholder'), type: 'url' },
                { key: 'apiKey', label: t('integrations:catalog.grocy.keyLabel'), placeholder: t('integrations:catalog.grocy.keyPlaceholder'), type: 'password' },
            ],
        },
        {
            id: 'google_calendar',
            name: 'Google Calendar',
            tagline: t('integrations:catalog.google_calendar.tagline', 'Espelhamento de compromissos da família'),
            description: t('integrations:catalog.google_calendar.description', 'Conecte sua conta do Google para visualizar seus eventos no OpenFamily.'),
            syncs: [t('integrations:syncs.calendar', 'Calendrier'), t('integrations:syncs.appointments', 'Rendez-vous')],
            fields: [
                { key: 'client_id', label: 'Client ID', placeholder: 'xxxxxx.apps.googleusercontent.com', type: 'text' },
                { key: 'client_secret', label: 'Client Secret', placeholder: 'GOCSPX-xxxxxx', type: 'password' },
            ],
        },
    ];

    const [integrations, setIntegrations] = useState<Integration[]>([]);
    const [loading, setLoading] = useState(true);
    const [activeModal, setActiveModal] = useState<string | null>(null);
    const [formValues, setFormValues] = useState<Record<string, string>>({});
    const [testStatus, setTestStatus] = useState<{ ok: boolean; message: string } | null>(null);
    const [testing, setTesting] = useState(false);
    const [saving, setSaving] = useState(false);
    const [syncingId, setSyncingId] = useState<string | null>(null);
    const [userCalendars, setUserCalendars] = useState<Array<{ id: string; summary: string; primary?: boolean; backgroundColor?: string }>>([]);
    const [loadingCalendars, setLoadingCalendars] = useState(false);
    const [showCalendarSelector, setShowCalendarSelector] = useState(false);
    const [selectedCalIds, setSelectedCalIds] = useState<string[]>([]);
    const [calColors] = useState<Record<string, string>>({});

    useEffect(() => { void load(); }, []);

    const load = async () => {
        try {
            const res = await api.get<{ success: boolean; data: Integration[] }>('/api/integrations');
            if (res.success) setIntegrations(res.data);
        } finally { setLoading(false); }
    };

    const loadCalendars = async () => {
        setLoadingCalendars(true);
        try {
            const res = await api.get<{ success: boolean; calendars: any[] }>('/api/integrations/google/calendars');
            if (res.success && res.calendars) {
                setUserCalendars(res.calendars);
                const primaryCal = res.calendars.find((c: any) => c.primary) || res.calendars[0];
                setSelectedCalIds(primaryCal ? [primaryCal.id] : []);
                setShowCalendarSelector(true);
            }
        } catch { alert('Erro ao carregar agendas.'); } finally { setLoadingCalendars(false); }
    };

    const toggleCalSelection = (id: string) => setSelectedCalIds((prev: string[]) => prev.includes(id) ? prev.filter((i: string) => i !== id) : [...prev, id]);

    const saveSelectedCalendars = async () => {
        const payload = selectedCalIds.map((id: string) => {
            const cal = userCalendars.find((c) => c.id === id);
            return { id, summary: cal?.summary || id, color: calColors[id] || cal?.backgroundColor || '#4285F4' };
        });
        try {
            await api.post('/api/integrations/google/select-calendars', { selected_calendars: payload });
            setShowCalendarSelector(false);
            void load();
        } catch { alert('Erro ao salvar.'); }
    };

    const disconnectAndCleanGoogle = async () => {
        if (!confirm('Desconectar o Google Calendar e limpar todos os dados locais do OpenFamily?')) return;
        await api.post('/api/integrations/google/disconnect-and-clean', {});
        void load();
    };

    const openModal = (type: string) => { setActiveModal(type); setFormValues({}); setTestStatus(null); };
    const closeModal = () => setActiveModal(null);

    const handleTest = async () => {
        setTesting(true);
        try {
            const res = await api.post<{ success: boolean; message: string }>('/api/integrations/test', { type: activeModal, ...formValues });
            setTestStatus({ ok: res.success, message: res.message });
        } catch (err: any) { setTestStatus({ ok: false, message: err.message }); } finally { setTesting(false); }
    };

    const handleConnect = async () => {
        setSaving(true);
        try {
            if (activeModal === 'google_calendar') {
                await api.post('/api/integrations/google/config', {
                    client_id: formValues.client_id,
                    client_secret: formValues.client_secret,
                });
                const redirectUri = `${window.location.origin}/settings/integrations/google/callback`;
                const res = await api.get<{ success: boolean; authUrl: string }>(`/api/integrations/google/auth-url?redirectUri=${encodeURIComponent(redirectUri)}`);
                if (res.success && res.authUrl) {
                    window.location.href = res.authUrl;
                    return;
                }
            }
            await api.post('/api/integrations', { type: activeModal, display_name: CATALOG.find((c) => c.id === activeModal)?.name, ...formValues });
            closeModal();
            void load();
        } finally { setSaving(false); }
    };

    const handleSync = async (id: string) => { setSyncingId(id); await api.post(`/api/integrations/${id}/sync`, {}); setSyncingId(null); void load(); };

    const availableCatalog = CATALOG.filter((c) => !integrations.find((i) => i.type === c.id));

    return (
        <div className="space-y-6 max-w-4xl mx-auto pb-12">
            <div>
                <h1 className="font-serif text-h1 text-foreground">{t('integrations:title')}</h1>
                <p className="text-body-sm text-muted-foreground mt-1">{t('integrations:subtitle')}</p>
            </div>

            {loading && <div className="flex justify-center py-12"><span className="h-6 w-6 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>}

            {!loading && integrations.length > 0 && (
                <section>
                    <h2 className="font-serif text-h2 mb-4">{t('integrations:active')}</h2>
                    <div className="grid gap-3">
                        {integrations.map((integ) => {
                            const item = CATALOG.find((c) => c.id === integ.type);
                            if (!item) return null;
                            const isGoogle = integ.type === 'google_calendar';
                            return (
                                <div key={integ.id} className="flex items-center justify-between gap-4 rounded-card border border-border bg-card p-5 shadow-sm">
                                    <div className="flex items-center gap-4">
                                        <div className="h-11 w-11 rounded-input flex items-center justify-center bg-surface-2 border"><BrandIcon id={item.id} size={22} /></div>
                                        <div>
                                            <div className="flex items-center gap-2"><p className="text-body font-semibold">{item.name}</p>{statusBadge(integ.status)}</div>
                                            {isGoogle && (
                                                <div className="mt-2 flex items-center gap-2">
                                                    <button onClick={loadCalendars} disabled={loadingCalendars} className="text-micro px-2.5 py-1 rounded border border-primary/40 bg-primary/10 text-primary font-medium hover:bg-primary/20 transition-colors flex items-center gap-1.5">
                                                        <Calendar className="h-3.5 w-3.5" /> Vincular Agendas
                                                    </button>
                                                    <button onClick={disconnectAndCleanGoogle} className="text-micro px-2.5 py-1 rounded border border-danger/30 bg-danger/10 text-danger font-medium hover:bg-danger/20 transition-colors flex items-center gap-1.5">
                                                        <Trash2 className="h-3.5 w-3.5" /> Desconectar e Limpar
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-1">
                                        <button onClick={() => handleSync(integ.id)} className="p-2 text-muted-foreground hover:text-foreground"><RefreshCw className={cn('h-4 w-4', syncingId === integ.id && 'animate-spin')} /></button>
                                        <button onClick={() => api.delete(`/api/integrations/${integ.id}`).then(load)} className="p-2 text-danger"><Unplug className="h-4 w-4" /></button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </section>
            )}

            <section>
                <h2 className="font-serif text-h2 mb-4">{t('integrations:available')}</h2>
                <div className="grid gap-3">
                    {availableCatalog.map((item) => (
                        <button key={item.id} onClick={() => openModal(item.id)} className="flex items-center gap-4 rounded-card border border-border bg-card p-5 text-left hover:bg-surface-2">
                            <div className="h-11 w-11 rounded-input flex items-center justify-center bg-surface-2 border"><BrandIcon id={item.id} size={22} /></div>
                            <div><p className="font-semibold">{item.name}</p><p className="text-caption text-muted-foreground">{item.tagline}</p></div>
                        </button>
                    ))}
                </div>
            </section>

            {activeModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={closeModal} />
                    <Card className="relative w-full max-w-md">
                        <CardHeader className="flex justify-between flex-row items-center">
                            <CardTitle className="font-serif text-h2">Conectar {CATALOG.find((c) => c.id === activeModal)?.name}</CardTitle>
                            <X className="h-4 w-4 cursor-pointer" onClick={closeModal} />
                        </CardHeader>
                        <CardContent className="space-y-4">
                            {CATALOG.find((c) => c.id === activeModal)?.fields.map((f) => (
                                <Input key={f.key} label={f.label} type={f.type} value={formValues[f.key] || ''} onChange={(e) => setFormValues((v) => ({ ...v, [f.key]: e.target.value }))} />
                            ))}
                            {testStatus && (
                                <div className={cn('p-3 rounded-card text-caption flex items-center gap-2 border', testStatus.ok ? 'border-success/30 bg-success/10 text-success' : 'border-danger/30 bg-danger/10 text-danger')}>
                                    <CheckCircle2 className="h-4 w-4" />
                                    <span>{testStatus.message}</span>
                                </div>
                            )}
                            <div className="flex gap-2">
                                <Button variant="secondary" onClick={handleTest} disabled={testing}>{testing ? 'Testando...' : 'Testar'}</Button>
                                <Button onClick={handleConnect} disabled={saving}>{saving ? 'Conectando...' : 'Conectar'}</Button>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            )}

            {showCalendarSelector && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowCalendarSelector(false)} />
                    <Card className="relative w-full max-w-lg">
                        <CardHeader className="flex justify-between flex-row items-center">
                            <CardTitle className="font-serif text-h2">Vincular Agendas do Google</CardTitle>
                            <X className="h-4 w-4 cursor-pointer" onClick={() => setShowCalendarSelector(false)} />
                        </CardHeader>
                        <CardContent className="space-y-2 max-h-80 overflow-y-auto">
                            {userCalendars.map((cal, idx) => {
                                const isChecked = selectedCalIds.includes(cal.id);
                                const defaultColors = ['#4285F4', '#0F9D58', '#F4B400', '#DB4437', '#AB47BC', '#00ACC1'];
                                const currentColor = calColors[cal.id] || cal.backgroundColor || defaultColors[idx % defaultColors.length];

                                return (
                                    <div
                                        key={cal.id}
                                        onClick={() => toggleCalSelection(cal.id)}
                                        className={cn('p-3 rounded-card border cursor-pointer flex justify-between items-center', isChecked ? 'border-primary bg-primary/5' : 'border-border')}
                                    >
                                        <div className="flex items-center gap-3">
                                            <input type="checkbox" checked={isChecked} onChange={() => toggleCalSelection(cal.id)} className="h-4 w-4 text-primary" />
                                            <div>
                                                <p className="font-medium flex items-center gap-2">
                                                    <span className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: currentColor }} />
                                                    {cal.summary}
                                                </p>
                                                {cal.primary && <span className="text-micro text-primary font-medium">Principal</span>}
                                            </div>
                                        </div>
                                        {isChecked && <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />}
                                    </div>
                                );
                            })}
                        </CardContent>
                        <div className="p-4 border-t flex justify-end gap-2">
                            <Button variant="secondary" onClick={() => setShowCalendarSelector(false)}>Cancelar</Button>
                            <Button onClick={saveSelectedCalendars}>Salvar Agendas Selecionadas</Button>
                        </div>
                    </Card>
                </div>
            )}
        </div>
    );
};

export default Integrations;
