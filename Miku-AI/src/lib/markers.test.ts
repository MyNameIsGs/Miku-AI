import { describe, expect, it } from "vitest";
import {
  parseCreateHandGestureMarker,
  parseCreateQuirkMarker,
  parseHandGestureMarker,
  parseMarkers,
  parseMoodMarker,
  parseMovementMarker,
  parseQuirkReadyMarker,
  stripMarkers,
} from "./markers";
import { parseFaceMarker, parseRequestedFace, decodeFace } from "./faceParts";
import { parseReachMarker } from "./reach";
import {
  DEFAULT_HAND_GESTURE_DURATION_MS,
  DEFAULT_MOVEMENT_DURATION_MS,
  VOICE_PITCH_MAX,
  VOICE_PITCH_MIN,
  VOICE_RATE_MAX,
  VOICE_RATE_MIN,
} from "../config/constants";

// El parser de marcadores es de lo que depende todo el cuerpo, la cara, la
// voz y la memoria de Miku: si un cambio lo rompe, ella no avisa, solo
// deja de moverse o de guardar un recuerdo. Estos tests fijan lo que hoy
// funciona.

describe("[MOVIMIENTO]", () => {
  it("lee huesos, ejes e intensidades", () => {
    const parsed = parseMovementMarker("Hola [MOVIMIENTO: head.x=30, leftUpperArm.z=-50] qué tal");
    expect(parsed).toEqual({
      entries: [
        { bone: "head", axis: "x", intensity: 30 },
        { bone: "leftUpperArm", axis: "z", intensity: -50 },
      ],
      durationMs: DEFAULT_MOVEMENT_DURATION_MS,
      animated: false,
    });
  });

  it("lee duracion con o sin 's' y animado en sus variantes", () => {
    expect(parseMovementMarker("[MOVIMIENTO: head.x=10, duracion=2s]")?.durationMs).toBe(2000);
    expect(parseMovementMarker("[MOVIMIENTO: head.x=10, duracion=1.5]")?.durationMs).toBe(1500);
    for (const yes of ["si", "sí", "Sí", "yes", "true"]) {
      expect(parseMovementMarker(`[MOVIMIENTO: head.x=10, animado=${yes}]`)?.animated).toBe(true);
    }
    expect(parseMovementMarker("[MOVIMIENTO: head.x=10, animado=no]")?.animated).toBe(false);
  });

  it("ignora una duración cero, negativa o ilegible", () => {
    for (const bad of ["0", "-2", "rapido"]) {
      expect(parseMovementMarker(`[MOVIMIENTO: head.x=10, duracion=${bad}]`)?.durationMs).toBe(
        DEFAULT_MOVEMENT_DURATION_MS,
      );
    }
  });

  it("descarta huesos inexistentes, ejes inválidos y números ilegibles sin tirar el resto", () => {
    const parsed = parseMovementMarker(
      "[MOVIMIENTO: cola.x=10, head.w=10, head=10, neck.y=mucho, neck.y=20]",
    );
    expect(parsed?.entries).toEqual([{ bone: "neck", axis: "y", intensity: 20 }]);
  });

  it("devuelve null sin marcador o sin ninguna entrada válida", () => {
    expect(parseMovementMarker("sin marcadores")).toBeNull();
    expect(parseMovementMarker("[MOVIMIENTO: cola.x=10, duracion=2]")).toBeNull();
  });

  it("acepta el nombre en minúsculas y el contenido partido en líneas", () => {
    const parsed = parseMovementMarker("[movimiento:\n  head.x=10,\n  neck.z=5\n]");
    expect(parsed?.entries).toHaveLength(2);
  });

  it("usa el primer [MOVIMIENTO] si hay varios", () => {
    const parsed = parseMovementMarker("[MOVIMIENTO: head.x=10] y [MOVIMIENTO: head.x=90]");
    expect(parsed?.entries[0].intensity).toBe(10);
  });
});

describe("[GESTO_MANO]", () => {
  it("lee cada mano y la duración", () => {
    expect(parseHandGestureMarker("[GESTO_MANO: izq=paz, der=puño, duracion=1s]")).toEqual({
      left: "paz",
      right: "puño",
      durationMs: 1000,
    });
  });

  it("acepta una sola mano y usa la duración por defecto", () => {
    expect(parseHandGestureMarker("[GESTO_MANO: der=abierta]")).toEqual({
      left: undefined,
      right: "abierta",
      durationMs: DEFAULT_HAND_GESTURE_DURATION_MS,
    });
  });

  it("devuelve null sin ninguna mano", () => {
    expect(parseHandGestureMarker("[GESTO_MANO: duracion=1]")).toBeNull();
    expect(parseHandGestureMarker("nada")).toBeNull();
  });

  it("no confunde [CREAR_GESTO_MANO] con [GESTO_MANO]", () => {
    expect(parseHandGestureMarker("[CREAR_GESTO_MANO: nombre=garra, indice=80]")).toBeNull();
  });
});

describe("[CREAR_GESTO_MANO]", () => {
  it("arma el gesto completo, con dedos faltantes en 0", () => {
    expect(parseCreateHandGestureMarker("[CREAR_GESTO_MANO: nombre=garra, indice=80, medio=70]")).toEqual({
      name: "garra",
      curls: { thumb: 0, index: 80, middle: 70, ring: 0, pinky: 0 },
      animated: false,
    });
  });

  it("acepta los nombres de dedo con y sin tilde y recorta a 0-100", () => {
    const parsed = parseCreateHandGestureMarker(
      "[CREAR_GESTO_MANO: nombre=x, índice=150, meñique=-20, menique=40, pulgar=50, anular=10]",
    );
    expect(parsed?.curls).toMatchObject({ index: 100, pinky: 40, thumb: 50, ring: 10 });
  });

  it("lee separación y pulgar cruzado", () => {
    const parsed = parseCreateHandGestureMarker(
      "[CREAR_GESTO_MANO: nombre=x, separación=60, pulgar_cruzado=120]",
    );
    expect(parsed?.curls).toMatchObject({ spread: 60, thumbAcross: 100 });
    expect(parseCreateHandGestureMarker("[CREAR_GESTO_MANO: nombre=x, separacion=30]")?.curls.spread).toBe(30);
  });

  it("saca del nombre lo que no sea letra, número o guion bajo", () => {
    expect(parseCreateHandGestureMarker("[CREAR_GESTO_MANO: nombre=mi gesto!, indice=1]")?.name).toBe("migesto");
  });

  it("devuelve null sin nombre", () => {
    expect(parseCreateHandGestureMarker("[CREAR_GESTO_MANO: indice=80]")).toBeNull();
  });

  it("lee animado", () => {
    expect(parseCreateHandGestureMarker("[CREAR_GESTO_MANO: nombre=x, animado=si]")?.animated).toBe(true);
  });
});

describe("[CREAR_QUIRK] y [QUIRK_LISTO]", () => {
  it("combina cuerpo, manos, duración, animado y ciclos", () => {
    expect(
      parseCreateQuirkMarker(
        "[CREAR_QUIRK: nombre=tarareo, head.z=20, animado=si, ciclos=4, duracion=3s, mano_izq=paz]",
      ),
    ).toEqual({
      name: "tarareo",
      entries: [{ bone: "head", axis: "z", intensity: 20 }],
      durationMs: 3000,
      animated: true,
      handLeft: "paz",
      handRight: undefined,
      revertAfterCycles: 4,
    });
  });

  it("recorta ciclos a 1-8 (un quirk eterno reabriría el bug de los quirks mezclados)", () => {
    expect(parseCreateQuirkMarker("[CREAR_QUIRK: nombre=a, head.x=1, ciclos=50]")?.revertAfterCycles).toBe(8);
    expect(parseCreateQuirkMarker("[CREAR_QUIRK: nombre=a, head.x=1, ciclos=0]")?.revertAfterCycles).toBe(1);
    expect(parseCreateQuirkMarker("[CREAR_QUIRK: nombre=a, head.x=1]")?.revertAfterCycles).toBeUndefined();
  });

  it("acepta un quirk solo de manos", () => {
    expect(parseCreateQuirkMarker("[CREAR_QUIRK: nombre=a, mano_der=paz]")?.handRight).toBe("paz");
  });

  it("devuelve null sin nombre o sin nada que mover", () => {
    expect(parseCreateQuirkMarker("[CREAR_QUIRK: head.x=10]")).toBeNull();
    expect(parseCreateQuirkMarker("[CREAR_QUIRK: nombre=a, duracion=2]")).toBeNull();
  });

  it("[QUIRK_LISTO] limpia el nombre igual que [CREAR_QUIRK]", () => {
    const created = parseCreateQuirkMarker("[CREAR_QUIRK: nombre=mi quirk, head.x=1]");
    expect(parseQuirkReadyMarker("[QUIRK_LISTO: mi quirk]")).toBe(created?.name);
    expect(parseQuirkReadyMarker("[QUIRK_LISTO: !!]")).toBeNull();
    expect(parseQuirkReadyMarker("nada")).toBeNull();
  });
});

describe("[ESTADO_ANIMO]", () => {
  it("toma el último válido, sin importar mayúsculas", () => {
    expect(parseMoodMarker("[ESTADO_ANIMO: sad] ... [estado_animo: Happy]")).toBe("happy");
  });

  it("ignora ánimos fuera del vocabulario", () => {
    expect(parseMoodMarker("[ESTADO_ANIMO: feliz]")).toBeNull();
  });
});

describe("[CARA]", () => {
  it("convierte 0-100 a 0-1, recorta y descarta partes inexistentes", () => {
    const face = parseFaceMarker("[CARA: cejas_preocupadas=60, ojos_llorosos=150, nariz=100]");
    expect(decodeFace(face!)).toEqual({ cejas_preocupadas: 0.6, ojos_llorosos: 1 });
  });

  it("acepta guiño escrito con ñ", () => {
    expect(decodeFace(parseFaceMarker("[CARA: guiño_izq=100]")!)).toEqual({ guino_izq: 1 });
  });

  it("toma el último [CARA] y devuelve null si ninguna parte es válida", () => {
    expect(decodeFace(parseFaceMarker("[CARA: boca_sonrisa=10] [CARA: boca_puchero=20]")!)).toEqual({
      boca_puchero: 0.2,
    });
    expect(parseFaceMarker("[CARA: nariz=100]")).toBeNull();
  });

  it("[CARA] le gana a [EXPRESION]; sin ninguno no inventa una cara", () => {
    expect(parseRequestedFace("[EXPRESION: happy] [CARA: boca_sonrisa=100]")).toMatch(/^cara:/);
    expect(parseRequestedFace("[EXPRESION: Sad]")).toBe("sad");
    expect(parseRequestedFace("nada")).toBeNull();
  });
});

describe("[LLEVAR_MANO]", () => {
  it("lee lugar, palma opcional y duración", () => {
    expect(parseReachMarker("[LLEVAR_MANO: der=mejilla:palma_hacia_la_cara, izq=cintura, duracion=2]", 800)).toEqual({
      left: { place: "cintura", palm: undefined },
      right: { place: "mejilla", palm: "palma_hacia_la_cara" },
      durationMs: 2000,
    });
  });

  it("acepta 'hacia ti' con espacio y mayúsculas", () => {
    expect(parseReachMarker("[LLEVAR_MANO: der=Hacia Ti]", 800)?.right?.place).toBe("hacia_ti");
  });

  it("ignora lugares y palmas desconocidos", () => {
    expect(parseReachMarker("[LLEVAR_MANO: der=rodilla]", 800)).toBeNull();
    expect(parseReachMarker("[LLEVAR_MANO: der=pecho:palma_rara]", 800)?.right).toEqual({
      place: "pecho",
      palm: undefined,
    });
  });
});

describe("stripMarkers", () => {
  it("deja solo lo que Miku dice en una respuesta real con muchos marcadores", () => {
    const reply = [
      "[EXPRESION: happy][VOZ_PITCH: 12][VOZ_RATE: -5][VOZ_VOLUMEN: 60]",
      "¡Hola, Sebastián! [MOVIMIENTO: head.z=15, duracion=1s]",
      "[LLEVAR_MANO: der=mejilla][CARA: boca_sonrisa=100][GESTO_MANO: izq=paz]",
      "Hoy estoy contenta. [ESTADO_ANIMO: happy]",
      "[GUARDAR_MEMORIA: 2026-09-28 — hablamos de tests]",
      "[GUARDAR_PERSONALIDAD: me gustan las cosas ordenadas]",
      "[MEMORIA_IMPORTANTE: 2026-09-28 — algo importante]",
    ].join("\n");
    expect(stripMarkers(reply)).toBe("¡Hola, Sebastián! \n\nHoy estoy contenta.");
  });

  it("no toca corchetes que no son marcadores", () => {
    expect(stripMarkers("[risas] eso fue gracioso")).toBe("[risas] eso fue gracioso");
  });

  it("borra también la variante sin eñe de REDISEÑAR", () => {
    expect(stripMarkers("a [REDISENAR_REACCION: cabeza] b [REDISEÑAR_DORMIR] c")).toBe("a  b  c");
  });
});

describe("parseMarkers", () => {
  it("junta memoria, personalidad, voz, ánimo y el texto limpio", () => {
    const result = parseMarkers(
      "[GUARDAR_MEMORIA: uno][GUARDAR_MEMORIA:  dos ][GUARDAR_PERSONALIDAD: tres]" +
        "[EXPRESION: sad][EXPRESION: angry][ESTADO_ANIMO: relaxed][VOZ_PITCH: 5]Hola",
      0,
      10,
      "happy",
    );
    expect(result.memoryUpdates).toEqual(["uno", "dos"]);
    expect(result.personalityUpdates).toEqual(["tres"]);
    expect(result.expression).toBe("angry");
    expect(result.mood).toBe("relaxed");
    expect(result.pitch).toBe(5);
    expect(result.rate).toBe(10);
    expect(result.cleanText).toBe("Hola");
  });

  it("sin [EXPRESION] cae al ánimo de base; sin [ESTADO_ANIMO] no inventa uno", () => {
    const result = parseMarkers("Hola", 0, 0, "sad");
    expect(result.expression).toBe("sad");
    expect(result.mood).toBeNull();
  });

  it("recorta pitch y rate a sus límites", () => {
    const high = parseMarkers("[VOZ_PITCH: 999][VOZ_RATE: 999]", 0, 0);
    expect([high.pitch, high.rate]).toEqual([VOICE_PITCH_MAX, VOICE_RATE_MAX]);
    const low = parseMarkers("[VOZ_PITCH: -999][VOZ_RATE: -999]", 0, 0);
    expect([low.pitch, low.rate]).toEqual([VOICE_PITCH_MIN, VOICE_RATE_MIN]);
  });

  it("puede crear un gesto y usarlo en la misma respuesta", () => {
    const result = parseMarkers("[CREAR_GESTO_MANO: nombre=garra, indice=80][GESTO_MANO: der=garra]", 0, 0);
    expect(result.createHandGesture?.name).toBe("garra");
    expect(result.handGesture?.right).toBe("garra");
  });
});
