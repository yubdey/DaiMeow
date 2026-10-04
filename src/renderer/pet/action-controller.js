// 纯动作控制器：不直接操作 DOM、PIXI 或 Live2D。
// 它负责池子选择、随机待机、点击冷却和站坐状态机；具体播放和窗口状态由调用方注入。
export function createActionController(options) {
  const {
    playAction,
    isWindowVisible,
    isMotionPlaying,
    sitAction,
    standAction,
    idlePriority,
    forcePriority,
    stateStand,
    stateSit,
    random = Math.random,
    now = () => Date.now(),
    setTimeoutFn = globalThis.setTimeout,
    clearTimeoutFn = globalThis.clearTimeout,
    idleMinMs,
    idleMaxMs,
    clickCooldownMs,
    stateMinMs,
    stateMaxMs,
    sitWeight,
  } = options;

  let pools = { idleStand: [], idleSit: [], click: [], clickSit: [] };
  let currentState = stateStand;
  let canSit = true;
  let idleActionTimer = null;
  let stateTimer = null;
  let lastReactAt = 0;
  const lastPlayed = { idle: null, click: null };

  function clearTimer(timer) {
    if (timer !== null) clearTimeoutFn(timer);
    return null;
  }

  function setPools(nextPools) {
    pools = {
      idleStand: [...(nextPools.idleStand || [])],
      idleSit: [...(nextPools.idleSit || [])],
      click: [...(nextPools.click || [])],
      clickSit: [...(nextPools.clickSit || [])],
    };
  }

  function setCanSit(value) {
    canSit = !!value;
    if (!canSit) currentState = stateStand;
  }

  function applyState(target) {
    if (target !== stateStand && target !== stateSit) return false;
    if (target === stateSit && !canSit) return false;
    if (target === currentState) return true;
    playAction(target === stateSit ? sitAction : standAction);
    currentState = target;
    return true;
  }

  function poolForCurrentState(poolName) {
    if (poolName === 'idle') return currentState === stateSit ? pools.idleSit : pools.idleStand;
    if (poolName === 'click') return currentState === stateSit ? pools.clickSit : pools.click;
    return pools[poolName];
  }

  function playRandomAction(poolName, priority) {
    const pool = poolForCurrentState(poolName);
    if (!pool || pool.length === 0) return null;

    const previous = lastPlayed[poolName];
    let candidates = pool;
    if (pool.length > 1 && previous) {
      const filtered = pool.filter((name) => name !== previous);
      if (filtered.length) candidates = filtered;
    }
    const picked = candidates[Math.floor(random() * candidates.length)];
    lastPlayed[poolName] = picked;
    playAction(picked, priority);
    return picked;
  }

  function scheduleIdleAction() {
    idleActionTimer = clearTimer(idleActionTimer);
    const delay = idleMinMs + random() * (idleMaxMs - idleMinMs);
    idleActionTimer = setTimeoutFn(() => {
      idleActionTimer = null;
      if (isWindowVisible() && !isMotionPlaying()) {
        playRandomAction('idle', idlePriority);
      }
      scheduleIdleAction();
    }, delay);
  }

  function pickNextState() {
    if (!canSit) return stateStand;
    return random() < sitWeight ? stateSit : stateStand;
  }

  function scheduleStateSwitch() {
    stateTimer = clearTimer(stateTimer);
    stateTimer = setTimeoutFn(() => {
      stateTimer = null;
      applyState(pickNextState());
      scheduleStateSwitch();
    }, stateMinMs + random() * (stateMaxMs - stateMinMs));
  }

  function start() {
    stop();
    scheduleIdleAction();
    scheduleStateSwitch();
  }

  function stop() {
    idleActionTimer = clearTimer(idleActionTimer);
    stateTimer = clearTimer(stateTimer);
  }

  function reactToClick() {
    const current = now();
    if (current - lastReactAt < clickCooldownMs) return null;
    lastReactAt = current;
    if (!isWindowVisible()) return null;
    return playRandomAction('click', forcePriority);
  }

  function getState() {
    return {
      currentState,
      canSit,
      lastPlayed: { ...lastPlayed },
      pools: {
        idleStand: [...pools.idleStand],
        idleSit: [...pools.idleSit],
        click: [...pools.click],
        clickSit: [...pools.clickSit],
      },
    };
  }

  return {
    setPools,
    setCanSit,
    applyState,
    start,
    stop,
    reactToClick,
    getState,
  };
}