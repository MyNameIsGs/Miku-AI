import { useEffect, useRef } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { createPortal } from "react-dom";

// Diálogo de confirmación propio (ronda 2, DISENO.md §2.5): reemplaza al
// nativo de Windows, que rompía la estética, no heredaba el "siempre
// encima" de forma fiable y aparecía fuera de la ventana chica.
//
// Va en un portal a <body> para no quedar atrapado en el transform de la
// animación del panel que lo abre. Foco inicial en Cancelar, Esc cierra y
// el foco no sale del diálogo.

type ConfirmDialogProps = {
  title: string;
  children?: ReactNode;
  confirmLabel: string;
  // "danger": acción destructiva (rosa); "primary": no destructiva.
  tone: "danger" | "primary";
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmDialog({ title, children, confirmLabel, tone, onConfirm, onCancel }: ConfirmDialogProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();
    return () => previous?.focus?.();
  }, []);

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onCancel();
      return;
    }
    if (e.key !== "Tab") return;
    const focusable = cardRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled)");
    if (!focusable || focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    <div className="m-dialog-layer" onKeyDown={handleKeyDown}>
      <div className="m-dialog-scrim" onClick={onCancel} />
      <div ref={cardRef} className="m-dialog" role="dialog" aria-modal="true" aria-labelledby="m-dialog-title">
        <h2 id="m-dialog-title" className="m-dialog-title">
          {title}
        </h2>
        {children}
        <div className="m-dialog-actions">
          <button ref={cancelRef} className="m-btn" onClick={onCancel}>
            Cancelar
          </button>
          <button className={`m-btn ${tone === "danger" ? "m-btn-danger" : "m-btn-primary"}`} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
