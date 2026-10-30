/*
 * FILE: window-manager.js
 * FelisOS Window Manager
 * Comprehensive window lifecycle, focus, minimize, restore, close, maximize,
 * 8-direction resize, snapping/tiling boundaries, z-order, and state persistence.
 */

(function () {
  'use strict';

  // Early API bridge so child iframes immediately have an invokable window manager
  let wmImpl = null;
  const dispatch = (method, ...args) => {
    if (wmImpl && typeof wmImpl[method] === 'function') {
      return wmImpl[method](...args);
    }
    return null;
  };

  window.FelisOSWindowManager = window.FelisOSWindowManager || {
    launch: (...args) => dispatch('launch', ...args),
    focus: (...args) => dispatch('focus', ...args),
    minimize: (...args) => dispatch('minimize', ...args),
    restore: (...args) => dispatch('restore', ...args),
    maximize: (...args) => dispatch('maximize', ...args),
    unmaximize: (...args) => dispatch('unmaximize', ...args),
    toggleMaximize: (...args) => dispatch('toggleMaximize', ...args),
    close: (...args) => dispatch('close', ...args),
    snap: (...args) => dispatch('snap', ...args),
    tile: (...args) => dispatch('tile', ...args),
    cascade: (...args) => dispatch('cascade', ...args),
    getWindows: (...args) => dispatch('getWindows', ...args) || [],
    getWindowById: (...args) => dispatch('getWindowById', ...args),
    getFocusedWindow: (...args) => dispatch('getFocusedWindow', ...args),
    collectState: (...args) => dispatch('collectState', ...args),
    persistState: (...args) => dispatch('persistState', ...args),
    restoreState: (...args) => dispatch('restoreState', ...args),
    resolveWindow: (...args) => dispatch('resolveWindow', ...args),
    openDocument: (...args) => dispatch('openDocument', ...args)
  };

  document.addEventListener('DOMContentLoaded', () => {
    const appRegistry = window.FelisOSAppRegistry;
    const stateStore = window.FelisOSVFS;
    const desktop = document.getElementById('desktop-container') || document.body;
    let snapGhost = document.getElementById('snap-ghost');

    if (!snapGhost && desktop) {
      snapGhost = document.createElement('div');
      snapGhost.id = 'snap-ghost';
      snapGhost.className = 'felis-snap-ghost';
      snapGhost.setAttribute('aria-hidden', 'true');
      desktop.appendChild(snapGhost);
    }

    // Ensure all registered apps have a window container
    if (desktop && appRegistry && Array.isArray(appRegistry.apps)) {
      appRegistry.apps.forEach(app => {
        if (document.getElementById(app.windowId)) return;
        const win = document.createElement('div');
        win.className = 'ui-window';
        win.id = app.windowId;
        win.style.top = '50%';
        win.style.left = '50%';
        win.innerHTML = `
          <div class="window-titlebar">
            <div class="window-title">${app.displayName || (app.name || '').replace(/\.run$/, '')}</div>
            <div class="window-controls">
              <button class="icon-btn action-minimize" type="button" title="Minimize">
                <img src="assets/hide.svg" alt="Minimize" draggable="false">
              </button>
              <button class="icon-btn action-maximize" type="button" title="Maximize">
                <img src="assets/maximize.svg" alt="Maximize" draggable="false">
              </button>
              <button class="icon-btn action-close" type="button" title="Close">
                <img src="assets/close.svg" alt="Close" draggable="false">
              </button>
            </div>
          </div>
          <div class="window-body app-window-body">
            ${app.entry ? `<iframe class="app-iframe" src="${app.entry}" title="${app.name}"></iframe>` : `<p>${app.name} (${app.version}) is ready to launch.</p>`}
          </div>
        `;
        desktop.appendChild(win);
      });
    }

    const windowById = new Map();
    let highestZIndex = 10;
    let startupRestored = false;
    const pendingLaunches = new Set();
    let activeSnapTarget = null;

    function getDockSafeBounds() {
      const dock = document.querySelector('.dock-container');
      const dockRect = dock ? dock.getBoundingClientRect() : { left: 0, top: 0, width: 0, height: 0 };
      const desktopRect = desktop.getBoundingClientRect();
      const isLeft = dock && dock.classList.contains('dock-left');
      if (isLeft) {
        return {
          left: dockRect.width + 20,
          top: 12,
          right: desktopRect.width - 12,
          bottom: desktopRect.height - 12,
        };
      }
      return {
        left: 12,
        top: 12,
        right: desktopRect.width - 12,
        bottom: Math.max(12, desktopRect.height - dockRect.height - 18),
      };
    }

    function bindDesktopShortcutDragging() {
      document.querySelectorAll('.desktop-shortcut').forEach(shortcut => {
        if (shortcut.dataset.dragBound === 'true') return;
        shortcut.dataset.dragBound = 'true';

        let dragging = false;
        let startX = 0;
        let startY = 0;
        let initialLeft = 0;
        let initialTop = 0;

        shortcut.addEventListener('mousedown', event => {
          if (event.button !== 0) return;
          dragging = true;
          startX = event.clientX;
          startY = event.clientY;
          initialLeft = shortcut.offsetLeft;
          initialTop = shortcut.offsetTop;
          shortcut.classList.add('is-dragged');
          document.addEventListener('mousemove', moveShortcut);
          document.addEventListener('mouseup', stopShortcut);
          event.preventDefault();
        });

        function moveShortcut(event) {
          if (!dragging) return;
          const nextLeft = initialLeft + (event.clientX - startX);
          const nextTop = initialTop + (event.clientY - startY);
          const safeBounds = getDockSafeBounds();
          const maxLeft = Math.max(safeBounds.left, Math.min(nextLeft, safeBounds.right - shortcut.offsetWidth));
          const maxTop = Math.max(safeBounds.top, Math.min(nextTop, safeBounds.bottom - shortcut.offsetHeight));
          shortcut.style.left = `${Math.max(12, maxLeft)}px`;
          shortcut.style.top = `${Math.max(12, maxTop)}px`;
        }

        function stopShortcut() {
          if (!dragging) return;
          dragging = false;
          shortcut.classList.remove('is-dragged');
          document.removeEventListener('mousemove', moveShortcut);
          document.removeEventListener('mouseup', stopShortcut);
        }
      });
    }

    // Helper to get desktop workspace bounds
    function getDesktopBounds() {
      if (desktop && desktop.getBoundingClientRect) {
        const rect = desktop.getBoundingClientRect();
        return {
          left: 0,
          top: 0,
          width: rect.width || window.innerWidth,
          height: rect.height || (window.innerHeight - 70),
        };
      }
      return {
        left: 0,
        top: 0,
        width: window.innerWidth,
        height: window.innerHeight - 70,
      };
    }

    // Helper to get window element by ID, element, or app identifier
    function resolveWindow(target) {
      if (!target) return null;
      if (typeof target === 'string') {
        const direct = windowById.get(target) || document.getElementById(target);
        if (direct) return direct;

        const reg = window.FelisOSAppRegistry || appRegistry;
        if (reg && Array.isArray(reg.apps)) {
          const q = target.toLowerCase().trim();
          const cleanQ = q.replace(/\.run$/, '');
          const app = reg.apps.find(a =>
            a.id.toLowerCase() === q ||
            a.id.toLowerCase() === cleanQ ||
            a.windowId.toLowerCase() === q ||
            a.name.toLowerCase() === q ||
            a.name.toLowerCase() === `${cleanQ}.run` ||
            (a.displayName && a.displayName.toLowerCase() === q) ||
            (a.displayName && a.displayName.toLowerCase() === cleanQ)
          );
          if (app) {
            return windowById.get(app.windowId) || document.getElementById(app.windowId);
          }
        }
        return null;
      }
      if (target instanceof HTMLElement) {
        return target.closest('.ui-window') || target;
      }
      return null;
    }

    // Collect current window state for persistence
    function collectState() {
      const state = {};
      windowById.forEach((win, id) => {
        const geometry = {
          left: win.offsetLeft,
          top: win.offsetTop,
          width: win.offsetWidth > 0 ? win.offsetWidth : null,
          height: win.offsetHeight > 0 ? win.offsetHeight : null,
          zIndex: parseInt(win.style.zIndex || '10', 10),
          minimized: win.classList.contains('is-minimized'),
          closed: win.classList.contains('is-closed'),
          maximized: win.classList.contains('is-maximized'),
          snapState: win.dataset.snap || 'none',
          preMaxGeometry: win.__felisPreMaxGeometry || null,
        };
        state[id] = geometry;
      });
      return state;
    }

    // Persist window state to VFS
    function persistState() {
      if (!stateStore || !stateStore.writeState) return;
      stateStore.writeState('windows', collectState()).catch(error => {
        console.error('Unable to save FelisOS window state:', error);
      });
    }

    // Bring a window to the top and mark it active
    function focusWindow(target) {
      const win = resolveWindow(target);
      if (!win || win.classList.contains('is-closed')) return;

      highestZIndex += 1;
      win.style.zIndex = highestZIndex;

      // Update focus classes on all windows
      windowById.forEach(w => {
        if (w === win) {
          w.classList.add('is-focused');
        } else {
          w.classList.remove('is-focused');
        }
      });

      // Update active state on all dock items
      document.querySelectorAll('.dock-item').forEach(item => {
        const isTarget = item.getAttribute('data-target') === win.id;
        item.classList.toggle('is-active', isTarget && !win.classList.contains('is-minimized'));
      });

      persistState();
    }

    // Find and focus the topmost visible, non-minimized window
    function focusNextTopmostWindow(excludeWin) {
      let candidate = null;
      let maxZ = -1;

      windowById.forEach(w => {
        if (w === excludeWin) return;
        if (w.classList.contains('is-closed') || w.classList.contains('is-minimized')) return;
        const z = parseInt(w.style.zIndex || '0', 10);
        if (z > maxZ) {
          maxZ = z;
          candidate = w;
        }
      });

      if (candidate) {
        focusWindow(candidate);
      } else {
        document.querySelectorAll('.dock-item').forEach(item => item.classList.remove('is-active'));
      }
    }

    // Launch or open a window
    function launchWindow(target) {
      const win = resolveWindow(target);
      if (!win) {
        console.error(`Unable to launch window: "${target}" not found.`);
        return;
      }

      const dockItem = document.querySelector(`.dock-item[data-target="${win.id}"]`);

      win.classList.remove('is-closed', 'is-minimized');
      win.style.display = 'flex';
      win.style.opacity = '1';
      win.style.pointerEvents = 'auto';
      win.style.transform = 'none';

      // Restore geometry if width/height were reset
      if (win.offsetWidth === 0 || win.offsetHeight === 0) {
        if (win.__felisPreMaxGeometry) {
          win.style.width = `${win.__felisPreMaxGeometry.width}px`;
          win.style.height = `${win.__felisPreMaxGeometry.height}px`;
        }
      }

      if (dockItem) {
        dockItem.classList.add('has-window', 'is-active');
      }

      focusWindow(win);
      clampWindowToViewport(win);
      persistState();
    }

    function openDocument(target, documentData) {
      const win = resolveWindow(target);
      const frame = win && win.querySelector('iframe');
      if (!win || !frame || !frame.contentWindow) {
        throw new Error(`Unable to open a document in "${target}".`);
      }
      if (!documentData || typeof documentData !== 'object') {
        throw new TypeError('Document data must be an object.');
      }

      launchWindow(win);
      const sendDocument = () => {
        frame.contentWindow.postMessage({
          type: 'felisos:open-document',
          document: documentData,
        }, window.location.origin);
      };
      if (frame.contentDocument && frame.contentDocument.readyState === 'complete') {
        sendDocument();
      } else {
        frame.addEventListener('load', sendDocument, { once: true });
      }
      return true;
    }

    // Minimize a window
    function minimizeWindow(target) {
      const win = resolveWindow(target);
      if (!win || win.classList.contains('is-closed')) return;

      const dockItem = document.querySelector(`.dock-item[data-target="${win.id}"]`);

      win.classList.remove('is-focused');
      win.classList.add('is-minimized');
      win.style.opacity = '0';
      win.style.pointerEvents = 'none';
      win.style.transform = 'scale(0.2) translateY(500px)';

      if (dockItem) {
        dockItem.classList.remove('is-active');
        dockItem.classList.add('has-window');
      }

      focusNextTopmostWindow(win);
      persistState();
    }

    // Restore a minimized window
    function restoreMinimizedWindow(target) {
      const win = resolveWindow(target);
      if (!win) return;

      win.classList.remove('is-minimized', 'is-closed');
      win.style.display = 'flex';
      win.style.opacity = '1';
      win.style.pointerEvents = 'auto';
      win.style.transform = 'none';

      const dockItem = document.querySelector(`.dock-item[data-target="${win.id}"]`);
      if (dockItem) {
        dockItem.classList.add('has-window', 'is-active');
      }

      focusWindow(win);
      clampWindowToViewport(win);
      persistState();
    }

    // Maximize a window
    function maximizeWindow(target) {
      const win = resolveWindow(target);
      if (!win) return;

      const bounds = getDesktopBounds();

      // Save pre-maximize floating geometry if not already saved
      if (!win.classList.contains('is-maximized')) {
        win.__felisPreMaxGeometry = {
          left: win.offsetLeft,
          top: win.offsetTop,
          width: win.offsetWidth > 0 ? win.offsetWidth : 480,
          height: win.offsetHeight > 0 ? win.offsetHeight : 310,
        };
      }

      win.classList.remove('is-snapped');
      win.classList.add('is-maximized');
      win.dataset.maximized = 'true';
      win.dataset.snap = 'none';

      win.style.left = '0px';
      win.style.top = '0px';
      win.style.width = `${bounds.width}px`;
      win.style.height = `${bounds.height}px`;

      updateMaximizeButton(win, true);
      focusWindow(win);
      persistState();
    }

    // Unmaximize / restore window to floating dimensions
    function unmaximizeWindow(target) {
      const win = resolveWindow(target);
      if (!win) return;

      win.classList.remove('is-maximized', 'is-snapped');
      delete win.dataset.maximized;
      win.dataset.snap = 'none';

      const bounds = getDesktopBounds();
      const saved = win.__felisPreMaxGeometry || {
        left: 100,
        top: 80,
        width: Math.min(520, bounds.width - 32),
        height: Math.min(340, bounds.height - 32),
      };

      win.style.left = `${saved.left}px`;
      win.style.top = `${saved.top}px`;
      win.style.width = `${saved.width}px`;
      win.style.height = `${saved.height}px`;

      updateMaximizeButton(win, false);
      clampWindowToViewport(win);
      focusWindow(win);
      persistState();
    }

    // Toggle maximize state
    function toggleMaximize(target) {
      const win = resolveWindow(target);
      if (!win) return;
      if (win.classList.contains('is-maximized')) {
        unmaximizeWindow(win);
      } else {
        maximizeWindow(win);
      }
    }

    // Close a window
    function closeWindow(target) {
      const win = resolveWindow(target);
      if (!win) return;

      const dockItem = document.querySelector(`.dock-item[data-target="${win.id}"]`);

      win.classList.add('is-closed');
      win.classList.remove('is-focused', 'is-minimized', 'is-maximized', 'is-snapped');
      delete win.dataset.maximized;
      win.dataset.snap = 'none';

      win.style.removeProperty('display');
      win.style.removeProperty('opacity');
      win.style.removeProperty('pointer-events');
      win.style.removeProperty('transform');

      updateMaximizeButton(win, false);

      if (dockItem) {
        dockItem.classList.remove('has-window', 'is-active');
      }

      focusNextTopmostWindow(win);
      persistState();
    }

    // Update maximize button visual state (icon and tooltip)
    function updateMaximizeButton(win, isMaximized) {
      const btn = win.querySelector('.action-maximize');
      if (!btn) return;
      btn.title = isMaximized ? 'Restore' : 'Maximize';
      const img = btn.querySelector('img');
      if (img) {
        img.src = isMaximized ? 'assets/restore.svg' : 'assets/maximize.svg';
        img.alt = isMaximized ? 'Restore' : 'Maximize';
      }
    }

    // Snap window to a specified boundary tile
    function snapWindow(target, zone) {
      const win = resolveWindow(target);
      if (!win) return;

      const bounds = getDesktopBounds();

      // If already floating, remember geometry
      if (!win.classList.contains('is-maximized') && !win.classList.contains('is-snapped')) {
        win.__felisPreMaxGeometry = {
          left: win.offsetLeft,
          top: win.offsetTop,
          width: win.offsetWidth > 0 ? win.offsetWidth : 480,
          height: win.offsetHeight > 0 ? win.offsetHeight : 310,
        };
      }

      const halfW = Math.round(bounds.width / 2);
      const halfH = Math.round(bounds.height / 2);

      let targetL = 0;
      let targetT = 0;
      let targetW = bounds.width;
      let targetH = bounds.height;
      let isMax = false;

      switch (zone) {
        case 'top':
          isMax = true;
          targetL = 0;
          targetT = 0;
          targetW = bounds.width;
          targetH = bounds.height;
          break;
        case 'left':
          targetL = 0;
          targetT = 0;
          targetW = halfW;
          targetH = bounds.height;
          break;
        case 'right':
          targetL = halfW;
          targetT = 0;
          targetW = bounds.width - halfW;
          targetH = bounds.height;
          break;
        case 'top-left':
          targetL = 0;
          targetT = 0;
          targetW = halfW;
          targetH = halfH;
          break;
        case 'top-right':
          targetL = halfW;
          targetT = 0;
          targetW = bounds.width - halfW;
          targetH = halfH;
          break;
        case 'bottom-left':
          targetL = 0;
          targetT = halfH;
          targetW = halfW;
          targetH = bounds.height - halfH;
          break;
        case 'bottom-right':
          targetL = halfW;
          targetT = halfH;
          targetW = bounds.width - halfW;
          targetH = bounds.height - halfH;
          break;
        default:
          return;
      }

      if (isMax) {
        maximizeWindow(win);
        return;
      }

      win.classList.remove('is-maximized');
      win.classList.add('is-snapped');
      win.dataset.snap = zone;
      delete win.dataset.maximized;

      win.style.left = `${targetL}px`;
      win.style.top = `${targetT}px`;
      win.style.width = `${targetW}px`;
      win.style.height = `${targetH}px`;

      updateMaximizeButton(win, false);
      focusWindow(win);
      persistState();
    }

    // Clamp window position inside current desktop work area
    function clampWindowToViewport(win) {
      if (!win || win.classList.contains('is-closed') || win.classList.contains('is-maximized')) return;

      const bounds = getDesktopBounds();
      const winW = win.offsetWidth || 400;
      const winH = win.offsetHeight || 280;

      const maxLeft = Math.max(0, bounds.width - winW);
      const maxTop = Math.max(0, bounds.height - Math.min(winH, 50));

      const currentLeft = win.offsetLeft;
      const currentTop = win.offsetTop;

      const clampedLeft = Math.min(Math.max(0, currentLeft), maxLeft);
      const clampedTop = Math.min(Math.max(0, currentTop), maxTop);

      win.style.left = `${clampedLeft}px`;
      win.style.top = `${clampedTop}px`;
    }

    // Clamp all visible floating windows
    function clampAllWindows() {
      windowById.forEach(win => {
        if (win.classList.contains('is-maximized')) {
          const bounds = getDesktopBounds();
          win.style.width = `${bounds.width}px`;
          win.style.height = `${bounds.height}px`;
        } else if (win.classList.contains('is-snapped')) {
          snapWindow(win, win.dataset.snap);
        } else {
          clampWindowToViewport(win);
        }
      });
    }

    // Stagger/cascade all open windows
    function cascadeWindows() {
      const openWins = Array.from(windowById.values()).filter(
        w => !w.classList.contains('is-closed') && !w.classList.contains('is-minimized')
      );
      if (!openWins.length) return;

      const bounds = getDesktopBounds();
      const width = Math.min(540, bounds.width - 64);
      const height = Math.min(360, bounds.height - 64);

      openWins.forEach((win, index) => {
        win.classList.remove('is-maximized', 'is-snapped');
        delete win.dataset.maximized;
        win.dataset.snap = 'none';
        updateMaximizeButton(win, false);

        const left = 32 + (index * 36) % Math.max(10, bounds.width - width - 40);
        const top = 32 + (index * 36) % Math.max(10, bounds.height - height - 40);

        win.style.left = `${left}px`;
        win.style.top = `${top}px`;
        win.style.width = `${width}px`;
        win.style.height = `${height}px`;

        highestZIndex += 1;
        win.style.zIndex = highestZIndex;
      });

      const last = openWins[openWins.length - 1];
      if (last) focusWindow(last);
      persistState();
    }

    // Tile windows into clean layouts
    function tileWindows(layout = 'left-right') {
      const openWins = Array.from(windowById.values()).filter(
        w => !w.classList.contains('is-closed') && !w.classList.contains('is-minimized')
      );
      if (openWins.length < 2) return;

      if (layout === 'left-right') {
        snapWindow(openWins[0], 'left');
        snapWindow(openWins[1], 'right');
      } else if (layout === 'quarters') {
        const zones = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];
        openWins.slice(0, 4).forEach((win, i) => snapWindow(win, zones[i]));
      }
    }

    // Detect snap boundary based on pointer coordinates relative to desktop
    function calculateSnapZone(clientX, clientY) {
      const edgeThreshold = typeof window.__felisSnapThreshold === 'number'
        ? window.__felisSnapThreshold
        : 24;

      if (edgeThreshold <= 0) return null;

      const cornerThreshold = edgeThreshold * 3;
      const bounds = getDesktopBounds();
      const desktopRect = desktop.getBoundingClientRect();
      const relX = clientX - desktopRect.left;
      const relY = clientY - desktopRect.top;

      const halfW = Math.round(bounds.width / 2);
      const halfH = Math.round(bounds.height / 2);

      // Top edge -> Maximize
      if (relY <= edgeThreshold && relX > cornerThreshold && relX < bounds.width - cornerThreshold) {
        return {
          zone: 'top',
          rect: { left: 0, top: 0, width: bounds.width, height: bounds.height },
        };
      }

      // Top-Left corner
      if (relX <= cornerThreshold && relY <= cornerThreshold) {
        return {
          zone: 'top-left',
          rect: { left: 0, top: 0, width: halfW, height: halfH },
        };
      }

      // Top-Right corner
      if (relX >= bounds.width - cornerThreshold && relY <= cornerThreshold) {
        return {
          zone: 'top-right',
          rect: { left: halfW, top: 0, width: bounds.width - halfW, height: halfH },
        };
      }

      // Bottom-Left corner
      if (relX <= cornerThreshold && relY >= bounds.height - cornerThreshold) {
        return {
          zone: 'bottom-left',
          rect: { left: 0, top: halfH, width: halfW, height: bounds.height - halfH },
        };
      }

      // Bottom-Right corner
      if (relX >= bounds.width - cornerThreshold && relY >= bounds.height - cornerThreshold) {
        return {
          zone: 'bottom-right',
          rect: { left: halfW, top: halfH, width: bounds.width - halfW, height: bounds.height - halfH },
        };
      }

      // Left edge
      if (relX <= edgeThreshold) {
        return {
          zone: 'left',
          rect: { left: 0, top: 0, width: halfW, height: bounds.height },
        };
      }

      // Right edge
      if (relX >= bounds.width - edgeThreshold) {
        return {
          zone: 'right',
          rect: { left: halfW, top: 0, width: bounds.width - halfW, height: bounds.height },
        };
      }

      return null;
    }

    // Setup window controls, dragging, resizing handles
    function attachWindowInteractions(win) {
      const titlebar = win.querySelector('.window-titlebar');
      const appId = win.id;
      const dockItem = document.querySelector(`.dock-item[data-target="${appId}"]`);
      const app = appRegistry ? appRegistry.getAppForWindow(appId) : null;

      if (app) {
        win.dataset.appId = app.id;
        win.setAttribute('aria-label', app.name);
        if (dockItem) {
          dockItem.dataset.appId = app.id;
          dockItem.setAttribute('aria-label', `Toggle ${app.name}`);
          dockItem.title = `Toggle ${app.name}`;
        }
      }

      // Ensure maximize button exists
      let controls = win.querySelector('.window-controls');
      if (controls && !controls.querySelector('.action-maximize')) {
        const closeBtn = controls.querySelector('.action-close');
        const maxBtn = document.createElement('button');
        maxBtn.className = 'icon-btn action-maximize';
        maxBtn.type = 'button';
        maxBtn.title = 'Maximize';
        maxBtn.innerHTML = '<img src="assets/maximize.svg" alt="Maximize" draggable="false">';
        if (closeBtn) {
          controls.insertBefore(maxBtn, closeBtn);
        } else {
          controls.appendChild(maxBtn);
        }
      }

      // Inject multi-directional resize handles if not present
      if (!win.querySelector('.win-resize-handle')) {
        const directions = ['n', 's', 'w', 'e', 'nw', 'ne', 'sw', 'se'];
        directions.forEach(dir => {
          const handle = document.createElement('div');
          handle.className = `win-resize-handle win-resize-${dir}`;
          handle.dataset.direction = dir;
          win.appendChild(handle);
        });
      }

      // Backward-compatible hook methods
      win.__felisLaunchWindow = () => launchWindow(win);
      win.__felisFocusWindow = () => focusWindow(win);

      // Focus on click anywhere inside window
      win.addEventListener('mousedown', () => focusWindow(win));
      win.addEventListener('touchstart', () => focusWindow(win), { passive: true });

      // Titlebar double-click to toggle maximize or minimize based on settings
      if (titlebar) {
        titlebar.addEventListener('dblclick', event => {
          if (event.target.closest('.icon-btn')) return;
          const action = window.__felisTitlebarAction || 'maximize';
          if (action === 'minimize') {
            minimizeWindow(win);
          } else {
            toggleMaximize(win);
          }
        });
      }

      // Titlebar Dragging with Pointer Events & Snapping
      if (titlebar) {
        let isDragging = false;
        let startX = 0;
        let startY = 0;
        let initLeft = 0;
        let initTop = 0;

        titlebar.addEventListener('pointerdown', event => {
          if (event.target.closest('.icon-btn')) return;
          if (event.button !== 0 && event.pointerType === 'mouse') return;

          focusWindow(win);

          // If dragging while maximized or snapped, prepare to un-maximize under cursor
          let wasMaximized = win.classList.contains('is-maximized');
          let wasSnapped = win.classList.contains('is-snapped');

          if (wasMaximized || wasSnapped) {
            const bounds = getDesktopBounds();
            const savedW = (win.__felisPreMaxGeometry && win.__felisPreMaxGeometry.width) || 520;
            const savedH = (win.__felisPreMaxGeometry && win.__felisPreMaxGeometry.height) || 340;

            const clickFractionX = (event.clientX - win.offsetLeft) / Math.max(1, win.offsetWidth);

            win.classList.remove('is-maximized', 'is-snapped');
            delete win.dataset.maximized;
            win.dataset.snap = 'none';
            updateMaximizeButton(win, false);

            win.style.width = `${savedW}px`;
            win.style.height = `${savedH}px`;

            initLeft = Math.max(0, Math.min(bounds.width - savedW, event.clientX - (savedW * clickFractionX)));
            initTop = Math.max(0, event.clientY - 16);

            win.style.left = `${initLeft}px`;
            win.style.top = `${initTop}px`;
          } else {
            initLeft = win.offsetLeft;
            initTop = win.offsetTop;
          }

          isDragging = true;
          startX = event.clientX;
          startY = event.clientY;

          win.classList.add('is-dragged');
          document.body.classList.add('is-window-dragging');
          titlebar.setPointerCapture(event.pointerId);
          event.preventDefault();
        });

        titlebar.addEventListener('pointermove', event => {
          if (!isDragging) return;

          const deltaX = event.clientX - startX;
          const deltaY = event.clientY - startY;

          const bounds = getDesktopBounds();
          const winW = win.offsetWidth;
          const winH = win.offsetHeight;

          let newLeft = initLeft + deltaX;
          let newTop = initTop + deltaY;

          // Prevent window from flying completely out of view
          const maxLeft = bounds.width - 40;
          const maxTop = bounds.height - 40;
          if (newLeft < -winW + 40) newLeft = -winW + 40;
          if (newLeft > maxLeft) newLeft = maxLeft;
          if (newTop < 0) newTop = 0;
          if (newTop > maxTop) newTop = maxTop;

          win.style.left = `${newLeft}px`;
          win.style.top = `${newTop}px`;

          // Check snapping boundaries
          const snapCandidate = calculateSnapZone(event.clientX, event.clientY);
          activeSnapTarget = snapCandidate ? snapCandidate.zone : null;

          const showGhost = window.__felisSnapGhost !== false;
          if (snapCandidate && snapGhost && showGhost) {
            snapGhost.style.left = `${snapCandidate.rect.left}px`;
            snapGhost.style.top = `${snapCandidate.rect.top}px`;
            snapGhost.style.width = `${snapCandidate.rect.width}px`;
            snapGhost.style.height = `${snapCandidate.rect.height}px`;
            snapGhost.classList.add('is-active');
          } else if (snapGhost) {
            snapGhost.classList.remove('is-active');
          }
        });

        const stopDrag = event => {
          if (!isDragging) return;
          isDragging = false;
          win.classList.remove('is-dragged');
          document.body.classList.remove('is-window-dragging');

          try {
            titlebar.releasePointerCapture(event.pointerId);
          } catch (_) {}

          if (snapGhost) {
            snapGhost.classList.remove('is-active');
          }

          if (activeSnapTarget) {
            snapWindow(win, activeSnapTarget);
            activeSnapTarget = null;
          } else {
            clampWindowToViewport(win);
            persistState();
          }
        };

        titlebar.addEventListener('pointerup', stopDrag);
        titlebar.addEventListener('pointercancel', stopDrag);
      }

      // Multi-Directional Resize with Pointer Events
      win.querySelectorAll('.win-resize-handle, .window-resizer').forEach(handle => {
        let isResizing = false;
        let startX = 0;
        let startY = 0;
        let initLeft = 0;
        let initTop = 0;
        let initWidth = 0;
        let initHeight = 0;
        const dir = handle.dataset.direction || 'se';

        handle.addEventListener('pointerdown', event => {
          if (event.button !== 0 && event.pointerType === 'mouse') return;
          if (win.classList.contains('is-maximized')) return;

          focusWindow(win);

          isResizing = true;
          startX = event.clientX;
          startY = event.clientY;
          initLeft = win.offsetLeft;
          initTop = win.offsetTop;
          initWidth = win.offsetWidth;
          initHeight = win.offsetHeight;

          // If snapped, un-snap on resize
          if (win.classList.contains('is-snapped')) {
            win.classList.remove('is-snapped');
            win.dataset.snap = 'none';
          }

          win.classList.add('is-resizing');
          document.body.classList.add('is-window-resizing');
          handle.setPointerCapture(event.pointerId);
          event.stopPropagation();
          event.preventDefault();
        });

        handle.addEventListener('pointermove', event => {
          if (!isResizing) return;

          const deltaX = event.clientX - startX;
          const deltaY = event.clientY - startY;
          const bounds = getDesktopBounds();

          const minW = 260;
          const minH = 160;

          // East
          if (dir.includes('e')) {
            const maxW = bounds.width - initLeft;
            const newW = Math.max(minW, Math.min(maxW, initWidth + deltaX));
            win.style.width = `${newW}px`;
          }

          // South
          if (dir.includes('s')) {
            const maxH = bounds.height - initTop;
            const newH = Math.max(minH, Math.min(maxH, initHeight + deltaY));
            win.style.height = `${newH}px`;
          }

          // West
          if (dir.includes('w')) {
            const maxDelta = initWidth - minW;
            const clampedDelta = Math.min(maxDelta, Math.max(-initLeft, deltaX));
            win.style.left = `${initLeft + clampedDelta}px`;
            win.style.width = `${initWidth - clampedDelta}px`;
          }

          // North
          if (dir.includes('n')) {
            const maxDelta = initHeight - minH;
            const clampedDelta = Math.min(maxDelta, Math.max(-initTop, deltaY));
            win.style.top = `${initTop + clampedDelta}px`;
            win.style.height = `${initHeight - clampedDelta}px`;
          }
        });

        const stopResize = event => {
          if (!isResizing) return;
          isResizing = false;
          win.classList.remove('is-resizing');
          document.body.classList.remove('is-window-resizing');

          try {
            handle.releasePointerCapture(event.pointerId);
          } catch (_) {}

          clampWindowToViewport(win);
          persistState();
        };

        handle.addEventListener('pointerup', stopResize);
        handle.addEventListener('pointercancel', stopResize);
      });
    }

    // Delegate clicks on window control buttons (minimize, maximize, close)
    document.addEventListener('click', event => {
      const control = event.target.closest(
        '.window-controls .action-close, .window-controls .action-minimize, .window-controls .action-maximize, ' +
        '.window-controls .window-close, .window-controls .window-minimize, .window-controls .window-maximize'
      );
      if (!control) return;

      event.preventDefault();
      event.stopPropagation();

      const win = control.closest('.ui-window');
      if (!win) return;

      if (control.matches('.action-close, .window-close')) {
        closeWindow(win);
      } else if (control.matches('.action-maximize, .window-maximize')) {
        toggleMaximize(win);
      } else if (control.matches('.action-minimize, .window-minimize')) {
        minimizeWindow(win);
      }
    });

    // Delegate clicks on dock items
    document.querySelectorAll('.dock-item').forEach(dockItem => {
      const targetId = dockItem.getAttribute('data-target');
      dockItem.dataset.resolvedWindowId = targetId;

      dockItem.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();

        const win = resolveWindow(targetId);
        if (!win) {
          console.error(`Dock target "${targetId}" not found.`);
          return;
        }

        if (!startupRestored) {
          pendingLaunches.add(targetId);
          return;
        }

        // Toggle behavior:
        // 1. If closed: launch it
        // 2. If minimized: restore it
        // 3. If open and currently focused: minimize it
        // 4. If open but not focused: bring to focus
        if (win.classList.contains('is-closed')) {
          launchWindow(win);
        } else if (win.classList.contains('is-minimized')) {
          restoreMinimizedWindow(win);
        } else if (win.classList.contains('is-focused')) {
          minimizeWindow(win);
        } else {
          focusWindow(win);
        }
      });

      dockItem.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          dockItem.click();
        }
      });
    });

    // Delegated clicks and activation on desktop shortcuts
    document.addEventListener('dblclick', event => {
      const shortcut = event.target.closest('.desktop-shortcut');
      if (!shortcut) return;
      const targetId = shortcut.getAttribute('data-target');
      if (!targetId) return;
      const win = resolveWindow(targetId);
      if (!win) return;
      if (win.classList.contains('is-closed')) {
        launchWindow(win);
      } else if (win.classList.contains('is-minimized')) {
        restoreMinimizedWindow(win);
      } else {
        focusWindow(win);
      }
    });

    document.addEventListener('click', event => {
      if (event.pointerType !== 'touch' && event.detail !== 2) return;
      const shortcut = event.target.closest('.desktop-shortcut');
      if (!shortcut) return;
      const targetId = shortcut.getAttribute('data-target');
      if (!targetId) return;
      const win = resolveWindow(targetId);
      if (!win) return;
      if (win.classList.contains('is-closed')) {
        launchWindow(win);
      } else if (win.classList.contains('is-minimized')) {
        restoreMinimizedWindow(win);
      } else {
        focusWindow(win);
      }
    });

    document.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const shortcut = event.target.closest('.desktop-shortcut');
      if (!shortcut) return;
      event.preventDefault();
      const targetId = shortcut.getAttribute('data-target');
      if (!targetId) return;
      const win = resolveWindow(targetId);
      if (!win) return;
      if (win.classList.contains('is-closed')) {
        launchWindow(win);
      } else if (win.classList.contains('is-minimized')) {
        restoreMinimizedWindow(win);
      } else {
        focusWindow(win);
      }
    });

    const shortcutPositionKey = 'desktop.shortcut.positions';
    const shortcuts = Array.from(document.querySelectorAll('.desktop-shortcut'));

    function clampShortcut(shortcut, left, top) {
      const dock = document.querySelector('.dock-container');
      const desktopBounds = desktop.getBoundingClientRect();
      const dockBounds = dock && dock.classList.contains('dock-left')
        ? dock.getBoundingClientRect()
        : null;
      const minLeft = dockBounds ? Math.max(4, dockBounds.right - desktopBounds.left + 8) : 4;
      const maxLeft = Math.max(minLeft, desktop.clientWidth - shortcut.offsetWidth - 4);
      const maxTop = Math.max(4, desktop.clientHeight - shortcut.offsetHeight - 4);
      return {
        left: Math.min(maxLeft, Math.max(minLeft, left)),
        top: Math.min(maxTop, Math.max(4, top)),
      };
    }

    function collectShortcutPositions() {
      const positions = {};
      shortcuts.forEach(shortcut => {
        positions[shortcut.dataset.target] = {
          left: shortcut.offsetLeft,
          top: shortcut.offsetTop,
        };
      });
      return positions;
    }

    function persistShortcutPositions() {
      if (!stateStore || !stateStore.writeState) return;
      stateStore.writeState(shortcutPositionKey, collectShortcutPositions()).catch(error => {
        console.error('Unable to save desktop shortcut positions:', error);
      });
    }

    async function restoreShortcutPositions() {
      const saved = stateStore && stateStore.readState
        ? await stateStore.readState(shortcutPositionKey, {})
        : {};
      let changed = false;
      shortcuts.forEach(shortcut => {
        const savedPosition = saved && saved[shortcut.dataset.target];
        const position = savedPosition
          && Number.isFinite(savedPosition.left)
          && Number.isFinite(savedPosition.top)
          ? savedPosition
          : { left: shortcut.offsetLeft, top: shortcut.offsetTop };
        const bounded = clampShortcut(shortcut, position.left, position.top);
        if (bounded.left !== shortcut.offsetLeft || bounded.top !== shortcut.offsetTop) changed = true;
        shortcut.style.left = `${bounded.left}px`;
        shortcut.style.top = `${bounded.top}px`;
      });
      if (changed) persistShortcutPositions();
    }

    function clampAllShortcuts() {
      let changed = false;
      shortcuts.forEach(shortcut => {
        const bounded = clampShortcut(shortcut, shortcut.offsetLeft, shortcut.offsetTop);
        if (bounded.left !== shortcut.offsetLeft || bounded.top !== shortcut.offsetTop) {
          shortcut.style.left = `${bounded.left}px`;
          shortcut.style.top = `${bounded.top}px`;
          changed = true;
        }
      });
      if (changed) persistShortcutPositions();
    }

    shortcuts.forEach(shortcut => {
      let drag = null;

      shortcut.addEventListener('pointerdown', event => {
        if (event.button !== 0 || event.isPrimary === false) return;
        drag = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          left: shortcut.offsetLeft,
          top: shortcut.offsetTop,
          moved: false,
        };
        shortcut.classList.add('is-dragged');
        event.preventDefault();
      });

      document.addEventListener('pointermove', event => {
        if (!drag || event.pointerId !== drag.pointerId) return;
        const deltaX = event.clientX - drag.startX;
        const deltaY = event.clientY - drag.startY;
        if (Math.hypot(deltaX, deltaY) < 3) return;
        drag.moved = true;
        const bounded = clampShortcut(shortcut, drag.left + deltaX, drag.top + deltaY);
        shortcut.style.left = `${bounded.left}px`;
        shortcut.style.top = `${bounded.top}px`;
      });

      document.addEventListener('pointerup', event => {
        if (!drag || event.pointerId !== drag.pointerId) return;
        const moved = drag.moved;
        drag = null;
        shortcut.classList.remove('is-dragged');
        if (moved) {
          shortcut.dataset.dragged = 'true';
          window.setTimeout(() => {
            delete shortcut.dataset.dragged;
          }, 0);
          persistShortcutPositions();
        }
      });

      document.addEventListener('pointercancel', event => {
        if (!drag || event.pointerId !== drag.pointerId) return;
        drag = null;
        shortcut.classList.remove('is-dragged');
      });

      shortcut.addEventListener('click', event => {
        if (shortcut.dataset.dragged !== 'true') return;
        delete shortcut.dataset.dragged;
        event.preventDefault();
        event.stopImmediatePropagation();
      }, true);
    });

    // Restore desktop window state from storage
    async function restoreState() {
      let saved = {};
      try {
        if (stateStore && stateStore.readState) {
          saved = (await stateStore.readState('windows', {})) || {};
        }
      } catch (err) {
        console.warn('Failed to read window state, using defaults:', err);
      }

      const bounds = getDesktopBounds();

      windowById.forEach((win, id) => {
        const state = saved && saved[id];

        if (state) {
          if (Number.isFinite(state.left)) win.style.left = `${state.left}px`;
          if (Number.isFinite(state.top)) win.style.top = `${state.top}px`;
          if (Number.isFinite(state.width) && state.width > 0) win.style.width = `${state.width}px`;
          if (Number.isFinite(state.height) && state.height > 0) win.style.height = `${state.height}px`;

          if (state.preMaxGeometry) {
            win.__felisPreMaxGeometry = state.preMaxGeometry;
          }

          if (Number.isFinite(state.zIndex)) {
            win.style.zIndex = state.zIndex;
            highestZIndex = Math.max(highestZIndex, state.zIndex);
          }

          if (state.closed) {
            win.classList.add('is-closed');
            win.classList.remove('is-minimized', 'is-focused');
          } else if (state.minimized) {
            win.classList.remove('is-closed');
            win.classList.add('is-minimized');
            win.style.opacity = '0';
            win.style.pointerEvents = 'none';
            win.style.transform = 'scale(0.2) translateY(500px)';
          } else {
            win.classList.remove('is-closed', 'is-minimized');
            win.style.display = 'flex';
            win.style.opacity = '1';
            win.style.pointerEvents = 'auto';
            win.style.transform = 'none';

            if (state.maximized) {
              win.classList.add('is-maximized');
              win.dataset.maximized = 'true';
              win.style.left = '0px';
              win.style.top = '0px';
              win.style.width = `${bounds.width}px`;
              win.style.height = `${bounds.height}px`;
              updateMaximizeButton(win, true);
            } else if (state.snapState && state.snapState !== 'none') {
              snapWindow(win, state.snapState);
            } else {
              clampWindowToViewport(win);
            }
          }
        } else {
          // Default initial state: win-1 and win-2 open, others closed
          if (id === 'win-1' || id === 'win-2') {
            win.classList.remove('is-closed', 'is-minimized');
            win.style.display = 'flex';
            clampWindowToViewport(win);
          } else {
            win.classList.add('is-closed');
          }
        }

        const dockItem = document.querySelector(`.dock-item[data-target="${id}"]`);
        if (dockItem) {
          const isOpen = !win.classList.contains('is-closed');
          const isMin = win.classList.contains('is-minimized');
          dockItem.classList.toggle('has-window', isOpen);
          dockItem.classList.toggle('is-active', isOpen && !isMin);
        }
      });

      // Focus the topmost open window
      focusNextTopmostWindow();
    }

    // Register all initial windows
    document.querySelectorAll('.ui-window').forEach(win => {
      windowById.set(win.id, win);
      attachWindowInteractions(win);
    });

    // Handle viewport resize
    window.addEventListener('resize', clampAllWindows);
    window.addEventListener('resize', clampAllShortcuts);
    window.addEventListener('felis:settings-changed', clampAllShortcuts);

    // Initial state restore sequence
    restoreShortcutPositions().then(restoreState).then(() => {
      startupRestored = true;
      pendingLaunches.forEach(targetId => {
        launchWindow(targetId);
      });
      pendingLaunches.clear();
      persistState();
    }).catch(err => {
      console.error('Window manager startup error:', err);
      startupRestored = true;
    });

    // Public Window Manager API
    wmImpl = {
      launch: launchWindow,
      focus: focusWindow,
      minimize: minimizeWindow,
      restore: restoreMinimizedWindow,
      maximize: maximizeWindow,
      unmaximize: unmaximizeWindow,
      toggleMaximize,
      close: closeWindow,
      snap: snapWindow,
      tile: tileWindows,
      cascade: cascadeWindows,
      getWindows: () => Array.from(windowById.values()),
      getWindowById: id => windowById.get(id),
      getFocusedWindow: () => Array.from(windowById.values()).find(w => w.classList.contains('is-focused')),
      resolveWindow,
      openDocument,
      collectState,
      persistState,
      restoreState,
    };
    Object.assign(window.FelisOSWindowManager, wmImpl);
  });
}());
