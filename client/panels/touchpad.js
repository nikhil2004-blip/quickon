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
  const $touchpad      = document.getElementById('touchpad');

  // ── Config ────────────────────────────────────────────────────
  const CFG = {
    sensitivity:     3.0,   // px multiplier — tuned for full HD coverage
    deadZonePx:      0.5,   // raw delta below this = ignore (kills micro-jitter)
    tapMaxMovePx:    12,    // max movement to count as a tap
    tapMaxMs:        300,   // max duration for a tap
    scrollRatio:     2.0,   // scroll sensitivity
    gestureMinPx:    30,    // minimum swipe distance to trigger a gesture
    gestureMaxMs:    500,   // maximum time for a swipe gesture
    // Velocity-adaptive filter (One Euro Filter principle):
    //   Small/slow movement  → low alpha (more smoothing, kills jitter)
    //   Large/fast movement  → high alpha (near raw, kills lag)
    alphaMin:        0.4,   // alpha for near-zero movement (max smoothing)
    alphaMax:        1.0,   // alpha for fast movement (no smoothing = no lag)
    speedThreshold:  12,    // px/event below which smoothing kicks in fully
  };

  // ── State ─────────────────────────────────────────────────────
  /** Map<pointerId, {x, y, startX, startY, startTime}> */
  const _ptrs = new Map();

  // Adaptive-filter state (x and y channels)
  let _filtX = null;
  let _filtY = null;

  // rAF accumulator
  let _accDx = 0;
  let _accDy = 0;
  let _rafId = null;

  // Scroll accumulator
  let _scrollAcc = 0;

  // Gesture tracking
  let _gestureStartPtrs = [];  // snapshot of pointers on the first multi-touch down
  let _gestureTriggered = false;

  // Timestamp of last pointermove — used to detect inactivity gaps
  let _lastMoveTime = 0;
  const INACTIVITY_RESET_MS = 120; // reset smoothing if no move for this long

  /** Nuke all smoothing/accumulator state — clean slate */
  function _resetSmoothing() {
    _filtX = null;
    _filtY = null;
    _accDx = 0;
    _accDy = 0;
    _scrollAcc = 0;
  }

  // ── rAF batch flush ───────────────────────────────────────────
  function _scheduleFlush() {
    if (_rafId !== null) return;
    _rafId = requestAnimationFrame(_flush);
  }

  function _flush() {
    _rafId = null;
    
    const sendDx = Math.round(_accDx);
    const sendDy = Math.round(_accDy);
    
    if (sendDx !== 0 || sendDy !== 0) {
      PocketDeck.send({ type: 'mouse_move', dx: sendDx, dy: sendDy });
      // Keep the fractional remainder! Losing this causes jagged circles.
      _accDx -= sendDx;
      _accDy -= sendDy;
    }
  }

  // ── Velocity-adaptive filter (One Euro Filter principle) ──────
  //
  // Fixed EMA has an unavoidable trade-off:
  //   Low alpha  → smooth but laggy on fast moves (big circles trail behind)
  //   High alpha → responsive but jittery on slow moves
  //
  // Solution: alpha scales with speed.
  //   Fast movement  → alpha near 1.0 → raw passthrough → zero lag
  //   Slow movement  → alpha near 0.4 → heavy smoothing → zero jitter
  //
  function _smooth(rawDx, rawDy) {
    const now = performance.now();

    // Fresh stroke after inactivity — wipe stale state entirely
    if (now - _lastMoveTime > INACTIVITY_RESET_MS) {
      _resetSmoothing();
    }
    _lastMoveTime = now;

    // Dead zone: ignore sub-pixel noise
    const dx = Math.abs(rawDx) < CFG.deadZonePx ? 0 : rawDx;
    const dy = Math.abs(rawDy) < CFG.deadZonePx ? 0 : rawDy;

    // Speed of this event (magnitude of delta vector)
    const speed = Math.sqrt(dx * dx + dy * dy);

    // Map speed → alpha: slow=alphaMin, fast=alphaMax (clamped)
    const t = Math.min(1, speed / CFG.speedThreshold);
    const alpha = CFG.alphaMin + t * (CFG.alphaMax - CFG.alphaMin);

    // Initialize filter state if starting fresh to prevent stickiness / startup lag
    if (_filtX === null || _filtY === null) {
      _filtX = dx;
      _filtY = dy;
    } else {
      // Apply adaptive filter
      _filtX = alpha * dx + (1 - alpha) * _filtX;
      _filtY = alpha * dy + (1 - alpha) * _filtY;
    }

    return {
      dx: _filtX * CFG.sensitivity,
      dy: _filtY * CFG.sensitivity,
    };
  }

  // ── Gesture helper ────────────────────────────────────────────
  function _triggerGesture(fingerCount, direction) {
    if (_gestureTriggered) return;
    _gestureTriggered = true;

    const gestures = {
      // 3-finger up intentionally omitted — phone OS intercepts it (screenshot)
      '3-down':  { type: 'key_tap', key: 'win+d' },           // Show desktop / minimize all
      '3-left':  { type: 'key_tap', key: 'alt+shift+tab' },   // Switch app backward
      '3-right': { type: 'key_tap', key: 'alt+tab' },         // Switch app forward
      // 4-finger: swipe direction = pan direction (like a real trackpad)
      // 4-finger: swipe direction = pan direction (like a real trackpad)
      // Swipe from right to left (LEFT swipe) pulls the RIGHT virtual desktop into view
      // Swipe from left to right (RIGHT swipe) pulls the LEFT virtual desktop into view
      '4-left':  { type: 'key_tap', key: 'win+ctrl+right' },  // Virtual desktop right
      '4-right': { type: 'key_tap', key: 'win+ctrl+left' },   // Virtual desktop left
      '4-up':    { type: 'key_tap', key: 'win+tab' },         // Task View
      '4-down':  { type: 'key_tap', key: 'win+d' },           // Show desktop
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
        background: 'rgba(99,102,241,0.85)',
        color: '#fff',
        fontSize: '18px',
        fontWeight: '700',
        padding: '12px 24px',
        borderRadius: '12px',
        pointerEvents: 'none',
        zIndex: '99',
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

    // ALWAYS reset smoothing on a fresh touch — this is the #1 jitter killer.
    // After any period of not touching, the EMA/accumulators must start clean.
    _resetSmoothing();

    _ptrs.set(e.pointerId, {
      id: e.pointerId,
      x: e.clientX, y: e.clientY,
      startX: e.clientX, startY: e.clientY,
      startTime: Date.now(),
    });

    // Reset gesture state when finger count changes
    if (_ptrs.size >= 2) {
      _gestureTriggered = false;
      _gestureStartPtrs = Array.from(_ptrs.values()).map(p => ({ ...p }));
    }
  }, { passive: false });

  $touchpad.addEventListener('pointermove', e => {
    e.preventDefault();
    const prev = _ptrs.get(e.pointerId);
    if (!prev) return;

    const rawDx = e.clientX - prev.x;
    const rawDy = e.clientY - prev.y;

    // Update stored position
    _ptrs.set(e.pointerId, { ...prev, x: e.clientX, y: e.clientY });

    const count = _ptrs.size;

    if (count === 1) {
      // Single finger → move mouse with EMA smoothing
      const { dx, dy } = _smooth(rawDx, rawDy);
      _accDx += dx;
      _accDy += dy;
      _scheduleFlush();

    } else if (count === 2) {
      // Two-finger drag → scroll
      _scrollAcc += rawDy;
      if (Math.abs(_scrollAcc) >= 3) {
        const clicks = Math.round(_scrollAcc / (3 / CFG.scrollRatio));
        // Positive dy = drag down = scroll content down (natural scrolling)
        PocketDeck.send({ type: 'mouse_scroll', dx: 0, dy: -clicks });
        _scrollAcc = 0;
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

    if (!info) return;

    const dt    = Date.now() - info.startTime;
    const moveX = Math.abs(e.clientX - info.startX);
    const moveY = Math.abs(e.clientY - info.startY);
    const isTap = dt < CFG.tapMaxMs && moveX < CFG.tapMaxMovePx && moveY < CFG.tapMaxMovePx;

    if (isTap && !_gestureTriggered) {
      const fingerCountAtTap = _ptrs.size + 1; // include the finger that just lifted
      if (fingerCountAtTap === 1) {
        // Could be a 2-finger tap — wait briefly before sending left click
        setTimeout(() => {
          if (_ptrs.size === 0 && !_gestureTriggered) {
            PocketDeck.send({ type: 'mouse_click', button: 'left' });
          }
        }, 80);
      } else if (fingerCountAtTap === 2) {
        // Two-finger tap → right click
        PocketDeck.send({ type: 'mouse_click', button: 'right' });
        _gestureTriggered = true; // prevent the delayed left click
      }
    }

    // Reset all smoothing state when all fingers lift
    if (_ptrs.size === 0) {
      _resetSmoothing();
      _gestureTriggered = false;
    }
  }, { passive: false });

  $touchpad.addEventListener('pointercancel', e => {
    _ptrs.delete(e.pointerId);
    if (_ptrs.size === 0) {
      _resetSmoothing();
      _gestureTriggered = false;
    }
  });

  // Prevent context menu on long press
  $touchpad.addEventListener('contextmenu', e => e.preventDefault());



  // ── Sensitivity slider (injected into panel) ──────────────────
  const $panel = document.getElementById('panel-touchpad');
  const $sliderRow = document.createElement('div');
  $sliderRow.style.cssText = 'display:flex;align-items:center;gap:10px;padding:4px 12px 0;font-size:12px;color:var(--text-muted);flex-shrink:0;';
  $sliderRow.innerHTML = `
    <span>🐢</span>
    <input type="range" id="sens-slider" min="1" max="6" step="0.5" value="${CFG.sensitivity}"
      style="flex:1;accent-color:var(--accent);cursor:pointer;">
    <span>🐇</span>
    <span id="sens-val" style="min-width:28px;text-align:right;">${CFG.sensitivity}×</span>
  `;
  $panel.appendChild($sliderRow);

  document.getElementById('sens-slider').addEventListener('input', function() {
    CFG.sensitivity = parseFloat(this.value);
    document.getElementById('sens-val').textContent = CFG.sensitivity + '×';
  });

})();
