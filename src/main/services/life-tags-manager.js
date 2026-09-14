const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const TAG_DEFS = require('./life-tags-defs');
const { writeJsonAtomic } = require('./atomic-file');

const DATA_PATH = path.join(app.getPath('userData'), 'life-tags.json');

// 时段定义（左闭右开 [start, end)）
// 夜间 [22:00, 03:00)，早间 [03:00, 09:00)，白天 [09:00, 18:00)，晚间 [18:00, 22:00)
const MIN_DAY_SECONDS = 300; // 当天有效使用 ≥5 分钟才算一个使用日

class LifeTagsManager {
  constructor() {
    this.data = {
      firstUseDate: null,
      useDays: [],
      totalSeconds: 0,
      slotSeconds: { night: 0, morning: 0, day: 0, evening: 0 },
      sceneCounts: { work: 0, fun: 0, other: 0 },
      dailySeconds: {},
      unlockedAt: {}, // { tagId: "YYYY-MM-DD HH:mm" } 首次解锁时刻
    };
    this.load();
  }

  load() {
    try {
      if (!fs.existsSync(DATA_PATH)) return;
      const saved = JSON.parse(fs.readFileSync(DATA_PATH, 'utf-8'));
      if (!saved || typeof saved !== 'object') return;

      // 逐字段防御性合并：本地文件可能来自旧版本或人为损坏，
      // 缺失/类型错误的字段回退默认值，避免 tick()/getAll() 崩溃。
      const sanitizeNumber = (v) => (Number.isFinite(v) ? v : 0);
      const next = {
        firstUseDate: typeof saved.firstUseDate === 'string' ? saved.firstUseDate : null,
        useDays: Array.isArray(saved.useDays) ? saved.useDays : [],
        totalSeconds: sanitizeNumber(saved.totalSeconds),
        slotSeconds: { night: 0, morning: 0, day: 0, evening: 0 },
        sceneCounts: { work: 0, fun: 0, other: 0 },
        dailySeconds: {},
        unlockedAt: {},
      };
      for (const key of ['night', 'morning', 'day', 'evening']) {
        const v = saved.slotSeconds && saved.slotSeconds[key];
        if (Number.isFinite(v)) next.slotSeconds[key] = v;
      }
      for (const key of ['work', 'fun', 'other']) {
        const v = saved.sceneCounts && saved.sceneCounts[key];
        if (Number.isFinite(v) && v >= 0) next.sceneCounts[key] = v;
      }
      if (saved.dailySeconds && typeof saved.dailySeconds === 'object') {
        for (const [date, seconds] of Object.entries(saved.dailySeconds)) {
          if (Number.isFinite(seconds)) next.dailySeconds[date] = seconds;
        }
      }
      if (saved.unlockedAt && typeof saved.unlockedAt === 'object') {
        for (const [tagId, timeStr] of Object.entries(saved.unlockedAt)) {
          if (typeof timeStr === 'string') next.unlockedAt[tagId] = timeStr;
        }
      }
      this.data = next;
    } catch (err) {
      console.warn('[LifeTags] 读取失败:', err.message);
    }
  }

  flush() {
    try {
      writeJsonAtomic(DATA_PATH, this.data, { pretty: true });
    } catch (err) {
      console.warn('[LifeTags] 写入失败:', err.message);
    }
  }

  _dateStr(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  _timeStr(date) {
    const base = this._dateStr(date);
    const h = String(date.getHours()).padStart(2, '0');
    const min = String(date.getMinutes()).padStart(2, '0');
    return `${base} ${h}:${min}`;
  }

  /**
   * 与 stats-tracker 的 totalUptime 同步：词条系统部署前的历史使用
   * 也应计入总使用时长，保证家里蹲的"总使用"和主页"运行总时长"一致。
   */
  syncWithStatsTracker(totalUptime) {
    if (totalUptime > this.data.totalSeconds) {
      this.data.totalSeconds = totalUptime;
    }
  }

  /**
   * 场景统计（work/fun/other）与总数。总数由三项相加派生，避免冗余字段不一致。
   */
  getSceneCounts() {
    const counts = this.data.sceneCounts || {};
    const work = counts.work || 0;
    const fun = counts.fun || 0;
    const other = counts.other || 0;
    return { work, fun, other, total: work + fun + other };
  }

  /**
   * 记录一次场景识别结果。场景由同一次多模态请求顺带给出，
   * 无法识别时归入 'other'（由调用方决定），非法值直接忽略。
   */
  recordScene(scene) {
    if (scene !== 'work' && scene !== 'fun' && scene !== 'other') return;
    if (!this.data.sceneCounts) {
      this.data.sceneCounts = { work: 0, fun: 0, other: 0 };
    }
    this.data.sceneCounts[scene]++;
  }

  _slotOf(hour) {
    if (hour >= 22 || hour < 3) return 'night';
    if (hour >= 3 && hour < 9) return 'morning';
    if (hour >= 9 && hour < 18) return 'day';
    return 'evening';
  }

  /**
   * 每秒调用（仅 running 状态，idle 时主进程不调用）
   */
  tick() {
    const now = new Date();
    const slot = this._slotOf(now.getHours());
    this.data.slotSeconds[slot]++;
    this.data.totalSeconds++;

    const today = this._dateStr(now);
    this.data.dailySeconds[today] = (this.data.dailySeconds[today] || 0) + 1;

    if (!this.data.firstUseDate) this.data.firstUseDate = today;

    // 使用日判定：当天有效使用 ≥ MIN_DAY_SECONDS 且未记录
    if (
      this.data.dailySeconds[today] >= MIN_DAY_SECONDS &&
      !this.data.useDays.includes(today)
    ) {
      this.data.useDays.push(today);
    }
  }

  /**
   * 计算所有词条当前状态（等级为派生值，实时计算不持久化）
   */
  getAll() {
    const useDays = this.data.useDays.length;
    const data = { ...this.data, sceneCounts: this.getSceneCounts() };
    return TAG_DEFS.map((def) => {
      const base = {
        id: def.id,
        name: def.name,
        icon: def.icon,
        description: def.description,
        firstUnlockedAt: this.data.unlockedAt[def.id] || null,
      };

      if (def.thresholds) {
        // 等级词条
        if (useDays < def.minDays) {
          return Object.assign(base, {
            type: 'level',
            unlocked: false,
            locked: true,
            lockReason: `使用满 ${def.minDays} 天后解锁`,
            level: 0,
            maxLevel: def.maxLevel,
            progress: 0,
            useDays,
            minDays: def.minDays,
          });
        }
        const ratio = def.calc(data);
        let level = 0;
        for (const t of def.thresholds) {
          if (ratio > t) level++;
          else break;
        }
        const unlocked = level > 0;
        if (unlocked && !this.data.unlockedAt[def.id]) {
          this.data.unlockedAt[def.id] = this._timeStr(new Date());
        }
        return Object.assign(base, {
          type: 'level',
          unlocked,
          locked: false,
          level,
          maxLevel: def.maxLevel,
          progress: ratio,
          thresholds: def.thresholds,
          useDays,
          minDays: def.minDays,
        });
      }

      // 简单词条（无等级）
      if (def.minDays && useDays < def.minDays) {
        return Object.assign(base, {
          type: 'simple',
          unlocked: false,
          locked: true,
          lockReason: `使用满 ${def.minDays} 天后解锁`,
          progress: 0,
          progressText: `使用满 ${def.minDays} 天后解锁`,
          useDays,
          minDays: def.minDays,
        });
      }
      const unlocked = !!def.calc(data);
      if (unlocked && !this.data.unlockedAt[def.id]) {
        this.data.unlockedAt[def.id] = this._timeStr(new Date());
      }
      return Object.assign(base, {
        type: 'simple',
        unlocked,
        locked: false,
        progress: unlocked
          ? 1
          : Math.min(1, this.data.totalSeconds / (10 * 3600)),
        progressText: unlocked
          ? '已达成'
          : `总使用 ${Math.floor(this.data.totalSeconds / 3600)}h / 10h 后开始判定`,
      });
    });
  }

}

module.exports = { LifeTagsManager };
