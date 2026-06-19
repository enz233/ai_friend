/**
 * 观察管理器
 *
 * 整合三层观察系统：
 * Layer 1: 轻量上下文收集（持续运行）
 * Layer 2: 截屏触发（条件触发）
 * Layer 3: LLM 上下文分析（结构化输出）
 */

import { BrowserWindow } from 'electron';
import { ContextCollector, ContextSnapshot } from './context-collector';
import { ScreenshotTrigger } from './screenshot-trigger';
import { ScreenAnalyzer } from './screen-analyzer';
import { AIService, ChatMessage } from './ai-service';
import { EmotionSystem } from './emotion-system';
import { StateManager } from './state-manager';
import { AIMemory } from './ai-memory';
import { AIConfigManager } from './ai-config';

interface AnalysisResult {
  user_activity: string;
  user_emotion_estimate: string;
  should_speak: boolean;
  importance: number;
  suggested_response: string;
}

export class ObserverManager {
  private contextCollector: ContextCollector;
  private screenshotTrigger: ScreenshotTrigger;
  private screenAnalyzer: ScreenAnalyzer;
  private aiService: AIService;
  private emotionSystem: EmotionSystem;
  private stateManager: StateManager;
  private memory: AIMemory;
  private mainWindow: BrowserWindow;
  private collectTimer: ReturnType<typeof setInterval> | null = null;
  private isAnalyzing = false;

  private configManager: AIConfigManager;

  constructor(
    mainWindow: BrowserWindow,
    aiService: AIService,
    emotionSystem: EmotionSystem,
    stateManager: StateManager,
    memory: AIMemory,
    screenAnalyzer: ScreenAnalyzer,
    configManager: AIConfigManager
  ) {
    this.mainWindow = mainWindow;
    this.aiService = aiService;
    this.emotionSystem = emotionSystem;
    this.stateManager = stateManager;
    this.memory = memory;
    this.screenAnalyzer = screenAnalyzer;
    this.configManager = configManager;
    this.contextCollector = new ContextCollector();
    this.screenshotTrigger = new ScreenshotTrigger(aiService, emotionSystem);
  }

  /** 启动观察系统 */
  start(intervalMs: number = 30000): void {
    if (this.collectTimer) return;
    this.collectTimer = setInterval(() => {
      this.collectAndAnalyze();
    }, intervalMs);
    console.log('[Observer] 观察系统已启动，间隔', intervalMs / 1000, '秒');
  }

  /** 停止观察系统 */
  stop(): void {
    if (this.collectTimer) {
      clearInterval(this.collectTimer);
      this.collectTimer = null;
    }
  }

  /** 记录用户活动（由外部调用） */
  recordActivity(): void {
    this.contextCollector.recordUserActivity();
  }

  private lastWindow: string = '';
  private lastTriggerTime: number = 0;
  private stayTriggered: Set<number> = new Set(); // 已触发的停留阶梯

  /** 收集上下文并检查是否需要分析 */
  private async collectAndAnalyze(): Promise<void> {
    if (this.isAnalyzing) return;

    try {
      const snapshot = await this.contextCollector.collect();

      // 记录应用使用
      if (snapshot.processName) {
        this.memory.recordAppUsage(snapshot.processName);
      }

      // 窗口变化时重置停留阶梯
      if (snapshot.windowTitle !== this.lastWindow) {
        this.stayTriggered.clear();
      }

      // Debug
      console.log('[Observer]', snapshot.windowTitle,
        '|', Math.round(snapshot.windowDuration) + 's',
        '| active:', snapshot.userActive);

      // 检查停留触发（阶梯式）
      const stayTrigger = this.checkStayTrigger(snapshot);
      if (stayTrigger) {
        await this.triggerWithVision(snapshot, stayTrigger);
        return;
      }

      // 检查窗口切换触发（概率式）
      const switchTrigger = this.checkSwitchTrigger(snapshot);
      if (switchTrigger) {
        await this.triggerWithLLM(snapshot, switchTrigger);
      }
    } catch (error) {
      console.error('[Observer] error:', error);
    }
  }

  /** 停留触发：阶梯式时间检查 */
  private checkStayTrigger(snapshot: ContextSnapshot): string | null {
    const duration = snapshot.windowDuration;
    const jitter = (Math.random() - 0.5) * 120; // ±60秒随机抖动

    // 阶梯：10分钟、30分钟、60分钟、90分钟+
    const thresholds = [
      { time: 600, key: '10min', label: '10min stay' },
      { time: 1800, key: '30min', label: '30min stay' },
      { time: 3600, key: '60min', label: '60min stay' },
      { time: 5400, key: '90min', label: '90min stay' },
    ];

    for (const t of thresholds) {
      if (duration >= t.time + jitter && !this.stayTriggered.has(t.time)) {
        this.stayTriggered.add(t.time);
        return t.label;
      }
    }

    // 超过90分钟后每30分钟触发一次
    if (duration > 5400) {
      const extraKey = Math.floor(duration / 1800) * 1800;
      if (!this.stayTriggered.has(extraKey)) {
        this.stayTriggered.add(extraKey);
        return 'long stay';
      }
    }

    return null;
  }

  /** 窗口切换触发：概率式 */
  private checkSwitchTrigger(snapshot: ContextSnapshot): string | null {
    const title = snapshot.windowTitle;
    if (!title || title === this.lastWindow) return null;

    const oldWindow = this.lastWindow;
    this.lastWindow = title;

    const appName = snapshot.processName;
    const isFrequent = this.memory.isFrequentApp(appName);
    const isNew = this.memory.isNewApp(appName);

    const rand = Math.random();

    // 新应用：30% 概率
    if (isNew && rand < 0.3) {
      return 'new app: ' + appName;
    }

    // 常用应用：10% 概率
    if (isFrequent && rand < 0.1) {
      return 'frequent app: ' + appName;
    }

    // 其他：5% 概率
    if (rand < 0.05) {
      return 'switch: ' + appName;
    }

    return null;
  }

  /** 触发 LLM 询问 */
  private async triggerWithLLM(snapshot: ContextSnapshot, reason: string): Promise<void> {
    console.log('[Observer] trigger:', reason);
    const response = await this.screenshotTrigger.requestLLMJudgment(snapshot);
    if (response) {
      const llmText = this.screenshotTrigger.getLastResponse();
      if (llmText && llmText !== '.') {
        console.log('[Observer] LLM says:', llmText);
        this.sendBubble(llmText.slice(0, 30));
      }
    }
  }

  /** 触发 Vision 分析 */
  private async triggerWithVision(snapshot: ContextSnapshot, reason: string): Promise<void> {
    console.log('[Observer] vision trigger:', reason);
    const visionResult = await this.performAnalysis(snapshot);
    if (!visionResult) {
      // Vision 不可用时用 LLM 兜底
      await this.triggerWithLLM(snapshot, reason + ' (fallback)');
    }
  }

  /** 执行截屏分析，返回是否成功 */
  private async performAnalysis(snapshot: ContextSnapshot): Promise<boolean> {
    if (this.isAnalyzing) return false;
    this.isAnalyzing = true;

    try {
      console.log('[Observer] triggering screenshot analysis...');
      this.screenshotTrigger.recordScreenshot();

      // Layer 3: screenshot + LLM analysis
      const screenshot = await this.screenAnalyzer.captureScreen();
      if (!screenshot) {
        console.log('[Observer] screenshot failed');
        return false;
      }
      console.log('[Observer] screenshot OK, sending to Vision API...');

      const result = await this.requestAnalysis(snapshot, screenshot);
      console.log('[Observer] analysis result:', JSON.stringify(result));

      if (result && result.should_speak && result.importance > 0.7) {
        console.log('[Observer] >> speak:', result.suggested_response);
        this.sendBubble(result.suggested_response);
        return true;
      } else {
        console.log('[Observer] >> silent, importance:', result?.importance || 'N/A');
        return false;
      }
    } catch (error) {
      console.error('[Observer] 分析失败:', error);
      return false;
    } finally {
      this.isAnalyzing = false;
    }
    return false;
  }

  /** 发送分析请求给 LLM */
  private async requestAnalysis(context: ContextSnapshot, screenshot: string): Promise<AnalysisResult | null> {
    const emotionPrompt = this.emotionSystem.toPromptString();
    const memorySummary = this.memory.getSummary();

    const systemPrompt = `你是一个安静的桌面伙伴。你正在观察用户的屏幕。
大部分时候你应该保持沉默。只有在真正有意义的时刻才开口说话。

${memorySummary ? '关于用户：' + memorySummary : ''}
当前情绪：${emotionPrompt || '平静'}

如果觉得有必要说话，直接回复一句简短可爱的话（20字以内）。
如果觉得没必要说话，回复一个英文句号"."。

规则：
- 大部分时候回复"."
- 只有用户可能需要陪伴时才说话
- 不要打扰正在专注工作的用户
- 说话要简短可爱`;

    const userContent = [
      { type: 'text', text: `当前情绪状态：${emotionPrompt || '平静(50)'}
窗口：${context.windowTitle}
停留：${Math.round(context.windowDuration)}秒
用户状态：${context.userActive ? '活跃' : '不活跃'}
时间：${context.currentTime.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}` },
      { type: 'image_url', image_url: { url: screenshot, detail: 'low' } },
    ];

    try {
      const config = this.getConfig();
      if (!config.visionApiKey || !config.visionBaseURL || !config.visionModel) {
        console.log('[Observer] Vision API 未配置，跳过分析');
        return null;
      }

      const response = await fetch(`${config.visionBaseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.visionApiKey}`,
        },
        body: JSON.stringify({
          model: config.visionModel,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userContent },
          ],
          max_tokens: 500,
        }),
      });

      if (!response.ok) {
        console.error('[Observer] API 请求失败:', response.status);
        return null;
      }

      const data = await response.json() as any;
      const content = data.choices?.[0]?.message?.content;
      if (!content) return null;

      return this.parseAnalysisResult(content);
    } catch (error) {
      console.error('[Observer] 分析请求失败:', error);
      return null;
    }
  }

  /** 解析 LLM 返回的分析结果 */
  private parseAnalysisResult(response: string): AnalysisResult | null {
    const text = response.trim();
    if (!text || text === '.' || text === '。') {
      return null;
    }
    return {
      user_activity: '',
      user_emotion_estimate: '',
      should_speak: true,
      importance: 0.8,
      suggested_response: text.slice(0, 30),
    };
  }

  /** 获取配置 */
  private getConfig(): any {
    return this.configManager.get();
  }

  /** 发送气泡到渲染进程 */
  private sendBubble(text: string): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('show-bubble', text);
    }
  }
}
