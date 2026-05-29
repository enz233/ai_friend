# Quiet Companion - 版本记录

## v0.1.5 (2026-05-29)
- tried（疲惫）状态：拖拽后概率触发，拖拽越久概率越高
- tried动画：tried_0~4快速进入 → 3↔4循环10秒 → 慢速退出回idle
- tried轻摇CSS动画
- 精灵图按状态分文件夹整理（sprites/basic/）
- setSprite自动根据名字前缀匹配子目录
- 修复dragged状态：mousedown时就设置isDragVisualActive和CSS
- 修复tried退出动画：通过IPC通知主进程切回idle
- 深夜拖拽不被打断，松开后走sleepy→sleeping

## v0.1.4_debug (2026-05-28)
- 修复 lastVisualState 在早返回前被设置导致精灵图不更新
- 修复眨眼动画覆盖非 idle 状态的精灵图
- 修复深夜拖拽被强制 sleeping 打断（现在允许拖拽，松开后 sleepy → sleeping）

## v0.1.4 (2026-05-28)
- lonely状态完整实现：10分钟无交互触发，点击/光标靠近唤醒
- lonely动画：lonely_0→1→2→3→4→lonely（停留最终帧）
- lonely小动作：lonely_c_0~5序列动画，40~80秒触发一次
- lonely退出动画：反向播放回lonely_0
- lonely小动作播放时不被curious打断
- 区分点击和拖拽：点击显示dragged后回idle，拖拽才真正移动窗口
- sleepy哈欠动画修复：播放期间不被眨眼打断
- 状态优先级：sleeping > lonely > sleepy
- object-position: center bottom 统一精灵图对齐

## v0.1.3 (2026-05-25)
- sleepy状态动画：sleepy_1为主帧+摇晃CSS，周期性哈欠（sleepy_2→sleepy_3→sleepy→反向）
- sleepy眨眼：使用sleepy_blink素材，间隔4~10秒
- sleeping动画：sleep_1→sleep_2→sleep_3→sleeping（停留最终帧）
- 睡眠周期转移：深夜强制sleeping，早晨自然醒来，点击sleeping唤醒到sleepy
- comfortable轻摇动画（独立CSS）
- 修复离开dragged后curious无法触发的bug
- 修复sleepy哈欠动画被500ms状态更新重置的bug
- idle→sleepy概率触发（当前为测试模式5%/秒）

## v0.1.2 (2026-05-24)
- 拖拽方向差分：根据拖拽方向显示 dragged_left/right/up/down
- 拖拽过渡动画：dragged_1 → dragged_2（被拉起的动作）
- 拖拽改用绝对定位：主进程用 screen.getCursorScreenPoint 全局追踪鼠标
- 修复拖拽脱手问题：鼠标快速移动时不再丢失拖拽
- 拖拽期间精灵图不被状态更新覆盖

## v0.1.1 (2026-05-24)
- curious状态眨眼集成：频率2~6秒，速度70~130ms
- 修复curious只能触发一次的bug（离开curious时重置isCursorNear）

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
