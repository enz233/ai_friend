import * as fs from 'fs';
import * as path from 'path';
import { ChatMessage } from './ai-service';

interface HistoryMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

interface HistoryData {
  messages: HistoryMessage[];
  sinceLastSummary: number;
}

interface AppUsage {
  count: number;        // 使用次数
  lastSeen: number;     // 最后使用时间
  description: string;  // Vision API 返回的描述（可选）
}

interface MemoryData {
  summary: string;
  lastUpdated: number;
  totalMessages: number;
  appUsage: Record<string, AppUsage>;
  affection: number;              // 好感度 0-100
  familiarity: number;            // 熟悉度 0-100
  affectionUpdated: number;       // 上次好感度更新时间
  familiarityUpdated: number;     // 上次熟悉度更新时间
  firstSeen: number;              // 首次使用时间
  totalInteractions: number;      // 总互动次数
  todayInteractions: number;      // 今日互动次数
  todayDate: string;              // 今日日期（用于重置每日计数）
}

const SUMMARY_THRESHOLD = 50;
const SUMMARY_REQUEST_COUNT = 20;
const MAX_SUMMARY_LENGTH = 200;

export class AIMemory {
  private historyPath: string;
  private memoryPath: string;
  private history: HistoryData;
  private memory: MemoryData;

  constructor(configDir: string) {
    this.historyPath = path.join(configDir, 'chat-history.json');
    this.memoryPath = path.join(configDir, 'ai-memory.json');
    this.history = this.loadHistory();
    this.memory = this.loadMemory();
  }

  // ========== 持久化 ==========

  private loadHistory(): HistoryData {
    try {
      if (fs.existsSync(this.historyPath)) {
        const raw = fs.readFileSync(this.historyPath, 'utf-8');
        const data = JSON.parse(raw);
        return {
          messages: Array.isArray(data.messages) ? data.messages : [],
          sinceLastSummary: data.sinceLastSummary || 0,
        };
      }
    } catch (e) {
      console.error('[AIMemory] 加载历史失败:', e);
    }
    return { messages: [], sinceLastSummary: 0 };
  }

  saveHistory(): void {
    try {
      const dir = path.dirname(this.historyPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.historyPath, JSON.stringify(this.history, null, 2), 'utf-8');
    } catch (e) {
      console.error('[AIMemory] 保存历史失败:', e);
    }
  }

  private loadMemory(): MemoryData {
    try {
      if (fs.existsSync(this.memoryPath)) {
        const raw = fs.readFileSync(this.memoryPath, 'utf-8');
        const data = JSON.parse(raw);
        // 兼容旧版本：没有 appUsage 字段时初始化
        if (!data.appUsage) data.appUsage = {};
        return data;
      }
    } catch (e) {
      console.error('[AIMemory] 加载记忆失败:', e);
    }
    return { summary: '', lastUpdated: 0, totalMessages: 0, appUsage: {}, affection: 50, familiarity: 10, affectionUpdated: 0, familiarityUpdated: 0, firstSeen: Date.now(), totalInteractions: 0, todayInteractions: 0, todayDate: '' };
  }

  saveMemory(): void {
    try {
      const dir = path.dirname(this.memoryPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.memoryPath, JSON.stringify(this.memory, null, 2), 'utf-8');
    } catch (e) {
      console.error('[AIMemory] 保存记忆失败:', e);
    }
  }

  // ========== 历史操作 ==========

  addMessage(role: 'user' | 'assistant', content: string): void {
    this.history.messages.push({
      role,
      content,
      timestamp: Date.now(),
    });
    this.history.sinceLastSummary++;
    this.memory.totalMessages++;
    this.saveHistory();
  }

  getRecentMessages(count: number): ChatMessage[] {
    const messages = this.history.messages;
    const start = Math.max(0, messages.length - count);
    return messages.slice(start).map(m => ({
      role: m.role,
      content: m.content,
    }));
  }

  getHistoryCount(): number {
    return this.history.messages.length;
  }

  clearAll(): void {
    this.history = { messages: [], sinceLastSummary: 0 };
    this.memory = { summary: '', lastUpdated: 0, totalMessages: 0, appUsage: {}, affection: 50, familiarity: 10, affectionUpdated: 0, familiarityUpdated: 0, firstSeen: Date.now(), totalInteractions: 0, todayInteractions: 0, todayDate: '' };
    this.saveHistory();
    this.saveMemory();
  }

  // ========== 摘要 ==========

  shouldSummarize(): boolean {
    return this.history.sinceLastSummary >= SUMMARY_THRESHOLD;
  }

  buildSummaryMessages(): ChatMessage[] {
    const messages: ChatMessage[] = [];

    // 系统提示
    messages.push({
      role: 'system',
      content: `你是一个对话摘要助手。请用中文总结以下对话的要点，${MAX_SUMMARY_LENGTH}字以内。

总结要求：
- 只记录有价值的信息，忽略闲聊
- 用户的偏好、习惯、重要信息
- 对话中提到的人或事
- 不要记录屏幕分析的详细内容
- 用简洁的条目式总结
- 不要加开场白或结尾语`,
    });

    // 旧记忆（如果有）
    if (this.memory.summary) {
      messages.push({
        role: 'system',
        content: '之前的记忆：\n' + this.memory.summary,
      });
    }

    // 最近 N 条对话
    const recent = this.getRecentMessages(SUMMARY_REQUEST_COUNT);
    const conversationText = recent.map(m =>
      (m.role === 'user' ? '用户：' : '助手：') + m.content
    ).join('\n');
    messages.push({
      role: 'user',
      content: '[对话记录]\n' + conversationText,
    });

    return messages;
  }

  applySummary(summary: string): void {
    if (!summary || !summary.trim()) return;
    this.memory.summary = summary.trim();
    this.memory.lastUpdated = Date.now();
    this.history.sinceLastSummary = 0;
    this.saveMemory();
    this.saveHistory();
    console.log('[AIMemory] 记忆摘要已更新');
  }

  getSummary(): string {
    return this.memory.summary;
  }

  // ========== 应用使用记录 ==========

  /** 记录应用使用 */
  recordAppUsage(appName: string, description?: string): void {
    if (!appName) return;
    const existing = this.memory.appUsage[appName];
    if (existing) {
      existing.count++;
      existing.lastSeen = Date.now();
      if (description) existing.description = description;
    } else {
      this.memory.appUsage[appName] = {
        count: 1,
        lastSeen: Date.now(),
        description: description || '',
      };
    }
    this.saveMemory();
  }

  /** 获取应用使用记录 */
  getAppUsage(appName: string): AppUsage | undefined {
    return this.memory.appUsage[appName];
  }

  /** 获取所有应用使用记录 */
  getAllAppUsage(): Record<string, AppUsage> {
    return this.memory.appUsage;
  }

  /** 判断是否为常用应用（5次以上） */
  isFrequentApp(appName: string): boolean {
    const usage = this.memory.appUsage[appName];
    return usage ? usage.count >= 5 : false;
  }

  /** 判断是否为新应用 */
  isNewApp(appName: string): boolean {
    return !this.memory.appUsage[appName];
  }

  // ========== 注入 ==========

  /** 构建三层提示词 */
  buildSystemPrompt(
    personalityPrompt: string,
    formatPrompt: string,
    statusPrompt?: string
  ): string {
    let parts: string[] = [];

    // 第一层：人格（最重要）
    parts.push('【以下是你的人格设定】\n' + personalityPrompt);

    // 回复格式
    parts.push('【回复格式要求】\n' + formatPrompt);

    // 第二层：记忆
    if (this.memory.summary) {
      parts.push('【以下是你之前和用户的记忆】\n' + this.memory.summary);
    }

    // 第三层：当前状态
    if (statusPrompt) {
      parts.push('【以下是你现在的状态】\n' + statusPrompt);
    }

    return parts.join('\n\n');
  }

  /** 启动时总结上下文成记忆（合并旧记忆+新对话） */
  async summarizeOnStartup(aiService: any): Promise<void> {
    if (this.history.messages.length < 5) return;

    console.log('[AIMemory] startup: summarizing history...');
    try {
      const summaryMessages = this.buildSummaryMessages();
      const summary = await aiService.chat(summaryMessages);
      if (summary && summary.trim()) {
        this.applySummary(summary);
        console.log('[AIMemory] startup summary done');
      }
    } catch (e) {
      console.error('[AIMemory] startup summary failed:', e);
    }
  }

  /** 关闭时总结（快速，不等待太久） */
  async summarizeOnShutdown(aiService: any): Promise<void> {
    if (this.history.messages.length < 5) return;
    if (this.history.sinceLastSummary < 5) return; // 最近已经总结过，跳过

    console.log('[AIMemory] shutdown: summarizing...');
    try {
      const summaryMessages = this.buildSummaryMessages();
      const summary = await aiService.chat(summaryMessages);
      if (summary && summary.trim()) {
        this.applySummary(summary);
        console.log('[AIMemory] shutdown summary done');
      }
    } catch (e) {
      console.error('[AIMemory] shutdown summary failed:', e);
    }
  }

  // ========== 好感度与熟悉度 ==========

  /** 修改好感度（钳位 0-100） */
  changeAffection(delta: number): void {
    // 冷却检查：一分钟内不重复变化
    const now = Date.now();
    if (now - this.memory.affectionUpdated < 60000) return;
    this.memory.affectionUpdated = now;

    // 好感度曲线：越高越难涨，越低越难掉
    const aff = this.memory.affection;
    let adjusted = delta;
    if (delta > 0 && aff > 70) adjusted *= 0.7;
    if (delta > 0 && aff < 30) adjusted *= 1.5;
    if (delta < 0 && aff < 30) adjusted *= 0.7;
    if (delta < 0 && aff > 70) adjusted *= 1.5;

    this.memory.affection = Math.max(0, Math.min(100, aff + adjusted));
    this.saveMemory();
  }

  /** 修改熟悉度（只增不减，钳位 0-100） */
  changeFamiliarity(delta: number): void {
    if (delta <= 0) return; // 只增
    const now = Date.now();
    if (now - this.memory.familiarityUpdated < 60000) return;
    this.memory.familiarityUpdated = now;

    this.memory.familiarity = Math.min(100, this.memory.familiarity + delta);
    this.saveMemory();
  }

  /** 获取好感度标签 */
  private affectionLabel(): string {
    const a = this.memory.affection;
    if (a <= 20) return '疏远';
    if (a <= 40) return '一般';
    if (a <= 60) return '友好';
    if (a <= 80) return '亲近';
    return '亲密';
  }

  /** 获取熟悉度标签 */
  private familiarityLabel(): string {
    const f = this.memory.familiarity;
    if (f <= 15) return '陌生人';
    if (f <= 40) return '认识';
    if (f <= 70) return '朋友';
    return '老友';
  }

  /** 记录互动 */
  recordInteraction(): void {
    this.memory.totalInteractions++;

    const today = new Date().toDateString();
    if (this.memory.todayDate !== today) {
      this.memory.todayDate = today;
      this.memory.todayInteractions = 0;
    }
    this.memory.todayInteractions++;
    this.saveMemory();
  }

  /** 获取关系状态提示词 */
  getRelationshipPrompt(): string {
    const aff = this.memory.affection;
    const fam = this.memory.familiarity;
    const days = Math.floor((Date.now() - (this.memory.firstSeen || Date.now())) / 86400000) || 1;

    return `对你的好感度：${Math.round(aff)}/100（${this.affectionLabel()}）
对你的熟悉度：${Math.round(fam)}/100（${this.familiarityLabel()}）
认识时间：约${days}天
今日互动：${this.memory.todayInteractions}次`;
  }

  /** 初始化关系（首次运行时调用） */
  initRelationship(): void {
    const now = Date.now();
    if (!this.memory.firstSeen) {
      this.memory.firstSeen = now;
    }
    if (!this.memory.affection) {
      this.memory.affection = 50;
    }
    if (!this.memory.familiarity) {
      // 根据历史消息数计算初始熟悉度
      const base = Math.min(Math.floor(this.history.messages.length / 100) * 5, 20);
      this.memory.familiarity = Math.max(10, base);
    }
    this.memory.todayDate = new Date().toDateString();
    this.saveMemory();
  }
}
