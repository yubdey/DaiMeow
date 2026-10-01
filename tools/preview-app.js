/**
 * 呆喵动作预览（开发工具，不参与桌宠运行）
 * ------------------------------------------------------------------
 * 左边是大尺寸的模型，右边列出 model3.json 里登记的全部动作，点一下就能播；
 * 还可以看当前动作的曲线明细和自检结果，方便调动作参数。
 * 由 preview.bat 打包成 tools/preview-bundle.js 后，配合 tools/preview-server.cjs 打开。
 */
import * as PIXI from 'pixi.js';
import { Live2DModel, MotionPriority } from 'pixi-live2d-display/cubism4';

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
  const chipsElapsed = chipsStartAt ? now - chipsStartAt : -1;
  const pigElapsed = pigStartAt ? now - pigStartAt : -1;
  const gamepadElapsed = gamepadStartAt ? now - gamepadStartAt : -1;
  if (chipsStartAt && chipsElapsed >= chipsPlaybackMs()) { chipsStartAt = 0; chipsCycles = 0; }
  if (pigStartAt && pigElapsed >= PIG_PROP_MS) pigStartAt = 0;
  if (gamepadStartAt && gamepadElapsed >= GAMEPAD_PROP_MS) gamepadStartAt = 0;
  const opacity = chipsStartAt ? handsOpacityAt(chipsElapsed)
    : (pigStartAt ? pigHandsOpacityAt(pigElapsed) : (gamepadStartAt ? gamepadHandsOpacityAt(gamepadElapsed) : 1));
  try {
    model.internalModel.coreModel.setPartOpacityById(PART_HANDS, opacity);
  } catch (err) { /* 忽略 */ }
}, null, PIXI.UPDATE_PRIORITY.LOW);
// 动作名 → 中文标签（和桌宠里那套叫法一致）
const LABELS = {
  nod: '点头', shake_head: '摇头', look_left: '看左', look_right: '看右',
  look_up: '抬头', look_down: '低头', blink: '耳朵抖动1', ear_twitch: '耳朵抖动2',
  happy: '开心', surprised: '惊讶', sad: '难过', cheer: '啦啦啦', hold_pig: '抱小猪', play_game: '玩游戏',
  eat_chips: '吃一片薯片', eat_two_chips: '吃两片薯片',
};

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
  const chipsVisible = propsOn && chipsStartAt > 0 && (performance.now() - chipsStartAt) < chipsPlaybackMs();
  const pigVisible = propsOn && pigStartAt > 0 && (performance.now() - pigStartAt) < PIG_PROP_MS;
  const gamepadVisible = propsOn && gamepadStartAt > 0 && (performance.now() - gamepadStartAt) < GAMEPAD_PROP_MS;

  const ballCls = ballsVisible ? 'show' : '';
  if (propLeft.className !== ballCls) { propLeft.className = ballCls; propRight.className = ballCls; }
  const chipsCls = chipsVisible ? 'show' : '';
  if (propChips.className !== chipsCls) propChips.className = chipsCls;
  if (propChip.className !== chipsCls) propChip.className = chipsCls;
  const pigCls = pigVisible ? 'show' : '';
  if (propPig.className !== pigCls) propPig.className = pigCls;
  const gamepadCls = gamepadVisible ? 'show' : '';
  if (propGamepad.className !== gamepadCls) propGamepad.className = gamepadCls;
  const handCls = (chipsVisible || pigVisible || gamepadVisible) ? 'show' : '';
  if (propHandLeft.className !== handCls) propHandLeft.className = handCls;
  if (propHandRight.className !== handCls) propHandRight.className = handCls;
  if ((!ballsVisible && !chipsVisible && !pigVisible && !gamepadVisible) || !paws) { if (propChip) propChip.style.opacity = ''; if (propPig) propPig.style.opacity = ''; if (propGamepad) propGamepad.style.opacity = ''; if (propHandLeft) propHandLeft.style.opacity = ''; if (propHandRight) propHandRight.style.opacity = ''; return; }

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
      actions.push({ name, label: LABELS[name] || name, group, index, url: '/model/daimeow/motions/' + name + '.motion3.json', duration: 0 });
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
  propUntil = 0; chipsStartAt = 0; chipsCycles = 0; pigStartAt = 0; gamepadStartAt = 0;
  if (a.name === CHEER) propUntil = performance.now() + CHEER_PROP_MS;
  if (a.name === CHIPS_ACTION || a.name === CHIPS_TWO_ACTION) {
    chipsCycles = a.name === CHIPS_TWO_ACTION ? 2 : 1;
    chipsStartAt = performance.now();
  }
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
propChips.src = '/src/renderer/pet/assets/chips.png';
propPig.src = '/src/renderer/pet/assets/pig.png';
propGamepad.src = '/src/renderer/pet/assets/gamepad.png';
propChip.src = '/src/renderer/pet/assets/chip.png';
propHandLeft.src = '/src/renderer/pet/assets/hand_left.png';
propHandRight.src = '/src/renderer/pet/assets/hand_right.png';
boot();
