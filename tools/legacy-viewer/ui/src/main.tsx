import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/inter";
import "@fontsource-variable/space-grotesk";
import "@fontsource/geist-mono/latin-400.css";
import "./styles/app.css";
import "./styles/original.css";
import "./styles/lookup.css";
import "./styles/shell.css";
import "./styles/artwork.css";
import { App } from "./app/App";
import { launchHash, readLast } from "./lib/lookup";

// Reopen where the user left off: with no route in the URL, open the last track lookup.
const restored = launchHash(window.location.hash, readLast());
if (restored) window.location.replace(restored);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
