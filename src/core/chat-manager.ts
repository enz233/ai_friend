import { BrowserWindow } from 'electron';
import { AIConfigManager } from './ai-config';
import { AIService, ChatMessage } from './ai-service';
import { AIMemory } from './ai-memory';
import { StateManager } from './state-manager';
import { getLogger } from './logger';
import { EmotionSystem } from './emotion-system';
import { EmotionUpdater } from './emotion-updater';
import { TimeAwareness } from './time-awareness';
import { ScreenAnalyzer } from './screen-analyzer';
import { TTSManager } from './tts-manager';

export class ChatManager {
  private aiService: AIService;
  private configManager: AIConfigManager;
  private memory: AIMemory;
  private stateManager: StateManager;
  private emotionSystem: EmotionSystem;
  private emotionUpdater: EmotionUpdater;
  private mainWindow: BrowserWindow;
  private screenAnalyzer: ScreenAnalyzer;
  private ttsManager: TTSManager | null = null;
  private isProcessing = false;
  private lastUserInteraction: number = Date.now();
  private proactiveTimer: ReturnType<typeof setInterval> | null = null;
  private currentActivity: string = '';

  constructor(
    mainWindow: BrowserWindow,
    configManager: AIConfigManager,
    aiService: AIService,
    stateManager: StateManager,
    timeAwareness: TimeAwareness
  ) {
    this.mainWindow = mainWindow;
    this.configManager = configManager;
    this.aiService = aiService;
    this.stateManager = stateManager;
    this.memory = new AIMemory(configManager.getConfigDir());
    this.screenAnalyzer = new ScreenAnalyzer(configManager);

    // 初始化情绪系统
    this.emotionSystem = new EmotionSystem();
    this.emotionSystem.init({ isNight: timeAwareness.isNightTime() || timeAwareness.isLateNight() });
    this.emotionUpdater = new EmotionUpdater(this.emotionSystem, timeAwareness);

    // 每秒更新情绪
    setInterval(() => {
      this.emotionUpdater.tick();
    }, 1000);

    // 启动时总结历史上下文成记忆
    this.memory.summarizeOnStartup(aiService);
    // 初始化关系
    this.memory.initRelationship();

    // 启动主动消息定时器（每3分钟检查一次）
    this.proactiveTimer = setInterval(() => {
      this.checkProactiveMessage();
    }, 3 * 60 * 1000);
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
    this.recordInteraction();
    this.sendBubble('思考中...');

    try {
      // 检查是否为屏幕分析请求（"." 开头）
      if (userMessage.startsWith('.')) {
        const screenMessage = userMessage.slice(1).trim() || '描述一下屏幕上有什么';
        this.sendBubble('正在看屏幕...');
        const screenResult = await this.screenAnalyzer.analyze(screenMessage);
        this.sendBubble(screenResult);
        this.memory.addMessage('user', userMessage);
        this.memory.addMessage('assistant', screenResult);
        return;
      }

      // 构建三层提示词
      const config = this.configManager.get();

      // 第三层：当前状态信息
      const now = new Date();
      const timeStr = now.toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit' });
      const dayOfWeek = ['日', '一', '二', '三', '四', '五', '六'][now.getDay()];
      const currentState = this.stateManager.getCurrentState();
      const emotionPrompt = this.emotionSystem.toPromptString();
      const statusPrompt = [
        `当前时间：${timeStr}，星期${dayOfWeek}`,
        `当前状态：${currentState}`,
        emotionPrompt ? `当前情绪：${emotionPrompt}` : '',
        this.memory.getRelationshipPrompt(),
      ].filter(Boolean).join('\n');

      const systemPrompt = this.memory.buildSystemPrompt(
        config.systemPrompt,
        RESPONSE_FORMAT_PROMPT,
        statusPrompt
      );

      const messages: ChatMessage[] = [
        { role: 'system', content: systemPrompt },
        ...this.memory.getRecentMessages(config.historyMaxLength - 1),
        { role: 'user', content: userMessage },
      ];

      // Debug: 打印发送给 AI 的完整消息
      const log = getLogger();
      log.log('chat', '=== AI Prompt Start ===');
      for (const msg of messages) {
        if (msg.role === 'system') {
          // 系统提示词按【】分段显示
          const sections = msg.content.split(/(?=【)/);
          for (const section of sections) {
            if (section.trim()) {
              log.log('chat', `[system] ${section.trim()}`);
            }
          }
        } else {
          log.log('chat', `[${msg.role}] ${msg.content}`);
        }
      }
      log.log('chat', '=== AI Prompt End ===');

      // 保存用户消息到历史（在构建消息数组之后，避免重复）
      this.memory.addMessage('user', userMessage);

      // 流式调用
      const fullResponse = await this.aiService.chatStream(messages, (_chunk, _total) => {
        // 流式回调（目前不处理中间结果）
      });

      // 解析响应并拆分长文本
      const parsedItems = this.parseResponse(fullResponse);
      const rawTexts = parsedItems.length > 0 ? parsedItems : [fullResponse || ''];
      const texts: string[] = [];
      for (const t of rawTexts) {
        // 超过 30 字自动拆分
        if (t.length > 30) {
          const parts = this.splitText(t, 30);
          texts.push(...parts);
        } else {
          texts.push(t);
        }
      }

      // 保存 AI 回复到历史
      this.memory.addMessage('assistant', fullResponse);

      // 关系追踪：聊天增加好感和熟悉
      this.memory.recordInteraction();
      this.memory.changeAffection(0.3);     // 普通聊天 +0.3
      this.memory.changeFamiliarity(0.1);   // 聊天后更熟悉 +0.1

      // TTS 模式：批量合成，按顺序播放
      // 非 TTS 模式：直接显示气泡
      if (this.ttsManager) {
        const ttsTexts = texts.map(t => t.slice(0, 200));
        await this.ttsManager.speakAll(ttsTexts);
      } else {
        for (let i = 0; i < texts.length; i++) {
          if (i > 0) {
            await this.delay(1500 + Math.random() * 1000);
          }
          this.sendBubble(texts[i]);
        }
      }

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

  /** 更新活动监视结果（由 BubbleManager 调用） */
  updateActivity(activity: string): void {
    this.currentActivity = activity;
  }

  /** 记录用户交互时间 */
  recordInteraction(): void {
    this.lastUserInteraction = Date.now();
    this.emotionUpdater.onInteraction();
  }

  /** 检查是否需要发送主动消息 */
  private async checkProactiveMessage(): Promise<void> {
    if (this.isProcessing) return;
    if (!this.configManager.isValid()) return;

    const timeSinceInteraction = Date.now() - this.lastUserInteraction;
    const PROACTIVE_THRESHOLD = 5 * 60 * 1000; // 5分钟无交互

    if (timeSinceInteraction < PROACTIVE_THRESHOLD) return;

    try {
      console.log('[ChatManager] 触发主动消息...');
      await this.sendProactiveMessage();
    } catch (error: any) {
      console.error('[ChatManager] 主动消息失败:', error.message);
    }
  }

  /** 发送主动消息 */
  private async sendProactiveMessage(): Promise<void> {
    const now = new Date();
    const timeStr = now.toLocaleString('zh-CN', {
      hour: '2-digit', minute: '2-digit',
    });
    const dayOfWeek = ['日', '一', '二', '三', '四', '五', '六'][now.getDay()];
    const currentState = this.stateManager.getCurrentState();

    // 构建上下文
    let context = `现在是${timeStr}，星期${dayOfWeek}。`;
    context += `用户当前的状态是"${currentState}"。`;
    if (this.currentActivity) {
      context += `用户正在使用的应用是"${this.currentActivity}"。`;
    }

    const config = this.configManager.get();
    const systemPrompt = this.memory.buildSystemPrompt(config.systemPrompt, RESPONSE_FORMAT_PROMPT);
    const memoryContext = this.memory.getSummary()
      ? '\n\n关于用户的一些了解：' + this.memory.getSummary()
      : '';

    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'system', content: `${context}${memoryContext}\n\n你已经一段时间没有和用户聊天了。请结合之前的聊天记录以及当前用户的状态，主动发一段简短的关心或问候。要自然可爱，不要像机器人。不要用<item>标签，直接输出文字，限制30字以内。` },
    ];

    const response = await this.aiService.chat(messages);
    if (response && response.trim()) {
      this.sendBubble(response.trim().slice(0, 30));
      // 记录这次交互，避免连续触发
      this.lastUserInteraction = Date.now();
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

  /** 拆分长文本，按标点或字数拆分 */
  private splitText(text: string, maxLen: number): string[] {
    const parts: string[] = [];
    // 先按中文标点拆分
    const sentences = text.split(/([。！？，；：、\n])/);
    let current = '';
    for (const s of sentences) {
      if (current.length + s.length > maxLen && current.length > 0) {
        parts.push(current.trim());
        current = '';
      }
      current += s;
    }
    if (current.trim()) {
      parts.push(current.trim());
    }
    // 如果还有超长的，硬切
    const result: string[] = [];
    for (const p of parts) {
      if (p.length > maxLen) {
        for (let i = 0; i < p.length; i += maxLen) {
          result.push(p.slice(i, i + maxLen));
        }
      } else {
        result.push(p);
      }
    }
    return result.length > 0 ? result : [text];
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

  /** 获取情绪更新器（供 TransitionEngine 使用） */
  getEmotionUpdater(): EmotionUpdater {
    return this.emotionUpdater;
  }

  /** 设置 TTS 管理器 */
  setTTSManager(ttsManager: TTSManager): void {
    this.ttsManager = ttsManager;
  }

  /** 获取记忆模块（供 ObserverManager 使用） */
  getMemory(): AIMemory {
    return this.memory;
  }

  /** 修改好感度（供 TransitionEngine 使用） */
  changeAffection(delta: number): void {
    this.memory.changeAffection(delta);
  }

  /** 关闭时总结记忆 */
  async summarizeOnShutdown(): Promise<void> {
    await this.memory.summarizeOnShutdown(this.aiService);
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
