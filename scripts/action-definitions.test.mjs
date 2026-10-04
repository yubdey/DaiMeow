import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTION_POOL_KEYS,
  MOTION_ACTION_DEFINITIONS,
  getAllMotionActionIds,
  getActionIdsForPool,
  getMotionActionDefinition,
} from '../src/renderer/pet/action-definitions.js';

const STAND_IDLE = [
  'nod', 'shake_head', 'look_left', 'look_right', 'look_up', 'look_down',
  'blink', 'ear_twitch', 'happy', 'surprised', 'sad', 'cheer', 'hold_pig', 'play_game',
  'eat_chips', 'eat_two_chips', 'hello', 'drool', 'question', 'idea', 'thinking',
];
const SIT_IDLE = [
  'nod', 'shake_head', 'look_left', 'look_right', 'look_up', 'look_down',
  'blink', 'ear_twitch', 'hold_pig', 'play_game',
  'eat_chips', 'eat_two_chips', 'hello', 'drool', 'question', 'idea', 'thinking',
];
const CLICK_STAND = [
  'nod', 'shake_head', 'blink', 'ear_twitch', 'happy', 'surprised', 'sad', 'cheer',
  'hold_pig', 'play_game', 'eat_chips', 'eat_two_chips', 'hello', 'drool', 'question', 'idea', 'thinking',
];
const CLICK_SIT = [
  'nod', 'shake_head', 'blink', 'ear_twitch', 'hold_pig', 'play_game',
  'eat_chips', 'eat_two_chips', 'hello', 'drool', 'question', 'idea', 'thinking',
];

test('动作池保持既有成员和顺序', () => {
  assert.deepEqual(getActionIdsForPool(ACTION_POOL_KEYS.IDLE_STAND), STAND_IDLE);
  assert.deepEqual(getActionIdsForPool(ACTION_POOL_KEYS.IDLE_SIT), SIT_IDLE);
  assert.deepEqual(getActionIdsForPool(ACTION_POOL_KEYS.CLICK_STAND), CLICK_STAND);
  assert.deepEqual(getActionIdsForPool(ACTION_POOL_KEYS.CLICK_SIT), CLICK_SIT);
});

test('每个动作 ID 唯一且都能查询到定义', () => {
  const ids = getAllMotionActionIds();
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(MOTION_ACTION_DEFINITIONS.length, 21);
  for (const id of ids) {
    assert.equal(getMotionActionDefinition(id)?.id, id);
  }
});

test('坐姿点击池是点击池与坐姿池的交集', () => {
  const click = new Set(getActionIdsForPool(ACTION_POOL_KEYS.CLICK_STAND));
  const sit = new Set(getActionIdsForPool(ACTION_POOL_KEYS.IDLE_SIT));
  const expected = [...click].filter((id) => sit.has(id));
  assert.deepEqual(getActionIdsForPool(ACTION_POOL_KEYS.CLICK_SIT), expected);
});

test('未知动作池和未知动作会明确失败', () => {
  assert.throws(() => getActionIdsForPool('unknown'), /Unknown action pool/);
  assert.equal(getMotionActionDefinition('not-an-action'), null);
});