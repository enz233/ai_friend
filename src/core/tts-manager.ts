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

  /** 合成并播放单条语音 */
  async speak(text: string): Promise<void> {
    const config = this.configManager.get();
    if (!config.on) return;

    if (this.isSpeaking) {
      this.queue.push(text);
      return;
    }

    this.isSpeaking = true;

    try {
      const { ttsText, subtitleText } = await this.prepareText(text, config);
      const audioData = await this.synthesize(ttsText, config);
      if (audioData) {
        await this.play(audioData, subtitleText);
      }
    } catch (error: any) {
      console.error('[TTS] speak failed:', error.message);
    } finally {
      this.isSpeaking = false;
      if (this.queue.length > 0) {
        const next = this.queue.shift()!;
        this.speak(next);
      }
    }
  }

  /** 批量合成并按顺序播放（流水线模式） */
  async speakAll(texts: string[]): Promise<void> {
    const config = this.configManager.get();
    if (!config.on || texts.length === 0) return;

    this.isSpeaking = true;

    try {
      // 1. 全部文本并行准备（翻译）
      const prepared = await Promise.all(
        texts.map(t => this.prepareText(t, config))
      );

      // 2. 全部并行合成
      const audioPromises = prepared.map(p => this.synthesize(p.ttsText, config));
      const audioResults = await Promise.all(audioPromises);

      // 3. 按顺序播放（第一段立即开始）
      for (let i = 0; i < audioResults.length; i++) {
        if (audioResults[i]) {
          await this.play(audioResults[i]!, prepared[i].subtitleText);
        }
        // 段间停顿
        if (i < audioResults.length - 1) {
          await this.delay(800 + Math.random() * 400);
        }
      }
    } catch (error: any) {
      console.error('[TTS] speakAll failed:', error.message);
    } finally {
      this.isSpeaking = false;
    }
  }

  /** 准备文本：翻译 TTS 语言和字幕语言 */
  private async prepareText(text: string, config: TTSConfig): Promise<{ ttsText: string; subtitleText: string }> {
    let ttsText = text;
    let subtitleText = text;

    if (config.ttsLanguage !== 'zh' && this.aiService) {
      ttsText = await this.translate(text, config.ttsLanguage);
    }
    if (config.subtitleLanguage !== 'zh' && this.aiService) {
      subtitleText = await this.translate(text, config.subtitleLanguage);
    }

    return { ttsText, subtitleText };
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
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
