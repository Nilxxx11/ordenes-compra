import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-app.js";
import { 
    getAuth, 
    createUserWithEmailAndPassword,
    sendEmailVerification 
} from "https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js";
import { 
    getDatabase 
} from "https://www.gstatic.com/firebasejs/9.22.0/firebase-database.js";

// TU CONFIGURACIÓN DE FIREBASE
const firebaseConfig = {

  apiKey: "AIzaSyCwTok9rJApRG7mp-GkYORv8x1m0d_ixyg",

  authDomain: "vehidiesel.firebaseapp.com",

  projectId: "vehidiesel",

  storageBucket: "vehidiesel.firebasestorage.app",

  messagingSenderId: "1029286799133",

  appId: "1:1029286799133:web:e25ff37901fcaf5cf963f4",

  measurementId: "G-TWTRBJS4P8"

};

// Inicializar Firebase
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getDatabase(app);

// Exportar funciones de autenticación adicionales
export { 
    createUserWithEmailAndPassword, 
    sendEmailVerification 
};