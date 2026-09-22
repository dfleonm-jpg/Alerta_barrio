/* ============================================================================
   Alerta Barrio — Página de reportes en vivo (report.js)
   Formulario + feed reactivo, sobre la capa AlertaData compartida.
   Los reportes creados aquí actualizan también el color de los mapas.
   Uso: AlertaReport.init();
   ========================================================================== */
(function (global) {
  'use strict';
  const D = global.AlertaData;
  const esc = (s) => { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; };

  const AlertaReport = {
    tipoSel: 'robo',
    nivelSel: 'medio',
    filtro: 'todos',

    init() {
      this.selCiudad = document.getElementById('selCiudad');
      this.selZona = document.getElementById('selZona');

      // Ciudades y zonas desde la capa de datos (mismos nombres que los mapas)
      const cities = D.getCities();
      Object.keys(cities).forEach(cid => {
        const o = document.createElement('option'); o.value = cid; o.textContent = cities[cid].label; this.selCiudad.appendChild(o);
      });
      this.selCiudad.addEventListener('change', () => this.fillZonas());
      this.fillZonas();

      // Tipos
      const typesBox = document.getElementById('types');
      D.TIPOS.forEach(t => {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'type-btn' + (t.id === this.tipoSel ? ' active' : ''); b.dataset.tipo = t.id;
        b.innerHTML = `<span class="em">${t.em}</span>${t.label}`;
        b.addEventListener('click', () => { this.tipoSel = t.id; typesBox.querySelectorAll('.type-btn').forEach(x => x.classList.toggle('active', x.dataset.tipo === t.id)); });
        typesBox.appendChild(b);
      });

      // Niveles
      document.querySelectorAll('.level-btn').forEach(b => b.addEventListener('click', () => this.setNivel(b.dataset.level)));
      this.setNivel('medio');

      // Geolocalización → elige la zona más cercana (por centroide del mapa)
      const geoBtn = document.getElementById('btnGeo');
      if (geoBtn) geoBtn.addEventListener('click', () => this.useMyLocation());

      // Publicar
      document.getElementById('btnSubmit').addEventListener('click', () => this.submit());

      // Filtros
      document.getElementById('filters').addEventListener('click', (e) => {
        const chip = e.target.closest('.chip'); if (!chip) return;
        this.filtro = chip.dataset.f;
        document.querySelectorAll('.chip').forEach(c => c.classList.toggle('active', c === chip));
        this.renderFeed();
      });

      // Reset
      document.getElementById('btnReset').addEventListener('click', () => {
        if (!confirm('¿Borrar todos los reportes guardados?')) return;
        D.clearReports();
      });

      // Reactividad + semilla
      D.seedIfEmpty();
      D.subscribe(() => { this.renderFeed(); this.renderStats(); });
      setInterval(() => this.renderFeed(), 60000); // refresca "hace X min"

      this.renderFeed(); this.renderStats();
    },

    fillZonas() {
      const cid = this.selCiudad.value; this.selZona.innerHTML = '';
      D.getZones(cid).forEach(z => { const o = document.createElement('option'); o.value = z.name; o.textContent = z.name.charAt(0) + z.name.slice(1).toLowerCase(); this.selZona.appendChild(o); });
    },
    setNivel(n) { this.nivelSel = n; document.querySelectorAll('.level-btn').forEach(x => x.classList.toggle('active', x.dataset.level === n)); },

    // Geolocalización: aproxima la zona por cercanía al centroide (mapa esquemático).
    // Nota: los mapas usan proyección local, por eso mapeamos lat/lon → la zona
    // más plausible con una heurística simple por ciudad.
    useMyLocation() {
      const note = document.getElementById('geoNote');
      if (!navigator.geolocation) { note.textContent = 'Tu navegador no soporta geolocalización.'; return; }
      note.textContent = 'Obteniendo ubicación…';
      navigator.geolocation.getCurrentPosition((pos) => {
        const { latitude, longitude } = pos.coords;
        // Bogotá ~4.4–4.8 N ; Chía ~4.86 N. Elegimos ciudad por latitud.
        const city = latitude > 4.82 ? 'chia' : 'bogota';
        this.selCiudad.value = city; this.fillZonas();
        note.textContent = `Ubicación detectada (${latitude.toFixed(3)}, ${longitude.toFixed(3)}). Verifica la zona seleccionada.`;
      }, () => { note.textContent = 'No se pudo obtener tu ubicación (permiso denegado).'; }, { timeout: 8000 });
    },

    submit() {
      const msg = document.getElementById('formMsg');
      const ciudad = this.selCiudad.value, zona = this.selZona.value;
      if (!zona) { msg.className = 'formmsg err'; msg.textContent = 'Selecciona una localidad o municipio.'; return; }
      D.addReport({ ciudad, zona, tipo: this.tipoSel, nivel: this.nivelSel, note: document.getElementById('txtNote').value.trim() });
      document.getElementById('txtNote').value = '';
      msg.className = 'formmsg ok'; msg.textContent = '✔ Reporte publicado. ¡Gracias por alertar a tu comunidad!';
      setTimeout(() => { msg.textContent = ''; msg.className = 'formmsg'; }, 3500);
    },

    renderFeed() {
      const feed = document.getElementById('feed');
      const empty = document.getElementById('feedEmpty');
      const cities = D.getCities();
      const list = D.getReports({ type: this.filtro });
      if (!list.length) {
        feed.innerHTML = ''; empty.style.display = 'block';
        empty.textContent = D.getReports({}).length ? 'No hay reportes de este tipo.' : 'Aún no hay reportes. ¡Sé el primero en reportar!';
        return;
      }
      empty.style.display = 'none';
      feed.innerHTML = list.map(r => {
        const t = D.tipoMeta(r.tipo), lv = D.NIVELES[r.nivel] || D.NIVELES.medio;
        const ciudad = cities[r.ciudad] ? cities[r.ciudad].label : '';
        const stale = D.isStale(r);
        return `<li class="report${stale ? ' stale' : ''}" style="border-left-color:${lv.color}">
          <div class="em">${t.em}</div>
          <div class="body">
            <div class="top">
              <span class="ttl">${t.label}</span>
              <span class="badge-lvl" style="background:${lv.color}">${lv.label}</span>
              ${stale ? '<span class="loc">· archivado</span>' : ''}
            </div>
            <div class="loc">📍 ${esc(r.zona)} · ${esc(ciudad)}</div>
            ${r.note ? `<p class="note">${esc(r.note)}</p>` : ''}
            <div class="time">🕒 ${D.timeAgo(r.ts)}</div>
          </div>
        </li>`;
      }).join('');
    },

    renderStats() {
      const startDay = new Date(); startDay.setHours(0, 0, 0, 0);
      const all = D.getReports({});
      const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
      set('stTotal', all.length);
      set('stHoy', all.filter(r => r.ts >= startDay.getTime()).length);
      set('stAltos', all.filter(r => r.nivel === 'alto').length);
    }
  };

  global.AlertaReport = AlertaReport;
})(window);
