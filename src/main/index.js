const { app, screen } = require('electron');
const { createControlWindow, createPetWindow } = require('./windows');

// Fix taskbar icon association on Windows.
// Without an AppUserModelID, Windows cannot reliably associate the window
// with an icon when launched via `npx electron .`, showing a generic icon.
app.setAppUserModelId('com.daimeow.desktop');
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
const { OllamaProvider } = require('./services/ollama-provider');
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
const ollamaProvider = new OllamaProvider();
const noticeManager = new NoticeManager();
const lifeTagsManager = new LifeTagsManager();
let apiClient = null;
let idleDetector = null;
let mousePoller = null;
let gamepadPoller = null;
const petDragController = new PetDragController(() => petWindow, getConfig);
let screenshotTimer = null;

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
  petWindow = createPetWindow();
  tray = createTray(controlWindow, (v) => { isQuitting = v; });

  // 把桌宠窗口的显示/隐藏状态推给渲染层。
  // 页面里的 document.hidden 在窗口「从未显示过」时不会翻转为 true（实测），
  // 靠它判断"窗口是否可见"不可靠，所以待机动画改用这个显式信号。
  const sendPetVisibility = (visible) => {
    if (petWindow && !petWindow.isDestroyed()) {
      petWindow.webContents.send('pet:visibility-changed', visible);
    }
  };
  petWindow.on('show', () => sendPetVisibility(true));
  petWindow.on('hide', () => sendPetVisibility(false));

  // Sync position sliders after native drag (debounced)
  let moveSaveTimer = null;
  petWindow.on('move', () => {
    // 程序化调整（setSize/setPosition）产生的 move 事件在时间戳窗口内直接忽略
    if (petWindow._skipMoveUntil && Date.now() < petWindow._skipMoveUntil) return;
    if (moveSaveTimer) clearTimeout(moveSaveTimer);
    moveSaveTimer = setTimeout(() => {
      if (petWindow.isDestroyed()) return;
      const { width: screenW, height: screenH } = screen.getPrimaryDisplay().bounds;
      const bounds = petWindow.getBounds();
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

  apiClient = new ApiClient(
    { getAll: getConfig },
    chatManager,
    statsTracker,
    personalityManager,
    ollamaProvider
  );

  registerIpcHandlers({
    getPetWindow: () => petWindow,
    getChatManager: () => chatManager,
    getModelServer: () => modelServer,
    getPersonalityManager: () => personalityManager,
    getOllamaProvider: () => ollamaProvider,
    getNoticeManager: () => noticeManager,
    getLifeTagsManager: () => lifeTagsManager,
    getPetDrag: () => petDragController,
    startMousePoller: () => {
      if (!mousePoller) {
        mousePoller = new MousePoller(petWindow, { intervalMs: 50 });
        mousePoller.start();
      }
      if (!gamepadPoller) {
        gamepadPoller = new GamepadPoller(petWindow);
        gamepadPoller.start();
      }
    },
    stopPollers: () => {
      if (mousePoller) { mousePoller.stop(); mousePoller = null; }
      if (gamepadPoller) { gamepadPoller.stop(); gamepadPoller = null; }
    },
    isLoopRunning: () => screenshotTimer !== null,
    startLoop,
    stopLoop,
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

function startLoop() {
  const config = getConfig();

  // Defensive: clear any existing loop to avoid duplicate timers
  stopLoop();

  idleDetector = new IdleDetector({
    threshold: 60,
    onIdleChange: (idle) => {
      statsTracker.setIdle(idle);
      if (controlWindow && !controlWindow.isDestroyed()) {
        controlWindow.webContents.send('main:status-change', idle ? 'idle' : 'running');
      }
    },
  });
  idleDetector.start();

  statsTracker.start();

  // 配置损坏或被人为改成 0 时不要退化成"疯狂截图"（会不停烧 API 额度）：夹在 1~600 秒
  const intervalSec = Math.min(600, Math.max(1, parseInt(config.screenshotInterval, 10) || 5));
  const intervalMs = intervalSec * 1000;
  runCycle();
  screenshotTimer = setInterval(runCycle, intervalMs);

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
let cycleIndex = 0;

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
    // 场景识别与台词共用同一次请求；sceneSampleEvery 抽样可降低识别频率（默认每张都识别）
    const every = Math.max(1, parseInt(getConfig().sceneSampleEvery, 10) || 1);
    cycleIndex += 1;
    const classifyScene = every === 1 || (cycleIndex - 1) % every === 0;

    const base64Image = await captureScreen({ displayId: getPetDisplayId() });
    const { reply, scene } = await apiClient.sendScreenshot(base64Image, { classifyScene });
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
