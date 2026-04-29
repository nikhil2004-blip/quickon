/**
 * touchpad.js — Full laptop trackpad emulation
 *
 * Gestures (like HP Victus trackpad):
 *  1 finger drag  → mouse move (with EMA smoothing + sensitivity)
 *  1 finger tap   → left click
 *  2 finger drag  → scroll
 *  2 finger tap   → right click
 *  3 finger swipe ↓ → Win+D  (show desktop / minimize all)
 *  3 finger swipe ↑ → Win+Tab (Task View)
 *  3 finger swipe ← → Alt+Tab (switch apps backward)
 *  3 finger swipe → → Alt+Tab (switch apps forward)
 *  4 finger swipe ← → Win+Ctrl+Left  (virtual desktop left)
 *  4 finger swipe → → Win+Ctrl+Right (virtual desktop right)
 *
 * Anti-jitter: EMA low-pass filter + dead zone on raw deltas.
 * Speed: configurable sensitivity multiplier (default 2.5×).
 */

'use strict';

(function TouchpadModule() {

  // ── DOM ──────────────────────────────────────────────────────
  const $touchpad = document.getElementById('touchpad');

  // Inject glow element for finger tracking
  const $touchGlow = document.createElement('div');
  $touchGlow.className = 'touch-glow';
  $touchpad.appendChild($touchGlow);

  // ── Config ────────────────────────────────────────────────────
  const CFG = {
    sensitivity: 1.5,   // px multiplier
    tapMaxMovePx: 12,    // max movement to count as a tap
    tapMaxMs: 300,   // max duration for a tap
    scrollRatio: 2.0,   // scroll sensitivity
    gestureMinPx: 30,    // minimum swipe distance to trigger a gesture
    gestureMaxMs: 500,   // maximum time for a swipe gesture
  };

  // ── State ─────────────────────────────────────────────────────
  /** Map<pointerId, {x, y, startX, startY, startTime, primed}> */
  const _ptrs = new Map();


  // Sub-pixel accumulator — keeps fractional remainders between pointermove events
  let _accDx = 0;
  let _accDy = 0;

  // EMA smoothed values — low-pass filtered raw deltas
  let _emaDx = 0;
  let _emaDy = 0;

  // rAF handle — used to batch mouse moves (one send per frame, ~60/s)
  let _rafId = null;

  // Scroll accumulator
  let _scrollAcc = 0;

  // Pinch zoom tracking: distance between two fingers
  let _lastPinchDist = 0;
  let _pinchAccum = 0;

  // Two-finger gesture mode: 'undecided' | 'scroll' | 'pinch'
  // Once decided, stays locked until all fingers lift.
  let _twoFingerMode = 'undecided';
  let _twoFingerSamples = 0;         // how many move events since 2 fingers landed
  let _twoFingerScrollTotal = 0;     // accumulated absolute parallel movement
  let _twoFingerPinchTotal = 0;      // accumulated absolute pinch distance change

  // Gesture tracking
  let _gestureStartPtrs = [];
  let _gestureTriggered = false;

  // Double-tap detection for keyboard trigger
  let _lastTapTime = 0;

  // Session-level first touch: ensure accumulator wiped ONCE per session,
  // not per pointer. Cleared only when ALL fingers lift and touchpad regains focus.
  let _sessionFirstTouch = true;

  // Inhibit window: drop all pointer-move sends until this timestamp
  // Used to absorb the OS event burst after returning from a widget action.
  let _inhibitUntil = 0;

  // Last activity timestamp — detect if touchpad has been inactive
  let _lastActivityTime = Date.now();

  // Drag-lock state: when true, left button is held on the PC
  let _dragLocked = false;

  // Cached touchpad rect — avoids calling getBoundingClientRect() at 120Hz.
  // Recalculated once on pointerdown; the touchpad never resizes mid-drag.
  let _cachedRect = null;

  // Pending glow position — written by pointermove, consumed by rAF flush.
  // Avoids writing style.transform directly in the event handler (skips layout thrash).
  let _pendingGlowX = 0;
  let _pendingGlowY = 0;
  let _glowDirty = false;


  /** Nuke all accumulator state — clean slate */
  function _resetSmoothing() {
    _accDx = 0;
    _accDy = 0;
    _emaDx = 0;
    _emaDy = 0;
    _scrollAcc = 0;
    _lastPinchDist = 0;
    _pinchAccum = 0;
    _twoFingerMode = 'undecided';
    _twoFingerSamples = 0;
    _twoFingerScrollTotal = 0;
    _twoFingerPinchTotal = 0;
    _cachedRect = null;  // force fresh rect on next pointerdown
    _glowDirty = false;  // discard any pending glow update
  }

  // ── rAF-gated flush — ONE send per animation frame (~60/s) ──────
  // Pointer events can fire 120+ times/sec on mobile. Without batching,
  // every event sends a WebSocket message → the Python server queues
  // hundreds of pynput tasks → cursor lags behind AND mouse_button
  // release (e.g. screenshot) is buried at the back of that queue.
  // rAF collapses all deltas in a frame into a single send.
  function _flushNow() {
    _rafId = null;

    // ── Update glow position (batched from pointermove) ──
    if (_glowDirty) {
      _glowDirty = false;
      $touchGlow.style.transform = `translate(${_pendingGlowX}px, ${_pendingGlowY}px)`;
    }

    let sendDx = Math.trunc(_accDx);
    let sendDy = Math.trunc(_accDy);

    if (sendDx !== 0 || sendDy !== 0) {
      PocketDeck.send({ type: 'mouse_move', dx: sendDx, dy: sendDy });
      // Subtract only the integer part that was sent; keep sub-pixel remainder
      _accDx -= sendDx;
      _accDy -= sendDy;
    }
  }

  function _scheduleFlush() {
    if (_rafId === null) {
      _rafId = requestAnimationFrame(_flushNow);
    }
  }

  // ── Filter pipeline ──────────────────────────────────────────────────────
  // Removed heavy EMA and deadzone: mobile touchscreens are already hardware-filtered.
  // Passing smoothed values messes with Windows' native 'Enhance Pointer Precision',
  // causing "floaty" lag and initial jitter.
  const _filterResult = { dx: 0, dy: 0 };
  function _filterDelta(rawDx, rawDy) {
    // Just apply sensitivity directly to pass raw velocity to the OS
    _filterResult.dx = rawDx * CFG.sensitivity;
    _filterResult.dy = rawDy * CFG.sensitivity;
    return _filterResult;
  }

  // ── Pinch-zoom helper ─────────────────────────────────────────
  function _calcPinchDistance(ptrs) {
    if (ptrs.size !== 2) return 0;
    const points = Array.from(ptrs.values());
    const dx = points[0].x - points[1].x;
    const dy = points[0].y - points[1].y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  // ── Gesture helper ────────────────────────────────────────────
  function _triggerGesture(fingerCount, direction) {
    if (_gestureTriggered) return;
    _gestureTriggered = true;

    const gestures = {
      // 3-finger up intentionally omitted — phone OS intercepts it (screenshot)
      '3-down': { type: 'key_tap', key: 'win+d' },           // Show desktop / minimize all
      '3-left': { type: 'key_tap', key: 'alt+shift+tab' },   // Switch app backward
      '3-right': { type: 'key_tap', key: 'alt+tab' },         // Switch app forward
      // 4-finger: swipe direction = pan direction (like a real trackpad)
      // 4-finger: swipe direction = pan direction (like a real trackpad)
      // Swipe from right to left (LEFT swipe) pulls the RIGHT virtual desktop into view
      // Swipe from left to right (RIGHT swipe) pulls the LEFT virtual desktop into view
      '4-left': { type: 'key_tap', key: 'win+ctrl+right' },  // Virtual desktop right
      '4-right': { type: 'key_tap', key: 'win+ctrl+left' },   // Virtual desktop left
      '4-up': { type: 'key_tap', key: 'win+tab' },         // Task View
      '4-down': { type: 'key_tap', key: 'win+d' },           // Show desktop
    };

    const key = `${fingerCount}-${direction}`;
    const msg = gestures[key];
    if (msg) {
      PocketDeck.send(msg);
      // Visual flash feedback
      _flashGesture(`${fingerCount}F ${direction}`);
    }
  }

  function _flashGesture(label) {
    let el = document.getElementById('gesture-flash');
    if (!el) {
      el = document.createElement('div');
      el.id = 'gesture-flash';
      Object.assign(el.style, {
        position: 'absolute',
        top: '50%', left: '50%',
        transform: 'translate(-50%, -50%)',
        background: 'rgba(24, 24, 27, 0.92)',
        border: '1px solid rgba(255,255,255,0.06)',
        color: '#f4f4f5',
        fontSize: '16px',
        fontWeight: '500',
        padding: '10px 20px',
        borderRadius: '16px',
        pointerEvents: 'none',
        zIndex: '99',
        // backdrop-filter REMOVED — GPU-expensive blur was causing
        // compositor stalls during pointer events on mid-range phones.
        transition: 'opacity .3s ease',
      });
      $touchpad.appendChild(el);
    }
    el.textContent = label;
    el.style.opacity = '1';
    clearTimeout(el._timer);
    el._timer = setTimeout(() => { el.style.opacity = '0'; }, 700);
  }

  // ── Determine swipe direction ─────────────────────────────────
  function _getSwipeDirection(dx, dy) {
    if (Math.abs(dx) > Math.abs(dy)) {
      return dx > 0 ? 'right' : 'left';
    } else {
      return dy > 0 ? 'down' : 'up';
    }
  }

  // ── Pointer event handlers ─────────────────────────────────────
  $touchpad.addEventListener('pointerdown', e => {
    e.preventDefault();
    $touchpad.setPointerCapture(e.pointerId);

    const now = Date.now();
    const timeSinceLastActivity = now - _lastActivityTime;
    _lastActivityTime = now;

    // If more than 500ms has passed since last pointer activity,
    // we likely switched panels. Reset everything to avoid stale jitter.
    if (timeSinceLastActivity > 500 || _sessionFirstTouch) {
      _sessionFirstTouch = false;
      _resetSmoothing();
      _ptrs.clear();  // clear any stale pointer records
    }

    // Cache the touchpad rect ONCE per touch session.
    // getBoundingClientRect() forces a synchronous layout recalc — calling it
    // at 120Hz in pointermove was the #1 cause of lag on mobile.
    _cachedRect = $touchpad.getBoundingClientRect();

    _ptrs.set(e.pointerId, {
      id: e.pointerId,
      x: e.clientX, y: e.clientY,
      startX: e.clientX, startY: e.clientY,
      startTime: now,    // reuse cached now — avoid second Date.now() syscall
      primed: false,
    });

    // Update touch glow for the primary pointer (first finger down)
    if (_ptrs.size === 1) {
      const tx = e.clientX - _cachedRect.left;
      const ty = e.clientY - _cachedRect.top;
      // Batch glow update into rAF — don't write style directly in event handler
      _pendingGlowX = tx;
      _pendingGlowY = ty;
      _glowDirty = true;
      $touchGlow.classList.add('active');
      _scheduleFlush();
    }

    // Reset gesture state when finger count changes
    if (_ptrs.size >= 2) {
      _gestureTriggered = false;
      // Snapshot without spread — copy only the fields needed for gesture detection
      _gestureStartPtrs = Array.from(_ptrs.values()).map(p => ({ id: p.id, startX: p.startX, startY: p.startY }));
    }
  }, { passive: false });

  $touchpad.addEventListener('pointermove', e => {
    e.preventDefault();
    const prev = _ptrs.get(e.pointerId);
    if (!prev) return;

    // Single Date.now() per event — avoid repeated syscalls at 120Hz
    const now = Date.now();
    _lastActivityTime = now;

    const rawDx = e.clientX - prev.x;
    const rawDy = e.clientY - prev.y;

    // Mutate in place — avoids a heap allocation + spread copy on every move event
    prev.x = e.clientX;
    prev.y = e.clientY;

    const count = _ptrs.size;

    if (count === 1) {
      // The first move sample after pointerdown is often a noisy jump on mobile.
      // Skip it to avoid the startup jitter burst.
      if (!prev.primed) {
        prev.primed = true;
        return;
      }

      // Finger tracking glow update — batched via rAF, NOT direct style write.
      // Uses _cachedRect from pointerdown — no getBoundingClientRect() call here.
      if (_cachedRect) {
        _pendingGlowX = e.clientX - _cachedRect.left;
        _pendingGlowY = e.clientY - _cachedRect.top;
        _glowDirty = true;
      }

      // Single finger → move mouse: accumulate and flush via rAF (~60/s)
      // If in inhibit window, clear accumulators and return to prevent burst release
      if (now < _inhibitUntil) {
        _accDx = 0;
        _accDy = 0;
        return;  // absorb OS burst after panel switch
      }
      const { dx, dy } = _filterDelta(rawDx, rawDy);
      _accDx += dx;
      _accDy += dy;
      _scheduleFlush();  // batches all moves in this frame into one send

    } else if (count === 2) {
      // ─────────────────────────────────────────────────────────────
      // Two-Finger Gesture: Disambiguate Scroll vs Pinch-Zoom
      // ─────────────────────────────────────────────────────────────
      
      const currDist = _calcPinchDistance(_ptrs);
      _twoFingerSamples++;
      
      if (_twoFingerSamples === 1) {
        // First sample, just initialize distance
        _lastPinchDist = currDist;
      } else {
        const distDelta = currDist - _lastPinchDist;
        const absDistDelta = Math.abs(distDelta);
        const absScrollDelta = Math.abs(rawDy) + Math.abs(rawDx); // approximate parallel movement
        
        _twoFingerPinchTotal += absDistDelta;
        _twoFingerScrollTotal += absScrollDelta;

        // Determine mode if not decided yet, after 3 samples or if a threshold is crossed
        if (_twoFingerMode === 'undecided') {
          if (_twoFingerSamples > 3 || _twoFingerPinchTotal > 10 || _twoFingerScrollTotal > 10) {
            // Compare total movement to classify
            if (_twoFingerPinchTotal > _twoFingerScrollTotal * 1.5) {
              _twoFingerMode = 'pinch';
            } else {
              _twoFingerMode = 'scroll';
            }
          }
        }

        // Execute based on decided mode
        if (_twoFingerMode === 'scroll' || (_twoFingerMode === 'undecided' && _twoFingerScrollTotal > _twoFingerPinchTotal)) {
          // --- SCROLLING ---
          // Negate rawDy to invert scroll (drag UP = negative dy = negative scroll = scroll UP)
          _scrollAcc += -rawDy; 
          
          if (Math.abs(_scrollAcc) >= 5) {
            const clicks = Math.round(_scrollAcc / (5 / CFG.scrollRatio));
            PocketDeck.send({ type: 'mouse_scroll', dx: 0, dy: clicks });
            _scrollAcc -= clicks * (5 / CFG.scrollRatio);
          }
        } 
        else if (_twoFingerMode === 'pinch' || (_twoFingerMode === 'undecided' && _twoFingerPinchTotal > _twoFingerScrollTotal)) {
          // --- PINCH ZOOM ---
          _pinchAccum += distDelta;

          // Threshold for zoom step
          const PINCH_THRESHOLD = 25; 
          
          if (Math.abs(_pinchAccum) >= PINCH_THRESHOLD) {
            const zoomDirection = _pinchAccum > 0 ? 'ctrl+=' : 'ctrl+-';
            const zoomSteps = Math.floor(Math.abs(_pinchAccum) / PINCH_THRESHOLD);
            for (let i = 0; i < zoomSteps; i++) {
              PocketDeck.send({ type: 'key_tap', key: zoomDirection });
            }
            // Keep remainder
            _pinchAccum = _pinchAccum % PINCH_THRESHOLD; 
          }
        }
        
        _lastPinchDist = currDist;
      }

    } else if (count >= 3 && !_gestureTriggered) {
      // Multi-finger gesture detection
      // Use the average centroid movement across all pointers
      const allPtrs = Array.from(_ptrs.values());
      const avgX = allPtrs.reduce((s, p) => s + p.x, 0) / allPtrs.length;
      const avgY = allPtrs.reduce((s, p) => s + p.y, 0) / allPtrs.length;

      // Compare against centroid at gesture start
      if (_gestureStartPtrs.length >= count) {
        const startAvgX = _gestureStartPtrs.reduce((s, p) => s + p.startX, 0) / _gestureStartPtrs.length;
        const startAvgY = _gestureStartPtrs.reduce((s, p) => s + p.startY, 0) / _gestureStartPtrs.length;
        const totalDx = avgX - startAvgX;
        const totalDy = avgY - startAvgY;
        const dist = Math.sqrt(totalDx * totalDx + totalDy * totalDy);

        if (dist >= CFG.gestureMinPx) {
          const dir = _getSwipeDirection(totalDx, totalDy);
          _triggerGesture(count, dir);
        }
      }
    }
  }, { passive: false });

  $touchpad.addEventListener('pointerup', e => {
    e.preventDefault();
    const info = _ptrs.get(e.pointerId);
    _ptrs.delete(e.pointerId);

    // Fade out glow if no fingers left
    if (_ptrs.size === 0) {
      $touchGlow.classList.remove('active');
    }

    if (!info) return;

    // ── DRAG LOCK RELEASE — must happen FIRST, before ANY tap processing ──
    // Fires synchronously the moment the last finger leaves the screen.
    // This is the critical path for screenshot selection: lift finger → left
    // button releases on PC → Snipping Tool captures immediately.
    const wasDragLocked = _dragLocked;
    if (_ptrs.size === 0 && _dragLocked) {
      _setDragLock(false);
    }

    // Skip all tap/click logic if we were ending a drag-lock session
    if (wasDragLocked) {
      if (_ptrs.size === 0) {
        _resetSmoothing();
        _gestureTriggered = false;
      }
      return;
    }

    const dt = Date.now() - info.startTime;
    const moveX = Math.abs(e.clientX - info.startX);
    const moveY = Math.abs(e.clientY - info.startY);
    const isTap = dt < CFG.tapMaxMs && moveX < CFG.tapMaxMovePx && moveY < CFG.tapMaxMovePx;

    if (isTap && !_gestureTriggered) {
      const fingerCountAtTap = _ptrs.size + 1;
      if (fingerCountAtTap === 1) {
        // Double-tap detection: if two taps arrive within 300ms → show keyboard
        // No setTimeout needed — pointerup already fires after the finger is gone.
        // The 80ms delay was causing every click to feel 80ms late.
        const now = Date.now();
        if (now - _lastTapTime < 300) {
          _lastTapTime = 0;
          // Double-tap: send click immediately then show keyboard
          PocketDeck.send({ type: 'mouse_click', button: 'left' });
          _showKeyboard();
        } else {
          // Single tap: left click — fire immediately, no delay
          _lastTapTime = now;
          PocketDeck.send({ type: 'mouse_click', button: 'left' });
        }
      } else if (fingerCountAtTap === 2) {
        PocketDeck.send({ type: 'mouse_click', button: 'right' });
        _gestureTriggered = true;
      }
    }

    // Reset all smoothing state when all fingers lift
    if (_ptrs.size === 0) {
      _resetSmoothing();
      _gestureTriggered = false;
      _sessionFirstTouch = true;  // allow reset on next session touch
    }
  }, { passive: false });


  $touchpad.addEventListener('pointercancel', e => {
    e.preventDefault();
    _ptrs.delete(e.pointerId);
    _lastActivityTime = Date.now();
    if (_ptrs.size === 0) {
      $touchGlow.classList.remove('active');
      _resetSmoothing();
      _gestureTriggered = false;
    }
  });

  // Prevent context menu on long press
  $touchpad.addEventListener('contextmenu', e => e.preventDefault());



  // ── Keyboard bottom sheet ─────────────────────────────────────
  // Built once, toggled via CSS class. Slides up like the native
  // Android system keyboard.

  let _kbdSheet = null;         // the DOM element
  let _kbdVisible = false;
  const _mods = { ctrl: false, alt: false, shift: false, win: false };

  const KEY_MAP = {
    '⌫': 'backspace', '↵': 'enter', '⏎': 'enter',
  };
  const ROWS = [
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '=', '⌫'],
    ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P', '[', ']'],
    ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', ';', "'", '\u21b5'],
    ['Z', 'X', 'C', 'V', 'B', 'N', 'M', ',', '.', '/']
  ];

  function _sendKey(key) {
    const activeMods = Object.entries(_mods).filter(([, v]) => v).map(([k]) => k);
    const hasShiftOnly = activeMods.length === 1 && _mods.shift;
    const hasNoMods = activeMods.length === 0;
    const combo = activeMods.length ? [...activeMods, key].join('+') : key;
    PocketDeck.send({ type: 'key_tap', key: combo });

    // Update the local text display div so user can see what they've typed
    const textDisp = _kbdSheet && _kbdSheet.querySelector('#kbd-sheet-text');
    if (textDisp && (hasNoMods || hasShiftOnly)) {
      if (key === 'backspace') {
        textDisp.textContent = textDisp.textContent.slice(0, -1);
      } else if (key === 'enter') {
        textDisp.textContent = '';
      } else if (key === 'space') {
        textDisp.textContent += '\u00a0'; // non-breaking space so it's visible
      } else if (key.length === 1) {
        textDisp.textContent += hasShiftOnly ? key.toUpperCase() : key;
      }
    }

    // Auto-release sticky mods after one keystroke
    Object.keys(_mods).forEach(k => {
      if (_mods[k]) {
        _mods[k] = false;
        const b = _kbdSheet && _kbdSheet.querySelector(`#ks-mod-${k}`);
        if (b) b.classList.remove('active');
      }
    });
  }

  function _toggleMod(name) {
    _mods[name] = !_mods[name];
    const b = _kbdSheet && _kbdSheet.querySelector(`#ks-mod-${name}`);
    if (b) b.classList.toggle('active', _mods[name]);
  }

  function _makeKey(label, keyName, cls) {
    const btn = document.createElement('button');
    btn.className = cls;
    btn.textContent = label;
    btn.addEventListener('pointerdown', e => {
      e.preventDefault();
      e.stopPropagation();
      _sendKey(keyName);
    });
    return btn;
  }

  /**
   * _buildKeyboardDOM — builds the QWERTY sheet DOM inside `container`.
   * Fully reusable: onKey/onDismiss/onSend are caller-supplied callbacks.
   *
   * @param {HTMLElement} container  The .kbd-sheet div to populate.
   * @param {Function}    onKey      Called with (keyName) on each key press.
   * @param {Function}    onDismiss  Called when ▼ or swipe-down is triggered.
   * @param {Function|null} onSend   Called with (text) on Send tap; null = hide Send row.
   * @param {Object}      localMods  Modifier state obj {ctrl,alt,shift,win} (mutated).
   * @param {Function}    toggleMod  Called with (modName, btnEl) to toggle a modifier.
   */
  function _buildKeyboardDOM(container, onKey, onDismiss, onSend, localMods, toggleMod) {
    // ── Block Android IME (native keyboard) ───────────────────────────────
    // Any focused element inside the sheet can trigger Chrome-for-Android's
    // virtual keyboard. Intercept every focusin and immediately blur it.
    container.addEventListener('focusin', e => {
      e.target.blur();
      e.stopPropagation();
    }, true);
    container.setAttribute('inputmode', 'none');

    // ── Handle bar ───────────────────────────────────────────────────────
    const handle = document.createElement('div');
    handle.className = 'kbd-sheet-handle-row';
    const dismissBtn = document.createElement('button');
    dismissBtn.className = 'kbd-sheet-dismiss';
    dismissBtn.setAttribute('aria-label', 'Hide keyboard');
    dismissBtn.textContent = '▼';
    dismissBtn.addEventListener('pointerdown', e => {
      e.preventDefault(); e.stopPropagation(); onDismiss();
    });
    const pill = document.createElement('div');
    pill.className = 'kbd-sheet-handle';
    handle.appendChild(dismissBtn);
    handle.appendChild(pill);
    container.appendChild(handle);

    // ── Text display + Send row ──────────────────────────────────────────
    let textDisp = null;
    if (onSend) {
      const bulkRow = document.createElement('div');
      bulkRow.className = 'kbd-sheet-bulk';
      textDisp = document.createElement('div');
      textDisp.className = 'kbd-sheet-text-display';
      textDisp.setAttribute('aria-label', 'Typed text');
      const sendBtn = document.createElement('button');
      sendBtn.className = 'kbd-sheet-send';
      sendBtn.textContent = 'Send';
      sendBtn.addEventListener('pointerdown', e => {
        e.preventDefault(); e.stopPropagation();
        const text = textDisp.textContent.replace(/\u00a0/g, ' ').trim();
        if (text) { onSend(text); textDisp.textContent = ''; }
      });
      bulkRow.appendChild(textDisp);
      bulkRow.appendChild(sendBtn);
      container.appendChild(bulkRow);
    }

    // ── Modifier row ─────────────────────────────────────────────────────
    const modRow = document.createElement('div');
    modRow.className = 'kbs-row';
    [
      ['Esc', 'esc', null], ['Ctrl', null, 'ctrl'],
      ['Alt', null, 'alt'], ['\u2756Win', null, 'win'],
      ['Shift', null, 'shift'], ['Tab', 'tab', null],
    ].forEach(([label, key, mod]) => {
      const btn = document.createElement('button');
      btn.className = 'kbs-key kbs-mod';
      btn.textContent = label;
      if (mod) {
        btn.dataset.mod = mod;
        btn.addEventListener('pointerdown', e => {
          e.preventDefault(); e.stopPropagation();
          toggleMod(mod, btn);
        });
      } else {
        btn.addEventListener('pointerdown', e => {
          e.preventDefault(); e.stopPropagation();
          _updateTextDisp(textDisp, localMods, key);
          onKey(key, localMods);
        });
      }
      modRow.appendChild(btn);
    });
    container.appendChild(modRow);

    // ── QWERTY rows ──────────────────────────────────────────────────────
    ROWS.forEach(rowKeys => {
      const row = document.createElement('div');
      row.className = 'kbs-row';
      rowKeys.forEach(k => {
        const keyName = KEY_MAP[k] || k.toLowerCase();
        const isWide  = k === '\u232b' || k === '\u21b5';
        const btn = document.createElement('button');
        btn.className = 'kbs-key' + (isWide ? ' kbs-wide' : '');
        btn.textContent = k;
        btn.addEventListener('pointerdown', e => {
          e.preventDefault(); e.stopPropagation();
          _updateTextDisp(textDisp, localMods, keyName);
          onKey(keyName, localMods);
        });
        row.appendChild(btn);
      });
      container.appendChild(row);
    });

    // ── Bottom row: Space + Arrows ────────────────────────────────────────
    const bottomRow = document.createElement('div');
    bottomRow.className = 'kbs-row';
    const spaceBtn = document.createElement('button');
    spaceBtn.className = 'kbs-key kbs-space';
    spaceBtn.textContent = 'Space';
    spaceBtn.addEventListener('pointerdown', e => {
      e.preventDefault(); e.stopPropagation();
      _updateTextDisp(textDisp, localMods, 'space');
      onKey('space', localMods);
    });
    bottomRow.appendChild(spaceBtn);
    [['←','left'],['↑','up'],['↓','down'],['→','right']].forEach(([lbl, k]) => {
      const b = document.createElement('button');
      b.className = 'kbs-key kbs-arrow';
      b.textContent = lbl;
      b.addEventListener('pointerdown', e => {
        e.preventDefault(); e.stopPropagation();
        onKey(k, localMods);
      });
      bottomRow.appendChild(b);
    });
    container.appendChild(bottomRow);

    // ── Swipe-down-to-dismiss ────────────────────────────────────────────
    let _swipeStartY = null;
    handle.addEventListener('pointerdown', e => {
      _swipeStartY = e.clientY;
      handle.setPointerCapture(e.pointerId);
    }, { passive: true });
    handle.addEventListener('pointermove', e => {
      if (_swipeStartY === null) return;
      const dy = e.clientY - _swipeStartY;
      if (dy > 0) container.style.transform = `translateY(${dy}px)`;
    }, { passive: true });
    handle.addEventListener('pointerup', e => {
      const dy = e.clientY - (_swipeStartY || e.clientY);
      _swipeStartY = null;
      container.style.transform = '';
      if (dy > 60) onDismiss();
    }, { passive: true });
  }

  /** Update text display div based on what key was pressed */
  function _updateTextDisp(textDisp, localMods, key) {
    if (!textDisp) return;
    const activeMods  = Object.entries(localMods).filter(([,v]) => v).map(([k]) => k);
    const hasShiftOnly = activeMods.length === 1 && localMods.shift;
    const hasNoMods    = activeMods.length === 0;
    if (!hasNoMods && !hasShiftOnly) return;  // combo — don't print to display
    if (key === 'backspace') {
      textDisp.textContent = textDisp.textContent.slice(0, -1);
    } else if (key === 'enter') {
      textDisp.textContent = '';
    } else if (key === 'space') {
      textDisp.textContent += '\u00a0';
    } else if (key.length === 1) {
      textDisp.textContent += hasShiftOnly ? key.toUpperCase() : key;
    }
  }

  function _buildSheet() {
    if (_kbdSheet) return;  // already built

    const sheet = document.createElement('div');
    sheet.id        = 'kbd-sheet';
    sheet.className = 'kbd-sheet';

    _buildKeyboardDOM(
      sheet,
      /* onKey */    (key, mods) => _sendKey(key),
      /* onDismiss */() => _hideKeyboard(),
      /* onSend */   text => PocketDeck.send({ type: 'text_type', text }),
      _mods,
      /* toggleMod */(mod) => _toggleMod(mod),
    );

    // Stop touchpad events leaking into sheet
    sheet.addEventListener('pointerdown', e => e.stopPropagation());

    document.getElementById('panel-touchpad').appendChild(sheet);
    _kbdSheet = sheet;

    // ── Persistent ▲ toggle ──────────────────────────────────────────────
    const $toggle = document.createElement('button');
    $toggle.id        = 'kbd-toggle-btn';
    $toggle.className = 'kbd-toggle-btn';
    $toggle.innerHTML = '▲';
    $toggle.setAttribute('aria-label', 'Show keyboard');
    $toggle.addEventListener('pointerdown', e => {
      e.preventDefault(); e.stopPropagation();
      _showKeyboard();
    });
    document.getElementById('panel-touchpad').appendChild($toggle);
  }

  function _showKeyboard() {
    _buildSheet();   // no-op if already built
    if (_kbdVisible) return;
    _kbdVisible = true;

    // ── Critical: release all pointer captures from the touchpad ──
    // The tap that opened the keyboard called setPointerCapture(), which
    // means that pointer ID is still "owned" by $touchpad. If not released,
    // fingers touching the keyboard will still fire events on the touchpad.
    for (const [id] of _ptrs) {
      try { $touchpad.releasePointerCapture(id); } catch (_) { }
    }
    _ptrs.clear();
    _resetSmoothing();
    // Also ensure keyboard sheet is fully interactive
    if (_kbdSheet) _kbdSheet.style.pointerEvents = '';

    _kbdSheet.getBoundingClientRect();  // force reflow so transition fires
    _kbdSheet.classList.add('visible');
    // Hide the ▲ toggle button
    const $t = document.getElementById('kbd-toggle-btn');

    if ($t) $t.style.display = 'none';
  }

  function _hideKeyboard() {
    if (!_kbdSheet || !_kbdVisible) return;
    _kbdVisible = false;
    _kbdSheet.classList.remove('visible');
    // Show the ▲ toggle button again
    const $t = document.getElementById('kbd-toggle-btn');
    if ($t) $t.style.display = '';
  }

  // ── Sensitivity slider (injected into panel) ──────────────────
  const $panel = document.getElementById('panel-touchpad');
  const $sliderRow = document.createElement('div');
  $sliderRow.style.cssText = 'display:flex;align-items:center;gap:10px;padding:4px 12px;padding-bottom:env(safe-area-inset-bottom,16px);font-size:12px;color:var(--text-muted);flex-shrink:0;';
  $sliderRow.innerHTML = `
    <span>🐢</span>
    <input type="range" id="sens-slider" min="1" max="6" step="0.5" value="${CFG.sensitivity}"
      style="flex:1;accent-color:var(--accent);cursor:pointer;">
    <span>🐇</span>
    <span id="sens-val" style="min-width:28px;text-align:right;">${CFG.sensitivity}×</span>
  `;
  $panel.appendChild($sliderRow);

  document.getElementById('sens-slider').addEventListener('input', function () {
    CFG.sensitivity = parseFloat(this.value);
    document.getElementById('sens-val').textContent = CFG.sensitivity + '×';
    // CRITICAL: Reset accumulators when sensitivity changes to prevent jitter
    // If user is dragging while adjusting slider, stale accumulated values at old
    // sensitivity multiplier would cause a sudden jump when new multiplier is applied.
    _resetSmoothing();
  });

  // ── Drag Lock (hold left-button for screenshot drag-select) ───
  // Shows a floating toggle button at the bottom-right of the touchpad.
  // ON: sends mouse_button {button:"left", pressed:true}  — cursor moves drag
  // OFF: sends mouse_button {button:"left", pressed:false} — releases
  // No auto-timeout: stays active until explicit release.

  function _setDragLock(active) {
    if (_dragLocked === active) return;
    _dragLocked = active;
    PocketDeck.send({ type: 'mouse_button', button: 'left', pressed: active });
    const $btn = document.getElementById('drag-lock-btn');
    if ($btn) {
      $btn.classList.toggle('active', active);
      $btn.textContent = active ? '🔒Drag' : '🖱 Drag';
    }
    if (active) {
      // Clear panel-switch inhibit instantly so user can drag right away
      _inhibitUntil = 0;
    }
  }

  // Build the drag-lock button and inject into the touchpad panel
  const $dragLockBtn = document.createElement('button');
  $dragLockBtn.id = 'drag-lock-btn';
  $dragLockBtn.className = 'drag-lock-btn';
  $dragLockBtn.textContent = '🖱 Drag';
  $dragLockBtn.setAttribute('aria-label', 'Drag Lock — hold left button for drag-select');
  $dragLockBtn.addEventListener('pointerdown', e => {
    e.preventDefault();
    e.stopPropagation();
    _setDragLock(!_dragLocked);
  });
  document.getElementById('panel-touchpad').appendChild($dragLockBtn);

  // ── Eagerly build the keyboard sheet so the ▲ toggle button ──
  // is present from the very first load. Without this, _buildSheet()
  // only runs on the first _showKeyboard() call — meaning the toggle
  // button doesn't exist until after the user has opened and dismissed
  // the keyboard at least once.
  _buildSheet();

  // ── Public API ────────────────────────────────────────────────
  window.TouchpadPanel = {
    reset() {
      if (_rafId !== null) { cancelAnimationFrame(_rafId); _rafId = null; }
      _ptrs.forEach((_, id) => { try { $touchpad.releasePointerCapture(id); } catch (_) { } });
      _ptrs.clear();
      _resetSmoothing();
      _gestureTriggered = false;
      _gestureStartPtrs = [];
      _sessionFirstTouch = true;   // ensures first touch after panel switch starts clean
      _hideKeyboard();
      // Release drag lock on panel switch (don't leave button held on PC)
      if (_dragLocked) _setDragLock(false);
      // Set inhibit for 200ms to absorb OS event burst after panel switch
      _inhibitUntil = Date.now() + 200;
      _lastActivityTime = Date.now();
    },
    /** Inhibit pointer-move sends for `ms` milliseconds. Absorbs OS event bursts. */
    inhibit(ms) {
      _inhibitUntil = Date.now() + ms;
      _lastActivityTime = Date.now();
    },
    showKeyboard:     _showKeyboard,
    hideKeyboard:     _hideKeyboard,
    /** Build the standard QWERTY sheet inside any container with custom callbacks */
    buildKeyboardDOM: _buildKeyboardDOM,
    KEY_MAP,
    ROWS,
  };

})();
