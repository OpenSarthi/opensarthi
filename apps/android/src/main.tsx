import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
// Shared design system CSS — imported via server.fs.allow in vite.config.ts
import "../../desktop/src/styles/globals.css";


ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
