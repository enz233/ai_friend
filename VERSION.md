# Quiet Companion - 版本记录

## v0.1.0 (2026-05-23)
- 初始版本
- 7状态系统（idle/curious/dragged/sleepy/sleeping/lonely/comfortable）
- 状态转移引擎（简化版：计时器+光标距离+拖拽触发）
- 差分图接入（idle/blink/sleepy/sleeping/dragged/lonely/comfortable）
- 眨眼动画（blink1→blink2→blink1→idle，120ms每步）
- 睡觉动画（sleep_1/2/3循环）
- 拖拽移动窗口（movementX/Y方案）
- 鼠标穿透（mouseenter/leave切换setIgnoreMouseEvents）
- 时间感知模块（未接入状态转移）
- F12打开独立调试窗口
