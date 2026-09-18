import { ChatContent } from "../../types";

export type ToolSchema = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, unknown>;
      required: string[];
    };
  };
};

export type ToolDefinition = {
  schema: ToolSchema;
  // Tarea 6.5: si es true, antes de ejecutar se le pregunta a Sebastián
  // con un diálogo nativo. Pensado para acciones sensibles (cerrar
  // procesos, mover archivos, etc.) que todavía no existen -- ninguna
  // tool actual lo necesita.
  requiresConfirmation?: boolean;
  // Mensaje humano para el diálogo de confirmación. Si no se define, se
  // arma uno genérico con el nombre de la tool y sus argumentos en crudo.
  describeForConfirmation?: (args: Record<string, unknown>) => string;
  // Tarea 6.6: puede devolver contenido multi-parte (texto + image_url),
  // no solo texto -- ver_pantalla lo usa para devolver la captura.
  execute: (args: Record<string, unknown>) => Promise<ChatContent> | ChatContent;
};
