/**
 * 阿里云百炼 TTS 引擎
 *
 * 调用阿里云百炼 qwen3-tts 系列模型
 * API: POST {baseURL}/services/aigc/text2audio/generation
 *
 * 支持的模型：
 * - qwen3-tts-flash（默认）
 * - qwen3-tts-instruct-flash（支持指令控制）
 */

import { TTSConfig } from './tts-config';

export class TTSAliyun {
  private config: TTSConfig;

  constructor(config: TTSConfig) {
    this.config = config;
  }

  /** 合成语音，返回音频 ArrayBuffer */
  async synthesize(text: string): Promise<ArrayBuffer> {
    const url = `${this.config.aliyunBaseURL}/api/v1/services/aigc/text2audio/generation`;

    const body: any = {
      model: this.config.aliyunModel || 'qwen3-tts-flash',
      input: {
        text: text,
        voice: this.config.aliyunVoice || 'Cherry',
      },
    };

    // 语言类型（可选）
    if (this.config.aliyunLanguage && this.config.aliyunLanguage !== 'auto') {
      body.input.language_type = this.config.aliyunLanguage;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.aliyunApiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`阿里云 TTS 请求失败 (${response.status}): ${error}`);
    }

    const data = await response.json() as any;

    // 响应格式：output.audio.data (base64) 或 output.audio.url
    const audio = data.output?.audio;
    if (!audio) {
      throw new Error('阿里云 TTS 未返回音频数据');
    }

    if (audio.data) {
      // base64 解码
      const binary = atob(audio.data);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      return bytes.buffer;
    }

    if (audio.url) {
      // 下载音频文件
      const audioResponse = await fetch(audio.url);
      if (!audioResponse.ok) {
        throw new Error('下载音频失败');
      }
      return await audioResponse.arrayBuffer();
    }

    throw new Error('阿里云 TTS 返回格式异常');
  }

  /** 测试连接 */
  async test(): Promise<boolean> {
    try {
      await this.synthesize('测试');
      return true;
    } catch {
      return false;
    }
  }
}
