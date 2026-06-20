import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey:            "AIzaSyB4abl61_d1XLQlNKRuVbFY4pdkl1D1cRc",
  authDomain:        "zaoui-26483.firebaseapp.com",
  projectId:         "zaoui-26483",
  storageBucket:     "zaoui-26483.appspot.com",
  messagingSenderId: "868578705083",
  appId:             "1:868578705083:web:895fb2b8c7efde078af39e",
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
