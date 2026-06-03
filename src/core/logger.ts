import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';

class Logger {
  private logPath: string;
  private stream: fs.WriteStream | null = null;

  constructor() {
    // 日志文件放在 app 同级目录的 logs 文件夹
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

  private write(level: string, source: string, message: string): void {
    const line = `[${this.formatTime()}] [${level}] [${source}] ${message}\n`;
    this.stream?.write(line);
  }

  info(source: string, message: string): void {
    this.write('INFO', source, message);
    console.log(`[${source}] ${message}`);
  }

  warn(source: string, message: string): void {
    this.write('WARN', source, message);
    console.warn(`[${source}] ${message}`);
  }

  error(source: string, message: string): void {
    this.write('ERROR', source, message);
    console.error(`[${source}] ${message}`);
  }

  debug(source: string, message: string): void {
    this.write('DEBUG', source, message);
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
