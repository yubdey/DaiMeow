// DaiMeow Pet Renderer
import * as PIXI from 'pixi.js';
import { Live2DModel, MotionPriority } from 'pixi-live2d-display';

const petAPI = window.petAPI;
const canvas = document.getElementById('petCanvas');
const speechBubble = document.getElementById('speech-bubble');
let speechTimer = null;
const MODEL_PATH = petAPI.getModelUrl('daimeow.model3.json');

const app = new PIXI.Application({
  view: canvas, width: window.innerWidth, height: window.innerHeight,
  transparent: true, backgroundAlpha: 0, antialias: true,
  resolution: window.devicePixelRatio || 1, autoDensity: true,
});

Live2DModel.registerTicker(PIXI.Ticker);
// 画面（模型内容）帧率上限。拖动顺滑与否取决于「窗口位置的更新节拍」，
// 那部分已交给渲染进程的 rAF（见下面拖动那段），所以这里维持在 45 帧省资源。
app.ticker.maxFPS = 45;
// 模型（含物理）的更新频率也压到同一档：pixi-live2d-display 把模型更新挂在
// PIXI.Ticker.shared 上，那个默认不限帧，在高刷屏上会按屏幕刷新率空转（本机 165Hz）。
// 模型更新用的是 deltaMS，所以限帧只是少算几次、动画速度不变。
PIXI.Ticker.shared.maxFPS = 45;

// 摘掉 PIXI 注册在 document / canvas 上的指针事件监听。
// 原因：pixi-live2d-display 依赖 @pixi/display@6，而应用用的是 pixi.js 7 —— 两套 PIXI 并存。
// PIXI 7 的命中测试会对 v6 的 Container 调 currentTarget.isInteractive()，而 v6 的
// Container 没有这个方法，于是鼠标每动一下就抛一次
// "TypeError: currentTarget.isInteractive is not a function"。
// 桌宠只用 Live2D 的绘制能力，不需要 PIXI 的交互能力，直接卸掉事件监听最干净。
app.renderer.events.setTargetElement(null);
let live2dModel = null;
let nativeW = 0, nativeH = 0;

// --- 待机动作 / 点击回应动作 ---
// 「坐下 / 站起」不是普通待机动作，而是两个互斥的持续状态（状态机见文件后半段）。
// 它们也不对应动作曲线，走的是模型自带的坐姿开关：daimeow.cdi3.json 里有个叫「坐」的
// 参数 Param，expression1.exp3.json 把它置 1（身体整体下沉、两只脚原地不动）。
// 表情通道一旦设上就一直生效，正好满足「坐下以后保持坐姿」；站起 = 取消表情，Param 淡回 0。
const SIT_ACTION = 'sit';
const STAND_ACTION = 'stand_up';
const SIT_EXPRESSION = 'expression1';
// 这两个动作由表情通道实现，不在 model3.json 的 Motions 里
const EXPRESSION_ACTIONS = new Set([SIT_ACTION, STAND_ACTION]);

// 「啦啦啦」：跳这段动作时，手里的两个啦啦球会亮出来（球是独立 PNG，跟着左右手走，见 updateProps）
const CHEER_ACTION = 'cheer';
const CHEER_PROP_MS = 2300;      // 球露出来的时长，和 cheer.motion3.json 的 2.35s 对齐
const PROP_CANVAS_SIZE = 460;    // 球的直径，按模型画布像素计（会和模型一起缩放）

// 「吃一片薯片 / 吃两片薯片」：袋子 / 两只手 / 单片薯片都是外部 PNG，位置每帧由模型手部中点算出来。
// 单次节奏按 55 帧 GIF 量过；双片动作连续播放同一套两轮。
const CHIPS_ACTION = 'eat_chips';
const CHIPS_TWO_ACTION = 'eat_two_chips';
const CHIPS_CYCLE_MS = 1650;       // 一轮时长，和参考 GIF 的 55 帧 × 30ms 对齐
const CHIPS_TWO_SECOND_START_MS = 1350;  // 第二片开始时刻，缩短两片之间的停顿
const CHIPS_CYCLE_START_MS = 0;
const PART_HANDS = 'shou';         // 模型里两只手所属的部件 id
const CHIPS_BAG_W = 850;           // 袋子图片宽度（画布像素）
const CHIPS_HAND_W = 369;          // 手部素材宽度 = 模型原爪 1:1（原生分辨率提取）
const CHIPS_CHIP_W = 200;          // 单片薯片宽度
const CHIPS_BAG_ANCHOR = [10, 0];  // 袋子中心相对两只模型手的中点
const CHIPS_BAG_ROT = -2;
const CHIPS_LEFT_HAND_OFFSET = [-220, -120];  // 左手在袋口左侧
const CHIPS_RIGHT_HAND_OFFSET = [220, 115];   // 右手扶在袋子右下角
const CHIPS_CHIP_FROM_BAG = [-44, -136];      // 薯片从袋口出现时的位置
// 一轮内的关键帧（t = 0~1 的比例；手部位移单位 = 画布像素，y 向下为正）。
// 数据按 GIF 55 帧逐帧测得：左手只做小幅提放，单片薯片独立沿弧线送到嘴边。
const CHIPS_KEY = [
  { t: 0.00, handX: 0,  handY: 0,    handRot: 0,  chip: 0, chipX: 0,   chipY: 0,    chipRot: 0 },
  { t: 0.20, handX: 0,  handY: 0,    handRot: 0,  chip: 0, chipX: 0,   chipY: 0,    chipRot: 0 },
  { t: 0.24, handX: 12, handY: -15,  handRot: -2, chip: 0, chipX: 0,   chipY: 0,    chipRot: 0 },
  { t: 0.30, handX: 28, handY: -56,  handRot: -4, chip: 1, chipX: -23, chipY: -75,  chipRot: -3 },
  { t: 0.36, handX: 34, handY: -90,  handRot: -6, chip: 1, chipX: -34, chipY: -160, chipRot: -5 },
  { t: 0.41, handX: 36, handY: -103, handRot: -7, chip: 1, chipX: -39, chipY: -196, chipRot: -5 },
  { t: 0.45, handX: 40, handY: -96,  handRot: -6, chip: 1, chipX: -40, chipY: -198, chipRot: -4 },
  { t: 0.51, handX: 35, handY: -65,  handRot: -4, chip: 0, chipX: -37, chipY: -172, chipRot: -3 },
  { t: 0.60, handX: 17, handY: -28,  handRot: -2, chip: 0, chipX: 0,   chipY: 0,    chipRot: 0 },
  { t: 0.70, handX: 2,  handY: -7,   handRot: 0,  chip: 0, chipX: 0,   chipY: 0,    chipRot: 0 },
  { t: 1.00, handX: 0,  handY: 0,    handRot: 0,  chip: 0, chipX: 0,   chipY: 0,    chipRot: 0 },
];


// 「抱小猪」：小猪身体和小猪两侧的贴图手都是外部 PNG，位置由模型手部顶点算出来。
// 参考 GIF 17 帧 × 30ms 循环：小猪和头部轻轻上下蹭，左右前爪交替抬起/放下，形成抱住摇晃的感觉。
const PIG_ACTION = 'hold_pig';
const PIG_PROP_MS = 2040;         // 2.04s = 4 轮 GIF 循环，每轮 0.51s
const PIG_FADE_MS = 360;          // 开场/收尾淡入淡出
const PIG_CYCLE_MS = 510;         // 一轮时长，和参考 GIF 的 17 帧 × 30ms 对齐
const PIG_W = 620;                // 小猪图片宽度（画布像素）
const PIG_HAND_W = 369;           // 抱猪时贴图手的宽度 = 模型原爪 1:1
const PIG_PAW_SEP = 820;          // 两只贴图手中心的距离
const PIG_PAW_Y = 0;             // 贴图手中心在基准手部中心下方一点
const PIG_BASE_X = -220;                // 抱猪整体相对身体中心略微左移，贴近参考图
const PIG_ENTER_DROP = 120;        // 进入时小猪先位于手部中点下方一点，再抬到抱持位置
const PIG_CENTER_OFFSET = [18, -70]; // 小猪中心相对两只手中点的偏移
const PIG_MOTION_SCALE = 2.92;  // 把 GIF 的手部像素位移换算到 DaiMeow 画布单位
const PIG_ROT_GAIN = 0.65;        // 小猪整体倾斜跟随两只手的连线
// 17 帧的手部相对位置：[左手 x, 左手 y, 右手 x, 右手 y]；数据来自 GIF 逐帧测量
const PIG_PAW_KEYS = [
  [0, 0, 0, 0],
  [2.4, 10.6, -1.5, -13.2],
  [7.9, 13.4, -6.0, -28.8],
  [14.9, 17.1, -11.0, -44.1],
  [20.6, 18.9, -15.1, -55.1],
  [21.5, 17.7, -15.1, -57.2],
  [20.9, 13.7, -12.7, -51.2],
  [18.3, 10.6, -8.6, -39.4],
  [15.6, -1.5, -5.4, -25.7],
  [14.8, -13.6, -4.2, -12.7],
  [17.8, -26.7, -7.8, 1.6],
  [22.4, -40.8, -12.3, 7.9],
  [26.9, -51.8, -17.4, 14.5],
  [28.6, -56.4, -20.4, 19.4],
  [25.2, -51.8, -19.0, 19.9],
  [18.4, -39.9, -13.5, 15.9],
  [9.5, -24.3, -7.6, 11.0],
];


// 「玩游戏」：手柄和两只手都是外部 PNG；模型只做呼吸和轻微摆动，眼珠不跟随摇动。
const GAMEPAD_ACTION = 'play_game';
const GAMEPAD_PROP_MS = 2340;      // 3 轮，每轮 780ms
const GAMEPAD_FADE_MS = 300;
const GAMEPAD_CYCLE_MS = 780;      // 参考 GIF 的 26 帧 × 30ms
const GAMEPAD_W = 651;             // 手柄图片宽度（画布像素）
const GAMEPAD_HAND_W = 369;        // 与模型原手 1:1
const GAMEPAD_PAW_SEP = 700;       // 两只手中心距离
const GAMEPAD_PAW_Y = 0;
const GAMEPAD_CENTER_OFFSET = [0, -20];
const GAMEPAD_ENTER_DROP = 110;
// 站起状态的待机池：原有全部动作（点头 摇头 看左 看右 抬头 低头 耳朵抖动1 耳朵抖动2 开心 惊讶 难过 啦啦啦）
const STAND_IDLE_ACTION_NAMES = [
  'nod', 'shake_head', 'look_left', 'look_right', 'look_up', 'look_down',
  'blink', 'ear_twitch', 'happy', 'surprised', 'sad', CHEER_ACTION, PIG_ACTION, GAMEPAD_ACTION,
  CHIPS_ACTION, CHIPS_TWO_ACTION,
];

// 坐下状态的待机池：按动作表保留坐姿可做动作（含抱小猪 / 玩游戏 / 吃薯片）
const SIT_IDLE_ACTION_NAMES = [
  'nod', 'shake_head', 'look_left', 'look_right', 'look_up', 'look_down',
  'blink', 'ear_twitch', PIG_ACTION, GAMEPAD_ACTION, CHIPS_ACTION, CHIPS_TWO_ACTION,
];
// 点击回应池：按动作表配置；坐下时会再按坐姿池过滤
const CLICK_ACTION_NAMES = ['nod', 'shake_head', 'blink', 'ear_twitch', 'happy', 'surprised', 'sad', CHEER_ACTION, PIG_ACTION, GAMEPAD_ACTION, CHIPS_ACTION, CHIPS_TWO_ACTION];

// 待机动作的随机间隔（毫秒）
const IDLE_ACTION_MIN_MS = 5000;
const IDLE_ACTION_MAX_MS = 15000;
// 连点保护：两次点击回应至少隔这么久
const CLICK_REACT_COOLDOWN_MS = 350;

// 站姿 / 坐姿状态：进入一个状态后至少维持这么久，到点再按权重掷下一次
const STATE_STAND = 'stand';
const STATE_SIT = 'sit';
const STATE_MIN_MS = 60000;
const STATE_MAX_MS = 120000;
// 掷到坐下的概率（剩下 70% 掷站起）
const SIT_STATE_WEIGHT = 0.3;

const actionPools = { idleStand: [], idleSit: [], click: [], clickSit: [] };
// 动作名 → [分组, 序号]，分组与序号都取自 model3.json 里登记的 Motions
const motionByName = new Map();
// 记住上一次播的动作名，避免连着重复（引擎也会拒绝「同一动作正在播」）
const lastPlayed = { idle: null, click: null };

// --- 啦啦球（外部 PNG 跟随左右手）---
const propLeft = document.getElementById('prop-left');
const propRight = document.getElementById('prop-right');
const propChips = document.getElementById('prop-chips');
const propPig = document.getElementById('prop-pig');
const propGamepad = document.getElementById('prop-gamepad');
const propHandLeft = document.getElementById('prop-hand-left');
const propHandRight = document.getElementById('prop-hand-right');
const propChip = document.getElementById('prop-chip');
const propSrcPoint = new PIXI.Point();   // 画布坐标（输入）
const propDstPoint = new PIXI.Point();   // 窗口坐标（输出），复用避免每帧新建
let pawDrawables = null;                 // [左手, 右手] 的 drawable 序号；解析不到就为 null
let propUntil = 0;                       // 球显示到什么时候（performance.now() 毫秒）
let chipsStartAt = 0;                    // 吃薯片动作开始时刻（0 = 没在播）
let chipsCycles = 0;                     // 当前吃薯片动作包含几轮
let pigStartAt = 0;                      // 抱小猪动作开始时刻（0 = 没在播）
let gamepadStartAt = 0;                  // 玩游戏动作开始时刻（0 = 没在播）
/** 当前吃薯片动作应展示道具的总时长。 */
function chipsPlaybackMs() {
  if (chipsCycles === 2) return CHIPS_TWO_SECOND_START_MS + CHIPS_CYCLE_MS;
  return CHIPS_CYCLE_MS;
}
// 程序始终维护当前站姿状态；模型没有坐姿表情时会退化成常站（见 buildActionPools）
let currentState = STATE_STAND;
let canSit = true;
let idleActionTimer = null;
let stateTimer = null;
let lastReactAt = 0;

// --- Mouse / Gamepad state ---
let targetX = 0, targetY = 0;
let currentX = 0, currentY = 0;
let gamepadTimeout = 0;

// --- Layout state (lerped for smooth transitions) ---
let targetScale = 0, currentScale = 0;
let targetCX = 0, targetCY = 0;
let currentCX = 0, currentCY = 0;

// --- Fixed state ---
let isFixed = false;
// 窗口是否真的显示着。document.hidden 在窗口从未显示过时不会翻转（实测），
// 所以待机动画用主进程下发的显式信号，初始值按"隐藏"算。
let isWindowVisible = false;

// --- Load model ---
async function loadModel() {
  try {
    live2dModel = await Live2DModel.from(MODEL_PATH, { autoInteract: false });
    nativeW = live2dModel.width;
    nativeH = live2dModel.height;
    live2dModel.anchor.set(0.5, 0.5);
    app.stage.addChild(live2dModel);
    applyLayout(true); // snap on load
    installHandsTicker();
    buildActionPools();
    scheduleIdleAction();
    scheduleStateSwitch();
    petAPI.notifyReady(app.screen.width, app.screen.height);
  } catch (err) {
    console.error('Model load failed:', err.message, err.stack);
    petAPI.logError('Model load: ' + err.message);
    document.body.insertAdjacentHTML('beforeend',
      '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:80px;pointer-events:none;position:fixed;top:0;left:0">🐱</div>');
    petAPI.notifyReady(window.innerWidth, window.innerHeight);
  }
}

// --- Layout: compute target scale/position from screen size ---
// snap=true: apply instantly (used on model load)
// snap=false: set targets for smooth lerp in ticker (used on resize)
function applyLayout(snap) {
  if (!live2dModel || nativeW === 0) return;
  const w = app.screen.width;
  const h = app.screen.height;
  if (w === 0 || h === 0) return;
  targetScale = Math.min(w / nativeW, h / nativeH);
  targetCX = w / 2;
  targetCY = h / 2;
  if (snap) {
    currentScale = targetScale;
    currentCX = targetCX;
    currentCY = targetCY;
    live2dModel.scale.set(currentScale);
    live2dModel.x = currentCX;
    live2dModel.y = currentCY;
  }
}

// --- IPC handlers ---
petAPI.onMousePosition((pos) => {
  if (Date.now() < gamepadTimeout) return;
  targetX = pos.relX;
  targetY = -pos.relY;
});
petAPI.onGamepadPosition((pos) => {
  targetX = pos.relX;
  targetY = pos.relY;
  gamepadTimeout = Date.now() + 500;
});

// --- 手柄探测（手柄支持默认关闭，主进程开关打开且已启动时才会下发探测）---
// 用 Chromium 自带的 Gamepad API 判断有没有插手柄：浏览器原生枚举设备，不需要额外进程。
// 只有真的探到手柄，主进程才会去起 XInput 轮询（那个轮询是常驻 PowerShell）。
let gamepadProbeTimer = null;
let gamepadFound = false;

function probeGamepads() {
  try {
    const pads = navigator.getGamepads ? navigator.getGamepads() : null;
    const has = !!pads && Array.prototype.some.call(pads, (p) => p && p.connected);
    if (has !== gamepadFound) {
      gamepadFound = has;
      petAPI.reportGamepadPresence(has);
    }
  } catch (err) {
    // 探测失败就当作没手柄，不影响其它功能
  }
}

petAPI.onGamepadProbe((enabled) => {
  if (gamepadProbeTimer) {
    clearInterval(gamepadProbeTimer);
    gamepadProbeTimer = null;
  }
  if (!enabled) {
    gamepadFound = false;
    return;
  }
  probeGamepads();  // 先立刻探一次，别等 2 秒
  gamepadProbeTimer = setInterval(probeGamepads, 2000);
});

// 气泡每行显示的字数
const CHARS_PER_LINE = 7;
// 字号 13px，中文字宽按 ~15px 保守估算（含字体间距），加左右 padding 32px
const BUBBLE_MAX_W = Math.round(CHARS_PER_LINE * 15 + 32);
// 气泡与窗口左右边缘至少留出的空隙（跟下面 ticker 里的 pad 保持一致）
const BUBBLE_EDGE_PAD = 6;
// 气泡设计基准：1.0x 显示时窗口宽 200px（PET_BASE_W 400 × 0.5）
const BUBBLE_REF_WIN_W = 200;
// 等比缩小时的下限（再小就看不清了）
const BUBBLE_MIN_K = 0.7;

// 气泡尺寸缓存：读 offsetWidth / offsetHeight 会强制浏览器同步布局，而下面那个 ticker
// 回调每帧都跑（45 帧/秒），不能放在里面量。气泡宽度只受上面那个固定 maxWidth 约束、
// 跟窗口尺寸无关，所以「文案变了量一次」就够。
let bubbleSize = { w: 140, h: 0 };
function measureBubble() {
  bubbleSize = { w: speechBubble.offsetWidth || 140, h: speechBubble.offsetHeight || 0 };
}
measureBubble();

// 气泡的宽度上限与整体缩放只跟窗口宽度有关，所以窗口一变（改大小 / 调位置）就得重算，
// 否则气泡会停在出话那一刻的尺寸上，和已经变了的呆喵对不上。
// 记下上次应用的值：拖动时窗口会有 ±1px 的取整抖动，没变就不重复处理。
let bubbleAppliedMaxW = 0;
let bubbleAppliedK = 0;
/** @returns {boolean} 样式是否真的变了 */
function layoutBubble() {
  const winW = app.screen.width || window.innerWidth || BUBBLE_REF_WIN_W;
  const avail = winW - BUBBLE_EDGE_PAD * 2;
  // 窗口比设计宽度还窄时，用窗口宽兜底（否则会被压成一条竖排文字）
  const maxW = Math.min(BUBBLE_MAX_W, Math.max(72, avail));
  // 同理，装不下就连字号/内衬一起等比缩，下限 0.7
  const k = Number((avail < BUBBLE_MAX_W ? Math.max(BUBBLE_MIN_K, winW / BUBBLE_REF_WIN_W) : 1).toFixed(3));
  if (maxW === bubbleAppliedMaxW && k === bubbleAppliedK) return false;
  bubbleAppliedMaxW = maxW;
  bubbleAppliedK = k;
  speechBubble.style.maxWidth = maxW + 'px';
  speechBubble.style.setProperty('--bubble-k', String(k));
  return true;
}

petAPI.onShowSpeech((text) => {
  speechBubble.textContent = text;
  layoutBubble();   // 按当前窗口宽度定宽 + 定缩放
  measureBubble();  // 文案变了，尺寸必须重量（贴头位置和夹取都用这个缓存）
  speechBubble.classList.add('show');
  if (speechTimer) clearTimeout(speechTimer);
  speechTimer = setTimeout(() => speechBubble.classList.remove('show'), 6000);
});

petAPI.onResize((size) => {
  app.renderer.resize(size.w, size.h);
  applyLayout(false); // smooth transition
  // 气泡显示期间改大小：样式变了才重量，没变（拖动时的 ±1px 抖动）不做多余的强制布局
  if (layoutBubble()) measureBubble();
});
window.addEventListener('resize', () => {
  app.renderer.resize(window.innerWidth, window.innerHeight);
  applyLayout(false); // smooth transition
  if (layoutBubble()) measureBubble();
});

// --- Passthrough & fixed config ---
// 说明：原来是靠 CSS -webkit-app-region: drag 让系统拖动窗口，但「可拖动区域」会
// 吞掉全部鼠标事件，页面里永远收不到点击。桌宠需要「点一下有反应」，所以改成页面
// 自己实现拖动：按下时通知主进程开始跟手，松手时结束；位移很小则算一次点击。
petAPI.onFixedChanged((enabled) => { isFixed = enabled; });
petAPI.onVisibilityChanged((visible) => { isWindowVisible = visible; });

// 按下后位移超过这个像素数就算拖动，否则算点击
const CLICK_MOVE_TOLERANCE = 4;
const CLICK_MAX_DURATION_MS = 500;
let pointerState = null;

// 注意：canvas 设了 pointer-events:none（见 index.html），鼠标事件由 body/document 接收。
// 这样做是为了不让画布事件进入 PIXI 的事件系统：pixi-live2d-display 与 PIXI 7 的命中测试
// 不兼容（hitTestRecursive 里调 currentTarget.isInteractive() 会抛 "is not a function"），
// 鼠标一动就刷一堆报错。桌宠本来就不需要 PIXI 的交互能力。
let pointerCaptureEl = null;

// 拖动跟手的节拍由渲染进程的 rAF 驱动（每帧让主进程按当前光标重新摆一次窗口）。
// 原因：主进程自己的 setInterval 被 Windows 计时节拍（约 15.6ms）卡住，窗口位置只能
// 每 15.6ms 变一次，而屏幕是 165Hz —— 位移落在 2 帧/3 帧之间来回跳，拖动就会发顿。
// rAF 跟屏幕刷新对齐，位移才均匀。主进程保留了低频兜底，渲染进程停摆也不会卡住。
let dragFrameHandle = null;
function startDragFrames() {
  if (dragFrameHandle !== null) return;
  const step = () => {
    petAPI.tickPetDrag();
    dragFrameHandle = requestAnimationFrame(step);
  };
  dragFrameHandle = requestAnimationFrame(step);
}
function stopDragFrames() {
  if (dragFrameHandle !== null) {
    cancelAnimationFrame(dragFrameHandle);
    dragFrameHandle = null;
  }
}

document.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  pointerState = { x: e.screenX, y: e.screenY, t: performance.now(), dragged: false };
  // 固定位置模式下主进程会忽略这次拖动请求
  if (!isFixed) {
    petAPI.beginPetDrag();
    startDragFrames();
  }
  // 捕获指针：拖动时窗口跟着光标走，光标可能移出窗口，捕获后仍能收到 pointerup
  pointerCaptureEl = e.target instanceof Element ? e.target : document.documentElement;
  try { pointerCaptureEl.setPointerCapture(e.pointerId); } catch (err) { /* 忽略 */ }
});

document.addEventListener('pointermove', (e) => {
  if (!pointerState || pointerState.dragged) return;
  const dx = e.screenX - pointerState.x;
  const dy = e.screenY - pointerState.y;
  if (Math.sqrt(dx * dx + dy * dy) > CLICK_MOVE_TOLERANCE) pointerState.dragged = true;
});

function endPointerGesture(e) {
  if (!pointerState) return;
  const state = pointerState;
  pointerState = null;
  petAPI.endPetDrag();
  stopDragFrames();
  if (pointerCaptureEl) {
    try { pointerCaptureEl.releasePointerCapture(e.pointerId); } catch (err) { /* 忽略 */ }
    pointerCaptureEl = null;
  }
  // 基本没动 + 时间够短 → 当成一次点击，回一个随机动作
  if (!state.dragged && performance.now() - state.t < CLICK_MAX_DURATION_MS) reactToClick();
}

document.addEventListener('pointerup', endPointerGesture);
document.addEventListener('pointercancel', endPointerGesture);

// 右键 → 调整菜单（尺寸 / 固定位置 / 鼠标穿透 / 置顶 / 退出）。
// 菜单由主进程原生弹出，这里只负责拦掉默认菜单并发个通知。
document.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  petAPI.openContextMenu();
});

// --- Animation loop ---
const MOUSE_SMOOTH = 0.12;
const LAYOUT_SMOOTH = 0.08;

app.ticker.add(() => {
  if (!live2dModel) return;

  // Head tracking
  currentX += (targetX - currentX) * MOUSE_SMOOTH;
  currentY += (targetY - currentY) * MOUSE_SMOOTH;
  live2dModel.internalModel.focusController.x = currentX;
  live2dModel.internalModel.focusController.y = currentY;

  // Layout lerp (scale + position)
  currentScale += (targetScale - currentScale) * LAYOUT_SMOOTH;
  currentCX += (targetCX - currentCX) * LAYOUT_SMOOTH;
  currentCY += (targetCY - currentCY) * LAYOUT_SMOOTH;
  live2dModel.scale.set(currentScale);
  live2dModel.x = currentCX;
  live2dModel.y = currentCY;

  // 啦啦球：贴到左右手上（必须在 scale/position 更新之后算）
  updateProps(performance.now());


  // Speech bubble — positioned above model head, clamped within window
  const winW = app.screen.width;
  const pad = 6;

  // 尺寸走缓存（见 measureBubble），这里不再读 offsetWidth/offsetHeight，避免每帧强制布局
  const { w: bubbleW, h: bubbleH } = bubbleSize;

  const headTop = currentCY - (nativeH * currentScale) / 2;
  const bubbleTop = headTop - bubbleH - pad;

  // Horizontal: center over model, clamped to window
  const leftMin = bubbleW / 2 + pad;
  const leftMax = winW - bubbleW / 2 - pad;
  const bubbleLeft = Math.max(leftMin, Math.min(currentCX, leftMax));

  // Vertical: above head, clamped
  const topClamped = Math.max(pad, bubbleTop);

  // 水平位置走 transform，不用 left：fixed 元素的可用宽度 = 视口宽 - left，
  // 一旦 left 偏右，剩下的宽度不够就会把文字压成一列竖排（窗口小的时候必现）。
  // 用 transform 平移则布局宽度始终按整窗计算，换行只受 maxWidth 控制。
  speechBubble.style.transform = `translateX(calc(-50% + ${bubbleLeft}px))`;
  speechBubble.style.top = topClamped + 'px';
});

loadModel();

/* ---------------- 动作：待机随机动作 + 点击回应 ---------------- */

/**
 * 把动作名解析成池子里的候选项。
 * 动作曲线的分组与顺序都取自 model3.json 里登记的 Motions，不写死索引，
 * 以后在 model3.json 里调整动作顺序也不会失效；坐/站不可用时自动从池子里去掉。
 */
function buildActionPools() {
  const defs = (live2dModel && live2dModel.internalModel.motionManager.definitions) || {};
  motionByName.clear();
  for (const group of Object.keys(defs)) {
    defs[group].forEach((def, index) => {
      const file = String(def.File).split('/').pop();
      motionByName.set(file.replace('.motion3.json', ''), [group, index]);
    });
  }
  const expressions = availableExpressionActions();
  const available = (name) => (EXPRESSION_ACTIONS.has(name) ? expressions.has(name) : motionByName.has(name));
  actionPools.idleStand = STAND_IDLE_ACTION_NAMES.filter(available);
  actionPools.idleSit = SIT_IDLE_ACTION_NAMES.filter(available);
  actionPools.click = CLICK_ACTION_NAMES.filter(available);
  // 坐着的时候点击也只会做坐姿做得出来的动作（避免坐着突然摇摆/前倾）
  actionPools.clickSit = actionPools.click.filter((name) => SIT_IDLE_ACTION_NAMES.includes(name));

  const missing = STAND_IDLE_ACTION_NAMES.filter((n) => !available(n));
  if (missing.length) petAPI.logError('待机动作缺失: ' + missing.join(', '));
  const missingSit = SIT_IDLE_ACTION_NAMES.filter((n) => !available(n));
  if (missingSit.length) petAPI.logError('坐姿动作缺失: ' + missingSit.join(', '));

  // 坐姿是靠表情通道实现的，模型里没有这个表情就只能一直站着，别去反复尝试
  canSit = expressions.has(SIT_ACTION) && expressions.has(STAND_ACTION);
  if (!canSit) currentState = STATE_STAND;

  // 啦啦球要贴的位置：左右爪
  pawDrawables = resolvePawDrawables();
  if (!pawDrawables) petAPI.logError('啦啦球：没找到左右手的 drawable，跳啦啦啦时不会显示球');
}

/** 模型里真正可用的「表情通道动作」（坐下 / 站起） */
function availableExpressionActions() {
  const available = new Set();
  try {
    const em = live2dModel.internalModel.motionManager.expressionManager;
    if (!em) return available;
    available.add(STAND_ACTION); // 站起只是取消表情，不需要额外的表情文件
    if ((em.definitions || []).some((def) => def.Name === SIT_EXPRESSION)) available.add(SIT_ACTION);
  } catch (err) {
    petAPI.logError('表情通道不可用: ' + err.message);
  }
  return available;
}

/** 引擎当前是否还在播动作 */
function isMotionPlaying() {
  try {
    const mm = live2dModel.internalModel.motionManager;
    return mm.isFinished ? !mm.isFinished() : false;
  } catch (err) {
    return false;
  }
}

/** 普通动作按当前状态选池子：站起状态用原有全部动作，坐下状态只有坐姿友好的那几个 */
function poolForCurrentState(poolName) {
  if (poolName === 'idle') return currentState === STATE_SIT ? actionPools.idleSit : actionPools.idleStand;
  if (poolName === 'click') return currentState === STATE_SIT ? actionPools.clickSit : actionPools.click;
  return actionPools[poolName];
}

/** 从指定动作池里随机挑一个播（避免与上一次重复） */
function playRandomAction(poolName, priority) {
  const pool = poolForCurrentState(poolName);
  if (!pool || pool.length === 0 || !live2dModel) return;

  const previous = lastPlayed[poolName];
  let candidates = pool;
  if (pool.length > 1 && previous) {
    const filtered = pool.filter((n) => n !== previous);
    if (filtered.length) candidates = filtered;
  }
  const picked = candidates[Math.floor(Math.random() * candidates.length)];
  lastPlayed[poolName] = picked;
  playAction(picked, priority);
}

/**
 * 把动作播出去：动作曲线交给引擎的动作播放，坐/站交给表情通道。
 * 坐/站只是「摆姿势」，当前处于哪个状态由状态机（scheduleStateSwitch）说了算。
 */
function playAction(name, priority) {
  if (name === SIT_ACTION) {
    setSitPose(true);
    return;
  }
  if (name === STAND_ACTION) {
    setSitPose(false);
    return;
  }
  const motion = motionByName.get(name);
  if (motion) {
    // 新动作开始前清掉上一套外部道具，避免动作切换时残留
    propUntil = 0;
    chipsStartAt = 0;
    chipsCycles = 0;
    pigStartAt = 0;
    gamepadStartAt = 0;
    // 啦啦啦：跳的时候把两个啦啦球亮出来（球的位置由 updateProps 每帧贴到手上）
    if (name === CHEER_ACTION) propUntil = performance.now() + CHEER_PROP_MS;
    // 吃薯片：记下开始时刻和轮数，之后由 updateProps 每帧摆放袋子 / 双手 / 单片薯片
    if (name === CHIPS_ACTION || name === CHIPS_TWO_ACTION) {
      chipsCycles = name === CHIPS_TWO_ACTION ? 2 : 1;
      chipsStartAt = performance.now();
    }
    // 抱小猪：记下开始时刻，之后由 updateProps 每帧摆放小猪 / 双手
    if (name === PIG_ACTION) pigStartAt = performance.now();
    // 玩游戏：记下开始时刻，之后由 updateProps 每帧摆放手柄 / 双手
    if (name === GAMEPAD_ACTION) gamepadStartAt = performance.now();
    live2dModel.motion(motion[0], motion[1], priority);
  }
}

/**
 * 坐下 / 站起都走引擎的表情通道。
 * expression1 就是模型自带的坐姿开关：它把 daimeow.cdi3.json 里叫「坐」的参数 Param 置 1
 * （身体整体下沉、两只脚原地不动）。表情一旦设上就会一直生效，正好满足「坐下之后保持坐姿」；
 * 站起 = 取消表情，Param 淡回 0。这条通道与动作曲线互不干扰，所以坐着也能照常点头、抖耳朵。
 *
 * 注意不能拿 model.expression() 的返回值判断成败：库里 setExpression 在「要设的表情已经是
 * 当前表情」时会直接 return false 空跑，而 resetExpression() 并不会清掉「当前表情」这个指针 ——
 * 站起之后再坐下必然踩中这条短路，坐下的动作就丢了。所以这里先看表情加载过没有：
 * 加载过就直接重新应用（restoreExpression 走的就是这条路），没加载过才交给库异步加载 + 应用。
 */
function setSitPose(sitting) {
  const expressionManager = live2dModel.internalModel.motionManager.expressionManager;
  if (!expressionManager) return;

  if (!sitting) {
    expressionManager.resetExpression();
    return;
  }

  const index = expressionManager.getExpressionIndex(SIT_EXPRESSION);
  if (index < 0) return;
  if (expressionManager.expressions[index]) {
    expressionManager.restoreExpression();
    return;
  }

  Promise.resolve()
    .then(() => expressionManager.setExpression(SIT_EXPRESSION))
    .then((ok) => {
      if (!ok) petAPI.logError('坐下失败: 表情 ' + SIT_EXPRESSION + ' 未能加载');
    })
    .catch((err) => petAPI.logError('坐下失败: ' + (err && err.message)));
}

/* ---------------- 啦啦球：外部 PNG 跟随左右手 ---------------- */

/**
 * 找出左右爪各自对应的 drawable 序号。
 * 模型里两只手是部件 "shou"（手）下的两个 ArtMesh，这里按部件找、再按重心 x 分左右，
 * 不写死 ArtMesh / ArtMesh2 这两个名字，以后重做模型或改名也不会失效。
 */
function resolvePawDrawables() {
  try {
    const internal = live2dModel.internalModel;
    const core = internal.coreModel.getModel();
    const partIds = [];
    for (let i = 0; i < core.parts.count; i++) partIds.push(core.parts.ids[i]);
    const handPart = partIds.indexOf('shou');
    let idx = [];
    if (handPart >= 0) {
      for (let i = 0; i < core.drawables.count; i++) {
        if (core.drawables.parentPartIndices[i] === handPart) idx.push(i);
      }
    }
    if (idx.length !== 2) {
      // 兜底：按这个模型当前的名字找
      idx = ['ArtMesh', 'ArtMesh2'].map((id) => core.drawables.ids.indexOf(id)).filter((i) => i >= 0);
    }
    if (idx.length !== 2) return null;
    const centers = idx.map((i) => {
      const v = internal.getDrawableVertices(i);
      let x = 0;
      for (let k = 0; k < v.length; k += 2) x += v[k];
      return x / (v.length / 2);
    });
    return centers[0] <= centers[1] ? idx : [idx[1], idx[0]];
  } catch (err) {
    petAPI.logError('找不到手部 drawable: ' + err.message);
    return null;
  }
}

/**
 * 两只手在窗口里的中心点：[[左手 x, y], [右手 x, y]]。
 * 顶点用引擎给的 getDrawableVertices（画布像素），再用 PIXI 的 toGlobal 换成窗口像素 ——
 * 缩放、位置、锚点都由 PIXI 算，模型怎么缩放/移动，道具都跟着手走。
 */
function pawCentersOnScreen() {
  try {
    const internal = live2dModel.internalModel;
    return pawDrawables.map((d) => {
      const v = internal.getDrawableVertices(d);
      let sx = 0, sy = 0;
      for (let k = 0; k < v.length; k += 2) {
        sx += v[k];
        sy += v[k + 1];
      }
      const n = v.length / 2;
      propSrcPoint.set(sx / n, sy / n);
      live2dModel.toGlobal(propSrcPoint, propDstPoint);
      return [propDstPoint.x, propDstPoint.y];
    });
  } catch (err) {
    return null;
  }
}

/* ---------------- 吃薯片：姿势求值 + 藏手 ---------------- */

/**
 * 吃薯片这一帧的姿势。每个动作周期对应 GIF 的一轮，
 * 一轮结束后回到中性姿势再收尾。
 * 关键帧之间用 Catmull-Rom 样条插值（位移连续、没有折角），时间比例用 easeInOutSine 控制快慢。
 */
function eatChipsPose(now) {
  const neutral = {
    handX: 0, handY: 0, handRot: 0,
    chip: 0, chipX: 0, chipY: 0, chipRot: 0,
  };
  const elapsed = now - chipsStartAt;
  if (!chipsStartAt || elapsed < 0 || elapsed >= chipsPlaybackMs()) return neutral;
  const cycleElapsed = chipsCycles === 2 && elapsed >= CHIPS_TWO_SECOND_START_MS
    ? elapsed - CHIPS_TWO_SECOND_START_MS
    : elapsed - CHIPS_CYCLE_START_MS;
  const u = cycleElapsed / CHIPS_CYCLE_MS;
  const keys = CHIPS_KEY;
  let a = keys[0], b = keys[keys.length - 1];
  for (let i = 1; i < keys.length; i++) {
    if (u <= keys[i].t) { a = keys[i - 1]; b = keys[i]; break; }
  }
  const span = b.t - a.t;
  const k = span <= 0 ? 1 : (u - a.t) / span;
  const e = -(Math.cos(Math.PI * k) - 1) / 2;
  const i2 = keys.indexOf(b);
  const p0 = keys[Math.max(0, i2 - 2)], p1 = a, p2 = b, p3 = keys[Math.min(keys.length - 1, i2 + 1)];
  const cr = (v0, v1, v2, v3) => 0.5 * ((2 * v1) + (-v0 + v2) * e
    + (2 * v0 - 5 * v1 + 4 * v2 - v3) * e * e
    + (-v0 + 3 * v1 - 3 * v2 + v3) * e * e * e);
  return {
    handX: cr(p0.handX, p1.handX, p2.handX, p3.handX),
    handY: cr(p0.handY, p1.handY, p2.handY, p3.handY),
    handRot: cr(p0.handRot, p1.handRot, p2.handRot, p3.handRot),
    chip: p1.chip + (p2.chip - p1.chip) * e,   // 薯片透明度：平滑淡入淡出
    chipX: cr(p0.chipX, p1.chipX, p2.chipX, p3.chipX),
    chipY: cr(p0.chipY, p1.chipY, p2.chipY, p3.chipY),
    chipRot: cr(p0.chipRot, p1.chipRot, p2.chipRot, p3.chipRot),
  };
}


/** 从 17 帧循环数据中取一帧并做周期 Catmull-Rom 插值（抱小猪用）。 */
function samplePigLoop(u) {
  const keys = PIG_PAW_KEYS;
  const n = keys.length;
  const pos = (((u % 1) + 1) % 1) * n;
  const i = Math.floor(pos);
  const f = pos - i;
  const k0 = keys[(i - 1 + n) % n];
  const k1 = keys[i % n];
  const k2 = keys[(i + 1) % n];
  const k3 = keys[(i + 2) % n];
  const e = f * f * (3 - 2 * f);
  const cr = (v0, v1, v2, v3) => 0.5 * ((2 * v1) + (-v0 + v2) * e
    + (2 * v0 - 5 * v1 + 4 * v2 - v3) * e * e
    + (-v0 + 3 * v1 - 3 * v2 + v3) * e * e * e);
  return [0, 1, 2, 3].map((j) => cr(k0[j], k1[j], k2[j], k3[j]));
}

/** 抱小猪这一帧两只手的相对位移。 */
function pigPose(now) {
  const neutral = { lx: 0, ly: 0, rx: 0, ry: 0 };
  if (!pigStartAt) return neutral;
  const elapsed = now - pigStartAt;
  if (elapsed < 0 || elapsed >= PIG_PROP_MS) return neutral;
  const u = (elapsed % PIG_CYCLE_MS) / PIG_CYCLE_MS;
  const q = samplePigLoop(u).map((v) => v * PIG_MOTION_SCALE);
  return { lx: q[0], ly: q[1], rx: q[2], ry: q[3] };
}

/** 玩游戏时手柄和两只手的轻晃/按压轨迹：眼睛之外，手柄和手也会明显运动。 */
function gamepadPose(now) {
  const neutral = { px: 0, py: 0, rot: 0, scale: 1, lx: 0, ly: 0, rx: 0, ry: 0 };
  if (!gamepadStartAt) return neutral;
  const elapsed = now - gamepadStartAt;
  if (elapsed < 0 || elapsed >= GAMEPAD_PROP_MS) return neutral;
  const u = (elapsed % GAMEPAD_CYCLE_MS) / GAMEPAD_CYCLE_MS;
  const s = Math.sin(2 * Math.PI * u);
  const s2 = Math.sin(4 * Math.PI * u);
  const c2 = Math.cos(4 * Math.PI * u);
  const groupX = 55 * s + 8 * s2;
  const groupY = -34 * c2;
  return {
    px: groupX,
    py: groupY,
    rot: 6 * s,
    scale: 1 + 0.045 * c2,
    lx: groupX + 10 * s2,
    ly: groupY + 12 * s2,
    rx: groupX - 10 * s2,
    ry: groupY - 12 * s2,
  };
}

/** 抱小猪时贴图手在原位接管，模型自带手在动作期间保持隐藏。 */
function pigHandsOpacityAt(elapsed) {
  if (elapsed <= 0 || elapsed >= PIG_PROP_MS) return 1;
  // 贴图手与模型手同尺寸；进入时在原位接管，避免交叉淡化出现两双手重影。
  return 0;
}

/** 玩游戏中贴图手在模型手原位接管，模型自带手在动作期间隐藏。 */
function gamepadHandsOpacityAt(elapsed) {
  if (elapsed <= 0 || elapsed >= GAMEPAD_PROP_MS) return 1;
  return 0;
}

/** 模型自带的手的不透明度：开头淡出、收尾淡回（避免两只手同时出现或突然跳变） */
function handsOpacityAt(elapsed, totalMs = chipsPlaybackMs()) {
  if (elapsed <= 0 || elapsed >= totalMs) return 1;
  // 贴图手与模型原爪尺寸一致；进入时直接在原位置接管，避免交叉淡化出现两双手。
  return 0;
}

/**
 * 藏手 / 放手。写在 PIXI.Ticker.shared 的低优先级回调里 —— 模型自己的更新挂在同一个 ticker 的
 * 默认优先级上，这样能保证写在模型更新之后（框架里 setPartOpacityById 直接写 core 的 parts.opacities）。
 * 动作播完（或没在播）时统一恢复成 1，不会留下「手不见了」的残留状态。
 */
function installHandsTicker() {
  PIXI.Ticker.shared.add(() => {
    const now = performance.now();
    const chipsElapsed = chipsStartAt ? now - chipsStartAt : -1;
    const pigElapsed = pigStartAt ? now - pigStartAt : -1;
    const gamepadElapsed = gamepadStartAt ? now - gamepadStartAt : -1;
    if (chipsStartAt && chipsElapsed >= chipsPlaybackMs()) {
      chipsStartAt = 0;
      chipsCycles = 0;
    }
    if (pigStartAt && pigElapsed >= PIG_PROP_MS) pigStartAt = 0;
    if (gamepadStartAt && gamepadElapsed >= GAMEPAD_PROP_MS) gamepadStartAt = 0;
    const opacity = chipsStartAt
      ? handsOpacityAt(chipsElapsed)
      : (pigStartAt ? pigHandsOpacityAt(pigElapsed) : (gamepadStartAt ? gamepadHandsOpacityAt(gamepadElapsed) : 1));
    setHandsOpacity(opacity);
  }, null, PIXI.UPDATE_PRIORITY.LOW);
}

/** 把两只手所在的部件设成指定不透明度（1 = 模型自己的手，0 = 完全藏起来） */
function setHandsOpacity(value) {
  try {
    live2dModel.internalModel.coreModel.setPartOpacityById(PART_HANDS, value);
  } catch (err) {
    /* 拿不到部件就用模型自己的手，不影响动作 */
  }
}

/**
 * 道具贴图的显隐。
 *
 * 必须在这里连内联 opacity 一起归位：动画期间是直接写 el.style.opacity 的，
 * 而内联样式优先级高于 .prop / .prop.show 这两个类。所以「上一条道具动作被下一条
 * 道具动作打断」时（比如抱小猪还没播完就点出啦啦啦），只把类改回隐藏没用 ——
 * 内联那份不透明度依旧生效，贴图会一直留在屏幕上。
 * 修法：每个元素在「自己不可见」的那一帧就自己清理，不再依赖「四个道具全不可见」
 * 那个总清理分支（那条分支在别的道具正显示时根本不会执行，这正是残留的成因）。
 */
function setPropVisible(el, visible) {
  if (!el) return;
  const cls = visible ? 'prop show' : 'prop';
  if (el.className !== cls) el.className = cls;
  if (!visible && el.style.opacity !== '') el.style.opacity = '';
}

/**
 * 每帧摆放所有道具贴图：啦啦球贴左右手、薯片袋子/小猪/手柄跟着手走。
 * 球和手的位置由引擎的 getDrawableVertices + toGlobal 换算成窗口像素，
 * 所以模型怎么缩放/移动，道具都跟着走。
 */
function updateProps(now) {
  if (!pawDrawables) return;
  const ballsVisible = !!(propLeft && propRight) && now < propUntil;
  const chipsVisible = !!propChips && chipsStartAt > 0 && (now - chipsStartAt) < chipsPlaybackMs();
  const pigVisible = !!propPig && pigStartAt > 0 && (now - pigStartAt) < PIG_PROP_MS;
  const gamepadVisible = !!propGamepad && gamepadStartAt > 0 && (now - gamepadStartAt) < GAMEPAD_PROP_MS;

  setPropVisible(propLeft, ballsVisible);
  setPropVisible(propRight, ballsVisible);
  setPropVisible(propChips, chipsVisible);
  setPropVisible(propChip, chipsVisible);
  setPropVisible(propPig, pigVisible);
  setPropVisible(propGamepad, gamepadVisible);
  const handsVisible = chipsVisible || pigVisible || gamepadVisible;
  setPropVisible(propHandLeft, handsVisible);
  setPropVisible(propHandRight, handsVisible);

  if (!ballsVisible && !handsVisible) return;

  const centers = pawCentersOnScreen();
  if (!centers) return;

  if (ballsVisible) {
    const size = PROP_CANVAS_SIZE * currentScale;
    for (let k = 0; k < 2; k++) {
      const el = k === 0 ? propLeft : propRight;
      el.style.left = centers[k][0] + 'px';
      el.style.top = centers[k][1] + 'px';
      el.style.width = size + 'px';
    }
  }

  if (chipsVisible) {
    const pose = eatChipsPose(now);
    const mid = [
      (centers[0][0] + centers[1][0]) / 2,
      (centers[0][1] + centers[1][1]) / 2,
    ];
    const bagX = mid[0] + CHIPS_BAG_ANCHOR[0] * currentScale;
    const bagY = mid[1] + CHIPS_BAG_ANCHOR[1] * currentScale;
    const handW = CHIPS_HAND_W * currentScale;

    // 袋子固定在两只手的中点，不再跟着单只模型手摆动；这样头动时包装袋仍稳在胸前。
    propChips.style.left = bagX + 'px';
    propChips.style.top = bagY + 'px';
    propChips.style.width = (CHIPS_BAG_W * currentScale) + 'px';
    propChips.style.transform = 'translate(-50%, -50%) rotate(' + CHIPS_BAG_ROT + 'deg)';

    // 右手始终扶在袋子右下角，左手的起落幅度只对应 GIF 里的那一小段提手动作。
    propHandRight.style.left = (mid[0] + CHIPS_RIGHT_HAND_OFFSET[0] * currentScale) + 'px';
    propHandRight.style.top = (mid[1] + CHIPS_RIGHT_HAND_OFFSET[1] * currentScale) + 'px';
    propHandRight.style.width = handW + 'px';
    propHandRight.style.transform = 'translate(-50%, -50%) rotate(-3deg)';

    propHandLeft.style.left = (mid[0] + (CHIPS_LEFT_HAND_OFFSET[0] + pose.handX) * currentScale) + 'px';
    propHandLeft.style.top = (mid[1] + (CHIPS_LEFT_HAND_OFFSET[1] + pose.handY) * currentScale) + 'px';
    propHandLeft.style.width = handW + 'px';
    propHandLeft.style.transform = 'translate(-50%, -50%) rotate(' + pose.handRot + 'deg)';

    // 单片薯片独立从袋口沿弧线送到嘴边；透明度由关键帧平滑淡入淡出。
    propChip.style.opacity = String(Math.max(0, Math.min(1, pose.chip)));
    propChip.style.left = (bagX + (CHIPS_CHIP_FROM_BAG[0] + pose.chipX) * currentScale) + 'px';
    propChip.style.top = (bagY + (CHIPS_CHIP_FROM_BAG[1] + pose.chipY) * currentScale) + 'px';
    propChip.style.width = (CHIPS_CHIP_W * currentScale) + 'px';
    propChip.style.transform = 'translate(-50%, -50%) rotate(' + pose.chipRot + 'deg)';
  } else if (pigVisible) {
    const nowValue = now;
    const elapsed = nowValue - pigStartAt;
    const enterT = Math.max(0, Math.min(1, elapsed / PIG_FADE_MS));
    const enter = enterT * enterT * (3 - 2 * enterT);
    const exitT = Math.max(0, Math.min(1, (PIG_PROP_MS - elapsed) / PIG_FADE_MS));
    const exit = exitT * exitT * (3 - 2 * exitT);
    const opacity = enter * exit;
    const move = enter * exit;
    const pose = pigPose(nowValue);
    const handW = PIG_HAND_W * currentScale;
    const midX = (centers[0][0] + centers[1][0]) / 2 + PIG_BASE_X * currentScale;
    const midY = (centers[0][1] + centers[1][1]) / 2;
    const pawBaseY = midY + PIG_PAW_Y * currentScale;
    const targetLeftX = midX - PIG_PAW_SEP * 0.5 * currentScale + pose.lx * currentScale;
    const targetLeftY = pawBaseY + pose.ly * currentScale;
    const targetRightX = midX + PIG_PAW_SEP * 0.5 * currentScale + pose.rx * currentScale;
    const targetRightY = pawBaseY + pose.ry * currentScale;
    const baseAngle = Math.atan2(centers[1][1] - centers[0][1], centers[1][0] - centers[0][0]);
    const holdAngle = Math.atan2(targetRightY - targetLeftY, targetRightX - targetLeftX);
    const rot = ((holdAngle - baseAngle) * 180 / Math.PI * PIG_ROT_GAIN) * move;

    // 贴图手从模型手原位滑到抱持位；结束前再滑回原位，避免换手时突然跳变。
    const leftX = centers[0][0] + (targetLeftX - centers[0][0]) * move;
    const leftY = centers[0][1] + (targetLeftY - centers[0][1]) * move;
    const rightX = centers[1][0] + (targetRightX - centers[1][0]) * move;
    const rightY = centers[1][1] + (targetRightY - centers[1][1]) * move;
    const targetPigX = (targetLeftX + targetRightX) / 2 + PIG_CENTER_OFFSET[0] * currentScale;
    const targetPigY = (targetLeftY + targetRightY) / 2 + PIG_CENTER_OFFSET[1] * currentScale;
    const startPigX = (centers[0][0] + centers[1][0]) / 2 + PIG_CENTER_OFFSET[0] * currentScale;
    const startPigY = (centers[0][1] + centers[1][1]) / 2 + (PIG_CENTER_OFFSET[1] + PIG_ENTER_DROP) * currentScale;

    propPig.style.opacity = String(opacity);
    propPig.style.left = (startPigX + (targetPigX - startPigX) * move) + 'px';
    propPig.style.top = (startPigY + (targetPigY - startPigY) * move) + 'px';
    propPig.style.width = (PIG_W * currentScale * (0.86 + 0.14 * move)) + 'px';
    propPig.style.transform = 'translate(-50%, -50%) rotate(' + rot + 'deg)';

    propHandLeft.style.opacity = '1';
    propHandLeft.style.left = leftX + 'px';
    propHandLeft.style.top = leftY + 'px';
    propHandLeft.style.width = handW + 'px';
    propHandLeft.style.transform = 'translate(-50%, -50%) rotate(' + (rot * 0.35) + 'deg)';
    propHandRight.style.opacity = '1';
    propHandRight.style.left = rightX + 'px';
    propHandRight.style.top = rightY + 'px';
    propHandRight.style.width = handW + 'px';
    propHandRight.style.transform = 'translate(-50%, -50%) rotate(' + (-rot * 0.35) + 'deg)';
  } else if (gamepadVisible) {
    const pose = gamepadPose(now);
    const elapsed = now - gamepadStartAt;
    const enterT = Math.max(0, Math.min(1, elapsed / GAMEPAD_FADE_MS));
    const enter = enterT * enterT * (3 - 2 * enterT);
    const exitT = Math.max(0, Math.min(1, (GAMEPAD_PROP_MS - elapsed) / GAMEPAD_FADE_MS));
    const exit = exitT * exitT * (3 - 2 * exitT);
    const opacity = enter * exit;
    const move = enter * exit;
    const handW = GAMEPAD_HAND_W * currentScale;
    const midX = (centers[0][0] + centers[1][0]) / 2;
    const midY = (centers[0][1] + centers[1][1]) / 2;
    const pawY = midY + GAMEPAD_PAW_Y * currentScale;
    const targetLeftX = midX - GAMEPAD_PAW_SEP * 0.5 * currentScale + pose.lx * currentScale;
    const targetLeftY = pawY + pose.ly * currentScale;
    const targetRightX = midX + GAMEPAD_PAW_SEP * 0.5 * currentScale + pose.rx * currentScale;
    const targetRightY = pawY + pose.ry * currentScale;
    const leftX = centers[0][0] + (targetLeftX - centers[0][0]) * move;
    const leftY = centers[0][1] + (targetLeftY - centers[0][1]) * move;
    const rightX = centers[1][0] + (targetRightX - centers[1][0]) * move;
    const rightY = centers[1][1] + (targetRightY - centers[1][1]) * move;
    const targetPadX = (targetLeftX + targetRightX) / 2 + GAMEPAD_CENTER_OFFSET[0] * currentScale;
    const targetPadY = (targetLeftY + targetRightY) / 2 + GAMEPAD_CENTER_OFFSET[1] * currentScale;
    const startPadY = pawY + (GAMEPAD_CENTER_OFFSET[1] + GAMEPAD_ENTER_DROP) * currentScale;

    propGamepad.style.opacity = String(opacity);
    propGamepad.style.left = targetPadX + 'px';
    propGamepad.style.top = (startPadY + (targetPadY - startPadY) * move) + 'px';
    propGamepad.style.width = (GAMEPAD_W * currentScale * (0.9 + 0.1 * move) * pose.scale) + 'px';
    propGamepad.style.transform = 'translate(-50%, -50%) rotate(' + (pose.rot * move) + 'deg)';
    propHandLeft.style.opacity = '1';
    propHandLeft.style.left = leftX + 'px';
    propHandLeft.style.top = leftY + 'px';
    propHandLeft.style.width = handW + 'px';
    propHandLeft.style.transform = 'translate(-50%, -50%) rotate(' + (pose.rot * move) + 'deg)';
    propHandRight.style.opacity = '1';
    propHandRight.style.left = rightX + 'px';
    propHandRight.style.top = rightY + 'px';
    propHandRight.style.width = handW + 'px';
    propHandRight.style.transform = 'translate(-50%, -50%) rotate(' + (pose.rot * move) + 'deg)';
  }
}

/* ---------------- 站姿 / 坐姿状态机 ---------------- */

/**
 * 进一个状态先维持 STATE_MIN_MS ~ STATE_MAX_MS（随机），这期间不做任何切换；
 * 到点后按 30% 坐下 / 70% 站起 掷一次目标状态：
 *   - 掷到当前状态 → 原地续期，不重复播切换动作
 *   - 掷到另一个状态 → 播对应的切换动作，并更新状态
 * 切换动作是表情通道的 1 秒淡入淡出，和动作曲线互不干扰：切换的时候正在播的待机动作
 * 不会被「打断」，也不用等它播完，普通待机动作也不会反过来改变状态。
 */
function scheduleStateSwitch() {
  if (stateTimer) clearTimeout(stateTimer);
  stateTimer = setTimeout(() => {
    stateTimer = null;
    const target = pickNextState();
    if (target !== currentState) {
      playAction(target === STATE_SIT ? SIT_ACTION : STAND_ACTION);
      currentState = target;
    }
    scheduleStateSwitch();
  }, STATE_MIN_MS + Math.random() * (STATE_MAX_MS - STATE_MIN_MS));
}

/** 按权重掷下一个状态；坐姿不可用时（模型没有坐姿表情）永远站起 */
function pickNextState() {
  if (!canSit) return STATE_STAND;
  return Math.random() < SIT_STATE_WEIGHT ? STATE_SIT : STATE_STAND;
}

/** 待机：隔一个随机时间随机播一个动作，播完再排下一次 */
function scheduleIdleAction() {
  if (idleActionTimer) clearTimeout(idleActionTimer);
  const delay = IDLE_ACTION_MIN_MS + Math.random() * (IDLE_ACTION_MAX_MS - IDLE_ACTION_MIN_MS);
  idleActionTimer = setTimeout(() => {
    idleActionTimer = null;
    // 窗口没显示时不做无谓的动画；正在播动作时这一轮跳过
    if (isWindowVisible && live2dModel && !isMotionPlaying()) {
      playRandomAction('idle', MotionPriority.IDLE);
    }
    scheduleIdleAction();
  }, delay);
}

/** 点击：立刻回一个动作（优先级最高，可以打断正在播的待机动作） */
function reactToClick() {
  const now = Date.now();
  if (now - lastReactAt < CLICK_REACT_COOLDOWN_MS) return;
  lastReactAt = now;
  if (!isWindowVisible || !live2dModel) return;
  playRandomAction('click', MotionPriority.FORCE);
}
