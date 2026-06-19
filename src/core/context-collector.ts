/**
 * Layer 1: 轻量上下文收集器
 *
 * 持续运行，无截图，无 LLM 调用。
 * 每 30 秒收集一次当前上下文信息。
 */

import * as os from 'os';
import { exec } from 'child_process';

export interface ContextSnapshot {
  windowTitle: string;
  processName: string;
  windowDuration: number;   // 当前窗口停留秒数
  userActive: boolean;      // 用户是否活跃
  currentTime: Date;
}

export class ContextCollector {
  private lastWindowTitle: string = '';
  private lastWindowChangeTime: number = Date.now();
  private lastUserActivityTime: number = Date.now();
  private activityListeners: (() => void)[] = [];

  constructor() {
    // 监听用户活动（鼠标/键盘）
    this.setupActivityListeners();
  }

  /** 收集当前上下文快照 */
  async collect(): Promise<ContextSnapshot> {
    const windowTitle = await this.getActiveWindowTitle();
    console.log('[Context] raw window title:', JSON.stringify(windowTitle));
    const now = Date.now();

    // 检测窗口变化
    if (windowTitle !== this.lastWindowTitle) {
      this.lastWindowTitle = windowTitle;
      this.lastWindowChangeTime = now;
    }

    const windowDuration = (now - this.lastWindowChangeTime) / 1000;
    const userActive = (now - this.lastUserActivityTime) < 5000; // 5秒内有活动

    return {
      windowTitle,
      processName: this.extractProcessName(windowTitle),
      windowDuration,
      userActive,
      currentTime: new Date(),
    };
  }

  /** 记录用户活动（由外部调用） */
  recordUserActivity(): void {
    this.lastUserActivityTime = Date.now();
  }

  /** 获取当前窗口停留时间（秒） */
  getWindowDuration(): number {
    return (Date.now() - this.lastWindowChangeTime) / 1000;
  }

  /** 用户是否活跃（5秒内有操作） */
  isUserActive(): boolean {
    return (Date.now() - this.lastUserActivityTime) < 5000;
  }

  /** 从窗口标题提取进程名 */
  private extractProcessName(title: string): string {
    if (!title) return '';
    // 常见应用识别
    const patterns: Record<string, string> = {
      'Visual Studio Code': 'VSCode',
      'WebStorm': 'WebStorm',
      'IntelliJ': 'IntelliJ',
      'PyCharm': 'PyCharm',
      'Cursor': 'Cursor',
      'Chrome': 'Chrome',
      'Firefox': 'Firefox',
      'Edge': 'Edge',
      'YouTube': 'YouTube',
      'Bilibili': 'Bilibili',
      '微信': 'WeChat',
      'QQ': 'QQ',
      'Steam': 'Steam',
      'Word': 'Word',
      'PowerPoint': 'PowerPoint',
      'Excel': 'Excel',
      'Notion': 'Notion',
    };
    for (const [key, value] of Object.entries(patterns)) {
      if (title.includes(key)) return value;
    }
    return title.split(' - ')[0] || title;
  }

  /** 获取前台窗口标题（跨平台） */
  private getActiveWindowTitle(): Promise<string> {
    const platform = os.platform();
    return new Promise((resolve) => {
      let cmd: string;
      if (platform === 'darwin') {
        cmd = `osascript -e 'tell application "System Events" to get name of first application process whose frontmost is true'`;
      } else if (platform === 'win32') {
        // 使用更简单的 PowerShell 命令
        cmd = 'powershell -NoProfile -Command "(Get-Process | Where-Object {$_.MainWindowTitle -ne \'\'} | Select-Object -First 1).MainWindowTitle"';
      } else {
        resolve('');
        return;
      }
      exec(cmd, { timeout: 5000 }, (error, stdout) => {
        if (error) {
          console.log('[Context] getActiveWindowTitle error:', error.message);
          resolve('');
          return;
        }
        resolve(stdout.trim());
      });
    });
  }

  /** 设置用户活动监听（鼠标/键盘） */
  private setupActivityListeners(): void {
    // 由外部通过 recordUserActivity() 调用
  }
}
