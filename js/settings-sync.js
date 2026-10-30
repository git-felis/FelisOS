/*
 * FILE: settings-sync.js
 * FelisOS System Preferences Synchronization Engine
 * Handles live wallpaper, pastel accents, themes, motion, docking, and window physics.
 */

(function (global) {
  'use strict';

  const WALLPAPERS = [
    { id: 'wp-default-daybreak.png', name: 'Daybreak', file: 'wp-default-daybreak.png' },
    { id: 'wp-ascending.png', name: 'Ascending', file: 'wp-ascending.png' },
    { id: 'wp-lavender-dunes.jpg', name: 'Lavender Dunes', file: 'wp-lavender-dunes.jpg' },
    { id: 'wp-mint-aurora.jpg', name: 'Mint Aurora', file: 'wp-mint-aurora.jpg' },
    { id: 'wp-pastel-peaks.jpg', name: 'Pastel Peaks', file: 'wp-pastel-peaks.jpg' },
    { id: 'wp-sunset-clouds.jpg', name: 'Sunset Clouds', file: 'wp-sunset-clouds.jpg' },
    { id: 'wp-jellyfish.png', name: 'Ubuntu 22.04 (Jelly)', file: 'wp-jellyfish.png' },
		{ id: 'wp-unixporn.png', name: 'NUDL 6.1 Unixporn', file: 'wp-unixporn.png' }
  ];

  const PASTEL_ACCENTS = [
    { name: 'Pastel Lilac', hex: '#d8b4fe', rgb: '216, 180, 254' },
    { name: 'Blush Rose', hex: '#f9a8d4', rgb: '249, 168, 212' },
    { name: 'Sky Blue', hex: '#7dd3fc', rgb: '125, 211, 252' },
    { name: 'Mint', hex: '#86efac', rgb: '134, 239, 172' },
    { name: 'Amber', hex: '#fcd34d', rgb: '252, 211, 77' },
    { name: 'Coral', hex: '#fca5a5', rgb: '252, 165, 165' }
  ];

  const DEFAULT_SETTINGS = {
    theme: 'dark',
    accentColor: '#d8b4fe',
    accentRgb: '216, 180, 254',
    wallpaper: 'wp-default-daybreak.png',
    reduceMotion: false,
    backdropBlur: true,
    snapGhost: true,
    titlebarAction: 'maximize',
    snapThreshold: 24,
    dockPosition: 'bottom',
    appDefaults: {
      editor: 'scribe',
      viewer: 'kneadydox',
      browser: 'browser',
    },
  };

  const STORAGE_KEY = 'felis_system_preferences';

  function hexToRgb(hex) {
    const clean = hex.replace('#', '');
    if (clean.length === 3) {
      const r = parseInt(clean[0] + clean[0], 16);
      const g = parseInt(clean[1] + clean[1], 16);
      const b = parseInt(clean[2] + clean[2], 16);
      return `${r}, ${g}, ${b}`;
    }
    if (clean.length === 6) {
      const r = parseInt(clean.substring(0, 2), 16);
      const g = parseInt(clean.substring(2, 4), 16);
      const b = parseInt(clean.substring(4, 6), 16);
      return `${r}, ${g}, ${b}`;
    }
    return '216, 180, 254';
  }

  function getSettings() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) || {};
        return {
          ...DEFAULT_SETTINGS,
          ...parsed,
          appDefaults: {
            ...DEFAULT_SETTINGS.appDefaults,
            ...(parsed.appDefaults || {})
          }
        };
      }
    } catch (_) {}
    return { ...DEFAULT_SETTINGS, appDefaults: { ...DEFAULT_SETTINGS.appDefaults } };
  }

  function isDesktopRoot() {
    return typeof document !== 'undefined' && !!document.getElementById('desktop-container');
  }

  function getSafeParent() {
    // If this current document is the desktop root shell, never touch window.parent
    if (isDesktopRoot()) return null;
    try {
      if (window.parent && window.parent !== window && window.parent.document) {
        return window.parent;
      }
    } catch (_) {
      // Cross-origin iframe container (e.g. AI Studio shell)
      return null;
    }
    return null;
  }

  function applySettingsToEnvironment(settings, targetWin = window) {
    try {
      if (!targetWin || !targetWin.document) return;
      const doc = targetWin.document;
      const body = doc.body;
      const root = doc.documentElement;
      if (!body || !root) return;

      // 1. Wallpaper (only applicable to desktop workspace)
      const isDesktop = !!doc.getElementById('desktop-container');
      if (isDesktop) {
        const wallpaper = WALLPAPERS.find(item => item.file === settings.wallpaper) || WALLPAPERS[0];
        const wpPath = new URL(`assets/wallpapers/${encodeURIComponent(wallpaper.file)}`, doc.baseURI).href;
        body.style.backgroundImage = `url("${wpPath}")`;
        body.style.backgroundPosition = 'center';
        body.style.backgroundRepeat = 'no-repeat';
        body.style.backgroundSize = 'cover';
      }

      // 2. Pastel Accent Colors
      const accentHex = settings.accentColor || '#d8b4fe';
      const accentRgb = settings.accentRgb || hexToRgb(accentHex);
      root.style.setProperty('--accent', accentHex);
      root.style.setProperty('--accent-rgb', accentRgb);
      root.style.setProperty('--text-hover', accentHex);
      root.style.setProperty('--stroke-hover', accentHex);
      root.style.setProperty('--window-border-dragged', `1px solid ${accentHex}`);
      root.style.setProperty('--surface-control-hover', `rgba(${accentRgb}, 0.18)`);
      root.style.setProperty('--focus-ring', `0 0 0 2px var(--bg-desktop), 0 0 0 4px ${accentHex}`);

      // If inside settings frame, also update --pref-accent
      root.style.setProperty('--pref-accent', accentHex);

      // 3. Theme
      body.classList.remove('theme-dim', 'theme-high-contrast', 'theme-light');
      if (settings.theme && settings.theme !== 'dark') {
        body.classList.add(`theme-${settings.theme}`);
      }

      // 4. Reduce Motion
      body.classList.toggle('reduce-motion', !!settings.reduceMotion);

      // 5. Window Backdrop Blur
      body.classList.toggle('no-blur', settings.backdropBlur === false);

      // 6. Dock Position (only applicable to main desktop)
      const dockContainer = doc.querySelector('.dock-container');
      if (dockContainer) {
        dockContainer.classList.toggle('dock-left', settings.dockPosition === 'left');
      }
      if (doc.body) {
        doc.body.classList.toggle('dock-left', settings.dockPosition === 'left');
        doc.body.classList.toggle('dock-bottom', settings.dockPosition !== 'left');
      }

      // 7. Window Manager physics & flags
      targetWin.__felisTitlebarAction = settings.titlebarAction || 'maximize';
      targetWin.__felisSnapThreshold = parseInt(settings.snapThreshold || '24', 10);
      targetWin.__felisSnapGhost = settings.snapGhost !== false;
    } catch (_) {
      // Ignored if target window is inaccessible
    }
  }

  function saveSettings(partialSettings) {
    const current = getSettings();
    const updated = Object.assign({}, current, partialSettings);

    if (partialSettings.accentColor && !partialSettings.accentRgb) {
      updated.accentRgb = hexToRgb(partialSettings.accentColor);
    }

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    } catch (error) {
      console.error('Unable to persist FelisOS system preferences:', error);
      throw error;
    }

    // Persist to VFS if accessible
    const safeParent = getSafeParent();
    const vfs = (safeParent && safeParent.FelisOSVFS) ? safeParent.FelisOSVFS : window.FelisOSVFS;
    if (vfs && typeof vfs.writeState === 'function') {
      vfs.writeState('settings', updated).catch(error => {
        console.error('Unable to save system preferences to the VDisk:', error);
      });
    }

    // Apply to current window
    applySettingsToEnvironment(updated, window);

    // Apply to parent window only if same-origin parent exists
    if (safeParent) {
      applySettingsToEnvironment(updated, safeParent);
    }

    // Broadcast across windows if any
    try {
      window.dispatchEvent(new CustomEvent('felis:settings-changed', { detail: updated }));
      if (safeParent && typeof safeParent.dispatchEvent === 'function') {
        safeParent.dispatchEvent(new CustomEvent('felis:settings-changed', { detail: updated }));
      }
    } catch (_) {}

    return updated;
  }

  function init() {
    const settings = getSettings();
    applySettingsToEnvironment(settings, window);

    // Also auto-apply if same-origin parent is accessible
    const safeParent = getSafeParent();
    if (safeParent) {
      applySettingsToEnvironment(settings, safeParent);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  global.FelisOSSettings = {
    WALLPAPERS,
    PASTEL_ACCENTS,
    DEFAULT_SETTINGS,
    getSettings,
    saveSettings,
    applySettings: applySettingsToEnvironment,
    hexToRgb,
  };

}(typeof window !== 'undefined' ? window : this));
