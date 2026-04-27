/**
 * terminal.js — Phase 3/4
 * xterm.js integration.
 *
 * The keyboard sheet reuses the exact same QWERTY layout from TouchpadPanel.buildKeyboardDOM.
 * Key presses are routed as raw ANSI bytes via terminal_in (not as key_tap).
 */
'use strict';

(function TerminalPanelModule() {

  let term       = null;
  let fitAddon   = null;
  let _isInited  = false;

  // ── Raw byte sequences ─────────────────────────────────────────────────
  const TERM_KEYS = {
    'tab':       '\x09',
    'ctrl+c':    '\x03',
    'ctrl+d':    '\x04',
    'ctrl+z':    '\x1a',
    'ctrl+l':    '\x0c',
    'ctrl+a':    '\x01',
    'ctrl+e':    '\x05',
    'ctrl+u':    '\x15',
    'ctrl+k':    '\x0b',
    'ctrl+r':    '\x12',
    'ctrl+w':    '\x17',
    'esc':       '\x1b',
    'up':        '\x1b[A',
    'down':      '\x1b[B',
    'right':     '\x1b[C',
    'left':      '\x1b[D',
    'home':      '\x1b[H',
    'end':       '\x1b[F',
    'pgup':      '\x1b[5~',
    'pgdn':      '\x1b[6~',
    'delete':    '\x1b[3~',
    'backspace': '\x7f',
    'enter':     '\r',
    'f1':'\x1bOP','f2':'\x1bOQ','f3':'\x1bOR','f4':'\x1bOS',
    'f5':'\x1b[15~','f6':'\x1b[17~','f7':'\x1b[18~','f8':'\x1b[19~',
    'f9':'\x1b[20~','f10':'\x1b[21~','f11':'\x1b[23~','f12':'\x1b[24~',
  };

  function _sendRaw(bytes) {
    if (window.PocketDeck && window.PocketDeck.connected) {
      window.PocketDeck.send({ type: 'terminal_in', data: bytes });
    }
  }

  // ── Terminal keyboard bottom-sheet ─────────────────────────────────────
  let _termKbdVisible = false;
  let _termSheet      = null;
  // Modifier state (shared with _buildKeyboardDOM)
  const _termMods = { ctrl: false, alt: false, shift: false, win: false };

  /** Convert touchpad key-name + current mods → terminal raw bytes */
  function _termSendKey(key, mods) {
    // Build ctrl+key combo string for lookup
    let lookup = key;
    if (mods.ctrl && !key.startsWith('ctrl+')) lookup = 'ctrl+' + key;

    // Release all sticky mods after the keypress
    Object.keys(_termMods).forEach(m => {
      if (_termMods[m]) {
        _termMods[m] = false;
        if (_termSheet) {
          const btn = _termSheet.querySelector(`[data-mod="${m}"]`);
          if (btn) btn.classList.remove('active');
        }
      }
    });

    // 1. Direct ANSI lookup (covers arrows, ctrl+letter shortcuts, Esc, Enter, etc.)
    if (TERM_KEYS[lookup] !== undefined) { _sendRaw(TERM_KEYS[lookup]); return; }
    if (TERM_KEYS[key]    !== undefined) { _sendRaw(TERM_KEYS[key]);    return; }

    // 2. Ctrl + any letter → ASCII control character
    if (mods.ctrl && key.length === 1 && /[a-zA-Z]/.test(key)) {
      _sendRaw(String.fromCharCode(key.toUpperCase().charCodeAt(0) & 0x1f));
      return;
    }

    // 3. Printable character (shift capitalises)
    if (key === 'space') { _sendRaw(' ');  return; }
    if (key.length === 1) {
      _sendRaw(mods.shift ? key.toUpperCase() : key.toLowerCase());
      return;
    }
  }

  function _termToggleMod(mod, btn) {
    _termMods[mod] = !_termMods[mod];
    if (btn) btn.classList.toggle('active', _termMods[mod]);
  }

  function _showTermKbd() {
    if (!_termSheet) _buildKeyboardOverlay();
    if (_termKbdVisible) return;
    _termKbdVisible = true;
    _termSheet.getBoundingClientRect();   // force reflow → transition fires
    _termSheet.classList.add('visible');
    const $t = document.getElementById('term-kbd-toggle-btn');
    if ($t) $t.style.display = 'none';
    setTimeout(() => TerminalPanel.fit(), 300);
  }

  function _hideTermKbd() {
    if (!_termKbdVisible) return;
    _termKbdVisible = false;
    _termSheet.classList.remove('visible');
    const $t = document.getElementById('term-kbd-toggle-btn');
    if ($t) $t.style.display = '';
    setTimeout(() => TerminalPanel.fit(), 300);
  }

  function _buildKeyboardOverlay() {
    const panel = document.getElementById('panel-terminal');
    if (!panel || _termSheet) return;

    // Sheet container — reuses all .kbd-sheet CSS from style.css
    const sheet = document.createElement('div');
    sheet.id        = 'term-kbd-sheet';
    sheet.className = 'kbd-sheet';     // identical class → identical styling
    sheet.addEventListener('pointerdown', e => e.stopPropagation());
    panel.appendChild(sheet);
    _termSheet = sheet;

    // Build exact same QWERTY keyboard DOM as the touchpad
    // onSend = null → no Send button; every key goes to PTY immediately
    if (window.TouchpadPanel && window.TouchpadPanel.buildKeyboardDOM) {
      window.TouchpadPanel.buildKeyboardDOM(
        sheet,
        /* onKey */    (key, mods) => _termSendKey(key, mods),
        /* onDismiss */_hideTermKbd,
        /* onSend */   null,
        _termMods,
        /* toggleMod */(mod, btn)  => _termToggleMod(mod, btn),
      );
    }

    // ▲ toggle button (sits below the sheet when it's hidden)
    const $toggle = document.createElement('button');
    $toggle.id        = 'term-kbd-toggle-btn';
    $toggle.className = 'kbd-toggle-btn';
    $toggle.innerHTML = '▲';
    $toggle.setAttribute('aria-label', 'Show keyboard');
    $toggle.addEventListener('pointerdown', e => {
      e.preventDefault(); e.stopPropagation();
      _showTermKbd();
    });
    panel.appendChild($toggle);
  }

  // ── xterm.js init ──────────────────────────────────────────────────────
  function initTerminal() {
    if (_isInited) return;
    const container = document.getElementById('terminal-container');
    if (!container || !window.Terminal || !window.FitAddon) return;

    term = new window.Terminal({
      cursorBlink:  true,
      fontFamily:   '"Fira Code", "JetBrains Mono", monospace, "Courier New"',
      fontSize:     14,
      letterSpacing: 0,
      lineHeight:   1.2,
      theme: {
        background:  '#0d0d0d',
        foreground:  '#e8e8e8',
        cursor:      '#6366f1',
        selectionBackground: 'rgba(99,102,241,0.3)',
        black:   '#000000', brightBlack:   '#555555',
        red:     '#ff5f57', brightRed:     '#ff5f57',
        green:   '#57e389', brightGreen:   '#57e389',
        yellow:  '#f8f8a2', brightYellow:  '#f8f8a2',
        blue:    '#6c91ff', brightBlue:    '#6c91ff',
        magenta: '#c792ea', brightMagenta: '#c792ea',
        cyan:    '#89ddff', brightCyan:    '#89ddff',
        white:   '#e8e8e8', brightWhite:   '#ffffff',
      },
    });

    fitAddon = new window.FitAddon.FitAddon();
    term.loadAddon(fitAddon);
    term.open(container);

    // Forward typed characters to PTY
    term.onData(data => {
      if (window.PocketDeck && window.PocketDeck.connected) {
        window.PocketDeck.send({ type: 'terminal_in', data });
      }
    });

    window.addEventListener('resize', () => {
      if (document.getElementById('panel-terminal').classList.contains('active')) {
        TerminalPanel.fit();
      }
    });

    // ── Block Android IME triggered by xterm's internal textarea ───────────
    // xterm.js creates a hidden <textarea> for keyboard input. On Android,
    // any time that textarea receives focus, the system keyboard appears.
    // We: (a) set inputmode=none on it, (b) intercept any focusin on the
    // container and immediately re-blur without preventing xterm's internal use.
    setTimeout(() => {
      const xtermTextarea = container.querySelector('textarea');
      if (xtermTextarea) {
        xtermTextarea.setAttribute('inputmode', 'none');
        xtermTextarea.setAttribute('tabindex', '-1');
        // Blur on any focus so the Android keyboard never opens
        xtermTextarea.addEventListener('focus', () => xtermTextarea.blur());
      }
      // Also cover any future textareas xterm might create
      container.addEventListener('focusin', e => {
        if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') {
          e.target.setAttribute('inputmode', 'none');
          e.target.blur();
        }
      }, true);
    }, 100);

    // Build keyboard overlay (deferred so TouchpadPanel is guaranteed loaded)
    setTimeout(_buildKeyboardOverlay, 0);

    _isInited = true;
  }

  // ── Public API ─────────────────────────────────────────────────────────
  window.TerminalPanel = {
    write(data) {
      if (!_isInited) initTerminal();
      if (term) term.write(data);
    },
    fit() {
      if (!_isInited) initTerminal();
      if (fitAddon && term) {
        setTimeout(() => {
          fitAddon.fit();
          if (window.PocketDeck && window.PocketDeck.connected) {
            window.PocketDeck.send({
              type: 'terminal_resize',
              cols: term.cols,
              rows: term.rows,
            });
          }
        }, 10);
      }
    },
    showKeyboard: () => _showTermKbd(),
    hideKeyboard: () => _hideTermKbd(),
    /** Pause CPU-heavy background work (cursor blink) when panel is not visible */
    pause() {
      if (term) term.options.cursorBlink = false;
    },
    /** Resume cursor blink when panel becomes active again */
    resume() {
      if (term) term.options.cursorBlink = true;
    },
  };

  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(initTerminal, 100);
  });

})();
