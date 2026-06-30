# Quiet Companion

一个安静的桌面数字伙伴。她会待在你的桌面角落，偶尔好奇地看看你，在你孤单时陪你说说话。

> **注意**：这不是一个纯粹的 AI 项目。核心是状态系统、动画引擎和交互逻辑。AI 对话是可选的附加功能。

## 功能

- **8 种状态**：idle、curious、dragged、sleepy、sleeping、lonely、comfortable、tried
- **差分图系统**：每种状态有对应的精灵图和动画
- **AI 对话**：支持 OpenAI 兼容 API（可选，需配置 API Key）
- **语音合成**：支持 GPT-SoVITS、MiMo TTS、阿里云 TTS、OpenAI TTS
- **屏幕分析**：Vision API 截屏分析（可选）
- **情绪系统**：角色拥有动态情绪权重
- **记忆系统**：记住用户偏好，自动生成对话摘要
- **好感度/熟悉度**：与角色的关系会随时间变化
- **活动监视**：感知用户当前在用什么应用（仅本地，不上传）

## 快速开始

### 下载运行（推荐）

从 Release 页面下载最新版，解压后双击 `Quiet Companion.exe` 即可运行。

### 从源码构建

```bash
npm install
npm run build
npm start
```

### 配置 AI（可选）

1. 按 F11 打开设置
2. 填写 API Key 和模型
3. 点击测试连接

支持 DeepSeek、OpenAI、硅基流动、Moonshot、智谱、通义千问等。

## 操作说明

| 操作 | 效果 |
|------|------|
| 鼠标靠近 | 好奇 |
| 左键拖拽 | 拖拽移动 |
| 右键 | 打开聊天输入框 |
| F11 | 设置 |
| F12 | 开发者工具 |

## 技术栈

- Electron
- TypeScript
- 原生 HTML/CSS/JS（无框架）
- fetch 调用 AI API（主进程）

## 项目结构

```
src/
├── core/        核心逻辑（状态、AI、TTS、情绪、记忆）
├── main/        Electron 主进程
├── renderer/    渲染进程（精灵图、动画、气泡）
├── config/      配置文件（不包含 API Key）
└── assets/      资源文件
```

## 许可

ISC
