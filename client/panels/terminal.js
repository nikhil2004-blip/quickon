/**
 * terminal.js — Phase 3/4
 * xterm.js integration + laptop-style keyboard overlay for the terminal.
 *
 * The terminal keyboard overlay sends raw control bytes directly as
 * terminal_in messages (bypassing the global keyboard panel).
 * It's purpose-built for shell use: Tab autocomplete, Ctrl+C, arrows, etc.
 */
'use strict';

(function TerminalPanelModule() {

  let term       = null;
  let fitAddon   = null;
  let _isInited  = false;
  let _ctrlLatch = false;   // sticky Ctrl for terminal keyboard
  let _altLatch  = false;   // sticky Alt for terminal keyboard

  // ── Raw byte sequences ───────────────────────────────────────────
  const TERM_KEYS = {
    'tab':    '\x09',
    'ctrl+c': '\x03',
    'ctrl+d': '\x04',
    'ctrl+z': '\x1a',
    'ctrl+l': '\x0c',
    'ctrl+a': '\x01',
    'ctrl+e': '\x05',
    'ctrl+u': '\x15',
    'ctrl+k': '\x0b',
    'ctrl+r': '\x12',
    'ctrl+w': '\x17',
    'esc':    '\x1b',
    'up':     '\x1b[A',
    'down':   '\x1b[B',
    'right':  '\x1b[C',
    'left':   '\x1b[D',
    'home':   '\x1b[H',
    'end':    '\x1b[F',
    'pgup':   '\x1b[5~',
    'pgdn':   '\x1b[6~',
    'delete': '\x1b[3~',
    'backspace': '\x7f',
    'enter':  '\r',
    'f1':'\x1bOP','f2':'\x1bOQ','f3':'\x1bOR','f4':'\x1bOS',
    'f5':'\x1b[15~','f6':'\x1b[17~','f7':'\x1b[18~','f8':'\x1b[19~',
    'f9':'\x1b[20~','f10':'\x1b[21~','f11':'\x1b[23~','f12':'\x1b[24~',
  };

  function _sendRaw(bytes) {
    if (window.PocketDeck && window.PocketDeck.connected) {
      window.PocketDeck.send({ type: 'terminal_in', data: bytes });
    }
  }

  // ── Build the laptop keyboard overlay ───────────────────────────
  function _buildKeyboardOverlay() {
    const panel = document.getElementById('panel-terminal');
    if (!panel) return;

    // Keyboard toggle button (floating)
    const toggleBtn = document.createElement('button');
    toggleBtn.id = 'term-kbd-toggle';
    toggleBtn.className = 'term-kbd-toggle';
    toggleBtn.innerHTML = '⌨';
    toggleBtn.setAttribute('aria-label', 'Toggle terminal keyboard');
    panel.appendChild(toggleBtn);

    // Keyboard overlay
    const kbdOverlay = document.createElement('div');
    kbdOverlay.id = 'term-kbd';
    kbdOverlay.className = 'term-kbd hidden';
    kbdOverlay.innerHTML = _buildKbdHTML();
    panel.appendChild(kbdOverlay);

    toggleBtn.addEventListener('pointerdown', e => {
      e.preventDefault();
      kbdOverlay.classList.toggle('hidden');
      toggleBtn.classList.toggle('active');
      // Refit terminal after keyboard shown/hidden
      setTimeout(() => TerminalPanel.fit(), 50);
    });

    _wireKbdEvents(kbdOverlay);
  }

  function _buildKbdHTML() {
    return `
      <!-- Row 0: F-keys scrollable -->
      <div class="tkbd-frow">
        <button class="tkey tkey-fn" data-key="esc">Esc</button>
        <button class="tkey tkey-fn" data-key="f1">F1</button>
        <button class="tkey tkey-fn" data-key="f2">F2</button>
        <button class="tkey tkey-fn" data-key="f3">F3</button>
        <button class="tkey tkey-fn" data-key="f4">F4</button>
        <button class="tkey tkey-fn" data-key="f5">F5</button>
        <button class="tkey tkey-fn" data-key="f6">F6</button>
        <button class="tkey tkey-fn" data-key="f7">F7</button>
        <button class="tkey tkey-fn" data-key="f8">F8</button>
        <button class="tkey tkey-fn" data-key="f9">F9</button>
        <button class="tkey tkey-fn" data-key="f10">F10</button>
        <button class="tkey tkey-fn" data-key="f11">F11</button>
        <button class="tkey tkey-fn" data-key="f12">F12</button>
      </div>

      <!-- Row 1: main number/nav row -->
      <div class="tkbd-row">
        <button class="tkey tkey-nav" data-key="tab">Tab⇥</button>
        <button class="tkey tkey-nav" data-key="home">Home</button>
        <button class="tkey tkey-nav" data-key="end">End</button>
        <button class="tkey tkey-nav" data-key="pgup">PgUp</button>
        <button class="tkey tkey-nav" data-key="pgdn">PgDn</button>
        <button class="tkey tkey-nav" data-key="delete">Del</button>
        <button class="tkey tkey-wide" data-key="backspace">⌫ Bksp</button>
      </div>

      <!-- Row 2: control shortcuts -->
      <div class="tkbd-row">
        <button class="tkey tkey-ctrl-latch" id="term-ctrl-latch">Ctrl</button>
        <button class="tkey tkey-ctrl" data-key="ctrl+c">^C</button>
        <button class="tkey tkey-ctrl" data-key="ctrl+d">^D</button>
        <button class="tkey tkey-ctrl" data-key="ctrl+z">^Z</button>
        <button class="tkey tkey-ctrl" data-key="ctrl+l">^L</button>
        <button class="tkey tkey-ctrl" data-key="ctrl+r">^R</button>
        <button class="tkey tkey-ctrl" data-key="ctrl+a">^A</button>
        <button class="tkey tkey-ctrl" data-key="ctrl+e">^E</button>
        <button class="tkey tkey-ctrl" data-key="ctrl+u">^U</button>
        <button class="tkey tkey-ctrl" data-key="ctrl+k">^K</button>
        <button class="tkey tkey-ctrl" data-key="ctrl+w">^W</button>
      </div>

      <!-- Row 3: arrows + enter -->
      <div class="tkbd-row tkbd-arrow-row">
        <button class="tkey tkey-space" data-raw=" "> Space</button>
        <button class="tkey tkey-arrow" data-key="left">◀</button>
        <button class="tkey tkey-arrow" data-key="up">▲</button>
        <button class="tkey tkey-arrow" data-key="down">▼</button>
        <button class="tkey tkey-arrow" data-key="right">▶</button>
        <button class="tkey tkey-wide tkey-enter" data-key="enter">Enter ↵</button>
      </div>
    `;
  }

  function _wireKbdEvents(kbdEl) {
    // Sticky Ctrl latch button
    const ctrlLatch = kbdEl.querySelector('#term-ctrl-latch');
    if (ctrlLatch) {
      ctrlLatch.addEventListener('pointerdown', e => {
        e.preventDefault();
        _ctrlLatch = !_ctrlLatch;
        ctrlLatch.classList.toggle('active', _ctrlLatch);
      });
    }

    // All other keys
    kbdEl.querySelectorAll('[data-key]').forEach(btn => {
      btn.addEventListener('pointerdown', e => {
        e.preventDefault();
        let key = btn.dataset.key;

        // If Ctrl is latched and key is a letter, compose
        if (_ctrlLatch && key.length === 1) {
          const code = key.charCodeAt(0) & 0x1f;
          _sendRaw(String.fromCharCode(code));
          _ctrlLatch = false;
          if (ctrlLatch) ctrlLatch.classList.remove('active');
          return;
        }

        // If Ctrl is latched and key is a named key, build ctrl+ combo
        if (_ctrlLatch && !key.startsWith('ctrl+')) {
          key = 'ctrl+' + key;
          _ctrlLatch = false;
          if (ctrlLatch) ctrlLatch.classList.remove('active');
        }

        const bytes = TERM_KEYS[key];
        if (bytes !== undefined) {
          _sendRaw(bytes);
        } else {
          // Fallback: send literal character
          _sendRaw(key);
        }
      });
    });

    // Raw data keys (space etc.)
    kbdEl.querySelectorAll('[data-raw]').forEach(btn => {
      btn.addEventListener('pointerdown', e => {
        e.preventDefault();
        _sendRaw(btn.dataset.raw);
      });
    });
  }

  // ── xterm.js init ────────────────────────────────────────────────
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

    // Build keyboard overlay after terminal is ready
    _buildKeyboardOverlay();

    _isInited = true;
  }

  // ── Public API ───────────────────────────────────────────────────
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
  };

  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(initTerminal, 100);
  });

})();
