/**
 * terminal.js — Phase 3
 * xterm.js integration, terminal_in/out messages
 */
'use strict';

let term = null;
let fitAddon = null;
let _isInitialized = false;

function initTerminal() {
  if (_isInitialized) return;
  const container = document.getElementById('terminal-container');
  if (!container || !window.Terminal || !window.FitAddon) return;

  term = new window.Terminal({
    cursorBlink: true,
    fontFamily: '"Fira Code", monospace, "Courier New", Courier',
    fontSize: 14,
    theme: {
      background: '#000000',
      foreground: '#ffffff'
    }
  });

  fitAddon = new window.FitAddon.FitAddon();
  term.loadAddon(fitAddon);
  term.open(container);

  term.onData((data) => {
    if (window.PocketDeck && window.PocketDeck.connected) {
      window.PocketDeck.send({ type: 'terminal_in', data: data });
    }
  });

  // Handle resize events
  window.addEventListener('resize', () => {
    if (document.getElementById('panel-terminal').classList.contains('active')) {
      TerminalPanel.fit();
    }
  });

  _isInitialized = true;
}

window.TerminalPanel = {
  write(data) {
    if (!_isInitialized) initTerminal();
    if (term) term.write(data);
  },
  fit() {
    if (!_isInitialized) initTerminal();
    if (fitAddon && term) {
      // Need to wrap in timeout sometimes to ensure DOM is updated before fit
      setTimeout(() => {
        fitAddon.fit();
        if (window.PocketDeck && window.PocketDeck.connected) {
          window.PocketDeck.send({
            type: 'terminal_resize',
            cols: term.cols,
            rows: term.rows
          });
        }
      }, 10);
    }
  },
};

// Auto-init if we can
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(initTerminal, 100);
});
