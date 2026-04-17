import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { initializePwaRegistration } from "./lib/pwa";
import "./styles.css";

initializePwaRegistration();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
