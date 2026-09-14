// 场景识别：与呆喵台词合并在同一次多模态请求中，不额外发请求，
// 避免重复上传图片产生额外 Token 消耗。模型在台词最前面输出场景标签。
//
// 标记要求放在"本轮用户消息"里，而不是追加到 system 人格提示词：
// 实测（qwen-vl-plus）把格式规范写在人格提示词末尾会把模型的语气带偏、
// 台词变短变干；放在用户消息里既能 100% 拿到标签，又保持人格提示词原样。
// 该标记只在本次请求附加，不写入聊天记录（记录面板保持干净）。
const SCENE_USER_NOTE = '（另外：回复最开头加一个内部标记 [场景:工作] / [场景:娱乐] / [场景:其他]，它不算台词字数，也不会显示给老大）';

const SCENE_LABELS = { '工作': 'work', '娱乐': 'fun', '其他': 'other' };
// 允许 [场景:工作] / 【场景：工作】 等写法
const SCENE_TAG_RE = /[\[【（(]\s*(?:场景)?\s*[:：]\s*(工作|娱乐|其他)\s*[\]】）)]/;

// 每次截图提问的文案（Ollama 与 OpenAI 两条路径共用）
const SCREEN_QUESTION = '（你看了一眼屏幕）看到了什么？简单评论一下喵~';

// 单次请求超时。没有超时的话，一个挂住的请求会让截图循环永久卡在 running，
// 界面既不报错也不再发新请求。超时后按普通失败处理（回滚消息 + 上报错误）。
const API_REQUEST_TIMEOUT_MS = 60000;

class ApiClient {
  constructor(configStore, chatManager, statsTracker, personalityManager, ollamaProvider) {
    this.configStore = configStore;
    this.chatManager = chatManager;
    this.statsTracker = statsTracker;
    this.personalityManager = personalityManager;
    this.ollamaProvider = ollamaProvider;
  }

  getSystemPrompt() {
    return this.personalityManager.buildSystemPrompt();
  }

  /**
   * 把场景标记要求附加到"本轮用户消息"末尾。返回新的 messages 数组，
   * 不修改原消息对象，保证聊天记录里保存的仍是干净文案。
   */
  static attachSceneNote(messages, classifyScene) {
    if (!classifyScene) return messages;
    const idx = messages.length - 1;
    const last = messages[idx];
    if (!last || last.role !== 'user') return messages;
    if (typeof last.content === 'string') {
      messages[idx] = { ...last, content: last.content + SCENE_USER_NOTE };
    } else if (Array.isArray(last.content)) {
      messages[idx] = {
        ...last,
        content: last.content.map((part) => (
          part.type === 'text' ? { ...part, text: part.text + SCENE_USER_NOTE } : part
        )),
      };
    }
    return messages;
  }

  /**
   * 剥离台词开头的场景标签，返回 { scene, reply }。
   * scene 为 null 表示这次输出没有可识别的场景标签。
   */
  static extractScene(content) {
    const text = String(content || '');
    const match = text.match(SCENE_TAG_RE);
    if (!match) return { scene: null, reply: text.trim() };
    const reply = (text.slice(0, match.index) + text.slice(match.index + match[0].length)).trim();
    return { scene: SCENE_LABELS[match[1]] || null, reply };
  }

  // 提取非空的历史消息（供两个请求路径共用）
  _filterHistory() {
    return this.chatManager.getMessages().filter(m => {
      if (typeof m.content === 'string') return m.content.trim() !== '';
      if (Array.isArray(m.content)) return m.content.some(c => c.type === 'text' ? c.text.trim() !== '' : true);
      return true;
    });
  }

  async sendScreenshot(base64Image, options = {}) {
    const classifyScene = options.classifyScene !== false;
    const config = this.configStore.getAll();

    if (config.providerType === 'ollama') {
      return this.sendViaOllama(base64Image, config, { classifyScene });
    }

    // 按当前供应商解析 API Key（优先 apiKeys[provider]，旧单 key 兜底）
    const apiKey = config.apiKeys?.[config.provider] || config.apiKey || '';
    if (!apiKey) {
      throw new Error('API Key 未配置，请在设置中填入 API Key');
    }

    // Build user message
    const userMsg = {
      role: 'user',
      content: [
        {
          type: 'image_url',
          image_url: { url: base64Image, detail: 'low' },
        },
        {
          type: 'text',
          text: SCREEN_QUESTION,
        },
      ],
    };

    // Store user msg for history display（请求失败时回滚，避免残留未应答消息）
    const storedUserMsg = this.chatManager.addMessage(userMsg);

    // Send system prompt + last 3 exchanges (6 messages) + current screenshot
    const allHistory = this._filterHistory();
    const recentHistory = allHistory.slice(-6).map(m => {
      if (m.role === 'assistant' && typeof m.content === 'string') {
        return { ...m, content: m.content.slice(0, 25) };
      }
      return m;
    }); // last 3 pairs, assistant replies truncated
    const messages = ApiClient.attachSceneNote([
      { role: 'system', content: this.getSystemPrompt() },
      ...recentHistory,
    ], classifyScene);

    // Send API request with retry on overload
    // 仅对已知支持思考开关的 provider 附带 thinking:disabled，避免其他服务商
    // 严格校验未知字段而返回 400。
    const thinkingProviders = ['moonshot', 'deepseek'];
    const disableThinking = thinkingProviders.some(h => config.apiEndpoint.includes(h));
    const requestBody = {
      model: config.model,
      messages,
      max_tokens: config.maxTokens,
      temperature: config.temperature,
      ...(disableThinking ? { thinking: { type: 'disabled' } } : {}),
    };

    try {
    let lastError;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) {
        console.warn(`[API] Retry ${attempt} after ${attempt * 3}s...`);
        await new Promise(r => setTimeout(r, attempt * 3000));
      }

      const response = await fetch(config.apiEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(API_REQUEST_TIMEOUT_MS),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        lastError = new Error(`API 请求失败 (${response.status}): ${errorBody}`);
        if (response.status === 429 || response.status >= 500) continue; // retry
        throw lastError;
      }

      const data = await response.json();
      const msg = data.choices?.[0]?.message || {};
      const parsed = ApiClient.extractScene(msg.content);
      let reply = parsed.reply.slice(0, 25);

      if (!reply || reply.trim() === '') {
        lastError = new Error('AI 返回了空内容，请重试');
        if (attempt < 2) continue; // retry on empty
        throw lastError;
      }

      this.chatManager.addMessage({ role: 'assistant', content: reply });
      this.statsTracker.addMessage();
      if (data.usage?.total_tokens) {
        this.statsTracker.addTokens(data.usage.total_tokens);
      }
      // 请求了场景识别但模型没给标签时按"无法识别"计入其他
      return { reply, scene: classifyScene ? (parsed.scene || 'other') : null };
    }
    throw lastError;
    } catch (err) {
      this.chatManager.removeMessage(storedUserMsg);
      throw err;
    }
  }

  async sendViaOllama(base64Image, config, options = {}) {
    const classifyScene = options.classifyScene !== false;
    if (!config.model) {
      throw new Error('请先在设置中选择 Ollama 模型');
    }

    // Strip data:image prefix for Ollama (needs raw base64)
    const rawBase64 = base64Image.replace(/^data:image\/\w+;base64,/, '');

    // Build user message in Ollama format
    const userMsg = {
      role: 'user',
      content: SCREEN_QUESTION,
      images: [rawBase64],
    };

    // Store for history display (text-only version)（请求失败时回滚）
    const storedUserMsg = this.chatManager.addMessage(userMsg);

    // Build message history
    const allHistory = this._filterHistory();
    const recentHistory = allHistory.slice(-6).map(m => {
      // Convert OpenAI-format content (array) to Ollama string
      let content = m.content;
      if (Array.isArray(content)) {
        content = content
          .filter(c => c.type === 'text')
          .map(c => c.text)
          .join(' ')
          .trim() || '（图片）';
      }
      if (m.role === 'assistant' && typeof content === 'string') {
        content = content.slice(0, 25);
      }
      // Preserve images for user messages, strip for assistant
      const msg = { role: m.role, content };
      if (m.role === 'user' && m.images) {
        msg.images = m.images;
      }
      return msg;
    });

    const messages = ApiClient.attachSceneNote([
      { role: 'system', content: this.getSystemPrompt() },
      ...recentHistory,
    ], classifyScene);

    const endpoint = config.ollamaEndpoint || 'http://127.0.0.1:11434';

    try {
    let lastError;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) {
        console.warn(`[Ollama] Retry ${attempt} after ${attempt * 3}s...`);
        await new Promise(r => setTimeout(r, attempt * 3000));
      }

      try {
        const data = await this.ollamaProvider.sendChat(endpoint, config.model, messages, {
          temperature: config.temperature,
          maxTokens: config.maxTokens,
        });

        const parsed = ApiClient.extractScene(data.message?.content);
        let reply = parsed.reply.slice(0, 25);

        if (!reply || reply.trim() === '') {
          lastError = new Error('Ollama 返回了空内容');
          if (attempt < 2) continue;
          throw lastError;
        }

        this.chatManager.addMessage({ role: 'assistant', content: reply });
        this.statsTracker.addMessage();
        const totalTokens = (data.eval_count || 0) + (data.prompt_eval_count || 0);
        if (totalTokens > 0) {
          this.statsTracker.addTokens(totalTokens);
        }
        return { reply, scene: classifyScene ? (parsed.scene || 'other') : null };
      } catch (err) {
        if (attempt < 2 && err.message.includes('空内容')) continue;
        throw err;
      }
    }
    throw lastError;
    } catch (err) {
      this.chatManager.removeMessage(storedUserMsg);
      throw err;
    }
  }
}

module.exports = { ApiClient };
