import ReactDOM from "react-dom/client";
// Tipografías del diseño v1, empaquetadas localmente (la app puede arrancar
// sin red). Solo el subconjunto latino: cubre todo el español.
import "@fontsource/dela-gothic-one/latin-400.css";
import "@fontsource/chakra-petch/latin-500.css";
import "@fontsource/chakra-petch/latin-600.css";
import "@fontsource/zen-kaku-gothic-new/latin-400.css";
import "@fontsource/zen-kaku-gothic-new/latin-500.css";
import "@fontsource/zen-kaku-gothic-new/latin-700.css";
import App from "./App";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <App />,
);
