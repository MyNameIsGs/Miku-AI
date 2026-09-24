"""Boca de Miku armada desde el TEXTO, sin analizar el audio (alternativa a Rhubarb).

Por qué: Rhubarb se llevaba ~1 s de cada respuesta (medido: ~1.0 s de ~2.9 s
totales) y está pensado para el inglés -- con la voz de Miku, el mismo texto
analizado antes y después de RVC daba formas distintas en 30 de 37 casos.
Edge TTS ya devuelve, en la misma llamada, en qué momento dice cada palabra
(WordBoundary); en español la escritura casi coincide con la pronunciación,
así que las vocales salen directo del texto. Mismo enfoque que MMD AutoLip
Tool (texto -> vocales + tiempos por palabra), sin su costo.

Devuelve las mismas letras que Rhubarb (A-H, X) para que el frontend no
cambie (ver VISEME_MAP en useSpeech.ts):
  a -> D (aa)   e -> C (ee)   i/y -> B (ih)   o -> E (oh)   u -> F (ou)
  m/b/p/v -> A (boca cerrada)   f -> G   l -> H   resto de consonantes -> B
  silencio -> X
Límite conocido: Edge da el inicio y fin de cada PALABRA, no de cada sílaba;
dentro de la palabra las vocales se reparten según las letras, así que en
palabras largas una vocal puede correrse unos ms.
"""

import unicodedata

VOWEL_CUE = {"a": "D", "e": "C", "i": "B", "o": "E", "u": "F"}
BILABIAL = set("mbpv")  # en español la v suena como b: labios cerrados

# Pesos para repartir la duración de la palabra: las vocales duran más que
# las consonantes.
VOWEL_WEIGHT = 2.0
CONSONANT_WEIGHT = 1.0
# Un grupo de consonantes seguidas ("ncr" en "increíble") no dura más que
# esto, por más letras que tenga.
MAX_CONSONANT_GROUP_WEIGHT = 1.5

# Huecos más cortos que esto entre palabras no cierran la boca (se vería
# como un parpadeo de la boca).
MIN_SILENCE_S = 0.08

# Palabras sin vocales en el texto (números, siglas: "15", "GPU"): se
# alterna abrir/entrecerrar para que la boca no quede quieta.
FALLBACK_STEP_S = 0.12


def _strip_accents(text):
    # "ü" (pingüino) se pronuncia: se conserva como u.
    text = text.lower().replace("ü", "u")
    return "".join(
        c for c in unicodedata.normalize("NFD", text) if unicodedata.category(c) != "Mn"
    )


def _units(word):
    """Secuencia de (cue, peso, es_vocal) para una palabra."""
    letters = [c for c in _strip_accents(word) if c.isalpha()]
    units = []
    i = 0
    while i < len(letters):
        c = letters[i]
        nxt = letters[i + 1] if i + 1 < len(letters) else ""
        after = letters[i + 2] if i + 2 < len(letters) else ""
        # "que/qui/gue/gui": la u no suena.
        if c in "qg" and nxt == "u" and after in ("e", "i"):
            units.append(("B", CONSONANT_WEIGHT))
            i += 2
            continue
        if c in VOWEL_CUE:
            units.append((VOWEL_CUE[c], VOWEL_WEIGHT))
        elif c == "y" and (not nxt or nxt not in VOWEL_CUE):
            # "y" sola o al final de palabra ("muy", "y") suena como i.
            units.append(("B", VOWEL_WEIGHT))
        elif c == "h":
            pass  # muda
        elif c in BILABIAL:
            units.append(("A", CONSONANT_WEIGHT))
        elif c == "f":
            units.append(("G", CONSONANT_WEIGHT))
        elif c == "l":
            units.append(("H", CONSONANT_WEIGHT))
        else:
            units.append(("B", CONSONANT_WEIGHT))
        i += 1

    # Consonantes seguidas: una sola unidad (la más visible manda: labios
    # cerrados > dientes > lengua > el resto).
    priority = {"A": 3, "G": 2, "H": 1, "B": 0}
    merged = []
    for cue, weight in units:
        is_vowel = weight == VOWEL_WEIGHT
        if merged and not is_vowel and not merged[-1][2]:
            prev_cue, prev_w, _ = merged[-1]
            best = cue if priority.get(cue, 0) > priority.get(prev_cue, 0) else prev_cue
            merged[-1] = (best, min(MAX_CONSONANT_GROUP_WEIGHT, prev_w + weight), False)
        else:
            merged.append((cue, weight, is_vowel))
    return merged


def visemes_from_words(words, total_duration):
    """words: lista de (inicio_s, duracion_s, texto) de Edge TTS (WordBoundary).

    Devuelve [{"start", "end", "value"}] como Rhubarb.
    """
    cues = []

    def add(start, end, value):
        if end - start <= 0:
            return
        if cues and cues[-1]["value"] == value and abs(cues[-1]["end"] - start) < 1e-6:
            cues[-1]["end"] = end
        else:
            cues.append({"start": round(start, 3), "end": round(end, 3), "value": value})

    cursor = 0.0
    for start, duration, text in words:
        end = start + duration
        gap = start - cursor
        if gap >= MIN_SILENCE_S:
            add(cursor, start, "X")
        elif gap > 0 and cues:
            # Hueco chico: se estira lo anterior en vez de cerrar la boca.
            cues[-1]["end"] = round(start, 3)
        cursor = max(cursor, start)

        units = _units(text)
        if not any(is_vowel for _, _, is_vowel in units):
            t, open_mouth = start, True
            while t < end:
                step_end = min(end, t + FALLBACK_STEP_S)
                add(t, step_end, "D" if open_mouth else "B")
                open_mouth, t = not open_mouth, step_end
        else:
            total_weight = sum(w for _, w, _ in units)
            t = start
            for cue, weight, _ in units:
                step_end = t + duration * weight / total_weight
                add(t, step_end, cue)
                t = step_end
        cursor = end

    if total_duration > cursor:
        add(cursor, total_duration, "X")
    return cues
