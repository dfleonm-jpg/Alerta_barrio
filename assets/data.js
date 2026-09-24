/* ============================================================================
   Alerta Barrio — Capa de datos compartida (data.js)
   ----------------------------------------------------------------------------
   Fuente única de verdad para todas las páginas:
     • Geometría real de las zonas (Bogotá: localidades DANE; Chía: municipio + vecinos)
     • Reportes en vivo (robo, acoso, etc.)  ← también alimentan el color del mapa
     • Suscripción reactiva (pub/sub): cuando cambian los datos, mapa y feed se
       redibujan solos.
   ----------------------------------------------------------------------------
   BACKEND: por defecto usa localStorage (offline). Para datos compartidos entre
   usuarios en tiempo real, implementa un `FirebaseStore` (ver más abajo) y
   cambia `AlertaData.useStore(new FirebaseStore(...))`. La app no necesita más
   cambios: todo pasa por esta capa.
   ========================================================================== */
(function (global) {
  'use strict';

  // --------------------------------------------------------------------------
  // Catálogos compartidos
  // --------------------------------------------------------------------------
  const TIPOS = [
    { id: 'robo', label: 'Robo', em: '🚨' },
    { id: 'acoso', label: 'Acoso', em: '⚠️' },
    { id: 'violencia', label: 'Violencia', em: '🆘' },
    { id: 'iluminacion', label: 'Iluminación', em: '💡' },
    { id: 'sospechoso', label: 'Sospechoso', em: '👁️' },
    { id: 'otro', label: 'Otro', em: '❔' }
  ];
  const NIVELES = {
    alto:  { id: 'alto',  label: 'Alto',  color: '#d62828', weight: 9 },
    medio: { id: 'medio', label: 'Medio', color: '#f6a821', weight: 6 },
    bajo:  { id: 'bajo',  label: 'Bajo',  color: '#43a047', weight: 3 }
  };
  const tipoMeta = (id) => TIPOS.find(t => t.id === id) || TIPOS[TIPOS.length - 1];

  const ESTADOS = {
    pendiente: { id: 'pendiente', label: 'Pendiente', color: '#f6a821' },
    resuelto:  { id: 'resuelto',  label: 'Resuelto',  color: '#43a047' }
  };

  // --------------------------------------------------------------------------
  // Sanitización anti-XSS: escapa cualquier texto de usuario antes de ir al DOM.
  // Se usa en TODAS las páginas (comentarios, notas, alias) para prevenir
  // inyección de scripts/HTML.
  // --------------------------------------------------------------------------
  function sanitize(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  // Limpieza de entrada: recorta, colapsa espacios y limita longitud.
  function cleanInput(str, max) {
    return String(str == null ? '' : str).replace(/\s+/g, ' ').trim().slice(0, max || 240);
  }

  // Ventana de vigencia de un reporte para el mapa de calor (72 h).
  // Los reportes más viejos "pesan" menos y dejan de contar tras este tiempo.
  const REPORT_TTL_H = 72;

  // --------------------------------------------------------------------------
  // Geometría de zonas por ciudad (viewBox y paths reales).
  // Se inyecta desde ZONES_DATA (definido abajo, extraído de datos oficiales).
  // --------------------------------------------------------------------------
  const CITIES = {
    bogota: { label: 'Bogotá', viewBox: '0 0 1000 720', zones: null },
    chia:   { label: 'Chía y vecinos', viewBox: '0 0 760 620', zones: null }
  };

  // Escala de calor por promedio de calificación (percepción 0..10)
  function heatColor(avg) {
    if (avg === 0) return getCss('--c0');
    if (avg <= 3) return getCss('--c1');
    if (avg <= 6) return getCss('--c2');
    return getCss('--c3');
  }
  function getCss(v) {
    try { return getComputedStyle(document.documentElement).getPropertyValue(v).trim() || fallback(v); }
    catch (e) { return fallback(v); }
  }
  function fallback(v) { return { '--c0': '#efede6', '--c1': '#fbe9a6', '--c2': '#f5c518', '--c3': '#d62828' }[v] || '#888'; }

  // --------------------------------------------------------------------------
  // STORE: abstracción de persistencia. Local por defecto; Firebase-ready.
  // Un store debe implementar: getState(), setState(), subscribe(fn).
  // --------------------------------------------------------------------------
  function emptyState() {
    // ratings[cityId][zoneId] = [numbers]; comments[cityId][zoneId] = [{text,date}]
    return { ratings: {}, comments: {}, reports: [] };
  }

  class LocalStore {
    constructor(key) {
      this.key = key || 'alertaBarrio.v2';
      this._subs = new Set();
      this.state = this._read();
      // sincroniza entre pestañas del mismo navegador
      global.addEventListener('storage', (e) => {
        if (e.key === this.key) { this.state = this._read(); this._emit(); }
      });
    }
    _read() {
      try { const raw = localStorage.getItem(this.key); return raw ? JSON.parse(raw) : emptyState(); }
      catch (e) { return emptyState(); }
    }
    _write() { try { localStorage.setItem(this.key, JSON.stringify(this.state)); } catch (e) { console.error(e); } }
    getState() { return this.state; }
    setState(mutator) { mutator(this.state); this._write(); this._emit(); }
    subscribe(fn) { this._subs.add(fn); return () => this._subs.delete(fn); }
    _emit() { this._subs.forEach(fn => { try { fn(this.state); } catch (e) { console.error(e); } }); }
  }

  /* ------------------------------------------------------------------------
     FirestoreStore — sincroniza reportes / calificaciones / comentarios en la
     nube (Cloud Firestore) EN TIEMPO REAL entre todos los dispositivos.
     Recibe `fb` = API mínima inyectada desde firebase-init.js:
       { db, collection, addDoc, updateDoc, doc, deleteDoc, onSnapshot,
         query, orderBy, increment, serverTimestamp, getDocs }
     Mantiene la MISMA forma de estado que emptyState() para que map.js /
     report.js no cambien: los snapshots reconstruyen { ratings, comments,
     reports } y se llama _emit() en cada cambio.
     Colecciones: reports, ratings, comments.
  -------------------------------------------------------------------------- */
  class FirestoreStore {
    constructor(fb) {
      this.fb = fb;
      this._subs = new Set();
      this.state = emptyState();
      this._raw = { reports: [], ratings: [], comments: [] };
      this._listen();
    }
    _listen() {
      const { db, collection, onSnapshot, query, orderBy } = this.fb;
      const bind = (name, orderField) => {
        try {
          const col = collection(db, name);
          const q = orderField ? query(col, orderBy(orderField, 'desc')) : col;
          onSnapshot(q,
            (snap) => { this._raw[name] = snap.docs.map(d => Object.assign({ id: d.id }, d.data())); this._rebuild(); },
            (err) => { console.warn('[Firestore] onSnapshot', name, err && err.message); }
          );
        } catch (e) { console.warn('[Firestore] listen', name, e && e.message); }
      };
      bind('reports', 'ts');
      bind('ratings', null);
      bind('comments', null);
    }
    // Reconstruye el estado { ratings, comments, reports } a partir de las
    // colecciones planas de Firestore.
    _rebuild() {
      const st = emptyState();
      st.reports = (this._raw.reports || []).slice().sort((a, b) => (b.ts || 0) - (a.ts || 0));
      (this._raw.ratings || []).forEach(r => {
        if (!r.ciudad || !r.zonaId) return;
        st.ratings[r.ciudad] = st.ratings[r.ciudad] || {};
        (st.ratings[r.ciudad][r.zonaId] = st.ratings[r.ciudad][r.zonaId] || []).push(r.value);
      });
      (this._raw.comments || []).forEach(c => {
        if (!c.ciudad || !c.zonaId) return;
        st.comments[c.ciudad] = st.comments[c.ciudad] || {};
        (st.comments[c.ciudad][c.zonaId] = st.comments[c.ciudad][c.zonaId] || []).push({ text: c.text, date: c.date || '' });
      });
      this.state = st;
      this._emit();
    }
    getState() { return this.state; }
    // setState genérico: no se usa para escribir en la nube (usamos los métodos
    // específicos), pero lo dejamos por compatibilidad de interfaz.
    setState(mutator) { mutator(this.state); this._emit(); }
    subscribe(fn) { this._subs.add(fn); return () => this._subs.delete(fn); }
    _emit() { this._subs.forEach(fn => { try { fn(this.state); } catch (e) { console.error(e); } }); }

    // ---- Escrituras a Firestore (métodos "intent" que AlertaData delega) ----
    addReport(report) {
      const { db, collection, addDoc } = this.fb;
      const doc = Object.assign({}, report); delete doc.id; // Firestore genera el id
      addDoc(collection(db, 'reports'), doc).catch(e => console.error('[Firestore] addReport', e));
    }
    voteReport(id) {
      const { db, doc, updateDoc, increment } = this.fb;
      updateDoc(doc(db, 'reports', id), { votos: increment(1) }).catch(e => console.error('[Firestore] voteReport', e));
    }
    resolveReport(id) {
      const { db, doc, updateDoc, increment } = this.fb;
      updateDoc(doc(db, 'reports', id), { resueltos: increment(1), estado: 'resuelto' }).catch(e => console.error('[Firestore] resolveReport', e));
    }
    addRating(cityId, zoneId, value) {
      const { db, collection, addDoc } = this.fb;
      addDoc(collection(db, 'ratings'), { ciudad: cityId, zonaId: zoneId, value: value, ts: Date.now() }).catch(e => console.error('[Firestore] addRating', e));
    }
    addComment(cityId, zoneId, text) {
      const { db, collection, addDoc } = this.fb;
      addDoc(collection(db, 'comments'), { ciudad: cityId, zonaId: zoneId, text: text, date: new Date().toLocaleString('es-CO'), ts: Date.now() }).catch(e => console.error('[Firestore] addComment', e));
    }
    async clearReports() {
      const { db, collection, getDocs, deleteDoc, doc } = this.fb;
      try { const snap = await getDocs(collection(db, 'reports')); await Promise.all(snap.docs.map(d => deleteDoc(doc(db, 'reports', d.id)))); }
      catch (e) { console.error('[Firestore] clearReports', e); }
    }
    // Semilla en la nube: siembra solo si la colección está vacía (una vez).
    async seed(reports) {
      const { db, collection, getDocs, addDoc } = this.fb;
      try {
        const snap = await getDocs(collection(db, 'reports'));
        if (!snap.empty) return false;
        await Promise.all(reports.map(r => { const d = Object.assign({}, r); delete d.id; return addDoc(collection(db, 'reports'), d); }));
        return true;
      } catch (e) { console.warn('[Firestore] seed', e && e.message); return false; }
    }
  }
  global.AlertaFirestoreStore = FirestoreStore;

  // --------------------------------------------------------------------------
  // API pública
  // --------------------------------------------------------------------------
  let store = new LocalStore();

  function uid() { return 'r_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7); }

  const AlertaData = {
    TIPOS, NIVELES, ESTADOS, tipoMeta, heatColor, REPORT_TTL_H, sanitize, cleanInput,

    // Suscriptores de la app (independientes del store): así, al cambiar de
    // store (p. ej. Local → Firestore) las vistas siguen recibiendo cambios.
    _appSubs: new Set(),
    _storeUnsub: null,
    _bindStore() {
      if (this._storeUnsub) { try { this._storeUnsub(); } catch (e) {} }
      this._storeUnsub = store.subscribe(() => this._appSubs.forEach(fn => { try { fn(store.getState()); } catch (e) { console.error(e); } }));
    },
    useStore(newStore) {
      store = newStore;
      this._bindStore();
      // Notifica de inmediato a las vistas ya montadas con el nuevo estado.
      this._appSubs.forEach(fn => { try { fn(store.getState()); } catch (e) { console.error(e); } });
    },
    subscribe(fn) { this._appSubs.add(fn); return () => this._appSubs.delete(fn); },

    // ---- Zonas ----
    getCities() { return CITIES; },
    getCity(cityId) { return CITIES[cityId]; },
    getZones(cityId) { return (CITIES[cityId] && CITIES[cityId].zones) || []; },
    getZone(cityId, zoneId) { return this.getZones(cityId).find(z => z.id === zoneId) || null; },
    setZonesData(data) { CITIES.bogota.zones = data.BOGOTA; CITIES.chia.zones = data.CHIA; },

    // ---- Ratings (calificación 1..10 por zona) ----
    _ratings(cityId, zoneId) {
      const s = store.getState();
      return (s.ratings[cityId] && s.ratings[cityId][zoneId]) || [];
    },
    addRating(cityId, zoneId, value) {
      if (store.addRating) return store.addRating(cityId, zoneId, value);
      store.setState(s => {
        s.ratings[cityId] = s.ratings[cityId] || {};
        s.ratings[cityId][zoneId] = s.ratings[cityId][zoneId] || [];
        s.ratings[cityId][zoneId].push(value);
      });
    },
    // Promedio combinado: mezcla calificaciones directas + reportes recientes de la zona.
    zoneAvg(cityId, zoneId) {
      const ratings = this._ratings(cityId, zoneId).slice();
      // Reportes vigentes de esa zona aportan su "peso" como si fueran calificaciones.
      this.getReports({ city: cityId, zone: this._zoneName(cityId, zoneId), freshOnly: true })
        .forEach(r => { const n = NIVELES[r.nivel]; if (n) ratings.push(n.weight); });
      if (!ratings.length) return 0;
      return ratings.reduce((a, b) => a + b, 0) / ratings.length;
    },
    zoneCount(cityId, zoneId) {
      const reports = this.getReports({ city: cityId, zone: this._zoneName(cityId, zoneId) }).length;
      return this._ratings(cityId, zoneId).length + reports;
    },
    _zoneName(cityId, zoneId) { const z = this.getZone(cityId, zoneId); return z ? z.name : null; },

    // ---- Comentarios por zona ----
    getComments(cityId, zoneId) {
      const s = store.getState();
      return ((s.comments[cityId] && s.comments[cityId][zoneId]) || []).slice();
    },
    addComment(cityId, zoneId, text) {
      const clean = cleanInput(text, 240);
      if (!clean) return;
      if (store.addComment) return store.addComment(cityId, zoneId, clean);
      store.setState(s => {
        s.comments[cityId] = s.comments[cityId] || {};
        s.comments[cityId][zoneId] = s.comments[cityId][zoneId] || [];
        s.comments[cityId][zoneId].push({ text: clean, date: new Date().toLocaleString('es-CO') });
      });
    },

    // ---- Reportes en vivo ----
    // rep = { ciudad, zona, tipo, nivel, note, alias, anon, photo, coords }
    addReport(rep) {
      const report = Object.assign({}, rep, {
        id: uid(), ts: Date.now(),
        estado: 'pendiente', votos: 0, resueltos: 0,
        note: cleanInput(rep.note, 240),
        alias: rep.anon ? '' : cleanInput(rep.alias, 40),
        anon: !!rep.anon
      });
      if (store.addReport) { store.addReport(report); return report; }
      store.setState(s => { s.reports.unshift(report); });
      return report;
    },
    voteReport(id) {
      if (store.voteReport) return store.voteReport(id);
      store.setState(s => { const r = s.reports.find(x => x.id === id); if (r) r.votos = (r.votos || 0) + 1; });
    },
    resolveReport(id) {
      if (store.resolveReport) return store.resolveReport(id);
      store.setState(s => {
        const r = s.reports.find(x => x.id === id);
        if (r) { r.resueltos = (r.resueltos || 0) + 1; if (r.resueltos >= 1) r.estado = 'resuelto'; }
      });
    },
    getReports(opts) {
      opts = opts || {};
      let list = store.getState().reports.slice().sort((a, b) => b.ts - a.ts);
      if (opts.city) list = list.filter(r => r.ciudad === opts.city);
      if (opts.zone) { const z = String(opts.zone).toLowerCase(); list = list.filter(r => String(r.zona).toLowerCase() === z); }
      if (opts.type && opts.type !== 'todos') list = list.filter(r => r.tipo === opts.type);
      if (opts.status && opts.status !== 'todos') list = list.filter(r => (r.estado || 'pendiente') === opts.status);
      if (opts.sinceHours) { const min = Date.now() - opts.sinceHours * 3600000; list = list.filter(r => r.ts >= min); }
      if (opts.freshOnly) { const min = Date.now() - REPORT_TTL_H * 3600000; list = list.filter(r => r.ts >= min); }
      if (opts.limit) list = list.slice(0, opts.limit);
      return list;
    },
    // Conteo de reportes vigentes por zona → alimenta los badges de "cluster" del mapa.
    countByZone(cityId) {
      const map = {};
      this.getReports({ city: cityId, freshOnly: true }).forEach(r => { map[r.zona] = (map[r.zona] || 0) + 1; });
      return map;
    },
    isStale(report) { return (Date.now() - report.ts) > REPORT_TTL_H * 3600000; },
    clearReports() { if (store.clearReports) return store.clearReports(); store.setState(s => { s.reports = []; }); },

    // ---- Utilidades de tiempo ----
    timeAgo(ts) {
      const m = Math.round((Date.now() - ts) / 60000);
      if (m < 1) return 'ahora mismo';
      if (m < 60) return `hace ${m} min`;
      const h = Math.round(m / 60); if (h < 24) return `hace ${h} h`;
      const d = Math.round(h / 24); return d === 1 ? 'ayer' : `hace ${d} días`;
    },

    // ---- Datos semilla ----
    _seedData() {
      const now = Date.now(), h = 3600000;
      return [
        { ciudad:'bogota', zona:'Kennedy', tipo:'robo', nivel:'alto', note:'Hurto de celular a la salida del portal.', alias:'Vecino K', anon:false, votos:4, resueltos:0, estado:'pendiente', ts: now-0.4*h },
        { ciudad:'bogota', zona:'Kennedy', tipo:'sospechoso', nivel:'medio', note:'Moto merodeando frente al colegio.', alias:'', anon:true, votos:1, resueltos:0, estado:'pendiente', ts: now-1.1*h },
        { ciudad:'bogota', zona:'Chapinero', tipo:'acoso', nivel:'medio', note:'Acoso callejero cerca de la Av. Caracas.', alias:'', anon:true, votos:2, resueltos:0, estado:'pendiente', ts: now-1.5*h },
        { ciudad:'bogota', zona:'Santafé', tipo:'iluminacion', nivel:'medio', note:'Varias luminarias apagadas en la cuadra.', alias:'Ana', anon:false, votos:6, resueltos:3, estado:'resuelto', ts: now-5*h },
        { ciudad:'chia', zona:'Chía', tipo:'sospechoso', nivel:'bajo', note:'Persona merodeando vehículos en el parque principal.', alias:'', anon:true, votos:1, resueltos:0, estado:'pendiente', ts: now-9*h }
      ];
    },
    // Siembra datos de demostración solo si está vacío.
    // En Firestore la siembra es asíncrona y solo la corre el primer visitante.
    seedIfEmpty() {
      if (store.seed) { store.seed(this._seedData()); return; }
      if (store.getState().reports.length) return;
      const seed = this._seedData();
      store.setState(s => { s.reports = seed.map(r => Object.assign({ id: uid() }, r)); });
    }
  };

  AlertaData._bindStore(); // conecta el store inicial (LocalStore)
  global.AlertaData = AlertaData;
})(window);

/* ============================================================================
   ZONES_DATA — geometría real (paths SVG) inyectada al final para mantener el
   módulo legible. Bogotá: 20 localidades (DANE). Chía: municipio + vecinos.
   ========================================================================== */
window.AlertaData.setZonesData((function () {
  return {
    BOGOTA: [
  { id:"suba", name:"SUBA", base:"#3a4fb0", cx:533.4, cy:118.7, fs:23, d:"M580.9,46.9L554.8,206.3L541.3,203L531.8,208L527.7,199L523.4,197.6L522,194.2L519.1,192.8L519.6,184.7L516.3,179.1L513.4,178.1L509.6,171.2L505.7,170.1L505.3,166.6L501.3,163.8L501.1,161.5L495.9,159.6L489.7,154.3L489.1,151.3L483.3,148.8L482.1,145.8L475.9,145.1L474.4,148.3L472.8,148.2L469.3,143.9L471.4,138.4L476.5,137L474.6,132.9L478,133.6L479.8,136.8L476.9,129.1L482.4,128.8L481.5,122.4L486.5,120.1L488.1,113.9L484.8,114.4L489,110L489.4,108.4L486.8,108.3L489.9,101.3L486.1,102L489.4,99.1L486.1,98.4L489.3,96.6L488.9,92.7L491.8,94L489.4,91.2L491,87.4L494.3,87.3L491.6,88.3L492.5,90.9L496.6,89L499.8,79.8L502.2,79.1L501.4,81.9L502.7,81.6L505,77.2L510.3,77L513.3,86.6L520.5,80.5L515.5,80L518.9,78.3L518.4,74.6L520.6,74.2L519,72.4L528.8,66.4L528.7,64.7L523.4,62.2L525.1,59.7L520.6,57.8L521.2,52L524.8,50.7L526.4,57.3L529.9,51.9L528.5,47.4L521.2,39.2L535,34L538.2,36.9L539.4,43.5L543.5,44L544.4,35.8L546,36.1L546.5,41.4L548.2,35.2L550.9,44.6L551.4,43.3L556.2,43L559.4,38.1L564.3,40.9L563.2,35.7L565.9,41L568.2,41.1L569.8,38.2L573.7,45.7L580.5,46.8L580.9,46.9Z" },
  { id:"usaquen", name:"USAQUÉN", base:"#f6a821", cx:588.4, cy:142.5, fs:19, d:"M554.8,206.3L580.9,46.9L593.2,51L613.8,51.2L616.2,54.8L615.2,64L621.5,70.8L614.3,77.9L611,79.8L606,79.1L604.5,81.4L602.2,90.1L602.7,104L598.5,113L598.5,117.7L610.1,128.5L609.4,134.1L612,142.9L610.8,167.6L612.4,172.3L609.2,173.6L604.1,194.2L607.7,198.6L606.5,201.1L607.6,209.7L616,215.2L617.6,219L616.9,223L611.2,231.2L608,233L606.7,230.1L603.8,229.6L604.8,226.2L598.7,221.2L593,218.9L585.4,219.2L584.4,217.2L560.6,207.4L554.8,206.3Z" },
  { id:"engativa", name:"ENGATIVÁ", base:"#e2543a", cx:490.7, cy:189.7, fs:16, d:"M474.4,148.3L475.9,145.1L482.1,145.8L483.3,148.8L489.1,151.3L489.7,154.3L495.9,159.6L501.1,161.5L501.3,163.8L505.3,166.6L505.7,170.1L509.6,171.2L513.4,178.1L516.3,179.1L519.6,184.7L519.1,192.8L522,194.2L523.4,197.6L527.7,199L531.8,208L522.8,215.4L501.9,244.6L481.9,213L477.6,208.6L484.7,204.2L482.5,200.1L443,170.9L441.2,171.4L436.6,167.9L437,164.4L439.4,161.8L441,164.2L447.2,165L450.1,161.4L463,155.8L465,158.6L470.8,155.7L473,160.4L476,157L473.5,152.1L474.5,148.3L474.4,148.3Z" },
  { id:"fontibon", name:"FONTIBÓN", base:"#37a9d4", cx:459.8, cy:216.1, fs:16, d:"M442.2,170.5L482.5,200.1L484.7,204.2L477.6,208.6L481.9,213L501.9,244.6L484.8,263.1L478.5,259.2L476.4,254.1L472.4,250.3L468.8,249.9L463.3,238.5L458.9,233.9L454.5,235.7L447.2,232.4L443.3,232.2L440.4,235.4L435.8,231.7L436.3,229L425.4,226.5L425.8,223.6L429.7,221.9L432.3,224.2L434.3,219.6L439.8,217.1L440.5,214.9L437,210.8L434.5,213L436.8,216.1L431.8,219.1L430.3,216.3L426.1,219.5L424.4,217.4L423.8,220.7L420,218.1L421.4,211.1L428.3,204.9L422.9,197.6L426.5,190.2L420.4,190.5L417.6,188L434.9,184.4L434.6,182.8L436.6,181.8L441.5,181.9L443,179.1L442.1,171.7L442.2,170.5Z" },
  { id:"barrios_unidos", name:"B. UNIDOS", base:"#37a9d4", cx:535.8, cy:226.3, fs:12, d:"M554.8,206.3L546.4,249.1L525.7,245.3L522.8,243.5L513,230.2L522.8,215.4L538.9,203.4L554.8,206.3L554.8,206.3Z" },
  { id:"chapinero", name:"CHAPINERO", base:"#e2543a", cx:578.2, cy:254.4, fs:14, d:"M554.8,206.3L565,208.4L584.4,217.2L585.5,219.3L595.6,219.9L604.8,226.2L603.8,229.6L606.7,230.1L608,233L604.1,232.6L598.1,235.5L592.1,234.7L591.1,241.1L587.2,244.5L588.4,249.9L584.3,254.4L587.5,256.7L609.7,261.5L608.3,268.9L609.6,275.9L612.5,276.8L616.2,275L621.2,275.2L629,271.5L635.4,271L635.8,273L630.2,280.2L630.5,285.6L626.8,289.8L616.2,287.2L611.5,288.2L605,284.7L600,289.5L595.6,290.3L588.2,285.6L583.3,288.3L584.3,286.5L579.3,286L574.9,291.2L570.5,291.7L565.6,286.8L563.8,281.3L545.7,277.3L542,273L548.8,241.8L554.8,206.3Z" },
  { id:"teusaquillo", name:"TEUSAQUILLO", base:"#37a9d4", cx:522.1, cy:258.7, fs:11, d:"M513,230.2L524.6,244.8L546.4,249.1L540.5,281.3L537,288.4L530.1,278.7L515.6,276.6L493.8,254.2L501.9,244.6L513,230.2Z" },
  { id:"kennedy", name:"KENNEDY", base:"#3a4fb0", cx:445.5, cy:271.2, fs:19, d:"M438.7,234L440.4,235.4L443.3,232.2L446.9,232.3L454.5,235.7L458.9,233.9L463.3,238.5L468.8,249.9L472.4,250.3L476.4,254.1L478.5,259.2L484.8,263.1L477.7,278.6L472.5,295.5L462.5,312L445.9,311.1L448.9,310.9L445.9,305.4L434,298.9L427.2,301.3L425.5,305.5L421,306L420.4,304.6L422.3,302.5L419.2,302.2L418.8,304.7L416.9,305L418.6,302L418,300L415.7,299.9L417.1,298.8L417.2,294.9L411.9,289.7L414.7,287.3L411.8,289.3L411,286.5L408.2,288L408.1,284.5L414,284.9L418.1,278.5L416.6,272L407.6,252.1L411.6,249.6L414,245.6L422.9,240.4L428.3,241.3L429.9,237.3L432.4,238.8L434.4,233.3L438.4,234.2L438.7,234Z" },
  { id:"bosa", name:"BOSA", base:"#37a9d4", cx:397.4, cy:281.3, fs:16, d:"M407.6,252.1L416.6,272L418.1,278.5L414,284.9L408.1,284.5L408.3,288.1L411,286.5L411.8,289.3L414.7,287.3L411.9,289.7L417.2,294.9L417.1,298.8L415.7,299.9L418,300L418.6,302L416.7,304.9L418.8,304.7L419.2,302.2L422.3,302.5L420.4,304.6L421,306L425.5,305.5L427.2,301.3L433.4,298.9L438,300L446,305.6L433.2,311.1L409.6,310.3L386.5,305.3L386.3,306.8L370.2,287.5L370.1,285.6L366.3,284.4L367.3,283.2L365.5,281.8L367.5,279.6L364.2,276.9L366.7,271.6L373,271.4L371.1,265.8L374.3,263.3L373.1,260.1L368.2,258.2L366.8,255.5L373.4,255.2L375.7,259.7L383.1,259.4L384.9,257.5L383.4,252.6L390.2,255.7L387.8,252.7L394.8,248.1L398.6,242.7L406.3,247L409.9,245.5L407.6,252L407.6,252.1Z" },
  { id:"puente_aranda", name:"PUENTE ARANDA", base:"#e2543a", cx:492.5, cy:287.4, fs:11, d:"M484.8,263.1L493.8,254.2L515.6,276.6L525.1,277.7L504.1,303.2L497.7,308.2L481.9,313.3L470.6,313.8L462.5,312L472.5,295.5L477.7,278.6L484.7,263.3L484.8,263.1Z" },
  { id:"martires", name:"MÁRTIRES", base:"#f6a821", cx:519.5, cy:297.9, fs:10, d:"M537,288.4L532.5,296.9L518.4,315.6L506.9,312L502.1,312.3L497.7,308.2L506.8,300.4L525.1,277.7L530.1,278.7L536.8,288.2L537,288.4Z" },
  { id:"candelaria", name:"CANDELARIA", base:"#f6a821", cx:537.8, cy:310.1, fs:9, d:"M544.6,302.5L549,302.4L552.5,304.6L545.9,307.2L546.3,309.1L544.4,309.3L542.2,313.5L542.1,317.8L539.5,316L537.1,318.8L529,316.4L527.1,312.4L532.6,303.7L539,305.4L544.5,302.5L544.6,302.5Z" },
  { id:"santa_fe", name:"SANTAFÉ", base:"#37a9d4", cx:577, cy:312.9, fs:12, d:"M542,273L545.7,277.3L563.8,281.3L565.6,286.8L570.5,291.7L574.9,291.2L579.3,286L584.3,286.5L583.3,288.3L588.2,285.6L595.6,290.3L600,289.5L605,284.7L611.5,288.2L616.2,287.2L626.7,289.7L626.8,295.1L624.3,298.9L627.6,305.5L621.3,314.6L617.2,315.2L618.6,318.5L616.2,321L613.5,330.7L615.3,336.3L612.6,345.8L612.8,352.8L599.7,351.8L596.4,353L594.8,356.6L592.9,357L587.2,354.1L586.8,349.8L583.2,343.6L584.1,339.9L581.8,337.8L579,339.3L578.1,338.1L570.4,338.4L564.3,336.6L550.8,329.9L544.5,325L540.2,332.6L538.4,333.1L537.8,331.7L535.6,333.4L527.8,322.5L518.4,315.6L533.2,295.7L540.3,281.9L541.9,274L542,273ZM544.6,302.5L539,305.4L532.6,303.7L527.1,312.4L528.6,316.2L537.1,318.8L539.5,316L542.2,317.7L542.2,313.5L544.4,309.3L546.3,309.1L546.1,307L552.5,304.7L549,302.4L544.6,302.5L544.6,302.5Z" },
  { id:"antonio_narino", name:"A. NARIÑO", base:"#e2543a", cx:502.2, cy:319, fs:9, d:"M470.6,313.8L481.9,313.3L497.7,308.2L502.1,312.3L506.9,312L516.5,314.7L523.1,318.4L512,334L502.8,327.6L495.6,318.5L486.5,319.4L477.8,317.7L470.6,313.8L470.6,313.8Z" },
  { id:"tunjuelito", name:"TUNJUELITO", base:"#f6a821", cx:464.5, cy:334.8, fs:11, d:"M462.5,312L473.4,314.6L473,321.5L470.4,322.4L476.9,341.1L475.3,344.7L481.1,356.5L481.6,368.9L473.3,369.4L472.1,367.3L474.9,366.8L475.7,368.1L476.7,366.5L474.8,364.1L468.9,363.7L467.8,356.5L465.4,355.4L466.9,355.1L467,351.4L459.5,346.4L459.4,342.6L458,342L459.4,340.1L456.3,337.6L458.9,333.7L457,332.2L454.4,337.2L452.5,335.1L451.4,336.3L451.9,333.2L448.5,331.1L449.3,327.5L451.7,326.9L450.2,325.3L447.2,326.2L447.8,323.9L446,322.9L447.9,320L445.5,319.1L446.5,320.6L445,321.8L444.7,320.1L440.5,319.1L443.6,316.2L446.9,316L446.1,314.1L443.7,314.4L445.9,311.1L459.5,311.5L462.5,312Z" },
  { id:"rafael_uribe", name:"RAFAEL URIBE", base:"#37a9d4", cx:490.4, cy:344.6, fs:11, d:"M512,334L498.6,347.7L503.8,356.9L502.2,367.2L503.2,368.3L501.6,368.8L507.9,381L491.6,373.2L491.4,374.7L487.1,374.4L481.6,368.9L481.1,356.4L475.2,344.5L476.9,341.1L470.4,322.4L473,321.5L473.4,314.6L477.8,317.7L486.5,319.4L495.6,318.5L502.8,327.6L507,330.4L512,334Z" },
  { id:"san_cristobal", name:"SAN CRISTÓBAL", base:"#e2543a", cx:544.6, cy:365, fs:13, d:"M587.2,354.1L586.7,366.5L584.2,370.3L583.9,375.8L579.6,380.2L576,389.7L571.7,409L562.4,408L556.3,411.5L550,407.6L543.2,409.7L541.4,407.4L539.8,408L538.1,398.7L541.9,388.3L535.8,387.5L530.2,390.1L532.7,384.5L531.3,383.9L529.6,386.6L529.1,384.2L526.8,386.4L528.5,390.6L525.5,389.2L519.8,397.4L526.6,400.6L516.1,398.5L517.8,401.5L511.6,401.3L513.4,394.3L510.7,377.4L509.3,375.2L507.8,375.9L508.3,373.5L506.1,369.9L502.2,367.2L503.8,356.9L498.6,347.7L512,334L523.1,318.4L527.8,322.5L535.6,333.4L537.8,331.7L538.4,333.1L540.2,332.6L544.5,325L550.8,329.9L564.3,336.6L570.4,338.4L578.1,338.1L579,339.3L581.8,337.8L584.1,339.9L583.2,343.6L586.8,349.8L587.3,353.8L587.2,354.1Z" },
  { id:"ciudad_bolivar", name:"CIUDAD BOLÍVAR", base:"#e2543a", cx:434.9, cy:441.4, fs:13, d:"M446,306.4L448.9,311.1L446.5,310.3L443.7,314.4L446.1,314.1L446.9,316L443.6,316.2L440.5,319.1L444.7,320.1L445,321.8L446.5,320.6L445.5,319.1L447.9,320L446,322.9L447.8,323.9L447.2,326.2L450.2,325.3L451.7,326.9L449.3,327.5L448.5,331.1L451.9,333.2L451.4,336.3L452.5,335.1L454.4,337.2L457,332.2L458.9,333.7L456.3,337.6L459.4,340.1L458,342L459.4,342.6L459.5,346.4L467,351.4L466.9,355.1L465.4,355.4L467.8,356.5L468.9,363.7L474.8,364.1L476.7,366.5L475.7,368.1L474.9,366.8L471.4,368L477.3,370.3L479.4,384L479.2,389.6L472.6,393L476.5,398L474.5,408.8L475.2,414L473.2,415.9L475,419.6L479.8,421.5L481.3,429.2L479.3,430.9L482.4,431.6L480.8,439.3L477.7,445.2L473.2,449.6L471.1,448.3L463.7,459.9L462,460.4L462.7,462.8L460.5,469.4L455.1,480.6L457,497L455.5,498.2L454.5,511.2L455.7,513.1L454.2,518.7L456.2,526.7L455.1,533.2L458.7,545.2L456.8,550.2L447.1,550.8L438.7,547.4L434,548.1L428.1,553.2L418,549.2L412.3,554.9L396.9,550.9L387.8,552.1L378.7,551.2L376.2,541.3L382.3,530.1L381.8,527.1L386.5,519.5L387.3,513.8L392.5,505.8L397.8,505.3L397.2,496.1L401.6,487L402.1,481.8L406.8,476L406.7,468.9L410.3,460.7L411.2,444.1L416.4,436.8L415,432.3L415.5,425.1L412.4,416.4L421.7,412.1L418.5,406.7L411.6,406.2L410.4,389.6L404.8,383.4L409.6,380.1L417.1,378.1L421.9,373.9L418.3,368.5L421.3,361.8L417.5,359.2L418.3,351.6L415.8,340.5L419.4,338.6L419.8,334.9L416.8,331.9L414.5,332L413.1,320.1L409.8,310.3L430.6,311.1L438.5,309.6L446,306.4Z" },
  { id:"usme", name:"USME", base:"#3a4fb0", cx:456.7, cy:547.6, fs:18, d:"M475.9,369.6L481.6,368.9L487.1,374.4L491.4,374.7L491.6,373.2L507.9,381L501.6,368.8L505.3,369.2L508.3,373.5L507.8,375.9L509.3,375.2L510.7,377.4L513.3,393.8L512.2,401.6L517.8,401.5L516.1,398.5L526.6,400.6L519.8,397.4L525.5,389.2L528.5,390.6L526.6,387.1L529.1,384.2L529.5,386.6L530.6,384L532.7,384.5L530.2,390.1L535.7,387.5L540.5,387.3L541.9,388.9L538,400L539.6,407.8L541.4,407.4L542.1,409.7L550,407.6L556.3,411.5L552.6,424.5L545.8,436.7L541.4,436.2L534.1,438.9L533.2,451.5L534.4,456.3L532.1,460.3L532.3,465.1L529.2,465.2L527.1,469.2L523.5,470.9L517.2,468.1L513.6,471.7L502.1,475.9L499.2,482.8L495.4,486.4L492,495.5L490.8,517.6L489.3,521L490.7,525.1L488.9,529.1L489,538.8L490.8,542.7L490,551.6L493,552.3L500,560.8L506.8,560.5L507.3,565.8L511.3,570.7L512.2,577.3L508.4,585.1L507.5,598.3L503,606.3L499.8,608.8L500.9,613.4L497.8,622.3L493.2,623.7L492,627.8L489.4,630.3L489.1,635.5L477.8,643.5L468.7,644.1L462.9,646.2L437.7,669.1L425.7,671.4L407.9,671.9L404.7,670.7L397,662.5L388.9,670.9L385.5,678.6L384.5,686L377.2,681.6L372.6,682.1L372,677.8L367,671.6L372.7,666.2L374.8,646.5L370,619.7L370.6,610.6L368.5,604.8L366.9,577.5L371.5,574.1L377.2,565.7L374.9,563.3L378.8,556.7L378.7,551.2L387.8,552.1L396.9,550.9L412.3,554.9L417.2,549.3L428.1,553.2L434,548.1L438.7,547.4L447.1,550.8L456.8,550.2L458.5,545.8L455.1,533.2L456.2,526.7L454.2,518.7L455.7,513.1L454.5,511.2L455.5,498.2L457,497L455.1,480.6L460.5,469.4L462.7,462.8L462,460.4L463.7,459.9L471.1,448.3L473.2,449.6L477.7,445.2L480.8,439.3L482.4,431.7L479.3,430.9L481.3,429.2L479.8,421.5L475,419.6L473.2,415.9L475.2,414L474.5,408.8L476.5,398L472.6,393L479.2,389.6L479.3,387.6L477.3,370.5L476,369.7L475.9,369.6Z" },
  { id:"sumapaz", name:"SUMAPAZ", base:"#e2543a", cx:941, cy:671, fs:12, inset:true, d:"M906,648h70v46h-70Z" },
    ],
    CHIA: [
  { id:"cajica", name:"CAJICÁ", base:"#3a4fb0", cx:356.1, cy:256.9, fs:14, d:"M387.3,215.4L389.2,218.5L381.9,233.5L382.7,242L376.7,247.5L380,257.5L374.2,264.3L378.6,268.8L376.5,275.1L381.3,278.5L373.1,288.2L368.3,291L364,300.4L338.1,292.9L338.1,288.7L329.3,285.5L317.3,275.9L311.5,275L312.6,270.6L320,265.9L324.3,258.8L332.8,253.1L335,246L342.4,233.2L370.7,214.8L373.2,204.7L384.9,204.2L387.3,215.4Z" },
  { id:"cota", name:"COTA", base:"#37a9d4", cx:267.4, cy:392.4, fs:14, d:"M306.7,347.8L303.1,349.9L309.7,360.1L302.6,361.2L302,365.9L308.8,373.2L300.7,378L301.8,384.8L296,390L293.9,382.1L284.8,384.2L282.1,392L275.6,395L275.9,408.5L273.7,417.5L265.7,425L261.2,432.6L265.2,448.3L254.1,447.1L243.2,452L235.8,452.3L242,448.4L242.6,437.1L234.9,434.2L230,428.9L239.6,416.1L231.9,403.9L236.1,394.7L245.6,380.1L258.1,367.9L271.8,366.2L279.1,350.9L290.6,341.2L294.7,335L302.1,336.5L311,342.4L306.7,347.8Z" },
  { id:"la_calera", name:"LA CALERA", base:"#f6a821", cx:451.6, cy:475.7, fs:13, d:"M423.1,369.3L423.1,378.4L420.1,382.4L437.5,390.3L440.2,393.6L456.9,396.5L468.3,411.1L473.7,413.8L477.8,422.2L488.8,428.7L492.1,434L505.9,435L507.5,446L505.4,451.7L510.6,466.6L520.2,459.9L524.7,473.8L526.2,488.9L561.6,489.4L567.5,494.2L575.5,491.6L581,494.4L582.6,505.9L579.6,511.5L581.5,520.4L581.4,535.8L572.2,536.5L564.8,532.6L545,534L539.4,537.3L533.2,535.3L521.5,537L510.6,533.6L504.3,533.7L493.2,538.6L488.3,543.3L486.1,553.3L478.1,561.6L470.8,578.4L467.5,580L459.1,571.9L449.5,554.3L440,550.1L443.5,538.2L447.9,532.4L437,531.9L426.4,520L421.2,521.3L416.3,531.5L396.6,542L385.8,545.9L375.4,546.2L375.7,535.3L357.7,530.8L357.6,520L363.6,511.9L369.3,513L377.9,510.3L383.2,499.6L374.6,492.6L371,478.2L375.1,462L377.6,461.1L376.5,444.1L377.8,438.9L376.2,424.2L367,414.6L369.6,404.7L369.6,388.7L372.7,382.9L378.7,383.4L385.5,378.7L379.4,370.9L381.3,367L378.3,359L385.2,369L399.6,368.2L423.1,369.3Z" },
  { id:"sopo", name:"SOPÓ", base:"#f6a821", cx:416.8, cy:297.3, fs:14, d:"M393.1,217.2L408.7,226.3L415.1,243.1L423.6,243.4L433.9,249.1L442.2,257.8L448.5,260.2L455.8,269L464.5,272.9L456.3,289.2L461.3,300.9L459.6,308.1L455,310.6L456,323.5L449.6,339.9L450.1,343.1L440.6,347.5L425,343.1L425.8,354.4L423.1,369.3L399.6,368.2L385.2,369L378.3,359L384.9,337.8L389.6,333.9L394.7,311.5L397.8,305.7L399.1,291.5L401.6,283.4L394.4,283.2L386.8,277.7L374.2,264.3L380,257.5L376.7,247.5L382.7,242L381.9,233.5L389.2,218.5L387.3,215.4L393.1,217.2Z" },
  { id:"tabio", name:"TABIO", base:"#37a9d4", cx:304.6, cy:236.6, fs:13, d:"M353.5,225.8L342.4,233.2L335,246L332.8,253.1L324.3,258.8L320,265.9L312.6,270.6L306.6,292.3L297.1,293.3L288.6,286.9L278.6,287.4L272.8,283.1L262.2,281.4L261.1,274.2L272.3,264L276.7,247L277,237.4L281.9,224.5L282.1,212.2L284.9,202L284.6,190.2L287.6,182.9L297.7,184.7L301.5,180.1L309.1,184.3L323.3,185.2L321.4,195.8L323.9,201.2L336.7,206.7L338.6,211.2L346.8,214.4L353.5,225.8Z" },
  { id:"tenjo", name:"TENJO", base:"#3a4fb0", cx:245.4, cy:344.4, fs:14, d:"M306.6,292.3L305.9,318.8L290.6,341.2L279.1,350.9L271.8,366.2L258.1,367.9L245.6,380.1L236.1,394.7L231.9,403.9L239.6,416.1L230,428.9L223.5,417.4L221,406.4L212.9,406L202.8,410.1L198.7,402.5L199.5,395.2L194.1,388.7L179.3,403L177.4,387.1L185.3,381L192.2,380L206.4,343.9L215.3,339.4L218.4,328.7L216.1,326.1L215.9,318.3L223.6,313.3L225.7,305.2L237.2,297.3L246.1,294.9L262.2,281.4L272.8,283.1L278.6,287.4L288.6,286.9L297.1,293.3L306.6,292.3Z" },
  { id:"tocancipa", name:"TOCANCIPÁ", base:"#e2543a", cx:452.1, cy:220.5, fs:12, d:"M504.1,225.6L485.7,241.6L476.3,251.8L471.6,264L464.5,272.9L455.8,269L448.5,260.2L442.2,257.8L433.9,249.1L423.6,243.4L415.1,243.1L408.7,226.3L393.1,217.2L399,208.9L397.1,200.4L403.1,195.5L411,193.9L417.1,199.1L420.7,210.9L418.2,216.2L423.6,220.6L433.4,218.2L436.2,211.4L443,207.8L441.4,198.4L436.4,184.3L444.3,181.1L465.4,169.1L467.8,164.1L474,170.4L472.5,174.6L488.3,204.2L481.1,214L486.9,215.7L493.6,222.5L504.1,225.6Z" },
  { id:"zipaquira", name:"ZIPAQUIRÁ", base:"#37a9d4", cx:362.8, cy:146.7, fs:13, d:"M341.1,40L349,51.7L347.5,60.7L360.6,63.5L369.4,68.3L377.8,69.6L378.6,74.8L369.4,87.7L378.7,94.9L375.4,108.1L365.8,118.2L365.2,131.3L362.3,138.5L357.6,142.1L359.2,147.6L371.2,144.2L388.8,145.7L398.6,149.7L412.1,149.2L419,152.5L430.9,148.3L432.9,155.7L445.7,149.2L450,153L466.2,161.4L467.8,164.1L465.4,169.1L444.3,181.1L436.4,184.3L441.4,198.4L443,207.8L436.2,211.4L433.4,218.2L423.6,220.6L418.2,216.2L420.7,210.9L417.1,199.1L411,193.9L403.1,195.5L397.1,200.4L399,208.9L393.1,217.2L387.3,215.4L384.9,204.2L373.2,204.7L370.7,214.8L353.5,225.8L346.8,214.4L338.6,211.2L336.7,206.7L323.9,201.2L321.4,195.8L323.3,185.2L309.1,184.3L301.5,180.1L302.6,165.6L308.9,152.1L299.8,142.9L294.2,131.9L295.7,126.7L299.5,128.7L305.9,124.1L311.8,108.1L310.4,101.3L311,77.1L318.2,69.1L314.3,54.4L320.9,44L331.5,50.4L341.1,40Z" },
  { id:"chia", name:"CHÍA", base:"#e2543a", cx:349.6, cy:318.8, fs:22, main:true, d:"M378.3,359L375.9,361.2L354.7,358.8L335.1,350.2L331.4,353.6L324.9,349.9L317.3,353.8L313.5,346.2L306.7,347.8L311,342.4L302.1,336.5L294.7,335L305.9,318.8L306.6,292.3L311.5,275L317.3,275.9L329.3,285.5L338.1,288.7L338.1,292.9L364,300.4L368.3,291L373.1,288.2L381.3,278.5L376.5,275.1L378.6,268.8L386.8,277.7L394.4,283.2L401.6,283.4L399.1,291.5L397.8,305.7L394.7,311.5L389.6,333.9L384.9,337.8L378.3,359Z" }
    ]
  };
})());
