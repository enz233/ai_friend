// 渲染进程 - 管理伙伴的视觉表现（纯浏览器脚本，无模块语法）

(function () {
  // 日志转发到主进程
  var _origLog = console.log;
  var _origWarn = console.warn;
  var _origError = console.error;
  function serializeArgs(args: any[]): string {
    return args.map(function (a) {
      if (typeof a === 'object' && a !== null) {
        try { return JSON.stringify(a); } catch (e) { return String(a); }
      }
      return String(a);
    }).join(' ');
  }

  console.log = function (...args: any[]) {
    // @ts-ignore
    window.companion.log('LOG', serializeArgs(args));
    _origLog(...args);
  };
  console.warn = function (...args: any[]) {
    // @ts-ignore
    window.companion.log('WARN', serializeArgs(args));
    _origWarn(...args);
  };
  console.error = function (...args: any[]) {
    // @ts-ignore
    window.companion.log('ERROR', serializeArgs(args));
    _origError(...args);
  };

  var SPRITE_DIR = '';

  var currentState = 'idle';
  var bubbleTimeout: ReturnType<typeof setTimeout> | null = null;
  var blinkTimer: ReturnType<typeof setTimeout> | null = null;
  var sleepAnimTimer: ReturnType<typeof setInterval> | null = null;
  var sleepyAnimTimer: ReturnType<typeof setTimeout> | null = null;
  var lonelyAnimTimer: ReturnType<typeof setTimeout> | null = null;
  var lonelyActionTimer: ReturnType<typeof setTimeout> | null = null;
  var triedAnimTimer: ReturnType<typeof setTimeout> | null = null;
  var isBlinking = false;

  // 拖拽动画相关
  var dragAnimTimer: ReturnType<typeof setTimeout> | null = null;
  var dragAccumX = 0;
  var dragAccumY = 0;
  var currentDragDirection: string | null = null;
  var dragTransitionDone = false;
  var dragFirstMove = false;
  var isDragVisualActive = false; // 拖拽视觉是否激活（mousedown到mouseup之间）
  var sleepyAnimRunning = false;

  // 交互气泡相关
  var clickTimes: number[] = [];
  var dragStartTime = 0;
  var dragBubbleTimer: ReturnType<typeof setTimeout> | null = null;

  var companionEl = document.getElementById('companion')!;
  var spriteEl = document.getElementById('sprite') as HTMLImageElement;
  var bubbleEl = document.getElementById('bubble')!;

  function init(): void {
    // @ts-ignore
    window.companion.onSpritesPath(function (p: string) {
      SPRITE_DIR = 'file:///' + p.replace(/\\/g, '/') + '/';
      setSprite('idle');
      console.log('Sprites path:', SPRITE_DIR);
    });

    setupDragHandling();
    setupCursorTracking();
    setupChatInput();
    setupStateListeners();
    scheduleNextBlink();
    setupClickThrough();
  }

  var isDraggingGlobal = false;

  function setupClickThrough(): void {
    companionEl.addEventListener('mouseenter', function () {
      // @ts-ignore
      window.companion.sendMouseEnter();
    });
    companionEl.addEventListener('mouseleave', function () {
      // 拖拽期间不切换穿透，否则鼠标离开角色区域后拖拽会断
      if (isDraggingGlobal) return;
      // @ts-ignore
      window.companion.sendMouseLeave();
    });
  }

  function setupDragHandling(): void {
    var isDragging = false;
    var dragStarted = false; // 是否真正开始拖拽（有移动）

    companionEl.addEventListener('mousedown', function () {
      console.log('[Drag] mousedown');
      isDragging = true;
      isDraggingGlobal = true;
      isDragVisualActive = true;
      dragStarted = false;
      dragStartTime = Date.now();
      dragFirstMove = true;
      dragTransitionDone = false;
      dragAccumX = 0;
      dragAccumY = 0;
      currentDragDirection = null;
      // 点击立即显示 dragged，打断当前气泡
      setSprite('dragged');
      companionEl.className = 'dragged';
      showBubble('哇！');
      // @ts-ignore
      window.companion.sendDragStart();

      // 拖拽 8 秒后显示气泡
      if (dragBubbleTimer) clearTimeout(dragBubbleTimer);
      dragBubbleTimer = setTimeout(function () {
        if (isDragging) {
          var msgs = ['放我下来...', '够了够了', '呼...', '累了吗~'];
          showBubble(msgs[Math.floor(Math.random() * msgs.length)]);
        }
      }, 8000);
    });

    document.addEventListener('mousemove', function (e: MouseEvent) {
      if (!isDragging) return;
      if (e.movementX === 0 && e.movementY === 0) return;

      // 首次移动时标记拖拽开始
      if (!dragStarted) {
        dragStarted = true;
      }

      // 方向判定（视觉用）
      if (dragFirstMove) {
        dragFirstMove = false;
        playDragTransition();
      }
      updateDragDirection(e.movementX, e.movementY);
    });

    document.addEventListener('mouseup', function () {
      if (isDragging) {
        var dragDuration = (Date.now() - dragStartTime) / 1000;
        console.log('[Drag] mouseup, 拖拽时长:', dragDuration.toFixed(1) + 's');
        isDragging = false;
        isDraggingGlobal = false;
        isDragVisualActive = false;
        stopDragAnim();
        dragStarted = false;
        if (dragBubbleTimer) { clearTimeout(dragBubbleTimer); dragBubbleTimer = null; }
        // @ts-ignore
        window.companion.sendDragEnd();
      }
    });
  }

  /** 播放 dragged_1 → dragged_2 过渡动画 */
  function playDragTransition(): void {
    setSprite('dragged_1');
    dragAnimTimer = setTimeout(function () {
      setSprite('dragged_2');
      dragAnimTimer = setTimeout(function () {
        dragTransitionDone = true;
        // 过渡结束，立即应用已累积的方向
        updateDragDirection(0, 0);
      }, 200);
    }, 200);
  }

  /** 停止拖拽动画 */
  function stopDragAnim(): void {
    if (dragAnimTimer) {
      clearTimeout(dragAnimTimer);
      dragAnimTimer = null;
    }
    dragTransitionDone = false;
    dragFirstMove = false;
    currentDragDirection = null;
  }

  /** 根据最近的移动量更新方向差分（衰减累积） */
  function updateDragDirection(dx: number, dy: number): void {
    // 衰减旧值，保留近期趋势
    dragAccumX = dragAccumX * 0.6 + dx;
    dragAccumY = dragAccumY * 0.6 + dy;

    // 过渡动画还没结束时不切换精灵图
    if (!dragTransitionDone) return;

    var absX = Math.abs(dragAccumX);
    var absY = Math.abs(dragAccumY);

    // 累积值不够大时保持当前方向
    if (absX < 3 && absY < 3) return;

    var newDirection: string;
    if (absX > absY) {
      newDirection = dragAccumX > 0 ? 'right' : 'left';
    } else {
      newDirection = dragAccumY > 0 ? 'down' : 'up';
    }

    if (newDirection !== currentDragDirection) {
      currentDragDirection = newDirection;
      setSprite('dragged_' + newDirection);
    }
  }

  function setupChatInput(): void {
    var chatInput = document.getElementById('chat-input') as HTMLInputElement;
    if (!chatInput) return;

    // 双击伙伴打开输入框
    companionEl.addEventListener('dblclick', function (e) {
      e.stopPropagation();
      chatInput.classList.remove('hidden');
      chatInput.focus();
    });

    // 回车发送
    chatInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        var text = chatInput.value.trim();
        if (text) {
          // @ts-ignore
          window.companion.sendUserMessage(text);
          chatInput.value = '';
        }
      } else if (e.key === 'Escape') {
        chatInput.classList.add('hidden');
        chatInput.value = '';
      }
    });

    // 失焦关闭
    chatInput.addEventListener('blur', function () {
      setTimeout(function () {
        chatInput.classList.add('hidden');
        chatInput.value = '';
      }, 200);
    });
  }

  function setupCursorTracking(): void {
    document.addEventListener('mousemove', function (e: MouseEvent) {
      // @ts-ignore
      window.companion.sendCursorMove({ x: e.screenX, y: e.screenY });
    });

    companionEl.addEventListener('click', function () {
      // @ts-ignore
      window.companion.sendClick();

      // 快速点击检测
      var now = Date.now();
      clickTimes.push(now);
      // 只保留最近3秒内的点击
      clickTimes = clickTimes.filter(function (t) { return now - t < 3000; });
      if (clickTimes.length >= 4) {
        var msgs = ['嗯嗯？', '怎么了', '别戳啦', '...', '有事吗~'];
        showBubble(msgs[Math.floor(Math.random() * msgs.length)]);
        clickTimes = [];
      }
    });
  }

  function setupStateListeners(): void {
    // @ts-ignore
    window.companion.onStateUpdate(function (data: any) {
      updateVisual(data.state, data.definition);
    });

    // @ts-ignore
    window.companion.onStateChanged(function (event: any) {
      currentState = event.to;
      onStateEnter(event.to, event.from);
    });

    // 主进程发来的气泡（问候、活动监视等）
    // @ts-ignore
    window.companion.onShowBubble(function (text: string) {
      showBubble(text);
    });
  }

  function setSprite(name: string): void {
    if (!SPRITE_DIR) return;
    // 根据名字前缀确定子目录
    var folder = 'basic/misc';
    if (name.indexOf('idle') === 0) folder = 'basic/idle';
    else if (name.indexOf('sleepy') === 0) folder = 'basic/sleepy';
    else if (name.indexOf('sleep') === 0) folder = 'basic/sleeping';
    else if (name.indexOf('dragged') === 0) folder = 'basic/dragged';
    else if (name.indexOf('lonely') === 0) folder = 'basic/lonely';
    else if (name.indexOf('comfortable') === 0) folder = 'basic/comfortable';
    else if (name.indexOf('tried') === 0) folder = 'basic/tried';
    var path = SPRITE_DIR + folder + '/' + name + '.png';
    console.log('[Sprite]', name);
    spriteEl.src = path;
  }

  function stopSleepAnim(): void {
    if (sleepAnimTimer) {
      clearTimeout(sleepAnimTimer);
      sleepAnimTimer = null;
    }
  }

  function stopSleepyAnim(): void {
    if (sleepyAnimTimer) {
      clearTimeout(sleepyAnimTimer);
      sleepyAnimTimer = null;
    }
    sleepyAnimRunning = false;
  }

  function stopLonelyAnim(): void {
    if (lonelyAnimTimer) {
      clearTimeout(lonelyAnimTimer);
      lonelyAnimTimer = null;
    }
    stopLonelyAction();
  }

  /** lonely 动画：lonely_0 → 1 → 2 → 3 → 4 → lonely（停留最终帧） */
  function startLonelyAnim(): void {
    stopLonelyAnim();
    setSprite('lonely_0');
    var frames = ['lonely_1', 'lonely_2', 'lonely_3', 'lonely_4', 'lonely'];
    var i = 0;
    function next(): void {
      lonelyAnimTimer = setTimeout(function () {
        if (currentState !== 'lonely') return;
        setSprite(frames[i]);
        i++;
        if (i < frames.length) {
          next();
        } else {
          // 主帧就位后，启动小动作定时器
          scheduleLonelyAction();
        }
      }, 600);
    }
    next();
  }

  function stopLonelyAction(): void {
    if (lonelyActionTimer) {
      clearTimeout(lonelyActionTimer);
      lonelyActionTimer = null;
    }
    // @ts-ignore
    window.companion.sendLonelyAction(false);
  }

  /** lonely 退出动画：从当前帧反向播放回 lonely_0 */
  function playLonelyExit(callback: () => void): void {
    stopLonelyAnim();
    stopLonelyAction();
    // 找到当前帧在序列中的位置，从那里开始反向
    var fullSeq = ['lonely_0', 'lonely_1', 'lonely_2', 'lonely_3', 'lonely_4', 'lonely'];
    var currentSrc = spriteEl.src;
    var currentIdx = -1;
    for (var j = 0; j < fullSeq.length; j++) {
      if (currentSrc.indexOf(fullSeq[j] + '.png') !== -1) {
        currentIdx = j;
        break;
      }
    }
    // 如果找不到当前帧，默认从 lonely 开始
    if (currentIdx < 0) currentIdx = fullSeq.length - 1;
    // 反向序列：从当前帧往回走到 lonely_0
    var frames: string[] = [];
    for (var k = currentIdx; k >= 0; k--) {
      frames.push(fullSeq[k]);
    }
    var i = 0;
    function next(): void {
      lonelyAnimTimer = setTimeout(function () {
        setSprite(frames[i]);
        i++;
        if (i < frames.length) {
          next();
        } else {
          callback();
        }
      }, 200);
    }
    next();
  }

  /** lonely 小动作：大约每分钟触发一次 */
  function scheduleLonelyAction(): void {
    stopLonelyAction();
    var delay = 40000 + Math.random() * 40000; // 40~80秒
    lonelyActionTimer = setTimeout(function () {
      if (currentState !== 'lonely') return;
      playLonelyAction();
    }, delay);
  }

  /** 播放 lonely 小动作：0→1→2→3 停几秒 → 4→5→5→4 → 3→2→1→0 回主帧 */
  function playLonelyAction(): void {
    // @ts-ignore
    window.companion.sendLonelyAction(true);

    // 0→1→2→3（600ms每帧）
    var slow = ['lonely_c_0', 'lonely_c_1', 'lonely_c_2', 'lonely_c_3'];
    // 4→5→5→4→3（200ms每帧）
    var fast = ['lonely_c_4', 'lonely_c_5', 'lonely_c_5', 'lonely_c_4', 'lonely_c_3'];
    // 3→2→1→0（600ms每帧）
    var back = ['lonely_c_2', 'lonely_c_1', 'lonely_c_0'];

    function playSequence(frames: string[], speed: number, callback: () => void): void {
      var i = 0;
      function next(): void {
        lonelyActionTimer = setTimeout(function () {
          if (currentState !== 'lonely') { stopLonelyAction(); return; }
          setSprite(frames[i]);
          i++;
          if (i < frames.length) {
            next();
          } else {
            callback();
          }
        }, speed);
      }
      setSprite(frames[0]);
      i = 1;
      next();
    }

    // 0→1→2→3
    playSequence(slow, 600, function () {
      // 停 2~3 秒
      lonelyActionTimer = setTimeout(function () {
        if (currentState !== 'lonely') { stopLonelyAction(); return; }
        // 4→5→5→4→3→2→1→0
        playSequence(fast, 200, function () {
          // 3→2→1→0 回主帧
          playSequence(back, 600, function () {
            setSprite('lonely');
            stopLonelyAction();
            scheduleLonelyAction();
          });
        });
      }, 2000 + Math.random() * 1000);
    });
  }

  /** sleepy 动画：sleepy_1 → sleepy_2 → sleepy_3 → sleepy（停2秒）→ 反向返回 sleepy_1 */
  function startSleepyAnim(): void {
    if (sleepyAnimRunning) return;
    sleepyAnimRunning = true;

    function scheduleNext(): void {
      // 基础停留时间 4~8 秒，然后播放过渡帧
      var baseDelay = 4000 + Math.random() * 4000;
      sleepyAnimTimer = setTimeout(function () {
        if (currentState !== 'sleepy') return;
        setSprite('sleepy_2');
        sleepyAnimTimer = setTimeout(function () {
          if (currentState !== 'sleepy') return;
          setSprite('sleepy_3');
          sleepyAnimTimer = setTimeout(function () {
            if (currentState !== 'sleepy') return;
            setSprite('sleepy'); // 最终帧
            sleepyAnimTimer = setTimeout(function () {
              if (currentState !== 'sleepy') return;
              // 反向返回
              setSprite('sleepy_3');
              sleepyAnimTimer = setTimeout(function () {
                if (currentState !== 'sleepy') return;
                setSprite('sleepy_2');
                sleepyAnimTimer = setTimeout(function () {
                  if (currentState !== 'sleepy') return;
                  setSprite('sleepy_1'); // 回到主帧
                  scheduleNext(); // 开始下一轮
                }, 800);
              }, 800);
            }, 2000);
          }, 800);
        }, 800);
      }, baseDelay);
    }

    setSprite('sleepy_1');
    scheduleNext();
  }

  function startSleepAnim(): void {
    stopSleepAnim();
    setSprite('sleep_1');
    sleepAnimTimer = setTimeout(function () {
      setSprite('sleep_2');
      sleepAnimTimer = setTimeout(function () {
        setSprite('sleep_3');
        sleepAnimTimer = setTimeout(function () {
          setSprite('sleeping'); // 最终帧，长时间停留
          sleepAnimTimer = null;
        }, 1500);
      }, 1500);
    }, 1500);
  }

  function stopTriedAnim(): void {
    if (triedAnimTimer) {
      clearTimeout(triedAnimTimer);
      triedAnimTimer = null;
    }
  }

  /** tried 动画：0→1→2→3→4 快速 → 3↔4 循环30s → 4→3→2→1→0 慢回 idle */
  function startTriedAnim(): void {
    stopTriedAnim();

    // 快速进入：0→1→2→3→4（200ms每帧）
    var enter = ['tried_0', 'tried_1', 'tried_2', 'tried_3', 'tried_4'];
    var i = 0;
    function playEnter(): void {
      triedAnimTimer = setTimeout(function () {
        if (currentState !== 'tried') return;
        setSprite(enter[i]);
        i++;
        if (i < enter.length) {
          playEnter();
        } else {
          // 进入循环阶段
          startTriedCycle();
        }
      }, 200);
    }
    setSprite(enter[0]);
    i = 1;
    playEnter();
  }

  /** tried 循环阶段：3↔4 交替，持续到状态超时前 */
  function startTriedCycle(): void {
    // 循环持续 约10秒（为退出动画留时间）
    var duration = 9000 + Math.random() * 2000;
    var startTime = Date.now();
    var showAlt = false;

    function cycle(): void {
      triedAnimTimer = setTimeout(function () {
        if (currentState !== 'tried') return;
        if (Date.now() - startTime > duration) {
          // 循环结束，开始退出
          playTriedExit();
          return;
        }
        showAlt = !showAlt;
        setSprite(showAlt ? 'tried_4' : 'tried_3');
        cycle();
      }, 1000);
    }
    setSprite('tried_3');
    cycle();
  }

  /** tried 退出：4→3→2→1→0（500ms每帧）→ idle */
  function playTriedExit(): void {
    var exit = ['tried_4', 'tried_3', 'tried_2', 'tried_1', 'tried_0'];
    var i = 0;
    function playExit(): void {
      triedAnimTimer = setTimeout(function () {
        if (currentState !== 'tried') return;
        setSprite(exit[i]);
        i++;
        if (i < exit.length) {
          playExit();
        } else {
          // 通知主进程切回 idle
          // @ts-ignore
          window.companion.sendStateFinished();
        }
      }, 500);
    }
    setSprite(exit[0]);
    i = 1;
    playExit();
  }

  var lastVisualState = '';
  var isLonelyExiting = false;

  function updateVisual(state: string, _definition: any): void {
    console.log('[Visual] state:', state, 'last:', lastVisualState, 'isDragActive:', isDragVisualActive);
    if (state === lastVisualState) return;

    var prevState = lastVisualState;
    // 先更新 lastVisualState，确保拖拽期间状态变化被追踪
    lastVisualState = state;

    // 退出动画播放中不更新精灵图
    if (isLonelyExiting) return;

    // 离开 lonely 时先播放反向退出动画
    if (prevState === 'lonely' && state !== 'lonely') {
      isLonelyExiting = true;
      playLonelyExit(function () {
        isLonelyExiting = false;
        lastVisualState = '';
        updateVisual(state, _definition);
      });
      return;
    }

    if (isBlinking && state === 'idle') return;
    // 拖拽期间不覆盖精灵图
    if (isDragVisualActive) return;
    // 拖拽已结束但主进程还在发旧的 dragged 状态，忽略
    if (state === 'dragged' && !isDragVisualActive) return;

    // 离开眨眼状态时重置标记
    if (state !== 'idle' && state !== 'curious') {
      isBlinking = false;
    }

    lastVisualState = state;
    stopSleepAnim();
    stopSleepyAnim();
    stopLonelyAnim();
    stopTriedAnim();

    switch (state) {
      case 'idle':
        companionEl.className = 'breathing';
        setSprite('idle');
        break;
      case 'curious':
        companionEl.className = 'curious';
        setSprite('idle');
        break;
      case 'dragged':
        companionEl.className = 'dragged';
        // 不覆盖拖拽动画，由 setupDragHandling 控制精灵图
        break;
      case 'sleepy':
        companionEl.className = 'sleepy';
        startSleepyAnim();
        break;
      case 'sleeping':
        companionEl.className = 'sleeping';
        setSprite('sleep_1');
        startSleepAnim();
        break;
      case 'lonely':
        companionEl.className = 'lonely';
        startLonelyAnim();
        break;
      case 'comfortable':
        companionEl.className = 'comfortable';
        setSprite('comfortable');
        break;
      case 'tried':
        companionEl.className = 'tried';
        startTriedAnim();
        break;
    }
  }

  function onStateEnter(state: string, from?: string): void {
    // 唤醒气泡
    if (from === 'sleeping' && state !== 'sleeping') {
      var msgs = ['嗯...', '天亮了？', '呼~', '...？'];
      showBubble(msgs[Math.floor(Math.random() * msgs.length)]);
    } else if (from === 'lonely' && state !== 'lonely') {
      var msgs2 = ['你来啦！', '终于', '~！', '在呢在呢'];
      showBubble(msgs2[Math.floor(Math.random() * msgs2.length)]);
    }

    maybeShowBubble(state);
  }

  function maybeShowBubble(state: string): void {
    var bubbleData = getBubbleForState(state);
    if (!bubbleData) return;

    if (Math.random() < bubbleData.probability) {
      showBubble(bubbleData.messages[Math.floor(Math.random() * bubbleData.messages.length)]);
    }
  }

  function getBubbleForState(state: string): { probability: number; messages: string[] } | null {
    var bubbles: Record<string, { probability: number; messages: string[] }> = {
      idle: { probability: 0.05, messages: ['~', '...', '♪'] },
      curious: { probability: 0.15, messages: ['?', '~?', '嗯？'] },
      dragged: { probability: 0.3, messages: ['哇', '...', '～'] },
      sleepy: { probability: 0.1, messages: ['好困...', 'zzZ', '呼...'] },
      lonely: { probability: 0.08, messages: ['...', '在吗', '嗯...'] },
      comfortable: { probability: 0.1, messages: ['嘿嘿', '~', '♪~'] },
      tried: { probability: 0.3, messages: ['好累...', '呼...', '...'] },
    };
    return bubbles[state] ?? null;
  }

  function showBubble(text: string): void {
    if (bubbleTimeout) {
      clearTimeout(bubbleTimeout);
    }

    bubbleEl.textContent = text;
    bubbleEl.classList.remove('hidden');
    bubbleEl.classList.add('visible');

    bubbleTimeout = setTimeout(function () {
      bubbleEl.classList.remove('visible');
      setTimeout(function () { bubbleEl.classList.add('hidden'); }, 500);
    }, 3000);
  }

  function scheduleNextBlink(): void {
    var interval;
    if (currentState === 'curious') {
      // curious: 2~6秒，更快
      interval = 2000 + Math.random() * 2000 + Math.random() * 2000;
    } else if (currentState === 'sleepy') {
      // sleepy: 4~10秒，更慢
      interval = 4000 + Math.random() * 3000 + Math.random() * 3000;
    } else {
      // idle: 2~8秒
      interval = 2000 + Math.random() * 3000 + Math.random() * 3000;
    }
    blinkTimer = setTimeout(function () {
      // sleepy 哈欠播放中不眨眼
      if (currentState === 'sleepy' && sleepyAnimTimer) {
        scheduleNextBlink();
        return;
      }
      if (currentState === 'idle' || currentState === 'curious' || currentState === 'sleepy') {
        performBlink();
      }
      scheduleNextBlink();
    }, interval);
  }

  function performBlink(): void {
    if (!SPRITE_DIR) return;
    isBlinking = true;
    var speed: number;
    if (currentState === 'curious') {
      // curious: 70~130ms，更快
      speed = 70 + Math.random() * 60;
    } else if (currentState === 'sleepy') {
      // sleepy: 120~200ms，更慢
      speed = 120 + Math.random() * 80;
    } else {
      // idle: 80~150ms
      speed = 80 + Math.random() * 70;
    }

    if (currentState === 'sleepy') {
      // sleepy 眨眼：sleepy_1 → sleepy_blink → sleepy_1
      setSprite('sleepy_blink');
      setTimeout(function () {
        setSprite('sleepy_1');
        isBlinking = false;
      }, speed * 2);
    } else {
      // idle/curious 眨眼：idle → blink_1 → blink_2 → blink_1 → idle
      setSprite('idle_blink_1');
      setTimeout(function () {
        if (currentState !== 'idle' && currentState !== 'curious') { isBlinking = false; return; }
        setSprite('idle_blink_2');
        setTimeout(function () {
          if (currentState !== 'idle' && currentState !== 'curious') { isBlinking = false; return; }
          setSprite('idle_blink_1');
          setTimeout(function () {
            if (currentState !== 'idle' && currentState !== 'curious') { isBlinking = false; return; }
            setSprite('idle');
            isBlinking = false;
          }, speed);
        }, speed);
      }, speed);
    }
  }

  init();
})();
