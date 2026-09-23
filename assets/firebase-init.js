/* ============================================================================
   Alerta Barrio — Inicialización de Firebase (módulo ES)
   ----------------------------------------------------------------------------
   Carga el SDK de Firebase desde gstatic, inicializa Firestore, hace login
   anónimo (si procede) y conecta el FirestoreStore a la capa de datos para
   sincronizar reportes/calificaciones/comentarios EN TIEMPO REAL.

   Si algo falla (sin conexión, config desactivada, reglas), la app sigue
   funcionando con localStorage: nunca se rompe.

   Se carga como <script type="module" src="assets/firebase-init.js"> DESPUÉS
   de data.js. Lee la config de window.ALERTA_FIREBASE (firebase-config.js).
   ========================================================================== */
(async function () {
  const CFG = window.ALERTA_FIREBASE;
  if (!CFG || !CFG.USE_FIREBASE) {
    console.info('[Alerta] Firebase desactivado → usando almacenamiento local.');
    return;
  }
  const V = CFG.SDK_VERSION || '12.19.0';
  const base = `https://www.gstatic.com/firebasejs/${V}`;

  try {
    const { initializeApp } = await import(`${base}/firebase-app.js`);
    const {
      getFirestore, collection, addDoc, updateDoc, deleteDoc, doc,
      onSnapshot, query, orderBy, increment, getDocs
    } = await import(`${base}/firebase-firestore.js`);

    const app = initializeApp(CFG.firebaseConfig);
    const db = getFirestore(app);

    // Login anónimo (necesario si las reglas exigen request.auth != null).
    if (CFG.ANON_AUTH) {
      try {
        const { getAuth, signInAnonymously, onAuthStateChanged } = await import(`${base}/firebase-auth.js`);
        const auth = getAuth(app);
        await new Promise((resolve) => {
          onAuthStateChanged(auth, (user) => { if (user) resolve(); });
          signInAnonymously(auth).catch((e) => { console.warn('[Alerta] Auth anónimo falló:', e && e.message); resolve(); });
        });
      } catch (e) {
        console.warn('[Alerta] No se pudo cargar Auth:', e && e.message);
      }
    }

    // API mínima que espera FirestoreStore.
    const fb = { db, collection, addDoc, updateDoc, deleteDoc, doc, onSnapshot, query, orderBy, increment, getDocs };
    const StoreClass = window.AlertaFirestoreStore;
    if (!StoreClass) { console.warn('[Alerta] FirestoreStore no disponible.'); return; }

    window.AlertaData.useStore(new StoreClass(fb));
    console.info('[Alerta] Firebase Firestore conectado ✔ (proyecto ' + CFG.firebaseConfig.projectId + ')');

    // Reavisar a las vistas ya montadas para que se resuscriban al nuevo store.
    document.dispatchEvent(new CustomEvent('alerta:store-changed'));
  } catch (e) {
    console.warn('[Alerta] Firebase no disponible, se usa almacenamiento local:', e && e.message);
  }
})();
