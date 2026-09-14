// 生活词条定义（数据驱动，未来新增词条只加在这里，不改核心引擎）
//
// 字段说明：
//   id           词条唯一标识
//   name         显示名称
//   icon         图标（emoji）
//   description  简短描述
//   slot         依赖的时段（等级词条用，对应 slotSeconds 的 key）
//   maxLevel     最高等级（等级词条用）
//   thresholds   等级阈值数组（等级词条用），区间左开右闭 (t, next]
//   minDays      解锁所需最少使用天数（等级词条用）
//   calc(data)   计算函数：等级词条返回比例(0-1)，简单词条返回布尔(是否解锁)
//
// data 结构：
//   totalSeconds   总有效秒数
//   slotSeconds    { night, morning, day, evening }
//   sceneCounts    { work, fun, other, total } 场景统计（场景词条用）
//   useDays        ["YYYY-MM-DD", ...]

// 场景占比：对应场景数 ÷ 总场景数（总场景含"其他"），暂无数据时返回 0
const sceneRatio = (data, scene) => {
  const counts = data.sceneCounts || {};
  const total = counts.total || 0;
  return total > 0 ? (counts[scene] || 0) / total : 0;
};

module.exports = [
  {
    id: 'night_owl',
    name: '夜猫子',
    icon: '🦉',
    description: '深夜仍在使用电脑的习惯',
    slot: 'night',
    maxLevel: 5,
    thresholds: [0.65, 0.75, 0.85, 0.90, 0.95],
    minDays: 14,
    calc: (data) => data.totalSeconds > 0
      ? data.slotSeconds.night / data.totalSeconds
      : 0,
  },
  {
    id: 'early_bird',
    name: '早鸟',
    icon: '🌅',
    description: '清晨就开始使用电脑的习惯',
    slot: 'morning',
    maxLevel: 5,
    thresholds: [0.65, 0.75, 0.85, 0.90, 0.95],
    minDays: 14,
    calc: (data) => data.totalSeconds > 0
      ? data.slotSeconds.morning / data.totalSeconds
      : 0,
  },
  {
    id: 'homebody',
    name: '家里蹲',
    icon: '🏠',
    description: '长时间宅家使用电脑',
    // 无等级词条：calc 返回是否解锁
    calc: (data) => {
      if (data.totalSeconds <= 10 * 3600) return false; // 总使用 >10h 才开始算
      if (data.useDays.length === 0) return false;
      const avg = data.totalSeconds / data.useDays.length;
      return avg > 3 * 3600; // 日均 > 3h
    },
  },
  {
    id: 'workaholic',
    name: '工作狂',
    icon: '💼',
    description: '屏幕大部分时间都停留在工作场景',
    maxLevel: 5,
    // 区间左开右闭：(65%,75%]=Ⅰ，(75%,85%]=Ⅱ，(85%,90%]=Ⅲ，(90%,95%]=Ⅳ，(95%,100%]=Ⅴ
    thresholds: [0.65, 0.75, 0.85, 0.90, 0.95],
    minDays: 14,
    calc: (data) => sceneRatio(data, 'work'),
  },
  {
    id: 'player',
    name: '"玩"家',
    icon: '🎮',
    description: '屏幕大部分时间都停留在娱乐场景',
    maxLevel: 5,
    thresholds: [0.65, 0.75, 0.85, 0.90, 0.95],
    minDays: 14,
    calc: (data) => sceneRatio(data, 'fun'),
  },
  {
    id: 'slacker',
    name: '摸鱼大师',
    icon: '🐟',
    description: '工作与娱乐都不占多数，屏幕时间另有去处',
    // 无等级词条：工作、娱乐占比都低于 65% 时解锁
    minDays: 14,
    calc: (data) => {
      const counts = data.sceneCounts || {};
      if (!(counts.total > 0)) return false;
      return sceneRatio(data, 'work') < 0.65 && sceneRatio(data, 'fun') < 0.65;
    },
  },
];
