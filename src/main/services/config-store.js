const fs = require('fs');
const path = require('path');
const { app, safeStorage } = require('electron');
const { writeJsonAtomic } = require('./atomic-file');

const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');

const DEFAULTS = {
  apiKey: '',
  apiKeys: {},
  provider: 'custom',
  apiEndpoint: 'https://api.moonshot.cn/v1/chat/completions',
  model: '',
  providerType: 'api',
  ollamaEndpoint: 'http://127.0.0.1:11434',
  screenshotInterval: 5,
  sceneSampleEvery: 1,
  maxTokens: 60,
  temperature: 0.6,
  petScale: 0.5,
  petPositionX: 0,
  petPositionY: 0.5,
  fixedPosition: false,
  mousePassthrough: false,
  petOpacity: 1.0,
  alwaysOnTop: true,
  personality: 'energetic',
  winBounds: null,
  firstRunComplete: false,
  lastNotice: '',
};

let config = { ...DEFAULTS };

// --- API Key 加密 -----------------------------------------------------------
// 磁盘上的密钥字段是密文（Windows 上 safeStorage 走 DPAPI，绑定当前 Windows 用户），
// 内存里的 config 始终是明文，这样 api-client / 控制面板都不用关心加密。
// 旧版本留下的明文配置能直接读（无前缀即视为明文），下次保存时自动转成密文。
const ENC_PREFIX = 'dmenc1:';
// 解密失败的原文（换系统账号、密钥库被重置等）。保留它是为了在后续 save 时
// 不要把用户原本存着的密文覆盖成空字符串。
let undecryptable = { apiKey: '', apiKeys: {} };

function encryptionAvailable() {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch (err) {
    return false;
  }
}

function encryptSecret(value) {
  if (typeof value !== 'string' || value === '') return '';
  // 拿不到加密能力时退回明文，保证功能可用（README 已说明本机保存的风险）
  if (!encryptionAvailable()) return value;
  try {
    return ENC_PREFIX + safeStorage.encryptString(value).toString('base64');
  } catch (err) {
    console.error('Failed to encrypt API key:', err.message);
    return value;
  }
}

function decryptSecret(value, onFail) {
  if (typeof value !== 'string' || value === '') return '';
  if (!value.startsWith(ENC_PREFIX)) return value; // 旧版明文，直接沿用
  try {
    return safeStorage.decryptString(Buffer.from(value.slice(ENC_PREFIX.length), 'base64'));
  } catch (err) {
    console.warn('Failed to decrypt saved API key:', err.message);
    if (onFail) onFail(value);
    return '';
  }
}

function isPlainSecret(value) {
  return typeof value === 'string' && value !== '' && !value.startsWith(ENC_PREFIX);
}

function load() {
  try {
    if (!fs.existsSync(CONFIG_PATH)) return;
    const saved = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    config = { ...DEFAULTS, ...saved };
    undecryptable = { apiKey: '', apiKeys: {} };

    // 磁盘上是密文，内存里换成明文供各处使用
    const plainKeys = {};
    for (const [provider, value] of Object.entries(saved.apiKeys || {})) {
      plainKeys[provider] = decryptSecret(value, (raw) => { undecryptable.apiKeys[provider] = raw; });
    }
    config.apiKeys = plainKeys;
    config.apiKey = decryptSecret(saved.apiKey, (raw) => { undecryptable.apiKey = raw; });

    // 旧版的明文配置：能加密就立刻落盘迁移，避免明文长期留在磁盘上
    const needsMigration = encryptionAvailable()
      && (isPlainSecret(saved.apiKey) || Object.values(saved.apiKeys || {}).some(isPlainSecret));
    if (needsMigration) {
      // 迁移只是"顺手做的好事"，写盘失败绝不能影响已经读进来的配置
      try {
        persist();
      } catch (err) {
        console.warn('Failed to migrate config to encrypted form:', err.message);
      }
    }
  } catch (err) {
    console.error('Failed to load config:', err.message);
    config = { ...DEFAULTS };
  }
}

/** 内存里的明文密钥 → 磁盘格式（密文；解不开的旧密文原样保留） */
function encodeSecrets() {
  const apiKeys = {};
  for (const [provider, value] of Object.entries(config.apiKeys || {})) {
    if (typeof value === 'string' && value !== '') apiKeys[provider] = encryptSecret(value);
    else apiKeys[provider] = undecryptable.apiKeys[provider] || '';
  }
  const apiKey = (typeof config.apiKey === 'string' && config.apiKey !== '')
    ? encryptSecret(config.apiKey)
    : (undecryptable.apiKey || '');
  return { apiKey, apiKeys };
}

/** 写盘（内部使用，保证密钥一定以密文形式写出） */
function persist() {
  const { apiKey, apiKeys } = encodeSecrets();
  writeJsonAtomic(CONFIG_PATH, { ...config, apiKey, apiKeys }, { pretty: true });
}

function save(partial) {
  Object.assign(config, partial);
  try {
    persist();
  } catch (err) {
    console.error('Failed to save config:', err.message);
  }
}

function getAll() {
  return { ...config };
}

module.exports = { load, save, getAll, DEFAULTS };
