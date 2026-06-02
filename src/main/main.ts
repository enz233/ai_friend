import { app, BrowserWindow, ipcMain, screen } from 'electron';
import * as path from 'path';
import { StateManager } from '../core/state-manager';
import { TimeAwareness } from '../core/time-awareness';
import { TransitionEngine } from '../core/transition-engine';
import { BubbleManager } from '../core/bubble-manager';
import { AIConfigManager } from '../core/ai-config';
import { AIService } from '../core/ai-service';
import { ChatManager } from '../core/chat-manager';

let mainWindow: BrowserWindow | null = null;
let stateManager: StateManager;
let timeAwareness: TimeAwareness;
let transitionEngine: TransitionEngine;
let bubbleManager: BubbleManager;
let aiConfigManager: AIConfigManager;
let aiService: AIService;
let chatManager: ChatManager;

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
    width: 230,
    height: 230,
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

  // F12 打开独立调试窗口，F11 打开设置
  mainWindow.webContents.on('before-input-event', (_event, input) => {
    if (input.key === 'F12' && input.type === 'keyDown') {
      mainWindow?.webContents.openDevTools({ mode: 'detach' });
    }
    if (input.key === 'F11' && input.type === 'keyDown') {
      createSettingsWindow();
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
  }, 1500);
  // 启动活动监视（每45秒检测一次）
  bubbleManager.startActivityMonitor(45000);

  // 初始化 AI 模块
  aiConfigManager = new AIConfigManager();
  aiService = new AIService(aiConfigManager);
  chatManager = new ChatManager(mainWindow, aiConfigManager, aiService);

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

  // IPC 处理：接收渲染进程的交互事件
  ipcMain.on('cursor-move', (_event, data: { x: number; y: number }) => {
    if (!mainWindow || !transitionEngine) return;
    const bounds = mainWindow.getBounds();
    const companionPos = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
    transitionEngine.handleCursorMove(data, companionPos);
  });

  ipcMain.on('drag-start', () => {
    transitionEngine?.handleDragStart();
    if (!mainWindow || mainWindow.isDestroyed()) return;

    // 记录鼠标与窗口的偏移量
    const cursor = screen.getCursorScreenPoint();
    const [winX, winY] = mainWindow.getPosition();
    dragOffsetX = cursor.x - winX;
    dragOffsetY = cursor.y - winY;
    lastCursorX = cursor.x;
    lastCursorY = cursor.y;
    isDragging = true;

    // 开始轮询鼠标位置，每帧更新窗口位置
    if (dragPollTimer) clearInterval(dragPollTimer);
    dragPollTimer = setInterval(() => {
      if (!isDragging || !mainWindow || mainWindow.isDestroyed()) {
        stopDragPoll();
        return;
      }
      const pos = screen.getCursorScreenPoint();
      // 只在鼠标实际移动时才更新窗口，避免微小抖动导致漂移
      if (pos.x !== lastCursorX || pos.y !== lastCursorY) {
        lastCursorX = pos.x;
        lastCursorY = pos.y;
        mainWindow.setPosition(pos.x - dragOffsetX, pos.y - dragOffsetY);
      }
    }, 16); // ~60fps
  });

  ipcMain.on('drag-end', () => {
    isDragging = false;
    stopDragPoll();
    transitionEngine?.handleDragEnd();
  });

  ipcMain.on('user-click', () => {
    transitionEngine?.handleInteraction();
  });

  ipcMain.on('lonely-action', (_event, active: boolean) => {
    transitionEngine?.setLonelyAction(active);
  });

  ipcMain.on('state-finished', () => {
    transitionEngine?.handleStateFinished();
  });

  // 相对移动窗口（拖拽时由主进程轮询处理，这里保留给其他用途）
  ipcMain.on('window-move-by', (_event, data: { deltaX: number; deltaY: number }) => {
    if (!mainWindow || mainWindow.isDestroyed() || isDragging) return;
    const [x, y] = mainWindow.getPosition();
    mainWindow.setPosition(x + data.deltaX, y + data.deltaY);
  });

  // 鼠标进入角色区域 → 恢复交互
  ipcMain.on('mouse-enter', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setIgnoreMouseEvents(false);
    }
  });

  // 鼠标离开角色区域 → 穿透点击
  ipcMain.on('mouse-leave', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setIgnoreMouseEvents(true, { forward: true });
    }
  });

  // AI 相关 IPC
  ipcMain.on('user-message', (_event, text: string) => {
    chatManager?.sendMessage(text);
  });

  ipcMain.on('open-settings', () => {
    createSettingsWindow();
  });

  ipcMain.handle('load-ai-config', () => {
    console.log('[AI] 加载配置');
    const config = aiConfigManager?.get();
    console.log('[AI] 配置:', config ? '已加载' : '未找到');
    return config;
  });

  ipcMain.on('save-ai-config', (_event, config: any) => {
    console.log('[AI] 保存配置');
    aiConfigManager?.update(config);
    console.log('[AI] 配置已保存');
  });

  ipcMain.handle('test-ai-connection', async () => {
    console.log('[AI] 测试连接');
    try {
      const result = await aiService?.testConnection();
      console.log('[AI] 测试结果:', result);
      return result;
    } catch (e: any) {
      console.error('[AI] 测试失败:', e);
      return { success: false, message: '测试失败: ' + e.message };
    }
  });
}

function createSettingsWindow(): void {
  const settingsWindow = new BrowserWindow({
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
}

function stopDragPoll(): void {
  if (dragPollTimer) {
    clearInterval(dragPollTimer);
    dragPollTimer = null;
  }
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  transitionEngine?.stop();
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
