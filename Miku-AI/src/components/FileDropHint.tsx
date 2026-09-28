import { IconAlert, IconFileDrop } from "./Icons";

// Aviso mientras se arrastra un archivo sobre la ventana (ronda 2,
// DISENO.md §2.4). Los textos llevan fondo propio para leerse encima del
// avatar. No recibe clics: el soltar lo maneja el contenedor de App.
//
// Si lo que se arrastra seguro no se puede leer (propuesta aprobada de la
// ronda 2), el borde pasa a rosa y lo avisa antes de soltarlo.
export function FileDropHint({ unsupported = false }: { unsupported?: boolean }) {
  return (
    <div className={`file-drop-hint ${unsupported ? "unsupported" : ""}`} aria-live="polite">
      <div className="file-drop-center">
        <span className="file-drop-icon" aria-hidden="true">
          {unsupported ? <IconAlert size={34} strokeWidth={1.8} /> : <IconFileDrop size={34} strokeWidth={1.8} />}
        </span>
        <span className="file-drop-title">
          {unsupported ? "Miku no puede abrir este tipo de archivo" : "Suéltalo para que Miku lo vea"}
        </span>
        <span className="file-drop-label">{unsupported ? "SOLO IMÁGENES Y ARCHIVOS DE TEXTO" : "IMÁGENES Y ARCHIVOS DE TEXTO"}</span>
      </div>
    </div>
  );
}
