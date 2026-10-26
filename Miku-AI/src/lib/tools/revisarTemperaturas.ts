import { describeTemperatures, readTemperatures } from "../hardwareTemps";
import { ToolDefinition } from "./types";

// Avisos de sobrecalentamiento (2026-10-26): además del aviso automático
// (hooks/useTempWatcher.ts), Sebastián puede preguntarle cómo están.
export const revisarTemperaturas: ToolDefinition = {
  schema: {
    type: "function",
    function: {
      name: "revisar_temperaturas",
      description:
        "Temperatura actual del procesador y de la tarjeta de video de la PC de Sebastián, con sus umbrales. Úsala si pregunta cómo está la PC, si se está calentando o si los ventiladores andan bien. Si se calienta de más ya avisas sola; esto es para cuando él pregunta.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  execute: async () => {
    try {
      return describeTemperatures(await readTemperatures());
    } catch (err) {
      return `No pude leer las temperaturas: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};
