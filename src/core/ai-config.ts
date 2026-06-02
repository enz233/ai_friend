import * as fs from 'fs';
import * as path from 'path';

export interface AIConfig {
  apiKey: string;
  baseURL: string;
  model: string;
  temperature: number;
  maxTokens: number;
  systemPrompt: string;
  historyMaxLength: number;
}

const DEFAULT_CONFIG: AIConfig = {
  apiKey: '',
  baseURL: 'https://api.deepseek.com/v1',
  model: 'deepseek-chat',
  temperature: 0.7,
  maxTokens: 2000,
  systemPrompt: `你是一个安静的桌面数字伙伴。你的名字叫"安静的伙伴"。
你性格温柔、安静，偶尔会好奇。你说话简短，不会长篇大论。
你会关心用户但不会过度打扰。你用"我"称呼自己。
你的回复要简短可爱，一般1-2句话就好。`,
  historyMaxLength: 20,
};

export class AIConfigManager {
  private configPath: string;
  private config: AIConfig;

  constructor() {
    this.configPath = path.join(__dirname, '..', '..', 'src', 'config', 'ai-config.json');
    this.config = this.load();
  }

  private load(): AIConfig {
    try {
      if (fs.existsSync(this.configPath)) {
        const raw = fs.readFileSync(this.configPath, 'utf-8');
        return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
      }
    } catch (e) {
      console.error('[AIConfig] 加载配置失败:', e);
    }
    return { ...DEFAULT_CONFIG };
  }

  save(): void {
    try {
      const dir = path.dirname(this.configPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2), 'utf-8');
    } catch (e) {
      console.error('[AIConfig] 保存配置失败:', e);
    }
  }

  get(): AIConfig {
    return this.config;
  }

  update(partial: Partial<AIConfig>): void {
    this.config = { ...this.config, ...partial };
    this.save();
  }

  isValid(): boolean {
    return Boolean(this.config.apiKey && this.config.baseURL && this.config.model);
  }
}
