import { useRef } from "react";
import { GMAIL_CHECK_INTERVAL_MS } from "../config/constants";
import { checkForNewMail } from "../lib/gmail/watcher";

type UseGmailWatcherParams = {
  // Ya no habla directo -- correo nuevo no es urgente, se acumula en el
  // resumen agrupado (ver useNotificationDigest.ts) en vez de interrumpir
  // apenas se detecta.
  queueAnnouncement: (text: string) => void;
};

export function useGmailWatcher({ queueAnnouncement }: UseGmailWatcherParams) {
  const lastCheckRef = useRef(performance.now());
  const isCheckingRef = useRef(false);

  // Se llama desde onBeforeRender con el "now" del frame -- mismo patrón
  // que checkIdleQuirk/checkReminders. isCheckingRef evita superponer dos
  // chequeos si uno tarda más que el intervalo (poco probable, pero un
  // problema de red puntual no debería acumular pedidos).
  function checkGmail(now: number) {
    if (isCheckingRef.current || now - lastCheckRef.current < GMAIL_CHECK_INTERVAL_MS) {
      return;
    }
    lastCheckRef.current = now;
    isCheckingRef.current = true;

    checkForNewMail()
      .then((announcement) => {
        if (announcement) queueAnnouncement(announcement);
      })
      .catch((err) => console.error("Error revisando correo nuevo:", err))
      .finally(() => {
        isCheckingRef.current = false;
      });
  }

  return { checkGmail };
}
