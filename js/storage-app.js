(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', () => {
    const storageWindow = document.getElementById('storage-window');
    if (!storageWindow || !window.FelisOSVFS) return;

    const currentPath = storageWindow.querySelector('[data-storage-path]');
    const listing = storageWindow.querySelector('[data-storage-list]');
    const status = storageWindow.querySelector('[data-storage-status]');
    const shortcut = document.querySelector('.desktop-shortcut[data-target="storage-window"]');
    const desktop = document.getElementById('desktop-container');
    const contextMenu = document.querySelector('[data-context-menu]');
    const renameDialog = document.getElementById('rename-dialog');
    const renameForm = renameDialog.querySelector('[data-rename-form]');
    const renameInput = renameDialog.querySelector('#rename-input');
    const renameStatus = renameDialog.querySelector('[data-rename-status]');
    let path = window.FelisOSVFS.ROOT;
    let contextTarget = null;
    const shortcutStateKey = 'desktop.shortcut.storage';

    function announce(message) {
      status.textContent = message;
    }

    function shortcutKey(target) {
      return target === 'storage-window' ? shortcutStateKey : `desktop.shortcut.${target}`;
    }

    function persistShortcut(targetShortcut, deleted = false) {
      if (!targetShortcut) return;
      window.FelisOSVFS.writeState(shortcutKey(targetShortcut.dataset.target), {
        deleted,
        name: targetShortcut.querySelector('.desktop-shortcut-label').textContent,
        left: targetShortcut.offsetLeft,
        top: targetShortcut.offsetTop,
      }).catch(error => announce(`Unable to save shortcut state: ${error.message}`));
    }

    function clampShortcut(targetShortcut) {
      const maxLeft = Math.max(0, desktop.clientWidth - targetShortcut.offsetWidth - 4);
      const maxTop = Math.max(0, desktop.clientHeight - targetShortcut.offsetHeight - 4);
      const dock = document.querySelector('.dock-container.dock-left');
      const desktopLeft = desktop.getBoundingClientRect().left;
      const minLeft = dock
        ? Math.min(maxLeft, dock.getBoundingClientRect().right - desktopLeft + 8)
        : 0;
      const left = Math.min(maxLeft, Math.max(minLeft, targetShortcut.offsetLeft));
      const top = Math.min(maxTop, Math.max(0, targetShortcut.offsetTop));
      targetShortcut.style.left = `${left}px`;
      targetShortcut.style.top = `${top}px`;
    }

    function overlapsOccupiedArea(targetShortcut, left, top) {
      const rect = {
        left: desktop.getBoundingClientRect().left + left,
        top: desktop.getBoundingClientRect().top + top,
        right: desktop.getBoundingClientRect().left + left + targetShortcut.offsetWidth,
        bottom: desktop.getBoundingClientRect().top + top + targetShortcut.offsetHeight,
      };
      const overlaps = other => {
        const otherRect = other.getBoundingClientRect();
        return rect.left < otherRect.right
          && rect.right > otherRect.left
          && rect.top < otherRect.bottom
          && rect.bottom > otherRect.top;
      };

      return Array.from(document.querySelectorAll('.desktop-shortcut'))
        .some(other => other !== targetShortcut && overlaps(other));
    }

    function moveShortcutToFreeSpace(targetShortcut) {
      clampShortcut(targetShortcut);
      const preferredLeft = targetShortcut.offsetLeft;
      const preferredTop = targetShortcut.offsetTop;
      if (!overlapsOccupiedArea(targetShortcut, targetShortcut.offsetLeft, targetShortcut.offsetTop)) {
        return;
      }

      const maxLeft = Math.max(0, desktop.clientWidth - targetShortcut.offsetWidth - 4);
      const maxTop = Math.max(0, desktop.clientHeight - targetShortcut.offsetHeight - 4);
      const dock = document.querySelector('.dock-container.dock-left');
      const desktopLeft = desktop.getBoundingClientRect().left;
      const minLeft = dock
        ? Math.min(maxLeft, dock.getBoundingClientRect().right - desktopLeft + 8)
        : 0;
      const step = Math.max(targetShortcut.offsetWidth, targetShortcut.offsetHeight) + 8;
      const positions = [{ left: preferredLeft, top: preferredTop }];
      for (let top = 0; top <= maxTop; top += step) {
        for (let left = 0; left <= maxLeft; left += step) {
          positions.push({ left: Math.min(maxLeft, Math.max(minLeft, left)), top });
        }
        positions.push({ left: maxLeft, top });
      }
      positions.push({ left: minLeft, top: maxTop }, { left: maxLeft, top: maxTop });
      positions.sort((a, b) =>
        Math.abs(a.left - preferredLeft) + Math.abs(a.top - preferredTop)
        - Math.abs(b.left - preferredLeft) - Math.abs(b.top - preferredTop)
      );

      const freePosition = positions.find(position =>
        !overlapsOccupiedArea(targetShortcut, position.left, position.top)
      );
      if (freePosition) {
        targetShortcut.style.left = `${freePosition.left}px`;
        targetShortcut.style.top = `${freePosition.top}px`;
      }
    }

    function normalizeShortcutPositions() {
      document.querySelectorAll('.desktop-shortcut').forEach(targetShortcut => {
        const previousLeft = targetShortcut.offsetLeft;
        const previousTop = targetShortcut.offsetTop;
        moveShortcutToFreeSpace(targetShortcut);
        if (previousLeft !== targetShortcut.offsetLeft || previousTop !== targetShortcut.offsetTop) {
          persistShortcut(targetShortcut);
        }
      });
    }

    function closeContextMenu(clearTarget = true) {
      contextMenu.classList.add('is-hidden');
      if (clearTarget) contextTarget = null;
    }

    function showContextMenu(event, target) {
      contextTarget = target;
      
      const existingScribeBtn = contextMenu.querySelector('[data-context-action="open-scribe"]');
      if (existingScribeBtn) existingScribeBtn.remove();

      if (target.kind !== 'directory' && target.kind !== 'shortcut' && target.entry) {
        const extension = target.entry.name.slice((target.entry.name.lastIndexOf(".") - 1 >>> 0) + 2).toLowerCase();
        const scribeSupported = ['txt', 'md', 'css', 'js', 'html'];
        
        if (scribeSupported.includes(extension)) {
            const openInScribeBtn = document.createElement('button');
            openInScribeBtn.className = 'context-menu-item';
            openInScribeBtn.dataset.contextAction = 'open-scribe';
            openInScribeBtn.type = 'button';
            openInScribeBtn.style.display = 'flex';
            openInScribeBtn.style.alignItems = 'center';
            openInScribeBtn.style.gap = '8px';
            openInScribeBtn.style.width = '100%';
            
            openInScribeBtn.innerHTML = `
                <span>Open in Scribe</span>
                <!-- 
                 * ICON PLACEHOLDER
                 * TODO: Replace with SVG icon from "assets/icons/scribe-icon.svg" later
                -->
            `;
            contextMenu.appendChild(openInScribeBtn);
        }
      }

      contextMenu.classList.remove('is-hidden');
      const left = Math.min(event.clientX, window.innerWidth - contextMenu.offsetWidth - 8);
      const top = Math.min(event.clientY, window.innerHeight - contextMenu.offsetHeight - 8);
      contextMenu.style.left = `${Math.max(8, left)}px`;
      contextMenu.style.top = `${Math.max(8, top)}px`;
    }

    function openRenameDialog(target) {
      contextTarget = target;
      renameInput.value = target.kind === 'shortcut'
        ? target.shortcut.querySelector('.desktop-shortcut-label').textContent
        : target.entry.name;
      renameStatus.textContent = '';
      if (typeof renameDialog.showModal === 'function') renameDialog.showModal();
      renameInput.focus();
      renameInput.select();
    }

    async function render() {
      currentPath.textContent = path;
      listing.replaceChildren();
      const entries = await window.FelisOSVFS.list(path);
      entries.forEach(entry => {
        const item = document.createElement('button');
        item.className = 'storage-entry';
        item.type = 'button';
        item.dataset.path = entry.path;
        item.dataset.type = entry.type;
        const icon = document.createElement('span');
        icon.className = 'storage-entry-icon';
        icon.setAttribute('aria-hidden', 'true');
        if (entry.type === 'directory') {
          const folderIcon = document.createElement('img');
          folderIcon.src = 'assets/icons/folder.svg';
          folderIcon.alt = '';
          folderIcon.style.width = '3em';
          folderIcon.style.height = '3em';
          icon.appendChild(folderIcon);
        } else {
          icon.textContent = '📄';
          const extension = entry.name.split('.').pop().toLowerCase();
          const fileIconByExtension = {
            md: 'assets/icons/code.svg',
            txt: 'assets/icons/question.svg',
          };
          const fileIconPath = fileIconByExtension[extension];
          if (fileIconPath) {
            const fileIcon = document.createElement('img');
            fileIcon.src = fileIconPath;
            fileIcon.alt = '';
            fileIcon.style.width = '3em';
            fileIcon.style.height = '3em';
            icon.replaceChildren(fileIcon);
          }
        }
        const label = document.createElement('span');
        label.textContent = entry.name;
        item.append(icon, label);
        item.addEventListener('dblclick', () => {
          if (entry.type === 'directory') {
            path = entry.path;
            render().catch(error => announce(error.message));
            return;
          }
          const manager = window.FelisOSWindowManager;
          if (!manager) {
            announce('The application launcher is unavailable.');
            return;
          }

          const extension = entry.name.slice((entry.name.lastIndexOf(".") - 1 >>> 0) + 2).toLowerCase();
          const defaultToScribe = ['txt', 'md', 'css', 'js']; 

          if (defaultToScribe.includes(extension) && typeof manager.openApp === 'function') {
              try {
                  manager.openApp('scribe', { filepath: entry.path });
              } catch (error) {
                  announce(error.message);
              }
          } else {
              if (typeof manager.openFile !== 'function') {
                announce('The application launcher is unavailable.');
                return;
              }
              manager.openFile(entry.path).catch(error => announce(error.message));
          }
        });
        item.addEventListener('contextmenu', event => {
          showContextMenu(event, { kind: entry.type, entry });
        });
        listing.appendChild(item);
      });
    }

    storageWindow.querySelector('[data-storage-up]').addEventListener('click', () => {
      if (path === window.FelisOSVFS.ROOT) return;
      path = window.FelisOSVFS.normalizePath(path + '/..');
      render().catch(error => announce(error.message));
    });
    storageWindow.querySelector('[data-storage-new]').addEventListener('click', () => {
      const name = window.prompt('New folder name', 'New Folder');
      if (!name) return;
      window.FelisOSVFS.createDirectory(`${path}/${name}`)
        .then(render)
        .catch(error => announce(error.message));
    });
    storageWindow.querySelector('[data-storage-delete]').addEventListener('click', async () => {
      const selected = listing.querySelector('.is-selected');
      if (!selected) return announce('Select a file or an empty folder first.');
      try {
        await window.FelisOSVFS.remove(selected.dataset.path);
        render();
      } catch (error) {
        announce(error.message);
      }
    });
    listing.addEventListener('click', event => {
      const item = event.target.closest('.storage-entry');
      if (!item) return;
      listing.querySelectorAll('.storage-entry').forEach(entry => entry.classList.remove('is-selected'));
      item.classList.add('is-selected');
    });

    async function applyRename() {
      if (!contextTarget) return;
      const name = renameInput.value.trim();
      if (!name) {
          renameStatus.textContent = 'Enter a name.';
          return;
      }
      const target = contextTarget;
      try {
          if (target.kind !== 'shortcut') {
            await window.FelisOSVFS.rename(target.entry.path, name);
          } else {
            target.shortcut.querySelector('.desktop-shortcut-label').textContent = name;
            persistShortcut(target.shortcut);
          }
          renameDialog.close();
          closeContextMenu();
          if (target.kind !== 'shortcut') return render();
      } catch (error) {
          renameStatus.textContent = error.message;
      }
    }

    renameForm.addEventListener('submit', event => {
      event.preventDefault();
      applyRename();
    });

    renameForm.querySelector('[value="cancel"]').addEventListener('click', () => {
      renameDialog.close('cancel');
      closeContextMenu();
    });
    renameForm.querySelector('[value="rename"]').addEventListener('click', event => {
      event.preventDefault();
      applyRename();
    });

    contextMenu.addEventListener('click', event => {
      event.stopPropagation();
      const action = event.target.closest('[data-context-action]');
      if (!action || !contextTarget) return;

      if (action.dataset.contextAction === 'open-scribe') {
        const manager = window.FelisOSWindowManager;
        if (manager && typeof manager.openApp === 'function') {
          try {
            manager.openApp('scribe', { filepath: contextTarget.entry.path });
          } catch (error) {
            announce(error.message);
          }
        }
        closeContextMenu();
        return;
      }

      if (action.dataset.contextAction === 'rename') {
        const target = contextTarget;
        closeContextMenu();
        openRenameDialog(target);
        return;
      }
      if (action.dataset.contextAction === 'delete') {
        if (contextTarget.kind !== 'shortcut') {
          window.FelisOSVFS.remove(contextTarget.entry.path)
            .then(render)
            .then(closeContextMenu)
            .catch(error => {
              announce(error.message);
              closeContextMenu();
            });
        } else {
          persistShortcut(contextTarget.shortcut, true);
          contextTarget.shortcut.remove();
          closeContextMenu();
        }
      }
    });

    document.addEventListener('click', event => {
      if (!event.target.closest('[data-context-menu]')) closeContextMenu();
    });
    document.addEventListener('contextmenu', event => {
      if (!event.target.closest('.storage-entry, .desktop-shortcut')) closeContextMenu();
    });

    if (shortcut) {
      shortcut.addEventListener('click', () => {
        const dockItem = document.querySelector('.dock-item[data-target="storage-window"]');
        if (dockItem) dockItem.click();
      });
    }

    document.querySelectorAll('.desktop-shortcut').forEach(targetShortcut => {
      let dragging = false;
      let moved = false;
      let pointerId = null;
      let startX = 0;
      let startY = 0;
      let initialLeft = 0;
      let initialTop = 0;

      targetShortcut.addEventListener('pointerdown', event => {
        if (event.button !== 0) return;
        dragging = true;
        pointerId = event.pointerId;
        startX = event.clientX;
        startY = event.clientY;
        initialLeft = targetShortcut.offsetLeft;
        initialTop = targetShortcut.offsetTop;
        moved = false;
        targetShortcut.classList.add('is-dragged');
        targetShortcut.setPointerCapture(pointerId);
        document.addEventListener('pointermove', moveShortcut);
        document.addEventListener('pointerup', stopShortcut);
        document.addEventListener('pointercancel', stopShortcut);
        event.preventDefault();
      });

      function moveShortcut(event) {
        if (!dragging || event.pointerId !== pointerId) return;
        const deltaX = event.clientX - startX;
        const deltaY = event.clientY - startY;
        if (Math.abs(deltaX) + Math.abs(deltaY) > 4) moved = true;
        targetShortcut.style.left = `${initialLeft + deltaX}px`;
        targetShortcut.style.top = `${initialTop + deltaY}px`;
        clampShortcut(targetShortcut);
      }

      function stopShortcut(event) {
        if (!dragging || event.pointerId !== pointerId) return;
        dragging = false;
        targetShortcut.classList.remove('is-dragged');
        document.removeEventListener('pointermove', moveShortcut);
        document.removeEventListener('pointerup', stopShortcut);
        document.removeEventListener('pointercancel', stopShortcut);
        if (targetShortcut.hasPointerCapture(pointerId)) {
          targetShortcut.releasePointerCapture(pointerId);
        }
        pointerId = null;

        if (moved) {
          const storageRect = storageWindow.getBoundingClientRect();
          const shortcutRect = targetShortcut.getBoundingClientRect();
          const droppedInStorage = !storageWindow.classList.contains('is-closed')
            && shortcutRect.right >= storageRect.left
            && shortcutRect.left <= storageRect.right
            && shortcutRect.bottom >= storageRect.top
            && shortcutRect.top <= storageRect.bottom;
          moveShortcutToFreeSpace(targetShortcut);
          if (droppedInStorage) announce('Shortcut dropped into VDisk (Local)');
          persistShortcut(targetShortcut);
        }
      }

      targetShortcut.addEventListener('click', event => {
        if (!moved) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        moved = false;
      }, true);

      targetShortcut.addEventListener('contextmenu', event => {
        showContextMenu(event, { kind: 'shortcut', shortcut: targetShortcut });
      });
    });

    window.addEventListener('resize', () => {
      normalizeShortcutPositions();
    });

    window.FelisOSVFS.init().then(async () => {
      for (const targetShortcut of document.querySelectorAll('.desktop-shortcut')) {
        const savedShortcut = await window.FelisOSVFS.readState(
          shortcutKey(targetShortcut.dataset.target),
          null
        );
        if (savedShortcut) {
          if (savedShortcut.deleted === true) {
            targetShortcut.remove();
            continue;
          }
          if (typeof savedShortcut.name === 'string' && savedShortcut.name) {
            targetShortcut.querySelector('.desktop-shortcut-label').textContent = savedShortcut.name;
          }
          if (Number.isFinite(savedShortcut.left)) targetShortcut.style.left = `${savedShortcut.left}px`;
          if (Number.isFinite(savedShortcut.top)) targetShortcut.style.top = `${savedShortcut.top}px`;
        }
      }
      normalizeShortcutPositions();
      return render();
    }).catch(error => announce(error.message));
  });
}());