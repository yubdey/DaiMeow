const { app, screen } = require('electron');
const { createControlWindow, createPetWindow } = require('./windows');

// Fix taskbar icon association on Windows.
// Without an AppUserModelID, Windows cannot reliably associate the window
// with an icon when launched via `npx electron .`, showing a generic icon.
// 这个值必须和 package.json 的 build.appId 完全一致：Windows 靠它把「固定到任务栏的
// 快捷方式」和「运行中的窗口」归成同一个图标。electron-builder 用的就是 appId，
// 两边不一致时可能出现两个图标。改这里，不要改 appId（appId 变了老用户没法覆盖升级）。
app.setAppUserModelId('com.yubdey.daimeow');
const { createTray } = require('./tray');
const { registerIpcHandlers } = require('./ipc-handlers');
const { load: loadConfig, getAll: getConfig } = require('./services/config-store');
const { ChatManager } = require('./services/chat-manager');
const { StatsTracker } = require('./services/stats-tracker');
const { IdleDetector } = require('./services/idle-detector');
const { MousePoller } = require('./services/mouse-poller');
const { ApiClient } = require('./services/api-client');
const { captureScreen } = require('./services/screenshot');
const { ModelServer } = require('./services/model-server');
const { PersonalityManager } = require('./services/personality-manager');
const { GamepadPoller } = require('./services/gamepad-poller');
const { PetDragController } = require('./services/pet-drag');
const { NoticeManager } = require('./services/notice-manager');
const { LifeTagsManager } = require('./services/life-tags-manager');
const { save: saveConfig } = require('./services/config-store');

let controlWindow = null;
let petWindow = null;
let tray = null;
let isQuitting = false;

// Services
const chatManager = new ChatManager();
const statsTracker = new StatsTracker();
const modelServer = new ModelServer();
const personalityManager = new PersonalityManager();
const noticeManager = new NoticeManager();
const lifeTagsManager = new LifeTagsManager();
let apiClient = null;
let idleDetector = null;
let mousePoller = null;
let gamepadPoller = null;
const petDragController = new PetDragController(() => petWindow, getConfig);
let screenshotTimer = null;
let petWindowReadyPromise = null;
let petWindowReadyResolve = null;
let petWindowReadyReject = null;
let petMoveSaveTimer = null;

app.whenReady().then(async () => {
  console.log('[DaiMeow] App ready');

  // Start local HTTP server for model files
  await modelServer.start();

  loadConfig();

  // 词条系统与历史运行总时长对齐，保证家里蹲的"总使用"和主页显示一致
  lifeTagsManager.syncWithStatsTracker(statsTracker.totalUptime);
  // 恢复上次选中的人格（配置在 app ready 后才加载，所以在这里同步）
  personalityManager.loadFromConfig();

  controlWindow = createControlWindow();
  tray = createTray(controlWindow, (v) => { isQuitting = v; });

  apiClient = new ApiClient(
    { getAll: getConfig },
    chatManager,
    statsTracker,
    personalityManager
  );

  registerIpcHandlers({
    getPetWindow: () => petWindow,
    ensurePetWindow,
    markPetReady,
    getControlWindow: () => controlWindow,
    getChatManager: () => chatManager,
    getModelServer: () => modelServer,
    getPersonalityManager: () => personalityManager,
    getNoticeManager: () => noticeManager,
    getLifeTagsManager: () => lifeTagsManager,
    getStatsTracker: () => statsTracker,
    getPetDrag: () => petDragController,
    startMousePoller: () => {
      if (!mousePoller) {
        mousePoller = new MousePoller(petWindow, { intervalMs: 50 });
        mousePoller.start();
      }
      // 手柄支持默认关闭（config.gamepadEnabled）。开启时也不直接起 XInput 轮询：
      // 先让渲染层用 Chromium 自带的 Gamepad API 探一下有没有真手柄，
      // 探到了（pet:gamepad-presence）才起那个常驻 PowerShell 进程。
      // 注意：探测的触发点在 startLoop() 里 —— 这里（control:start 中途）循环还没起来，
      // 判断"是否已启动"会永远为假，探测就发不出去。
    },
    startGamepadPoller: () => {
      if (gamepadPoller || !petWindow || petWindow.isDestroyed()) return;
      console.log('[Gamepad] 检测到手柄，启动 XInput 轮询');
      gamepadPoller = new GamepadPoller(petWindow);
      gamepadPoller.start();
    },
    stopPollers: () => {
      if (mousePoller) { mousePoller.stop(); mousePoller = null; }
      if (gamepadPoller) { gamepadPoller.stop(); gamepadPoller = null; }
      if (petWindow && !petWindow.isDestroyed()) {
        petWindow.webContents.send('pet:gamepad-probe', false);
      }
    },
    isLoopRunning: () => screenshotTimer !== null,
    startLoop,
    stopLoop,
    applyScreenshotInterval,
    // 桌宠右键菜单里的「退出呆喵」：跟托盘退出走同一条路径，
    // 必须先置 isQuitting，否则控制窗口的 close 拦截会把退出吃掉。
    quitApp: () => {
      isQuitting = true;
      app.quit();
    },
  });

  controlWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      controlWindow.hide();
    }
  });

  // 后台异步检查远程公告，不阻塞启动；失败静默
  noticeManager.check().then((notice) => {
    if (notice && controlWindow && !controlWindow.isDestroyed()) {
      controlWindow.webContents.send('main:show-notice', notice);
    }
  });
});

function sendPetVisibility(visible) {
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.webContents.send('pet:visibility-changed', visible);
  }
}

function ensurePetWindow() {
  if (petWindow && !petWindow.isDestroyed()) {
    return petWindowReadyPromise || Promise.resolve(petWindow);
  }

  petWindowReadyPromise = new Promise((resolve, reject) => {
    petWindowReadyResolve = resolve;
    petWindowReadyReject = reject;
  });

  let win;
  try {
    win = createPetWindow();
    petWindow = win;
  } catch (err) {
    petWindowReadyResolve = null;
    petWindowReadyReject = null;
    petWindowReadyPromise = null;
    throw err;
  }

  win.webContents.once('did-fail-load', (event, code, description) => {
    if (petWindowReadyReject) {
      petWindowReadyReject(new Error(`Pet window failed to load (${code}): ${description}`));
      petWindowReadyResolve = null;
      petWindowReadyReject = null;
    }
    if (!win.isDestroyed()) win.destroy();
  });

  win.on('show', () => sendPetVisibility(true));
  win.on('hide', () => sendPetVisibility(false));

  // Sync position sliders after native drag (debounced)
  win.on('move', () => {
    // 程序化调整（setSize/setPosition）产生的 move 事件在时间戳窗口内直接忽略
    if (win._skipMoveUntil && Date.now() < win._skipMoveUntil) return;
    if (petMoveSaveTimer) clearTimeout(petMoveSaveTimer);
    petMoveSaveTimer = setTimeout(() => {
      if (win.isDestroyed()) return;
      const { width: screenW, height: screenH } = screen.getPrimaryDisplay().bounds;
      const bounds = win.getBounds();
      const x = screenW > bounds.width ? bounds.x / (screenW - bounds.width) : 0;
      const y = screenH > bounds.height ? bounds.y / (screenH - bounds.height) : 0;
      saveConfig({ petPositionX: Math.max(0, Math.min(1, x)), petPositionY: Math.max(0, Math.min(1, y)) });
      if (controlWindow && !controlWindow.isDestroyed()) {
        controlWindow.webContents.send('main:position-sync', {
          x: Math.round(Math.max(0, Math.min(1, x)) * 100),
          y: Math.round(Math.max(0, Math.min(1, y)) * 100),
        });
      }
    }, 300);
  });

  win.on('closed', () => {
    if (petMoveSaveTimer) {
      clearTimeout(petMoveSaveTimer);
      petMoveSaveTimer = null;
    }
    if (petWindowReadyReject) {
      petWindowReadyReject(new Error('Pet window closed before ready'));
    }
    petWindowReadyResolve = null;
    petWindowReadyReject = null;
    petWindowReadyPromise = null;
    if (petWindow === win) petWindow = null;
  });

  return petWindowReadyPromise;
}

function markPetReady() {
  if (!petWindowReadyResolve || !petWindow || petWindow.isDestroyed()) return;
  const resolve = petWindowReadyResolve;
  petWindowReadyResolve = null;
  petWindowReadyReject = null;
  resolve(petWindow);
}
app.on('window-all-closed', () => {});
app.on('before-quit', () => {
  isQuitting = true;
  stopLoop();
  chatManager.clear();
  if (mousePoller) { mousePoller.stop(); }
  if (gamepadPoller) { gamepadPoller.stop(); }
  petDragController.stop();
  modelServer.stop();
});
app.on('activate', () => {
  if (controlWindow) {
    controlWindow.show();
    controlWindow.focus();
  }
});

/**
 * 截图间隔（毫秒）。配置损坏或被人为改成 0 时不要退化成"疯狂截图"
 * （会不停烧 API 额度），所以夹在 5~30 秒 —— 与设置面板滑块的取值范围一致。
 * 注意：范围以外的历史配置（比如早先设过 60 秒）会被夹进这个区间。
 */
function readScreenshotIntervalMs() {
  const sec = Math.min(30, Math.max(5, parseInt(getConfig().screenshotInterval, 10) || 15));
  return sec * 1000;
}

/**
 * 按最新的「截图间隔」重排截图定时器。
 *
 * 间隔是在 startLoop 里一次性读进 setInterval 的，所以运行中改配置只写盘没用 ——
 * 旧定时器还会按老间隔一直跑下去，必须停一下再启动才会用新值。
 * 这里在保存配置后立刻重排：清掉旧定时器、用新间隔重新计时。
 * 循环没在跑时什么都不做（下次 startLoop 本来就会读到新值）。
 *
 * @returns {boolean} 是否真的重排了
 */
function applyScreenshotInterval() {
  if (screenshotTimer === null) return false;
  // 统计/落盘那两个定时器挂在截图定时器上（见 startLoop 末尾），重排时要一起搬过去
  const statsTimer = screenshotTimer._statsTimer;
  const flushTimer = screenshotTimer._flushTimer;
  clearInterval(screenshotTimer);
  screenshotTimer = setInterval(runCycle, readScreenshotIntervalMs());
  screenshotTimer._statsTimer = statsTimer;
  screenshotTimer._flushTimer = flushTimer;
  return true;
}

function startLoop() {
  // Defensive: clear any existing loop to avoid duplicate timers
  stopLoop();

  idleDetector = new IdleDetector({
    // 无操作多久算闲置（秒）：180 = 3 分钟。闲置时会暂停截图循环，也不计入使用时长
    threshold: 180,
    onIdleChange: (idle) => {
      statsTracker.setIdle(idle);
      if (controlWindow && !controlWindow.isDestroyed()) {
        controlWindow.webContents.send('main:status-change', idle ? 'idle' : 'running');
      }
    },
  });
  idleDetector.start();

  statsTracker.start();

  runCycle();
  screenshotTimer = setInterval(runCycle, readScreenshotIntervalMs());

  // 手柄支持（默认关闭）：开关打开时，让渲染层用 Chromium 自带的 Gamepad API 探测有没有真手柄；
  // 只有探到手柄（pet:gamepad-presence）才会去起 XInput 轮询那个常驻 PowerShell 进程。
  if (getConfig().gamepadEnabled === true && petWindow && !petWindow.isDestroyed()) {
    petWindow.webContents.send('pet:gamepad-probe', true);
  }

  const statsTimer = setInterval(() => {
    if (statsTracker.status === 'running') {
      statsTracker.addUptime(1);
      lifeTagsManager.tick(); // 词条时段统计（仅 running，idle 不计）
    }
    if (controlWindow && !controlWindow.isDestroyed()) {
      controlWindow.webContents.send('main:stats-update', statsTracker.getStats());
    }
  }, 1000);

  // 统计累计值每 30 秒落盘一次（避免每秒同步写磁盘）
  const flushTimer = setInterval(() => {
    statsTracker.flush();
    lifeTagsManager.flush();
  }, 30000);

  screenshotTimer._statsTimer = statsTimer;
  screenshotTimer._flushTimer = flushTimer;
}

function stopLoop() {
  if (idleDetector) { idleDetector.stop(); idleDetector = null; }
  if (screenshotTimer) {
    clearInterval(screenshotTimer._statsTimer);
    clearInterval(screenshotTimer._flushTimer);
    clearInterval(screenshotTimer);
    screenshotTimer = null;
  }
  statsTracker.flush();
  statsTracker.stop();
  lifeTagsManager.flush();
  // 注意：不在此停止 mousePoller/gamepadPoller。
  // 它们是视线追踪功能，与截图循环独立；stopLoop 会被 startLoop 开头调用，
  // 若在此停 poller 会把刚启动的追踪清掉。poller 仅在 control:stop / 退出时停。
}

let cycleRunning = false;

/** 呆喵当前所在显示器的 id（多显示器时决定截哪块屏；取不到返回 null，由截图侧回退） */
function getPetDisplayId() {
  try {
    if (!petWindow || petWindow.isDestroyed()) return null;
    const bounds = petWindow.getBounds();
    return screen.getDisplayNearestPoint({
      x: Math.round(bounds.x + bounds.width / 2),
      y: Math.round(bounds.y + bounds.height / 2),
    }).id;
  } catch (err) {
    return null;
  }
}

async function runCycle() {
  if (cycleRunning) return;
  if (idleDetector && idleDetector.isIdle) return;

  cycleRunning = true;
  try {
    // 场景识别与台词共用同一次多模态请求（不会多发一次请求、也不多消耗图片 Token），
    // 所以固定每张都识别；原先的「场景识别频率」抽样开关已从设置里移除。
    const base64Image = await captureScreen({ displayId: getPetDisplayId() });
    const { reply, scene } = await apiClient.sendScreenshot(base64Image);
    if (scene) lifeTagsManager.recordScene(scene);

    if (controlWindow && !controlWindow.isDestroyed()) {
      controlWindow.webContents.send('main:new-response', {
        role: 'assistant',
        content: reply,
        timestamp: Date.now(),
      });
    }

    if (petWindow && !petWindow.isDestroyed()) {
      petWindow.webContents.send('pet:show-speech', reply);
    }
  } catch (err) {
    console.error('Cycle error:', err.message);
    if (controlWindow && !controlWindow.isDestroyed()) {
      controlWindow.webContents.send('main:error', {
        code: 'API_ERROR',
        message: err.message,
        timestamp: Date.now(),
      });
    }
  } finally {
    cycleRunning = false;
  }
}
