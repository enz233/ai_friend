/**
 * GPT-SoVITS TTS 引擎
 *
 * 调用本地 GPT-SoVITS API 合成语音
 * API: POST {baseURL}/tts
 */

import { TTSConfig } from './tts-config';

export class TTSGptSoVits {
  private config: TTSConfig;

  constructor(config: TTSConfig) {
    this.config = config;
  }

  /** 合成语音，返回音频 ArrayBuffer */
  async synthesize(text: string): Promise<ArrayBuffer> {
    const url = `${this.config.gptSovitsURL}/tts`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: text,
        text_language: this.config.gptSovitsTextLang,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`GPT-SoVITS 请求失败 (${response.status}): ${error}`);
    }

    return await response.arrayBuffer();
  }

  /** 测试连接 */
  async test(): Promise<boolean> {
    try {
      const url = `${this.config.gptSovitsURL}/tts`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: '测试',
          text_language: this.config.gptSovitsTextLang,
        }),
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}
