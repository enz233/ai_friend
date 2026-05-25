import { StatesConfig, TimeSlot } from './types';

/**
 * 时间感知模块 - 感知当前时间，计算对状态转移的影响
 */
export class TimeAwareness {
  private config: StatesConfig;

  constructor(config: StatesConfig) {
    this.config = config;
  }

  /** 获取当前小时（24小时制） */
  getCurrentHour(): number {
    return new Date().getHours();
  }

  /** 获取当前时段名称 */
  getCurrentTimeSlot(): string {
    const hour = this.getCurrentHour();
    const slots = this.config.timeAwareness.timeSlots;

    for (const [name, slot] of Object.entries(slots)) {
      if (this.isInTimeRange(hour, slot.range)) {
        return name;
      }
    }
    return 'unknown';
  }

  /** 获取当前时段的效果 */
  getCurrentEffect(): string {
    const slotName = this.getCurrentTimeSlot();
    const slot = this.config.timeAwareness.timeSlots[slotName];
    return slot?.effect ?? 'normal';
  }

  /** 判断当前是否为深夜（强制睡觉时段） */
  isLateNight(): boolean {
    return this.getCurrentEffect() === 'force_sleeping';
  }

  /** 判断当前是否为夜晚（犯困概率升高） */
  isNightTime(): boolean {
    return this.getCurrentEffect() === 'sleepy_boost';
  }

  /**
   * 计算 sleepy_boost 时段的犯困强度（0-1）
   * 22:00 时为 0.0，逐渐升高到 01:00 时为 1.0
   */
  getSleepyIntensity(): number {
    const hour = this.getCurrentHour();
    const minute = new Date().getMinutes();
    const timeDecimal = hour + minute / 60;

    // 22:00 - 01:00 范围内线性增长
    if (timeDecimal >= 22) {
      return Math.min((timeDecimal - 22) / 3, 1.0);
    } else if (timeDecimal < 1) {
      return Math.min((timeDecimal + 2) / 3, 1.0);
    }
    return 0;
  }

  /**
   * 判断当前时间是否在指定范围内
   * 支持跨午夜的范围（如 [22, 1] 表示 22:00 到 01:00）
   */
  private isInTimeRange(hour: number, range: [number, number]): boolean {
    const [start, end] = range;
    if (start <= end) {
      return hour >= start && hour < end;
    } else {
      // 跨午夜
      return hour >= start || hour < end;
    }
  }
}
