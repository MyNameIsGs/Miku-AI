import { useEffect, useRef } from "react";
import { load } from "@tauri-apps/plugin-store";
import { MEMORY_CONSOLIDATION_THRESHOLD, OPENROUTER_MODEL } from "../config/constants";
import { fetchOpenRouterWithRetry } from "../lib/openrouter";
import {
  loadMemoryContext,
  appendToMemoryFile,
  backupAndOverwriteMemoryFile,
} from "../lib/memory";

export function useMemoryFiles() {
  const memoryWriteCountRef = useRef(0);
  const isMemoryCountLoaded = useRef(false);

  useEffect(() => {
    (async () => {
      try {
        const store = await load(".settings.dat", { autoSave: false });
        const savedCount = await store.get<number>("memoryWriteCount");
        if (savedCount !== null && savedCount !== undefined) {
          memoryWriteCountRef.current = savedCount;
        }
        isMemoryCountLoaded.current = true;
      } catch (err) {
        console.error("Error cargando contador de memoria guardado:", err);
      }
    })();
  }, []);

  async function consolidateMemoryFile(
    file: "personality" | "memories",
    currentContent: string,
  ): Promise<string> {
    const instruction =
      file === "personality"
        ? `Este es tu archivo de personalidad actual. Reescríbelo completo de forma más concisa: fusiona ideas repetidas en una sola línea, elimina duplicados, conserva todo lo genuinamente distinto. Responde SOLO con el contenido nuevo del archivo, sin explicaciones ni comentarios adicionales.`
        : `Este es tu archivo de memorias actual. Reescríbelo completo: agrupa eventos similares antiguos en resúmenes breves (por ejemplo, "hubo varias sesiones de pruebas técnicas de voz y lipsync"), pero conserva los eventos más recientes con su detalle original. Elimina duplicados. Responde SOLO con el contenido nuevo del archivo, sin explicaciones ni comentarios adicionales.`;

    const response = await fetchOpenRouterWithRetry({
      model: OPENROUTER_MODEL,
      messages: [
        { role: "system", content: instruction },
        { role: "user", content: currentContent },
      ],
    });

    const data = await response.json();
    const newContent: string | undefined =
      data.choices?.[0]?.message?.content?.trim();

    if (!newContent || newContent.length < 20) {
      throw new Error(
        `Consolidación de ${file}.md devolvió contenido vacío o sospechosamente corto`,
      );
    }

    return newContent;
  }

  async function consolidateMemoryIfNeeded() {
    if (memoryWriteCountRef.current < MEMORY_CONSOLIDATION_THRESHOLD) return;

    try {
      const { personality, memories } = await loadMemoryContext();

      const [newPersonality, newMemories] = await Promise.allSettled([
        consolidateMemoryFile("personality", personality),
        consolidateMemoryFile("memories", memories),
      ]);

      if (newPersonality.status === "fulfilled") {
        await backupAndOverwriteMemoryFile("personality", newPersonality.value);
      } else {
        console.error(
          "Error consolidando personality.md, se conserva el original:",
          newPersonality.reason,
        );
      }

      if (newMemories.status === "fulfilled") {
        await backupAndOverwriteMemoryFile("memories", newMemories.value);
      } else {
        console.error(
          "Error consolidando memories.md, se conserva el original:",
          newMemories.reason,
        );
      }

      console.log("[INFO] Consolidación de memoria completada.");
    } catch (err) {
      console.error(
        "Error inesperado durante la consolidación de memoria:",
        err,
      );
    } finally {
      memoryWriteCountRef.current = 0;
      try {
        const store = await load(".settings.dat", { autoSave: false });
        await store.set("memoryWriteCount", 0);
        await store.save();
      } catch (err) {
        console.error("Error guardando contador de memoria:", err);
      }
    }
  }

  async function recordMemoryWrites(count: number) {
    if (count <= 0 || !isMemoryCountLoaded.current) return;
    memoryWriteCountRef.current += count;
    try {
      const store = await load(".settings.dat", { autoSave: false });
      await store.set("memoryWriteCount", memoryWriteCountRef.current);
      await store.save();
    } catch (err) {
      console.error("Error guardando contador de memoria:", err);
    }
  }

  // Busca [GUARDAR_PERSONALIDAD: ...] / [GUARDAR_MEMORIA: ...] en la
  // respuesta cruda del LLM (antes de stripMarkers), los aplica a los
  // archivos correspondientes y registra cuántas escrituras hubo para la
  // consolidación periódica. Se llama con la misma reply sobre la que
  // luego se parsean el resto de los marcadores (expresión, voz,
  // movimiento) -- el orden entre esos procesos no importa porque cada
  // uno opera con su propia regex sobre el mismo texto sin mutarlo.
  async function processMemoryMarkers(reply: string) {
    const personalityMatches = [
      ...reply.matchAll(/\[GUARDAR_PERSONALIDAD:\s*([\s\S]*?)\]/g),
    ];
    for (const match of personalityMatches) {
      await appendToMemoryFile("personality", match[1].trim());
    }

    const memoryMatches = [
      ...reply.matchAll(/\[GUARDAR_MEMORIA:\s*([\s\S]*?)\]/g),
    ];
    for (const match of memoryMatches) {
      await appendToMemoryFile("memories", match[1].trim());
    }

    await recordMemoryWrites(personalityMatches.length + memoryMatches.length);
  }

  return { consolidateMemoryIfNeeded, processMemoryMarkers };
}
