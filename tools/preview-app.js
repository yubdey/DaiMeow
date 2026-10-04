/**
 * 呆喵动作预览（开发工具，不参与桌宠运行）
 * ------------------------------------------------------------------
 * 左边是大尺寸的模型，右边列出 model3.json 里登记的全部动作，点一下就能播；
 * 还可以看当前动作的曲线明细和自检结果，方便调动作参数。
 * 由 preview.bat 打包成 tools/preview-bundle.js 后，配合 tools/preview-server.cjs 打开。
 */
import * as PIXI from 'pixi.js';
import { Live2DModel, MotionPriority } from 'pixi-live2d-display/cubism4';
import { getMotionActionDefinition } from '../src/renderer/pet/action-definitions.js';

const MODEL_PATH = '/model/daimeow/daimeow.model3.json';
const ASSETS = {
  left: '/src/renderer/pet/assets/pompom_yellow.png',
  right: '/src/renderer/pet/assets/pompom_pink.png',
};
const SIT_EXPRESSION = 'expression1';
const CHEER = 'cheer';
const CHEER_PROP_MS = 2300;      // 与桌宠里保持一致
const PROP_CANVAS_SIZE = 460;   // 啦啦球直径（画布像素）

// 「吃一片薯片 / 吃两片薯片」（与桌宠 pet-app-esm.js 保持同一套参数，预览即所得）
const CHIPS_ACTION = 'eat_chips';
const CHIPS_TWO_ACTION = 'eat_two_chips';
const CHIPS_CYCLE_MS = 1650;
const CHIPS_TWO_SECOND_START_MS = 1350;
const CHIPS_CYCLE_START_MS = 0;
const PART_HANDS = 'shou';
const CHIPS_BAG_W = 850;
const CHIPS_HAND_W = 369;
const CHIPS_CHIP_W = 200;
const CHIPS_BAG_ANCHOR = [10, 0];
const CHIPS_BAG_ROT = -2;
const CHIPS_LEFT_HAND_OFFSET = [-220, -120];
const CHIPS_RIGHT_HAND_OFFSET = [220, 115];
const CHIPS_CHIP_FROM_BAG = [-44, -136];
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
let chipsStartAt = 0;
let chipsCycles = 0;
function chipsPlaybackMs() {
  if (chipsCycles === 2) return CHIPS_TWO_SECOND_START_MS + CHIPS_CYCLE_MS;
  return CHIPS_CYCLE_MS;
}

// 「Hello」（与桌宠 pet-app-esm.js 保持同一套参数）
const HELLO_ACTION = 'hello';
const HELLO_MOTION_MS = 1530;
const HELLO_RESTORE_MS = 300;
const HELLO_PROP_MS = HELLO_MOTION_MS + HELLO_RESTORE_MS;
const HELLO_CYCLE_MS = 510;
const HELLO_TEXT_W = 760;
const HELLO_TEXT_ANCHOR = [-450, -920];
const HELLO_TEXT_ROT = -3;
const HELLO_HAND_ANCHOR = [0, -540];
const HELLO_WAVE_KEYS = [
  [0, 0], [67, 67], [79, 141], [5, 171], [-120, 162], [-248, 155], [-274, 157],
  [-280, 139], [-176, 106], [-43, 97], [56, 125], [71, 150], [13, 134],
  [-82, 85], [-167, 33], [-200, -3], [-162, -30],
];
let helloStartAt = 0;

// 「流口水」（与桌宠 pet-app-esm.js 保持同一套参数）
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
let droolStartAt = 0;

// 「问号」（与桌宠 pet-app-esm.js 保持同一套参数）
const QUESTION_ACTION = 'question';
const QUESTION_PROP_MS = 1800;
const QUESTION_W = 300;
const QUESTION_PARTICLES = [
  { id: 'question0', delay: 600,  from: [-520, -620], to: [-560, -760], rot: -8 },
  { id: 'question3', delay: 800,  from: [560, -560],  to: [620, -700],  rot: 9 },
  { id: 'question4', delay: 1000, from: [-40, -790],  to: [-60, -920],  rot: -5 },
  { id: 'question5', delay: 1200, from: [300, -380],  to: [340, -500],  rot: 6 },
];
let questionStartAt = 0;

// 「灵光一闪」（与桌宠 pet-app-esm.js 保持同一套参数）
const IDEA_ACTION = 'idea';
const IDEA_MOTION_MS = 1500;
const IDEA_RESTORE_MS = 250;
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
let ideaStartAt = 0;

// 「思考中」（与桌宠 pet-app-esm.js 保持同一套参数）
const THINKING_ACTION = 'thinking';
const THINKING_PROP_MS = 1800;
const THINKING_HAND_W = IDEA_HAND_W;
const THINKING_HAND_Y = IDEA_HAND_Y;
const THINKING_HAND_CYCLE_MS = 700;
const THINKING_HAND_CYCLES = 2;
const THINKING_HAND_MOVE_MS = THINKING_HAND_CYCLE_MS * THINKING_HAND_CYCLES;
const THINKING_LOADING_W = 750;
const THINKING_LOADING_ANCHOR = [0, -450];
const THINKING_DROOL_W = 40;
let thinkingStartAt = 0;

// 「抱小猪」（与桌宠 pet-app-esm.js 保持同一套参数，预览即所得）
const PIG_ACTION = 'hold_pig';
const PIG_PROP_MS = 2040;
const PIG_FADE_MS = 360;
const PIG_CYCLE_MS = 510;
const PIG_W = 620;
const PIG_HAND_W = 369;
const PIG_PAW_SEP = 820;
const PIG_PAW_Y = 0;
const PIG_BASE_X = -220;                // 抱猪整体相对身体中心略微左移，贴近参考图
const PIG_CENTER_OFFSET = [18, -70];
const PIG_ENTER_DROP = 120;
const PIG_MOTION_SCALE = 2.92;
const PIG_ROT_GAIN = 0.65;
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
let pigStartAt = 0;


// 「玩游戏」（与桌宠 pet-app-esm.js 保持同一套参数）
const GAMEPAD_ACTION = 'play_game';
const GAMEPAD_PROP_MS = 2340;
const GAMEPAD_FADE_MS = 300;
const GAMEPAD_CYCLE_MS = 780;
const GAMEPAD_W = 651;
const GAMEPAD_HAND_W = 369;
const GAMEPAD_PAW_SEP = 700;
const GAMEPAD_PAW_Y = 0;
const GAMEPAD_CENTER_OFFSET = [0, -20];
const GAMEPAD_ENTER_DROP = 110;
let gamepadStartAt = 0;
/** 与桌宠同一套姿势求值（Catmull-Rom 样条 + easeInOutSine 时间比例） */
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
    chip: p1.chip + (p2.chip - p1.chip) * e,
    chipX: cr(p0.chipX, p1.chipX, p2.chipX, p3.chipX),
    chipY: cr(p0.chipY, p1.chipY, p2.chipY, p3.chipY),
    chipRot: cr(p0.chipRot, p1.chipRot, p2.chipRot, p3.chipRot),
  };
}

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

function helloRestoreProgress(elapsed) {
  if (elapsed <= HELLO_MOTION_MS) return 0;
  if (elapsed >= HELLO_PROP_MS) return 1;
  const t = (elapsed - HELLO_MOTION_MS) / HELLO_RESTORE_MS;
  return t * t * (3 - 2 * t);
}

function helloHandsOpacityAt(elapsed) {
  if (elapsed <= 0 || elapsed >= HELLO_PROP_MS) return 1;
  return helloRestoreProgress(elapsed);
}

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

function ideaHandX(elapsed) {
  const t = Math.max(0, Math.min(1, elapsed / IDEA_HAND_MOVE_MS));
  const half = t < 0.5 ? t * 2 : (1 - t) * 2;
  const e = half * half * (3 - 2 * half);
  return IDEA_HAND_LEFT_X + (IDEA_HAND_RIGHT_X - IDEA_HAND_LEFT_X) * e;
}

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

/** 与桌宠同一套的 17 帧循环插值。 */
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

/** 玩游戏中贴图手在模型手原位接管，模型自带手隐藏。 */
function gamepadHandsOpacityAt(elapsed) {
  if (elapsed <= 0 || elapsed >= GAMEPAD_PROP_MS) return 1;
  return 0;
}

/** 模型自带的手的淡入淡出（和桌宠一致） */
function handsOpacityAt(elapsed, totalMs = chipsPlaybackMs()) {
  if (elapsed <= 0 || elapsed >= totalMs) return 1;
  return 0;
}

PIXI.Ticker.shared.add(() => {
  if (!model) return;
  const now = performance.now();
  const helloElapsed = helloStartAt ? now - helloStartAt : -1;
  const ideaElapsed = ideaStartAt ? now - ideaStartAt : -1;
  const thinkingElapsed = thinkingStartAt ? now - thinkingStartAt : -1;
  const chipsElapsed = chipsStartAt ? now - chipsStartAt : -1;
  const pigElapsed = pigStartAt ? now - pigStartAt : -1;
  const gamepadElapsed = gamepadStartAt ? now - gamepadStartAt : -1;
  if (helloStartAt && helloElapsed >= HELLO_PROP_MS) helloStartAt = 0;
  if (ideaStartAt && ideaElapsed >= IDEA_PROP_MS) ideaStartAt = 0;
  if (thinkingStartAt && thinkingElapsed >= THINKING_PROP_MS) thinkingStartAt = 0;
  if (chipsStartAt && chipsElapsed >= chipsPlaybackMs()) { chipsStartAt = 0; chipsCycles = 0; }
  if (pigStartAt && pigElapsed >= PIG_PROP_MS) pigStartAt = 0;
  if (gamepadStartAt && gamepadElapsed >= GAMEPAD_PROP_MS) gamepadStartAt = 0;
  const opacity = chipsStartAt ? handsOpacityAt(chipsElapsed)
    : (pigStartAt ? pigHandsOpacityAt(pigElapsed)
      : (gamepadStartAt ? gamepadHandsOpacityAt(gamepadElapsed)
        : (helloStartAt ? helloHandsOpacityAt(helloElapsed)
          : (ideaStartAt ? ideaHandsOpacityAt(ideaElapsed)
            : (thinkingStartAt ? 0 : 1)))));
  try {
    model.internalModel.coreModel.setPartOpacityById(PART_HANDS, opacity);
  } catch (err) { /* 忽略 */ }
}, null, PIXI.UPDATE_PRIORITY.LOW);
const $ = (id) => document.getElementById(id);
const canvas = $('stage');
const wrap = $('stageWrap');
const errBox = $('err');
const fail = (msg) => { errBox.style.display = 'block'; errBox.textContent = '出错了：' + msg; };

const app = new PIXI.Application({
  view: canvas, resizeTo: wrap, backgroundAlpha: 0, antialias: true,
  resolution: window.devicePixelRatio || 1, autoDensity: true,
});
Live2DModel.registerTicker(PIXI.Ticker);
app.ticker.maxFPS = 60;
// 与桌宠一致：PIXI 7 的命中测试对 v6 的 Container 会抛错，预览也不需要 PIXI 交互
app.renderer.events.setTargetElement(null);

let model = null;
let nativeW = 0, nativeH = 0;   // 未缩放时的原始尺寸，只在加载后取一次
let paws = null;             // [左手 drawable 序号, 右手序号]
let propUntil = 0;
const propLeft = $('propLeft');
const propRight = $('propRight');
const propHello = $('propHello');
const propQuestions = QUESTION_PARTICLES.map((p) => ({ ...p, el: $(p.id) }));
const propIdeaHand = $('propIdeaHand');
const propLightbulb = $('propLightbulb');
const propThinkingHand = $('propThinkingHand');
const propThinkingLoading = $('propThinkingLoading');
const propPigSticker = $('propPigSticker');
const propDrool = $('propDrool');
const propChips = $('propChips');
const propPig = $('propPig');
const propGamepad = $('propGamepad');
const propChip = $('propChip');
const propHandLeft = $('propHandLeft');
const propHandRight = $('propHandRight');
const srcPoint = new PIXI.Point();
const dstPoint = new PIXI.Point();

// 鼠标位置 → 视线跟随（和桌宠一样）
let targetX = 0, targetY = 0, curX = 0, curY = 0;
document.addEventListener('pointermove', (e) => {
  const r = wrap.getBoundingClientRect();
  targetX = Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width) * 2 - 1));
  targetY = -Math.max(-1, Math.min(1, ((e.clientY - r.top) / r.height) * 2 - 1));
});

/** 画布上把模型按比例放到最大并居中 */
function layoutModel() {
  if (!model) return;
  const w = app.screen.width, h = app.screen.height;
  // 注意：model.width 会跟着 scale 变（PIXI 的 Sprite.width），必须用加载时记下的原始尺寸，
  // 否则每帧算出来的缩放会自我叠加，模型越放越大。
  const scale = Math.min(w / nativeW, h / nativeH);
  model.scale.set(scale);
  model.x = w / 2;
  model.y = h / 2;
  return scale;
}

/** 找出左右爪的 drawable（按部件 shou 找，再按重心分左右） */
function resolvePaws() {
  const internal = model.internalModel;
  const core = internal.coreModel.getModel();
  const partIds = [];
  for (let i = 0; i < core.parts.count; i++) partIds.push(core.parts.ids[i]);
  const handPart = partIds.indexOf('shou');
  let idx = [];
  if (handPart >= 0) {
    for (let i = 0; i < core.drawables.count; i++) if (core.drawables.parentPartIndices[i] === handPart) idx.push(i);
  }
  if (idx.length !== 2) idx = ['ArtMesh', 'ArtMesh2'].map((id) => core.drawables.ids.indexOf(id)).filter((i) => i >= 0);
  if (idx.length !== 2) return null;
  const cx = idx.map((i) => {
    const v = internal.getDrawableVertices(i);
    let x = 0;
    for (let k = 0; k < v.length; k += 2) x += v[k];
    return x / (v.length / 2);
  });
  return cx[0] <= cx[1] ? idx : [idx[1], idx[0]];
}

/** 预览页的道具显隐。内联 opacity 必须随隐藏一起清掉，否则动作被切换后会残留。 */
function setPreviewPropVisible(el, visible) {
  if (!el) return;
  const cls = visible ? 'show' : '';
  if (el.className !== cls) el.className = cls;
  if (!visible && el.style.opacity !== '') el.style.opacity = '';
}

function hideAllPreviewProps() {
  for (const el of [propLeft, propRight, propHello, ...propQuestions.map((p) => p.el), propIdeaHand, propLightbulb, propThinkingHand, propThinkingLoading, propPigSticker, propDrool, propChips, propChip, propPig, propGamepad, propHandLeft, propHandRight]) {
    setPreviewPropVisible(el, false);
  }
}

/** 每帧：视线跟随 + 让模型铺满 + 需要时把啦啦球贴到手上 */
app.ticker.add(() => {
  if (!model) return;
  curX += (targetX - curX) * 0.12;
  curY += (targetY - curY) * 0.12;
  model.internalModel.focusController.x = curX;
  model.internalModel.focusController.y = curY;
  const scale = layoutModel();

  const propsOn = $('showProps').checked;
  const ballsVisible = propsOn && performance.now() < propUntil;
  const helloVisible = propsOn && helloStartAt > 0 && (performance.now() - helloStartAt) < HELLO_PROP_MS;
  if (droolStartAt && performance.now() - droolStartAt >= DROOL_PROP_MS) droolStartAt = 0;
  if (questionStartAt && performance.now() - questionStartAt >= QUESTION_PROP_MS) questionStartAt = 0;
  if (ideaStartAt && performance.now() - ideaStartAt >= IDEA_PROP_MS) ideaStartAt = 0;
  if (thinkingStartAt && performance.now() - thinkingStartAt >= THINKING_PROP_MS) thinkingStartAt = 0;
  const droolVisible = propsOn && droolStartAt > 0 && (performance.now() - droolStartAt) < DROOL_PROP_MS;
  const questionVisible = propsOn && questionStartAt > 0 && (performance.now() - questionStartAt) < QUESTION_PROP_MS;
  const ideaVisible = propsOn && ideaStartAt > 0 && (performance.now() - ideaStartAt) < IDEA_PROP_MS;
  const thinkingVisible = propsOn && thinkingStartAt > 0 && (performance.now() - thinkingStartAt) < THINKING_PROP_MS;
  const chipsVisible = propsOn && chipsStartAt > 0 && (performance.now() - chipsStartAt) < chipsPlaybackMs();
  const pigVisible = propsOn && pigStartAt > 0 && (performance.now() - pigStartAt) < PIG_PROP_MS;
  const gamepadVisible = propsOn && gamepadStartAt > 0 && (performance.now() - gamepadStartAt) < GAMEPAD_PROP_MS;

  setPreviewPropVisible(propLeft, ballsVisible);
  setPreviewPropVisible(propRight, ballsVisible);
  setPreviewPropVisible(propHello, helloVisible);
  setPreviewPropVisible(propPigSticker, droolVisible);
  setPreviewPropVisible(propDrool, droolVisible || thinkingVisible);
  setPreviewPropVisible(propIdeaHand, ideaVisible);
  setPreviewPropVisible(propLightbulb, ideaVisible);
  setPreviewPropVisible(propThinkingHand, thinkingVisible);
  setPreviewPropVisible(propThinkingLoading, thinkingVisible);
  for (const particle of propQuestions) {
    const pose = questionVisible ? questionParticlePose(particle, performance.now() - questionStartAt) : null;
    setPreviewPropVisible(particle.el, !!pose);
  }
  setPreviewPropVisible(propChips, chipsVisible);
  setPreviewPropVisible(propChip, chipsVisible);
  setPreviewPropVisible(propPig, pigVisible);
  setPreviewPropVisible(propGamepad, gamepadVisible);
  const handCls = (ideaVisible || thinkingVisible || helloVisible || chipsVisible || pigVisible || gamepadVisible) ? 'show' : '';
  setPreviewPropVisible(propHandLeft, handCls === 'show');
  setPreviewPropVisible(propHandRight, handCls === 'show');
  if ((!ballsVisible && !helloVisible && !droolVisible && !questionVisible && !ideaVisible && !thinkingVisible && !chipsVisible && !pigVisible && !gamepadVisible) || !paws) return;

  const internal = model.internalModel;
  const centers = [];
  for (let k = 0; k < 2; k++) {
    const v = internal.getDrawableVertices(paws[k]);
    let sx = 0, sy = 0;
    for (let m = 0; m < v.length; m += 2) { sx += v[m]; sy += v[m + 1]; }
    srcPoint.set(sx / (v.length / 2), sy / (v.length / 2));
    model.toGlobal(srcPoint, dstPoint);
    centers.push([dstPoint.x, dstPoint.y]);
  }

  if (ballsVisible) {
    const size = PROP_CANVAS_SIZE * scale;
    for (let k = 0; k < 2; k++) {
      const el = k === 0 ? propLeft : propRight;
      el.style.left = centers[k][0] + 'px';
      el.style.top = centers[k][1] + 'px';
      el.style.width = size + 'px';
    }
  }

  if (chipsVisible) {
    const pose = eatChipsPose(performance.now());
    const mid = [
      (centers[0][0] + centers[1][0]) / 2,
      (centers[0][1] + centers[1][1]) / 2,
    ];
    const bagX = mid[0] + CHIPS_BAG_ANCHOR[0] * scale;
    const bagY = mid[1] + CHIPS_BAG_ANCHOR[1] * scale;
    const handW = CHIPS_HAND_W * scale;
    propChips.style.left = bagX + 'px';
    propChips.style.top = bagY + 'px';
    propChips.style.width = (CHIPS_BAG_W * scale) + 'px';
    propChips.style.transform = 'translate(-50%, -50%) rotate(' + CHIPS_BAG_ROT + 'deg)';
    propHandRight.style.left = (mid[0] + CHIPS_RIGHT_HAND_OFFSET[0] * scale) + 'px';
    propHandRight.style.top = (mid[1] + CHIPS_RIGHT_HAND_OFFSET[1] * scale) + 'px';
    propHandRight.style.width = handW + 'px';
    propHandRight.style.transform = 'translate(-50%, -50%) rotate(-3deg)';
    propHandLeft.style.left = (mid[0] + (CHIPS_LEFT_HAND_OFFSET[0] + pose.handX) * scale) + 'px';
    propHandLeft.style.top = (mid[1] + (CHIPS_LEFT_HAND_OFFSET[1] + pose.handY) * scale) + 'px';
    propHandLeft.style.width = handW + 'px';
    propHandLeft.style.transform = 'translate(-50%, -50%) rotate(' + pose.handRot + 'deg)';
    propChip.style.opacity = String(Math.max(0, Math.min(1, pose.chip)));
    propChip.style.left = (bagX + (CHIPS_CHIP_FROM_BAG[0] + pose.chipX) * scale) + 'px';
    propChip.style.top = (bagY + (CHIPS_CHIP_FROM_BAG[1] + pose.chipY) * scale) + 'px';
    propChip.style.width = (CHIPS_CHIP_W * scale) + 'px';
    propChip.style.transform = 'translate(-50%, -50%) rotate(' + pose.chipRot + 'deg)';
  } else if (pigVisible) {
    const nowValue = performance.now();
    const elapsed = nowValue - pigStartAt;
    const enterT = Math.max(0, Math.min(1, elapsed / PIG_FADE_MS));
    const enter = enterT * enterT * (3 - 2 * enterT);
    const exitT = Math.max(0, Math.min(1, (PIG_PROP_MS - elapsed) / PIG_FADE_MS));
    const exit = exitT * exitT * (3 - 2 * exitT);
    const opacity = enter * exit;
    const move = enter * exit;
    const pose = pigPose(nowValue);
    const handW = PIG_HAND_W * scale;
    const midX = (centers[0][0] + centers[1][0]) / 2 + PIG_BASE_X * scale;
    const midY = (centers[0][1] + centers[1][1]) / 2;
    const pawBaseY = midY + PIG_PAW_Y * scale;
    const targetLeftX = midX - PIG_PAW_SEP * 0.5 * scale + pose.lx * scale;
    const targetLeftY = pawBaseY + pose.ly * scale;
    const targetRightX = midX + PIG_PAW_SEP * 0.5 * scale + pose.rx * scale;
    const targetRightY = pawBaseY + pose.ry * scale;
    const baseAngle = Math.atan2(centers[1][1] - centers[0][1], centers[1][0] - centers[0][0]);
    const holdAngle = Math.atan2(targetRightY - targetLeftY, targetRightX - targetLeftX);
    const rot = ((holdAngle - baseAngle) * 180 / Math.PI * PIG_ROT_GAIN) * move;
    const leftX = centers[0][0] + (targetLeftX - centers[0][0]) * move;
    const leftY = centers[0][1] + (targetLeftY - centers[0][1]) * move;
    const rightX = centers[1][0] + (targetRightX - centers[1][0]) * move;
    const rightY = centers[1][1] + (targetRightY - centers[1][1]) * move;
    const targetPigX = (targetLeftX + targetRightX) / 2 + PIG_CENTER_OFFSET[0] * scale;
    const targetPigY = (targetLeftY + targetRightY) / 2 + PIG_CENTER_OFFSET[1] * scale;
    const startPigX = (centers[0][0] + centers[1][0]) / 2 + PIG_CENTER_OFFSET[0] * scale;
    const startPigY = (centers[0][1] + centers[1][1]) / 2 + (PIG_CENTER_OFFSET[1] + PIG_ENTER_DROP) * scale;
    propPig.style.opacity = String(opacity);
    propPig.style.left = (startPigX + (targetPigX - startPigX) * move) + 'px';
    propPig.style.top = (startPigY + (targetPigY - startPigY) * move) + 'px';
    propPig.style.width = (PIG_W * scale * (0.86 + 0.14 * move)) + 'px';
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
    propChip.style.opacity = '';
  } else if (gamepadVisible) {
    const nowValue = performance.now();
    const pose = gamepadPose(nowValue);
    const elapsed = nowValue - gamepadStartAt;
    const enterT = Math.max(0, Math.min(1, elapsed / GAMEPAD_FADE_MS));
    const enter = enterT * enterT * (3 - 2 * enterT);
    const exitT = Math.max(0, Math.min(1, (GAMEPAD_PROP_MS - elapsed) / GAMEPAD_FADE_MS));
    const exit = exitT * exitT * (3 - 2 * exitT);
    const opacity = enter * exit;
    const move = enter * exit;
    const handW = GAMEPAD_HAND_W * scale;
    const midX = (centers[0][0] + centers[1][0]) / 2;
    const midY = (centers[0][1] + centers[1][1]) / 2;
    const pawY = midY + GAMEPAD_PAW_Y * scale;
    const targetLeftX = midX - GAMEPAD_PAW_SEP * 0.5 * scale + pose.lx * scale;
    const targetLeftY = pawY + pose.ly * scale;
    const targetRightX = midX + GAMEPAD_PAW_SEP * 0.5 * scale + pose.rx * scale;
    const targetRightY = pawY + pose.ry * scale;
    const leftX = centers[0][0] + (targetLeftX - centers[0][0]) * move;
    const leftY = centers[0][1] + (targetLeftY - centers[0][1]) * move;
    const rightX = centers[1][0] + (targetRightX - centers[1][0]) * move;
    const rightY = centers[1][1] + (targetRightY - centers[1][1]) * move;
    const targetPadX = (targetLeftX + targetRightX) / 2 + GAMEPAD_CENTER_OFFSET[0] * scale;
    const targetPadY = (targetLeftY + targetRightY) / 2 + GAMEPAD_CENTER_OFFSET[1] * scale;
    const startPadY = pawY + (GAMEPAD_CENTER_OFFSET[1] + GAMEPAD_ENTER_DROP) * scale;
    propGamepad.style.opacity = String(opacity);
    propGamepad.style.left = targetPadX + 'px';
    propGamepad.style.top = (startPadY + (targetPadY - startPadY) * move) + 'px';
    propGamepad.style.width = (GAMEPAD_W * scale * (0.9 + 0.1 * move) * pose.scale) + 'px';
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
    propChip.style.opacity = '';
  } else if (helloVisible) {
    const nowValue = performance.now();
    const pose = helloPose(nowValue);
    const restore = helloRestoreProgress(nowValue - helloStartAt);
    const handW = CHIPS_HAND_W * scale;
    const mid = [
      (centers[0][0] + centers[1][0]) / 2,
      (centers[0][1] + centers[1][1]) / 2,
    ];
    propHandLeft.style.opacity = String(1 - restore);
    propHandLeft.style.left = (centers[0][0] + pose.handX * scale) + 'px';
    const handY = HELLO_HAND_ANCHOR[1] * (1 - restore) + pose.handY;
    propHandLeft.style.top = (centers[0][1] + handY * scale) + 'px';
    propHandLeft.style.width = handW + 'px';
    propHandLeft.style.transform = 'translate(-50%, -50%) rotate(' + pose.handRot + 'deg)';
    propHandRight.style.opacity = String(1 - restore);
    propHandRight.style.left = centers[1][0] + 'px';
    propHandRight.style.top = centers[1][1] + 'px';
    propHandRight.style.width = handW + 'px';
    propHandRight.style.transform = 'translate(-50%, -50%)';
    propHello.style.left = (mid[0] + HELLO_TEXT_ANCHOR[0] * scale) + 'px';
    propHello.style.top = (mid[1] + (HELLO_TEXT_ANCHOR[1] + pose.textY) * scale) + 'px';
    propHello.style.width = (HELLO_TEXT_W * scale) + 'px';
    propHello.style.transform = 'translate(-50%, -50%) rotate(' + pose.textRot + 'deg)';
    propHello.style.opacity = String(1 - restore);
  } else if (droolVisible) {
    const nowValue = performance.now();
    const elapsed = nowValue - droolStartAt;
    const nodT = elapsed < DROOL_START_MS
      ? 0.5 - 0.5 * Math.cos(2 * Math.PI * elapsed / DROOL_NOD_PERIOD_MS)
      : 0;
    const bobY = DROOL_NOD_Y * nodT;
    const centerX = app.screen.width / 2;
    const centerY = app.screen.height / 2;

    propPigSticker.style.left = (centerX + DROOL_STICKER_ANCHOR[0] * scale) + 'px';
    propPigSticker.style.top = (centerY + (DROOL_STICKER_ANCHOR[1] + bobY) * scale) + 'px';
    propPigSticker.style.width = (DROOL_STICKER_W * scale) + 'px';
    propPigSticker.style.transform = 'translate(-50%, -50%)';

    let dropT = Math.max(0, Math.min(1, (elapsed - DROOL_START_MS) / (DROOL_FULL_MS - DROOL_START_MS)));
    dropT = dropT * dropT * (3 - 2 * dropT);
    propDrool.style.left = (centerX + DROOL_ANCHOR[0] * scale) + 'px';
    propDrool.style.top = (centerY + DROOL_ANCHOR[1] * scale) + 'px';
    propDrool.style.width = (DROOL_W * scale) + 'px';
    propDrool.style.transformOrigin = 'top center';
    propDrool.style.transform = 'translate(-50%, 0) scaleY(' + (0.12 + 0.88 * dropT) + ')';
    propDrool.style.opacity = String(dropT);
  } else if (questionVisible) {
    const elapsed = performance.now() - questionStartAt;
    const centerX = app.screen.width / 2;
    const centerY = app.screen.height / 2;
    for (const particle of propQuestions) {
      const pose = questionParticlePose(particle, elapsed);
      if (!pose || !particle.el) continue;
      particle.el.style.left = (centerX + pose.x * scale) + 'px';
      particle.el.style.top = (centerY + pose.y * scale) + 'px';
      particle.el.style.width = (QUESTION_W * scale * pose.scale) + 'px';
      particle.el.style.transform = 'translate(-50%, -50%) rotate(' + pose.rot + 'deg)';
      particle.el.style.opacity = String(pose.opacity);
    }
  } else if (ideaVisible) {
    const elapsed = performance.now() - ideaStartAt;
    const centerX = app.screen.width / 2;
    const centerY = app.screen.height / 2;
    const restore = ideaRestoreProgress(elapsed);
    const handXModel = ideaHandX(elapsed);
    const handX = (centerX + handXModel * scale) * (1 - restore) + centers[0][0] * restore;
    const handY = (centerY + IDEA_HAND_Y * scale) * (1 - restore) + centers[0][1] * restore;
    propIdeaHand.style.opacity = String(1 - restore);
    propIdeaHand.style.left = handX + 'px';
    propIdeaHand.style.top = handY + 'px';
    propIdeaHand.style.width = (IDEA_HAND_W * scale) + 'px';
    propIdeaHand.style.transform = 'translate(-50%, -50%) rotate(10deg)';
    propHandLeft.style.opacity = '0';
    propHandRight.style.opacity = String(1 - restore);
    propHandRight.style.left = centers[1][0] + 'px';
    propHandRight.style.top = centers[1][1] + 'px';
    propHandRight.style.width = (CHIPS_HAND_W * scale) + 'px';
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
    propLightbulb.style.left = (centerX + IDEA_BULB_ANCHOR[0] * scale) + 'px';
    propLightbulb.style.top = (centerY + IDEA_BULB_ANCHOR[1] * scale) + 'px';
    propLightbulb.style.width = (IDEA_BULB_W * scale * (0.28 + 0.72 * bulbT)) + 'px';
    propLightbulb.style.transform = 'translate(-50%, -50%) rotate(-30deg)';
    propLightbulb.style.opacity = String(bulbT * (1 - restore));
  } else if (thinkingVisible) {
    const centerX = app.screen.width / 2;
    const centerY = app.screen.height / 2;
    const handXModel = thinkingHandX(performance.now() - thinkingStartAt);
    propThinkingHand.style.opacity = '1';
    propThinkingHand.style.left = (centerX + handXModel * scale) + 'px';
    propThinkingHand.style.top = (centerY + THINKING_HAND_Y * scale) + 'px';
    propThinkingHand.style.width = (THINKING_HAND_W * scale) + 'px';
    propThinkingHand.style.transform = 'translate(-50%, -50%) rotate(10deg)';
    propHandLeft.style.opacity = '0';
    propHandRight.style.opacity = '1';
    propHandRight.style.left = centers[1][0] + 'px';
    propHandRight.style.top = centers[1][1] + 'px';
    propHandRight.style.width = (CHIPS_HAND_W * scale) + 'px';
    propHandRight.style.transform = 'translate(-50%, -50%)';

    propThinkingLoading.style.left = (centerX + THINKING_LOADING_ANCHOR[0] * scale) + 'px';
    propThinkingLoading.style.top = (centerY + THINKING_LOADING_ANCHOR[1] * scale) + 'px';
    propThinkingLoading.style.width = (THINKING_LOADING_W * scale) + 'px';
    propThinkingLoading.style.transform = 'translate(-50%, -50%)';

    propDrool.style.left = (centerX + DROOL_ANCHOR[0] * scale) + 'px';
    propDrool.style.top = (centerY + DROOL_ANCHOR[1] * scale) + 'px';
    propDrool.style.width = (THINKING_DROOL_W * scale) + 'px';
    propDrool.style.transformOrigin = 'top center';
    propDrool.style.transform = 'translate(-50%, 0) scaleY(1)';
    propDrool.style.opacity = '1';
  }
});

/* ---------------- 动作列表 ---------------- */

const actions = [];   // { name, label, group, index, url, duration }
let current = -1;

async function boot() {
  try {
    model = await Live2DModel.from(MODEL_PATH, { autoInteract: false });
  } catch (err) { fail('模型加载失败 — ' + err.message); return; }
  model.anchor.set(0.5, 0.5);
  app.stage.addChild(model);
  nativeW = model.width;
  nativeH = model.height;
  layoutModel();
  paws = resolvePaws();

  // 从模型自己的登记表里取动作（分组名 + 序号都由引擎给，不写死）
  const defs = model.internalModel.motionManager.definitions || {};
  for (const group of Object.keys(defs)) {
    defs[group].forEach((def, index) => {
      const file = String(def.File).split('/').pop();
      const name = file.replace('.motion3.json', '');
      actions.push({ name, label: getMotionActionDefinition(name)?.label || name, group, index, url: '/model/daimeow/motions/' + name + '.motion3.json', duration: 0 });
    });
  }
  // 预读时长，供「全部依次播放」用，也顺便提前发现坏文件
  await Promise.all(actions.map(async (a) => {
    try {
      const j = await (await fetch(a.url)).json();
      a.duration = (j.Meta && j.Meta.Duration) || 1.2;
    } catch (err) { a.duration = 1.2; }
  }));
  renderList();
}

function renderList() {
  const list = $('motionList');
  list.innerHTML = '';
  for (const a of actions) {
    const b = document.createElement('button');
    b.innerHTML = a.label + '<small>' + a.name + ' · ' + a.group + '[' + a.index + ']</small>';
    b.onclick = () => play(actions.indexOf(a));
    a.el = b;
    list.appendChild(b);
  }
}

function highlight() {
  actions.forEach((a, i) => a.el && a.el.classList.toggle('active', i === current));
}

function play(i) {
  if (i < 0 || i >= actions.length || !model) return;
  current = i;
  const a = actions[i];
  propUntil = 0; helloStartAt = 0; droolStartAt = 0; questionStartAt = 0; ideaStartAt = 0; thinkingStartAt = 0; chipsStartAt = 0; chipsCycles = 0; pigStartAt = 0; gamepadStartAt = 0;
  hideAllPreviewProps();
  if (a.name === CHEER) propUntil = performance.now() + CHEER_PROP_MS;
  if (a.name === CHIPS_ACTION || a.name === CHIPS_TWO_ACTION) {
    chipsCycles = a.name === CHIPS_TWO_ACTION ? 2 : 1;
    chipsStartAt = performance.now();
  }
  if (a.name === HELLO_ACTION) helloStartAt = performance.now();
  if (a.name === DROOL_ACTION) droolStartAt = performance.now();
  if (a.name === QUESTION_ACTION) questionStartAt = performance.now();
  if (a.name === IDEA_ACTION) ideaStartAt = performance.now();
  if (a.name === THINKING_ACTION) thinkingStartAt = performance.now();
  if (a.name === PIG_ACTION) pigStartAt = performance.now();
  if (a.name === GAMEPAD_ACTION) gamepadStartAt = performance.now();
  model.motion(a.group, a.index, MotionPriority.FORCE);
  highlight();
  showDetail(a);
}

// 坐 / 站：走表情通道。注意引擎在「要设的表情已经是当前表情」时会直接返回 false 空跑，
// 而取消表情并不会清掉「当前表情」指针，所以站起之后再坐下要改用 restoreExpression。
function setSit(sitting) {
  if (!model) return;
  const em = model.internalModel.motionManager.expressionManager;
  if (!em) return;
  if (!sitting) { em.resetExpression(); return; }
  const index = em.getExpressionIndex(SIT_EXPRESSION);
  if (index < 0) return;
  if (em.expressions[index]) em.restoreExpression();
  else em.setExpression(SIT_EXPRESSION);
}

document.querySelectorAll('[data-expr]').forEach((btn) => {
  btn.onclick = () => {
    const sit = btn.dataset.expr === 'sit';
    setSit(sit);
    document.querySelectorAll('[data-expr]').forEach((b) => b.classList.toggle('active', b === btn));
    $('detail').innerHTML = '<div class="name">' + (sit ? '坐下' : '站起') + '</div>'
      + '<div>走模型自带的坐姿开关 <code>' + SIT_EXPRESSION + '</code>：把 <code>Param</code> 置 1 / 淡回 0。'
      + '这条通道与动作曲线互不干扰，所以坐着也能照常点头、抖耳朵。</div>';
  };
});

/* ---------------- 明细与自检 ---------------- */

const fmt = (v) => (v === undefined || v === null ? '-' : (Math.round(v * 1000) / 1000).toString());

async function showDetail(a) {
  const box = $('detail');
  box.innerHTML = '<div class="name">' + a.label + ' <span style="font-weight:400;color:#9AACBE">' + a.name + '</span></div><div>读取中…</div>';
  let j;
  try { j = await (await fetch(a.url + '?t=' + Date.now())).json(); }
  catch (err) { box.innerHTML = '<div class="name">' + a.label + '</div><div class="bad">动作文件读不出来：' + err.message + '</div>'; return; }

  const core = model.internalModel.coreModel.getModel();
  const ranges = new Map();
  for (let i = 0; i < core.parameters.count; i++) {
    ranges.set(core.parameters.ids[i], [core.parameters.minimumValues[i], core.parameters.maximumValues[i]]);
  }

  const meta = j.Meta || {};
  const issues = [];
  const rows = [];
  let segSum = 0;
  for (const c of j.Curves || []) {
    const S = c.Segments || [];
    const vals = [];
    let lastT = -1;
    const n = (S.length - 2) / 3;
    if (!Number.isInteger(n) || n < 1) issues.push(c.Id + '：Segments 长度不是 2+3n');
    if (S[0] !== 0) issues.push(c.Id + '：起始时间不是 0');
    // 逐点校验（Cubism 4 的写法是「类型在前」：t0,v0, 类型,t1,v1, 类型,t2,v2 …）
    for (let i = 2; i < S.length; i += 3) {
      const type = S[i];
      if (type !== 0 && type !== 1 && type !== 2 && type !== 3) { issues.push(c.Id + '：段类型非法（' + type + '），可能是「类型在前/在后」写反了'); break; }
      const t = S[i + 1], v = S[i + 2];
      if (!(t > lastT)) { issues.push(c.Id + '：时间没有递增'); break; }
      lastT = t;
      vals.push(v);
    }
    vals.unshift(S[1]);
    segSum += n;
    if (!ranges.has(c.Id)) issues.push(c.Id + '：模型里没有这个参数');
    else {
      const [lo, hi] = ranges.get(c.Id);
      const out = vals.filter((v) => v < lo - 1e-6 || v > hi + 1e-6);
      if (out.length) issues.push(c.Id + '：有 ' + out.length + ' 个值超出模型范围 [' + lo + ', ' + hi + ']');
    }
    if (Math.abs(lastT - meta.Duration) > 1e-6) issues.push(c.Id + '：末点时间 ' + fmt(lastT) + ' 与 Duration ' + fmt(meta.Duration) + ' 不一致');
    rows.push({
      id: c.Id,
      range: vals.length ? Math.min(...vals).toFixed(2) + ' ~ ' + Math.max(...vals).toFixed(2) : '-',
      last: vals.length ? vals[vals.length - 1].toFixed(2) : '-',
      allowed: ranges.has(c.Id) ? '[' + ranges.get(c.Id)[0] + ', ' + ranges.get(c.Id)[1] + ']' : '模型里没有',
    });
  }
  const curves = (j.Curves || []).length;
  if (meta.CurveCount !== curves) issues.push('Meta.CurveCount ' + meta.CurveCount + ' 与实际曲线数 ' + curves + ' 不一致');
  if (meta.TotalSegmentCount !== segSum) issues.push('Meta.TotalSegmentCount ' + meta.TotalSegmentCount + ' 与实际 ' + segSum + ' 不一致（引擎会读越界报 basePointIndex）');
  const ids = (j.Curves || []).map((c) => c.Id);
  if (new Set(ids).size !== ids.length) issues.push('有重复的曲线参数');

  box.innerHTML = '<div class="name">' + a.label + ' <span style="font-weight:400;color:#9AACBE">' + a.name + '</span></div>'
    + '<div>分组 <b>' + a.group + '[' + a.index + ']</b>　时长 <b>' + fmt(meta.Duration) + 's</b>　'
    + '淡入/淡出 ' + fmt(meta.FadeInTime) + '/' + fmt(meta.FadeOutTime) + 's　曲线 ' + curves + ' 条</div>'
    + (a.name === CHEER ? '<div class="ok">跳这段时会显示手上的啦啦球（右边有开关）</div>' : '')
    + '<table><tr><th>参数</th><th>取值</th><th>末值</th><th>模型允许</th></tr>'
    + rows.map((r) => '<tr><td>' + r.id.replace(/^Param/, '') + '</td><td class="num">' + r.range + '</td><td class="num">' + r.last + '</td><td class="num">' + r.allowed + '</td></tr>').join('')
    + '</table>'
    + '<div id="issues">' + (issues.length
      ? issues.map((t) => '<div class="bad">⚠ ' + t + '</div>').join('')
      : '<div class="ok">✓ 结构、时间线、取值范围都正常</div>') + '</div>';
}

/* ---------------- 交互 ---------------- */

let playingAll = false;
$('playAll').onclick = async () => {
  if (playingAll) { playingAll = false; $('playAll').classList.remove('on'); return; }
  playingAll = true;
  $('playAll').classList.add('on');
  for (let i = 0; i < actions.length && playingAll; i++) {
    play(i);
    await new Promise((r) => setTimeout(r, actions[i].duration * 1000 + 450));
  }
  playingAll = false;
  $('playAll').classList.remove('on');
};

$('reload').onclick = () => location.reload();

document.addEventListener('keydown', (e) => {
  if (e.code === 'Space') { e.preventDefault(); play(current < 0 ? 0 : current); }
  else if (e.code === 'ArrowRight') { e.preventDefault(); play((current + 1) % Math.max(1, actions.length)); }
  else if (e.code === 'ArrowLeft') { e.preventDefault(); play((current - 1 + actions.length) % Math.max(1, actions.length)); }
});

propLeft.src = ASSETS.left;
propRight.src = ASSETS.right;
propHello.src = '/src/renderer/pet/assets/hello.png';
for (const particle of propQuestions) particle.el.src = '/src/renderer/pet/assets/question.png';
propIdeaHand.src = '/src/renderer/pet/assets/idea_hand.png';
propLightbulb.src = '/src/renderer/pet/assets/lightbulb.png';
propThinkingHand.src = '/src/renderer/pet/assets/idea_hand.png';
propThinkingLoading.src = '/src/renderer/pet/assets/thinking_loading.gif';
propPigSticker.src = '/src/renderer/pet/assets/pig_sticker.png';
propDrool.src = '/src/renderer/pet/assets/drool.png';
propChips.src = '/src/renderer/pet/assets/chips.png';
propPig.src = '/src/renderer/pet/assets/pig.png';
propGamepad.src = '/src/renderer/pet/assets/gamepad.png';
propChip.src = '/src/renderer/pet/assets/chip.png';
propHandLeft.src = '/src/renderer/pet/assets/hand_left.png';
propHandRight.src = '/src/renderer/pet/assets/hand_right.png';
boot();
