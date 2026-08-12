package pro.FlamboyAI.paysync

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import androidx.core.app.NotificationCompat
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException

class PaySyncService : Service() {

    private val CHANNEL_ID = "PaySyncServiceChannel"
    private val NOTIFICATION_ID = 1001
    private val httpClient = OkHttpClient()
    private val heartbeatHandler = Handler(Looper.getMainLooper())
    private val HEARTBEAT_INTERVAL = 2 * 60 * 1000L // 2 minutes
    private val POLL_INTERVAL = 60 * 1000L // 1 minute

    private val paymentSenders = setOf(
        "bkash", "16247", "nagad", "16167", "dbbl", "16216", "rocket", "nexuspay"
    )
    private val paymentKeywords = listOf(
        "bkash", "বিকাশ", "nagad", "নগদ", "rocket", "রকেট",
        "tk.", "tk ", "taka", "টাকা", "received", "payment", "trxid", "transaction"
    )

    private val heartbeatRunnable = object : Runnable {
        override fun run() {
            sendHeartbeat()
            heartbeatHandler.postDelayed(this, HEARTBEAT_INTERVAL)
        }
    }

    private val pollRunnable = object : Runnable {
        override fun run() {
            pollSmsInbox()
            heartbeatHandler.postDelayed(this, POLL_INTERVAL)
        }
    }

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val notificationIntent = Intent(this, MainActivity::class.java)
        
        val pendingIntentFlags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        } else {
            PendingIntent.FLAG_UPDATE_CURRENT
        }

        val pendingIntent = PendingIntent.getActivity(
            this,
            0,
            notificationIntent,
            pendingIntentFlags
        )

        val notification: Notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("FlamboyAI PaySync Active")
            .setContentText("বিকাশ/নগদ পেমেন্ট মেসেজ সিঙ্ক করা হচ্ছে...")
            .setSmallIcon(android.R.drawable.stat_notify_sync)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .build()

        // Start Foreground with Data Sync Type for Android 14 (API 34) Compatibility
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                NOTIFICATION_ID, 
                notification, 
                ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }

        // Start heartbeat immediately and every 15 minutes
        heartbeatHandler.post(heartbeatRunnable)
        // Start SMS inbox polling every 1 minute (fallback for all phone brands)
        heartbeatHandler.postDelayed(pollRunnable, 10_000L)

        // START_STICKY ensures the service restarts if system kills it for memory
        return START_STICKY
    }

    override fun onDestroy() {
        super.onDestroy()
        heartbeatHandler.removeCallbacks(heartbeatRunnable)
        heartbeatHandler.removeCallbacks(pollRunnable)
    }

    override fun onBind(intent: Intent?): IBinder? {
        return null
    }

    private fun getTokens(): List<String> {
        val prefs = getSharedPreferences("FlamboyAIPrefs", Context.MODE_PRIVATE)
        val raw = prefs.getString("pageTokens", null) ?: return emptyList()
        return try {
            val arr = JSONArray(raw)
            (0 until arr.length()).map { arr.getString(it) }
        } catch (e: Exception) { emptyList() }
    }

    // ── SMS inbox polling — works on ALL Android phones regardless of brand ──
    private fun pollSmsInbox() {
        val tokens = getTokens()
        if (tokens.isEmpty()) return

        val prefs = getSharedPreferences("FlamboyAIPrefs", android.content.Context.MODE_PRIVATE)
        val lastId = prefs.getLong("last_polled_sms_id", 0L)
        val cutoff = System.currentTimeMillis() - 10 * 60 * 1000L // last 10 min only

        try {
            val uri = Uri.parse("content://sms/inbox")
            val cursor = contentResolver.query(
                uri,
                arrayOf("_id", "address", "body", "date"),
                "_id > ? AND date > ?",
                arrayOf(lastId.toString(), cutoff.toString()),
                "_id ASC"
            ) ?: return

            var maxId = lastId
            cursor.use {
                while (it.moveToNext()) {
                    val id      = it.getLong(it.getColumnIndexOrThrow("_id"))
                    val address = it.getString(it.getColumnIndexOrThrow("address")) ?: ""
                    val body    = it.getString(it.getColumnIndexOrThrow("body")) ?: ""

                    if (id > maxId) maxId = id

                    val lower = body.lowercase()
                    val senderMatch = paymentSenders.any { s -> address.lowercase().contains(s) }
                    val contentMatch = paymentKeywords.any { k -> lower.contains(k) }
                    if (!senderMatch && !contentMatch) continue

                    addLog("📩 SMS Inbox [$address] (${tokens.size}টি token এ পাঠানো হচ্ছে)...")
                    tokens.forEach { token -> forwardSms(token, body, address) }
                }
            }
            if (maxId > lastId) {
                prefs.edit().putLong("last_polled_sms_id", maxId).apply()
            }
        } catch (_: Exception) { /* READ_SMS permission not granted — skip silently */ }
    }

    private fun forwardSms(token: String, message: String, from: String) {
        val json = JSONObject().apply {
            put("message", message); put("from", from)
            put("timestamp", System.currentTimeMillis().toString())
            put("source", "sms_poll")
        }
        val body = json.toString().toRequestBody("application/json; charset=utf-8".toMediaTypeOrNull())
        val request = Request.Builder()
            .url("https://api.flamboyai.com/sms-gateway/incoming?pageToken=$token")
            .post(body).build()
        httpClient.newCall(request).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) { addLog("❌ Poll [$from] — ব্যর্থ: ${e.message}") }
            override fun onResponse(call: Call, response: Response) {
                val code = response.code; response.close()
                if (code in 200..299) addLog("✅ Poll [$from] — সিঙ্ক সফল")
                else addLog("⚠️ Poll [$from] — সার্ভার প্রত্যাখ্যান ($code)")
            }
        })
    }

    private fun addLog(message: String) {
        val prefs = getSharedPreferences("FlamboyAIPrefs", android.content.Context.MODE_PRIVATE)
        val t = java.text.SimpleDateFormat("hh:mm a", java.util.Locale.getDefault()).format(java.util.Date())
        val updated = "[$t] $message\n${prefs.getString("sync_logs", "") ?: ""}"
        prefs.edit().putString("sync_logs", updated.split("\n").take(20).joinToString("\n")).apply()
    }

    private fun sendHeartbeat() {
        val tokens = getTokens()
        if (tokens.isEmpty()) return
        val deviceName  = Build.MODEL
        val deviceModel = "${Build.MANUFACTURER} ${Build.MODEL}"
        tokens.forEach { token ->
            val json = JSONObject().apply {
                put("token", token)
                put("deviceName", deviceName)
                put("deviceModel", deviceModel)
            }
            val body = json.toString().toRequestBody("application/json; charset=utf-8".toMediaTypeOrNull())
            val request = Request.Builder()
                .url("https://api.flamboyai.com/sms-gateway/connect")
                .post(body)
                .build()
            httpClient.newCall(request).enqueue(object : Callback {
                override fun onFailure(call: Call, e: IOException) { /* silent */ }
                override fun onResponse(call: Call, response: Response) { response.close() }
            })
        }
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val serviceChannel = NotificationChannel(
                CHANNEL_ID,
                "FlamboyAI PaySync Background Service",
                NotificationManager.IMPORTANCE_LOW
            )
            val manager = getSystemService(NotificationManager::class.java)
            manager?.createNotificationChannel(serviceChannel)
        }
    }
}
