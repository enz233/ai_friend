// 渲染进程 - 管理伙伴的视觉表现（纯浏览器脚本，无模块语法）

(function () {
  var SPRITE_DIR = '';

  var currentState = 'idle';
  var bubbleTimeout: ReturnType<typeof setTimeout> | null = null;
  var blinkTimer: ReturnType<typeof setTimeout> | null = null;
  var sleepAnimTimer: ReturnType<typeof setInterval> | null = null;
  var isBlinking = false;

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
    setupStateListeners();
    scheduleNextBlink();
    setupClickThrough();
  }

  function setupClickThrough(): void {
    companionEl.addEventListener('mouseenter', function () {
      // @ts-ignore
      window.companion.sendMouseEnter();
    });
    companionEl.addEventListener('mouseleave', function () {
      // @ts-ignore
      window.companion.sendMouseLeave();
    });
  }

  function setupDragHandling(): void {
    var isDragging = false;

    companionEl.addEventListener('mousedown', function () {
      isDragging = true;
      // @ts-ignore
      window.companion.sendDragStart();
    });

    document.addEventListener('mousemove', function (e: MouseEvent) {
      if (!isDragging) return;
      if (e.movementX === 0 && e.movementY === 0) return;
      // @ts-ignore
      window.companion.sendWindowMoveBy({ deltaX: e.movementX, deltaY: e.movementY });
    });

    document.addEventListener('mouseup', function () {
      if (isDragging) {
        isDragging = false;
        // @ts-ignore
        window.companion.sendDragEnd();
      }
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
    });
  }

  function setupStateListeners(): void {
    // @ts-ignore
    window.companion.onStateUpdate(function (data: any) {
      updateVisual(data.state, data.definition);
    });

    // @ts-ignore
    window.companion.onStateChanged(function (event: any) {
      console.log('State changed:', event.from, '->', event.to);
      currentState = event.to;
      onStateEnter(event.to);
    });
  }

  function setSprite(name: string): void {
    if (!SPRITE_DIR) return;
    spriteEl.src = SPRITE_DIR + name + '.png';
  }

  function stopSleepAnim(): void {
    if (sleepAnimTimer) {
      clearInterval(sleepAnimTimer);
      sleepAnimTimer = null;
    }
  }

  function startSleepAnim(): void {
    stopSleepAnim();
    var frames = ['sleep_1', 'sleep_2', 'sleep_3'];
    var frameIndex = 0;
    sleepAnimTimer = setInterval(function () {
      frameIndex = (frameIndex + 1) % frames.length;
      setSprite(frames[frameIndex]);
    }, 1500);
  }

  function updateVisual(state: string, _definition: any): void {
    console.log('State update:', state);
    stopSleepAnim();
    if (isBlinking && state === 'idle') return;

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
        setSprite('dragged');
        break;
      case 'sleepy':
        companionEl.className = 'sleepy';
        setSprite('sleepy');
        break;
      case 'sleeping':
        companionEl.className = 'sleeping';
        setSprite('sleep_1');
        startSleepAnim();
        break;
      case 'lonely':
        companionEl.className = 'lonely';
        setSprite('lonely');
        break;
      case 'comfortable':
        companionEl.className = 'comfortable';
        setSprite('comfortable');
        break;
    }
  }

  function onStateEnter(state: string): void {
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
    var interval = 3000 + Math.random() * 4000;
    blinkTimer = setTimeout(function () {
      if (currentState === 'idle') {
        performBlink();
      }
      scheduleNextBlink();
    }, interval);
  }

  function performBlink(): void {
    if (!SPRITE_DIR) return;
    isBlinking = true;
    setSprite('idle_blink_1');
    setTimeout(function () {
      setSprite('idle_blink_2');
      setTimeout(function () {
        setSprite('idle_blink_1');
        setTimeout(function () {
          setSprite('idle');
          isBlinking = false;
        }, 120);
      }, 120);
    }, 120);
  }

  init();
})();
