package com.sebas.mikuai.data

/**
 * Avisa cuando llega correo nuevo, en vez de depender de que el loop idle
 * lo mencione de pasada (idea #8 original) -- variante propuesta por
 * Sebastián en vivo: compara el id del mensaje más reciente de cada
 * cuenta contra el último visto (guardado en [SecurePrefs], solo local, no
 * hace falta sincronizarlo por GitHub) y solo anuncia si cambió.
 *
 * La primera vez que se revisa una cuenta (sin id previo guardado) NO se
 * anuncia nada -- solo establece la base, para no leer en voz alta todo lo
 * que ya estaba en la bandeja antes de activar esto.
 */
class GmailWatcher(private val gmailApi: GmailApi, private val prefs: SecurePrefs) {

    // Categorías que no vale la pena interrumpir para avisar -- mismo
    // criterio de "filtrar spam/promociones" que ya estaba anotado en la
    // idea original. El id sigue actualizándose igual para esas cuentas
    // (no se vuelve a evaluar el mismo correo en el próximo chequeo).
    private val skipLabels = setOf("CATEGORY_PROMOTIONS", "CATEGORY_SOCIAL", "SPAM", "CATEGORY_FORUMS")

    /** Texto a anunciar del primer correo nuevo real encontrado, o null si no hay ninguno que avisar. */
    suspend fun checkForNewMail(): String? {
        val accounts = gmailApi.listConnectedEmails()
        if (accounts.isEmpty()) return null

        val lastSeen = prefs.getLastSeenGmailIds().toMutableMap()
        var announcement: String? = null

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

            if (announcement == null) {
                announcement = if (latest.subject.isNotBlank()) {
                    "Te llegó un correo nuevo de ${latest.from}, sobre \"${latest.subject}\"."
                } else {
                    "Te llegó un correo nuevo de ${latest.from}."
                }
            }
        }

        prefs.setLastSeenGmailIds(lastSeen)
        return announcement
    }
}
