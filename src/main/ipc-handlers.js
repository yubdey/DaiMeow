const { ipcMain, screen } = require('electron');
const { save: saveConfig, getAll: getConfig } = require('./services/config-store');
const { PET_BASE_W, PET_BASE_H } = require('./services/pet-dimensions');
const { createPetContextMenu } = require('./services/pet-context-menu');

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

  // 首页统计：打开面板时先拉一次，不用等启动循环
  ipcMain.handle('control:get-stats', async () => {
    return ctx.getStatsTracker().getStats();
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
      // 手柄探测：页面可能在 control:start 之后才加载完，这里补发一次（仅当开关打开且循环在跑）
      if (config.gamepadEnabled === true && ctx.isLoopRunning()) {
        petWindow.webContents.send('pet:gamepad-probe', true);
      }
    }
    ctx.startMousePoller();
    return true;
  });

  // 渲染层用 Chromium 自带的 Gamepad API 报告"有没有插手柄"：
  // 只有探到真手柄，才让主进程去起 XInput 轮询（常驻 PowerShell）。
  ipcMain.on('pet:gamepad-presence', (event, hasGamepad) => {
    if (hasGamepad === true) ctx.startGamepadPoller();
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

  // 把「位置 + 缩放」一次性应用到桌宠窗口。
  // 「调整」面板的滑块和桌宠右键菜单里的「调整大小」都走这一条路径，保证行为一致。
  const applyPetTransform = ({ x, y, scale }) => {
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
    // 必须用 setBounds 一次写回位置 + 尺寸，不能拆成 setSize + setPosition：
    // 这个窗口是 resizable:false，实测（150% 缩放）setSize() 只能把窗口放大，
    // 想缩小会被 Windows 直接忽略。于是「窗口没变小、页面画布却按新尺寸缩了」，
    // 等下一次真实 resize（比如拖动）一到，画布弹回窗口真实尺寸，模型看起来就突然变大，
    // 而配置里的缩放值根本没变。setBounds 两个方向都可靠（pet-drag.js 也用它）。
    petWindow.setBounds({ x: posX, y: posY, width: petW, height: petH });
    petWindow.webContents.send('pet:resize', { w: petW, h: petH });

    saveConfig({ petPositionX: x, petPositionY: y, petScale: scale });
    return true;
  };

  // Pet position/size from edit panel
  ipcMain.handle('control:update-pet-position', async (event, payload) => {
    return applyPetTransform(payload);
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

  // 固定位置开关（「调整」面板与桌宠右键菜单共用）
  const setFixedPosition = (enabled) => {
    saveConfig({ fixedPosition: enabled });
    const petWindow = ctx.getPetWindow();
    if (petWindow && !petWindow.isDestroyed()) {
      petWindow.webContents.send('pet:fixed-changed', enabled);
    }
    return true;
  };
  ipcMain.handle('control:set-fixed-position', async (event, enabled) => setFixedPosition(enabled));

  // 鼠标穿透开关（共用）
  const setPassthrough = (enabled) => {
    saveConfig({ mousePassthrough: enabled });
    const petWindow = ctx.getPetWindow();
    if (petWindow && !petWindow.isDestroyed()) {
      petWindow.setIgnoreMouseEvents(enabled);
      petWindow.webContents.send('pet:passthrough-changed', enabled);
    }
    return true;
  };
  ipcMain.handle('control:set-passthrough', async (event, enabled) => setPassthrough(enabled));

  // 透明度（共用）
  const setOpacity = (value) => {
    saveConfig({ petOpacity: value });
    const petWindow = ctx.getPetWindow();
    if (petWindow && !petWindow.isDestroyed()) {
      petWindow.setOpacity(value);
    }
    return true;
  };
  ipcMain.handle('control:set-opacity', async (event, value) => setOpacity(value));

  // 置于顶层开关（原生 TopMost，screen-saver 层级，共用）
  const setAlwaysOnTop = (enabled) => {
    saveConfig({ alwaysOnTop: enabled });
    const petWindow = ctx.getPetWindow();
    if (petWindow && !petWindow.isDestroyed()) {
      petWindow.setAlwaysOnTop(enabled, 'screen-saver');
    }
    return true;
  };
  ipcMain.handle('control:set-topmost', async (event, enabled) => setAlwaysOnTop(enabled));

  // 「恢复默认」：位置 / 缩放 / 透明度 / 固定位置 / 鼠标穿透 / 置于顶层 全部还原成出厂值。
  // 「调整」面板的按钮和桌宠右键菜单共用这一条路径，保证两边行为一模一样。
  // 直接复用上面的各个 setter，不重复写一遍窗口操作。
  const resetPetDefaults = () => {
    applyPetTransform({ x: 0, y: 0.5, scale: 0.5 });
    setOpacity(1.0);
    setFixedPosition(false);
    setPassthrough(false);
    setAlwaysOnTop(true);
    return true;
  };
  ipcMain.handle('control:reset-pet-defaults', async () => resetPetDefaults());

  // 右键菜单改了设置之后，把「调整」相关的值推回控制面板，
  // 否则面板上的滑块/开关还停在旧状态（只有面板自己改的时候它才会自更新）
  const pushConfigToControl = () => {
    const controlWindow = ctx.getControlWindow ? ctx.getControlWindow() : null;
    if (!controlWindow || controlWindow.isDestroyed()) return;
    const config = getConfig();
    controlWindow.webContents.send('main:config-sync', {
      petScale: config.petScale,
      petPositionX: config.petPositionX,
      petPositionY: config.petPositionY,
      fixedPosition: config.fixedPosition,
      mousePassthrough: config.mousePassthrough,
      alwaysOnTop: config.alwaysOnTop,
      petOpacity: config.petOpacity,
    });
  };

  // 桌宠右键菜单
  const petContextMenu = createPetContextMenu({
    getState: () => getConfig(),
    setScale: (scale) => {
      const config = getConfig();
      // 换尺寸时保持当前相对位置，效果跟拖「调整」面板的滑块一致
      applyPetTransform({
        x: config.petPositionX ?? 0,
        y: config.petPositionY ?? 0.5,
        scale,
      });
      pushConfigToControl();
    },
    setFixedPosition: (enabled) => {
      setFixedPosition(enabled);
      pushConfigToControl();
    },
    setPassthrough: (enabled) => {
      setPassthrough(enabled);
      pushConfigToControl();
    },
    setAlwaysOnTop: (enabled) => {
      setAlwaysOnTop(enabled);
      pushConfigToControl();
    },
    resetDefaults: () => {
      resetPetDefaults();
      pushConfigToControl();
    },
    quit: () => ctx.quitApp(),
  });

  ipcMain.on('pet:context-menu', () => {
    const petWindow = ctx.getPetWindow();
    if (!petWindow || petWindow.isDestroyed()) return;
    petContextMenu.popup(petWindow);
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
