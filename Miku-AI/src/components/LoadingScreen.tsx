import type { MouseEvent } from "react";
import { IconLeek } from "./Icons";

// Pantalla de carga (ronda 2, DISENO.md §2.3), sobre la ventana
// transparente, sin fondo opaco:
// 1. Primera vez: tarjeta con la descarga del servidor de voz; el progreso
//    es la tira de teclas, y tres pasos (descargar · verificar · arrancar;
//    "verificar" es el SHA256 que hace voice_server_provision.rs).
// 2. Cada arranque: una píldora con la frase de useLoadingPhrase, mientras
//    el avatar carga detrás y el panel de controles se ve deshabilitado.

type DownloadProgress = { downloaded: number; total: number };

type LoadingScreenProps = {
  downloadProgress: DownloadProgress | null;
  isVoiceReady: boolean;
  phrase: string;
  phraseVisible: boolean;
  // Arrastrar la ventana desde la tarjeta o la píldora (como antes).
  onMouseDown: (e: MouseEvent) => void;
};

const KEY_COUNT = 36;
const OCTAVE_BLACK = [false, true, false, true, false, false, true, false, true, false, true, false];

export function LoadingScreen({ downloadProgress, isVoiceReady, phrase, phraseVisible, onMouseDown }: LoadingScreenProps) {
  if (downloadProgress && !isVoiceReady) {
    const pct = downloadProgress.total > 0 ? Math.round((downloadProgress.downloaded / downloadProgress.total) * 100) : 0;
    const lit = Math.round((pct / 100) * KEY_COUNT);
    // Terminada la descarga, sigue la verificación y el arranque.
    const step = downloadProgress.downloaded >= downloadProgress.total ? 2 : 1;
    return (
      <div className="loading-layer">
        <div className="loading-card" role="status" onMouseDown={onMouseDown}>
          <IconLeek size={56} />
          <h1 className="loading-title">Preparando su voz</h1>
          <p className="loading-text-body">Es la primera vez: falta descargar el servidor de voz. Solo pasa una vez.</p>
          <div className="loading-keys" aria-hidden="true">
            {Array.from({ length: KEY_COUNT }, (_, i) => (
              <span
                key={i}
                className={`loading-key ${OCTAVE_BLACK[i % 12] ? "black" : "white"} ${i < lit ? "lit" : ""}`}
              />
            ))}
          </div>
          <div className="loading-progress">
            <span className="loading-progress-label">{step === 1 ? "DESCARGANDO" : "VERIFICANDO"}</span>
            <span className="loading-progress-pct">{pct}%</span>
          </div>
          <ol className="loading-steps">
            {["DESCARGAR", "VERIFICAR", "ARRANCAR"].map((label, i) => (
              <li
                key={label}
                className={`loading-step ${i + 1 === step ? "current" : ""} ${i + 1 < step ? "done" : ""}`}
                aria-current={i + 1 === step ? "step" : undefined}
              >
                {i + 1} {label}
              </li>
            ))}
          </ol>
        </div>
      </div>
    );
  }

  return (
    <div className="loading-layer">
      <div className="loading-pill" role="status" onMouseDown={onMouseDown}>
        <span className="loading-spinner" />
        <span className={`loading-text ${!isVoiceReady && !phraseVisible ? "loading-text-hidden" : ""}`}>
          {isVoiceReady ? "Cargando a Miku…" : phrase}
        </span>
      </div>
    </div>
  );
}
