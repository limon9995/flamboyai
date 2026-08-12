package pro.FlamboyAI.paysync

import android.content.Context
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.util.Log
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException

class SmsNotificationListener : NotificationListenerService() {

    private val client = OkHttpClient()
    private val WEBHOOK_URL = "https://api.flamboyai.com/sms-gateway/incoming"

    // System packages to skip — not SMS apps
    private val skipPackages = setOf(
        "android", "com.android.systemui", "com.android.settings",
        "com.google.android.gms", "com.google.android.gsf",
        "pro.FlamboyAI.paysync",
    )

    private val paymentKeywords = listOf(
        "bkash", "বিকাশ", "nagad", "নগদ", "rocket", "রকেট", "nexuspay", "dbbl",
        "taka", "টাকা", "tk.", "tk ", "received", "payment", "transaction",
        "transfer", "credited", "debited", "cash in", "cash out",
        "send money", "mobile recharge"
    )

    override fun onNotificationPosted(sbn: StatusBarNotification) {
        val pkg = sbn.packageName ?: return
        if (pkg in skipPackages) return

        val extras  = sbn.notification?.extras ?: return
        val title   = extras.getCharSequence("android.title")?.toString() ?: ""
        val text    = extras.getCharSequence("android.text")?.toString()  ?: ""
        val bigText = extras.getCharSequence("android.bigText")?.toString() ?: ""
        val fullText = if (bigText.isNotEmpty()) bigText else text
        if (fullText.isEmpty()) return

        val lower = fullText.lowercase()
        if (paymentKeywords.none { lower.contains(it) }) return

        Log.d("PaySync", "Payment notification from $title: $fullText")

        val tokens = getTokens()
        if (tokens.isEmpty()) {
            Log.w("PaySync", "No tokens configured")
            return
        }

        addLog(applicationContext, "$title থেকে পেমেন্ট নোটিফিকেশন (${tokens.size}টি token এ পাঠানো হচ্ছে)...")
        tokens.forEach { token -> forwardPayment(token, fullText, title) }
    }

    private fun getTokens(): List<String> {
        val prefs = applicationContext.getSharedPreferences("FlamboyAIPrefs", Context.MODE_PRIVATE)
        val raw = prefs.getString("pageTokens", null)
        if (!raw.isNullOrEmpty()) {
            return try {
                val arr = JSONArray(raw)
                (0 until arr.length()).map { arr.getString(it) }
            } catch (e: Exception) { emptyList() }
        }
        val old = prefs.getString("pageToken", null)
        return if (!old.isNullOrEmpty()) listOf(old) else emptyList()
    }

    private fun forwardPayment(token: String, message: String, from: String) {
        val json = JSONObject().apply {
            put("message", message); put("from", from)
            put("timestamp", System.currentTimeMillis().toString())
            put("source", "notification_listener")
        }
        val body = json.toString().toRequestBody("application/json; charset=utf-8".toMediaTypeOrNull())
        val request = Request.Builder().url("$WEBHOOK_URL?pageToken=$token").post(body).build()

        client.newCall(request).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                incrementCounter(applicationContext, "fail_count")
                addLog(applicationContext, "❌ $from — ব্যর্থ: ${e.message}")
            }
            override fun onResponse(call: Call, response: Response) {
                val code = response.code; response.close()
                if (code in 200..299) {
                    incrementCounter(applicationContext, "sync_count")
                    val time = java.text.SimpleDateFormat("hh:mm a", java.util.Locale.getDefault()).format(java.util.Date())
                    applicationContext.getSharedPreferences("FlamboyAIPrefs", Context.MODE_PRIVATE)
                        .edit().putString("last_sync", time).apply()
                    addLog(applicationContext, "✅ $from — সিঙ্ক সফল")
                } else {
                    incrementCounter(applicationContext, "fail_count")
                    addLog(applicationContext, "⚠️ $from — সার্ভার প্রত্যাখ্যান ($code)")
                }
            }
        })
    }

    private fun incrementCounter(context: Context, key: String) {
        val prefs = context.getSharedPreferences("FlamboyAIPrefs", Context.MODE_PRIVATE)
        prefs.edit().putInt(key, prefs.getInt(key, 0) + 1).apply()
    }

    private fun addLog(context: Context, message: String) {
        val prefs = context.getSharedPreferences("FlamboyAIPrefs", Context.MODE_PRIVATE)
        val time = java.text.SimpleDateFormat("hh:mm a", java.util.Locale.getDefault()).format(java.util.Date())
        val updated = "[$time] $message\n${prefs.getString("sync_logs", "") ?: ""}"
        prefs.edit().putString("sync_logs", updated.split("\n").take(20).joinToString("\n")).apply()
    }
}
