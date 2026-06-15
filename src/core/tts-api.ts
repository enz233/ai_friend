/**
 * 外部 TTS API 引擎
 *
 * 支持 OpenAI 兼容的 TTS API（OpenAI TTS、Azure TTS 等）
 * API: POST {baseURL}/audio/speech
 */

import { TTSConfig } from './tts-config';

export class TTSApi {
  private config: TTSConfig;

  constructor(config: TTSConfig) {
    this.config = config;
  }

  /** 合成语音，返回音频 ArrayBuffer */
  async synthesize(text: string): Promise<ArrayBuffer> {
    const url = `${this.config.ttsBaseURL}/audio/speech`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.ttsApiKey}`,
      },
      body: JSON.stringify({
        model: this.config.ttsModel,
        input: text,
        voice: this.config.ttsVoice,
        speed: this.config.ttsSpeed,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`TTS API 请求失败 (${response.status}): ${error}`);
    }

    return await response.arrayBuffer();
  }

  /** 测试连接 */
  async test(): Promise<boolean> {
    try {
      const url = `${this.config.ttsBaseURL}/audio/speech`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.ttsApiKey}`,
        },
        body: JSON.stringify({
          model: this.config.ttsModel,
          input: '测试',
          voice: this.config.ttsVoice,
        }),
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}
