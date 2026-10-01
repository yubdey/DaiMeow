const { desktopCapturer } = require('electron');

/**
 * 抓取屏幕截图。
 * @param {{ displayId?: string|number }} options displayId 指定截哪块屏（多显示器时用），
 *        取不到对应源时退回第一个屏幕源。
 */
async function captureScreen(options = {}) {
  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 480, height: 270 },
    });

    if (!sources.length) {
      throw new Error('No screen sources found');
    }

    const wanted = options.displayId != null ? String(options.displayId) : null;
    const source = (wanted && sources.find((s) => String(s.display_id) === wanted)) || sources[0];
    const image = source.thumbnail;

    // 只在宽度超过目标值时才缩，避免把低分辨率截图放大。
    // 典型情况：1707×960 的屏 → 缩略图 480×270，不缩；竖屏显示器（如 1080×1920）
    // 的缩略图只有 152×270，如果按 width:480 去缩会被放大成 480×854，又大又糊。
    const TARGET_WIDTH = 480;
    const jpegSource = image.getSize().width > TARGET_WIDTH
      ? image.resize({ width: TARGET_WIDTH, height: Math.round(TARGET_WIDTH / image.getAspectRatio()) })
      : image;

    // JPEG compress at quality 65
    const jpegBuffer = jpegSource.toJPEG(65);
    const base64 = jpegBuffer.toString('base64');

    return `data:image/jpeg;base64,${base64}`;
  } catch (err) {
    console.error('Screenshot failed:', err.message);
    throw err;
  }
}

module.exports = { captureScreen };
