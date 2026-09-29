package com.sebas.mikuai.data

object MarkerParser {

    private val PERSONALITY_REGEX = Regex("""\[GUARDAR_PERSONALIDAD:\s*([\s\S]*?)\]""")
    private val MEMORY_REGEX      = Regex("""\[GUARDAR_MEMORIA:\s*([\s\S]*?)\]""")
    private val KNOWLEDGE_REGEX   = Regex("""\[GUARDAR_CONOCIMIENTO:\s*([\s\S]*?)\]""")
    // Ánimo compartido con la PC: [ESTADO_ANIMO: happy, cuanto=poco, dura=un_rato].
    private val MOOD_REGEX        = Regex("""\[ESTADO_ANIMO:\s*(happy|angry|sad|relaxed|neutral)\s*(?:,([^\]]*))?\]""", RegexOption.IGNORE_CASE)
    private val STRIP_PATTERNS    = listOf(
        Regex("""\[EXPRESION:[^\]]*\]"""),
        Regex("""\[VOZ_PITCH:[^\]]*\]"""),
        Regex("""\[VOZ_RATE:[^\]]*\]"""),
        Regex("""\[MOVIMIENTO:[^\]]*\]"""),
        Regex("""\[GESTO_MANO:[^\]]*\]"""),
        Regex("""\[CREAR_GESTO_MANO:[^\]]*\]"""),
        Regex("""\[ESTADO_ANIMO:[^\]]*\]""", RegexOption.IGNORE_CASE),
    )

    // El último [ESTADO_ANIMO], con cuanto/dura si los dio (tildes y espacios da igual).
    fun parseMood(raw: String): MoodPush? {
        val m = MOOD_REGEX.findAll(raw).lastOrNull() ?: return null
        var amount: String? = null
        var duration: String? = null
        m.groupValues[2].split(",").forEach { part ->
            val kv = part.split("=").map { it.trim().lowercase() }
            if (kv.size != 2) return@forEach
            val value = java.text.Normalizer.normalize(kv[1], java.text.Normalizer.Form.NFD)
                .replace(Regex("\\p{M}"), "").replace(Regex("\\s+"), "_")
            when (kv[0]) {
                "cuanto", "cuánto" -> if (value in MoodModel.AMOUNTS) amount = value
                "dura" -> if (value in MoodModel.DURATIONS) duration = value
            }
        }
        return MoodPush(m.groupValues[1].lowercase(), amount, duration)
    }

    fun parse(raw: String): ParsedResponse {
        val personality = PERSONALITY_REGEX.findAll(raw).map { it.groupValues[1].trim() }.toList()
        val memories    = MEMORY_REGEX.findAll(raw).map { it.groupValues[1].trim() }.toList()
        val knowledge   = KNOWLEDGE_REGEX.findAll(raw).map { it.groupValues[1].trim() }.toList()

        var text = raw
        text = PERSONALITY_REGEX.replace(text, "")
        text = MEMORY_REGEX.replace(text, "")
        text = KNOWLEDGE_REGEX.replace(text, "")
        STRIP_PATTERNS.forEach { text = it.replace(text, "") }

        return ParsedResponse(
            cleanText        = text.trim(),
            savePersonality  = personality,
            saveMemories     = memories,
            saveKnowledge    = knowledge,
            moodPush         = parseMood(raw),
        )
    }
}