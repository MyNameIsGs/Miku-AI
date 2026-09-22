import { invoke } from "@tauri-apps/api/core";
import { ToolDefinition } from "./types";

// Tarea 8.6: búsqueda de archivos por nombre en toda la PC, usando
// Everything (voidtools, ver file_search.rs) -- resultado casi
// instantáneo, a diferencia de una búsqueda normal de Windows. Es la única
// tool del proyecto que depende de un programa externo que Sebastián tiene
// que instalar y dejar corriendo por su cuenta -- si no está, la tool
// devuelve un error explicándolo en vez de fallar en silencio.
export const buscarArchivos: ToolDefinition = {
  schema: {
    type: "function",
    function: {
      name: "buscar_archivos",
      description:
        "Busca archivos y carpetas por nombre (parcial, no hace falta el nombre exacto) en toda la PC de Sebastián. Úsala cuando pregunte dónde está o dónde dejó algo, o pida encontrar un archivo puntual. Requiere que tenga Everything (voidtools) instalado y corriendo -- si no lo tiene, la herramienta te lo va a decir para que se lo avises.",
      parameters: {
        type: "object",
        properties: {
          consulta: {
            type: "string",
            description:
              "Qué buscar -- nombre parcial de archivo o carpeta (ej. \"presupuesto marzo\", \"comision.psd\").",
          },
        },
        required: ["consulta"],
      },
    },
  },
  execute: async (args) => {
    const consulta = String(args.consulta ?? "").trim();
    if (!consulta) {
      return "Error: no se especificó qué buscar.";
    }

    try {
      const results = await invoke<{ path: string; isFolder: boolean }[]>(
        "buscar_archivos",
        { consulta },
      );
      if (results.length === 0) {
        return `No encontré nada para "${consulta}".`;
      }
      return results
        .map((r) => (r.isFolder ? `[Carpeta] ${r.path}` : r.path))
        .join("\n");
    } catch (err) {
      return `Error al buscar archivos: ${
        err instanceof Error ? err.message : String(err)
      }`;
    }
  },
};
