/**
 * media.js — Phase 6
 * Media control panel: play/pause, next, previous, volume up/down, mute.
 * Sends { type: 'media', action: '...' } messages.
 */
'use strict';

(function MediaPanel() {

  const BUTTONS = [
    { action: 'previous',   icon: '⏮',  label: 'Prev',     cls: 'media-btn media-side' },
    { action: 'play_pause', icon: '⏯',  label: 'Play/Pause', cls: 'media-btn media-center' },
    { action: 'next',       icon: '⏭',  label: 'Next',     cls: 'media-btn media-side' },
    { action: 'volume_down',icon: '🔉',  label: 'Vol −',    cls: 'media-btn media-vol' },
    { action: 'mute',       icon: '🔇',  label: 'Mute',     cls: 'media-btn media-vol' },
    { action: 'volume_up',  icon: '🔊',  label: 'Vol +',    cls: 'media-btn media-vol' },
  ];

  function _build() {
    const panel = document.getElementById('panel-media');
    if (!panel) return;

    panel.innerHTML = `
      <div class="media-wrap">
        <div class="media-label">Media Controls</div>
        <div class="media-row" id="media-transport"></div>
        <div class="media-row" id="media-volume"></div>
      </div>
    `;

    const transport = panel.querySelector('#media-transport');
    const volume    = panel.querySelector('#media-volume');

    BUTTONS.forEach(({ action, icon, label, cls }) => {
      const btn = document.createElement('button');
      btn.className = cls;
      btn.setAttribute('aria-label', label);
      btn.innerHTML = `<span class="media-icon">${icon}</span><span class="media-lbl">${label}</span>`;
      btn.addEventListener('pointerdown', e => {
        e.preventDefault();
        btn.classList.add('media-tap');
        setTimeout(() => btn.classList.remove('media-tap'), 200);
        PocketDeck.send({ type: 'media', action });
      });

      if (cls.includes('media-vol')) {
        volume.appendChild(btn);
      } else {
        transport.appendChild(btn);
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _build);
  } else {
    _build();
  }

  window.MediaPanel = {};
})();
