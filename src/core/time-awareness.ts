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

  /** 判断当前是否为早晨（自然醒来时段） */
  isMorning(): boolean {
    return this.getCurrentEffect() === 'natural_wake';
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
  /** 获取时段问候语 */
  getGreeting(): string {
    const hour = this.getCurrentHour();
    const greetings: { range: [number, number]; messages: string[] }[] = [
      { range: [6, 9], messages: ['早~', '早上好', '新的一天'] },
      { range: [9, 12], messages: ['上午好', '嗨~', '在忙吗'] },
      { range: [12, 14], messages: ['中午好', '午饭时间~', '饿了吗'] },
      { range: [14, 18], messages: ['下午好', '在忙吗~', '加油'] },
      { range: [18, 21], messages: ['晚上好', '辛苦了', '休息一下~'] },
      { range: [21, 24], messages: ['夜深了~', '还在呀', '别太晚了'] },
      { range: [0, 6], messages: ['还没睡吗...', '好晚了', '早点休息吧'] },
    ];

    for (const g of greetings) {
      if (this.isInTimeRange(hour, g.range)) {
        return g.messages[Math.floor(Math.random() * g.messages.length)];
      }
    }
    return '嗨~';
  }

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
