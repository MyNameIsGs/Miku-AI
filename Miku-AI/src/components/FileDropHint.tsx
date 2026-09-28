import { IconFileDrop } from "./Icons";

// Aviso mientras se arrastra un archivo sobre la ventana (ronda 2,
// DISENO.md §2.4). Los textos llevan fondo propio para leerse encima del
// avatar. No recibe clics: el soltar lo maneja el contenedor de App.
export function FileDropHint() {
  return (
    <div className="file-drop-hint" aria-live="polite">
      <div className="file-drop-center">
        <span className="file-drop-icon" aria-hidden="true">
          <IconFileDrop size={34} strokeWidth={1.8} />
        </span>
        <span className="file-drop-title">Suéltalo para que Miku lo vea</span>
        <span className="file-drop-label">IMÁGENES Y ARCHIVOS DE TEXTO</span>
      </div>
    </div>
  );
}
