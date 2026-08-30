import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Volume2, Square, Timer, Sparkles, Disc } from 'lucide-react';
import { soundEngine, SOUND_DEFINITIONS, PRESETS, type SoundId } from '../lib/soundEngine';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { cn } from '../lib/utils';

export default function Sounds() {
    const { t } = useTranslation();
    const [engineState, setEngineState] = useState(() => soundEngine.getState());
    const [timerMinutes, setTimerMinutes] = useState<number | null>(null);

    useEffect(() => {
        const unsubscribe = soundEngine.subscribe(() => {
            setEngineState(soundEngine.getState());
        });
        return unsubscribe;
    }, []);

    const handleToggleSound = (id: SoundId) => {
        soundEngine.toggleSound(id);
    };

    const handleVolumeChange = (id: SoundId, e: React.ChangeEvent<HTMLInputElement>) => {
        soundEngine.setSoundVolume(id, parseFloat(e.target.value));
    };

    const handleMasterVolume = (e: React.ChangeEvent<HTMLInputElement>) => {
        soundEngine.setMasterVolume(parseFloat(e.target.value));
    };

    const handleTimer = (mins: number) => {
        if (timerMinutes === mins) {
            setTimerMinutes(null);
            soundEngine.cancelSleepTimer();
        } else {
            setTimerMinutes(mins);
            soundEngine.setSleepTimer(mins);
        }
    };

    const formatRemainingTime = (endAt?: number) => {
        if (!endAt) return null;
        const diffSec = Math.max(0, Math.round((endAt - Date.now()) / 1000));
        const m = Math.floor(diffSec / 60);
        const s = diffSec % 60;
        return `${m}:${s < 10 ? '0' : ''}${s}`;
    };

    return (
        <div className="mx-auto max-w-5xl space-y-8 p-4 sm:p-6 lg:p-8">
            {/* Header section */}
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h1 className="flex items-center gap-3 font-serif text-h1">
                        <Sparkles className="h-8 w-8 text-primary" />
                        {t('sounds:title')}
                    </h1>
                    <p className="mt-1 text-body text-muted-foreground">
                        {t('sounds:subtitle')}
                    </p>
                </div>

                {engineState.anyActive && (
                    <Button
                        variant="destructive"
                        onClick={() => soundEngine.stopAll()}
                        className="flex shrink-0 items-center gap-2"
                    >
                        <Square className="h-4 w-4" />
                        {t('sounds:stopAll')}
                    </Button>
                )}
            </div>

            {/* Presets section */}
            <div className="space-y-3">
                <h2 className="text-caption font-bold uppercase tracking-wider text-muted-foreground">
                    {t('sounds:presetsTitle')}
                </h2>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {PRESETS.map((preset) => (
                        <Card
                            key={preset.id}
                            onClick={() => soundEngine.applyPreset(preset)}
                            className="group flex cursor-pointer items-center gap-3 p-4 transition-all hover:border-primary hover:bg-primary/5 active:scale-[0.98]"
                        >
                            <span className="text-2xl">{preset.icon}</span>
                            <div className="min-w-0">
                                <p className="truncate text-body font-semibold group-hover:text-primary">
                                    {t(preset.nameKey)}
                                </p>
                                <p className="text-micro text-muted-foreground">{t('sounds:presetTap')}</p>
                            </div>
                        </Card>
                    ))}
                </div>
            </div>

            {/* Sound channels grid */}
            <div className="space-y-4">
                <h2 className="text-caption font-bold uppercase tracking-wider text-muted-foreground">
                    {t('sounds:catalogTitle')}
                </h2>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {SOUND_DEFINITIONS.map((def) => {
                        const st = engineState.sounds[def.id] || { active: false, volume: 0.5 };
                        const isActive = st.active;

                        return (
                            <Card
                                key={def.id}
                                className={cn(
                                    'flex flex-col justify-between p-5 transition-all',
                                    isActive
                                        ? 'border-primary bg-primary/10 shadow-md ring-1 ring-primary/30'
                                        : 'hover:border-border/80'
                                )}
                            >
                                <div className="flex items-start justify-between gap-3">
                                    <div className="flex items-center gap-3">
                                        <span className="text-3xl">{def.icon}</span>
                                        <div>
                                            <div className="flex items-center gap-2">
                                                <h3 className="font-semibold text-body">{t(def.nameKey)}</h3>
                                                {def.category === 'pets' && (
                                                    <Badge variant="warning" className="text-micro">
                                                        🐶🐱 Pet Calm
                                                    </Badge>
                                                )}
                                            </div>
                                            <p className="mt-0.5 text-caption text-muted-foreground">{t(def.descriptionKey)}</p>
                                        </div>
                                    </div>
                                </div>

                                <div className="mt-5 space-y-3">
                                    {/* Volume slider */}
                                    <div className="flex items-center gap-3">
                                        <Volume2 className={cn('h-4 w-4 shrink-0', isActive ? 'text-primary' : 'text-muted-foreground')} />
                                        <input
                                            type="range"
                                            min="0"
                                            max="1"
                                            step="0.01"
                                            value={st.volume}
                                            disabled={!isActive}
                                            onChange={(e) => handleVolumeChange(def.id, e)}
                                            className="h-2 flex-1 cursor-pointer appearance-none rounded-lg bg-surface-2 accent-primary disabled:opacity-40"
                                        />
                                        <span className="w-8 text-right font-mono text-micro text-muted-foreground">
                                            {Math.round(st.volume * 100)}%
                                        </span>
                                    </div>

                                    {/* Start / Stop button */}
                                    <Button
                                        type="button"
                                        variant={isActive ? 'primary' : 'ghost'}
                                        onClick={() => handleToggleSound(def.id)}
                                        className={cn('w-full justify-center gap-2', !isActive && 'border border-border')}
                                    >
                                        {isActive ? (
                                            <>
                                                <Square className="h-4 w-4 fill-current" />
                                                {t('sounds:stop')}
                                            </>
                                        ) : (
                                            <>
                                                <Disc className="h-4 w-4" />
                                                {t('sounds:play')}
                                            </>
                                        )}
                                    </Button>
                                </div>
                            </Card>
                        );
                    })}
                </div>
            </div>

            {/* Floating Master Bar & Sleep Timer */}
            {engineState.anyActive && (
                <div className="sticky bottom-6 z-30 mx-auto max-w-2xl rounded-card border border-border bg-card/95 p-4 shadow-xl backdrop-blur-md">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                        {/* Master volume */}
                        <div className="flex flex-1 items-center gap-3">
                            <Volume2 className="h-5 w-5 text-primary" />
                            <div className="flex-1">
                                <p className="text-micro font-medium text-muted-foreground">{t('sounds:masterVolume')}</p>
                                <input
                                    type="range"
                                    min="0"
                                    max="1"
                                    step="0.01"
                                    value={engineState.masterVolume}
                                    onChange={handleMasterVolume}
                                    className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-surface-2 accent-primary"
                                />
                            </div>
                            <span className="font-mono text-caption font-bold text-primary">
                                {Math.round(engineState.masterVolume * 100)}%
                            </span>
                        </div>

                        {/* Sleep Timer */}
                        <div className="flex items-center gap-2 border-t border-border pt-3 sm:border-l sm:border-t-0 sm:pl-4 sm:pt-0">
                            <Timer className="h-4 w-4 text-muted-foreground" />
                            <span className="whitespace-nowrap text-micro font-medium text-muted-foreground">{t('sounds:timer')}:</span>
                            {[15, 30, 60].map((mins) => (
                                <button
                                    key={mins}
                                    type="button"
                                    onClick={() => handleTimer(mins)}
                                    className={cn(
                                        'rounded-input px-2.5 py-1 text-micro font-medium transition-colors',
                                        timerMinutes === mins
                                            ? 'bg-primary text-primary-foreground'
                                            : 'bg-surface-2 text-muted-foreground hover:bg-surface-3'
                                    )}
                                >
                                    {mins}m
                                </button>
                            ))}
                            {engineState.sleepTimerEndAt && (
                                <span className="font-mono text-micro font-bold text-amber-500">
                                    ⏱️ {formatRemainingTime(engineState.sleepTimerEndAt)}
                                </span>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
