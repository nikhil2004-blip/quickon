/**
 * widgets.js — Phase 5
 * Receives widget_list from server and renders a touch-friendly grid.
 * Sends widget_run on tap.
 */
'use strict';

(function WidgetsPanel() {

  function render(widgets) {
    const grid = document.getElementById('widgets-grid');
    if (!grid) return;
    grid.innerHTML = '';

    if (!widgets || widgets.length === 0) {
      grid.innerHTML = `
        <div class="widget-empty">
          <span>⚡</span>
          <p>No widgets configured.</p>
          <small>Edit <code>widgets.yaml</code> on your PC and restart the server.</small>
        </div>`;
      return;
    }

    widgets.forEach(w => {
      const btn = document.createElement('button');
      btn.className = 'widget-btn';
      btn.style.setProperty('--widget-color', w.color || '#4f46e5');
      btn.innerHTML = `
        <span class="widget-icon">${w.icon || '⚡'}</span>
        <span class="widget-label">${_esc(w.label || w.id)}</span>
      `;
      btn.addEventListener('pointerdown', e => {
        e.preventDefault();
        // Ripple effect
        btn.classList.add('widget-tap');
        setTimeout(() => btn.classList.remove('widget-tap'), 300);
        PocketDeck.send({ type: 'widget_run', id: w.id });
      });
      grid.appendChild(btn);
    });
  }

  function _esc(str) {
    return String(str).replace(/[&<>"']/g, c => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }[c]));
  }

  window.WidgetPanel = { render };
})();
