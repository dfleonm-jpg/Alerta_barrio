/* ============================================================================
   Alerta Barrio — UI compartida (ui.js)
   • Toasts (avisos animados) reutilizables:  AlertaUI.toast('Mensaje', {type})
   • Modo oscuro persistente:                 AlertaUI.initTheme(), toggleTheme()
   Sin dependencias. Cárgalo en todas las páginas antes de los demás scripts.
   ========================================================================== */
(function (global) {
  'use strict';
  const THEME_KEY = 'alertaBarrio.theme';

  // Aplica el tema guardado lo antes posible para evitar parpadeo.
  function applySavedTheme() {
    try {
      let t = localStorage.getItem(THEME_KEY);
      if (!t) t = (global.matchMedia && global.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', t);
      return t;
    } catch (e) { return 'light'; }
  }

  const AlertaUI = {
    _wrap: null,

    initTheme() {
      const t = applySavedTheme();
      // Conecta cualquier botón con [data-theme-toggle]
      document.querySelectorAll('[data-theme-toggle]').forEach(btn => {
        this._syncToggle(btn, t);
        btn.addEventListener('click', () => this.toggleTheme());
      });
      return t;
    },
    toggleTheme() {
      const cur = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
      const next = cur === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      try { localStorage.setItem(THEME_KEY, next); } catch (e) {}
      document.querySelectorAll('[data-theme-toggle]').forEach(b => this._syncToggle(b, next));
      this.toast(next === 'dark' ? 'Modo oscuro activado' : 'Modo claro activado', { type: 'info', em: next === 'dark' ? '🌙' : '☀️', small: true });
    },
    _syncToggle(btn, theme) {
      const dark = theme === 'dark';
      btn.textContent = dark ? '☀️' : '🌙';
      btn.setAttribute('aria-label', dark ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro');
      btn.setAttribute('title', dark ? 'Modo claro' : 'Modo oscuro');
    },

    _ensureWrap() {
      if (this._wrap) return this._wrap;
      let w = document.querySelector('.toast-wrap');
      if (!w) { w = document.createElement('div'); w.className = 'toast-wrap'; w.setAttribute('aria-live', 'polite'); document.body.appendChild(w); }
      this._wrap = w; return w;
    },
    // toast(msg, { type:'ok'|'err'|'info', title, em, duration, small })
    toast(msg, opts) {
      opts = opts || {};
      const wrap = this._ensureWrap();
      const el = document.createElement('div');
      el.className = 'toast ' + (opts.type || 'info');
      el.setAttribute('role', 'status');
      const em = opts.em || ({ ok: '✅', err: '⛔', info: 'ℹ️' }[opts.type] || 'ℹ️');
      const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      el.innerHTML =
        `<span class="t-em">${em}</span><div class="t-body">` +
        (opts.title ? `<div class="t-title">${esc(opts.title)}</div>` : '') +
        `<div class="${opts.title ? 't-msg' : 't-title'}">${esc(msg)}</div></div>`;
      wrap.appendChild(el);
      const dur = opts.duration || (opts.small ? 2200 : 3600);
      const kill = () => { el.classList.add('out'); setTimeout(() => el.remove(), 260); };
      const timer = setTimeout(kill, dur);
      el.addEventListener('click', () => { clearTimeout(timer); kill(); });
      return el;
    },

    // Indicador del estado del backend (nube / local). Escucha el evento
    // 'alerta:backend' que emite firebase-init.js.
    _badge: null,
    initBackendBadge() {
      if (this._badge) return;
      const b = document.createElement('div');
      b.className = 'backend-badge connecting';
      b.setAttribute('role', 'status');
      b.innerHTML = '<span class="bb-dot"></span><span class="bb-text">Conectando…</span>';
      document.body.appendChild(b);
      this._badge = b;
      const states = {
        connecting: { cls: 'connecting', text: 'Conectando…', title: 'Conectando al backend…' },
        cloud:      { cls: 'cloud', text: 'Conectado a la nube', title: '' },
        local:      { cls: 'local', text: 'Modo local', title: 'Usando almacenamiento local' },
        error:      { cls: 'error', text: 'Sin backend', title: '' }
      };
      const apply = (state, message) => {
        const s = states[state] || states.local;
        b.className = 'backend-badge ' + s.cls;
        b.querySelector('.bb-text').textContent = s.text;
        b.title = message ? (s.title ? s.title + ' — ' : '') + message : s.title;
      };
      document.addEventListener('alerta:backend', (e) => {
        const d = (e && e.detail) || {};
        apply(d.state, d.message);
        if (d.state === 'cloud') { this.toast('Conectado a la nube', { type: 'ok', em: '☁️', small: true }); setTimeout(() => b.classList.add('mini'), 4000); }
      });
      // Si en unos segundos nadie avisó "nube", asumimos modo local.
      setTimeout(() => { if (b.classList.contains('connecting')) apply('local', 'sin respuesta del backend'); }, 6000);
    }
  };

  // Aplica el tema de inmediato (antes de DOMContentLoaded) para evitar flash.
  applySavedTheme();
  global.AlertaUI = AlertaUI;
})(window);
