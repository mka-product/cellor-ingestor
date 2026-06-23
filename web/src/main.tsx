import React from "react";
import ReactDOM from "react-dom/client";

import "./app/workspace.css";
import { AuthProvider } from "./components/auth/AuthContext";
import { App } from "./app/App";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </React.StrictMode>
);
