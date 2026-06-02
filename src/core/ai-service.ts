import { AIConfigManager } from './ai-config';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export class AIService {
  private configManager: AIConfigManager;

  constructor(configManager: AIConfigManager) {
    this.configManager = configManager;
  }

  /** 非流式调用 */
  async chat(messages: ChatMessage[]): Promise<string> {
    const config = this.configManager.get();
    const response = await fetch(`${config.baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        temperature: config.temperature,
        max_tokens: config.maxTokens,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`API 请求失败 (${response.status}): ${error}`);
    }

    const data = await response.json() as any;
    return data.choices?.[0]?.message?.content ?? '';
  }

  /** 流式调用，逐 chunk 回调 */
  async chatStream(
    messages: ChatMessage[],
    onChunk: (content: string, buffer: string) => void
  ): Promise<string> {
    const config = this.configManager.get();
    const response = await fetch(`${config.baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        temperature: config.temperature,
        max_tokens: config.maxTokens,
        stream: true,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`API 请求失败 (${response.status}): ${error}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('无法读取响应流');

    const decoder = new TextDecoder();
    let buffer = '';
    let total = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        const data = trimmed.slice(6);
        if (data === '[DONE]') continue;

        try {
          const parsed = JSON.parse(data);
          const content = parsed.choices?.[0]?.delta?.content ?? '';
          if (content) {
            total += content;
            onChunk(content, total);
          }
        } catch (e) {
          // 解析失败，跳过
        }
      }
    }

    return total;
  }

  /** 测试连接 */
  async testConnection(): Promise<{ success: boolean; message: string }> {
    if (!this.configManager.isValid()) {
      return { success: false, message: '请先配置 API Key、基础地址和模型' };
    }
    try {
      const response = await this.chat([
        { role: 'system', content: '你是一个测试助手。' },
        { role: 'user', content: '你好，请回复"连接成功"' },
      ]);
      if (response) {
        return { success: true, message: `连接成功！AI 回复: ${response.slice(0, 50)}` };
      }
      return { success: false, message: 'AI 服务未返回有效响应' };
    } catch (error: any) {
      return { success: false, message: `连接失败: ${error.message}` };
    }
  }
}
