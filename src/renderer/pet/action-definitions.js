// 动作元数据的唯一来源：动作名、显示名，以及它在四个触发池里的成员关系。
// 这里只放“能不能被哪个触发源选中”的规则，不掺动 motion 曲线和道具几何数学。
export const ACTION_POOL_KEYS = Object.freeze({
  IDLE_STAND: 'idleStand',
  IDLE_SIT: 'idleSit',
  CLICK_STAND: 'click',
  CLICK_SIT: 'clickSit',
});

const POOL_KEYS = new Set(Object.values(ACTION_POOL_KEYS));

/**
 * @typedef {{
 *   id: string,
 *   label: string,
 *   pools: { idleStand: boolean, idleSit: boolean, click: boolean, clickSit: boolean }
 * }} MotionActionDefinition
 */

/** @type {MotionActionDefinition[]} */
export const MOTION_ACTION_DEFINITIONS = Object.freeze([
  { id: 'nod', label: '点头', pools: { idleStand: true, idleSit: true, click: true, clickSit: true } },
  { id: 'shake_head', label: '摇头', pools: { idleStand: true, idleSit: true, click: true, clickSit: true } },
  { id: 'look_left', label: '看左', pools: { idleStand: true, idleSit: true, click: false, clickSit: false } },
  { id: 'look_right', label: '看右', pools: { idleStand: true, idleSit: true, click: false, clickSit: false } },
  { id: 'look_up', label: '抬头', pools: { idleStand: true, idleSit: true, click: false, clickSit: false } },
  { id: 'look_down', label: '低头', pools: { idleStand: true, idleSit: true, click: false, clickSit: false } },
  { id: 'blink', label: '眨眼', pools: { idleStand: true, idleSit: true, click: true, clickSit: true } },
  { id: 'ear_twitch', label: '耳朵抖动', pools: { idleStand: true, idleSit: true, click: true, clickSit: true } },
  { id: 'happy', label: '开心', pools: { idleStand: true, idleSit: false, click: true, clickSit: false } },
  { id: 'surprised', label: '惊讶', pools: { idleStand: true, idleSit: false, click: true, clickSit: false } },
  { id: 'sad', label: '难过', pools: { idleStand: true, idleSit: false, click: true, clickSit: false } },
  { id: 'cheer', label: '啦啦啦', pools: { idleStand: true, idleSit: false, click: true, clickSit: false } },
  { id: 'hold_pig', label: '抱小猪', pools: { idleStand: true, idleSit: true, click: true, clickSit: true } },
  { id: 'play_game', label: '玩游戏', pools: { idleStand: true, idleSit: true, click: true, clickSit: true } },
  { id: 'eat_chips', label: '吃一片薯片', pools: { idleStand: true, idleSit: true, click: true, clickSit: true } },
  { id: 'eat_two_chips', label: '吃两片薯片', pools: { idleStand: true, idleSit: true, click: true, clickSit: true } },
  { id: 'hello', label: '打招呼', pools: { idleStand: true, idleSit: true, click: true, clickSit: true } },
  { id: 'drool', label: '流口水', pools: { idleStand: true, idleSit: true, click: true, clickSit: true } },
  { id: 'question', label: '问号', pools: { idleStand: true, idleSit: true, click: true, clickSit: true } },
  { id: 'idea', label: '灵光一闪', pools: { idleStand: true, idleSit: true, click: true, clickSit: true } },
  { id: 'thinking', label: '思考中', pools: { idleStand: true, idleSit: true, click: true, clickSit: true } },
]);

const actionById = new Map(MOTION_ACTION_DEFINITIONS.map((definition) => [definition.id, definition]));

/** @returns {MotionActionDefinition | null} */
export function getMotionActionDefinition(id) {
  return actionById.get(id) || null;
}

/** 按固定顺序返回某个触发池里的全部动作名；动作是否真的存在由调用方再按模型定义过滤。 */
export function getActionIdsForPool(poolName) {
  if (!POOL_KEYS.has(poolName)) {
    throw new Error('Unknown action pool: ' + poolName);
  }
  return MOTION_ACTION_DEFINITIONS
    .filter((definition) => definition.pools[poolName])
    .map((definition) => definition.id);
}

export function getAllMotionActionIds() {
  return MOTION_ACTION_DEFINITIONS.map((definition) => definition.id);
}

export function getMotionActionCount() {
  return MOTION_ACTION_DEFINITIONS.length;
}