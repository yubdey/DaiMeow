// 内存中保留的最大消息数，超出时丢弃最旧消息，防止长时间运行内存持续增长
const MAX_MESSAGES = 200;

class ChatManager {
  constructor() {
    this.messages = [];
  }

  addMessage(msg) {
    const entry = {
      ...msg,
      timestamp: Date.now(),
    };
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
        content: typeof m.content === 'string'
          ? m.content
          : this.extractTextContent(m.content),
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
