package pro.FlamboyAI.paysync

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import com.google.android.material.textfield.TextInputEditText
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException

class MainActivity : AppCompatActivity() {

    private val httpClient = OkHttpClient()
    private val API_BASE = "https://api.flamboyai.com"

    private lateinit var statusDot:           View
    private lateinit var statusText:          TextView
    private lateinit var tokenInput:          TextInputEditText
    private lateinit var saveButton:          Button
    private lateinit var tokenListContainer:  LinearLayout
    private lateinit var permSmsIndicator:    View
    private lateinit var permNotifIndicator:  View
    private lateinit var grantPermissionBtn:  Button
    private lateinit var logsTextView:        TextView
    private lateinit var clearLogsBtn:        Button
    private lateinit var statSyncCount:       TextView
    private lateinit var statFailCount:       TextView
    private lateinit var statLastSync:        TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        androidx.appcompat.app.AppCompatDelegate.setDefaultNightMode(
            androidx.appcompat.app.AppCompatDelegate.MODE_NIGHT_NO
        )
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        statusDot           = findViewById(R.id.statusDot)
        statusText          = findViewById(R.id.statusText)
        tokenInput          = findViewById(R.id.tokenInput)
        saveButton          = findViewById(R.id.saveButton)
        tokenListContainer  = findViewById(R.id.tokenListContainer)
        permSmsIndicator    = findViewById(R.id.permSmsIndicator)
        permNotifIndicator  = findViewById(R.id.permNotifIndicator)
        grantPermissionBtn  = findViewById(R.id.grantPermissionBtn)
        logsTextView        = findViewById(R.id.logsText)
        clearLogsBtn        = findViewById(R.id.clearLogsBtn)
        statSyncCount       = findViewById(R.id.statSyncCount)
        statFailCount       = findViewById(R.id.statFailCount)
        statLastSync        = findViewById(R.id.statLastSync)

        migrateOldToken()
        renderTokenList()
        updateUIStatus()
        updatePermissionIndicators()
        loadLogs()
        updateStats()

        saveButton.setOnClickListener {
            val token = tokenInput.text.toString().trim()
            if (token.isEmpty()) {
                Toast.makeText(this, "দয়া করে Secret Token দিন", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }
            val tokens = getTokens().toMutableList()
            if (tokens.contains(token)) {
                Toast.makeText(this, "এই Token আগেই যোগ করা আছে", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }
            tokens.add(token)
            saveTokens(tokens)
            tokenInput.setText("")
            renderTokenList()
            // Show verifying state
            statusDot.setBackgroundResource(R.drawable.circle_red)
            statusText.text = "যাচাই হচ্ছে..."
            connectDevice(token, onSuccess = {
                runOnUiThread {
                    markTokenVerified(token, true)
                    updateUIStatus()
                    startPaySyncService()
                    addLog("Token যোগ ও যাচাই সফল। সার্ভারে connected।")
                    loadLogs()
                    Toast.makeText(this, "Connected! ✅", Toast.LENGTH_SHORT).show()
                }
            }, onFailure = { reason ->
                runOnUiThread {
                    markTokenVerified(token, false)
                    // Remove invalid token
                    val updated = getTokens().toMutableList().also { it.remove(token) }
                    saveTokens(updated)
                    renderTokenList()
                    updateUIStatus()
                    addLog("❌ Token যাচাই ব্যর্থ: $reason")
                    loadLogs()
                    Toast.makeText(this, "Invalid Token ❌ — আবার চেষ্টা করুন", Toast.LENGTH_LONG).show()
                }
            })
        }

        grantPermissionBtn.setOnClickListener {
            startActivity(Intent(this, SetupActivity::class.java))
        }

        clearLogsBtn.setOnClickListener {
            getSharedPreferences("FlamboyAIPrefs", Context.MODE_PRIVATE).edit()
                .putString("sync_logs", "")
                .putInt("sync_count", 0)
                .putInt("fail_count", 0)
                .putString("last_sync", "")
                .apply()
            loadLogs()
            updateStats()
            Toast.makeText(this, "লগ মুছে ফেলা হয়েছে।", Toast.LENGTH_SHORT).show()
        }

        if (isSetupComplete()) startPaySyncService()
    }

    override fun onResume() {
        super.onResume()
        updateUIStatus()
        updatePermissionIndicators()
        loadLogs()
        updateStats()
        // Heartbeat: re-verify all tokens so dashboard shows fresh last-seen
        getTokens().forEach { token ->
            connectDevice(token, onSuccess = {
                runOnUiThread { markTokenVerified(token, true); updateUIStatus() }
            }, onFailure = {
                runOnUiThread { markTokenVerified(token, false); updateUIStatus() }
            })
        }
    }

    // ── Token helpers ─────────────────────────────────────────────────────────

    private fun migrateOldToken() {
        val prefs = getSharedPreferences("FlamboyAIPrefs", Context.MODE_PRIVATE)
        val old = prefs.getString("pageToken", null)
        if (!old.isNullOrEmpty() && prefs.getString("pageTokens", null) == null) {
            val arr = JSONArray().apply { put(old) }
            prefs.edit().putString("pageTokens", arr.toString()).remove("pageToken").apply()
        }
    }

    fun getTokens(): List<String> {
        val prefs = getSharedPreferences("FlamboyAIPrefs", Context.MODE_PRIVATE)
        val raw = prefs.getString("pageTokens", null) ?: return emptyList()
        return try {
            val arr = JSONArray(raw)
            (0 until arr.length()).map { arr.getString(it) }
        } catch (e: Exception) { emptyList() }
    }

    private fun saveTokens(tokens: List<String>) {
        val arr = JSONArray().apply { tokens.forEach { put(it) } }
        getSharedPreferences("FlamboyAIPrefs", Context.MODE_PRIVATE)
            .edit().putString("pageTokens", arr.toString()).apply()
    }

    private fun renderTokenList() {
        tokenListContainer.removeAllViews()
        val tokens = getTokens()
        if (tokens.isEmpty()) {
            val empty = TextView(this).apply {
                text = "কোনো Token যোগ করা হয়নি।"
                setTextColor(0xFF9CA3AF.toInt())
                textSize = 11f
                setPadding(4, 4, 4, 4)
            }
            tokenListContainer.addView(empty)
            return
        }
        tokens.forEachIndexed { i, token ->
            val row = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                setBackgroundColor(if (i % 2 == 0) 0xFFF8FAFF.toInt() else 0xFFFFFFFF.toInt())
                setPadding(10, 10, 10, 10)
                val lp = LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT
                )
                lp.bottomMargin = 6
                layoutParams = lp
            }

            val numBadge = TextView(this).apply {
                text = "${i + 1}"
                setBackgroundColor(0xFF4F46E5.toInt())
                setTextColor(0xFFFFFFFF.toInt())
                textSize = 10f
                gravity = Gravity.CENTER
                val lp = LinearLayout.LayoutParams(22.dp, 22.dp)
                lp.marginEnd = 10
                layoutParams = lp
            }

            val label = TextView(this).apply {
                val masked = if (token.length > 8) token.take(4) + "••••" + token.takeLast(4) else "••••••••"
                text = "Token ${ i + 1 }: $masked"
                setTextColor(0xFF1F2937.toInt())
                textSize = 12f
                layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
            }

            val deleteBtn = Button(this).apply {
                text = "✕"
                setTextColor(0xFFDC2626.toInt())
                setBackgroundColor(0xFFFEE2E2.toInt())
                textSize = 11f
                val lp = LinearLayout.LayoutParams(36.dp, 36.dp)
                layoutParams = lp
                setOnClickListener {
                    val removedToken = getTokens()[i]
                    markTokenVerified(removedToken, false)
                    val updated = getTokens().toMutableList().also { it.removeAt(i) }
                    saveTokens(updated)
                    renderTokenList()
                    updateUIStatus()
                    addLog("Token ${i + 1} সরানো হয়েছে। বাকি: ${updated.size}টি।")
                    loadLogs()
                }
            }

            row.addView(numBadge)
            row.addView(label)
            row.addView(deleteBtn)
            tokenListContainer.addView(row)
        }
    }

    private val Int.dp: Int get() = (this * resources.displayMetrics.density).toInt()

    // ── UI helpers ────────────────────────────────────────────────────────────

    private fun updateUIStatus() {
        val hasVerified = getTokens().any { isTokenVerified(it) }
        val active = hasVerified && isNotificationListenerEnabled()
        statusDot.setBackgroundResource(if (active) R.drawable.circle_green else R.drawable.circle_red)
        statusText.text = if (active) "অনলাইন" else "অফলাইন"
    }

    private fun markTokenVerified(token: String, verified: Boolean) {
        val key = "verified_${token.hashCode()}"
        getSharedPreferences("FlamboyAIPrefs", Context.MODE_PRIVATE).edit().putBoolean(key, verified).apply()
    }

    private fun isTokenVerified(token: String): Boolean {
        val key = "verified_${token.hashCode()}"
        return getSharedPreferences("FlamboyAIPrefs", Context.MODE_PRIVATE).getBoolean(key, false)
    }

    private fun updatePermissionIndicators() {
        permSmsIndicator.setBackgroundResource(
            if (isNotificationListenerEnabled()) R.drawable.circle_green else R.drawable.circle_red
        )
        permNotifIndicator.setBackgroundResource(
            if (isBatteryOptimizationIgnored()) R.drawable.circle_green else R.drawable.circle_red
        )
        grantPermissionBtn.visibility = if (isSetupComplete()) View.GONE else View.VISIBLE
    }

    private fun updateStats() {
        val prefs = getSharedPreferences("FlamboyAIPrefs", Context.MODE_PRIVATE)
        statSyncCount.text = prefs.getInt("sync_count", 0).toString()
        statFailCount.text = prefs.getInt("fail_count", 0).toString()
        val last = prefs.getString("last_sync", "—")
        statLastSync.text = if (last.isNullOrEmpty()) "—" else last
    }

    private fun isNotificationListenerEnabled(): Boolean {
        val cn   = ComponentName(this, SmsNotificationListener::class.java)
        val flat = Settings.Secure.getString(contentResolver, "enabled_notification_listeners") ?: return false
        return flat.contains(cn.flattenToString())
    }

    private fun isBatteryOptimizationIgnored(): Boolean {
        val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
        val manuallyConfirmed = getSharedPreferences("setup_prefs", Context.MODE_PRIVATE)
            .getBoolean("battery_done", false)
        return pm.isIgnoringBatteryOptimizations(packageName) || manuallyConfirmed
    }

    private fun isSetupComplete() = isNotificationListenerEnabled() && isBatteryOptimizationIgnored()

    private fun startPaySyncService() {
        if (getTokens().isNotEmpty() && isNotificationListenerEnabled()) {
            val intent = Intent(this, PaySyncService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                ContextCompat.startForegroundService(this, intent)
            } else {
                startService(intent)
            }
        }
    }

    private fun loadLogs() {
        val logs = getSharedPreferences("FlamboyAIPrefs", Context.MODE_PRIVATE).getString("sync_logs", "")
        logsTextView.text = if (logs.isNullOrEmpty()) "কোনো লগ পাওয়া যায়নি।" else logs
    }

    private fun addLog(message: String) {
        val prefs = getSharedPreferences("FlamboyAIPrefs", Context.MODE_PRIVATE)
        val time = java.text.SimpleDateFormat("hh:mm a", java.util.Locale.getDefault()).format(java.util.Date())
        val updated = "[$time] $message\n${prefs.getString("sync_logs", "") ?: ""}"
        prefs.edit().putString("sync_logs", updated.split("\n").take(20).joinToString("\n")).apply()
    }

    private fun connectDevice(
        token: String,
        onSuccess: (() -> Unit)? = null,
        onFailure: ((String) -> Unit)? = null
    ) {
        val deviceName  = Build.MODEL
        val deviceModel = "${Build.MANUFACTURER} ${Build.MODEL}"
        val json = JSONObject().apply {
            put("token", token)
            put("deviceName", deviceName)
            put("deviceModel", deviceModel)
        }
        val body = json.toString().toRequestBody("application/json; charset=utf-8".toMediaTypeOrNull())
        val request = Request.Builder()
            .url("$API_BASE/sms-gateway/connect")
            .post(body)
            .build()
        httpClient.newCall(request).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                onFailure?.invoke(e.message ?: "Network error")
            }
            override fun onResponse(call: Call, response: Response) {
                val code = response.code
                response.close()
                if (code in 200..299) onSuccess?.invoke()
                else onFailure?.invoke("HTTP $code")
            }
        })
    }
}
