const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { writeJsonAtomic } = require('./atomic-file');

const TOTALS_PATH = path.join(app.getPath('userData'), 'totals.json');


function readNonNegativeInteger(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

class StatsTracker {
  constructor() {
    this.startTime = null;
    this.endTime = null;
    this.messageCount = 0;
    this.totalTokens = 0;
    this.status = 'stopped';
    this.totalUptime = 0;
    this.totalMessages = 0;
    this.totalTokensAll = 0;
    this.loadTotals();
  }

  loadTotals() {
    try {
      if (fs.existsSync(TOTALS_PATH)) {
        const data = JSON.parse(fs.readFileSync(TOTALS_PATH, 'utf-8'));
        if (!data || typeof data !== 'object') return;
        this.totalUptime = readNonNegativeInteger(data.totalUptime);
        this.totalMessages = readNonNegativeInteger(data.totalMessages);
        this.totalTokensAll = readNonNegativeInteger(data.totalTokensAll);
      }
    } catch { /* ignore */ }
  }

  saveTotals() {
    try {
      writeJsonAtomic(TOTALS_PATH, {
        totalUptime: this.totalUptime,
        totalMessages: this.totalMessages,
        totalTokensAll: this.totalTokensAll,
      });
    } catch { /* ignore */ }
  }

  start() {
    this.startTime = Date.now();
    this.endTime = null;
    this.messageCount = 0;
    this.totalTokens = 0;
    this.status = 'running';
  }

  stop() {
    // 冻结本次运行时长，避免停止后面板刷新时 uptime 继续增长。
    if (this.startTime && this.endTime === null) this.endTime = Date.now();
    this.status = 'stopped';
  }

  setIdle(idle) {
    if (this.status === 'running' || this.status === 'idle') {
      this.status = idle ? 'idle' : 'running';
    }
  }

  addMessage() {
    this.messageCount++;
    this.totalMessages++;
  }

  addTokens(count) {
    const value = readNonNegativeInteger(count);
    if (value === 0) return;
    this.totalTokens += value;
    this.totalTokensAll += value;
  }

  addUptime(seconds) {
    const value = readNonNegativeInteger(seconds);
    if (value === 0) return;
    this.totalUptime += value;
  }

  /**
   * 将累计值写盘。由外部定时调用（每 30s）或退出时调用，
   * 避免每次 addXxx 都同步写磁盘。
   */
  flush() {
    this.saveTotals();
  }

  getStats() {
    const endTime = this.status === 'stopped' && this.endTime !== null ? this.endTime : Date.now();
    const uptime = this.startTime ? Math.max(0, Math.floor((endTime - this.startTime) / 1000)) : 0;
    return {
      uptime,
      messages: this.messageCount,
      tokens: this.totalTokens,
      status: this.status,
      totalUptime: this.totalUptime,
      totalMessages: this.totalMessages,
      totalTokensAll: this.totalTokensAll,
    };
  }
}

module.exports = { StatsTracker };
