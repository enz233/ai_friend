import { BrowserWindow } from 'electron';
import { AIConfigManager } from './ai-config';
import { AIService, ChatMessage } from './ai-service';

export class ChatManager {
  private aiService: AIService;
  private configManager: AIConfigManager;
  private mainWindow: BrowserWindow;
  private history: ChatMessage[] = [];
  private isProcessing = false;

  constructor(mainWindow: BrowserWindow, configManager: AIConfigManager, aiService: AIService) {
    this.mainWindow = mainWindow;
    this.configManager = configManager;
    this.aiService = aiService;
  }

  /** 发送用户消息并获取 AI 回复 */
  async sendMessage(userMessage: string): Promise<void> {
    if (this.isProcessing) {
      this.sendBubble('等一下，我还在想...');
      return;
    }

    if (!this.configManager.isValid()) {
      this.sendBubble('还没有配置 API 哦，请打开设置配置一下~');
      return;
    }

    this.isProcessing = true;
    this.sendBubble('思考中...');

    try {
      // 构建消息数组
      const config = this.configManager.get();
      const systemPrompt = config.systemPrompt + '\n\n' + RESPONSE_FORMAT_PROMPT;
      const messages: ChatMessage[] = [
        { role: 'system', content: systemPrompt },
        ...this.getRecentHistory(),
        { role: 'user', content: userMessage },
      ];

      // 流式调用
      let buffer = '';
      const items: string[] = [];

      const fullResponse = await this.aiService.chatStream(messages, (chunk, total) => {
        buffer = total;
        // 解析完整的 <item> 标签
        const regex = /<item>(.*?)<\/item>/g;
        let match;
        while ((match = regex.exec(total)) !== null) {
          const itemText = match[1].trim();
          if (itemText && !items.includes(itemText)) {
            items.push(itemText);
          }
        }
      });

      // 解析最终响应
      const parsedItems = this.parseResponse(fullResponse || buffer);

      if (parsedItems.length === 0) {
        // 如果没有解析到 item，直接显示原始文本
        const rawText = fullResponse || buffer || '...';
        this.sendBubble(rawText.slice(0, 100));
      } else {
        // 逐条显示
        for (let i = 0; i < parsedItems.length; i++) {
          if (i > 0) {
            await this.delay(1500 + Math.random() * 1000);
          }
          this.sendBubble(parsedItems[i]);
        }
      }

      // 保存到历史
      this.history.push({ role: 'user', content: userMessage });
      this.history.push({ role: 'assistant', content: fullResponse || buffer });

      // 限制历史长度
      const maxLength = config.historyMaxLength * 2; // 每轮对话 = user + assistant
      while (this.history.length > maxLength) {
        this.history.shift();
      }

    } catch (error: any) {
      console.error('[ChatManager] AI 调用失败:', error);
      this.sendBubble('出错了... ' + (error.message || ''));
    } finally {
      this.isProcessing = false;
    }
  }

  /** 解析 AI 响应中的 <item> 标签 */
  private parseResponse(text: string): string[] {
    const items: string[] = [];
    const regex = /<item>(.*?)<\/item>/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
      const content = match[1].trim();
      if (content) {
        items.push(content);
      }
    }
    return items;
  }

  /** 获取最近的对话历史 */
  private getRecentHistory(): ChatMessage[] {
    const maxLength = this.configManager.get().historyMaxLength * 2;
    return this.history.slice(-maxLength);
  }

  /** 发送气泡到渲染进程 */
  private sendBubble(text: string): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('show-bubble', text);
    }
  }

  /** 延迟 */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /** 清空历史 */
  clearHistory(): void {
    this.history = [];
  }
}

/** 回复格式提示词 */
const RESPONSE_FORMAT_PROMPT = `回复格式要求：
你需要使用xml格式输出回复。每个回复用<item>标签包裹。
你可以输出多个<item>标签，每个标签包含一句话。
以下是一个回复例子:
<item>今天天气真好呀~</item>
<item>你在做什么呢？</item>

你的回复要简短可爱，一般1-3句话就好。
不要在标签外添加任何其他内容。`;
