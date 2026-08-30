// ── Procedural Web Audio API Ambient Sound & Live Stream Engine (100% Offline + Online Streams) ──

export type SoundId =
    | 'rain'
    | 'thunder'
    | 'fireplace'
    | 'wind'
    | 'waves'
    | 'white_noise'
    | 'pink_noise'
    | 'brown_noise'
    | 'purr'
    | 'cafe'
    | 'birds'
    | 'lofi_radio'
    | 'relax_piano'
    | 'pet_music';

export interface SoundDef {
    id: SoundId;
    nameKey: string;
    icon: string;
    descriptionKey: string;
    category: 'nature' | 'noise' | 'pets' | 'ambiance' | 'radio';
    streamUrl?: string;
}

export const SOUND_DEFINITIONS: SoundDef[] = [
    { id: 'lofi_radio', nameKey: 'sounds:sound.lofi_radio', icon: '🎧', descriptionKey: 'sounds:desc.lofi_radio', category: 'radio', streamUrl: 'https://stream.zeno.fm/f3wvbbqmdg8uv' },
    { id: 'pet_music', nameKey: 'sounds:sound.pet_music', icon: '🐶', descriptionKey: 'sounds:desc.pet_music', category: 'pets', streamUrl: 'https://stream.zeno.fm/08w2r60vfa8uv' },
    { id: 'relax_piano', nameKey: 'sounds:sound.relax_piano', icon: '🎹', descriptionKey: 'sounds:desc.relax_piano', category: 'ambiance', streamUrl: 'https://stream.zeno.fm/m83y1g4q9h8uv' },
    { id: 'rain', nameKey: 'sounds:sound.rain', icon: '🌧️', descriptionKey: 'sounds:desc.rain', category: 'nature' },
    { id: 'thunder', nameKey: 'sounds:sound.thunder', icon: '⚡', descriptionKey: 'sounds:desc.thunder', category: 'nature' },
    { id: 'fireplace', nameKey: 'sounds:sound.fireplace', icon: '🔥', descriptionKey: 'sounds:desc.fireplace', category: 'nature' },
    { id: 'wind', nameKey: 'sounds:sound.wind', icon: '🍃', descriptionKey: 'sounds:desc.wind', category: 'nature' },
    { id: 'waves', nameKey: 'sounds:sound.waves', icon: '🌊', descriptionKey: 'sounds:desc.waves', category: 'nature' },
    { id: 'brown_noise', nameKey: 'sounds:sound.brown_noise', icon: '🤎', descriptionKey: 'sounds:desc.brown_noise', category: 'pets' },
    { id: 'purr', nameKey: 'sounds:sound.purr', icon: '🐱', descriptionKey: 'sounds:desc.purr', category: 'pets' },
    { id: 'pink_noise', nameKey: 'sounds:sound.pink_noise', icon: '🌸', descriptionKey: 'sounds:desc.pink_noise', category: 'noise' },
    { id: 'white_noise', nameKey: 'sounds:sound.white_noise', icon: '💤', descriptionKey: 'sounds:desc.white_noise', category: 'noise' },
    { id: 'cafe', nameKey: 'sounds:sound.cafe', icon: '☕', descriptionKey: 'sounds:desc.cafe', category: 'ambiance' },
    { id: 'birds', nameKey: 'sounds:sound.birds', icon: '🕊️', descriptionKey: 'sounds:desc.birds', category: 'ambiance' },
];

export interface PresetDef {
    id: string;
    nameKey: string;
    icon: string;
    sounds: Partial<Record<SoundId, number>>;
}

export const PRESETS: PresetDef[] = [
    {
        id: 'lofi_chill',
        nameKey: 'sounds:preset.lofi_chill',
        icon: '🎧',
        sounds: { lofi_radio: 0.8, rain: 0.2 },
    },
    {
        id: 'pet_calm',
        nameKey: 'sounds:preset.pet_calm',
        icon: '🐶🐱',
        sounds: { brown_noise: 0.7, pet_music: 0.5, purr: 0.4 },
    },
    {
        id: 'deep_sleep',
        nameKey: 'sounds:preset.deep_sleep',
        icon: '💤',
        sounds: { pink_noise: 0.5, waves: 0.4 },
    },
    {
        id: 'rainy_night',
        nameKey: 'sounds:preset.rainy_night',
        icon: '🌧️',
        sounds: { rain: 0.6, fireplace: 0.4, wind: 0.2 },
    },
    {
        id: 'relax_piano_preset',
        nameKey: 'sounds:preset.relax_piano',
        icon: '🎹',
        sounds: { relax_piano: 0.8, birds: 0.2 },
    },
];

class SoundChannel {
    public id: SoundId;
    public volume: number = 0.5;
    public active: boolean = false;
    public streamUrl?: string;

    private ctx: AudioContext;
    private gainNode: GainNode;
    private sourceNodes: AudioNode[] = [];
    private intervalId?: number;
    private audioElement?: HTMLAudioElement;

    constructor(ctx: AudioContext, masterGain: GainNode, def: SoundDef) {
        this.ctx = ctx;
        this.id = def.id;
        this.streamUrl = def.streamUrl;
        this.gainNode = ctx.createGain();
        this.gainNode.gain.setValueAtTime(0, ctx.currentTime);
        this.gainNode.connect(masterGain);
    }

    public setVolume(vol: number) {
        this.volume = Math.max(0, Math.min(1, vol));
        if (this.active) {
            this.gainNode.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.05);
            if (this.audioElement) {
                this.audioElement.volume = this.volume;
            }
        }
    }

    public start() {
        if (this.active) return;
        this.active = true;

        if (this.ctx.state === 'suspended') {
            this.ctx.resume();
        }

        this.buildNodes();
        this.gainNode.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.1);
    }

    public stop() {
        if (!this.active) return;
        this.active = false;

        this.gainNode.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1);
        setTimeout(() => {
            if (!this.active) {
                this.cleanup();
            }
        }, 150);
    }

    private cleanup() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = undefined;
        }
        if (this.audioElement) {
            this.audioElement.pause();
            this.audioElement.src = '';
            this.audioElement = undefined;
        }
        this.sourceNodes.forEach((n) => {
            try {
                if ('stop' in n && typeof (n as AudioScheduledSourceNode).stop === 'function') {
                    (n as AudioScheduledSourceNode).stop();
                }
                n.disconnect();
            } catch { /* ignore */ }
        });
        this.sourceNodes = [];
    }

    private buildNoiseBuffer(type: 'white' | 'pink' | 'brown'): AudioBuffer {
        const bufferSize = 5 * this.ctx.sampleRate;
        const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);

        if (type === 'white') {
            for (let i = 0; i < bufferSize; i++) {
                data[i] = Math.random() * 2 - 1;
            }
        } else if (type === 'pink') {
            let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
            for (let i = 0; i < bufferSize; i++) {
                const white = Math.random() * 2 - 1;
                b0 = 0.99886 * b0 + white * 0.0555179;
                b1 = 0.99332 * b1 + white * 0.0750759;
                b2 = 0.96900 * b2 + white * 0.1538520;
                b3 = 0.86650 * b3 + white * 0.3104856;
                b4 = 0.55000 * b4 + white * 0.5329522;
                b5 = -0.7616 * b5 - white * 0.0168980;
                data[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
                data[i] *= 0.11;
                b6 = white * 0.115926;
            }
        } else if (type === 'brown') {
            let lastOutput = 0.0;
            for (let i = 0; i < bufferSize; i++) {
                const white = Math.random() * 2 - 1;
                data[i] = (lastOutput + 0.02 * white) / 1.02;
                lastOutput = data[i];
                data[i] *= 3.5;
            }
        }
        return buffer;
    }

    private buildNodes() {
        this.cleanup();
        const ctx = this.ctx;

        if (this.streamUrl) {
            // Live Stream Player
            try {
                this.audioElement = new Audio(this.streamUrl);
                this.audioElement.crossOrigin = 'anonymous';
                this.audioElement.volume = this.volume;
                void this.audioElement.play();
            } catch { /* stream load error */ }
            return;
        }

        switch (this.id) {
            case 'white_noise': {
                const src = ctx.createBufferSource();
                src.buffer = this.buildNoiseBuffer('white');
                src.loop = true;
                src.connect(this.gainNode);
                src.start();
                this.sourceNodes.push(src);
                break;
            }
            case 'pink_noise': {
                const src = ctx.createBufferSource();
                src.buffer = this.buildNoiseBuffer('pink');
                src.loop = true;
                src.connect(this.gainNode);
                src.start();
                this.sourceNodes.push(src);
                break;
            }
            case 'brown_noise': {
                const src = ctx.createBufferSource();
                src.buffer = this.buildNoiseBuffer('brown');
                src.loop = true;

                const filter = ctx.createBiquadFilter();
                filter.type = 'lowpass';
                filter.frequency.setValueAtTime(400, ctx.currentTime);

                src.connect(filter);
                filter.connect(this.gainNode);
                src.start();
                this.sourceNodes.push(src, filter);
                break;
            }
            case 'rain': {
                const src = ctx.createBufferSource();
                src.buffer = this.buildNoiseBuffer('pink');
                src.loop = true;

                const filter = ctx.createBiquadFilter();
                filter.type = 'lowpass';
                filter.frequency.setValueAtTime(1200, ctx.currentTime);

                src.connect(filter);
                filter.connect(this.gainNode);
                src.start();
                this.sourceNodes.push(src, filter);
                break;
            }
            case 'wind': {
                const src = ctx.createBufferSource();
                src.buffer = this.buildNoiseBuffer('pink');
                src.loop = true;

                const filter = ctx.createBiquadFilter();
                filter.type = 'bandpass';
                filter.frequency.setValueAtTime(400, ctx.currentTime);
                filter.Q.setValueAtTime(3.0, ctx.currentTime);

                const lfo = ctx.createOscillator();
                lfo.frequency.setValueAtTime(0.15, ctx.currentTime);

                const lfoGain = ctx.createGain();
                lfoGain.gain.setValueAtTime(250, ctx.currentTime);

                lfo.connect(lfoGain);
                lfoGain.connect(filter.frequency);

                src.connect(filter);
                filter.connect(this.gainNode);

                src.start();
                lfo.start();
                this.sourceNodes.push(src, filter, lfo, lfoGain);
                break;
            }
            case 'waves': {
                const src = ctx.createBufferSource();
                src.buffer = this.buildNoiseBuffer('pink');
                src.loop = true;

                const filter = ctx.createBiquadFilter();
                filter.type = 'lowpass';
                filter.frequency.setValueAtTime(500, ctx.currentTime);

                const swellLfo = ctx.createOscillator();
                swellLfo.frequency.setValueAtTime(0.08, ctx.currentTime);

                const swellGain = ctx.createGain();
                swellGain.gain.setValueAtTime(0.4, ctx.currentTime);

                swellLfo.connect(swellGain.gain);
                src.connect(filter);
                filter.connect(swellGain);
                swellGain.connect(this.gainNode);

                src.start();
                swellLfo.start();
                this.sourceNodes.push(src, filter, swellLfo, swellGain);
                break;
            }
            case 'fireplace': {
                const src = ctx.createBufferSource();
                src.buffer = this.buildNoiseBuffer('brown');
                src.loop = true;

                const lowpass = ctx.createBiquadFilter();
                lowpass.type = 'lowpass';
                lowpass.frequency.setValueAtTime(250, ctx.currentTime);

                src.connect(lowpass);
                lowpass.connect(this.gainNode);
                src.start();
                this.sourceNodes.push(src, lowpass);

                this.intervalId = window.setInterval(() => {
                    if (!this.active) return;
                    if (Math.random() < 0.6) {
                        const clickSrc = ctx.createBufferSource();
                        const clickBuffer = ctx.createBuffer(1, ctx.sampleRate * 0.02, ctx.sampleRate);
                        const clickData = clickBuffer.getChannelData(0);
                        for (let i = 0; i < clickData.length; i++) {
                            clickData[i] = (Math.random() * 2 - 1) * Math.exp(-i / (clickData.length * 0.2));
                        }
                        clickSrc.buffer = clickBuffer;
                        const clickGain = ctx.createGain();
                        clickGain.gain.setValueAtTime(0.2 + Math.random() * 0.3, ctx.currentTime);
                        clickSrc.connect(clickGain);
                        clickGain.connect(this.gainNode);
                        clickSrc.start();
                    }
                }, 120);
                break;
            }
            case 'purr': {
                const osc = ctx.createOscillator();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(25, ctx.currentTime);

                const purrLfo = ctx.createOscillator();
                purrLfo.frequency.setValueAtTime(2.2, ctx.currentTime);

                const purrGain = ctx.createGain();
                purrGain.gain.setValueAtTime(0.5, ctx.currentTime);

                purrLfo.connect(purrGain.gain);
                osc.connect(purrGain);

                const noise = ctx.createBufferSource();
                noise.buffer = this.buildNoiseBuffer('pink');
                noise.loop = true;

                const noiseFilter = ctx.createBiquadFilter();
                noiseFilter.type = 'lowpass';
                noiseFilter.frequency.setValueAtTime(200, ctx.currentTime);

                noise.connect(noiseFilter);
                noiseFilter.connect(this.gainNode);

                purrGain.connect(this.gainNode);

                osc.start();
                purrLfo.start();
                noise.start();
                this.sourceNodes.push(osc, purrLfo, purrGain, noise, noiseFilter);
                break;
            }
            case 'thunder': {
                const noise = ctx.createBufferSource();
                noise.buffer = this.buildNoiseBuffer('brown');
                noise.loop = true;

                const filter = ctx.createBiquadFilter();
                filter.type = 'lowpass';
                filter.frequency.setValueAtTime(150, ctx.currentTime);

                noise.connect(filter);
                filter.connect(this.gainNode);
                noise.start();
                this.sourceNodes.push(noise, filter);

                this.intervalId = window.setInterval(() => {
                    if (!this.active) return;
                    if (Math.random() < 0.25) {
                        const rumbleTime = ctx.currentTime;
                        filter.frequency.setValueAtTime(150, rumbleTime);
                        filter.frequency.exponentialRampToValueAtTime(450, rumbleTime + 0.8);
                        filter.frequency.exponentialRampToValueAtTime(100, rumbleTime + 3.5);
                    }
                }, 4000);
                break;
            }
            case 'cafe': {
                const noise = ctx.createBufferSource();
                noise.buffer = this.buildNoiseBuffer('pink');
                noise.loop = true;

                const filter = ctx.createBiquadFilter();
                filter.type = 'bandpass';
                filter.frequency.setValueAtTime(800, ctx.currentTime);
                filter.Q.setValueAtTime(1.5, ctx.currentTime);

                noise.connect(filter);
                filter.connect(this.gainNode);
                noise.start();
                this.sourceNodes.push(noise, filter);
                break;
            }
            case 'birds': {
                const noise = ctx.createBufferSource();
                noise.buffer = this.buildNoiseBuffer('pink');
                noise.loop = true;

                const filter = ctx.createBiquadFilter();
                filter.type = 'bandpass';
                filter.frequency.setValueAtTime(2500, ctx.currentTime);
                filter.Q.setValueAtTime(4.0, ctx.currentTime);

                noise.connect(filter);
                filter.connect(this.gainNode);
                noise.start();
                this.sourceNodes.push(noise, filter);

                this.intervalId = window.setInterval(() => {
                    if (!this.active) return;
                    if (Math.random() < 0.4) {
                        const chirpOsc = ctx.createOscillator();
                        chirpOsc.type = 'sine';
                        const now = ctx.currentTime;
                        const freq = 2000 + Math.random() * 1500;
                        chirpOsc.frequency.setValueAtTime(freq, now);
                        chirpOsc.frequency.exponentialRampToValueAtTime(freq + 600, now + 0.08);
                        chirpOsc.frequency.exponentialRampToValueAtTime(freq - 300, now + 0.16);

                        const chirpGain = ctx.createGain();
                        chirpGain.gain.setValueAtTime(0.08, now);
                        chirpGain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);

                        chirpOsc.connect(chirpGain);
                        chirpGain.connect(this.gainNode);

                        chirpOsc.start(now);
                        chirpOsc.stop(now + 0.22);
                    }
                }, 800);
                break;
            }
        }
    }
}

export class AmbientSoundEngine {
    private static instance: AmbientSoundEngine;
    private ctx?: AudioContext;
    private masterGain?: GainNode;
    private channels: Map<SoundId, SoundChannel> = new Map();
    private masterVolume: number = 0.8;
    private activePresetId?: string;
    private sleepTimerTimeout?: number;
    private sleepTimerEndAt?: number;
    private listeners: Set<() => void> = new Set();

    private constructor() {}

    public static getInstance(): AmbientSoundEngine {
        if (!AmbientSoundEngine.instance) {
            AmbientSoundEngine.instance = new AmbientSoundEngine();
        }
        return AmbientSoundEngine.instance;
    }

    private initContext() {
        if (!this.ctx) {
            const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
            this.ctx = new AudioCtx();
            this.masterGain = this.ctx.createGain();
            this.masterGain.gain.setValueAtTime(this.masterVolume, this.ctx.currentTime);
            this.masterGain.connect(this.ctx.destination);

            SOUND_DEFINITIONS.forEach((def) => {
                this.channels.set(def.id, new SoundChannel(this.ctx!, this.masterGain!, def));
            });
        }
    }

    public subscribe(fn: () => void): () => void {
        this.listeners.add(fn);
        return () => this.listeners.delete(fn);
    }

    private notify() {
        this.listeners.forEach((fn) => fn());
    }

    public toggleSound(id: SoundId) {
        this.initContext();
        const ch = this.channels.get(id);
        if (!ch) return;

        if (ch.active) {
            ch.stop();
        } else {
            ch.start();
        }
        this.activePresetId = undefined;
        this.notify();
    }

    public setSoundVolume(id: SoundId, vol: number) {
        this.initContext();
        const ch = this.channels.get(id);
        if (!ch) return;
        ch.setVolume(vol);
        this.notify();
    }

    public setMasterVolume(vol: number) {
        this.initContext();
        this.masterVolume = Math.max(0, Math.min(1, vol));
        if (this.masterGain && this.ctx) {
            this.masterGain.gain.setTargetAtTime(this.masterVolume, this.ctx.currentTime, 0.05);
        }
        this.notify();
    }

    public applyPreset(preset: PresetDef) {
        this.initContext();
        this.activePresetId = preset.id;
        this.channels.forEach((ch, id) => {
            if (preset.sounds[id] === undefined) {
                ch.stop();
            } else {
                ch.setVolume(preset.sounds[id]!);
                ch.start();
            }
        });
        this.notify();
    }

    public nextPreset() {
        const idx = PRESETS.findIndex((p) => p.id === this.activePresetId);
        const nextIdx = (idx + 1) % PRESETS.length;
        this.applyPreset(PRESETS[nextIdx]);
    }

    public stopAll() {
        this.channels.forEach((ch) => ch.stop());
        this.activePresetId = undefined;
        this.cancelSleepTimer();
        this.notify();
    }

    public setSleepTimer(minutes: number) {
        this.cancelSleepTimer();
        if (minutes <= 0) return;

        this.sleepTimerEndAt = Date.now() + minutes * 60 * 1000;
        const fadeMs = 60 * 1000;
        const totalMs = minutes * 60 * 1000;

        this.sleepTimerTimeout = window.setTimeout(() => {
            if (this.masterGain && this.ctx) {
                this.masterGain.gain.setTargetAtTime(0, this.ctx.currentTime, fadeMs / 1000 / 3);
            }
            setTimeout(() => {
                this.stopAll();
            }, fadeMs);
        }, Math.max(0, totalMs - fadeMs));

        this.notify();
    }

    public cancelSleepTimer() {
        if (this.sleepTimerTimeout) {
            clearTimeout(this.sleepTimerTimeout);
            this.sleepTimerTimeout = undefined;
        }
        this.sleepTimerEndAt = undefined;
        if (this.masterGain && this.ctx) {
            this.masterGain.gain.setTargetAtTime(this.masterVolume, this.ctx.currentTime, 0.05);
        }
        this.notify();
    }

    public getState() {
        const activeSounds: Record<SoundId, { active: boolean; volume: number }> = {} as any;
        let anyActive = false;
        let activeCount = 0;

        this.channels.forEach((ch, id) => {
            activeSounds[id] = { active: ch.active, volume: ch.volume };
            if (ch.active) {
                anyActive = true;
                activeCount++;
            }
        });

        const activePreset = PRESETS.find((p) => p.id === this.activePresetId);

        return {
            masterVolume: this.masterVolume,
            anyActive,
            activeCount,
            activePreset,
            sleepTimerEndAt: this.sleepTimerEndAt,
            sounds: activeSounds,
        };
    }
}

export const soundEngine = AmbientSoundEngine.getInstance();
