import { app, BrowserWindow, ipcMain, screen, shell } from 'electron';
import * as path from 'path';
import { StateManager } from '../core/state-manager';
import { TimeAwareness } from '../core/time-awareness';
import { TransitionEngine } from '../core/transition-engine';
import { BubbleManager } from '../core/bubble-manager';
import { AIConfigManager } from '../core/ai-config';
import { AIService } from '../core/ai-service';
import { ChatManager } from '../core/chat-manager';
import { getLogger } from '../core/logger';
import { AppearanceConfigManager } from '../core/appearance-config';
import { ScreenAnalyzer } from '../core/screen-analyzer';
import { TTSConfigManager } from '../core/tts-config';
import { TTSManager } from '../core/tts-manager';
import { ObserverManager } from '../core/observer-manager';

let mainWindow: BrowserWindow | null = null;
let settingsWindow: BrowserWindow | null = null;
let debugWindow: BrowserWindow | null = null;
let stateManager: StateManager;
let timeAwareness: TimeAwareness;
let transitionEngine: TransitionEngine;
let bubbleManager: BubbleManager;
let aiConfigManager: AIConfigManager;
let aiService: AIService;
let chatManager: ChatManager;
let appearanceConfig: AppearanceConfigManager;
let screenAnalyzer: ScreenAnalyzer;
let ttsConfigManager: TTSConfigManager;
let ttsManager: TTSManager;
let observerManager: ObserverManager;

// 拖拽状态（主进程端）
let isDragging = false;
let dragOffsetX = 0;
let dragOffsetY = 0;
let lastCursorX = 0;
let lastCursorY = 0;
let dragPollTimer: ReturnType<typeof setInterval> | null = null;

function createWindow(): void {
  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;

  mainWindow = new BrowserWindow({
    width: 250,
    height: 280,
    x: screenWidth - 270,
    y: screenHeight - 270,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // 默认穿透，鼠标进入角色时恢复交互
  mainWindow.setIgnoreMouseEvents(true, { forward: true });
  mainWindow.loadFile(path.join(__dirname, '..', '..', 'src', 'renderer', 'index.html'));

  // F12 打开 DevTools，F11 打开设置，F3 打开调试窗口
  mainWindow.webContents.on('before-input-event', (_event, input) => {
    if (input.key === 'F12' && input.type === 'keyDown') {
      mainWindow?.webContents.openDevTools({ mode: 'detach' });
    }
    if (input.key === 'F11' && input.type === 'keyDown') {
      createSettingsWindow();
    }
    if (input.key === 'F3' && input.type === 'keyDown') {
      toggleDebugWindow();
    }
  });

  // 发送精灵图路径给渲染进程
  const spritesPath = path.join(__dirname, '..', '..', 'src', 'assets', 'sprites');
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow?.webContents.send('sprites-path', spritesPath);
  });

  // 初始化核心模块
  stateManager = new StateManager();
  timeAwareness = new TimeAwareness(stateManager.getConfig());
  transitionEngine = new TransitionEngine(stateManager, timeAwareness);

  // 状态变化时通知渲染进程
  stateManager.onStateChange((event) => {
    mainWindow?.webContents.send('state-changed', event);
  });

  // 启动转移引擎
  transitionEngine.start(1000);

  // 初始化气泡管理器
  bubbleManager = new BubbleManager(mainWindow, timeAwareness, stateManager);
  // 延迟发送问候语（等渲染进程就绪）
  setTimeout(() => {
    bubbleManager.showGreeting();
    // AI 问候（延迟等固定问候显示完）
    chatManager?.sendGreeting();
  }, 1500);
  // 启动活动监视（每45秒检测一次）
  bubbleManager.startActivityMonitor(45000);

  // 初始化 AI 模块
  aiConfigManager = new AIConfigManager();
  aiService = new AIService(aiConfigManager);
  chatManager = new ChatManager(mainWindow, aiConfigManager, aiService, stateManager, timeAwareness);
  appearanceConfig = new AppearanceConfigManager();
  screenAnalyzer = new ScreenAnalyzer(aiConfigManager);
  ttsConfigManager = new TTSConfigManager();
  ttsManager = new TTSManager(mainWindow, ttsConfigManager);

  // 连接活动监视到 ChatManager
  bubbleManager.setOnActivity((title) => {
    chatManager?.updateActivity(title);
  });

  // 连接情绪系统到 TransitionEngine
  transitionEngine.setEmotionUpdater(chatManager.getEmotionUpdater());

  // 连接拖拽到好感度变化
  transitionEngine.setOnRelationshipChange((delta) => {
    chatManager?.changeAffection(delta);
  });

  // 连接 TTS 到 ChatManager，并提供 AI 服务用于翻译
  ttsManager.setAIService(aiService);
  chatManager.setTTSManager(ttsManager);

  // 初始化观察系统
  observerManager = new ObserverManager(
    mainWindow, aiService, chatManager.getEmotionUpdater().getEmotionSystem(),
    stateManager, chatManager.getMemory(), screenAnalyzer, aiConfigManager
  );
  observerManager.start(30000); // 每30秒检查一次

  // 定时发送当前状态给渲染进程（用于UI更新）
  setInterval(() => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      const currentState = stateManager.getCurrentState();
      const stateDef = stateManager.getStateDefinition(currentState);
      mainWindow.webContents.send('state-update', {
        state: currentState,
        definition: stateDef,
        stateDuration: stateManager.getStateDuration(),
        timeSlot: timeAwareness.getCurrentTimeSlot(),
      });
    }
  }, 500);

}

/** 注册所有 IPC 监听器（只调用一次） */
function setupIPC(): void {
  ipcMain.on('cursor-move', (_event, data: { x: number; y: number }) => {
    if (!mainWindow || !transitionEngine) return;
    const bounds = mainWindow.getBounds();
    const companionPos = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
    transitionEngine.handleCursorMove(data, companionPos);
    observerManager?.recordActivity();
  });

  ipcMain.on('drag-start', () => {
    transitionEngine?.handleDragStart();
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const cursor = screen.getCursorScreenPoint();
    const [winX, winY] = mainWindow.getPosition();
    dragOffsetX = cursor.x - winX;
    dragOffsetY = cursor.y - winY;
    lastCursorX = cursor.x;
    lastCursorY = cursor.y;
    isDragging = true;
    if (dragPollTimer) clearInterval(dragPollTimer);
    dragPollTimer = setInterval(() => {
      if (!isDragging || !mainWindow || mainWindow.isDestroyed()) {
        stopDragPoll();
        return;
      }
      const pos = screen.getCursorScreenPoint();
      if (pos.x !== lastCursorX || pos.y !== lastCursorY) {
        lastCursorX = pos.x;
        lastCursorY = pos.y;
        mainWindow.setPosition(pos.x - dragOffsetX, pos.y - dragOffsetY);
      }
    }, 16);
  });

  ipcMain.on('drag-end', () => {
    isDragging = false;
    stopDragPoll();
    transitionEngine?.handleDragEnd();
  });

  ipcMain.on('user-click', () => {
    transitionEngine?.handleInteraction();
    observerManager?.recordActivity();
  });

  ipcMain.on('lonely-action', (_event, active: boolean) => {
    transitionEngine?.setLonelyAction(active);
  });

  ipcMain.on('state-finished', () => {
    transitionEngine?.handleStateFinished();
  });

  ipcMain.on('window-move-by', (_event, data: { deltaX: number; deltaY: number }) => {
    if (!mainWindow || mainWindow.isDestroyed() || isDragging) return;
    const [x, y] = mainWindow.getPosition();
    mainWindow.setPosition(x + data.deltaX, y + data.deltaY);
  });

  ipcMain.on('mouse-enter', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setIgnoreMouseEvents(false);
    }
  });

  ipcMain.on('mouse-leave', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setIgnoreMouseEvents(true, { forward: true });
    }
  });

  ipcMain.on('user-message', (_event, text: string) => {
    chatManager?.sendMessage(text);
  });

  ipcMain.on('open-settings', () => {
    createSettingsWindow();
  });

  ipcMain.handle('load-ai-config', () => {
    return aiConfigManager?.get();
  });

  ipcMain.on('save-ai-config', (_event, config: any) => {
    aiConfigManager?.update(config);
  });

  ipcMain.handle('test-ai-connection', async () => {
    if (!aiService) return { success: false, message: 'AI 服务未初始化' };
    return await aiService.testConnection();
  });

  // 日志相关
  ipcMain.on('renderer-log', (_event, category: string, message: string) => {
    getLogger().log(category as any, message);
  });

  ipcMain.handle('get-log-path', () => {
    return getLogger().getLogPath();
  });

  ipcMain.handle('get-recent-logs', (_event, count: number) => {
    return getLogger().getRecentLines(count);
  });

  ipcMain.on('open-log-file', () => {
    shell.openPath(getLogger().getLogPath());
  });

  // 对话历史管理
  ipcMain.on('clear-chat-history', () => {
    chatManager?.clearHistory();
    console.log('[Main] 对话历史已清空');
  });

  ipcMain.handle('get-chat-info', () => {
    return {
      historyCount: chatManager?.getHistoryCount() || 0,
      summary: chatManager?.getSummary() || '',
    };
  });

  // 外观设置
  ipcMain.handle('load-appearance-config', () => {
    return appearanceConfig?.get();
  });

  ipcMain.on('save-appearance-config', (_event, config: any) => {
    appearanceConfig?.update(config);
  });

  ipcMain.on('apply-appearance', (_event, config: any) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    // 调整窗口大小
    const newSize = config.petSize || 200;
    mainWindow.setSize(newSize + 50, newSize + 80);
    // 设置透明度
    mainWindow.setOpacity(config.opacity ?? 1.0);
    // 通知渲染进程更新精灵图大小
    mainWindow.webContents.send('update-pet-size', newSize);
  });

  // 屏幕分析
  ipcMain.handle('test-screen-analysis', async () => {
    if (!screenAnalyzer) return { success: false, message: '屏幕分析服务未初始化' };
    try {
      const result = await screenAnalyzer.analyze('测试截屏分析');
      return { success: true, message: result };
    } catch (e: any) {
      return { success: false, message: '测试失败: ' + e.message };
    }
  });

  // TTS 语音
  ipcMain.handle('load-tts-config', () => {
    return ttsConfigManager?.get();
  });

  ipcMain.on('save-tts-config', (_event, config: any) => {
    ttsConfigManager?.update(config);
  });

  ipcMain.handle('test-tts', async () => {
    return await ttsManager?.test();
  });

  ipcMain.on('tts-stop', () => {
    ttsManager?.stop();
  });
}

function createSettingsWindow(): void {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus();
    return;
  }
  settingsWindow = new BrowserWindow({
    width: 500,
    height: 600,
    title: '设置',
    resizable: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  settingsWindow.loadFile(path.join(__dirname, '..', '..', 'src', 'main', 'settings.html'));
  settingsWindow.on('closed', () => { settingsWindow = null; });
  // F12 打开 DevTools
  settingsWindow.webContents.on('before-input-event', (_event, input) => {
    if (input.key === 'F12' && input.type === 'keyDown') {
      settingsWindow?.webContents.openDevTools({ mode: 'detach' });
    }
  });
}

function toggleDebugWindow(): void {
  if (debugWindow && !debugWindow.isDestroyed()) {
    debugWindow.close();
    return;
  }
  debugWindow = new BrowserWindow({
    width: 700,
    height: 500,
    title: 'Debug - Quiet Companion',
    resizable: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  debugWindow.loadFile(path.join(__dirname, '..', '..', 'src', 'main', 'debug.html'));
  debugWindow.on('closed', () => {
    debugWindow = null;
    getLogger().setDebugWindow(null);
  });
  getLogger().setDebugWindow(debugWindow);
}

function stopDragPoll(): void {
  if (dragPollTimer) {
    clearInterval(dragPollTimer);
    dragPollTimer = null;
  }
}

setupIPC();
app.whenReady().then(createWindow);

// 关闭时总结记忆
app.on('before-quit', async () => {
  await chatManager?.summarizeOnShutdown();
});

app.on('window-all-closed', () => {
  transitionEngine?.stop();
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
