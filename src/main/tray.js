const { Tray, Menu, nativeImage } = require('electron');
const path = require('path');

const ICON_PATH = path.join(__dirname, '..', 'renderer', 'control', 'logo.ico');

// 参数是"显示控制面板"的回调，不是窗口对象本身：控制面板关闭后会被真的销毁，
// 下次点托盘再按需重建，闭包里若持有旧窗口就会拿到一个已 destroyed 的对象。
function createTray(showControlWindow) {
  // Resize to 32x32 for sharp tray display on Windows
  const rawIcon = nativeImage.createFromPath(ICON_PATH);
  const trayIcon = rawIcon.resize({ width: 32, height: 32 });
  const tray = new Tray(trayIcon);

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '显示主窗口',
      click: () => showControlWindow(),
    },
    { type: 'separator' },
    {
      label: '退出呆喵',
      click: () => {
        const { app } = require('electron');
        app.quit();
      },
    },
  ]);

  tray.setToolTip('呆喵');
  tray.setContextMenu(contextMenu);

  tray.on('click', () => showControlWindow());

  return tray;
}

module.exports = { createTray };
