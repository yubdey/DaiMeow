import test from 'node:test';
import assert from 'node:assert/strict';
import { createActionController } from '../src/renderer/pet/action-controller.js';

function createHarness() {
  let now = 1000;
  let randomValue = 0;
  let nextTimerId = 1;
  const timers = new Map();
  const calls = [];
  const controller = createActionController({
    playAction: (name, priority) => calls.push({ name, priority }),
    isWindowVisible: () => true,
    isMotionPlaying: () => false,
    sitAction: 'sit',
    standAction: 'stand_up',
    idlePriority: 1,
    forcePriority: 3,
    stateStand: 'stand',
    stateSit: 'sit',
    random: () => randomValue,
    now: () => now,
    setTimeoutFn: (fn, delay) => {
      const id = nextTimerId++;
      timers.set(id, { fn, delay });
      return id;
    },
    clearTimeoutFn: (id) => timers.delete(id),
    idleMinMs: 5000,
    idleMaxMs: 15000,
    clickCooldownMs: 350,
    stateMinMs: 60000,
    stateMaxMs: 120000,
    sitWeight: 0.3,
  });
  return {
    controller,
    calls,
    timers,
    setNow: (value) => { now = value; },
    setRandom: (value) => { randomValue = value; },
    runTimer: (delay) => {
      const entry = [...timers.entries()].find(([, timer]) => timer.delay === delay);
      assert.ok(entry, `timer with delay ${delay} not found`);
      const [id, timer] = entry;
      timers.delete(id);
      timer.fn();
    },
  };
}

test('待机计时器按可见性和播放状态选择动作并继续续期', () => {
  const harness = createHarness();
  harness.controller.setPools({ idleStand: ['nod', 'blink'], idleSit: [], click: [], clickSit: [] });
  harness.controller.start();
  harness.runTimer(5000);
  assert.deepEqual(harness.calls, [{ name: 'nod', priority: 1 }]);
  assert.ok([...harness.timers.values()].some((timer) => timer.delay === 5000));
});

test('点击冷却生效，并且坐下状态使用坐姿点击池', () => {
  const harness = createHarness();
  harness.controller.setPools({ idleStand: [], idleSit: [], click: ['nod', 'blink'], clickSit: ['blink'] });
  harness.controller.setCanSit(true);
  harness.controller.reactToClick();
  harness.controller.reactToClick();
  assert.deepEqual(harness.calls, [{ name: 'nod', priority: 3 }]);
  harness.setNow(2000);
  harness.controller.reactToClick();
  assert.deepEqual(harness.calls.slice(-1), [{ name: 'blink', priority: 3 }]);
});

test('站坐状态机按权重切换并支持坐姿不可用回退', () => {
  const harness = createHarness();
  harness.controller.setPools({ idleStand: [], idleSit: [], click: [], clickSit: [] });
  harness.controller.setCanSit(true);
  harness.controller.start();
  harness.runTimer(60000);
  assert.equal(harness.controller.getState().currentState, 'sit');
  assert.deepEqual(harness.calls, [{ name: 'sit', priority: undefined }]);
  assert.equal(harness.controller.applyState('stand'), true);
  assert.equal(harness.controller.getState().currentState, 'stand');
  assert.deepEqual(harness.calls.slice(-1), [{ name: 'stand_up', priority: undefined }]);
  harness.controller.setCanSit(false);
  assert.equal(harness.controller.getState().currentState, 'stand');
});