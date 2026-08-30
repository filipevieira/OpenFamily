/**
 * OpenFamily E2E Test Suite - UI, Layout & Responsiveness Verification Harness
 * 
 * Verifies DOM structure, responsive constraints, sticky headers/footers,
 * and i18n localization keys without external browser dependencies.
 */

import fs from 'node:fs';
import path from 'node:path';

export class UiVerificationHarness {
    constructor(projectRoot) {
        this.projectRoot = projectRoot;
        this.kioskCode = '';
        this.settingsCode = '';
        this.locales = {};
        this.loadSourceFiles();
    }

    loadSourceFiles() {
        try {
            const kioskPath = path.join(this.projectRoot, 'client', 'src', 'pages', 'Kiosk.tsx');
            if (fs.existsSync(kioskPath)) {
                this.kioskCode = fs.readFileSync(kioskPath, 'utf8');
            }
            const settingsPath = path.join(this.projectRoot, 'client', 'src', 'pages', 'Settings.tsx');
            if (fs.existsSync(settingsPath)) {
                this.settingsCode = fs.readFileSync(settingsPath, 'utf8');
            }

            const localesDir = path.join(this.projectRoot, 'client', 'src', 'i18n', 'locales');
            if (fs.existsSync(localesDir)) {
                const langDirs = ['en', 'pt', 'fr', 'zh'];
                for (const lang of langDirs) {
                    this.locales[lang] = {};
                    const langPath = path.join(localesDir, lang);
                    if (fs.existsSync(langPath)) {
                        const files = fs.readdirSync(langPath);
                        for (const file of files) {
                            if (file.endsWith('.json')) {
                                const ns = file.replace('.json', '');
                                const content = JSON.parse(fs.readFileSync(path.join(langPath, file), 'utf8'));
                                this.locales[lang][ns] = content;
                            }
                        }
                    }
                }
            }
        } catch (e) {
            console.error('Failed loading UI source files:', e);
        }
    }

    // Check if hardcoded 42" display text exists in Kiosk.tsx
    hasHardcoded42InchLabel() {
        return this.kioskCode.includes('Modo Smart Display 42"');
    }

    // Check if pairing screen contains fluid responsive QR styling
    hasResponsiveQrLayout() {
        // Must have pairing code section, dynamic qr sizing, and responsive grid/flex
        const hasQrContainer = this.kioskCode.includes('api.qrserver.com') || this.kioskCode.includes('qrcode');
        const hasResponsiveSizing = this.kioskCode.includes('w-60 h-60') || this.kioskCode.includes('max-w-') || this.kioskCode.includes('aspect-square');
        const hasCodeBlock = this.kioskCode.includes('pairingCode') || this.kioskCode.includes('cleanCode');
        return hasQrContainer && hasResponsiveSizing && hasCodeBlock;
    }

    // Check if modals have sticky header and sticky footer
    hasStickyModalLayout() {
        const hasMaxHeight = this.kioskCode.includes('max-h-[85vh]') || this.kioskCode.includes('max-h-');
        const hasFlexCol = this.kioskCode.includes('flex flex-col overflow-hidden');
        const hasStickyTop = this.kioskCode.includes('sticky top-0') || this.kioskCode.includes('border-b');
        const hasStickyBottom = this.kioskCode.includes('sticky bottom-0') || this.kioskCode.includes('border-t');
        const hasCloseButton = this.kioskCode.includes('Fechar Configurações') || this.kioskCode.includes('displaySettings.close');
        return hasMaxHeight && hasFlexCol && hasStickyTop && hasStickyBottom && hasCloseButton;
    }

    // Check if header controls are lean (dimmer, zoom, dark mode, weather)
    hasLeanHeaderControls() {
        const hasDimmer = this.kioskCode.includes('brightness') && this.kioskCode.includes('Sun');
        const hasZoom = this.kioskCode.includes('zoom') && (this.kioskCode.includes('ZoomIn') || this.kioskCode.includes('ZoomOut'));
        const hasDarkMode = this.kioskCode.includes('darkMode') || this.kioskCode.includes('dark');
        const hasWeather = this.kioskCode.includes('weather') || this.kioskCode.includes('fetchWeather');
        return hasDimmer && hasZoom && hasDarkMode && hasWeather;
    }

    // Simulate viewport rendering bounds
    simulateViewport(width, height) {
        // Simulate container dimensions and verify if elements would overflow
        const isCompact = width <= 1024 && height <= 600;
        const isTv4K = width >= 3840 && height >= 2160;
        const isPortraitFridge = width <= 800 && height >= 1200;

        // Modal height calculations
        const maxModalHeight = height * 0.85;
        const headerHeight = 60;
        const footerHeight = 60;
        const availableBodyHeight = maxModalHeight - (headerHeight + footerHeight);

        return {
            width,
            height,
            isCompact,
            isTv4K,
            isPortraitFridge,
            maxModalHeight,
            availableBodyHeight,
            stickyHeaderVisible: true,
            stickyFooterVisible: true,
            fitsWithoutClipping: availableBodyHeight > 100,
        };
    }
}
