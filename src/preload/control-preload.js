const { contextBridge, ipcRenderer } = require('electron');

const ALLOWED_INVOKE_CHANNELS = new Set([
  'control:get-config',
  'control:save-config',
  'control:start',
  'control:stop',
  'control:get-state',
  'control:get-stats',
  'control:update-pet-position',
  'control:set-fixed-position',
  'control:set-passthrough',
  'control:set-opacity',
  'control:set-topmost',
  'control:reset-pet-defaults',
  'control:get-chat-history',
  'notice:dismiss',
  'personality:get-all',
  'personality:get-current',
  'personality:set-current',
  'personality:preview',
  'life-tags:get-all',
]);

contextBridge.exposeInMainWorld('daimeowAPI', {
  invoke: (channel, ...args) => {
    if (typeof channel !== 'string' || !ALLOWED_INVOKE_CHANNELS.has(channel)) {
      throw new Error('Blocked IPC invoke channel: ' + String(channel));
    }
    return ipcRenderer.invoke(channel, ...args);
  },
  on: (channel, callback) => {
    const listener = (event, ...args) => callback(...args);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
});
