package com.sebas.mikuai.data

/**
 * Formato de texto que no tiene que verse ni oírse (2026-09-29, pedido de
 * Sebastián). El chat muestra texto plano, así que las negritas de markdown
 * (**así**) quedaban con los asteriscos a la vista, y a veces la voz los
 * leía. Los emojis se ven, pero no se dicen. Mismo criterio que desktop
 * (Miku-AI/src/lib/speechText.ts).
 */
object TextCleanup {

    private val LINK = Regex("""\[([^\]\n]+)\]\((https?://[^)\s]+)\)""")
    // Asteriscos pegados al texto (**negrita**, *se ríe*); el de una cuenta (2 * 3, 2*3) se respeta.
    private val ASTERISKS = Regex("""(?<!\d)\*+(?=\S)|(?<=\S)\*+(?!\d)""")
    private val DOUBLE_UNDERSCORE = Regex("""(^|[^\w])__([^_\n]+?)__(?!\w)""")
    private val UNDERSCORE = Regex("""(^|[^\w])_([^_\n]+?)_(?!\w)""")
    private val STRIKE = Regex("""~~([^~\n]+?)~~""")
    private val CODE = Regex("""`+([^`\n]+?)`+""")
    private val HEADING = Regex("""^[ \t]*#{1,6}[ \t]+""", RegexOption.MULTILINE)

    // Emojis y sus piezas (tono de piel, unión, selector de variación, banderas, tecla "1️⃣").
    private val EMOJI = Regex(
        "[\\x{1F000}-\\x{1FAFF}\\x{2600}-\\x{27BF}\\x{2B00}-\\x{2BFF}\\x{2300}-\\x{23FF}" +
            "\\x{2190}-\\x{21FF}\\x{3030}\\x{303D}\\x{3297}\\x{3299}\\x{00A9}\\x{00AE}\\x{2122}" +
            "\\x{203C}\\x{2049}\\x{2139}\\x{24C2}\\x{25AA}-\\x{25FE}\\x{2934}\\x{2935}" +
            "\\x{200D}\\x{FE0E}\\x{FE0F}\\x{20E3}\\x{E0020}-\\x{E007F}]"
    )
    private val URL_IN_PARENS = Regex("""\((https?://[^)\s]+)\)""")
    private val URL = Regex("""https?://\S+""")
    private val BULLET = Regex("""^[ \t]*[-•][ \t]+""", RegexOption.MULTILINE)
    private val SPACES = Regex("""[ \t]{2,}""")
    private val SPACE_BEFORE_PUNCT = Regex("""[ \t]+([.,;:!?])""")

    /** Negritas/cursivas/tachado/código/títulos de markdown -> solo el texto. */
    fun stripMarkdown(text: String): String {
        var t = LINK.replace(text, "$1 ($2)")
        t = ASTERISKS.replace(t, "")
        t = DOUBLE_UNDERSCORE.replace(t, "$1$2")
        t = UNDERSCORE.replace(t, "$1$2")
        t = STRIKE.replace(t, "$1")
        t = CODE.replace(t, "$1")
        return HEADING.replace(t, "")
    }

    /** Lo que se manda a la voz: sin formato, sin emojis, sin viñetas ni direcciones web. */
    fun forSpeech(text: String): String {
        var t = stripMarkdown(text)
        t = EMOJI.replace(t, "")
        t = URL_IN_PARENS.replace(t, "")
        t = URL.replace(t, "")
        t = BULLET.replace(t, "")
        t = SPACES.replace(t, " ")
        t = SPACE_BEFORE_PUNCT.replace(t, "$1")
        return t.trim()
    }
}
