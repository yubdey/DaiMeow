// === DaiMeow Control Panel ===
const api = window.daimeowAPI;
let isRunning = false;

// --- Tab switching ---
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.panel').forEach(p =>
    p.classList.toggle('active', p.id === `panel-${tab}`));

  if (tab === 'history') refreshHistory();
  if (tab === 'config') loadConfigToForm();
  if (tab === 'personality') { loadPersonalities(); loadLifeTags(); }
}

// --- Start/Stop ---
const startBtn = document.getElementById('startBtn');

// 统一按钮显示：点击启动/停止、以及面板重载后都用它，避免 UI 与实际状态不一致
function setRunningUI(running) {
  isRunning = running;
  startBtn.textContent = running ? '停止运行' : '呆喵？启动！';
  startBtn.classList.toggle('running', running);
  startBtn.disabled = false;
  if (running) updateStatus('运行中');
}

startBtn.addEventListener('click', async () => {
  if (!isRunning) {
    startBtn.textContent = '启动中...';
    startBtn.disabled = true;
    try {
      await api.invoke('control:start');
      setRunningUI(true);
    } catch (err) {
      startBtn.textContent = '呆喵？启动！';
      startBtn.disabled = false;
      showError('启动失败: ' + err.message);
    }
  } else {
    await api.invoke('control:stop');
    setRunningUI(false);
    updateStatus('已停止');
  }
});

function updateStatus(text) {
  const ms = document.getElementById('mainStatus');
  if (text === '运行中') ms.textContent = '呆喵正陪着老大喵~';
  else if (text === '闲置中') ms.textContent = '呆喵在等你回来..';
  else ms.textContent = '呆喵准备就绪，喵！';
}

function formatUptime(s) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
  return `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
}

// --- Stats update listener ---
api.on('main:stats-update', (stats) => renderStats(stats));

/**
 * 把统计值画到首页。
 * 循环跑起来之后主进程每秒推一次 main:stats-update；但没点「启动」时没有这个推送，
 * 所以面板打开时还要用 control:get-stats 主动拉一次，否则首页会一直是占位的 0。
 */
function renderStats(stats) {
  if (!stats) return;
  document.getElementById('statMessages').textContent = stats.messages;
  document.getElementById('statTokens').textContent = stats.tokens;
  document.getElementById('statMiniTotalMessages').textContent = stats.totalMessages ?? 0;
  document.getElementById('statMiniTotalTokens').textContent = stats.totalTokensAll ?? 0;
  document.getElementById('statMiniTotalUptime').textContent = formatUptime(stats.totalUptime ?? 0);
  // Avg tokens per request
  const total = stats.totalMessages || 1;
  document.getElementById('statMiniAvgTokens').textContent = '~' + Math.round((stats.totalTokensAll || 0) / total);
  document.getElementById('statUptime').textContent = formatUptime(stats.uptime);
}

// --- Status changes ---
api.on('main:status-change', (status) => {
  if (status === 'idle') updateStatus('闲置中');
  else if (status === 'running') updateStatus('运行中');
  else updateStatus('已停止');
});

// --- New AI response ---
api.on('main:new-response', (msg) => {
  addHistoryMessage(msg);
  // 对话总数由 main:stats-update 统一更新，避免双通道竞争
});

// --- Error handling ---
api.on('main:error', (err) => {
  showError(humanizeApiError(err.message));
});

/**
 * 服务商返回的报错通常是「API 请求失败 (403): {"error":{...}}」这种一大段 JSON，
 * 直接塞进提示条又长又难读。这里把常见的几种翻成一句中文，其余至少只留 message 字段。
 * 只影响提示文案，请求逻辑不动。
 */
function humanizeApiError(raw) {
  const text = String(raw || '');
  const detail = (text.match(/"message"\s*:\s*"((?:[^"\\]|\\.)*)"/) || [])[1];
  const status = (text.match(/\((\d{3})\)/) || [])[1] || '';
  const code = (text.match(/"code"\s*:\s*"([^"]*)"/) || [])[1] || '';
  const tag = status ? `（${status}）` : '';
  const quota = /FreeTierOnly|AllocationQuota|Arrearage|quota|欠费|余额|free tier/i.test(text + code);

  if (quota) {
  return `服务商额度不足${tag}：请到控制台充值，或关闭「仅使用免费额度」模式；也可以换一个还有额度的视觉模型`;
  }
  if (status === '401' || /invalid.{0,3}api.{0,3}key|Unauthorized/i.test(text)) {
    return `API Key 无效或已过期${tag}：请在「设置」里重新填写并保存`;
  }
  if (status === '413') {
    return `请求体过大${tag}：服务商在模型处理前拒绝了上传内容。请完全退出并重启呆喵以加载“仅上传本轮截图”的修复；若仍失败，请检查设置里的接口地址（DeepSeek 应使用 /v1/chat/completions）`;
  }
  if (status === '404') {
    return `模型不存在或没有权限${tag}：请在「设置」的「视觉模型」里换一个`;
  }
  if (status === '429') {
    return `请求太频繁或额度受限${tag}：稍后再试，或把「截图间隔」调大一点`;
  }
  if (/timeout|aborted|ECONN|ENOTFOUND|fetch failed|network/i.test(text)) {
    return '网络不通或请求超时：检查网络／代理后重试';
  }
  if (detail) return detail.replace(/\\"/g, '"').slice(0, 140);
  return text.slice(0, 140);
}

function showError(msg) {
  showToast('错误: ' + msg);
}

// --- Config Panel ---
const PROVIDER_ENDPOINTS = {
  custom: '',
  moonshot: 'https://api.moonshot.cn/v1/chat/completions',
  volcano: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
  alibaba: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
  zhipu: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
  siliconflow: 'https://api.siliconflow.cn/v1/chat/completions',
  deepseek: 'https://api.deepseek.com/v1/chat/completions',
  mimo: 'https://token-plan-cn.xiaomimimo.com/v1/chat/completions',
  other: '',
};

const PROVIDER_MODELS = {
  custom: [],
  moonshot: [
    { name: 'Kimi K2.6', id: 'kimi-k2.6', inputPrice: '6.50 元/M tokens', outputPrice: '27.00 元/M tokens', note: '256K 上下文 · 支持图片/视频输入', cheap: true },
    { name: 'Kimi K3', id: 'kimi-k3', inputPrice: '20.00 元/M tokens', outputPrice: '100.00 元/M tokens', note: '旗舰 · 1M 上下文 · 支持图片/视频输入', cheap: false },
    { name: 'Kimi K2.7 Code 高速版', id: 'kimi-k2.7-code-highspeed', inputPrice: '13.00 元/M tokens', outputPrice: '54.00 元/M tokens', note: '代码向高速版 · 支持图片输入', cheap: false },
  ],
  volcano: [
    { name: '豆包 Seed 2.1 Lite', id: 'doubao-seed-2.1-lite', inputPrice: '0.80 元/M tokens', outputPrice: '2.70 元/M tokens', note: '轻量 · 多模态理解', cheap: true },
    { name: '豆包 Seed 2.1 Turbo', id: 'doubao-seed-2.1-turbo', inputPrice: '3.00 元/M tokens', outputPrice: '15.00 元/M tokens', note: '多模态理解 · 上下文 256K', cheap: false },
    { name: '豆包 Seed 2.1 Pro', id: 'doubao-seed-2.1-pro', inputPrice: '6.00 元/M tokens', outputPrice: '30.00 元/M tokens', note: '旗舰 · 多模态理解 · 上下文 1M', cheap: false },
    { name: '豆包 Seed Evolving', id: 'doubao-seed-evolving', inputPrice: '6.00 元/M tokens', outputPrice: '30.00 元/M tokens', note: '快速迭代版 · 多模态理解', cheap: false },
  ],
  alibaba: [
    { name: 'Qwen3-VL-Flash', id: 'qwen3-vl-flash', inputPrice: '0.15 元/M tokens（≤32K）', outputPrice: '1.50 元/M tokens（≤32K）', note: '最省的视觉模型 · 32K 以上按 0.30 / 3.00 计', cheap: true },
    { name: 'Qwen3-VL-Plus', id: 'qwen3-vl-plus', inputPrice: '1.00 元/M tokens（≤32K）', outputPrice: '10.00 元/M tokens（≤32K）', note: '均衡视觉模型 · 32K 以上按 1.50 / 15.00 计', cheap: false },
    { name: 'Qwen3-VL 235B Instruct', id: 'qwen3-vl-235b-a22b-instruct', inputPrice: '以百炼官网为准', outputPrice: '以百炼官网为准', note: '开源版 235B · 指令版', cheap: false },
  ],
  zhipu: [
    { name: 'GLM-4.6V-FlashX', id: 'GLM-4.6V-FlashX', inputPrice: '0.15 元/M tokens（≤32K）', outputPrice: '1.50 元/M tokens（≤32K）', note: '最省 · 视觉理解', cheap: true },
    { name: 'GLM-4.6V', id: 'GLM-4.6V', inputPrice: '1.00 元/M tokens（≤32K）', outputPrice: '3.00 元/M tokens（≤32K）', note: '均衡 · 支持工具调用', cheap: false },
    { name: 'GLM-5V-Turbo', id: 'GLM-5V-Turbo', inputPrice: '5.00 元/M tokens（≤32K）', outputPrice: '22.00 元/M tokens（≤32K）', note: '旗舰多模态 · 32K 以上按 7.00 / 26.00 计', cheap: false },
    { name: 'GLM-4.6V-Flash', id: 'GLM-4.6V-Flash', inputPrice: '免费', outputPrice: '免费', note: '免费视觉模型', cheap: false },
  ],
  siliconflow: [
    { name: 'GLM-4.5V', id: 'zai-org/GLM-4.5V', inputPrice: '1.00 元/M tokens', outputPrice: '6.00 元/M tokens', note: '视觉理解 · 硅基流动托管', cheap: true },
    { name: 'PaddleOCR-VL 1.5', id: 'PaddlePaddle/PaddleOCR-VL-1.5', inputPrice: '免费', outputPrice: '免费', note: 'OCR 专用，不适合看屏幕内容', cheap: false },
  ],
  deepseek: [
    { name: 'DeepSeek Flash', id: 'deepseek-flash', inputPrice: '0.15 美元/M tokens（非高峰）', outputPrice: '0.60 美元/M tokens（非高峰）', note: '支持图片输入；高峰时段 0.30 / 1.20', cheap: true },
  ],
  mimo: [
    { name: 'MiMo V2.6', id: 'MiMo-V2.6', inputPrice: '订阅制（Token Plan）', outputPrice: '订阅制（Token Plan）', note: '旗舰全模态 · 按订阅额度计费，不按 token 计价', cheap: false },
  ],
  other: [],
};

const cfgProvider = document.getElementById('cfgProvider');
const cfgModel = document.getElementById('cfgModel');
const cfgEndpoint = document.getElementById('cfgEndpoint');
const cfgInterval = document.getElementById('cfgInterval');
const cfgIntervalVal = document.getElementById('cfgIntervalVal');
function populateModels(provider, currentModel) {
  const container = document.getElementById('cfgModelList');
  const models = PROVIDER_MODELS[provider] || [];

  // 无预设模型的 provider（custom / other）→ 直接显示自定义输入框
  if (models.length === 0) {
    container.innerHTML = `
      <div class="custom-model-box show">
        <input type="text" id="cfgCustomModel" class="input" placeholder="手动输入模型 ID" value="${currentModel || ''}">
      </div>`;
    document.getElementById('cfgModel').value = currentModel || '';
    const input = document.getElementById('cfgCustomModel');
    input.addEventListener('input', () => {
      document.getElementById('cfgModel').value = input.value;
    });
    return;
  }

  // 当前模型是否为自定义（不在预设列表中）
  const isCustom = currentModel && !models.find(m => m.id === currentModel);

  // 无任何选择时自动选最便宜的
  if (!currentModel) {
    const cheap = models.find(m => m.cheap);
    currentModel = cheap ? cheap.id : models[0].id;
  }
  document.getElementById('cfgModel').value = currentModel || '';

  container.innerHTML = models.map(m => `
    <div class="model-card${m.id === currentModel ? ' selected' : ''}" data-model="${m.id}">
      <div class="model-radio${m.id === currentModel ? ' checked' : ''}"></div>
      <div class="model-info">
        <div class="model-name">${m.name}</div>
        <div class="model-id">${m.id}</div>
      </div>
      ${m.cheap ? '<span class="model-tag">最便宜</span>' : ''}
      <div class="model-tooltip-trigger" data-tip="${m.id}">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
        <div class="model-tooltip" id="tip-${m.id}">
          <div class="tooltip-row"><strong>${m.name}</strong></div>
          <div class="tooltip-row"><span>模型ID:</span> ${m.id}</div>
          <div class="tooltip-row"><span>输入价格:</span> ${m.inputPrice}</div>
          <div class="tooltip-row"><span>输出价格:</span> ${m.outputPrice}</div>
          ${m.note ? `<div class="tooltip-row"><span>说明:</span> ${m.note}</div>` : ''}
        </div>
      </div>
    </div>
  `).join('') + `
    <div class="model-card custom-model-card${isCustom ? ' selected' : ''}" data-model="__custom__">
      <div class="model-radio${isCustom ? ' checked' : ''}"></div>
      <div class="model-info">
        <div class="model-name">自定义模型</div>
        <div class="model-id">手动输入模型 ID</div>
      </div>
    </div>
    <div class="custom-model-box${isCustom ? ' show' : ''}" id="cfgCustomBox">
      <input type="text" id="cfgCustomModel" class="input" placeholder="输入模型 ID" value="${isCustom ? currentModel : ''}">
    </div>`;

  // 点击选择（复用公共绑定函数）
  bindModelCardSelection(container, (card) => {
    const box = document.getElementById('cfgCustomBox');
    if (card.dataset.model === '__custom__') {
      document.getElementById('cfgModel').value = document.getElementById('cfgCustomModel').value;
      box.classList.add('show');
    } else {
      document.getElementById('cfgModel').value = card.dataset.model;
      box.classList.remove('show');
    }
  });

  // 自定义输入框实时更新 cfgModel
  const customInput = document.getElementById('cfgCustomModel');
  if (customInput) {
    customInput.addEventListener('input', () => {
      document.getElementById('cfgModel').value = customInput.value;
    });
  }
}

// 通用：为模型卡片容器绑定点击选中逻辑
function bindModelCardSelection(container, onSelect) {
  container.querySelectorAll('.model-card').forEach(card => {
    card.addEventListener('click', () => {
      container.querySelectorAll('.model-card').forEach(c => c.classList.remove('selected'));
      container.querySelectorAll('.model-radio').forEach(r => r.classList.remove('checked'));
      card.classList.add('selected');
      card.querySelector('.model-radio').classList.add('checked');
      onSelect(card);
    });
  });
}

cfgProvider.addEventListener('change', () => {
  const url = PROVIDER_ENDPOINTS[cfgProvider.value];
  if (cfgProvider.value === 'other') {
    cfgEndpoint.value = '';
    populateModels('other', null);
  } else if (url) {
    cfgEndpoint.value = url;
    populateModels(cfgProvider.value, null);
  } else {
    populateModels(cfgProvider.value, null);
  }
  // 切换到该供应商时，加载它自己保存的 API Key
  loadApiKeyForProvider(cfgProvider.value);
});

cfgInterval.addEventListener('input', () => {
  cfgIntervalVal.textContent = cfgInterval.value + 's';
});

let savedProvider = 'custom';
let currentConfig = null;

// 按供应商加载对应 API Key 到输入框（只显示该供应商自己保存的 key，无则留空）
function loadApiKeyForProvider(providerId) {
  const key = currentConfig?.apiKeys?.[providerId] ?? '';
  document.getElementById('cfgApiKey').value = key;
}

// 「调整」面板里的桌宠位置/尺寸/开关，统一由这里写入。
// 载入配置时用一次，主进程通过 main:config-sync 推送变更时（例如桌宠右键菜单改的）再用一次。
function applyEditPanel(config) {
  if (!config) return;
  document.getElementById('editPosX').value = Math.round((config.petPositionX ?? 0) * 100);
  document.getElementById('editPosXVal').textContent = Math.round((config.petPositionX ?? 0) * 100) + '%';
  document.getElementById('editPosY').value = Math.round((config.petPositionY ?? 0.5) * 100);
  document.getElementById('editPosYVal').textContent = Math.round((config.petPositionY ?? 0.5) * 100) + '%';
  // 显示值 = 实际缩放 × 2（例如实际 0.5x 显示为 1.0x，实际 0.25x 显示为 0.5x）
  const scale = Math.round(((config.petScale ?? 0.5) / 0.5) * 100);
  document.getElementById('editScale').value = scale;
  document.getElementById('editScaleVal').textContent = (scale / 100).toFixed(1) + 'x';

  document.getElementById('editFixedPosition').checked = config.fixedPosition || false;
  document.getElementById('editMousePassthrough').checked = config.mousePassthrough ?? false;
  document.getElementById('editAlwaysOnTop').checked = config.alwaysOnTop ?? true;
  const opacity = Math.round((config.petOpacity ?? 1.0) * 100);
  document.getElementById('editOpacity').value = opacity;
  document.getElementById('editOpacityVal').textContent = opacity + '%';
}

async function loadConfigToForm() {
  const config = await api.invoke('control:get-config');
  if (!config) return;
  currentConfig = config;

  document.getElementById('cfgMaxTokens').value = config.maxTokens || 300;
  document.getElementById('cfgTemperature').value = config.temperature ?? 0.6;
  cfgEndpoint.value = config.apiEndpoint || '';
  cfgInterval.value = config.screenshotInterval || 10;
  cfgIntervalVal.textContent = (config.screenshotInterval || 10) + 's';

  // 优先用保存的 provider，其次从 endpoint 反推
  savedProvider = config.provider || 'custom';
  if (!PROVIDER_ENDPOINTS[savedProvider]) {
    savedProvider = 'custom';
    for (const [key, url] of Object.entries(PROVIDER_ENDPOINTS)) {
      if (url && config.apiEndpoint === url) { savedProvider = key; break; }
    }
  }
  cfgProvider.value = savedProvider;
  populateModels(savedProvider, config.model || '');
  // 迁移旧版单 key 到当前供应商槽位（避免升级后输入框为空但 key 丢失）
  if (config.apiKey && (!config.apiKeys || Object.keys(config.apiKeys).length === 0)) {
    currentConfig.apiKeys = { [savedProvider]: config.apiKey };
    api.invoke('control:save-config', { apiKeys: currentConfig.apiKeys });
  }
  loadApiKeyForProvider(savedProvider);

  // Edit panel
  applyEditPanel(config);
}

document.getElementById('saveConfigBtn').addEventListener('click', async () => {
  const provider = cfgProvider.value;
  const apiKeyVal = document.getElementById('cfgApiKey').value;
  // 按供应商分别保存 API Key（合并进 apiKeys 映射）
  const apiKeys = { ...(currentConfig?.apiKeys || {}), [provider]: apiKeyVal };
  const config = {
    provider,
    apiKey: apiKeyVal,
    apiKeys,
    apiEndpoint: document.getElementById('cfgEndpoint').value,
    model: cfgModel.value,
    screenshotInterval: parseInt(cfgInterval.value),
    maxTokens: parseInt(document.getElementById('cfgMaxTokens').value),
    temperature: parseFloat(document.getElementById('cfgTemperature').value),
  };
  await api.invoke('control:save-config', config);
  currentConfig = config;
  showToast('配置已保存！');
});

// --- API Key 显示/隐藏切换 ---
const apiKeyInput = document.getElementById('cfgApiKey');
const apiKeyToggle = document.getElementById('apiKeyToggle');
apiKeyToggle.addEventListener('click', () => {
  const isPassword = apiKeyInput.type === 'password';
  apiKeyInput.type = isPassword ? 'text' : 'password';
  apiKeyToggle.classList.toggle('active', isPassword);
});

// Toast
let toastTimer = null;
function showToast(msg) {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.style.opacity = '1';
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.style.opacity = '0'; }, 2000);
}

// --- Edit Panel ---
let positionDebounceTimer = null;

document.getElementById('editPosX').addEventListener('input', (e) => {
  document.getElementById('editPosXVal').textContent = e.target.value + '%';
  debounceUpdatePetPosition();
});
document.getElementById('editPosY').addEventListener('input', (e) => {
  document.getElementById('editPosYVal').textContent = e.target.value + '%';
  debounceUpdatePetPosition();
});
document.getElementById('editScale').addEventListener('input', (e) => {
  document.getElementById('editScaleVal').textContent = (e.target.value / 100).toFixed(1) + 'x';
  debounceUpdatePetPosition();
});
// 输入框显示值 / 100 = 显示倍数（0.5-1.5x），实际缩放 = 显示倍数 × 0.5

// Reset to defaults
document.getElementById('resetEditBtn').addEventListener('click', async () => {
  // 位置/大小/透明度/三个开关全部由主进程的 control:reset-pet-defaults 一次做完
  // （桌宠右键菜单的「恢复默认」走的是同一套逻辑，这里不再重复下发单项设置）
  await api.invoke('control:reset-pet-defaults');
  document.getElementById('editPosX').value = 0;
  document.getElementById('editPosXVal').textContent = '0%';
  document.getElementById('editPosY').value = 50;
  document.getElementById('editPosYVal').textContent = '50%';
  document.getElementById('editScale').value = 100;
  document.getElementById('editScaleVal').textContent = '1.0x';
  document.getElementById('editOpacity').value = 100;
  document.getElementById('editOpacityVal').textContent = '100%';
  document.getElementById('editFixedPosition').checked = false;
  document.getElementById('editMousePassthrough').checked = false;
  document.getElementById('editAlwaysOnTop').checked = true;
  showToast('已恢复默认');
});

// --- New edit panel controls ---

// Fixed position toggle
document.getElementById('editFixedPosition').addEventListener('change', (e) => {
  api.invoke('control:set-fixed-position', e.target.checked);
});

// Mouse passthrough toggle
document.getElementById('editMousePassthrough').addEventListener('change', (e) => {
  api.invoke('control:set-passthrough', e.target.checked);
});

// Always on top toggle
document.getElementById('editAlwaysOnTop').addEventListener('change', (e) => {
  api.invoke('control:set-topmost', e.target.checked);
});

// Opacity slider
let opacityDebounceTimer = null;
document.getElementById('editOpacity').addEventListener('input', (e) => {
  const val = parseInt(e.target.value);
  document.getElementById('editOpacityVal').textContent = val + '%';
  // 拖动过程中 input 事件很密集，主进程每次都要同步写 config.json，
  // 所以和位置滑杆一样做 80ms 防抖（松手后的最终值一定会落地）
  if (opacityDebounceTimer) clearTimeout(opacityDebounceTimer);
  opacityDebounceTimer = setTimeout(() => api.invoke('control:set-opacity', val / 100), 80);
});

// Position sync from native drag
api.on('main:position-sync', (pos) => {
  document.getElementById('editPosX').value = pos.x;
  document.getElementById('editPosXVal').textContent = pos.x + '%';
  document.getElementById('editPosY').value = pos.y;
  document.getElementById('editPosYVal').textContent = pos.y + '%';
});

// 主进程改了桌宠设置（目前只有桌宠右键菜单会这样）时同步面板，避免显示与实际不一致
api.on('main:config-sync', (config) => applyEditPanel(config));


function debounceUpdatePetPosition() {
  if (positionDebounceTimer) clearTimeout(positionDebounceTimer);
  positionDebounceTimer = setTimeout(updatePetPosition, 80);
}

async function updatePetPosition() {
  const x = parseInt(document.getElementById('editPosX').value) / 100;
  const y = parseInt(document.getElementById('editPosY').value) / 100;
  // 实际缩放 = 显示倍数 × 0.5（显示 1.0x → 实际 0.5x）
  const scale = (parseInt(document.getElementById('editScale').value) / 100) * 0.5;
  await api.invoke('control:update-pet-position', { x, y, scale });
}

// --- History Panel ---
async function refreshHistory() {
  const history = await api.invoke('control:get-chat-history');
  const list = document.getElementById('historyList');
  if (!history || history.length === 0) {
    list.innerHTML = '<div class="history-empty">暂无对话记录</div>';
    return;
  }
  list.innerHTML = history.map(m => `
    <div class="history-msg ${m.role}">
      <div class="time">${new Date(m.timestamp).toLocaleTimeString()}</div>
      ${m.image ? `<img class="history-img" src="${m.image}" alt="截图">` : ''}
      ${m.content ? `<div class="content">${escapeHtml(m.content)}</div>` : ''}
    </div>
  `).join('');
  list.scrollTop = list.scrollHeight;
}

function addHistoryMessage(msg) {
  const list = document.getElementById('historyList');
  if (list.querySelector('.history-empty')) {
    list.innerHTML = '';
  }
  const div = document.createElement('div');
  div.className = `history-msg ${msg.role}`;
  div.innerHTML = `
    <div class="time">${new Date(msg.timestamp).toLocaleTimeString()}</div>
    ${msg.image ? `<img class="history-img" src="${msg.image}" alt="截图">` : ''}
    ${msg.content ? `<div class="content">${escapeHtml(msg.content)}</div>` : ''}
  `;
  list.appendChild(div);
  list.scrollTop = list.scrollHeight;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// --- First Run / Info Modal ---
const firstRunModal = document.getElementById('firstRunModal');

async function checkFirstRun() {
  const config = await api.invoke('control:get-config');
  if (config && !config.firstRunComplete) {
    firstRunModal.style.display = 'flex';
    await api.invoke('control:save-config', { firstRunComplete: true });
  }
}

document.getElementById('infoBtn').addEventListener('click', () => {
  firstRunModal.style.display = 'flex';
});

document.getElementById('closeModalBtn').addEventListener('click', () => {
  firstRunModal.style.display = 'none';
  // 首次启动时公告可能被《使用须知》挡住，等用户关闭须知后再展示，避免公告丢失
  if (pendingNotice) {
    showNotice(pendingNotice);
    pendingNotice = null;
  }
});

// --- Notice Modal (GitHub Pages 远程公告) ---
const noticeModal = document.getElementById('noticeModal');

// 公告到达时若《使用须知》仍打开，则挂起等待（否则一旦 markSeen，
// 本版本公告将永远无法再弹出）
let pendingNotice = null;

function showNotice(notice) {
  document.getElementById('noticeTitle').textContent = notice.title || '呆喵更新公告';
  document.getElementById('noticeVersion').textContent = 'v' + notice.version;
  document.getElementById('noticeTime').textContent = notice.time || '';

  // 渲染更新内容列表
  const list = document.getElementById('noticeContent');
  list.innerHTML = '';
  (notice.content || []).forEach((item) => {
    const li = document.createElement('li');
    li.textContent = item;
    list.appendChild(li);
  });

  noticeModal.style.display = 'flex';

  // 公告已实际显示后，再通知主进程标记为已读（避免未显示就丢失）
  api.invoke('notice:dismiss', notice.version);
}

api.on('main:show-notice', (notice) => {
  if (!notice) return;
  if (firstRunModal.style.display === 'flex') {
    pendingNotice = notice;
    return;
  }
  showNotice(notice);
});

document.getElementById('noticeDismissBtn').addEventListener('click', () => {
  noticeModal.style.display = 'none';
});

// --- Personality Tab ---
let currentPersonalityId = 'energetic';

async function loadPersonalities() {
  const all = await api.invoke('personality:get-all');
  const current = await api.invoke('personality:get-current');
  currentPersonalityId = current ? current.id : 'energetic';
  renderCurrentPersonality(current || all[0]);
  renderPersonalityCards(all);
}

function renderCurrentPersonality(p) {
  if (!p) return;
  document.getElementById('personaCurrentIcon').textContent = p.icon;
  document.getElementById('personaCurrentName').textContent = p.name;
  document.getElementById('personaCurrentDesc').textContent = p.description;
  // Also update dashboard card
  document.getElementById('dashPersonaIcon').textContent = p.icon;
  document.getElementById('dashPersonaName').textContent = p.name;
}

function renderPersonalityCards(all) {
  const grid = document.getElementById('personaGrid');
  grid.innerHTML = all.map(p => `
    <div class="persona-card${p.id === currentPersonalityId ? ' selected' : ''}" data-pid="${p.id}">
      <div class="persona-card-icon">${p.icon}</div>
      <div class="persona-card-body">
        <div class="persona-card-name">${p.name}</div>
        <div class="persona-card-desc">${p.description}</div>
        <div class="persona-card-tags">${p.tags.map(t => `<span class="persona-tag">${t}</span>`).join('')}</div>
      </div>
    </div>
  `).join('');

  grid.querySelectorAll('.persona-card').forEach(card => {
    card.addEventListener('click', async () => {
      const id = card.dataset.pid;
      await api.invoke('personality:set-current', id);
      currentPersonalityId = id;
      const current = await api.invoke('personality:get-current');
      renderCurrentPersonality(current);
      renderPersonalityCards(all);
      // Show preview
      const text = await api.invoke('personality:preview', id);
      document.getElementById('personaPreviewText').textContent = text;
      document.getElementById('personaPreview').style.display = 'block';
      showToast('已切换为 ' + current.name);
    });
  });
}

// --- Life Tags Tab ---
const ROMAN = ['', 'Ⅰ', 'Ⅱ', 'Ⅲ', 'Ⅳ', 'Ⅴ'];

async function loadLifeTags() {
  const tags = await api.invoke('life-tags:get-all');
  const section = document.getElementById('lifetagsSection');
  const grid = document.getElementById('lifetagsGrid');

  // 只显示已解锁的词条；全部未解锁则隐藏整个栏目
  const unlocked = (tags || []).filter(t => t.unlocked);
  if (unlocked.length === 0) {
    section.style.display = 'none';
    return;
  }
  section.style.display = '';

  // 词条卡片只显示图标、名字（含等级）、介绍
  grid.innerHTML = unlocked.map(t => {
    const levelText = t.type === 'level' && t.level > 0 ? ` <span class="tag-level">${ROMAN[t.level]}</span>` : '';
    return `
    <div class="tag-card">
      <div class="tag-icon">${t.icon}</div>
      <div class="tag-card-body">
        <div class="tag-name">${t.name}${levelText}</div>
        <div class="tag-desc">${t.description}</div>
      </div>
    </div>`;
  }).join('');
}

// --- Init ---
checkFirstRun();
loadConfigToForm();
// 打开面板先把已有的统计拉一次（累计数据与"循环是否在跑"无关，不该等到点启动才显示）
(async () => {
  renderStats(await api.invoke('control:get-stats'));
})();
// 面板刷新/重载后对齐真实运行状态（只有主进程知道截图循环是否在跑）
(async () => {
  const state = await api.invoke('control:get-state');
  if (state && state.running) setRunningUI(true);
})();
// Load current personality for dashboard card
(async () => {
  const current = await api.invoke('personality:get-current');
  if (current) {
    document.getElementById('dashPersonaIcon').textContent = current.icon;
    document.getElementById('dashPersonaName').textContent = current.name;
  }
})();
