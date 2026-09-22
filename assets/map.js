/* ============================================================================
   Alerta Barrio — Mapa interactivo compartido (map.js)
   Renderiza el mapa SVG de una ciudad, el ranking y el panel de calificación
   /comentarios. Lee todo desde AlertaData y se resuscribe a cambios, de modo
   que un reporte nuevo (desde la página de reportes u otra pestaña) recolorea
   el mapa automáticamente.

   Uso en el HTML:
     AlertaMap.init({ city: 'bogota' });
   Requiere en el DOM: #mapSvg, #rankingList, #overlay + panel, y (opcional)
   #statReports, #statAvg. Etiquetas: se muestran si zone.fs >= LABEL_MIN.
   ========================================================================== */
(function (global) {
  'use strict';
  const D = global.AlertaData;
  const NS = 'http://www.w3.org/2000/svg';
  const LABEL_MIN = 12; // fuente mínima para dibujar la etiqueta dentro del mapa

  function el(tag, attrs) { const n = document.createElementNS(NS, tag); for (const k in attrs) n.setAttribute(k, attrs[k]); return n; }
  function cap(name) { return name.charAt(0) + name.slice(1).toLowerCase(); }
  function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

  const AlertaMap = {
    city: 'bogota',
    currentId: null,

    init(opts) {
      this.city = opts.city;
      this.svg = document.getElementById('mapSvg');
      this.overlay = document.getElementById('overlay');
      this.svg.setAttribute('viewBox', D.getCity(this.city).viewBox);

      // Panel: cerrar
      const closeBtn = document.getElementById('closeBtn');
      if (closeBtn) closeBtn.addEventListener('click', () => this.closePanel());
      this.overlay.addEventListener('click', (e) => { if (e.target === this.overlay) this.closePanel(); });
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && this.overlay.classList.contains('open')) this.closePanel(); });

      // Slider
      const range = document.getElementById('riskRange');
      if (range) range.addEventListener('input', () => { document.getElementById('riskVal').textContent = range.value; });

      // Enviar calificación
      const sub = document.getElementById('submitRating');
      if (sub) sub.addEventListener('click', () => {
        if (!this.currentId) return;
        D.addRating(this.city, this.currentId, parseInt(range.value, 10));
        this.refreshPanel();
      });

      // Enviar comentario
      const subC = document.getElementById('submitComment');
      if (subC) subC.addEventListener('click', () => {
        if (!this.currentId) return;
        const ta = document.getElementById('commentText');
        const t = ta.value.trim(); if (!t) return;
        D.addComment(this.city, this.currentId, t);
        ta.value = '';
        this.renderComments(this.currentId);
      });

      // Reactividad: cualquier cambio de datos redibuja mapa + ranking + stats
      D.subscribe(() => { this.renderMap(); this.renderRanking(); this.renderStats(); if (this.overlay.classList.contains('open')) this.refreshPanel(true); });

      this.renderMap(); this.renderRanking(); this.renderStats();
    },

    renderMap() {
      const svg = this.svg; svg.innerHTML = '';
      D.getZones(this.city).forEach(z => {
        const a = D.zoneAvg(this.city, z.id);
        const hasData = D.zoneCount(this.city, z.id) > 0;
        const fill = hasData ? D.heatColor(a) : z.base;
        const cls = 'loc' + (z.main ? ' main' : '') + (z.id === this.currentId ? ' sel' : '');
        const path = el('path', { d: z.d, fill, class: cls, 'data-id': z.id, tabindex: '0', role: 'button' });
        path.setAttribute('aria-label', cap(z.name) + (hasData ? `, riesgo ${a.toFixed(1)} de 10` : ', sin datos') + '. Abrir detalle');
        const title = el('title', {}); title.textContent = cap(z.name); path.appendChild(title);
        path.addEventListener('click', () => this.openPanel(z.id));
        path.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.openPanel(z.id); } });
        svg.appendChild(path);
        if (z.fs >= LABEL_MIN) {
          const label = el('text', { x: z.cx, y: z.cy, class: 'loc-label', 'font-size': z.fs, 'dominant-baseline': 'middle' });
          label.textContent = z.name; svg.appendChild(label);
        }
      });
    },

    renderRanking() {
      const list = document.getElementById('rankingList'); if (!list) return;
      const zones = D.getZones(this.city).slice().sort((x, y) => D.zoneAvg(this.city, y.id) - D.zoneAvg(this.city, x.id));
      list.innerHTML = zones.map((z, i) => {
        const a = D.zoneAvg(this.city, z.id);
        return `<li data-id="${z.id}">
          <span class="rank">${i + 1}</span>
          <span class="name">${cap(z.name)}</span>
          <span class="val" style="color:${a ? D.heatColor(a) : 'var(--dim)'}">${a ? a.toFixed(1) : '—'}</span>
          <div class="bar-track"><div class="bar-fill" style="width:${a * 10}%; background:${D.heatColor(a)};"></div></div>
        </li>`;
      }).join('');
      list.querySelectorAll('li').forEach(li => li.addEventListener('click', () => this.openPanel(li.dataset.id)));
    },

    renderStats() {
      const rEl = document.getElementById('statReports');
      const aEl = document.getElementById('statAvg');
      if (!rEl && !aEl) return;
      let total = 0, sum = 0, withData = 0;
      D.getZones(this.city).forEach(z => {
        const c = D.zoneCount(this.city, z.id); total += c;
        const a = D.zoneAvg(this.city, z.id); if (a > 0) { sum += a; withData++; }
      });
      if (rEl) rEl.textContent = total;
      if (aEl) aEl.textContent = withData ? (sum / withData).toFixed(1) : '—';
    },

    openPanel(id) {
      this.currentId = id;
      this.renderMap();
      this.refreshPanel();
      this.overlay.classList.add('open');
      const closeBtn = document.getElementById('closeBtn'); if (closeBtn) closeBtn.focus();
    },
    refreshPanel(keepInputs) {
      const id = this.currentId; if (!id) return;
      const z = D.getZone(this.city, id);
      const a = D.zoneAvg(this.city, id);
      document.getElementById('panelName').textContent = cap(z.name);
      const scoreEl = document.getElementById('panelScore');
      scoreEl.textContent = a ? a.toFixed(1) : '0';
      scoreEl.style.color = a ? D.heatColor(a) : 'var(--ink)';
      document.getElementById('panelCount').textContent = D.zoneCount(this.city, id) + ' reportes';
      if (!keepInputs) {
        const r = document.getElementById('riskRange'); if (r) { r.value = 5; document.getElementById('riskVal').textContent = 5; }
        const ta = document.getElementById('commentText'); if (ta) ta.value = '';
      }
      this.renderComments(id);
      this.renderRecent(id, z);
    },
    renderComments(id) {
      const list = document.getElementById('commentList'); if (!list) return;
      const empty = document.getElementById('commentEmpty');
      const items = D.getComments(this.city, id).slice().sort((a, b) => b.date.localeCompare(a.date));
      list.innerHTML = items.map(c => `<li>${esc(c.text)}<div class="meta">${esc(c.date)}</div></li>`).join('');
      if (empty) empty.style.display = items.length ? 'none' : 'block';
    },
    // Muestra los últimos reportes en vivo de esta zona dentro del panel.
    renderRecent(id, z) {
      const box = document.getElementById('panelRecent'); if (!box) return;
      const reports = D.getReports({ city: this.city, zone: z.name, limit: 4 });
      if (!reports.length) { box.innerHTML = '<p class="empty">Sin reportes recientes en esta zona.</p>'; return; }
      box.innerHTML = '<ul class="comments recent-in-panel">' + reports.map(r => {
        const t = D.tipoMeta(r.tipo);
        return `<li><span class="em">${t.em}</span> ${esc(t.label)}${r.note ? ' · ' + esc(r.note) : ''}<span class="rmeta">${D.timeAgo(r.ts)}</span></li>`;
      }).join('') + '</ul>';
    },
    closePanel() { this.overlay.classList.remove('open'); this.currentId = null; this.renderMap(); }
  };

  global.AlertaMap = AlertaMap;
})(window);
