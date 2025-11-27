import React from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import "./index.css";
import "./firebase";
import { AuthProvider } from "./contexts/AuthContext";
import App from "./App";
import Match from "./routes/Match";
import Round from "./routes/Round";
import Teams from "./routes/Teams";
import Login from "./routes/Login";
import Setup from "./routes/Setup";

const router = createBrowserRouter([
  { path: "/", element: <App /> },
  { path: "/round/:roundId", element: <Round /> },
  { path: "/match/:matchId", element: <Match /> },
  { path: "/teams", element: <Teams /> },
  { path: "/login", element: <Login /> },
  { path: "/setup", element: <Setup /> },
]);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  </React.StrictMode>
);