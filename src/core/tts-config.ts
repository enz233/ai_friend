import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';

export type TTSMode = 'gpt-sovits' | 'api';

export interface TTSConfig {
  on: boolean;
  mode: TTSMode;
  // GPT-SoVITS
  gptSovitsURL: string;
  gptSovitsTextLang: string;
  // 外部 TTS API
  ttsApiKey: string;
  ttsBaseURL: string;
  ttsModel: string;
  ttsVoice: string;
  ttsSpeed: number;
}

const DEFAULT_CONFIG: TTSConfig = {
  on: false,
  mode: 'gpt-sovits',
  gptSovitsURL: 'http://127.0.0.1:9880',
  gptSovitsTextLang: 'zh',
  ttsApiKey: '',
  ttsBaseURL: 'https://api.openai.com/v1',
  ttsModel: 'tts-1',
  ttsVoice: 'alloy',
  ttsSpeed: 1.0,
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
