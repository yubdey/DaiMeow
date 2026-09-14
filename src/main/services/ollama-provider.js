// 超时：列模型要快（本地服务，没起就是没起）；对话给慢模型留足时间
const LIST_TIMEOUT_MS = 15000;
const CHAT_TIMEOUT_MS = 120000;

class OllamaProvider {
  /**
   * Fetch installed models from Ollama
   * GET /api/tags
   */
  async fetchModels(endpoint) {
    const url = endpoint.replace(/\/+$/, '') + '/api/tags';
    const response = await fetch(url, { signal: AbortSignal.timeout(LIST_TIMEOUT_MS) });
    if (!response.ok) {
      throw new Error(`Ollama 模型列表获取失败 (${response.status})`);
    }
    const data = await response.json();
    return (data.models || []).map(m => ({
      name: m.name,
      id: m.name,
      size: m.size || 0,
      // Format size to human readable
      sizeStr: this._formatSize(m.size),
    }));
  }

  /**
   * Send a chat request to Ollama with vision support
   * POST /api/chat
   */
  async sendChat(endpoint, model, messages, options = {}) {
    const url = endpoint.replace(/\/+$/, '') + '/api/chat';

    const body = {
      model,
      messages,
      options: {
        temperature: options.temperature ?? 0.6,
        num_predict: options.maxTokens ?? 60,
      },
      stream: false,
      think: false,
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(CHAT_TIMEOUT_MS),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Ollama 请求失败 (${response.status}): ${errorBody}`);
    }

    return response.json();
  }

  _formatSize(bytes) {
    if (!bytes || bytes === 0) return '';
    const gb = bytes / (1024 * 1024 * 1024);
    if (gb >= 1) return gb.toFixed(1) + ' GB';
    const mb = bytes / (1024 * 1024);
    return Math.round(mb) + ' MB';
  }
}

module.exports = { OllamaProvider };
