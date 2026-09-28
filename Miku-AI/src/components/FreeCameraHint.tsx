// Cámara libre activa (propuesta de la ronda 2 aprobada, DISENO.md §2.6):
// recuerda que arrastrar sobre Miku mueve la vista en vez de tocarla. Un
// marco turquesa alrededor de la escena y una píldora abajo al centro con
// «Listo» para salir. Sube por encima del panel de controles si está a la
// vista.
export function FreeCameraHint({
  onDone,
  raised,
}: {
  onDone: () => void;
  raised: boolean;
}) {
  return (
    <>
      <div className="free-camera-frame" aria-hidden="true">
        <span className="free-camera-frame-label">ARRASTRA PARA MOVER LA VISTA</span>
      </div>
      <div className={`free-camera-pill ${raised ? "raised" : ""}`} role="status">
        <span>CÁMARA LIBRE</span>
        <button className="free-camera-done" onClick={onDone}>
          Listo
        </button>
      </div>
    </>
  );
}
