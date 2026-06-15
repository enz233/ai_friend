import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';

export type TTSMode = 'gpt-sovits' | 'api' | 'mimo' | 'aliyun';
export type TTSLanguage = 'zh' | 'en' | 'ja';

export interface TTSConfig {
  on: boolean;
  mode: TTSMode;
  ttsLanguage: TTSLanguage;       // TTS 语音语言
  subtitleLanguage: TTSLanguage;   // 字幕显示语言（可独立于 TTS）
  // GPT-SoVITS
  gptSovitsURL: string;
  gptSovitsTextLang: string;
  // 外部 TTS API
  ttsApiKey: string;
  ttsBaseURL: string;
  ttsModel: string;
  ttsVoice: string;
  ttsSpeed: number;
  // MiMo TTS
  mimoApiKey: string;
  mimoBaseURL: string;
  mimoModel: string;
  mimoVoice: string;
  mimoVoiceDesign: string;
  // 阿里云百炼 TTS
  aliyunApiKey: string;
  aliyunBaseURL: string;
  aliyunModel: string;
  aliyunVoice: string;
  aliyunLanguage: string;
}

const DEFAULT_CONFIG: TTSConfig = {
  on: false,
  mode: 'gpt-sovits',
  ttsLanguage: 'zh',
  subtitleLanguage: 'zh',
  gptSovitsURL: 'http://127.0.0.1:9880',
  gptSovitsTextLang: 'zh',
  ttsApiKey: '',
  ttsBaseURL: 'https://api.openai.com/v1',
  ttsModel: 'tts-1',
  ttsVoice: 'alloy',
  ttsSpeed: 1.0,
  mimoApiKey: '',
  mimoBaseURL: 'https://api.xiaomi.com/v1',
  mimoModel: 'mimo-v2.5-tts',
  mimoVoice: '冰糖',
  mimoVoiceDesign: '温柔可爱的少女声音，说话轻声细语',
  aliyunApiKey: '',
  aliyunBaseURL: 'https://dashscope.aliyuncs.com',
  aliyunModel: 'qwen3-tts-flash',
  aliyunVoice: 'Cherry',
  aliyunLanguage: 'auto',
};

export class TTSConfigManager {
  private configPath: string;
  private config: TTSConfig;

  constructor() {
    const configDir = path.join(app.getPath('userData'), 'config');
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }
    this.configPath = path.join(configDir, 'tts.json');
    this.config = this.load();
  }

  private load(): TTSConfig {
    try {
      if (fs.existsSync(this.configPath)) {
        const raw = fs.readFileSync(this.configPath, 'utf-8');
        return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
      }
    } catch (e) {
      console.error('[TTSConfig] 加载失败:', e);
    }
    return { ...DEFAULT_CONFIG };
  }

  save(): void {
    try {
      fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2), 'utf-8');
    } catch (e) {
      console.error('[TTSConfig] 保存失败:', e);
    }
  }

  get(): TTSConfig {
    return this.config;
  }

  update(partial: Partial<TTSConfig>): void {
    this.config = { ...this.config, ...partial };
    this.save();
  }
}
