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

// 每次截图提问的文案
const SCREEN_QUESTION = '（你看了一眼屏幕）看到了什么？简单评论一下喵~';

// 单次请求超时。没有超时的话，一个挂住的请求会让截图循环永久卡在 running，
// 界面既不报错也不再发新请求。超时后按普通失败处理（回滚消息 + 上报错误）。
const API_REQUEST_TIMEOUT_MS = 60000;

class ApiClient {
  constructor(configStore, chatManager, statsTracker, personalityManager) {
    this.configStore = configStore;
    this.chatManager = chatManager;
    this.statsTracker = statsTracker;
    this.personalityManager = personalityManager;
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

  /**
   * 「关闭思考模式」的请求参数。呆喵只说一句话，思考既拖慢响应、又可能把
   * max_tokens 预算吃光（正文一个字都没剩）。
   *
   * 但各家参数名不统一，传错字段会被严格校验的服务商以 400 拒绝，所以只对
   * 能确认字段的服务商下发；未知服务商返回 null（宁可多思考，也不要请求失败）。
   * 依据（官方文档）：
   *  - 火山方舟：thinking.type=disabled。doubao-seed 系列**默认就是 enabled**，必须显式关
   *  - 智谱：thinking.type=disabled；但 GLM-5.3 / 5.3-Flash 官方明确「不再支持关闭思考，
   *    传 disabled 会报错」，这两个模型跳过（请求侧另有 400 兜底）
   *  - Moonshot / DeepSeek：thinking.type=disabled
   *  - 硅基流动：enable_thinking=false
   *  - 阿里云百炼：qwen3-vl-plus/flash 官方说明默认即关闭思考，带 thinking 后缀的关不掉，
   *    给普通 instruct 模型传 enable_thinking 又有被拒风险 → 不下发
   *  - 自定义 / 其他 / 小米 MiMo：参数未知 → 不下发
   */
  static buildThinkingParams(endpoint, model) {
    const url = String(endpoint || '');
    const id = String(model || '');
    if (url.includes('ark.cn-beijing.volces.com')) return { thinking: { type: 'disabled' } };
    if (url.includes('open.bigmodel.cn')) {
      if (/glm-5\.3/i.test(id)) return null;   // 官方：该系列传 disabled 会报错
      return { thinking: { type: 'disabled' } };
    }
    if (url.includes('api.moonshot.cn') || url.includes('api.deepseek.com')) {
      return { thinking: { type: 'disabled' } };
    }
    if (url.includes('api.siliconflow.cn')) return { enable_thinking: false };
    return null;
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
    // hideText：这句提示词只在请求里出现，不在「记录」面板里显示
    const storedUserMsg = this.chatManager.addMessage(userMsg, { hideText: true });

    // Send system prompt + last 3 exchanges (6 messages) + current screenshot
    // 只有本轮（最后一条）带截图：更早的截图不再重复塞进请求里（省 Vision Token 和上传流量），
    // 但它们的文字内容照旧保留，模型仍然拿得到对话上下文。
    const allHistory = this._filterHistory();
    const recentHistory = allHistory.slice(-6).map((m, i, arr) => {
      const isCurrent = i === arr.length - 1;
      if (m.role === 'assistant' && typeof m.content === 'string') {
        return { ...m, content: m.content.slice(0, 25) };
      }
      if (!isCurrent && m.role === 'user' && Array.isArray(m.content)) {
        const textParts = m.content.filter(c => c.type === 'text');
        return textParts.length ? { ...m, content: textParts } : null;
      }
      return m;
    }).filter(Boolean); // last 3 pairs, assistant replies truncated, 历史截图已剔除
    const messages = ApiClient.attachSceneNote([
      { role: 'system', content: this.getSystemPrompt() },
      ...recentHistory,
    ], classifyScene);

    // 关闭思考模式（呆喵只说一句话，思考既拖慢响应又可能把 token 预算吃光）。
    // 各家的参数名并不一致，传错字段会被严格校验的服务商以 400 拒绝 ——
    // 所以只对能确认字段的服务商下发，其余宁可不发（多思考 << 整条请求失败）。
    let thinkingParams = ApiClient.buildThinkingParams(config.apiEndpoint, config.model);
    // 预算上限与服务商常见上限、面板输入框上限一致
    const MAX_TOKENS_LIMIT = 4096;
    let maxTokens = Math.min(Number(config.maxTokens) || 300, MAX_TOKENS_LIMIT);

    try {
    let lastError;
    let truncatedFallback = '';   // 被截断但至少有内容的回复，作为最后兜底
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) {
        console.warn(`[API] Retry ${attempt} after ${attempt * 3}s...`);
        await new Promise(r => setTimeout(r, attempt * 3000));
      }

      const requestBody = {
        model: config.model,
        messages,
        max_tokens: maxTokens,
        temperature: config.temperature,
        ...(thinkingParams || {}),
      };
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
        // 有些服务商/models 不接受「关闭思考」这个字段（比如智谱 GLM-5.3 传 disabled 会直接报错）：
        // 一旦因此 400，就摘掉该字段重试一次，保证任何模型都还能用。
        if (response.status === 400 && thinkingParams) {
          console.warn('[API] 400 可能是「关闭思考」参数不被接受，去掉该参数重试');
          thinkingParams = null;
          continue;
        }
        if (response.status === 429 || response.status >= 500) continue; // retry
        throw lastError;
      }

      const data = await response.json();
      const choice = data.choices?.[0] || {};
      const msg = choice.message || {};
      // finish_reason=length 表示被 max_tokens 截断（思考型模型常把预算用在思考上，
      // 正文还没开始就没了）。这种情况不能当成普通的"空回复"，否则用户完全查不出原因。
      const truncated = choice.finish_reason === 'length';
      const parsed = ApiClient.extractScene(msg.content);
      let reply = parsed.reply.slice(0, 25);

      if (truncated && reply.length >= truncatedFallback.length) truncatedFallback = reply;

      // 被截断：先加大预算重试（通常能拿到完整台词）
      if (truncated && attempt < 2) {
        const before = maxTokens;
        maxTokens = Math.min(maxTokens * 2, MAX_TOKENS_LIMIT);
        console.warn(`[API] 回复被 max_tokens=${before} 截断，用 ${maxTokens} 重试`);
        continue;
      }

      if (!reply || reply.trim() === '') {
        lastError = truncated
          ? new Error(`回复被 Max Tokens 截断：${config.maxTokens} tokens 不够用（思考模式会先占用预算），请在「设置」里把 Max Tokens 调大`)
          : new Error('AI 返回了空内容，请重试');
        if (attempt < 2) continue; // retry on empty
        throw lastError;
      }

      // 试到最后一次仍被截断：用能拿到的那段内容（总比一句话都没有强）
      if (truncated) reply = truncatedFallback || reply;

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
}

module.exports = { ApiClient };
