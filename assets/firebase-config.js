/* ============================================================================
   Alerta Barrio — Configuración de Firebase
   ----------------------------------------------------------------------------
   Estas claves son PÚBLICAS por diseño (van en el frontend). Lo que protege
   tus datos son las REGLAS de Firestore que ya publicaste, no ocultar esto.
   ----------------------------------------------------------------------------
   Para DESACTIVAR Firebase y volver a modo local: pon USE_FIREBASE = false.
   Si activaste reglas con Auth anónimo (Opción B), deja ANON_AUTH = true.
   ========================================================================== */
window.ALERTA_FIREBASE = {
  // true → sincroniza en la nube (Firestore). false → solo localStorage.
  USE_FIREBASE: true,

  // true → inicia sesión anónima antes de escribir (requerido por las reglas
  // "Opción B"). Si usaste la "Opción A" (escritura libre), puedes dejarlo en
  // true igualmente (no molesta) o ponerlo en false.
  ANON_AUTH: true,

  // Versión del SDK web de Firebase (módulos ES desde gstatic).
  SDK_VERSION: '12.19.0',

  firebaseConfig: {
    apiKey: "AIzaSyAOuk1UKL1_4nC3a2xTxDt6g-UKc64e8xA",
    authDomain: "alerta-barrio-96e66.firebaseapp.com",
    projectId: "alerta-barrio-96e66",
    storageBucket: "alerta-barrio-96e66.firebasestorage.app",
    messagingSenderId: "253287880149",
    appId: "1:253287880149:web:58a8c55b3e16c1a3cc595c",
    measurementId: "G-1WY8E0SBK7"
  }
};
