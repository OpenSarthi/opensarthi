import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import "./styles/globals.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 2, staleTime: 30_000 },
  },
});

// Apply the platform class before the first paint. Linux WebKitGTK cannot
// composite backdrop blur reliably, so this must never be added after mount.
const ua = navigator.userAgent.toLowerCase();
const platformClass = ua.includes("mac")
  ? "platform-mac"
  : ua.includes("win")
    ? "platform-win"
    : "platform-linux";
document.body.classList.remove("platform-mac", "platform-win", "platform-linux");
document.body.classList.add(platformClass);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>
);
