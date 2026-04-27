"""
Patch touchpad.js: replace _buildSheet with _buildKeyboardDOM + lean _buildSheet,
then expose _buildKeyboardDOM on the public API.
"""

NEW_SECTION = r"""  /**
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

"""

with open(r'c:\Users\Nikhil Kumar Yadav\Desktop\projects\quickcon\client\panels\touchpad.js', 'r', encoding='utf-8') as f:
    content = f.read()

bs_start  = content.find('  function _buildSheet()')
show_start = content.find('  function _showKeyboard()')
old_section = content[bs_start:show_start]

new_content = content.replace(old_section, NEW_SECTION, 1)

# Also expose _buildKeyboardDOM in the public API
old_api = """  window.TouchpadPanel = {
    reset() {
      if (_rafId !== null) { cancelAnimationFrame(_rafId); _rafId = null; }
      _ptrs.forEach((_, id) => { try { $touchpad.releasePointerCapture(id); } catch (_) { } });
      _ptrs.clear();
      _resetSmoothing();
      _gestureTriggered = false;
      _gestureStartPtrs = [];
      _lastMoveTime = 0;
      _hideKeyboard();
    },
    showKeyboard: _showKeyboard,
    hideKeyboard: _hideKeyboard,
  };"""

new_api = """  window.TouchpadPanel = {
    reset() {
      if (_rafId !== null) { cancelAnimationFrame(_rafId); _rafId = null; }
      _ptrs.forEach((_, id) => { try { $touchpad.releasePointerCapture(id); } catch (_) { } });
      _ptrs.clear();
      _resetSmoothing();
      _gestureTriggered = false;
      _gestureStartPtrs = [];
      _lastMoveTime = 0;
      _hideKeyboard();
    },
    showKeyboard:     _showKeyboard,
    hideKeyboard:     _hideKeyboard,
    /** Build the standard QWERTY sheet inside any container with custom callbacks */
    buildKeyboardDOM: _buildKeyboardDOM,
    KEY_MAP,
    ROWS,
  };"""

new_content = new_content.replace(old_api, new_api, 1)

with open(r'c:\Users\Nikhil Kumar Yadav\Desktop\projects\quickcon\client\panels\touchpad.js', 'w', encoding='utf-8') as f:
    f.write(new_content)

print('Done. Characters written:', len(new_content))
