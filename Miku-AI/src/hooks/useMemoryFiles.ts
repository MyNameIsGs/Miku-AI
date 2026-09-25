import { useEffect, useRef } from "react";
import { load } from "@tauri-apps/plugin-store";
import {
  MEMORY_CONSOLIDATION_THRESHOLD,
  OPENROUTER_MODEL,
} from "../config/constants";
import { fetchOpenRouterWithRetry } from "../lib/openrouter";
import { invoke } from "@tauri-apps/api/core";
import { REPO_ROOT } from "../config/constants";
import {
  loadMemoryContext,
  appendToMemoryFile,
  backupAndOverwriteMemoryFile,
} from "../lib/memory";
import { appendKnowledge, editKnowledgeByFragment } from "../lib/knowledge";

export function useMemoryFiles() {
  const memoryWriteCountRef = useRef(0);
  const isMemoryCountLoaded = useRef(false);

  useEffect(() => {
    (async () => {
      // Primero: jalar la memoria actualizada desde GitHub
      try {
        await invoke("pull_memory_from_github", { repoRoot: REPO_ROOT });
        console.log("[SYNC] Memoria actualizada desde GitHub al arrancar.");
      } catch (err) {
        console.warn("[SYNC] No se pudo jalar memoria desde GitHub:", err);
        // No es fatal — se usa la copia local
      }

      // Segundo: cargar el contador de escrituras guardado
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
    }, { kind: "consolidar memoria" });

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

      // Al final del bloque de consolidación exitosa:
      invoke("sync_memory_to_github", { repoRoot: REPO_ROOT }).catch((err) =>
        console.error("[SYNC] Error al sincronizar con GitHub:", err),
      );
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

    // Tarea 8.11: memorias "de agente" (saber práctico) -- van aparte, a
    // conocimiento.md, que se consulta por similitud en vez de cargarse
    // entero. No cuentan para la consolidación: ese archivo puede crecer a
    // propósito, es justamente lo que permite la búsqueda semántica.
    const knowledgeMatches = [
      ...reply.matchAll(/\[GUARDAR_CONOCIMIENTO:\s*([\s\S]*?)\]/g),
    ];
    for (const match of knowledgeMatches) {
      await appendKnowledge(match[1].trim());
    }

    // Corregir u olvidar SOLO su saber práctico (ver editKnowledgeByFragment:
    // nunca toca memories.md, su personalidad ni el diario).
    for (const match of reply.matchAll(/\[CORREGIR_CONOCIMIENTO:\s*([\s\S]*?)\]/g)) {
      const [fragment, ...rest] = match[1].split(/\s*(?:→|->)\s*/);
      const newText = rest.join(" → ").trim();
      if (fragment?.trim() && newText) await editKnowledgeByFragment(fragment.trim(), newText);
    }
    for (const match of reply.matchAll(/\[OLVIDAR_CONOCIMIENTO:\s*([\s\S]*?)\]/g)) {
      await editKnowledgeByFragment(match[1].trim(), null);
    }

    await recordMemoryWrites(personalityMatches.length + memoryMatches.length);
  }

  return { consolidateMemoryIfNeeded, processMemoryMarkers };
}
