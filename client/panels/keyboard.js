/**
 * keyboard.js — Phase 2
 * Full QWERTY keyboard panel with sticky modifier keys.
 *
 * Features:
 *  - Standard QWERTY layout
 *  - Modifier row: Esc, Tab, Ctrl, Alt, Win, Shift
 *  - Scrollable F1-F12 function key row
 *  - Sticky modifiers (tap to latch, next key sends combo, auto-release)
 *  - Arrow keys
 *  - Bulk-type text field
 */
'use strict';

(function KeyboardPanel() {

  // ── Sticky modifier state ──────────────────────────────────────
  const _mods = { ctrl: false, alt: false, shift: false, win: false };

  function _toggleMod(name) {
    _mods[name] = !_mods[name];
    const btn = document.getElementById(`kmod-${name}`);
    if (btn) btn.classList.toggle('active', _mods[name]);
  }

  function _getActiveModifiers() {
    return Object.entries(_mods).filter(([, v]) => v).map(([k]) => k);
  }

  function _clearMods() {
    Object.keys(_mods).forEach(k => {
      _mods[k] = false;
      const btn = document.getElementById(`kmod-${k}`);
      if (btn) btn.classList.remove('active');
    });
  }

  function _sendKey(key) {
    const mods = _getActiveModifiers();
    const combo = mods.length ? [...mods, key].join('+') : key;
    PocketDeck.send({ type: 'key_tap', key: combo });
    _clearMods();
  }

  // ── Key layout definition ──────────────────────────────────────
  const ROWS = [
    // Row 0: numbers
    ['`','1','2','3','4','5','6','7','8','9','0','-','=','⌫'],
    // Row 1: QWERTY
    ['Q','W','E','R','T','Y','U','I','O','P','[',']','\\'],
    // Row 2: ASDF + Enter
    ['A','S','D','F','G','H','J','K','L',';',"'",'↵'],
    // Row 3: ZXCV
    ['Z','X','C','V','B','N','M',',','.','/'],
  ];

  const KEY_MAP = {
    '⌫': 'backspace',
    '↵': 'enter',
    '⏎': 'enter',
    ' ': 'space',
  };

  // ── Build keyboard HTML ────────────────────────────────────────
  function _buildKeyboard() {
    const panel = document.getElementById('panel-keyboard');
    if (!panel) return;
    panel.innerHTML = '';

    // Bulk-type area
    const bulkWrap = document.createElement('div');
    bulkWrap.className = 'kbd-bulk';
    bulkWrap.innerHTML = `
      <textarea id="kbd-bulk-text" placeholder="Type a long message and tap Send…" rows="2"></textarea>
      <button id="kbd-bulk-send" class="kbd-bulk-btn">Send</button>
    `;
    panel.appendChild(bulkWrap);

    // F-key row (horizontally scrollable)
    const fRow = document.createElement('div');
    fRow.className = 'kbd-row kbd-frow';
    for (let i = 1; i <= 12; i++) {
      fRow.appendChild(_makeKey(`F${i}`, `f${i}`, 'kbd-key kbd-fn'));
    }
    panel.appendChild(fRow);

    // Modifier row
    const modRow = document.createElement('div');
    modRow.className = 'kbd-row kbd-modrow';
    const modDefs = [
      { label: 'Esc',   key: 'esc',   mod: null },
      { label: 'Ctrl',  key: null,    mod: 'ctrl' },
      { label: 'Alt',   key: null,    mod: 'alt' },
      { label: '⊞ Win', key: null,    mod: 'win' },
      { label: 'Shift', key: null,    mod: 'shift' },
      { label: 'Tab',   key: 'tab',   mod: null },
    ];
    modDefs.forEach(({ label, key, mod }) => {
      const btn = document.createElement('button');
      btn.className = 'kbd-key kbd-mod';
      btn.textContent = label;
      if (mod) {
        btn.id = `kmod-${mod}`;
        btn.addEventListener('pointerdown', e => {
          e.preventDefault();
          _toggleMod(mod);
        });
      } else {
        btn.addEventListener('pointerdown', e => {
          e.preventDefault();
          _sendKey(key);
        });
      }
      modRow.appendChild(btn);
    });
    panel.appendChild(modRow);

    // Main QWERTY rows
    ROWS.forEach(rowKeys => {
      const row = document.createElement('div');
      row.className = 'kbd-row';
      rowKeys.forEach(k => {
        const keyName = KEY_MAP[k] || k.toLowerCase();
        const isWide = k === '⌫' || k === '↵';
        const cls = `kbd-key${isWide ? ' kbd-wide' : ''}`;
        row.appendChild(_makeKey(k, keyName, cls));
      });
      panel.appendChild(row);
    });

    // Space + arrow row
    const bottomRow = document.createElement('div');
    bottomRow.className = 'kbd-row';
    const spaceBtn = document.createElement('button');
    spaceBtn.className = 'kbd-key kbd-space';
    spaceBtn.textContent = 'Space';
    spaceBtn.addEventListener('pointerdown', e => { e.preventDefault(); _sendKey('space'); });
    bottomRow.appendChild(spaceBtn);

    [['←','left'],['↑','up'],['↓','down'],['→','right']].forEach(([label, key]) => {
      bottomRow.appendChild(_makeKey(label, key, 'kbd-key kbd-arrow'));
    });
    panel.appendChild(bottomRow);

    // Wire bulk-send
    document.getElementById('kbd-bulk-send').addEventListener('click', () => {
      const text = document.getElementById('kbd-bulk-text').value;
      if (text) {
        PocketDeck.send({ type: 'text_type', text });
        document.getElementById('kbd-bulk-text').value = '';
      }
    });
  }

  function _makeKey(label, keyName, cls) {
    const btn = document.createElement('button');
    btn.className = cls;
    btn.textContent = label;
    btn.addEventListener('pointerdown', e => {
      e.preventDefault();
      _sendKey(keyName);
    });
    return btn;
  }

  // ── Init ───────────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _buildKeyboard);
  } else {
    _buildKeyboard();
  }

  window.KeyboardPanel = { rebuild: _buildKeyboard };
})();
