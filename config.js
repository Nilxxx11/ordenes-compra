import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-database.js";

const firebaseConfig = {
    apiKey:            "AIzaSyCwTok9rJApRG7mp-GkYORv8x1m0d_ixyg",
    authDomain:        "vehidiesel.firebaseapp.com",
    projectId:         "vehidiesel",
    storageBucket:     "vehidiesel.firebasestorage.app",
    messagingSenderId: "1029286799133",
    appId:             "1:1029286799133:web:e25ff37901fcaf5cf963f4",
    databaseURL:       "https://vehidiesel-default-rtdb.firebaseio.com",
    measurementId:     "G-TWTRBJS4P8"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db   = getDatabase(app);
