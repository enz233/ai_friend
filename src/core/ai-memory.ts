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

interface MemoryData {
  summary: string;
  lastUpdated: number;
  totalMessages: number;
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
        return JSON.parse(raw);
      }
    } catch (e) {
      console.error('[AIMemory] 加载记忆失败:', e);
    }
    return { summary: '', lastUpdated: 0, totalMessages: 0 };
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
    this.memory = { summary: '', lastUpdated: 0, totalMessages: 0 };
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
      content: '你是一个对话摘要助手。请用中文总结以下对话的要点，' + MAX_SUMMARY_LENGTH + '字以内。\n需要包含：用户的偏好、重要信息、对话主题、用户提到的人或事。\n请用简洁的条目式总结，不要冗余。不要加多余的开场白。',
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

  // ========== 注入 ==========

  buildSystemPrompt(basePrompt: string, formatPrompt: string): string {
    let prompt = basePrompt + '\n\n' + formatPrompt;
    if (this.memory.summary) {
      prompt += '\n\n以下是你对用户的一些了解：\n' + this.memory.summary;
    }
    return prompt;
  }
}
