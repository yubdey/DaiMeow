const PERSONALITIES = require('./personalities.js');
const { getAll, save } = require('./config-store');

class PersonalityManager {
  constructor() {
    this.personalities = PERSONALITIES;
    this.currentId = 'energetic'; // default
  }

  /**
   * 从配置里同步上次选择的人格。
   * 不能放在 constructor：本模块在 app ready 之前就被 require，那时配置还没加载。
   */
  loadFromConfig() {
    const savedId = getAll().personality;
    if (savedId && this.personalities.some(p => p.id === savedId)) {
      this.currentId = savedId;
    }
  }

  getAll() {
    return this.personalities;
  }

  getCurrent() {
    return this.personalities.find(p => p.id === this.currentId) || this.personalities[0];
  }

  setCurrent(id) {
    if (this.personalities.find(p => p.id === id)) {
      // 记住选择，重启后依然生效
      if (this.currentId !== id) save({ personality: id });
      this.currentId = id;
      return true;
    }
    return false;
  }

  buildSystemPrompt() {
    const current = this.getCurrent();
    return current ? current.system_prompt : '';
  }

  getPreview(id) {
    const p = this.personalities.find(p => p.id === id);
    return p ? p.preview : '';
  }
}

module.exports = { PersonalityManager };
