package com.sebas.mikuai.data

object MarkerParser {

    private val PERSONALITY_REGEX = Regex("""\[GUARDAR_PERSONALIDAD:\s*([\s\S]*?)\]""")
    private val MEMORY_REGEX      = Regex("""\[GUARDAR_MEMORIA:\s*([\s\S]*?)\]""")
    private val KNOWLEDGE_REGEX   = Regex("""\[GUARDAR_CONOCIMIENTO:\s*([\s\S]*?)\]""")
    private val STRIP_PATTERNS    = listOf(
        Regex("""\[EXPRESION:[^\]]*\]"""),
        Regex("""\[VOZ_PITCH:[^\]]*\]"""),
        Regex("""\[VOZ_RATE:[^\]]*\]"""),
        Regex("""\[MOVIMIENTO:[^\]]*\]"""),
        Regex("""\[GESTO_MANO:[^\]]*\]"""),
        Regex("""\[CREAR_GESTO_MANO:[^\]]*\]"""),
    )

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
            saveKnowledge    = knowledge
        )
    }
}