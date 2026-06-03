import { BrowserWindow } from 'electron';
import { AIConfigManager } from './ai-config';
import { AIService, ChatMessage } from './ai-service';
import { AIMemory } from './ai-memory';
import { StateManager } from './state-manager';

/** 各状态的情感前缀 */
const EMOTION_PROMPTS: Record<string, string> = {
  idle: '',
  curious: '（你现在很好奇，对用户的话题很感兴趣）',
  dragged: '（你刚刚被拖拽了，有点惊讶）',
  sleepy: '（你现在很困，说话可能会带点慵懒）',
  sleeping: '（你刚被叫醒，迷迷糊糊的）',
  lonely: '（你刚才很孤单，现在用户终于来找你了，你有点开心）',
  comfortable: '（你现在很舒服很满足，心情很好）',
  tried: '（你有点累，说话简短）',
};

export class ChatManager {
  private aiService: AIService;
  private configManager: AIConfigManager;
  private memory: AIMemory;
  private stateManager: StateManager;
  private mainWindow: BrowserWindow;
  private isProcessing = false;
  private previousState: string = 'idle';
  private previousStateTime: number = Date.now();

  constructor(mainWindow: BrowserWindow, configManager: AIConfigManager, aiService: AIService, stateManager: StateManager) {
    this.mainWindow = mainWindow;
    this.configManager = configManager;
    this.aiService = aiService;
    this.stateManager = stateManager;
    this.memory = new AIMemory(configManager.getConfigDir());

    // 监听状态变化，记录前一个状态
    this.stateManager.onStateChange((event) => {
      this.previousState = event.from;
      this.previousStateTime = Date.now();
    });
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
      // 构建消息数组（含记忆）
      const config = this.configManager.get();
      const systemPrompt = this.memory.buildSystemPrompt(config.systemPrompt, RESPONSE_FORMAT_PROMPT);

      // 根据状态添加情感前缀（切换后4秒内保持上一个状态的提示词）
      const currentState = this.stateManager.getCurrentState();
      const timeSinceChange = Date.now() - this.previousStateTime;
      const effectiveState = (timeSinceChange < 4000) ? this.previousState : currentState;
      const emotionPrefix = EMOTION_PROMPTS[effectiveState] || '';
      const finalUserMessage = emotionPrefix ? emotionPrefix + '\n' + userMessage : userMessage;

      const messages: ChatMessage[] = [
        { role: 'system', content: systemPrompt },
        ...this.memory.getRecentMessages(config.historyMaxLength - 1),
        { role: 'user', content: finalUserMessage },
      ];

      // 保存用户消息到历史（在构建消息数组之后，避免重复）
      this.memory.addMessage('user', userMessage);

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

  /** 发送 AI 问候（启动时调用） */
  async sendGreeting(): Promise<void> {
    if (!this.configManager.isValid()) return;

    try {
      const now = new Date();
      const timeStr = now.toLocaleString('zh-CN', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit',
      });
      const dayOfWeek = ['日', '一', '二', '三', '四', '五', '六'][now.getDay()];

      const config = this.configManager.get();
      const systemPrompt = this.memory.buildSystemPrompt(config.systemPrompt, RESPONSE_FORMAT_PROMPT);
      const memoryContext = this.memory.getSummary()
        ? '\n\n关于用户的一些了解：' + this.memory.getSummary()
        : '';

      const messages: ChatMessage[] = [
        { role: 'system', content: systemPrompt },
        { role: 'system', content: `现在是${timeStr}，星期${dayOfWeek}。${memoryContext}\n请用简短的一句话和用户打招呼，要自然可爱，不要重复固定问候语。不要用<item>标签，直接输出文字。` },
        { role: 'user', content: '（用户刚刚打开了你）' },
      ];

      const response = await this.aiService.chat(messages);
      if (response && response.trim()) {
        // 延迟一下，等固定问候显示完
        await this.delay(3000);
        this.sendBubble(response.trim().slice(0, 50));
      }
    } catch (error: any) {
      console.error('[ChatManager] AI 问候失败:', error.message);
      // 静默失败，不影响使用
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
