import { describe, expect, it } from "vitest";
import { stripMarkers } from "./markers";

// Todo marcador que aparece en el código (prompts, hooks) tiene que salir
// del texto antes de hablar: si no, Miku lo lee en voz alta. Este test
// busca los nombres en src/ solo, así que un marcador nuevo sin su línea
// en stripMarkers (o sin ejemplo acá) lo hace fallar.

// Un ejemplo realista de cada marcador, tal como lo escribiría ella.
const EXAMPLES: Record<string, string> = {
  GUARDAR_MEMORIA: "[GUARDAR_MEMORIA: 2026-09-28 — algo]",
  GUARDAR_PERSONALIDAD: "[GUARDAR_PERSONALIDAD: algo]",
  GUARDAR_CONOCIMIENTO: "[GUARDAR_CONOCIMIENTO: algo]",
  CORREGIR_CONOCIMIENTO: "[CORREGIR_CONOCIMIENTO: viejo => nuevo]",
  OLVIDAR_CONOCIMIENTO: "[OLVIDAR_CONOCIMIENTO: algo]",
  MEMORIA_IMPORTANTE: "[MEMORIA_IMPORTANTE: 2026-09-28 — algo]",
  EXPRESION: "[EXPRESION: happy]",
  ESTADO_ANIMO: "[ESTADO_ANIMO: relaxed, cuanto=bastante, dura=unas_horas]",
  CARA: "[CARA: boca_sonrisa=100]",
  VOZ_PITCH: "[VOZ_PITCH: -4.5]",
  VOZ_RATE: "[VOZ_RATE: 10]",
  VOZ_VOLUMEN: "[VOZ_VOLUMEN: 60]",
  MOVIMIENTO: "[MOVIMIENTO: head.x=10, duracion=1s]",
  LLEVAR_MANO: "[LLEVAR_MANO: der=mejilla]",
  GESTO_MANO: "[GESTO_MANO: izq=paz]",
  CREAR_GESTO_MANO: "[CREAR_GESTO_MANO: nombre=garra, indice=80]",
  CREAR_QUIRK: "[CREAR_QUIRK: nombre=a, head.x=10]",
  QUIRK_LISTO: "[QUIRK_LISTO: a]",
  QUIERO_MOVERME: "[QUIERO_MOVERME: estirarme]",
  REDISEÑAR_REACCION: "[REDISEÑAR_REACCION: cabeza]",
  REVISAR_REACCION: "[REVISAR_REACCION: cabeza]",
  ME_GUSTA_ASI: "[ME_GUSTA_ASI]",
  IGUAL_QUE_SIEMPRE: "[IGUAL_QUE_SIEMPRE]",
  REDISEÑAR_DORMIR: "[REDISEÑAR_DORMIR]",
  REDISEÑAR_DESPERTAR: "[REDISEÑAR_DESPERTAR]",
  REDISEÑAR_MUSICA: "[REDISEÑAR_MUSICA]",
  REDISEÑAR_CARA_ANIMO: "[REDISEÑAR_CARA_ANIMO: sad]",
  REDISEÑAR_BAILE: "[REDISEÑAR_BAILE: ritmo_movido]",
  NUEVO_BAILE: "[NUEVO_BAILE: algo]",
  BAILE: "[BAILE: algo]",
  AL_GOLPE: "[AL_GOLPE: head.x=10]",
  OLVIDAR_BAILE: "[OLVIDAR_BAILE: algo]",
  NO_BAILO: "[NO_BAILO]",
  SIN_CARA: "[SIN_CARA]",
};

// Aparecen entre corchetes pero no son marcadores que ella diga al hablar:
// etiquetas de la consola, y [LISTO], que solo se responde dentro del
// diseño de una cara de ánimo (ese texto nunca se habla).
const NOT_SPOKEN = new Set(["SYNC", "INFO", "MCP", "LISTO"]);

const sources = import.meta.glob<string>(["../**/*.{ts,tsx}", "!../**/*.test.ts"], {
  query: "?raw",
  import: "default",
  eager: true,
});

function markerNamesInSource(): string[] {
  const names = new Set<string>();
  for (const text of Object.values(sources)) {
    for (const match of text.matchAll(/\[([A-ZÑÚ_]{3,})(?::|\])/g)) names.add(match[1]);
  }
  return [...names].filter((name) => !NOT_SPOKEN.has(name)).sort();
}

describe("cobertura de stripMarkers", () => {
  it("encuentra marcadores en el código (el test no está leyendo en vacío)", () => {
    expect(markerNamesInSource().length).toBeGreaterThan(15);
  });

  it.each(markerNamesInSource())("%s tiene un ejemplo acá", (name) => {
    expect(EXAMPLES[name], `falta un ejemplo de [${name}] en EXAMPLES`).toBeDefined();
  });

  it.each(Object.entries(EXAMPLES))("%s se borra antes de hablar", (_name, example) => {
    expect(stripMarkers(`antes ${example} después`)).toBe("antes  después");
  });
});
