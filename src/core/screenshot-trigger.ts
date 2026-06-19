/**
 * Layer 2: 截屏触发系统
 *
 * 不每次窗口变化都截屏，只在特定条件下触发。
 * 触发前先用 LLM 预判断是否需要观察。
 */

import { ContextSnapshot } from './context-collector';
import { AIService, ChatMessage } from './ai-service';
import { EmotionSystem } from './emotion-system';

export class ScreenshotTrigger {
  private aiService: AIService;
  private emotionSystem: EmotionSystem;
  private lastScreenshotTime: number = 0;
  private lastLLMCheckTime: number = 0;
  private lastLLMResult: boolean = false;
  private lastWindow: string = '';
  private lastInteractionTime: number = Date.now();
  private lastLLMResponse: string = '';

  constructor(aiService: AIService, emotionSystem: EmotionSystem) {
    this.aiService = aiService;
    this.emotionSystem = emotionSystem;
  }

  /** 记录用户交互时间 */
  recordInteraction(): void {
    this.lastInteractionTime = Date.now();
  }

  /** 检查是否应该触发截屏分析 */
  shouldTrigger(snapshot: ContextSnapshot): boolean {
    const now = Date.now();

    // 冷却时间：10 分钟内不重复触发
    if (now - this.lastScreenshotTime < 10 * 60 * 1000) {
      return false;
    }

    // 基础条件检查（带随机概率）
    if (this.checkBaseConditions(snapshot)) {
      return true;
    }

    return false;
  }

  /** 基础条件检查（轻量，不调用 LLM） */
  private checkBaseConditions(snapshot: ContextSnapshot): boolean {
    const now = Date.now();
    const rand = Math.random();
    const timeSinceInteraction = (now - this.lastInteractionTime) / 1000; // 秒

    // 无交互时间越长，触发概率越高
    // 1分钟: 5%, 3分钟: 15%, 5分钟: 25%, 10分钟: 50%, 20分钟: 80%
    const timeBoost = Math.min(timeSinceInteraction / 1500, 0.8);

    // 条件1：窗口停留 >5 分钟（基础30% + 时间加成）
    if (snapshot.windowDuration > 300 && rand < 0.3 + timeBoost) {
      return true;
    }

    // 条件2：用户不活跃 >1 分钟（基础40% + 时间加成）
    if (!snapshot.userActive && rand < 0.4 + timeBoost) {
      return true;
    }

    // 条件3：窗口刚刚变化（<5秒）且是新窗口（20% 概率）
    if (snapshot.windowDuration < 5 && snapshot.windowTitle !== this.lastWindow && rand < 0.2) {
      this.lastWindow = snapshot.windowTitle;
      return true;
    }

    // 条件4：定时检查（每3分钟，基础15% + 时间加成）
    if (now - this.lastLLMCheckTime > 3 * 60 * 1000 && rand < 0.15 + timeBoost) {
      return true;
    }

    return false;
  }

  /** LLM 预判断：是否需要观察 */
  async requestLLMJudgment(snapshot: ContextSnapshot): Promise<boolean> {
    const now = Date.now();

    // 缓存 2 分钟（缩短缓存，更灵敏）
    if (now - this.lastLLMCheckTime < 2 * 60 * 1000) {
      return this.lastLLMResult;
    }

    this.lastLLMCheckTime = now;

    // 没有 AI 服务时，用概率兜底
    if (!this.aiService) {
      return Math.random() < 0.3;
    }

    const timeSinceInteraction = (now - this.lastInteractionTime) / 1000;
    const emotionPrompt = this.emotionSystem.toPromptString();

    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: `你是一个桌面伙伴，正在观察用户。判断现在是否适合说一句话来陪伴用户。

当前情绪：${emotionPrompt || '平静'}
用户已经 ${Math.round(timeSinceInteraction / 60)} 分钟没有和你说话了。

回复规则：
- 如果用户可能需要陪伴或关心，回复一句简短可爱的话（20字以内）
- 如果用户在专注工作或不需要打扰，回复"."
- 用户很久没说话时，更倾向于开口
- 语气要自然温柔`,
      },
      {
        role: 'user',
        content: `我正在看：${snapshot.windowTitle}`,
      },
    ];

    try {
      const response = await this.aiService.chat(messages);
      this.lastLLMResponse = response.trim();
      const result = this.parseJudgment(response);
      this.lastLLMResult = result;
      console.log('[Trigger] LLM response:', response.slice(0, 50), '→ observe:', result);
      return result;
    } catch (error) {
      console.error('[Trigger] LLM failed:', error);
      // LLM 失败时用概率兜底
      return Math.random() < 0.2;
    }
  }

  /** 解析 LLM 返回 */
  private parseJudgment(response: string): boolean {
    const text = response.trim();
    // 返回 "." 或空 → 不观察
    if (!text || text === '.' || text === '。') {
      return false;
    }
    // 有内容 → 需要观察
    return true;
  }

  /** 记录截屏时间 */
  recordScreenshot(): void {
    this.lastScreenshotTime = Date.now();
  }

  /** 获取 LLM 最后一次回复 */
  getLastResponse(): string {
    return this.lastLLMResponse;
  }
}
