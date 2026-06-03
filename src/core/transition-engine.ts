import { StateId, StatesConfig } from './types';
import { StateManager } from './state-manager';
import { TimeAwareness } from './time-awareness';

export interface CursorPosition { x: number; y: number; }
export interface CompanionPosition { x: number; y: number; }

/**
 * 转移引擎（简化版）
 * - curious 由 handleCursorMove 直接控制
 * - dragged 由 handleDragStart/End 直接控制
 * - 其他状态用计时器自动回 idle
 */
export class TransitionEngine {
  private stateManager: StateManager;
  private timeAwareness: TimeAwareness;
  private config: StatesConfig;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private isCursorNear: boolean = false;
  private isLonelyAction: boolean = false;
  private dragStartTime: number = 0;

  constructor(stateManager: StateManager, timeAwareness: TimeAwareness) {
    this.stateManager = stateManager;
    this.timeAwareness = timeAwareness;
    this.config = stateManager.getConfig();

    // 监听状态变化：离开 curious 或 dragged 时重置 isCursorNear，离开 lonely 时重置 isLonelyAction
    this.stateManager.onStateChange((event) => {
      if (event.from === 'curious' && event.to !== 'curious') {
        this.isCursorNear = false;
      }
      if (event.from === 'dragged' && event.to !== 'dragged') {
        this.isCursorNear = false;
      }
      if (event.from === 'lonely' && event.to !== 'lonely') {
        this.isLonelyAction = false;
      }
    });
  }

  start(tickIntervalMs: number = 1000): void {
    if (this.tickTimer) return;
    this.tickTimer = setInterval(() => this.tick(), tickIntervalMs);
  }

  stop(): void {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
  }

  /** 每秒检查：当前状态是否超时 */
  private tick(): void {
    const currentState = this.stateManager.getCurrentState();
    const stateDef = this.config.states[currentState];
    const duration = this.stateManager.getStateDuration();

    // 深夜（01:00-06:00）：强制 sleeping（但不打断拖拽）
    if (this.timeAwareness.isLateNight()) {
      if (currentState !== 'sleeping' && currentState !== 'dragged') {
        this.stateManager.tryTransition('sleeping', 'time');
      }
      return;
    }

    // 早晨（06:00-09:00）：sleeping 自然醒来
    if (this.timeAwareness.isMorning() && currentState === 'sleeping') {
      this.stateManager.tryTransition('idle', 'time');
      return;
    }

    // idle 长时间无交互 → lonely（优先级高于 sleepy）
    if (currentState === 'idle' && this.stateManager.getTimeSinceLastInteraction() > 600) {
      this.stateManager.tryTransition('lonely', 'timer');
      return;
    }

    // 夜晚（22:00-01:00）：idle 有概率进入 sleepy
    if (this.timeAwareness.isNightTime() && currentState === 'idle') {
      const intensity = this.timeAwareness.getSleepyIntensity();
      if (Math.random() < intensity * 0.02) {
        this.stateManager.tryTransition('sleepy', 'time');
        return;
      }
    }

    // 状态超时 → 回 idle（dragged 不靠超时，靠 mouseup）
    if (duration > stateDef.duration.max && currentState !== 'dragged') {
      if (currentState !== 'idle') {
        this.stateManager.tryTransition('idle', 'timer');
      }
    }
  }

  /** 动画结束时由渲染进程调用，切回 idle */
  handleStateFinished(): void {
    this.stateManager.tryTransition('idle', 'timer');
  }

  /** 设置 lonely 小动作播放状态 */
  setLonelyAction(active: boolean): void {
    this.isLonelyAction = active;
  }

  /** 光标移动：控制 curious 进入/退出 */
  handleCursorMove(cursor: CursorPosition, companion: CompanionPosition): void {
    const distance = this.calculateDistance(cursor, companion);
    const currentState = this.stateManager.getCurrentState();

    if (distance < 200 && !this.isCursorNear) {
      this.isCursorNear = true;
      // lonely 小动作播放中不切换到 curious
      if ((currentState === 'idle' || currentState === 'lonely') && !this.isLonelyAction) {
        this.stateManager.tryTransition('curious', 'interaction');
      }
    } else if (distance > 300 && this.isCursorNear) {
      this.isCursorNear = false;
      if (currentState === 'curious') {
        this.stateManager.tryTransition('idle', 'interaction');
      }
    }
  }

  /** 拖拽开始：从任何状态切换到 dragged */
  handleDragStart(): void {
    this.stateManager.recordInteraction();
    this.dragStartTime = Date.now();
    this.stateManager.tryTransition('dragged', 'interaction');
  }

  /** 拖拽结束：回 idle 或 comfortable 或 tried（深夜回 sleepy） */
  handleDragEnd(): void {
    this.stateManager.recordInteraction();
    if (this.timeAwareness.isLateNight()) {
      this.stateManager.tryTransition('sleepy', 'interaction');
      return;
    }

    // 拖拽时间越长，进入 tried 的概率越高
    var dragDuration = (Date.now() - this.dragStartTime) / 1000;
    var triedChance = Math.min(0.1 + dragDuration * 0.05, 0.6); // 1秒10%，10秒60%

    if (Math.random() < triedChance) {
      this.stateManager.tryTransition('tried', 'interaction');
    } else if (Math.random() < 0.4) {
      this.stateManager.tryTransition('comfortable', 'interaction');
    } else {
      this.stateManager.tryTransition('idle', 'interaction');
    }
  }

  /** 点击交互：处理睡眠和孤独状态的唤醒 */
  handleInteraction(): void {
    this.stateManager.recordInteraction();
    const currentState = this.stateManager.getCurrentState();
    if (currentState === 'sleeping') {
      this.stateManager.tryTransition('sleepy', 'interaction');
    } else if (currentState === 'sleepy') {
      this.stateManager.tryTransition('idle', 'interaction');
    } else if (currentState === 'lonely') {
      this.stateManager.tryTransition('idle', 'interaction');
    }
  }

  private calculateDistance(a: CursorPosition, b: CompanionPosition): number {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
  }
}
