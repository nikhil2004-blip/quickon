/**
 * app.js — WebSocket client, panel router, connection management
 *
 * Responsibilities:
 *  - Derive WebSocket host from current page URL (auto-config after QR scan)
 *  - Manage connection lifecycle with exponential-backoff reconnect
 *  - Authenticate with token (auto-submit if stored in localStorage)
 *  - Route incoming server messages to the appropriate panel
 *  - Expose a global `PocketDeck.send(msg)` for panel modules to use
 */

'use strict';

// ── Constants ────────────────────────────────────────────────
const WS_PORT   = 8765;
const WS_PROTO  = 'ws:';   // LAN only — no TLS

// Exponential backoff reconnect: 500ms → 1s → 2s → 4s → 8s → cap 10s
const BACKOFF_INIT = 500;
const BACKOFF_MAX  = 10_000;

const STORAGE_HOST  = 'pd_host';
const STORAGE_TOKEN = 'pd_token';

// ── State ─────────────────────────────────────────────────────
let _ws       = null;
let _wsReady  = false;
let _token    = '';
let _host     = '';
let _backoff  = BACKOFF_INIT;
let _reconnectTimer = null;

// ── DOM refs ──────────────────────────────────────────────────
const $connectScreen = document.getElementById('connect-screen');
const $appScreen     = document.getElementById('app-screen');
const $connectLabel  = document.getElementById('connect-label');
const $connectStatus = document.getElementById('connect-status');
const $hostInput     = document.getElementById('host-input');
const $tokenInput    = document.getElementById('token-input');
const $connectBtn    = document.getElementById('connect-btn');
const $wsDot         = document.getElementById('ws-dot');
const $wsLabel       = document.getElementById('ws-label');

// ── Public API (panels call this to send messages) ────────────
const PocketDeck = {
  send(msg) {
    if (!(_ws && _wsReady && _ws.readyState === WebSocket.OPEN)) {
      return false;   // silently drop — avoid queuing
    }

    // Backpressure guard: drop mouse_move only if the socket is severely congested.
    // With immediate sends the buffer drains fast; 16 KB = ~240 queued moves.
    if (msg.type === 'mouse_move' && _ws.bufferedAmount > 16384) {
      return false;
    }

    _ws.send(JSON.stringify(msg));
    return true;
  },
  get connected() { return _wsReady; },
};
window.PocketDeck = PocketDeck;


// ── Panel routing ─────────────────────────────────────────────
const _panelHandlers = {
  auth_ok:     _onAuthOk,
  auth_fail:   _onAuthFail,
  server_info: _onServerInfo,
  widget_list: _onWidgetList,
  terminal_out: _onTerminalOut,
};

// ── Determine host from URL ───────────────────────────────────
function _deriveHostFromUrl() {
  // When loaded via QR → http://192.168.1.x:8766/
  // We connect to ws://192.168.1.x:8765
  return window.location.hostname;
}

// ── Connect ───────────────────────────────────────────────────
function connect(host, token) {
  if (_ws) {
    _ws.onclose = null;  // prevent reconnect loop from firing
    _ws.close();
    _ws = null;
  }

  _host  = host  || _deriveHostFromUrl() || localStorage.getItem(STORAGE_HOST) || '';
  _token = token || localStorage.getItem(STORAGE_TOKEN) || '';
  _wsReady = false;

  if (!_host) {
    _setConnectStatus('error', 'No host — enter your PC\'s IP address');
    return;
  }

  const url = `${WS_PROTO}//${_host}:${WS_PORT}`;
  _setConnectStatus('connecting', `Connecting to ${_host}…`);

  try {
    _ws = new WebSocket(url);
  } catch (e) {
    _setConnectStatus('error', `Invalid address: ${e.message}`);
    return;
  }

  _ws.onopen = _onOpen;
  _ws.onmessage = _onMessage;
  _ws.onclose   = _onClose;
  _ws.onerror   = _onError;
}

function _onOpen() {
  _backoff = BACKOFF_INIT;   // reset on successful connection
  _setConnectStatus('connecting', 'Authenticating…');
  // Immediately send auth
  _ws.send(JSON.stringify({ type: 'auth', token: _token }));
}

function _onMessage(event) {
  let msg;
  try { msg = JSON.parse(event.data); }
  catch { return; }

  const handler = _panelHandlers[msg.type];
  if (handler) handler(msg);
}

function _onClose(event) {
  _wsReady = false;
  _updateAppIndicator(false);

  if (event.code === 4003) {
    // Bad token — don't retry automatically
    _setConnectStatus('error', 'Wrong token — check your PC terminal');
    _showConnectScreen();
    return;
  }

  if (event.code === 4001) {
    _setConnectStatus('error', 'Auth timeout — try again');
    _showConnectScreen();
    return;
  }

  // Auto-reconnect with backoff for other disconnections
  const delay = _backoff;
  _backoff = Math.min(_backoff * 2, BACKOFF_MAX);
  _setConnectStatus('connecting', `Reconnecting in ${(delay/1000).toFixed(1)}s…`);

  if (_reconnectTimer) clearTimeout(_reconnectTimer);
  _reconnectTimer = setTimeout(() => connect(_host, _token), delay);
}

function _onError() {
  // onClose will fire right after — handle everything there
}

// ── Message handlers ──────────────────────────────────────────
function _onAuthOk() {
  _wsReady = true;
  // Save successful credentials
  localStorage.setItem(STORAGE_HOST,  _host);
  localStorage.setItem(STORAGE_TOKEN, _token);
  _showAppScreen();
  _updateAppIndicator(true);
  console.log('[PocketDeck] Authenticated and connected ✓');
}

function _onAuthFail() {
  _wsReady = false;
  _setConnectStatus('error', 'Wrong auth token — check your PC terminal');
  _showConnectScreen();
}

function _onServerInfo(msg) {
  document.title = `PocketDeck — ${msg.hostname || 'PC'}`;
}

function _onWidgetList(msg) {
  if (window.WidgetPanel && typeof window.WidgetPanel.render === 'function') {
    window.WidgetPanel.render(msg.widgets || []);
  }
}

function _onTerminalOut(msg) {
  if (window.TerminalPanel && typeof window.TerminalPanel.write === 'function') {
    window.TerminalPanel.write(msg.data || '');
  }
}

// ── UI helpers ────────────────────────────────────────────────
function _setConnectStatus(state, label) {
  $connectStatus.className = `status-pill status-${state === 'connecting' ? 'connecting' : state === 'ok' ? 'ok' : 'error'}`;
  $connectLabel.textContent = label;
}

function _showConnectScreen() {
  $connectScreen.classList.add('active');
  $appScreen.classList.remove('active');
}

function _showAppScreen() {
  $appScreen.classList.add('active');
  $connectScreen.classList.remove('active');
}

function _updateAppIndicator(online) {
  if (online) {
    $wsDot.classList.remove('disconnected');
    $wsLabel.textContent = 'Connected';
  } else {
    $wsDot.classList.add('disconnected');
    $wsLabel.textContent = 'Reconnecting…';
  }
}

// ── Panel tab switching ──────────────────────────────────────────────
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    const panelId = tab.dataset.panel;

    // Track which panel we're leaving
    const leavingPanel = document.querySelector('.tab.active')?.dataset.panel;

    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));

    tab.classList.add('active');
    const panel = document.getElementById(`panel-${panelId}`);
    if (panel) panel.classList.add('active');

    // ── Switching AWAY from terminal: aggressively quiesce xterm ─
    // xterm.js runs a setInterval cursor-blink timer that fires every ~500ms
    // regardless of whether the panel is visible. On Android this is enough
    // to cause periodic jank on the touchpad. Disabling cursorBlink stops it.
    if (leavingPanel === 'terminal') {
      const termContainer = document.getElementById('terminal-container');
      if (termContainer) {
        const focused = termContainer.querySelector(':focus');
        if (focused) focused.blur();
      }
      // Pause xterm cursor-blink timer (the #1 background CPU consumer)
      if (window.TerminalPanel && TerminalPanel.pause) TerminalPanel.pause();
    }

    // ── Switching TO terminal: refit + resume cursor blink ───────
    if (panelId === 'terminal' && window.TerminalPanel) {
      if (TerminalPanel.resume) TerminalPanel.resume();
      if (TerminalPanel.fit)    TerminalPanel.fit();
    }

    // ── Switching AWAY from touchpad: clean up any ghost state ───
    if (leavingPanel === 'touchpad' && window.TouchpadPanel && TouchpadPanel.reset) {
      TouchpadPanel.reset();
    }

    // ── Switching TO touchpad: hard-reset + 350ms input inhibit ──
    // Widget launch takes ~200-400ms on Windows; the OS queues any
    // pointer events that fired during that window and dumps them all
    // at once when the event loop drains. The inhibit absorbs that burst.
    if (panelId === 'touchpad' && window.TouchpadPanel) {
      if (TouchpadPanel.reset) TouchpadPanel.reset();
      if (TouchpadPanel.inhibit) TouchpadPanel.inhibit(350);
    }
  });
});

// ── Manual connect button ─────────────────────────────────────
$connectBtn.addEventListener('click', () => {
  const host  = $hostInput.value.trim();
  const token = $tokenInput.value.trim();
  if (!host)  { $hostInput.focus(); return; }
  if (!token) { $tokenInput.focus(); return; }
  connect(host, token);
});

[$hostInput, $tokenInput].forEach(el => {
  el.addEventListener('keydown', e => {
    if (e.key === 'Enter') $connectBtn.click();
  });
});

// ── iOS visibility resume ─────────────────────────────────────
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !_wsReady) {
    // Page became visible again (e.g., screen unlock) — try reconnecting now
    if (_reconnectTimer) clearTimeout(_reconnectTimer);
    connect(_host, _token);
  }
});

// ── Boot ──────────────────────────────────────────────────────
(function boot() {
  const savedHost  = localStorage.getItem(STORAGE_HOST)  || _deriveHostFromUrl();
  const savedToken = localStorage.getItem(STORAGE_TOKEN) || '';

  // Pre-fill inputs for manual entry
  if (savedHost)  $hostInput.value  = savedHost;
  if (savedToken) $tokenInput.value = savedToken;

  if (savedHost && savedToken) {
    // Auto-connect
    connect(savedHost, savedToken);
  } else if (savedHost && !savedToken) {
    _setConnectStatus('error', 'Enter auth token to connect');
  } else {
    _setConnectStatus('error', 'Enter your PC\'s IP address');
  }
})();
