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
  const INACTIVITY_RESET_MS = 40; // reset smoothing after 40ms idle (was 120 — caused stutter on speed change)

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

    // Use truncation not rounding — rounding causes sign-flip jitter on slow moves.
    // e.g. acc=0.7 → round→1, remainder=-0.3 → next frame sends -1 → back-and-forth
    let sendDx = _accDx | 0;   // fast bitwise trunc (works for ±2^30)
    let sendDy = _accDy | 0;

    // Bias: if we have a sub-pixel remainder ≥0.5 that won't be sent, nudge it now
    // This prevents perpetual sub-pixel buildup when moving diagonally slowly.
    if (sendDx === 0 && Math.abs(_accDx) >= 0.5) sendDx = _accDx > 0 ? 1 : -1;
    if (sendDy === 0 && Math.abs(_accDy) >= 0.5) sendDy = _accDy > 0 ? 1 : -1;

    if (sendDx !== 0 || sendDy !== 0) {
      PocketDeck.send({ type: 'mouse_move', dx: sendDx, dy: sendDy });
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
      if (Math.abs(_scrollAcc) >= 5) {
        const clicks = Math.round(_scrollAcc / (5 / CFG.scrollRatio));
        PocketDeck.send({ type: 'mouse_scroll', dx: 0, dy: -clicks });
        _scrollAcc -= clicks * (5 / CFG.scrollRatio); // keep remainder instead of hard-reset
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
            // Show keyboard bottom sheet — same as native keyboard popup on tap
            _showKeyboard();
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
    ['1','2','3','4','5','6','7','8','9','0','-','=','⌫'],
    ['Q','W','E','R','T','Y','U','I','O','P','[',']'],
    ['A','S','D','F','G','H','J','K','L',';',"'",'\u21b5'],
    ['Z','X','C','V','B','N','M',',','.','/']
  ];

  function _sendKey(key) {
    const activeMods = Object.entries(_mods).filter(([,v])=>v).map(([k])=>k);
    const combo = activeMods.length ? [...activeMods, key].join('+') : key;
    PocketDeck.send({ type: 'key_tap', key: combo });
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

  function _buildSheet() {
    if (_kbdSheet) return;   // already built

    const sheet = document.createElement('div');
    sheet.id = 'kbd-sheet';
    sheet.className = 'kbd-sheet';

    // ── Handle bar (swipe down to dismiss) ─────────────────────
    const handle = document.createElement('div');
    handle.className = 'kbd-sheet-handle-row';
    handle.innerHTML = `
      <div class="kbd-sheet-handle"></div>
      <button class="kbd-sheet-close" id="kbd-sheet-close" aria-label="Hide keyboard">✕</button>
    `;
    sheet.appendChild(handle);

    // ── Bulk-type row ───────────────────────────────────────────
    const bulkRow = document.createElement('div');
    bulkRow.className = 'kbd-sheet-bulk';
    bulkRow.innerHTML = `
      <input type="text" id="kbd-sheet-text"
        placeholder="Type here and press Send…"
        autocomplete="off" autocorrect="off"
        autocapitalize="none" spellcheck="false" />
      <button class="kbd-sheet-send" id="kbd-sheet-send">Send</button>
    `;
    sheet.appendChild(bulkRow);

    // ── Modifier row ────────────────────────────────────────────
    const modRow = document.createElement('div');
    modRow.className = 'kbs-row';
    [
      ['Esc','esc',null], ['Ctrl',null,'ctrl'],
      ['Alt',null,'alt'], ['\u2756Win',null,'win'],
      ['Shift',null,'shift'], ['Tab','tab',null],
    ].forEach(([label, key, mod]) => {
      const btn = document.createElement('button');
      btn.className = 'kbs-key kbs-mod';
      btn.textContent = label;
      if (mod) {
        btn.id = `ks-mod-${mod}`;
        btn.addEventListener('pointerdown', e => {
          e.preventDefault(); e.stopPropagation();
          _toggleMod(mod);
        });
      } else {
        btn.addEventListener('pointerdown', e => {
          e.preventDefault(); e.stopPropagation();
          _sendKey(key);
        });
      }
      modRow.appendChild(btn);
    });
    sheet.appendChild(modRow);

    // ── QWERTY rows ─────────────────────────────────────────────
    ROWS.forEach(rowKeys => {
      const row = document.createElement('div');
      row.className = 'kbs-row';
      rowKeys.forEach(k => {
        const keyName = KEY_MAP[k] || k.toLowerCase();
        const isWide  = k === '⌫' || k === '↵';
        row.appendChild(_makeKey(k, keyName, `kbs-key${isWide ? ' kbs-wide' : ''}`));
      });
      sheet.appendChild(row);
    });

    // ── Bottom row: space + arrows ──────────────────────────────
    const bottomRow = document.createElement('div');
    bottomRow.className = 'kbs-row';
    const spaceBtn = document.createElement('button');
    spaceBtn.className = 'kbs-key kbs-space';
    spaceBtn.textContent = 'Space';
    spaceBtn.addEventListener('pointerdown', e => {
      e.preventDefault(); e.stopPropagation();
      _sendKey('space');
    });
    bottomRow.appendChild(spaceBtn);
    [['\u2190','left'],['\u2191','up'],['\u2193','down'],['\u2192','right']].forEach(([lbl,k]) => {
      const b = document.createElement('button');
      b.className = 'kbs-key kbs-arrow';
      b.textContent = lbl;
      b.addEventListener('pointerdown', e => {
        e.preventDefault(); e.stopPropagation();
        _sendKey(k);
      });
      bottomRow.appendChild(b);
    });
    sheet.appendChild(bottomRow);

    // ── Wire close/send ─────────────────────────────────────────
    // Close button
    handle.querySelector('#kbd-sheet-close').addEventListener('pointerdown', e => {
      e.preventDefault(); e.stopPropagation();
      _hideKeyboard();
    });

    // Bulk send
    bulkRow.querySelector('#kbd-sheet-send').addEventListener('pointerdown', e => {
      e.preventDefault(); e.stopPropagation();
      const input = bulkRow.querySelector('#kbd-sheet-text');
      if (input.value) {
        PocketDeck.send({ type: 'text_type', text: input.value });
        input.value = '';
      }
    });

    // ── Swipe-down-to-dismiss on handle ─────────────────────────
    let _swipeStartY = null;
    handle.addEventListener('pointerdown', e => {
      _swipeStartY = e.clientY;
      handle.setPointerCapture(e.pointerId);
    }, { passive: true });
    handle.addEventListener('pointermove', e => {
      if (_swipeStartY === null) return;
      const dy = e.clientY - _swipeStartY;
      if (dy > 0) sheet.style.transform = `translateY(${dy}px)`;
    }, { passive: true });
    handle.addEventListener('pointerup', e => {
      const dy = e.clientY - (_swipeStartY || e.clientY);
      _swipeStartY = null;
      sheet.style.transform = '';
      if (dy > 60) _hideKeyboard();
    }, { passive: true });

    // Stop touchpad pointer events from leaking into the sheet
    sheet.addEventListener('pointerdown', e => e.stopPropagation());

    document.getElementById('panel-touchpad').appendChild(sheet);
    _kbdSheet = sheet;
  }

  function _showKeyboard() {
    _buildSheet();   // no-op if already built
    if (_kbdVisible) return;
    _kbdVisible = true;
    // Force reflow before adding class so CSS transition fires
    _kbdSheet.getBoundingClientRect();
    _kbdSheet.classList.add('visible');
  }

  function _hideKeyboard() {
    if (!_kbdSheet || !_kbdVisible) return;
    _kbdVisible = false;
    _kbdSheet.classList.remove('visible');
  }

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

  // ── Public API ────────────────────────────────────────────────
  window.TouchpadPanel = {
    reset() {
      if (_rafId !== null) { cancelAnimationFrame(_rafId); _rafId = null; }
      _ptrs.forEach((_, id) => { try { $touchpad.releasePointerCapture(id); } catch (_) {} });
      _ptrs.clear();
      _resetSmoothing();
      _gestureTriggered = false;
      _gestureStartPtrs = [];
      _lastMoveTime     = 0;
      _hideKeyboard();
    },
    showKeyboard:  _showKeyboard,
    hideKeyboard:  _hideKeyboard,
  };

})();
