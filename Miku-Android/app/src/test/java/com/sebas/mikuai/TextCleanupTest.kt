package com.sebas.mikuai

import com.sebas.mikuai.data.MarkerParser
import com.sebas.mikuai.data.TextCleanup
import org.junit.Assert.assertEquals
import org.junit.Test

class TextCleanupTest {

    @Test fun sacaNegritasYCursivas() {
        assertEquals("Eso es muy importante y bastante raro", TextCleanup.stripMarkdown("Eso es **muy** importante y *bastante* raro"))
        assertEquals("se ríe ¡qué gracioso!", TextCleanup.stripMarkdown("*se ríe* ¡qué gracioso!"))
    }

    @Test fun respetaMultiplicacionYNombres() {
        assertEquals("2*3 es 6, y 4 * 5 es 20", TextCleanup.stripMarkdown("2*3 es 6, y 4 * 5 es 20"))
        assertEquals("el archivo mi_archivo_nuevo.txt", TextCleanup.stripMarkdown("el archivo mi_archivo_nuevo.txt"))
        assertEquals("es genial y enorme", TextCleanup.stripMarkdown("es _genial_ y __enorme__"))
    }

    @Test fun noDiceEmojis() {
        assertEquals("¡Qué bien!", TextCleanup.forSpeech("¡Qué bien! 😄💙"))
        assertEquals("Hola amigo", TextCleanup.forSpeech("Hola 👋🏽 amigo"))
        assertEquals("mi familia y yo", TextCleanup.forSpeech("mi familia 👨‍👩‍👧 y yo"))
        assertEquals("Venezuela!", TextCleanup.forSpeech("Venezuela 🇻🇪 !"))
        assertEquals("te quiero", TextCleanup.forSpeech("❤️ te quiero"))
        assertEquals("", TextCleanup.forSpeech("💙✨"))
    }

    @Test fun noDiceViñetasNiDirecciones() {
        assertEquals("uno\ndos", TextCleanup.forSpeech("- **uno**\n- dos"))
        assertEquals("mira el mapa ahí", TextCleanup.forSpeech("mira [el mapa](https://maps.google.com/?q=x) ahí"))
        assertEquals("¿Mañana? ¡Sí, canción!", TextCleanup.forSpeech("¿Mañana? ¡Sí, canción!"))
    }

    @Test fun elChatSaleSinAsteriscos() {
        assertEquals("¡Hola, Sebastián! 😄", MarkerParser.parse("[EXPRESION: happy] ¡**Hola**, Sebastián! 😄").cleanText)
    }
}
