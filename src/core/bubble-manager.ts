import { BrowserWindow } from 'electron';
import { exec } from 'child_process';
import { TimeAwareness } from './time-awareness';
import { StateManager } from './state-manager';

/**
 * 气泡管理器 - 管理时间问候、交互气泡、活动监视
 */
export class BubbleManager {
  private mainWindow: BrowserWindow;
  private timeAwareness: TimeAwareness;
  private stateManager: StateManager;
  private activityMonitorTimer: ReturnType<typeof setInterval> | null = null;
  private lastActivityBubble: string = '';

  constructor(mainWindow: BrowserWindow, timeAwareness: TimeAwareness, stateManager: StateManager) {
    this.mainWindow = mainWindow;
    this.timeAwareness = timeAwareness;
    this.stateManager = stateManager;
  }

  /** 启动时发送问候语 */
  showGreeting(): void {
    const greeting = this.timeAwareness.getGreeting();
    this.sendBubble(greeting);
  }

  /** 启动活动监视 */
  startActivityMonitor(intervalMs: number = 45000): void {
    if (this.activityMonitorTimer) return;
    this.activityMonitorTimer = setInterval(() => {
      this.checkActivity();
    }, intervalMs);
  }

  /** 停止活动监视 */
  stopActivityMonitor(): void {
    if (this.activityMonitorTimer) {
      clearInterval(this.activityMonitorTimer);
      this.activityMonitorTimer = null;
    }
  }

  /** 检测当前活动 */
  private async checkActivity(): Promise<void> {
    try {
      const title = await this.getActiveWindowTitle();
      if (!title) return;

      const bubble = this.matchActivity(title);
      if (bubble && bubble !== this.lastActivityBubble) {
        this.lastActivityBubble = bubble;
        this.sendBubble(bubble);
      }
    } catch (e) {
      // 静默失败
    }
  }

  /** 获取前台窗口标题（Windows） */
  private getActiveWindowTitle(): Promise<string> {
    return new Promise((resolve) => {
      // 使用 encoded command 避免引号嵌套问题
      const script = [
        'Add-Type -TypeDefinition @"',
        'using System;',
        'using System.Runtime.InteropServices;',
        'using System.Text;',
        'public class Win32 {',
        '  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();',
        '  [DllImport("user32.dll", CharSet=CharSet.Auto)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);',
        '}',
        '"@',
        '$h = [Win32]::GetForegroundWindow()',
        '$sb = New-Object System.Text.StringBuilder 256',
        '[Win32]::GetWindowText($h, $sb, 256) | Out-Null',
        '$sb.ToString()',
      ].join('; ');
      const encoded = Buffer.from(script, 'utf16le').toString('base64');
      exec(`powershell -NoProfile -EncodedCommand ${encoded}`, { timeout: 5000 }, (error, stdout) => {
        if (error) {
          resolve('');
          return;
        }
        resolve(stdout.trim());
      });
    });
  }

  /** 匹配活动关键词 */
  private matchActivity(title: string): string | null {
    if (!title) return null;

    const rules = [
      { keywords: ['Visual Studio Code', 'VSCode', 'WebStorm', 'IntelliJ', 'PyCharm', 'Cursor'], bubble: '在写代码吗~' },
      { keywords: ['YouTube', 'Bilibili', 'bilibili', '爱奇艺', '腾讯视频', 'Netflix'], bubble: '在看什么呀~' },
      { keywords: ['微信', 'WeChat', 'QQ', 'Telegram', 'Discord', 'Slack'], bubble: '在聊天吗~' },
      { keywords: ['Steam', 'Epic', 'WeGame', '游戏', 'Game'], bubble: '在玩游戏呀~' },
      { keywords: ['Word', 'PowerPoint', 'Excel', 'Notion', '飞书', '钉钉', 'WPS'], bubble: '在工作吗~' },
      { keywords: ['Chrome', 'Firefox', 'Edge', '浏览器', 'Browser', 'Opera'], bubble: '在逛什么呢~' },
    ];

    for (const rule of rules) {
      for (const keyword of rule.keywords) {
        if (title.toLowerCase().includes(keyword.toLowerCase())) {
          return rule.bubble;
        }
      }
    }

    // 关键词未匹配，预留 LLM 接口
    return null;
  }

  /** 预留：LLM 分析接口 */
  private async analyzeWithLLM(windowTitle: string): Promise<string | null> {
    // TODO: 未来接入大模型识别应用
    return null;
  }

  /** 发送气泡到渲染进程（仅在特定状态下） */
  sendBubble(text: string): void {
    const currentState = this.stateManager.getCurrentState();
    const allowed = ['idle', 'curious', 'comfortable'];
    if (!allowed.includes(currentState)) return;

    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('show-bubble', text);
    }
  }
}
