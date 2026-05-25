import { StateId, StateDefinition, StateChangeEvent, StatesConfig } from './types';
import * as fs from 'fs';
import * as path from 'path';

/**
 * 状态管理器 - 管理伙伴的当前状态和状态定义
 * 纯逻辑模块，不涉及 UI
 */
export class StateManager {
  private config: StatesConfig;
  private currentState: StateId = 'idle';
  private stateStartTime: number = Date.now();
  private lastInteractionTime: number = Date.now();
  private listeners: Array<(event: StateChangeEvent) => void> = [];

  constructor(configPath?: string) {
    const resolvedPath = configPath ?? path.join(__dirname, '..', '..', 'src', 'config', 'states.json');
    const raw = fs.readFileSync(resolvedPath, 'utf-8');
    this.config = JSON.parse(raw) as StatesConfig;
  }

  /** 获取当前状态 ID */
  getCurrentState(): StateId {
    return this.currentState;
  }

  /** 获取当前状态的完整定义 */
  getCurrentStateDefinition(): StateDefinition {
    return this.config.states[this.currentState];
  }

  /** 获取指定状态的定义 */
  getStateDefinition(stateId: StateId): StateDefinition {
    return this.config.states[stateId];
  }

  /** 获取所有状态定义 */
  getAllStates(): Record<StateId, StateDefinition> {
    return this.config.states;
  }

  /** 获取完整配置 */
  getConfig(): StatesConfig {
    return this.config;
  }

  /** 获取当前状态已持续的秒数 */
  getStateDuration(): number {
    return (Date.now() - this.stateStartTime) / 1000;
  }

  /** 获取距离上次交互的秒数 */
  getTimeSinceLastInteraction(): number {
    return (Date.now() - this.lastInteractionTime) / 1000;
  }

  /** 记录一次用户交互 */
  recordInteraction(): void {
    this.lastInteractionTime = Date.now();
  }

  /**
   * 尝试切换到新状态
   * @param newState 目标状态
   * @param trigger 触发类型
   * @returns 是否切换成功
   */
  tryTransition(newState: StateId, trigger: string): boolean {
    if (newState === this.currentState) {
      return false;
    }

    const from = this.currentState;
    const now = Date.now();

    // 执行状态切换
    this.currentState = newState;
    this.stateStartTime = now;

    // 通知监听器
    const event: StateChangeEvent = {
      from,
      to: newState,
      timestamp: now,
      trigger: trigger as any,
    };
    this.notifyListeners(event);

    return true;
  }

  /** 注册状态变化监听器 */
  onStateChange(listener: (event: StateChangeEvent) => void): void {
    this.listeners.push(listener);
  }

  /** 移除状态变化监听器 */
  offStateChange(listener: (event: StateChangeEvent) => void): void {
    this.listeners = this.listeners.filter(l => l !== listener);
  }

  /** 通知所有监听器 */
  private notifyListeners(event: StateChangeEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}
