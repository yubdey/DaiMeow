// 内存中保留的最大消息数，超出时丢弃最旧消息，防止长时间运行内存持续增长。
// 截图轮次里每张图都会以 base64 常驻内存，所以条数不宜太大：100 条约等于
// 50 张历史截图（每轮 1 条提问 + 1 条回复），再多内存就一直涨。
const MAX_MESSAGES = 100;

class ChatManager {
  constructor() {
    this.messages = [];
  }

  /**
   * @param {object} msg 消息
   * @param {{ hideText?: boolean }} [options]
   *   hideText：这条消息的正文只给模型看，不在「记录」里显示（截图提问就是这种）。
   *   用不可枚举属性做标记，所以既不会混进请求体，也不会被 {...msg} 复制出去。
   */
  addMessage(msg, options = {}) {
    const entry = {
      ...msg,
      timestamp: Date.now(),
    };
    if (options.hideText) {
      Object.defineProperty(entry, 'hideText', { value: true, enumerable: false });
    }
    this.messages.push(entry);
    if (this.messages.length > MAX_MESSAGES) {
      this.messages.splice(0, this.messages.length - MAX_MESSAGES);
    }
    return entry;
  }

  /**
   * 移除指定消息（用于请求失败时回滚已写入的用户消息）。
   * 消息已被溢出清理时 indexOf 为 -1，幂等安全。
   */
  removeMessage(entry) {
    const index = this.messages.indexOf(entry);
    if (index !== -1) {
      this.messages.splice(index, 1);
    }
  }

  getMessages() {
    return [...this.messages];
  }

  getTextOnlyHistory() {
    return this.messages
      .filter(m => m.role !== 'system')
      .map(m => ({
        role: m.role,
        // 截图提问的提示词不列出来，但那张截图照旧显示
        content: m.hideText
          ? ''
          : (typeof m.content === 'string'
            ? m.content
            : this.extractTextContent(m.content)),
        image: this.extractImageContent(m),
        timestamp: m.timestamp,
      }));
  }

  extractTextContent(content) {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      const textPart = content.find(c => c.type === 'text');
      return textPart ? textPart.text : '';
    }
    return '';
  }

  extractImageContent(msg) {
    // Ollama format: images array on the message object
    if (msg.images && Array.isArray(msg.images) && msg.images.length > 0) {
      return 'data:image/jpeg;base64,' + msg.images[0];
    }
    // OpenAI format: image_url inside content array
    const content = msg.content;
    if (Array.isArray(content)) {
      const imgPart = content.find(c => c.type === 'image_url');
      return imgPart ? imgPart.image_url.url : null;
    }
    return null;
  }

  clear() {
    this.messages = [];
  }
}

module.exports = { ChatManager };
