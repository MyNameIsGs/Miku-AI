package com.sebas.mikuai.data

/**
 * Detecta correo nuevo, en vez de depender de que el loop idle lo
 * mencione de pasada (idea #8 original) -- compara el id del mensaje más
 * reciente de cada cuenta contra el último visto (guardado en
 * [SecurePrefs], solo local, no hace falta sincronizarlo por GitHub).
 *
 * La primera vez que se revisa una cuenta (sin id previo guardado) NO
 * cuenta como candidato -- solo establece la base, para no comentar en voz
 * alta todo lo que ya estaba en la bandeja antes de activar esto.
 *
 * Idea #8 (de verdad, no la plantilla fija que tenía antes): esta clase ya
 * no arma el texto a anunciar -- devuelve los candidatos crudos, y quien
 * llame (WakeWordService) le pasa esto al LLM (ver Prompts.buildMailPrompt)
 * para que Miku decida, en personaje, si vale la pena mencionarlo.
 */
class GmailWatcher(private val gmailApi: GmailApi, private val prefs: SecurePrefs) {

    // Categorías que no vale la pena interrumpir para avisar -- primer
    // filtro barato antes de gastar una llamada al LLM. El id sigue
    // actualizándose igual para esas cuentas (no se vuelve a evaluar el
    // mismo correo en el próximo chequeo).
    private val skipLabels = setOf("CATEGORY_PROMOTIONS", "CATEGORY_SOCIAL", "SPAM", "CATEGORY_FORUMS")

    /** Correos nuevos reales encontrados (ya filtrados por [skipLabels]), o null si no hay ninguno. */
    suspend fun checkForNewMail(): List<GmailMessageSummary>? {
        val accounts = gmailApi.listConnectedEmails()
        if (accounts.isEmpty()) return null

        val lastSeen = prefs.getLastSeenGmailIds().toMutableMap()
        val candidates = mutableListOf<GmailMessageSummary>()

        for (email in accounts) {
            val latest = try {
                gmailApi.latestMessageFor(email)
            } catch (e: Exception) {
                null
            } ?: continue

            val previousId = lastSeen[email]
            lastSeen[email] = latest.id

            if (previousId == null || previousId == latest.id) continue
            if (latest.labelIds.any { it in skipLabels }) continue

            candidates.add(latest)
        }

        prefs.setLastSeenGmailIds(lastSeen)
        return candidates.ifEmpty { null }
    }
}
