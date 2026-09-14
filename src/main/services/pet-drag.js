// 桌宠窗口的手动拖动。
//
// 背景：原来是靠 CSS 的 -webkit-app-region: drag 让系统拖动窗口，但「可拖动区域」
// 会吞掉所有鼠标事件（渲染进程收不到 pointerdown / click），而桌宠需要「点一下有反应」。
// 所以拖动改成页面实现：
//   pointerdown → pet:drag-start，pointerup → pet:drag-end
// 拖动期间由主进程按系统光标移动窗口（坐标用主进程的 screen，而不是渲染进程的
// screenX / screenY，避开高 DPI 缩放下两套坐标不一致的问题）。
//
// 「谁来决定移动的节拍」很关键：主进程自己的 setInterval 受 Windows 计时节拍
// （约 15.6ms）量化，实测窗口位置只能每 15.6ms 更新一次；屏幕是 165Hz，
// 于是位置更新在 2 帧 / 3 帧之间来回跳，一次 600px/s 的拖动里 59% 的帧完全没有位移，
// 看起来就是发顿。所以节拍改由渲染进程的 requestAnimationFrame 驱动（跟屏幕刷新对齐），
// 每帧调一次 pet:drag-tick，主进程这边只负责「按当前光标重新摆一次窗口」。
// 主进程仍保留一个低频兜底定时器：万一渲染进程的 rAF 停摆，窗口不会卡死在原地。
const { screen } = require('electron');

// 兜底检查间隔，以及判定「渲染进程停摆」的阈值
const DRAG_FALLBACK_MS = 16;
const DRAG_STALL_MS = 80;

class PetDragController {
  constructor(getPetWindow, getConfig) {
    this.getPetWindow = getPetWindow;
    this.getConfig = getConfig;
    this.timer = null;
    this.offset = null;
    this.size = null;
    this.lastTickAt = 0;
  }

  /** 开始跟手；固定位置模式下直接忽略 */
  start() {
    if (this.timer) return;
    const win = this.getPetWindow();
    if (!win || win.isDestroyed()) return;
    if (this.getConfig().fixedPosition) return;

    const cursor = screen.getCursorScreenPoint();
    const bounds = win.getBounds();
    this.offset = { x: cursor.x - bounds.x, y: cursor.y - bounds.y };
    // 记住窗口尺寸，后续用 setBounds 连尺寸一起写回（原因见 tick）
    this.size = { width: bounds.width, height: bounds.height };
    this.lastTickAt = Date.now();
    this.timer = setInterval(() => this.safetyTick(), DRAG_FALLBACK_MS);
  }

  /** 渲染进程每帧回调一次（跟手主路径），返回是否发生了移动 */
  tick() {
    this.lastTickAt = Date.now();
    return this.moveToCursor();
  }

  /** 兜底：渲染进程的 rAF 长时间没动静时才接管，避免窗口卡住不跟手 */
  safetyTick() {
    if (Date.now() - this.lastTickAt < DRAG_STALL_MS) return;
    this.moveToCursor();
  }

  moveToCursor() {
    const win = this.getPetWindow();
    if (!win || win.isDestroyed() || !this.offset || !this.size) {
      this.stop();
      return false;
    }
    const cursor = screen.getCursorScreenPoint();
    const bounds = win.getBounds();
    const x = cursor.x - this.offset.x;
    const y = cursor.y - this.offset.y;
    if (x === bounds.x && y === bounds.y
      && bounds.width === this.size.width && bounds.height === this.size.height) return false;

    // 必须带上宽高用 setBounds，不能用 setPosition。
    // 在非整数缩放（本机 150%）下，Windows 上每次 setPosition 都会让窗口尺寸
    // 悄悄变大一点点（实测每移动一小段就宽 2px，一次拖动下来 202px → 272px）。
    // 渲染进程随之收到一串 resize，重算 layout 缩放，表现就是拖动时模型闪烁并越拖越大。
    // 显式写回启动时的尺寸可以把这个漂移压住。
    win.setBounds({ x, y, width: this.size.width, height: this.size.height });
    return true;
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.offset = null;
    this.size = null;
    this.lastTickAt = 0;
  }
}

module.exports = { PetDragController };
