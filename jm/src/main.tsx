import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import App from "./App";
import { initAccent } from "./settings/accent";
import { initTheme } from "./settings/theme";

initTheme();
initAccent();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
