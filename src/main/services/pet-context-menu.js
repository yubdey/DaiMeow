// 在桌宠身上点右键弹出的调整菜单。
//
// 为什么菜单放在主进程做：桌宠窗口只有 200x250 左右，菜单如果在页面里用 HTML 画，
// 会被窗口边界裁掉；用 Electron 的原生 Menu.popup 不受窗口尺寸限制，观感也和托盘
// 菜单一致。
//
// 尺寸口径跟「调整」面板保持完全一致：面板里显示的 1.0x 对应实际 petScale 0.5
// （显示值 = 实际缩放 x 2）。所以菜单上的 0.75x / 1.0x / 1.25x 分别是
// petScale 0.375 / 0.5 / 0.625，两边显示的数值永远对得上。
const { Menu } = require('electron');

// 菜单里提供的三档显示倍数
const SCALE_PRESETS = [0.75, 1.0, 1.25];
const displayToScale = (display) => display * 0.5;
const formatScale = (display) => display.toFixed(2).replace(/0$/, '') + 'x';

/**
 * 构造菜单模板（纯函数，不碰 Electron，方便单测）。
 *
 * 开关项刻意用「构造时抓到的 state 取反」来决定目标状态，而不是读 click 回调里的
 * item.checked —— 后者依赖 Electron「先翻转勾选、再回调」的时序细节；原生菜单点一下就
 * 关闭、每次弹出都会用最新 state 重建模板，所以取反写法既确定又不会过期。
 *
 * @param {object} actions getState / setScale / setFixedPosition / setPassthrough /
 *                         setAlwaysOnTop / resetDefaults / quit
 */
function buildTemplate(actions, options = {}) {
  const state = options.state || {};
  const includeQuit = options.includeQuit !== false;
  const scaleNow = state.petScale ?? 0.5;
  const fixedNow = state.fixedPosition === true;
  const passthroughNow = state.mousePassthrough === true;
  // 缺省视为开启，跟 config-store 的默认值一致
  const topmostNow = state.alwaysOnTop !== false;

  const template = [
    {
      label: '调整大小',
      submenu: SCALE_PRESETS.map((display) => ({
        label: formatScale(display),
        type: 'radio',
        checked: Math.abs(scaleNow - displayToScale(display)) < 0.001,
        click: () => actions.setScale(displayToScale(display)),
      })),
    },
    { type: 'separator' },
    {
      label: '固定位置',
      type: 'checkbox',
      checked: fixedNow,
      click: () => actions.setFixedPosition(!fixedNow),
    },
    {
      label: '鼠标穿透',
      type: 'checkbox',
      checked: passthroughNow,
      click: () => actions.setPassthrough(!passthroughNow),
    },
    {
      label: '置于顶层',
      type: 'checkbox',
      checked: topmostNow,
      click: () => actions.setAlwaysOnTop(!topmostNow),
    },
    {
      label: '恢复默认',
      // 位置 / 大小 / 透明度 / 三个开关一起回出厂值（与「调整」面板的按钮同一套逻辑）。
      // 不做二次确认：跟面板行为保持一致，而且改错了重新调一下就行。
      click: () => actions.resetDefaults(),
    },
  ];

  if (includeQuit) {
    template.push({ type: 'separator' }, { label: '退出呆喵', click: () => actions.quit() });
  }

  return template;
}

/**
 * @param {object} actions 主进程注入的操作回调（见 buildTemplate）
 */
function createPetContextMenu(actions) {
  return {
    /** 在桌宠窗口上弹出菜单；模板每次重建，保证勾选状态是最新的 */
    popup(petWindow) {
      const menu = Menu.buildFromTemplate(buildTemplate(actions, { state: actions.getState() }));
      menu.popup({ window: petWindow });
    },
  };
}

module.exports = { createPetContextMenu, buildTemplate, SCALE_PRESETS };
