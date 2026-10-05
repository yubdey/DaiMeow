// DaiMeow Pet Renderer
import * as PIXI from 'pixi.js';
import { Live2DModel, MotionPriority } from 'pixi-live2d-display';
import { ACTION_POOL_KEYS, getActionIdsForPool } from './action-definitions.js';
import { createActionController } from './action-controller.js';

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
// 帧率上限（30~120，默认 45），由设置面板的「最大帧率」控制，改完立即生效。
// 两个 ticker 都要限：
//  - app.ticker 负责画面（模型内容）刷新；拖动顺不顺取决于窗口位置的更新节拍，
//    那部分交给渲染进程的 rAF（见下面拖动那段），所以这里限帧只影响模型自身的流畅度。
//  - PIXI.Ticker.shared 挂着 pixi-live2d-display 的模型更新（含物理），它默认不限帧，
//    在高刷屏上会按屏幕刷新率空转（本机 165Hz）。模型更新用的是 deltaMS，
//    所以限帧只是少算几次，动画速度不变。
const MIN_FPS = 30;
const MAX_FPS = 120;
const DEFAULT_FPS = 45;
function applyMaxFps(fps) {
  const v = Math.min(MAX_FPS, Math.max(MIN_FPS, Math.round(Number(fps) || DEFAULT_FPS)));
  app.ticker.maxFPS = v;
  PIXI.Ticker.shared.maxFPS = v;
  return v;
}
applyMaxFps(DEFAULT_FPS);
petAPI.onMaxFpsChanged((fps) => applyMaxFps(fps));

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

// 「啦啦啦」：跳这段动作时，手里的两个啦啦球会亮出来（球是独立 PNG，跟着左右手走，见 renderCheerProps）
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

// 「Hello」：用模型原爪贴图挥手，另一只手保持模型原本的位置；文字素材独立叠在左上方。
const HELLO_ACTION = 'hello';
const HELLO_MOTION_MS = 1530;        // 3 轮挥手，每轮 510ms
const HELLO_RESTORE_MS = 300;        // 收尾时让外置原爪和模型手平滑交接
const HELLO_PROP_MS = HELLO_MOTION_MS + HELLO_RESTORE_MS;
const HELLO_CYCLE_MS = 510;
const HELLO_TEXT_W = 760;            // 文字图片宽度（画布像素）
const HELLO_TEXT_ANCHOR = [-450, -920];
const HELLO_TEXT_ROT = -3;
const HELLO_HAND_ANCHOR = [0, -540]; // 挥手原爪整体上移
// 17 帧挥手位置：相对模型原爪中心的画布像素偏移，数据来自 Hello.gif 的黄色手部轨迹。
const HELLO_WAVE_KEYS = [
  [0, 0], [67, 67], [79, 141], [5, 171], [-120, 162], [-248, 155], [-274, 157],
  [-280, 139], [-176, 106], [-43, 97], [56, 125], [71, 150], [13, 134],
  [-82, 85], [-167, 33], [-200, -3], [-162, -30],
];

// 「流口水」：小猪贴纸挂在额头，最后阶段从嘴下伸出口水。
const DROOL_ACTION = 'drool';
const DROOL_STICKER_W = 600;
const DROOL_STICKER_ANCHOR = [0, -500];
const DROOL_NOD_PERIOD_MS = 510;
const DROOL_NOD_Y = 90;
const DROOL_W = 54;
const DROOL_ANCHOR = [0, 20];
const DROOL_START_MS = 1620;
const DROOL_FULL_MS = 2220;
const DROOL_HOLD_MS = 300;
const DROOL_PROP_MS = DROOL_FULL_MS + DROOL_HOLD_MS;

// 「问号」：半睁眼疑惑，头顶和两侧依次冒出问号。
const QUESTION_ACTION = 'question';
const QUESTION_PROP_MS = 1800;       // 耳朵抖动1 + 问号逐个弹出，末尾延长 150ms
const QUESTION_W = 300;
const QUESTION_PARTICLES = [
  { id: 'question-0', delay: 600,  from: [-520, -620], to: [-560, -760], rot: -8 },
  { id: 'question-3', delay: 800,  from: [560, -560],  to: [620, -700],  rot: 9 },
  { id: 'question-4', delay: 1000, from: [-40, -790],  to: [-60, -920],  rot: -5 },
  { id: 'question-5', delay: 1200, from: [300, -380],  to: [340, -500],  rot: 6 },
];

// 「灵光一闪」：手部保持思考姿势，眼睛左右寻找，灯泡短暂出现。
const IDEA_ACTION = 'idea';
const IDEA_MOTION_MS = 1500;         // 手势来回 + 灯泡
const IDEA_RESTORE_MS = 250;         // 收尾恢复模型原手
const IDEA_PROP_MS = IDEA_MOTION_MS + IDEA_RESTORE_MS;
const IDEA_HAND_W = 350;
const IDEA_HAND_Y = 300;
const IDEA_HAND_LEFT_X = -380;
const IDEA_HAND_RIGHT_X = -140;
const IDEA_HAND_MOVE_MS = 800;
const IDEA_BULB_W = 320;
const IDEA_BULB_ANCHOR = [-560, -500];
const IDEA_BULB_IN_START_MS = 800;
const IDEA_BULB_FULL_MS = 1120;
const IDEA_BULB_OUT_START_MS = 1350;
const IDEA_BULB_END_MS = 1500;

// 「思考中」：思考手势保持在嘴下，额头加载图标持续旋转，眼睛左右寻找。
const THINKING_ACTION = 'thinking';
const THINKING_PROP_MS = 1800;       // 两轮手势后收尾（每轮 700ms）
const THINKING_HAND_W = IDEA_HAND_W;
const THINKING_HAND_Y = IDEA_HAND_Y;
const THINKING_HAND_CYCLE_MS = 700;
const THINKING_HAND_CYCLES = 2;
const THINKING_HAND_MOVE_MS = THINKING_HAND_CYCLE_MS * THINKING_HAND_CYCLES;
const THINKING_LOADING_W = 750;
const THINKING_LOADING_ANCHOR = [0, -450];
const THINKING_DROOL_W = 40;

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
// 四个触发池均由 action-definitions.js 的单一元数据表生成，避免新增动作时漏改某一组。
const STAND_IDLE_ACTION_NAMES = getActionIdsForPool(ACTION_POOL_KEYS.IDLE_STAND);
const SIT_IDLE_ACTION_NAMES = getActionIdsForPool(ACTION_POOL_KEYS.IDLE_SIT);
const CLICK_ACTION_NAMES = getActionIdsForPool(ACTION_POOL_KEYS.CLICK_STAND);

// 待机动作的随机间隔（毫秒）
const IDLE_ACTION_MIN_MS = 5000;
const IDLE_ACTION_MAX_MS = 20000;
// 连点保护：两次点击回应至少隔这么久
const CLICK_REACT_COOLDOWN_MS = 350;

// 站姿 / 坐姿状态：进入一个状态后至少维持这么久，到点再按权重掷下一次
const STATE_STAND = 'stand';
const STATE_SIT = 'sit';
const STATE_MIN_MS = 60000;
const STATE_MAX_MS = 120000;
// 掷到坐下的概率（剩下 70% 掷站起）
const SIT_STATE_WEIGHT = 0.3;

// 动作名 → [分组, 序号]，分组与序号都取自 model3.json 里登记的 Motions
const motionByName = new Map();

// --- 啦啦球（外部 PNG 跟随左右手）---
const propLeft = document.getElementById('prop-left');
const propRight = document.getElementById('prop-right');
const propHello = document.getElementById('prop-hello');
const propQuestions = QUESTION_PARTICLES.map((p) => ({ ...p, el: document.getElementById(p.id) }));
const propIdeaHand = document.getElementById('prop-idea-hand');
const propLightbulb = document.getElementById('prop-lightbulb');
const propThinkingHand = document.getElementById('prop-thinking-hand');
const propThinkingLoading = document.getElementById('prop-thinking-loading');
const propPigSticker = document.getElementById('prop-pig-sticker');
const propDrool = document.getElementById('prop-drool');
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
let helloStartAt = 0;                    // Hello 动作开始时刻（0 = 没在播）
let droolStartAt = 0;                    // 流口水动作开始时刻（0 = 没在播）
let questionStartAt = 0;                 // 问号动作开始时刻（0 = 没在播）
let ideaStartAt = 0;                     // 灵光一闪动作开始时刻（0 = 没在播）
let thinkingStartAt = 0;                 // 思考中动作开始时刻（0 = 没在播）
let chipsStartAt = 0;                    // 吃薯片动作开始时刻（0 = 没在播）
let chipsCycles = 0;                     // 当前吃薯片动作包含几轮
let pigStartAt = 0;                      // 抱小猪动作开始时刻（0 = 没在播）
let gamepadStartAt = 0;                  // 玩游戏动作开始时刻（0 = 没在播）
/** 当前吃薯片动作应展示道具的总时长。 */
function chipsPlaybackMs() {
  if (chipsCycles === 2) return CHIPS_TWO_SECOND_START_MS + CHIPS_CYCLE_MS;
  return CHIPS_CYCLE_MS;
}

// 特殊道具动作的生命周期注册表：start 时点亮，stop 时清理，活动状态统一维护。
// 具体几何计算拆到独立 renderer，动作生命周期只负责选中和清理。
let activePropAction = null;

function createChipsPropHandler(cycles) {
  return {
    start(now) { chipsCycles = cycles; chipsStartAt = now; },
    stop() { chipsStartAt = 0; chipsCycles = 0; },
    isFinished(now) { return now - chipsStartAt >= chipsPlaybackMs(); },
    handsOpacity(now) { return handsOpacityAt(now - chipsStartAt); },
  };
}

const ACTION_PROP_HANDLERS = {
  [CHEER_ACTION]: {
    start(now) { propUntil = now + CHEER_PROP_MS; },
    stop() { propUntil = 0; },
    isFinished(now) { return !propUntil || now >= propUntil; },
  },
  [HELLO_ACTION]: {
    start(now) { helloStartAt = now; },
    stop() { helloStartAt = 0; },
    isFinished(now, startedAt) { return now - startedAt >= HELLO_PROP_MS; },
    handsOpacity(now, startedAt) { return helloHandsOpacityAt(now - startedAt); },
  },
  [DROOL_ACTION]: {
    start(now) { droolStartAt = now; },
    stop() { droolStartAt = 0; },
    isFinished(now, startedAt) { return now - startedAt >= DROOL_PROP_MS; },
  },
  [QUESTION_ACTION]: {
    start(now) { questionStartAt = now; },
    stop() { questionStartAt = 0; },
    isFinished(now, startedAt) { return now - startedAt >= QUESTION_PROP_MS; },
  },
  [IDEA_ACTION]: {
    start(now) { ideaStartAt = now; },
    stop() { ideaStartAt = 0; },
    isFinished(now, startedAt) { return now - startedAt >= IDEA_PROP_MS; },
    handsOpacity(now, startedAt) { return ideaHandsOpacityAt(now - startedAt); },
  },
  [THINKING_ACTION]: {
    start(now) { thinkingStartAt = now; },
    stop() { thinkingStartAt = 0; },
    isFinished(now, startedAt) { return now - startedAt >= THINKING_PROP_MS; },
    handsOpacity() { return 0; },
  },
  [CHIPS_ACTION]: createChipsPropHandler(1),
  [CHIPS_TWO_ACTION]: createChipsPropHandler(2),
  [PIG_ACTION]: {
    start(now) { pigStartAt = now; },
    stop() { pigStartAt = 0; },
    isFinished(now, startedAt) { return now - startedAt >= PIG_PROP_MS; },
    handsOpacity(now, startedAt) { return pigHandsOpacityAt(now - startedAt); },
  },
  [GAMEPAD_ACTION]: {
    start(now) { gamepadStartAt = now; },
    stop() { gamepadStartAt = 0; },
    isFinished(now, startedAt) { return now - startedAt >= GAMEPAD_PROP_MS; },
    handsOpacity(now, startedAt) { return gamepadHandsOpacityAt(now - startedAt); },
  },
};

function stopActivePropAction() {
  if (!activePropAction) return;
  if (activePropAction.handler.stop) activePropAction.handler.stop();
  activePropAction = null;
}

function startActivePropAction(name, now) {
  stopActivePropAction();
  const handler = ACTION_PROP_HANDLERS[name];
  if (!handler) return;
  activePropAction = { id: name, startedAt: now, handler };
  handler.start(now, name);
}

function refreshActivePropAction(now) {
  if (!activePropAction) return null;
  if (activePropAction.handler.isFinished(now, activePropAction.startedAt)) {
    stopActivePropAction();
    return null;
  }
  return activePropAction;
}

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

const actionController = createActionController({
  playAction,
  isWindowVisible: () => isWindowVisible,
  isMotionPlaying,
  sitAction: SIT_ACTION,
  standAction: STAND_ACTION,
  idlePriority: MotionPriority.IDLE,
  forcePriority: MotionPriority.FORCE,
  stateStand: STATE_STAND,
  stateSit: STATE_SIT,
  idleMinMs: IDLE_ACTION_MIN_MS,
  idleMaxMs: IDLE_ACTION_MAX_MS,
  clickCooldownMs: CLICK_REACT_COOLDOWN_MS,
  stateMinMs: STATE_MIN_MS,
  stateMaxMs: STATE_MAX_MS,
  sitWeight: SIT_STATE_WEIGHT,
});

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
    actionController.start();
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
  if (!state.dragged && performance.now() - state.t < CLICK_MAX_DURATION_MS) actionController.reactToClick();
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
  const pools = {
    idleStand: STAND_IDLE_ACTION_NAMES.filter(available),
    idleSit: SIT_IDLE_ACTION_NAMES.filter(available),
    click: CLICK_ACTION_NAMES.filter(available),
    // 坐着的时候点击也只会做坐姿做得出来的动作（避免坐着突然摇摆/前倾）
    clickSit: getActionIdsForPool(ACTION_POOL_KEYS.CLICK_SIT).filter(available),
  };
  actionController.setPools(pools);

  const missing = STAND_IDLE_ACTION_NAMES.filter((n) => !available(n));
  if (missing.length) petAPI.logError('待机动作缺失: ' + missing.join(', '));
  const missingSit = SIT_IDLE_ACTION_NAMES.filter((n) => !available(n));
  if (missingSit.length) petAPI.logError('坐姿动作缺失: ' + missingSit.join(', '));
  const missingClick = [...CLICK_ACTION_NAMES, ...getActionIdsForPool(ACTION_POOL_KEYS.CLICK_SIT)]
    .filter((n, i, list) => list.indexOf(n) === i && !available(n));
  if (missingClick.length) petAPI.logError('点击动作缺失: ' + missingClick.join(', '));

  // 坐姿是靠表情通道实现的，模型里没有这个表情就只能一直站着，别去反复尝试
  actionController.setCanSit(expressions.has(SIT_ACTION) && expressions.has(STAND_ACTION));
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

/**
 * 把动作播出去：动作曲线交给引擎的动作播放，坐/站交给表情通道。
 * 坐/站只是「摆姿势」，当前处于哪个状态由 action-controller.js 的状态机说了算。
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
    // 新动作开始前统一收掉上一套外部道具，再按注册表启动当前动作的道具。
    const now = performance.now();
    startActivePropAction(name, now);
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

/** Hello 的 17 帧挥手轨迹，使用周期 Catmull-Rom 插值保证循环处平顺。 */
function sampleHelloWave(u) {
  const keys = HELLO_WAVE_KEYS;
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
  return [0, 1].map((j) => cr(k0[j], k1[j], k2[j], k3[j]));
}

/** Hello 这一帧的挥手与文字浮动。 */
function helloPose(now) {
  const neutral = { handX: 0, handY: 0, handRot: 0, textY: 0, textRot: HELLO_TEXT_ROT };
  if (!helloStartAt) return neutral;
  const elapsed = now - helloStartAt;
  if (elapsed < 0 || elapsed >= HELLO_MOTION_MS) return neutral;
  const u = (elapsed % HELLO_CYCLE_MS) / HELLO_CYCLE_MS;
  const wave = sampleHelloWave(u);
  const phase = 2 * Math.PI * u;
  return {
    handX: wave[0],
    handY: wave[1],
    handRot: -4 * Math.sin(phase),
    textY: -10 * Math.sin(phase),
    textRot: HELLO_TEXT_ROT + 2 * Math.sin(phase),
  };
}

/** Hello 收尾时的交接进度：0 = 外置原爪，1 = 模型自带手。 */
function helloRestoreProgress(elapsed) {
  if (elapsed <= HELLO_MOTION_MS) return 0;
  if (elapsed >= HELLO_PROP_MS) return 1;
  const t = (elapsed - HELLO_MOTION_MS) / HELLO_RESTORE_MS;
  return t * t * (3 - 2 * t);
}

/** Hello 期间模型自带手的不透明度；只在收尾阶段平滑恢复。 */
function helloHandsOpacityAt(elapsed) {
  if (elapsed <= 0 || elapsed >= HELLO_PROP_MS) return 1;
  return helloRestoreProgress(elapsed);
}

/** 问号贴纸的逐个出现、上浮和轻微旋转。 */
function questionParticlePose(particle, elapsed) {
  const age = elapsed - particle.delay;
  if (age < 0) return null;
  const enter = Math.min(1, age / 180);
  const move = Math.min(1, age / 480);
  const ease = 1 - Math.pow(1 - move, 3);
  return {
    x: particle.from[0] + (particle.to[0] - particle.from[0]) * ease,
    y: particle.from[1] + (particle.to[1] - particle.from[1]) * ease,
    scale: 0.28 + 0.72 * (enter * enter * (3 - 2 * enter)),
    opacity: enter,
    rot: particle.rot * ease,
  };
}

/** 思考手在下巴位置完成一次左→右→左往返。 */
function ideaHandX(elapsed) {
  const t = Math.max(0, Math.min(1, elapsed / IDEA_HAND_MOVE_MS));
  const half = t < 0.5 ? t * 2 : (1 - t) * 2;
  const e = half * half * (3 - 2 * half);
  return IDEA_HAND_LEFT_X + (IDEA_HAND_RIGHT_X - IDEA_HAND_LEFT_X) * e;
}

/** 思考中手势的两轮横向往返，每轮 700ms。 */
function thinkingHandX(elapsed) {
  if (elapsed >= THINKING_HAND_MOVE_MS) return IDEA_HAND_LEFT_X;
  const cycleT = (elapsed % THINKING_HAND_CYCLE_MS) / THINKING_HAND_CYCLE_MS;
  const half = cycleT < 0.5 ? cycleT * 2 : (1 - cycleT) * 2;
  const e = half * half * (3 - 2 * half);
  return IDEA_HAND_LEFT_X + (IDEA_HAND_RIGHT_X - IDEA_HAND_LEFT_X) * e;
}

function ideaRestoreProgress(elapsed) {
  if (elapsed <= IDEA_MOTION_MS) return 0;
  if (elapsed >= IDEA_PROP_MS) return 1;
  const t = (elapsed - IDEA_MOTION_MS) / IDEA_RESTORE_MS;
  return t * t * (3 - 2 * t);
}

function ideaHandsOpacityAt(elapsed) {
  if (elapsed <= 0 || elapsed >= IDEA_PROP_MS) return 1;
  return ideaRestoreProgress(elapsed);
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
    const active = refreshActivePropAction(now);
    const opacity = active && active.handler.handsOpacity
      ? active.handler.handsOpacity(now, active.startedAt)
      : 1;
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
function ensurePropLoaded(el) {
  if (!el || el.dataset.loaded === '1') return;
  const src = el.dataset.src;
  if (!src) return;
  el.src = src;
  el.dataset.loaded = '1';
}

function setPropVisible(el, visible) {
  if (!el) return;
  if (visible) ensurePropLoaded(el);
  const cls = visible ? 'prop show' : 'prop';
  if (el.className !== cls) el.className = cls;
  if (!visible && el.style.opacity !== '') el.style.opacity = '';
}

/**
 * 每帧摆放所有道具贴图：啦啦球贴左右手、薯片袋子/小猪/手柄跟着手走。
 * 球和手的位置由引擎的 getDrawableVertices + toGlobal 换算成窗口像素，
 * 所以模型怎么缩放/移动，道具都跟着走。
 */
// 每个动作的逐帧道具渲染器：只负责把已经调好的几何计算画到 DOM 上。
// updateProps 只负责选中当前渲染器，不再把所有动作分支串在一个函数里。
function renderCheerProps(now, centers) {
    const size = PROP_CANVAS_SIZE * currentScale;
    for (let k = 0; k < 2; k++) {
      const el = k === 0 ? propLeft : propRight;
      el.style.left = centers[k][0] + 'px';
      el.style.top = centers[k][1] + 'px';
      el.style.width = size + 'px';
    }
}

function renderChipsProps(now, centers) {
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

}

function renderPigProps(now, centers) {
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

}

function renderGamepadProps(now, centers) {
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

function renderHelloProps(now, centers) {
    const pose = helloPose(now);
    const restore = helloRestoreProgress(now - helloStartAt);
    const handW = CHIPS_HAND_W * currentScale;
    const mid = [
      (centers[0][0] + centers[1][0]) / 2,
      (centers[0][1] + centers[1][1]) / 2,
    ];

    // 左手做动图里的左右挥手，右手保持模型原本手位；两者都使用原爪贴图。
    propHandLeft.style.opacity = String(1 - restore);
    propHandLeft.style.left = (centers[0][0] + pose.handX * currentScale) + 'px';
    const handY = HELLO_HAND_ANCHOR[1] * (1 - restore) + pose.handY;
    propHandLeft.style.top = (centers[0][1] + handY * currentScale) + 'px';
    propHandLeft.style.width = handW + 'px';
    propHandLeft.style.transform = 'translate(-50%, -50%) rotate(' + pose.handRot + 'deg)';
    propHandRight.style.opacity = String(1 - restore);
    propHandRight.style.left = centers[1][0] + 'px';
    propHandRight.style.top = centers[1][1] + 'px';
    propHandRight.style.width = handW + 'px';
    propHandRight.style.transform = 'translate(-50%, -50%)';

    propHello.style.left = (mid[0] + HELLO_TEXT_ANCHOR[0] * currentScale) + 'px';
    propHello.style.top = (mid[1] + (HELLO_TEXT_ANCHOR[1] + pose.textY) * currentScale) + 'px';
    propHello.style.width = (HELLO_TEXT_W * currentScale) + 'px';
    propHello.style.transform = 'translate(-50%, -50%) rotate(' + pose.textRot + 'deg)';
    propHello.style.opacity = String(1 - restore);

}

function renderDroolProps(now, centers) {
    const elapsed = now - droolStartAt;
    const nodT = elapsed < DROOL_START_MS
      ? 0.5 - 0.5 * Math.cos(2 * Math.PI * elapsed / DROOL_NOD_PERIOD_MS)
      : 0;
    const bobY = DROOL_NOD_Y * nodT;

    propPigSticker.style.left = (currentCX + DROOL_STICKER_ANCHOR[0] * currentScale) + 'px';
    propPigSticker.style.top = (currentCY + (DROOL_STICKER_ANCHOR[1] + bobY) * currentScale) + 'px';
    propPigSticker.style.width = (DROOL_STICKER_W * currentScale) + 'px';
    propPigSticker.style.transform = 'translate(-50%, -50%)';

    let dropT = Math.max(0, Math.min(1, (elapsed - DROOL_START_MS) / (DROOL_FULL_MS - DROOL_START_MS)));
    dropT = dropT * dropT * (3 - 2 * dropT);
    propDrool.style.left = (currentCX + DROOL_ANCHOR[0] * currentScale) + 'px';
    propDrool.style.top = (currentCY + DROOL_ANCHOR[1] * currentScale) + 'px';
    propDrool.style.width = (DROOL_W * currentScale) + 'px';
    propDrool.style.transformOrigin = 'top center';
    propDrool.style.transform = 'translate(-50%, 0) scaleY(' + (0.12 + 0.88 * dropT) + ')';
    propDrool.style.opacity = String(dropT);

}

function renderQuestionProps(now, centers) {
    const elapsed = now - questionStartAt;
    for (const particle of propQuestions) {
      const pose = questionParticlePose(particle, elapsed);
      if (!pose || !particle.el) continue;
      particle.el.style.left = (currentCX + pose.x * currentScale) + 'px';
      particle.el.style.top = (currentCY + pose.y * currentScale) + 'px';
      particle.el.style.width = (QUESTION_W * currentScale * pose.scale) + 'px';
      particle.el.style.transform = 'translate(-50%, -50%) rotate(' + pose.rot + 'deg)';
      particle.el.style.opacity = String(pose.opacity);
    }

}

function renderIdeaProps(now, centers) {
    const elapsed = now - ideaStartAt;
    const restore = ideaRestoreProgress(elapsed);
    const handXModel = ideaHandX(elapsed);
    const handX = (currentCX + handXModel * currentScale) * (1 - restore) + centers[0][0] * restore;
    const handY = (currentCY + IDEA_HAND_Y * currentScale) * (1 - restore) + centers[0][1] * restore;
    propIdeaHand.style.opacity = String(1 - restore);
    propIdeaHand.style.left = handX + 'px';
    propIdeaHand.style.top = handY + 'px';
    propIdeaHand.style.width = (IDEA_HAND_W * currentScale) + 'px';
    propIdeaHand.style.transform = 'translate(-50%, -50%) rotate(10deg)';
    propHandLeft.style.opacity = '0';
    propHandRight.style.opacity = String(1 - restore);
    propHandRight.style.left = centers[1][0] + 'px';
    propHandRight.style.top = centers[1][1] + 'px';
    propHandRight.style.width = (CHIPS_HAND_W * currentScale) + 'px';
    propHandRight.style.transform = 'translate(-50%, -50%)';

    let bulbT = 0;
    if (elapsed < IDEA_BULB_FULL_MS) {
      const t = Math.max(0, Math.min(1, (elapsed - IDEA_BULB_IN_START_MS) / (IDEA_BULB_FULL_MS - IDEA_BULB_IN_START_MS)));
      bulbT = t * t * (3 - 2 * t);
    } else if (elapsed < IDEA_BULB_OUT_START_MS) {
      bulbT = 1;
    } else {
      const t = Math.max(0, Math.min(1, (elapsed - IDEA_BULB_OUT_START_MS) / (IDEA_BULB_END_MS - IDEA_BULB_OUT_START_MS)));
      bulbT = 1 - t * t * (3 - 2 * t);
    }
    propLightbulb.style.left = (currentCX + IDEA_BULB_ANCHOR[0] * currentScale) + 'px';
    propLightbulb.style.top = (currentCY + IDEA_BULB_ANCHOR[1] * currentScale) + 'px';
    propLightbulb.style.width = (IDEA_BULB_W * currentScale * (0.28 + 0.72 * bulbT)) + 'px';
    propLightbulb.style.transform = 'translate(-50%, -50%) rotate(-30deg)';
    propLightbulb.style.opacity = String(bulbT * (1 - restore));

}

function renderThinkingProps(now, centers) {
    // 思考手势复用“灵光一闪”的横向往返，模型原手由同尺寸贴图接管。
    // 注意：每个 renderer 自行声明 elapsed；漏掉会在 ticker 回调里抛错，
    // 异常一旦从 ticker 回调里冒出去，PIXI 的渲染循环就不会再排下一帧，
    // 表现是「模型卡住不动、但其他功能都正常」，只能重启恢复。
    const elapsed = now - thinkingStartAt;
    const handXModel = thinkingHandX(elapsed);
    propThinkingHand.style.opacity = '1';
    propThinkingHand.style.left = (currentCX + handXModel * currentScale) + 'px';
    propThinkingHand.style.top = (currentCY + THINKING_HAND_Y * currentScale) + 'px';
    propThinkingHand.style.width = (THINKING_HAND_W * currentScale) + 'px';
    propThinkingHand.style.transform = 'translate(-50%, -50%) rotate(10deg)';
    propHandLeft.style.opacity = '0';
    propHandRight.style.opacity = '1';
    propHandRight.style.left = centers[1][0] + 'px';
    propHandRight.style.top = centers[1][1] + 'px';
    propHandRight.style.width = (CHIPS_HAND_W * currentScale) + 'px';
    propHandRight.style.transform = 'translate(-50%, -50%)';

    propThinkingLoading.style.left = (currentCX + THINKING_LOADING_ANCHOR[0] * currentScale) + 'px';
    propThinkingLoading.style.top = (currentCY + THINKING_LOADING_ANCHOR[1] * currentScale) + 'px';
    propThinkingLoading.style.width = (THINKING_LOADING_W * currentScale) + 'px';
    propThinkingLoading.style.transform = 'translate(-50%, -50%)';

    propDrool.style.left = (currentCX + DROOL_ANCHOR[0] * currentScale) + 'px';
    propDrool.style.top = (currentCY + DROOL_ANCHOR[1] * currentScale) + 'px';
    propDrool.style.width = (THINKING_DROOL_W * currentScale) + 'px';
    propDrool.style.transformOrigin = 'top center';
    propDrool.style.transform = 'translate(-50%, 0) scaleY(1)';
    propDrool.style.opacity = '1';
}

const PROP_RENDERERS = {
  [CHEER_ACTION]: renderCheerProps,
  [CHIPS_ACTION]: renderChipsProps,
  [CHIPS_TWO_ACTION]: renderChipsProps,
  [PIG_ACTION]: renderPigProps,
  [GAMEPAD_ACTION]: renderGamepadProps,
  [HELLO_ACTION]: renderHelloProps,
  [DROOL_ACTION]: renderDroolProps,
  [QUESTION_ACTION]: renderQuestionProps,
  [IDEA_ACTION]: renderIdeaProps,
  [THINKING_ACTION]: renderThinkingProps,
};

function updateProps(now) {
  if (!pawDrawables) return;
  const active = refreshActivePropAction(now);
  const activeId = active ? active.id : null;
  const ballsVisible = activeId === CHEER_ACTION && !!(propLeft && propRight);
  const helloVisible = activeId === HELLO_ACTION && !!propHello;
  const droolVisible = activeId === DROOL_ACTION;
  const questionVisible = activeId === QUESTION_ACTION;
  const ideaVisible = activeId === IDEA_ACTION;
  const thinkingVisible = activeId === THINKING_ACTION;
  const chipsVisible = (activeId === CHIPS_ACTION || activeId === CHIPS_TWO_ACTION) && !!propChips;
  const pigVisible = activeId === PIG_ACTION && !!propPig;
  const gamepadVisible = activeId === GAMEPAD_ACTION && !!propGamepad;
  setPropVisible(propLeft, ballsVisible);
  setPropVisible(propRight, ballsVisible);
  setPropVisible(propHello, helloVisible);
  setPropVisible(propPigSticker, droolVisible);
  setPropVisible(propDrool, droolVisible || thinkingVisible);
  setPropVisible(propIdeaHand, ideaVisible);
  setPropVisible(propLightbulb, ideaVisible);
  setPropVisible(propThinkingHand, thinkingVisible);
  setPropVisible(propThinkingLoading, thinkingVisible);
  for (const particle of propQuestions) {
    const pose = questionVisible ? questionParticlePose(particle, now - questionStartAt) : null;
    setPropVisible(particle.el, !!pose);
  }
  setPropVisible(propChips, chipsVisible);
  setPropVisible(propChip, chipsVisible);
  setPropVisible(propPig, pigVisible);
  setPropVisible(propGamepad, gamepadVisible);
  const handsVisible = ideaVisible || thinkingVisible || helloVisible || chipsVisible || pigVisible || gamepadVisible;
  setPropVisible(propHandLeft, handsVisible);
  setPropVisible(propHandRight, handsVisible);

  if (!ballsVisible && !handsVisible && !droolVisible && !questionVisible && !ideaVisible && !thinkingVisible) return;

  const centers = pawCentersOnScreen();
  if (!centers) return;

  const renderer = PROP_RENDERERS[activeId];
  if (renderer) renderer(now, centers);

}

// 开发调试入口：自动化测试或控制台可查询当前动作、动作池，或直接强制播放某个动作。
window.__daimeowActionDebug = {
  getState() {
    const state = actionController.getState();
    return {
      ...state,
      activePropAction: activePropAction ? { id: activePropAction.id, startedAt: activePropAction.startedAt } : null,
    };
  },
  trigger(name, options = {}) {
    if (name === SIT_ACTION || name === STAND_ACTION) {
      return actionController.applyState(name === SIT_ACTION ? STATE_SIT : STATE_STAND);
    }
    if (!motionByName.has(name)) return false;
    playAction(name, options.priority ?? MotionPriority.FORCE);
    return true;
  },
};
