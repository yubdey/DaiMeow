const { ipcMain, screen } = require('electron');
const { save: saveConfig, getAll: getConfig } = require('./services/config-store');
const { PET_BASE_W, PET_BASE_H } = require('./services/pet-dimensions');

function registerIpcHandlers(ctx) {
  // Model file URL resolver (sync, used by preload)
  ipcMain.on('pet:get-model-url', (event, filename) => {
    const baseUrl = ctx.getModelServer().getBaseUrl();
    event.returnValue = baseUrl + '/daimeow/' + filename;
  });

  // Config
  ipcMain.handle('control:get-config', async () => {
    return getConfig();
  });

  ipcMain.handle('control:save-config', async (event, partial) => {
    saveConfig(partial);
    return getConfig();
  });

  // Chat history
  ipcMain.handle('control:get-chat-history', async () => {
    return ctx.getChatManager().getTextOnlyHistory();
  });

  // Start / Stop
  ipcMain.handle('control:start', async () => {
    const petWindow = ctx.getPetWindow();
    if (petWindow && !petWindow.isDestroyed()) {
      petWindow.show();
      const config = getConfig();
      petWindow.webContents.send('pet:passthrough-changed', config.mousePassthrough ?? false);
      petWindow.webContents.send('pet:fixed-changed', config.fixedPosition ?? false);
      // 应用置顶设置
      petWindow.setAlwaysOnTop(config.alwaysOnTop ?? true, 'screen-saver');
      // 重启时确保鼠标/手柄轮询恢复（stopLoop 已将其停止）
      ctx.startMousePoller();
    }
    ctx.startLoop();
    return true;
  });

  ipcMain.handle('control:stop', async () => {
    ctx.stopLoop();
    ctx.stopPollers(); // 隐藏窗口后停掉视线追踪，避免空转
    const petWindow = ctx.getPetWindow();
    if (petWindow && !petWindow.isDestroyed()) petWindow.hide();
    return true;
  });

  // 控制面板刷新/重载后用它对齐「启动/停止」按钮的真实状态
  ipcMain.handle('control:get-state', async () => {
    return { running: !!ctx.isLoopRunning() };
  });

  // Pet ready — start mouse tracking
  ipcMain.handle('pet:ready', async () => {
    const petWindow = ctx.getPetWindow();
    if (petWindow && !petWindow.isDestroyed()) {
      const config = getConfig();
      // 重新下发一次穿透/固定状态：pet 页面可能晚于 control:start 完成加载，
      // 避免渲染层持有默认值导致拖动区域与配置不一致。
      petWindow.webContents.send('pet:passthrough-changed', config.mousePassthrough ?? false);
      petWindow.webContents.send('pet:fixed-changed', config.fixedPosition ?? false);
      // 页面按"隐藏"初始化，这里同步一次真实可见性
      petWindow.webContents.send('pet:visibility-changed', petWindow.isVisible());
    }
    ctx.startMousePoller();
    return true;
  });

  // 窗口拖动（页面里 pointerdown / pointerup 时调用）
  ipcMain.on('pet:drag-start', () => {
    ctx.getPetDrag().start();
  });
  ipcMain.on('pet:drag-end', () => {
    ctx.getPetDrag().stop();
  });
  // 渲染进程每帧一次：拖动跟手的主节拍（见 services/pet-drag.js 顶部说明）
  ipcMain.on('pet:drag-tick', () => {
    ctx.getPetDrag().tick();
  });

  // Pet error log
  ipcMain.handle('pet:log-error', async (event, msg) => {
    console.error('[Pet Error]', msg);
    return true;
  });

  // Pet position/size from edit panel
  ipcMain.handle('control:update-pet-position', async (event, { x, y, scale }) => {
    const petWindow = ctx.getPetWindow();
    if (!petWindow || petWindow.isDestroyed()) return false;

    const { width: screenW, height: screenH } = screen.getPrimaryDisplay().bounds;
    const petW = Math.round(PET_BASE_W * scale);
    const petH = Math.round(PET_BASE_H * scale);
    const posX = Math.round((screenW - petW) * x);
    const posY = Math.round((screenH - petH) * y);

    // 程序化调整期间抑制 move 事件保存位置（Electron 的 move 事件异步派发，
    // 用时间戳窗口而不是同步标志位，避免竞态）
    petWindow._skipMoveUntil = Date.now() + 300;
    petWindow.setSize(petW, petH);
    petWindow.setPosition(posX, posY);
    petWindow.webContents.send('pet:resize', { w: petW, h: petH });

    saveConfig({ petPositionX: x, petPositionY: y, petScale: scale });
    return true;
  });

  // Reset edit panel defaults
  ipcMain.handle('control:reset-pet-defaults', async () => {
    saveConfig({ petPositionX: 0, petPositionY: 0.5, petScale: 0.5 });

    const petWindow = ctx.getPetWindow();
    if (petWindow && !petWindow.isDestroyed()) {
      const { width: screenW, height: screenH } = screen.getPrimaryDisplay().bounds;
      const petW = Math.round(PET_BASE_W * 0.5);
      const petH = Math.round(PET_BASE_H * 0.5);
      petWindow._skipMoveUntil = Date.now() + 300;
      petWindow.setSize(petW, petH);
      petWindow.setPosition(Math.round((screenW - petW) * 0), Math.round((screenH - petH) * 0.5));
      petWindow.webContents.send('pet:resize', { w: petW, h: petH });
    }
    return true;
  });

  // Personality system
  ipcMain.handle('personality:get-all', async () => {
    return ctx.getPersonalityManager().getAll();
  });
  ipcMain.handle('personality:get-current', async () => {
    return ctx.getPersonalityManager().getCurrent();
  });
  ipcMain.handle('personality:set-current', async (event, id) => {
    return ctx.getPersonalityManager().setCurrent(id);
  });
  ipcMain.handle('personality:preview', async (event, id) => {
    return ctx.getPersonalityManager().getPreview(id);
  });

  // Ollama
  ipcMain.handle('ollama:fetch-models', async (event, endpoint) => {
    return ctx.getOllamaProvider().fetchModels(endpoint);
  });

  // Fixed position toggle
  ipcMain.handle('control:set-fixed-position', async (event, enabled) => {
    saveConfig({ fixedPosition: enabled });
    const petWindow = ctx.getPetWindow();
    if (petWindow && !petWindow.isDestroyed()) {
      petWindow.webContents.send('pet:fixed-changed', enabled);
    }
    return true;
  });

  // Mouse passthrough toggle
  ipcMain.handle('control:set-passthrough', async (event, enabled) => {
    saveConfig({ mousePassthrough: enabled });
    const petWindow = ctx.getPetWindow();
    if (petWindow && !petWindow.isDestroyed()) {
      petWindow.setIgnoreMouseEvents(enabled);
      petWindow.webContents.send('pet:passthrough-changed', enabled);
    }
    return true;
  });

  // Opacity slider
  ipcMain.handle('control:set-opacity', async (event, value) => {
    saveConfig({ petOpacity: value });
    const petWindow = ctx.getPetWindow();
    if (petWindow && !petWindow.isDestroyed()) {
      petWindow.setOpacity(value);
    }
    return true;
  });

  // 置于顶层开关（原生 TopMost，screen-saver 层级）
  ipcMain.handle('control:set-topmost', async (event, enabled) => {
    saveConfig({ alwaysOnTop: enabled });
    const petWindow = ctx.getPetWindow();
    if (petWindow && !petWindow.isDestroyed()) {
      petWindow.setAlwaysOnTop(enabled, 'screen-saver');
    }
    return true;
  });

  // 公告已读标记（渲染进程实际显示后调用）
  ipcMain.handle('notice:dismiss', async (event, version) => {
    ctx.getNoticeManager().markSeen(version);
    return true;
  });

  // 生活词条
  ipcMain.handle('life-tags:get-all', async () => {
    return ctx.getLifeTagsManager().getAll();
  });

}

module.exports = { registerIpcHandlers };
