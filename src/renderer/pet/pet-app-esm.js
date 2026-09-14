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
// 待机池：全部 11 个（点头 摇头 看左 看右 抬头 低头 耳朵抖动1 耳朵抖动2 开心 惊讶 难过）
const IDLE_ACTION_NAMES = [
  'nod', 'shake_head', 'look_left', 'look_right', 'look_up', 'look_down',
  'blink', 'ear_twitch', 'happy', 'surprised', 'sad',
];
// 点击回应池：7 个更像「在回应你」的动作（去掉单纯转头的看左/看右/抬头/低头）
const CLICK_ACTION_NAMES = ['nod', 'shake_head', 'blink', 'ear_twitch', 'happy', 'surprised', 'sad'];

// 待机动作的随机间隔（毫秒）
const IDLE_ACTION_MIN_MS = 8000;
const IDLE_ACTION_MAX_MS = 22000;
// 连点保护：两次点击回应至少隔这么久
const CLICK_REACT_COOLDOWN_MS = 350;

const actionPools = { idle: [], click: [] };
// 记住上一次播的动作，避免连着重复（引擎也会拒绝「同一动作正在播」）
const lastPlayed = { idle: null, click: null };
let idleActionTimer = null;
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
    buildActionPools();
    scheduleIdleAction();
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

// 气泡每行显示的字数
const CHARS_PER_LINE = 7;
// 字号 13px，中文字宽按 ~15px 保守估算（含字体间距），加左右 padding 32px
const BUBBLE_MAX_W = Math.round(CHARS_PER_LINE * 15 + 32);

petAPI.onShowSpeech((text) => {
  speechBubble.textContent = text;
  speechBubble.style.maxWidth = BUBBLE_MAX_W + 'px';
  speechBubble.classList.add('show');
  if (speechTimer) clearTimeout(speechTimer);
  speechTimer = setTimeout(() => speechBubble.classList.remove('show'), 6000);
});

petAPI.onResize((size) => {
  app.renderer.resize(size.w, size.h);
  applyLayout(false); // smooth transition
});
window.addEventListener('resize', () => {
  app.renderer.resize(window.innerWidth, window.innerHeight);
  applyLayout(false); // smooth transition
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

  // Speech bubble — positioned above model head, clamped within window
  const winW = app.screen.width;
  const winH = app.screen.height;
  const pad = 6;

  // 每行显示 ~7 个中文字（宽度由 CSS 用 em 控制，中文字宽≈1em）
  const bubbleW = speechBubble.offsetWidth || 140;
  const bubbleH = speechBubble.offsetHeight || 0;

  const headTop = currentCY - (nativeH * currentScale) / 2;
  const bubbleTop = headTop - bubbleH - pad;

  // Horizontal: center over model, clamped to window
  const leftMin = bubbleW / 2 + pad;
  const leftMax = winW - bubbleW / 2 - pad;
  const bubbleLeft = Math.max(leftMin, Math.min(currentCX, leftMax));

  // Vertical: above head, clamped
  const topClamped = Math.max(pad, bubbleTop);

  speechBubble.style.left = bubbleLeft + 'px';
  speechBubble.style.top = topClamped + 'px';
});

loadModel();

/* ---------------- 动作：待机随机动作 + 点击回应 ---------------- */

/**
 * 把动作名解析成 [分组, 序号]。
 * 分组与顺序都取自 model3.json 里登记的 Motions，不写死索引，
 * 以后在 model3.json 里调整动作顺序也不会失效。
 */
function buildActionPools() {
  const defs = (live2dModel && live2dModel.internalModel.motionManager.definitions) || {};
  const byName = new Map();
  for (const group of Object.keys(defs)) {
    defs[group].forEach((def, index) => {
      const file = String(def.File).split('/').pop();
      byName.set(file.replace('.motion3.json', ''), [group, index]);
    });
  }
  const resolve = (names) => names.map((n) => byName.get(n)).filter(Boolean);
  actionPools.idle = resolve(IDLE_ACTION_NAMES);
  actionPools.click = resolve(CLICK_ACTION_NAMES);

  const missing = IDLE_ACTION_NAMES.filter((n) => !byName.has(n));
  if (missing.length) petAPI.logError('待机动作缺失: ' + missing.join(', '));
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

/** 从指定动作池里随机挑一个播（避免与上一次重复） */
function playRandomAction(poolName, priority) {
  const pool = actionPools[poolName];
  if (!pool || pool.length === 0 || !live2dModel) return;

  const previous = lastPlayed[poolName];
  let candidates = pool;
  if (pool.length > 1 && previous) {
    const filtered = pool.filter(([g, i]) => g !== previous[0] || i !== previous[1]);
    if (filtered.length) candidates = filtered;
  }
  const picked = candidates[Math.floor(Math.random() * candidates.length)];
  lastPlayed[poolName] = picked;
  live2dModel.motion(picked[0], picked[1], priority);
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
