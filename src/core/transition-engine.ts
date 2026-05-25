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

  constructor(stateManager: StateManager, timeAwareness: TimeAwareness) {
    this.stateManager = stateManager;
    this.timeAwareness = timeAwareness;
    this.config = stateManager.getConfig();
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

    // 深夜强制 sleeping
    if (this.timeAwareness.isLateNight() && currentState !== 'sleeping') {
      this.stateManager.tryTransition('sleeping', 'time');
      return;
    }

    // 状态超时 → 回 idle
    if (duration > stateDef.duration.max) {
      if (currentState !== 'idle') {
        this.stateManager.tryTransition('idle', 'timer');
      }
    }
  }

  /** 光标移动：控制 curious 进入/退出 */
  handleCursorMove(cursor: CursorPosition, companion: CompanionPosition): void {
    const distance = this.calculateDistance(cursor, companion);
    const currentState = this.stateManager.getCurrentState();

    if (distance < 200 && !this.isCursorNear) {
      this.isCursorNear = true;
      if (currentState === 'idle' || currentState === 'lonely') {
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
    this.stateManager.tryTransition('dragged', 'interaction');
  }

  /** 拖拽结束：回 idle 或 comfortable */
  handleDragEnd(): void {
    this.stateManager.recordInteraction();
    if (Math.random() < 0.4) {
      this.stateManager.tryTransition('comfortable', 'interaction');
    } else {
      this.stateManager.tryTransition('idle', 'interaction');
    }
  }

  private calculateDistance(a: CursorPosition, b: CompanionPosition): number {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
  }
}
