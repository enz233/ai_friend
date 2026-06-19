import { desktopCapturer } from 'electron';
import { AIConfigManager } from './ai-config';

export class ScreenAnalyzer {
  private configManager: AIConfigManager;

  constructor(configManager: AIConfigManager) {
    this.configManager = configManager;
  }

  /** 截屏并分析 */
  async analyze(userMessage: string): Promise<string> {
    const config = this.configManager.get();

    // 检查 vision 配置
    if (!config.visionApiKey || !config.visionBaseURL || !config.visionModel) {
      return '（屏幕分析未配置，请在设置中配置 Vision API）';
    }

    // 截屏
    const screenshot = await this.captureScreen();
    if (!screenshot) {
      return '（截屏失败）';
    }

    // 调用 vision API
    try {
      const response = await this.callVisionAPI(screenshot, userMessage, config);
      return response;
    } catch (error: any) {
      console.error('[ScreenAnalyzer] Vision API 调用失败:', error.message);
      return '（屏幕分析失败: ' + error.message + '）';
    }
  }

  /** 截取屏幕，返回 base64 data URI */
  async captureScreen(): Promise<string | null> {
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 1280, height: 720 },
      });

      if (sources.length === 0) return null;

      // 取第一个屏幕
      const source = sources[0];
      const thumbnail = source.thumbnail;

      // 缩小到 720p 以减少 token 消耗
      const resized = thumbnail.resize({ width: 1280, height: 720 });
      const base64 = resized.toPNG().toString('base64');

      return `data:image/png;base64,${base64}`;
    } catch (error: any) {
      console.error('[ScreenAnalyzer] 截屏失败:', error.message);
      return null;
    }
  }

  /** 调用 Vision API（OpenAI 兼容格式） */
  private async callVisionAPI(
    imageDataUri: string,
    userMessage: string,
    config: any
  ): Promise<string> {
    const messages = [
      {
        role: 'system',
        content: config.visionSystemPrompt || '你是一个桌面助手，简短描述用户屏幕上的内容。',
      },
      {
        role: 'user',
        content: [
          { type: 'text', text: userMessage || '描述一下屏幕上有什么' },
          {
            type: 'image_url',
            image_url: {
              url: imageDataUri,
              detail: 'low',
            },
          },
        ],
      },
    ];

    const response = await fetch(`${config.visionBaseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.visionApiKey}`,
      },
      body: JSON.stringify({
        model: config.visionModel,
        messages,
        max_tokens: 1000,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`API 请求失败 (${response.status}): ${error}`);
    }

    const data = await response.json() as any;
    return data.choices?.[0]?.message?.content ?? '（无响应）';
  }
}
