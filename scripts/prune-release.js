// 打包收尾：清掉 release/ 里的旧版本产物和压 zip 用的中转目录。
//
// 背景：electron-builder 只会覆盖同名文件，不会清理上一次打包留下的东西，
// 所以每出一版，release/ 里就会多留一份几十到上百 MB 的安装包 / 便携版 / zip，
// 越攒越大（实测一个版本约 480 MB，含解包目录）。
//
// 这个脚本挂在 npm 的 postdist 上，`npm run dist` 结束后自动执行，规则只有一条：
//   1. **文件名里带版本号、且版本号 ≠ 当前 package.json 的版本 → 删掉。**
//   2. **release/DaiMeow/（压 zip 用的中转目录）→ 删掉。**
// 其余（win-unpacked/、latest.yml、builder-debug.yml、当前版本的产物）一律保留，
// 因为打包流程后续步骤还要用。
//
// 关于中转目录的安全性（重要）：postdist 在 `npm run dist` 的**末尾**执行，
// 而中转目录是这之后才由 CI 的「Pack unpacked build into ZIP」那步创建的，
// 顺序是：dist → postdist（本脚本）→ 建中转目录 → 压缩成 zip → 上传。
// 所以脚本删掉的一定是**上一次打包遗留**的那一份，不会把本次要压缩的目录删掉。
// 本地用 build.bat 打包也一样：build.bat 只跑 `npm run dist`，不负责压 zip。
//
// 删除失败只告警、不抛错：产物可能正被运行中的程序占用，
// 不能因为清理失败就让整个打包流程变成失败。
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const releaseDir = path.join(root, 'release');
const stagingDir = path.join(releaseDir, 'DaiMeow');   // CI 压 zip 用的中转目录
const version = require(path.join(root, 'package.json')).version;

/** 目录总大小（字节），拿不到就当 0 */
function dirSize(dir) {
  let total = 0;
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else { try { total += fs.statSync(p).size; } catch { /* 忽略 */ } }
    }
  };
  try { walk(dir); } catch { /* 忽略 */ }
  return total;
}

function main() {
  if (!fs.existsSync(releaseDir)) {
    console.log('[prune-release] 没有 release/ 目录，跳过');
    return;
  }

  const entries = fs.readdirSync(releaseDir, { withFileTypes: true });
  const removed = [];
  const failed = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue;                 // 只处理文件，目录（win-unpacked 等）不动
    if (!entry.name.startsWith('DaiMeow')) continue;
    const m = entry.name.match(/(\d+\.\d+\.\d+)/);
    if (!m) continue;                              // 文件名里没有版本号 → 不是版本产物，保留
    if (m[1] === version) continue;                // 当前版本 → 保留

    const full = path.join(releaseDir, entry.name);
    try {
      const size = fs.statSync(full).size;
      fs.unlinkSync(full);
      removed.push({ name: entry.name, size });
    } catch (err) {
      failed.push(entry.name + ' (' + err.code + ')');
    }
  }

  // 压 zip 用的中转目录（上一次打包的残留）
  if (fs.existsSync(stagingDir) && fs.statSync(stagingDir).isDirectory()) {
    const size = dirSize(stagingDir);
    try {
      fs.rmSync(stagingDir, { recursive: true, force: true });
      removed.push({ name: 'DaiMeow/（压 zip 的中转目录）', size });
    } catch (err) {
      failed.push('DaiMeow/ (' + err.code + ')');
    }
  }

  for (const r of removed) {
    console.log('[prune-release] 删除 ' + r.name + '  ' + (r.size / 1024 / 1024).toFixed(1) + ' MB');
  }
  const freedMB = removed.reduce((s, r) => s + r.size, 0) / 1024 / 1024;
  console.log('[prune-release] 当前版本 v' + version + '：清理 ' + removed.length + ' 个旧文件，释放 ' + freedMB.toFixed(1) + ' MB');
  if (failed.length) {
    console.warn('[prune-release] 以下文件删不掉（可能正被占用），已跳过：' + failed.join(', '));
  }
}

main();
