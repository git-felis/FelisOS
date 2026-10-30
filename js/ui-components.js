document.addEventListener('DOMContentLoaded', () => {
  document.addEventListener('contextmenu', event => {
    event.preventDefault();
  });

  const status = document.querySelector('[data-component-status]');

  function announce(message) {
    if (status) status.textContent = message;
  }

  document.querySelectorAll('[data-input-text]').forEach(control => {
    const input = control.querySelector('input');
    const initialState = control.dataset.inputState || 'default';

    input.addEventListener('focus', () => {
      if (!input.disabled) control.dataset.inputState = 'focused';
    });
    input.addEventListener('blur', () => {
      if (!input.value.trim() && input.required) {
        control.dataset.inputState = 'invalid';
      } else {
        control.dataset.inputState = initialState;
      }
    });
    input.addEventListener('input', () => {
      if (control.dataset.inputState === 'invalid' && input.value.trim()) {
        control.dataset.inputState = 'default';
      }
    });
  });

  document.querySelectorAll('[data-svg-button]').forEach(button => {
    const initialState = button.dataset.buttonState || 'default';

    button.addEventListener('mouseenter', () => {
      if (!button.disabled) button.dataset.buttonState = 'hover';
    });
    button.addEventListener('mouseleave', () => {
      if (!button.disabled) button.dataset.buttonState = initialState;
    });
    button.addEventListener('mousedown', () => {
      if (!button.disabled) button.dataset.buttonState = 'pressed';
    });
    button.addEventListener('mouseup', () => {
      if (!button.disabled) button.dataset.buttonState = 'hover';
    });
    button.addEventListener('focus', () => {
      if (!button.disabled && button.dataset.buttonState !== 'pressed') {
        button.dataset.buttonState = 'hover';
      }
    });
    button.addEventListener('blur', () => {
      if (!button.disabled) button.dataset.buttonState = initialState;
    });
  });

  document.querySelectorAll('[data-control-form]').forEach(form => {
    form.addEventListener('submit', event => {
      event.preventDefault();
      const input = form.querySelector('input');
      const formStatus = form.parentElement.querySelector('[data-form-status]');
      if (!input.value.trim()) {
        input.required = true;
        input.setCustomValidity('Enter your name before submitting.');
        input.reportValidity();
        input.closest('[data-input-text]').dataset.inputState = 'invalid';
        if (formStatus) formStatus.textContent = 'Please enter your name.';
        return;
      }
      input.setCustomValidity('');
      if (formStatus) formStatus.textContent = `Submitted: ${input.value.trim()}`;
    });
  });

  document.querySelectorAll('[data-action]').forEach(action => {
    action.addEventListener('click', () => {
      announce(`${action.textContent} action selected.`);
      if (action.dataset.action === 'more') {
        action.setAttribute('aria-expanded', action.getAttribute('aria-expanded') !== 'true');
      }
    });
  });

  document.querySelectorAll('[data-shortcut]').forEach(shortcut => {
    shortcut.addEventListener('click', () => {
      announce(`${shortcut.querySelector('span:last-child').textContent} shortcut selected.`);
    });
  });

  document.querySelectorAll('[data-combobox]').forEach(combobox => {
    const trigger = combobox.querySelector('.combobox-trigger');
    const options = [...combobox.querySelectorAll('[role="option"]')];
    const value = combobox.querySelector('[data-combobox-value]');
    const initialState = combobox.dataset.comboboxState || 'default';
    const stateKey = combobox.id ? `settings.combobox.${combobox.id}` : '';

    if (stateKey && window.FelisOSVFS) {
      window.FelisOSVFS.readState(stateKey, null).then(savedValue => {
        const savedOption = options.find(option => option.dataset.value === savedValue);
        if (savedOption) selectOption(savedOption, false);
      }).catch(error => announce(`Unable to restore setting: ${error.message}`));
    }

    function setOpen(open) {
      if (combobox.dataset.comboboxState === 'disabled') return;
      combobox.classList.toggle('is-open', open);
      trigger.setAttribute('aria-expanded', String(open));
      combobox.dataset.comboboxState = open ? 'pressed' : initialState;
    }

    function selectOption(option, persist = true) {
      options.forEach(item => item.setAttribute('aria-selected', String(item === option)));
      value.textContent = option.textContent;
      combobox.dataset.value = option.dataset.value;
      setOpen(false);
      trigger.focus();
      announce(`${option.textContent} selected.`);
      if (persist && stateKey && window.FelisOSVFS) {
        window.FelisOSVFS.writeState(stateKey, option.dataset.value)
          .catch(error => announce(`Unable to save setting: ${error.message}`));
      }
    }

    trigger.addEventListener('click', () => setOpen(!combobox.classList.contains('is-open')));
    trigger.addEventListener('keydown', event => {
      if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        setOpen(true);
        options[0].focus();
      }
      if (event.key === 'Escape') setOpen(false);
    });
    options.forEach((option, index) => {
      option.addEventListener('click', () => selectOption(option));
      option.addEventListener('keydown', event => {
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          options[(index + 1) % options.length].focus();
        }
        if (event.key === 'ArrowUp') {
          event.preventDefault();
          options[(index - 1 + options.length) % options.length].focus();
        }
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          selectOption(option);
        }
        if (event.key === 'Escape') {
          setOpen(false);
          trigger.focus();
        }
      });
    });
    trigger.addEventListener('mouseenter', () => {
      if (!combobox.classList.contains('is-open') && initialState === 'default') {
        combobox.dataset.comboboxState = 'hover';
      }
    });
    trigger.addEventListener('mouseleave', () => {
      if (!combobox.classList.contains('is-open') && initialState === 'default') {
        combobox.dataset.comboboxState = 'default';
      }
    });
    document.addEventListener('click', event => {
      if (!combobox.contains(event.target)) setOpen(false);
    });
  });

  document.querySelectorAll('.list-view').forEach(list => {
    const items = [...list.querySelectorAll('[role="option"]')];
    items.forEach((item, index) => {
      item.addEventListener('click', () => selectListItem(item));
      item.addEventListener('keydown', event => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          const next = event.key === 'ArrowDown'
            ? (index + 1) % items.length
            : (index - 1 + items.length) % items.length;
          items[next].focus();
          selectListItem(items[next]);
        }
      });
    });
    function selectListItem(item) {
      items.forEach(option => option.setAttribute('aria-selected', String(option === item)));
    }
  });

  document.querySelectorAll('.tree-toggle').forEach(toggle => {
    toggle.addEventListener('click', () => {
      const treeItem = toggle.closest('[role="treeitem"]');
      const expanded = treeItem.getAttribute('aria-expanded') === 'true';
      treeItem.setAttribute('aria-expanded', String(!expanded));
      toggle.textContent = expanded ? '▸' : '▾';
    });

    document.querySelectorAll('.tree-view [role="treeitem"]').forEach(item => {
      item.addEventListener('click', () => {
        document.querySelectorAll('.tree-view [role="treeitem"]').forEach(treeItem => {
          treeItem.removeAttribute('aria-selected');
        });
        item.setAttribute('aria-selected', 'true');
        announce(`${item.textContent.trim()} folder selected.`);
      });
    });
  });

  document.querySelectorAll('[data-dialog]').forEach(button => {
    button.addEventListener('click', () => {
      const dialog = document.getElementById(button.dataset.dialog);
      if (dialog && typeof dialog.showModal === 'function') dialog.showModal();
    });
  });

  document.querySelectorAll('[data-modal]').forEach(button => {
    button.addEventListener('click', () => {
      const modal = document.getElementById(button.dataset.modal);
      if (!modal) return;
      modal.dataset.returnFocus = button.id || '';
      modal.classList.remove('is-hidden');
      const firstButton = modal.querySelector('button');
      if (firstButton) firstButton.focus();
    });
  });

  document.querySelectorAll('[data-modal-close]').forEach(button => {
    button.addEventListener('click', () => {
      const modal = button.closest('.system-modal');
      if (!modal) return;
      modal.classList.add('is-hidden');
      const returnFocus = modal.dataset.returnFocus
        ? document.getElementById(modal.dataset.returnFocus)
        : null;
      if (returnFocus) returnFocus.focus();
    });
  });

  document.querySelectorAll('.system-modal').forEach(modal => {
    modal.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        modal.classList.add('is-hidden');
      }
    });
  });

  document.querySelectorAll('.dialog-card [data-svg-button]').forEach(button => {
    button.addEventListener('click', () => {
      const dialog = button.closest('dialog');
      if (dialog && button.value === 'cancel') dialog.close('cancel');
    });
  });

  const saveDialog = document.getElementById('file-save-dialog');
  if (saveDialog) {
    saveDialog.addEventListener('close', () => {
      if (saveDialog.returnValue !== 'save') return;
      const input = saveDialog.querySelector('#file-name');
      const name = input ? input.value.trim() : '';
      if (!name || /[\\/]/.test(name)) return;
      if (window.FelisOSVFS) {
        window.FelisOSVFS.writeFile(`${window.FelisOSVFS.ROOT}/${name}`, '', true)
          .catch(error => announce(`Unable to save file: ${error.message}`));
      }
    });
  }
});
