const DEFAULT_APPS = [
  {
    id: 'browser',
    name: 'Browser.run',
    displayName: 'Browser',
    version: '1.0.0',
    icon: 'assets/icons/chromium-64x64.svg',
    windowId: 'win-1',
    entry: 'apps/browser.html',
    capabilities: ['network', 'tabs', 'history', 'bookmarks'],
    fileAssociations: ['text/html', 'application/xhtml+xml'],
  },
  {
    id: 'scribe',
    name: 'Scribe.run',
    displayName: 'Scribe',
    version: '1.0.0',
    // Custom icon placeholder: Insert custom icon from "assets/icons/" here (e.g. 'assets/icons/folder-read.svg')
    icon: '',
    windowId: 'win-2',
    entry: 'apps/scribe.html',
    capabilities: ['vfs.read', 'vfs.write', 'autosave'],
    fileAssociations: [
      'text/plain',
      'text/markdown',
      'text/rtf',
      'application/rtf',
      'application/json',
      'text/javascript',
      'text/css',
    ],
  },
  {
    id: 'kit-ncmd',
    name: 'Kit.nCmd.run',
    displayName: 'Kit.nCmd',
    version: '1.0.0',
    // Custom icon placeholder: Insert custom icon from "assets/icons/" here (e.g. 'assets/icons/appscore.svg')
    icon: '',
    windowId: 'win-3',
    entry: 'apps/kit-ncmd.html',
    capabilities: ['vfs.read', 'vfs.write', 'shell', 'command-registry'],
    fileAssociations: ['application/x-sh'],
  },
  {
    id: 'kneadydox',
    name: 'KneadyDox.run',
    displayName: 'KneadyDox',
    version: '1.0.0',
    // Custom icon placeholder: Insert custom icon from "assets/icons/" here (e.g. 'assets/icons/folder-docs.svg')
    icon: '',
    windowId: 'win-4',
    entry: 'apps/kneadydox.html',
    capabilities: ['vfs.read', 'pdf.view', 'doc.preview'],
    fileAssociations: [
      'application/pdf',
      'application/vnd.oasis.opendocument.text',
      'application/msword',
      'text/markdown',
    ],
  },
  {
    id: 'settings',
    name: 'System Preferences.run',
    displayName: 'System Preferences',
    version: '1.0.0',
    // Custom icon placeholder: Insert custom icon from "assets/icons/" here (e.g. 'assets/icons/system-config.svg')
    icon: '',
    windowId: 'win-5',
    entry: 'apps/settings.html',
    capabilities: ['settings.read', 'settings.write', 'vfs.export', 'system.appearance'],
    fileAssociations: [],
  },
];

function validateApp(app) {
  if (!app || typeof app.id !== 'string' || !app.id) {
    throw new TypeError('FelisOS app manifests require a non-empty id.');
  }
  if (typeof app.name !== 'string' || !app.name) {
    throw new TypeError(`FelisOS app "${app.id}" requires a name.`);
  }
  if (typeof app.version !== 'string' || !app.version) {
    throw new TypeError(`FelisOS app "${app.id}" requires a version.`);
  }
  if (typeof app.icon !== 'string') {
    throw new TypeError(`FelisOS app "${app.id}" requires an icon path.`);
  }
  if (!Array.isArray(app.capabilities) || !Array.isArray(app.fileAssociations)) {
    throw new TypeError(`FelisOS app "${app.id}" requires capability and file-association arrays.`);
  }
  return Object.freeze({
    ...app,
    capabilities: Object.freeze([...app.capabilities]),
    fileAssociations: Object.freeze([...app.fileAssociations]),
  });
}

const apps = Object.freeze(DEFAULT_APPS.map(validateApp));

function getApp(appId) {
  return apps.find(app => app.id === appId);
}

function getAppForWindow(windowId) {
  return apps.find(app => app.windowId === windowId);
}

function getAppIcon(appId) {
  const app = getApp(appId);
  return app ? app.icon : '';
}

window.FelisOSAppRegistry = Object.freeze({
  apps,
  getApp,
  getAppForWindow,
  getAppIcon,
});
