/* ============================================================================
   Alerta Barrio — Página de reportes en vivo (report.js)
   Formulario + feed reactivo sobre AlertaData. Incluye:
     • Geolocalización (centra ciudad + rellena coordenadas)
     • Foto adjunta (comprimida localmente a dataURL; lista para migrar a
       Firebase Storage — ver README)
     • Alias / reporte anónimo
     • Votación comunitaria (confirmar) y "marcar como resuelto"
     • Filtros por tipo, rango de fecha y estado
     • Toasts de éxito/error (AlertaUI)
   Los reportes creados aquí actualizan también el color de los mapas.
   Uso: AlertaReport.init();
   ========================================================================== */
(function (global) {
  'use strict';
  const D = global.AlertaData;
  const UI = global.AlertaUI;
  const esc = (s) => D.sanitize(s);

  const AlertaReport = {
    tipoSel: 'robo',
    nivelSel: 'medio',
    filtro: 'todos',
    filtroFecha: 'todos',
    filtroEstado: 'todos',
    photoData: null,

    init() {
      this.selCiudad = document.getElementById('selCiudad');
      this.selZona = document.getElementById('selZona');

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

      // Geolocalización
      const geoBtn = document.getElementById('btnGeo');
      if (geoBtn) geoBtn.addEventListener('click', () => this.useMyLocation());

      // Anónimo → oculta el alias
      const anon = document.getElementById('chkAnon');
      const aliasWrap = document.getElementById('aliasField');
      if (anon && aliasWrap) anon.addEventListener('change', () => { aliasWrap.style.display = anon.checked ? 'none' : ''; });

      // Foto
      const photoInput = document.getElementById('photoInput');
      if (photoInput) photoInput.addEventListener('change', (e) => this.onPhoto(e));
      const photoClear = document.getElementById('photoClear');
      if (photoClear) photoClear.addEventListener('click', () => this.clearPhoto());

      // Publicar
      document.getElementById('btnSubmit').addEventListener('click', () => this.submit());

      // Filtros por tipo (chips)
      document.getElementById('filters').addEventListener('click', (e) => {
        const chip = e.target.closest('.chip'); if (!chip) return;
        this.filtro = chip.dataset.f;
        document.querySelectorAll('.chip').forEach(c => c.classList.toggle('active', c === chip));
        this.renderFeed();
      });
      // Filtros de fecha/estado (selects)
      const fFecha = document.getElementById('filterFecha');
      const fEstado = document.getElementById('filterEstado');
      if (fFecha) fFecha.addEventListener('change', () => { this.filtroFecha = fFecha.value; this.renderFeed(); });
      if (fEstado) fEstado.addEventListener('change', () => { this.filtroEstado = fEstado.value; this.renderFeed(); });

      // Reset
      document.getElementById('btnReset').addEventListener('click', () => {
        if (!confirm('¿Borrar todos los reportes guardados?')) return;
        D.clearReports();
        UI && UI.toast('Reportes borrados', { type: 'info' });
      });

      // Delegación: votar / resolver en el feed
      document.getElementById('feed').addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-act]'); if (!btn) return;
        const id = btn.dataset.id;
        if (btn.dataset.act === 'vote') { D.voteReport(id); UI && UI.toast('Reporte confirmado. ¡Gracias!', { type: 'ok', small: true }); }
        else if (btn.dataset.act === 'resolve') { D.resolveReport(id); UI && UI.toast('Marcado como resuelto', { type: 'ok', small: true }); }
      });

      D.seedIfEmpty();
      D.subscribe(() => { this.renderFeed(); this.renderStats(); });
      setInterval(() => this.renderFeed(), 60000);

      this.renderFeed(); this.renderStats();
    },

    fillZonas() {
      const cid = this.selCiudad.value; this.selZona.innerHTML = '';
      D.getZones(cid).forEach(z => { const o = document.createElement('option'); o.value = z.name; o.textContent = z.name.charAt(0) + z.name.slice(1).toLowerCase(); this.selZona.appendChild(o); });
    },
    setNivel(n) { this.nivelSel = n; document.querySelectorAll('.level-btn').forEach(x => x.classList.toggle('active', x.dataset.level === n)); },

    useMyLocation() {
      const note = document.getElementById('geoNote');
      if (!navigator.geolocation) { note.textContent = 'Tu navegador no soporta geolocalización.'; UI && UI.toast('Geolocalización no disponible', { type: 'err' }); return; }
      note.textContent = 'Obteniendo ubicación…';
      navigator.geolocation.getCurrentPosition((pos) => {
        const { latitude, longitude } = pos.coords;
        this._coords = { lat: +latitude.toFixed(5), lng: +longitude.toFixed(5) };
        const city = latitude > 4.82 ? 'chia' : 'bogota';
        this.selCiudad.value = city; this.fillZonas();
        note.textContent = `📍 Ubicación detectada (${this._coords.lat}, ${this._coords.lng}). Verifica la zona.`;
        UI && UI.toast('Ubicación detectada', { type: 'ok', small: true, em: '📍' });
      }, () => { note.textContent = 'No se pudo obtener tu ubicación (permiso denegado).'; UI && UI.toast('Permiso de ubicación denegado', { type: 'err' }); }, { timeout: 8000 });
    },

    // Comprime la imagen en el cliente (máx 720px, JPEG ~0.7) → dataURL liviano.
    onPhoto(e) {
      const file = e.target.files && e.target.files[0]; if (!file) return;
      if (!/^image\//.test(file.type)) { UI && UI.toast('El archivo no es una imagen', { type: 'err' }); return; }
      const reader = new FileReader();
      reader.onload = (ev) => {
        const img = new Image();
        img.onload = () => {
          const max = 720, scale = Math.min(1, max / Math.max(img.width, img.height));
          const cv = document.createElement('canvas');
          cv.width = Math.round(img.width * scale); cv.height = Math.round(img.height * scale);
          cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
          this.photoData = cv.toDataURL('image/jpeg', 0.7);
          const prev = document.getElementById('photoPreview');
          if (prev) { prev.src = this.photoData; prev.classList.add('show'); }
          const clr = document.getElementById('photoClear'); if (clr) clr.style.display = '';
          UI && UI.toast('Foto adjuntada', { type: 'ok', small: true, em: '📷' });
        };
        img.src = ev.target.result;
      };
      reader.readAsDataURL(file);
    },
    clearPhoto() {
      this.photoData = null;
      const prev = document.getElementById('photoPreview'); if (prev) { prev.src = ''; prev.classList.remove('show'); }
      const input = document.getElementById('photoInput'); if (input) input.value = '';
      const clr = document.getElementById('photoClear'); if (clr) clr.style.display = 'none';
    },

    submit() {
      const msg = document.getElementById('formMsg');
      const ciudad = this.selCiudad.value, zona = this.selZona.value;
      if (!zona) {
        msg.className = 'formmsg err'; msg.textContent = 'Selecciona una localidad o municipio.';
        UI && UI.toast('Selecciona una zona', { type: 'err' });
        return;
      }
      const anon = document.getElementById('chkAnon') && document.getElementById('chkAnon').checked;
      const alias = document.getElementById('aliasInput') ? document.getElementById('aliasInput').value : '';
      D.addReport({
        ciudad, zona, tipo: this.tipoSel, nivel: this.nivelSel,
        note: document.getElementById('txtNote').value,
        alias: alias, anon: !!anon,
        photo: this.photoData || null,
        coords: this._coords || null
      });
      document.getElementById('txtNote').value = '';
      this.clearPhoto(); this._coords = null;
      const gn = document.getElementById('geoNote'); if (gn) gn.textContent = '';
      msg.className = 'formmsg ok'; msg.textContent = '✔ Reporte publicado.';
      setTimeout(() => { msg.textContent = ''; msg.className = 'formmsg'; }, 3500);
      UI && UI.toast('¡Gracias por alertar a tu comunidad!', { type: 'ok', title: 'Reporte publicado', em: '🚨' });
    },

    _filteredList() {
      const opts = { type: this.filtro };
      if (this.filtroEstado !== 'todos') opts.status = this.filtroEstado;
      if (this.filtroFecha === '24h') opts.sinceHours = 24;
      else if (this.filtroFecha === '7d') opts.sinceHours = 24 * 7;
      return D.getReports(opts);
    },

    renderFeed() {
      const feed = document.getElementById('feed');
      const empty = document.getElementById('feedEmpty');
      const cities = D.getCities();
      const list = this._filteredList();
      if (!list.length) {
        feed.innerHTML = ''; empty.style.display = 'block';
        empty.textContent = D.getReports({}).length ? 'No hay reportes con estos filtros.' : 'Aún no hay reportes. ¡Sé el primero en reportar!';
        return;
      }
      empty.style.display = 'none';
      feed.innerHTML = list.map(r => {
        const t = D.tipoMeta(r.tipo), lv = D.NIVELES[r.nivel] || D.NIVELES.medio;
        const est = D.ESTADOS[r.estado] || D.ESTADOS.pendiente;
        const ciudad = cities[r.ciudad] ? cities[r.ciudad].label : '';
        const stale = D.isStale(r);
        const who = r.anon ? 'Anónimo' : (r.alias ? esc(r.alias) : 'Ciudadano');
        return `<li class="report${stale ? ' stale' : ''}" style="border-left-color:${lv.color}">
          <div class="em">${t.em}</div>
          <div class="body">
            <div class="top">
              <span class="ttl">${t.label}</span>
              <span class="badge-lvl" style="background:${lv.color}">${lv.label}</span>
              <span class="badge-estado" style="background:${est.color}">${est.label}</span>
            </div>
            <div class="loc">📍 ${esc(r.zona)} · ${esc(ciudad)}</div>
            ${r.note ? `<p class="note">${esc(r.note)}</p>` : ''}
            ${r.photo ? `<img class="thumb" src="${esc(r.photo)}" alt="Evidencia del reporte" loading="lazy">` : ''}
            <div class="who">👤 ${who} · 🕒 ${D.timeAgo(r.ts)}</div>
            <div class="actions">
              <button class="vote-btn confirm" data-act="vote" data-id="${r.id}">👍 Confirmar (${r.votos || 0})</button>
              ${r.estado === 'resuelto' ? '' : `<button class="vote-btn resolve" data-act="resolve" data-id="${r.id}">✅ Marcar resuelto</button>`}
            </div>
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
