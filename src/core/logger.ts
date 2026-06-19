import * as fs from 'fs';
import * as path from 'path';
import { app, BrowserWindow } from 'electron';

export type LogCategory = 'state' | 'drag' | 'tts' | 'observer' | 'chat' | 'ai' | 'error' | 'info';

interface LogEntry {
  time: string;
  category: LogCategory;
  message: string;
}

class Logger {
  private logPath: string;
  private stream: fs.WriteStream | null = null;
  private debugWindow: BrowserWindow | null = null;
  private logBuffer: LogEntry[] = [];
  private maxBuffer = 200;

  constructor() {
    const logDir = path.join(app.getPath('userData'), 'logs');
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    this.logPath = path.join(logDir, `quiet-companion-${dateStr}.log`);
    this.stream = fs.createWriteStream(this.logPath, { flags: 'a' });
  }

  private formatTime(): string {
    const now = new Date();
    return now.toISOString().replace('T', ' ').slice(0, 23);
  }

  private formatTimeShort(): string {
    const now = new Date();
    return now.toTimeString().slice(0, 8);
  }

  /** 写入日志（文件 + 调试窗口） */
  log(category: LogCategory, message: string): void {
    const time = this.formatTimeShort();
    const entry: LogEntry = { time, category, message };

    // 写入文件
    const line = `[${this.formatTime()}] [${category.toUpperCase()}] ${message}\n`;
    this.stream?.write(line);

    // 发送到调试窗口
    this.logBuffer.push(entry);
    if (this.logBuffer.length > this.maxBuffer) {
      this.logBuffer.shift();
    }
    this.sendToDebugWindow(entry);
  }

  /** 发送日志到调试窗口 */
  private sendToDebugWindow(entry: LogEntry): void {
    if (this.debugWindow && !this.debugWindow.isDestroyed()) {
      this.debugWindow.webContents.send('debug-log', entry);
    }
  }

  /** 设置调试窗口 */
  setDebugWindow(win: BrowserWindow | null): void {
    this.debugWindow = win;
    // 如果有缓冲的日志，发送给新窗口
    if (win && !win.isDestroyed()) {
      for (const entry of this.logBuffer) {
        win.webContents.send('debug-log', entry);
      }
    }
  }

  /** 获取日志文件路径 */
  getLogPath(): string {
    return this.logPath;
  }

  /** 获取最近 N 行日志 */
  getRecentLines(count: number = 100): string {
    try {
      const content = fs.readFileSync(this.logPath, 'utf-8');
      const lines = content.split('\n').filter(l => l.trim());
      return lines.slice(-count).join('\n');
    } catch {
      return '';
    }
  }
}

// 单例
let instance: Logger | null = null;

export function getLogger(): Logger {
  if (!instance) {
    instance = new Logger();
  }
  return instance;
}
