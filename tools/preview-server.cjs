// 呆喵动作预览用的本地静态服务器。
// 只用 Node 内置模块：把项目目录当站点根，起在 127.0.0.1 上，然后打开浏览器。
// 动作/模型文件都按 no-store 发出去，所以在预览页按 F5 就能看到刚改过的文件。
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PREVIEW_PORT) || 8790;
const PAGE = 'tools/motion-preview.html';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.moc3': 'application/octet-stream',
  '.bin': 'application/octet-stream',
};

const server = http.createServer((req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    let rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    if (rel === '') rel = PAGE;
    const file = path.resolve(ROOT, rel);
    // 只允许访问项目目录内部
    if (file !== ROOT && !file.startsWith(ROOT + path.sep)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      res.end('Not found: ' + rel);
      return;
    }
    const data = fs.readFileSync(file);
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': data.length,
      'Cache-Control': 'no-store',
    });
    res.end(data);
  } catch (err) {
    res.writeHead(500);
    res.end('Internal error: ' + err.message);
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error('端口 ' + PORT + ' 已被占用。可以换一个端口再试：set PREVIEW_PORT=8791 && preview.bat');
  } else {
    console.error('启动失败：' + err.message);
  }
  process.exit(1);
});

server.listen(PORT, '127.0.0.1', () => {
  const url = 'http://127.0.0.1:' + PORT + '/' + PAGE;
  console.log('');
  console.log('  呆喵动作预览已启动: ' + url);
  console.log('  · 改完动作文件回浏览器按 F5 就能看到效果（这里不用重启）');
  console.log('  · 关掉这个窗口 = 结束预览');
  console.log('');
  if (process.env.PREVIEW_NO_OPEN !== '1') {
    spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
  }
});
