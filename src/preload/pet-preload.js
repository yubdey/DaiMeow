const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('petAPI', {
  // Get model URL from main process (resolves path safely)
  getModelUrl: (filename) => {
    return ipcRenderer.sendSync('pet:get-model-url', filename);
  },

  onMousePosition: (callback) => {
    ipcRenderer.on('pet:mouse-pos', (event, pos) => callback(pos));
  },
  onGamepadPosition: (callback) => {
    ipcRenderer.on('pet:gamepad-pos', (event, pos) => callback(pos));
  },
  // 手柄探测开关：主进程在「开启手柄支持 + 已启动」时下发 true，停止时下发 false
  onGamepadProbe: (callback) => {
    ipcRenderer.on('pet:gamepad-probe', (event, enabled) => callback(enabled));
  },
  reportGamepadPresence: (hasGamepad) => {
    ipcRenderer.send('pet:gamepad-presence', hasGamepad === true);
  },
  onShowSpeech: (callback) => {
    ipcRenderer.on('pet:show-speech', (event, text) => callback(text));
  },
  onResize: (callback) => {
    ipcRenderer.on('pet:resize', (event, size) => callback(size));
  },

  // 窗口拖动：手势由页面判断（区分点击 / 拖动），窗口移动交给主进程，
  // 避免高 DPI 缩放下渲染进程坐标与窗口坐标不一致
  beginPetDrag: () => {
    ipcRenderer.send('pet:drag-start');
  },
  endPetDrag: () => {
    ipcRenderer.send('pet:drag-end');
  },
  // 拖动跟手由渲染进程每帧驱动（rAF 与屏幕刷新对齐），见 services/pet-drag.js
  tickPetDrag: () => {
    ipcRenderer.send('pet:drag-tick');
  },

  onFixedChanged: (callback) => {
    ipcRenderer.on('pet:fixed-changed', (event, enabled) => callback(enabled));
  },
  // 窗口显示/隐藏（主进程在 show/hide 时下发；页面初始按隐藏处理）
  onVisibilityChanged: (callback) => {
    ipcRenderer.on('pet:visibility-changed', (event, visible) => callback(visible));
  },

  // 右键菜单：菜单本体在主进程用原生 Menu 弹出（桌宠窗口太小，页面里画会被裁掉）
  openContextMenu: () => {
    ipcRenderer.send('pet:context-menu');
  },

  notifyReady: (width, height) => {
    ipcRenderer.invoke('pet:ready', { width, height });
  },
  logError: (msg) => {
    ipcRenderer.invoke('pet:log-error', msg);
  },
});
