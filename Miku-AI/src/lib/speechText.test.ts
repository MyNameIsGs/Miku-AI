import { describe, expect, it } from "vitest";
import { stripMarkdown, textForSpeech } from "./speechText";
import { stripMarkers } from "./markers";

describe("stripMarkdown", () => {
  it("saca negritas y cursivas", () => {
    expect(stripMarkdown("Eso es **muy** importante y *bastante* raro")).toBe(
      "Eso es muy importante y bastante raro",
    );
    expect(stripMarkdown("***todo***")).toBe("todo");
  });

  it("saca los asteriscos de acciones", () => {
    expect(stripMarkdown("*se ríe* ¡qué gracioso!")).toBe("se ríe ¡qué gracioso!");
  });

  it("respeta la multiplicación", () => {
    expect(stripMarkdown("2*3 es 6, y 4 * 5 es 20")).toBe("2*3 es 6, y 4 * 5 es 20");
  });

  it("saca guiones bajos de énfasis pero no de nombres", () => {
    expect(stripMarkdown("es _genial_ y __enorme__")).toBe("es genial y enorme");
    expect(stripMarkdown("el archivo mi_archivo_nuevo.txt")).toBe("el archivo mi_archivo_nuevo.txt");
  });

  it("saca tachado, código y títulos", () => {
    expect(stripMarkdown("~~no~~ sí, usa `pnpm test`")).toBe("no sí, usa pnpm test");
    expect(stripMarkdown("## Resumen\nTodo bien")).toBe("Resumen\nTodo bien");
  });

  it("los links quedan legibles", () => {
    expect(stripMarkdown("mira [el mapa](https://maps.google.com/?q=x)")).toBe(
      "mira el mapa (https://maps.google.com/?q=x)",
    );
  });

  it("deja el texto normal igual", () => {
    expect(stripMarkdown("¡Hola, Sebastián! ¿Cómo estás?")).toBe("¡Hola, Sebastián! ¿Cómo estás?");
  });
});

describe("textForSpeech", () => {
  it("no dice emojis", () => {
    expect(textForSpeech("¡Qué bien! 😄💙")).toBe("¡Qué bien!");
    expect(textForSpeech("Hola 👋🏽 amigo")).toBe("Hola amigo");
    expect(textForSpeech("mi familia 👨‍👩‍👧 y yo")).toBe("mi familia y yo");
    expect(textForSpeech("Venezuela 🇻🇪 !")).toBe("Venezuela!");
    expect(textForSpeech("❤️ te quiero")).toBe("te quiero");
  });

  it("solo emojis queda vacío", () => {
    expect(textForSpeech("💙✨")).toBe("");
  });

  it("no dice asteriscos, viñetas ni direcciones web", () => {
    expect(textForSpeech("- **uno**\n- dos")).toBe("uno\ndos");
    expect(textForSpeech("mira [el mapa](https://maps.google.com/?q=x) ahí")).toBe("mira el mapa ahí");
    expect(textForSpeech("entra a https://example.com ya")).toBe("entra a ya");
  });

  it("no se come tildes, ñ ni signos", () => {
    expect(textForSpeech("¿Mañana? ¡Sí, canción!")).toBe("¿Mañana? ¡Sí, canción!");
  });
});

describe("stripMarkers + markdown", () => {
  it("el texto del chat sale sin asteriscos", () => {
    expect(stripMarkers("[EXPRESION: happy] ¡**Hola**, Sebastián! 😄")).toBe("¡Hola, Sebastián! 😄");
  });
});
