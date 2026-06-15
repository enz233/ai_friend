/**
 * TTS 管理器
 *
 * 统一管理 TTS 引擎选择、语音合成、音频播放。
 * 运行在主进程，通过 IPC 发送音频到渲染进程播放。
 */

import { BrowserWindow } from 'electron';
import { TTSConfigManager, TTSConfig, TTSLanguage } from './tts-config';
import { TTSGptSoVits } from './tts-gpt-sovits';
import { TTSApi } from './tts-api';
import { TTSMiMo } from './tts-mimo';
import { TTSAliyun } from './tts-aliyun';
import { AIService, ChatMessage } from './ai-service';

export class TTSManager {
  private configManager: TTSConfigManager;
  private mainWindow: BrowserWindow;
  private aiService: AIService | null = null;
  private isSpeaking = false;
  private queue: string[] = [];

  constructor(mainWindow: BrowserWindow, configManager: TTSConfigManager) {
    this.mainWindow = mainWindow;
    this.configManager = configManager;
  }

  /** 设置 AI 服务（用于翻译） */
  setAIService(aiService: AIService): void {
    this.aiService = aiService;
  }

  /** 合成并播放语音 */
  async speak(text: string): Promise<void> {
    const config = this.configManager.get();
    if (!config.on) return;

    // 如果正在播放，加入队列
    if (this.isSpeaking) {
      this.queue.push(text);
      return;
    }

    this.isSpeaking = true;

    try {
      // 翻译：将文本翻译为 TTS 目标语言
      let ttsText = text;
      if (config.ttsLanguage !== 'zh' && this.aiService) {
        ttsText = await this.translate(text, config.ttsLanguage);
      }

      // 翻译字幕：将文本翻译为字幕语言
      let subtitleText = text;
      if (config.subtitleLanguage !== 'zh' && this.aiService) {
        subtitleText = await this.translate(text, config.subtitleLanguage);
      }

      const audioData = await this.synthesize(ttsText, config);
      if (audioData) {
        await this.play(audioData, subtitleText);
      }
    } catch (error: any) {
      console.error('[TTS] 语音合成失败:', error.message);
    } finally {
      this.isSpeaking = false;

      // 播放队列中的下一条
      if (this.queue.length > 0) {
        const next = this.queue.shift()!;
        this.speak(next);
      }
    }
  }

  /** 调用 AI 翻译文本 */
  private async translate(text: string, targetLang: TTSLanguage): Promise<string> {
    if (!this.aiService) return text;

    const langNames: Record<TTSLanguage, string> = {
      zh: '中文',
      en: 'English',
      ja: '日本語',
    };

    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: `你是一个翻译助手。将用户的消息翻译成${langNames[targetLang]}。只输出翻译结果，不要加任何解释或额外内容。`,
      },
      { role: 'user', content: text },
    ];

    try {
      const result = await this.aiService.chat(messages);
      return result || text;
    } catch (error: any) {
      console.error('[TTS] 翻译失败:', error.message);
      return text; // 翻译失败则使用原文
    }
  }

  /** 根据配置选择引擎并合成 */
  private async synthesize(text: string, config: TTSConfig): Promise<ArrayBuffer | null> {
    try {
      if (config.mode === 'gpt-sovits') {
        const engine = new TTSGptSoVits(config);
        return await engine.synthesize(text);
      } else if (config.mode === 'mimo') {
        const engine = new TTSMiMo(config);
        return await engine.synthesize(text);
      } else if (config.mode === 'aliyun') {
        const engine = new TTSAliyun(config);
        return await engine.synthesize(text);
      } else {
        const engine = new TTSApi(config);
        return await engine.synthesize(text);
      }
    } catch (error: any) {
      console.error('[TTS] 合成失败:', error.message);
      return null;
    }
  }

  /** 发送音频数据到渲染进程播放（附带字幕文字） */
  private play(audioData: ArrayBuffer, text: string): Promise<void> {
    return new Promise((resolve) => {
      if (!this.mainWindow || this.mainWindow.isDestroyed()) {
        resolve();
        return;
      }

      // 将 ArrayBuffer 转为 base64
      const base64 = Buffer.from(audioData).toString('base64');

      // 通过 IPC 监听播放完成
      const { ipcMain } = require('electron');
      const handler = () => {
        ipcMain.removeListener('tts-playback-done', handler);
        resolve();
      };
      ipcMain.on('tts-playback-done', handler);

      // 发送到渲染进程（音频 + 字幕文字）
      this.mainWindow.webContents.send('tts-play', base64, text);

      // 超时保护（30秒）
      setTimeout(() => {
        ipcMain.removeListener('tts-playback-done', handler);
        resolve();
      }, 30000);
    });
  }

  /** 停止当前播放 */
  stop(): void {
    this.queue = [];
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('tts-stop');
    }
    this.isSpeaking = false;
  }

  /** 测试连接 */
  async test(): Promise<{ success: boolean; message: string }> {
    const config = this.configManager.get();

    try {
      let ok = false;
      if (config.mode === 'gpt-sovits') {
        const engine = new TTSGptSoVits(config);
        ok = await engine.test();
      } else if (config.mode === 'mimo') {
        const engine = new TTSMiMo(config);
        ok = await engine.test();
      } else if (config.mode === 'aliyun') {
        const engine = new TTSAliyun(config);
        ok = await engine.test();
      } else {
        const engine = new TTSApi(config);
        ok = await engine.test();
      }

      return ok
        ? { success: true, message: 'TTS 连接成功' }
        : { success: false, message: 'TTS 连接失败' };
    } catch (error: any) {
      return { success: false, message: 'TTS 测试失败: ' + error.message };
    }
  }

  /** 获取配置管理器 */
  getConfigManager(): TTSConfigManager {
    return this.configManager;
  }
}
