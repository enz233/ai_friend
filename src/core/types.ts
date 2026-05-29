// 状态系统核心类型定义

/** 所有可能的状态 ID */
export type StateId =
  | 'idle'
  | 'curious'
  | 'dragged'
  | 'sleepy'
  | 'sleeping'
  | 'lonely'
  | 'comfortable'
  | 'tried';

/** 眼睛状态 */
export type EyeState = 'open' | 'half_closed' | 'closed';

/** 嘴巴状态 */
export type MouthState = 'neutral' | 'small_smile' | 'yawn';

/** 眨眼频率 */
export type BlinkRate = 'slow' | 'normal' | 'fast';

/** 动作幅度 */
export type Movement = 'still' | 'gentle' | 'active';

/** 微行为类型 */
export type MicroBehavior =
  | 'blink'
  | 'breathing'
  | 'occasional_glance'
  | 'eye_tracking'
  | 'head_tilt'
  | 'body_sway'
  | 'yawn'
  | 'slow_breathing'
  | 'head_droop'
  | 'look_around'
  | 'slight_sigh'
  | 'gentle_smile'
  | 'stretch';

/** 转移触发器类型 */
export type TriggerType = 'time' | 'interaction' | 'timer' | 'random';

/** 单个状态的完整定义 */
export interface StateDefinition {
  id: StateId;
  animation: string;
  eyeState: EyeState;
  mouthState: MouthState;
  blinkRate: BlinkRate;
  movement: Movement;
  microBehaviors: MicroBehavior[];
  duration: { min: number; max: number };
  priority: number;
  bubble: {
    probability: number;
    messages: string[];
  } | null;
}

/** 转移条件 */
export interface TransitionCondition {
  cursorDistance?: string;
  noInteractionTime?: string;
  timeRange?: [number, number];
  probability?: number;
}

/** 单条转移规则 */
export interface TransitionRule {
  from: StateId | 'any';
  to: StateId;
  trigger: TriggerType;
  condition: TransitionCondition;
  priority: number;
}

/** 时间时段定义 */
export interface TimeSlot {
  range: [number, number];
  effect: string;
}

/** 完整的状态配置 */
export interface StatesConfig {
  version: string;
  states: Record<StateId, StateDefinition>;
  transitions: Record<string, TransitionRule>;
  timeAwareness: {
    timeSlots: Record<string, TimeSlot>;
  };
  antiJitter: {
    cooldownSeconds: number;
    hysteresis: {
      curious_enter: number;
      curious_exit: number;
    };
  };
}

/** 状态变化事件 */
export interface StateChangeEvent {
  from: StateId;
  to: StateId;
  timestamp: number;
  trigger: TriggerType;
}
