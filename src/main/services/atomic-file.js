// 本地数据的原子写：先写同目录临时文件再 rename 覆盖。
// 直接 writeFileSync 覆盖时，如果进程在写一半时崩溃/断电，原文件会变成半截 JSON，
// 下次启动解析失败就只能回退默认值（配置损坏 = 用户丢 API Key）。
// rename 在同分区上是原子的，最坏情况也只是留下一个 .tmp 文件。
//
// 但 rename 并非所有环境都可用：本机实测在 %APPDATA%\Roaming\<app>\ 下
// MoveFileEx 一律返回 EBADF（Electron 自己搬缓存的日志里也有同样的报错），
// 因此这里带退路：一旦发现该目录不能用 rename，就退回直接覆盖写，
// 用"牺牲原子性"换"数据一定存得下去"。
const fs = require('fs');
const path = require('path');

// 目录 → rename 是否可用（记忆化，避免每次写盘都白试一遍并刷日志）
const renameOkByDir = new Map();

/**
 * @param {string} filePath 目标文件
 * @param {any} value 会被 JSON.stringify 的内容
 * @param {{ pretty?: boolean }} options pretty=true 时用 2 空格缩进（便于人工查看）
 */
function writeJsonAtomic(filePath, value, options = {}) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const text = options.pretty ? JSON.stringify(value, null, 2) : JSON.stringify(value);
  const tmpPath = filePath + '.tmp';

  if (renameOkByDir.get(dir) !== false) {
    try {
      fs.writeFileSync(tmpPath, text, 'utf-8');
      // Windows 上 Node 的 rename 走 MoveFileEx(REPLACE_EXISTING)，可以覆盖已存在的目标
      fs.renameSync(tmpPath, filePath);
      renameOkByDir.set(dir, true);
      return;
    } catch (err) {
      try { fs.unlinkSync(tmpPath); } catch (cleanupErr) { /* 临时文件可能没建成，忽略 */ }
      const wasOk = renameOkByDir.get(dir) === true;
      renameOkByDir.set(dir, false);
      if (wasOk) {
        console.warn('[atomic-file] 本次原子写失败，退回直接写入:', err.code || err.message);
      } else {
        console.warn('[atomic-file] 该目录不支持 rename，后续直接写入:', dir, err.code || err.message);
      }
    }
  }

  // 退路：直接覆盖写（非原子，但保证数据落盘）
  fs.writeFileSync(filePath, text, 'utf-8');
}

module.exports = { writeJsonAtomic };
