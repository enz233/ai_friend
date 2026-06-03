import { BrowserWindow } from 'electron';
import { AIConfigManager } from './ai-config';
import { AIService, ChatMessage } from './ai-service';
import { AIMemory } from './ai-memory';

export class ChatManager {
  private aiService: AIService;
  private configManager: AIConfigManager;
  private memory: AIMemory;
  private mainWindow: BrowserWindow;
  private isProcessing = false;

  constructor(mainWindow: BrowserWindow, configManager: AIConfigManager, aiService: AIService) {
    this.mainWindow = mainWindow;
    this.configManager = configManager;
    this.aiService = aiService;
    this.memory = new AIMemory(configManager.getConfigDir());
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
      // 保存用户消息到历史
      this.memory.addMessage('user', userMessage);

      // 构建消息数组（含记忆）
      const config = this.configManager.get();
      const systemPrompt = this.memory.buildSystemPrompt(config.systemPrompt, RESPONSE_FORMAT_PROMPT);
      const messages: ChatMessage[] = [
        { role: 'system', content: systemPrompt },
        ...this.memory.getRecentMessages(config.historyMaxLength),
        { role: 'user', content: userMessage },
      ];

      // 流式调用
      const fullResponse = await this.aiService.chatStream(messages, (_chunk, _total) => {
        // 流式回调（目前不处理中间结果）
      });

      // 解析响应
      const parsedItems = this.parseResponse(fullResponse);

      if (parsedItems.length === 0) {
        const rawText = fullResponse || '...';
        this.sendBubble(rawText.slice(0, 100));
      } else {
        for (let i = 0; i < parsedItems.length; i++) {
          if (i > 0) {
            await this.delay(1500 + Math.random() * 1000);
          }
          this.sendBubble(parsedItems[i]);
        }
      }

      // 保存 AI 回复到历史
      this.memory.addMessage('assistant', fullResponse);

      // 检查是否需要生成摘要（后台异步，不阻塞）
      if (this.memory.shouldSummarize()) {
        this.summarizeAsync();
      }

    } catch (error: any) {
      console.error('[ChatManager] AI 调用失败:', error);
      this.sendBubble('出错了... ' + (error.message || ''));
    } finally {
      this.isProcessing = false;
    }
  }

  /** 后台异步生成摘要 */
  private async summarizeAsync(): Promise<void> {
    try {
      console.log('[ChatManager] 开始生成记忆摘要...');
      const summaryMessages = this.memory.buildSummaryMessages();
      const newSummary = await this.aiService.chat(summaryMessages);
      if (newSummary && newSummary.trim()) {
        this.memory.applySummary(newSummary);
        console.log('[ChatManager] 记忆摘要已更新');
      }
    } catch (error: any) {
      console.error('[ChatManager] 摘要生成失败:', error.message);
      // 不重置 sinceLastSummary，下次再试
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

  /** 清空历史和记忆 */
  clearHistory(): void {
    this.memory.clearAll();
  }

  /** 获取历史条数 */
  getHistoryCount(): number {
    return this.memory.getHistoryCount();
  }

  /** 获取记忆摘要 */
  getSummary(): string {
    return this.memory.getSummary();
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
