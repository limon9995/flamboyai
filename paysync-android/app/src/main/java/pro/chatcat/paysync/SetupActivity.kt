package pro.FlamboyAI.paysync

import android.Manifest
import android.app.role.RoleManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.provider.Telephony
import android.view.View
import android.widget.Button
import android.widget.ProgressBar
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat

class SetupActivity : AppCompatActivity() {

    // Step keys — used as stable IDs regardless of list position
    enum class StepKey {
        RESTRICTED_SETTINGS,
        NOTIFICATION_ACCESS,
        NOTIFICATION_PERMISSION,
        DEFAULT_SMS,
        BATTERY,
        AUTOSTART
    }

    data class Step(
        val key: StepKey,
        val icon: String,
        val title: String,
        val desc: String,
        val why: String,
        val btnLabel: String,
        val needsConfirm: Boolean = false  // true = show "হয়ে গেছে" button after action
    )

    // Built once at onCreate based on this device
    private lateinit var steps: List<Step>
    private var stepIndex = 0   // index into steps list

    private var confirmShown = false

    private val REQ_DEFAULT_SMS = 100
    private val REQ_NOTIF       = 102

    private lateinit var stepCounter:    TextView
    private lateinit var setupProgress:  ProgressBar
    private lateinit var stepIcon:       TextView
    private lateinit var stepTitle:      TextView
    private lateinit var stepDesc:       TextView
    private lateinit var stepWhy:        TextView
    private lateinit var grantedRow:     View
    private lateinit var actionBtn:      Button
    private lateinit var confirmDoneBtn: Button
    private lateinit var skipBtn:        Button

    private val prefs: SharedPreferences by lazy {
        getSharedPreferences("setup_prefs", Context.MODE_PRIVATE)
    }

    // ── Build dynamic step list for THIS device ───────────────────────────────

    private fun buildSteps(): List<Step> {
        val list = mutableListOf<Step>()
        val brand = Build.MANUFACTURER.lowercase()

        // Step: Allow Restricted Settings — only Android 13+ needs this
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            list.add(Step(
                key = StepKey.RESTRICTED_SETTINGS,
                icon = "🔓",
                title = "Permission Unlock করুন",
                desc = "Notification Access চালু করতে আগে একবার app-কে unlock করতে হবে।",
                why = "নিচের বাটন চাপলে App Info page খুলবে।\n\n" +
                        "① উপরে ডানে ⋮ (তিন-ডট) চাপুন\n" +
                        "② \"Allow restricted settings\" চাপুন\n" +
                        "③ ফিরে এসে \"হয়ে গেছে\" চাপুন\n\n" +
                        "⚠️ ⋮ মেনু না দেখলে Skip করুন — আপনার Android version-এ দরকার নেই।",
                btnLabel = "App Info খুলুন →",
                needsConfirm = true
            ))
        }

        // Step: Notification Access — always needed
        list.add(Step(
            key = StepKey.NOTIFICATION_ACCESS,
            icon = "🔔",
            title = "Notification Access চালু করুন",
            desc = "তালিকায় FlamboyAI PaySync খুঁজে Toggle ON করুন।",
            why = "💡 bKash / Nagad / Rocket এর payment notification পড়ে auto-verify করার জন্য এই permission লাগবে।",
            btnLabel = "Notification Access Settings খুলুন"
        ))

        // Step: Notification Permission — only Android 13+
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            list.add(Step(
                key = StepKey.NOTIFICATION_PERMISSION,
                icon = "📳",
                title = "নোটিফিকেশন পারমিশন",
                desc = "PaySync চলার সময় status bar এ notification দেখাতে এই অনুমতি লাগবে।",
                why = "💡 Background service চলার সময় Android এর requirement অনুযায়ী একটি ছোট notification দেখাতে হয়।",
                btnLabel = "নোটিফিকেশন Allow করুন"
            ))
        }

        // Step: Default SMS App — only if not already default
        if (!isDefaultSmsApp()) {
            list.add(Step(
                key = StepKey.DEFAULT_SMS,
                icon = "📲",
                title = "Default SMS App সেট করুন",
                desc = "FlamboyAI PaySync কে Default SMS App করলে notification ছাড়াই SMS সরাসরি পড়া যাবে — আরও reliable।",
                why = "💡 পরে আবার আগের SMS app Default করতে পারবেন।",
                btnLabel = "Default SMS App সেট করুন"
            ))
        }

        // Step: Battery — always useful
        list.add(Step(
            key = StepKey.BATTERY,
            icon = "⚡",
            title = "ব্যাটারি অপ্টিমাইজেশন বন্ধ",
            desc = "ফোন lock থাকলেও PaySync চলবে, কোনো payment মিস হবে না।",
            why = "💡 Android battery বাঁচাতে background app বন্ধ করে দেয়। এই সেটিং না দিলে ফোন lock এর পর payment notification মিস হবে।",
            btnLabel = "Battery সেটিং খুলুন",
            needsConfirm = true
        ))

        // Step: Autostart — only for known brands that actually have this setting
        val autostartBrand = detectAutostartBrand(brand)
        if (autostartBrand != null) {
            list.add(Step(
                key = StepKey.AUTOSTART,
                icon = "🚀",
                title = "Autostart চালু করুন",
                desc = "ফোন restart হলে PaySync স্বয়ংক্রিয়ভাবে চালু হবে।",
                why = autostartBrand.instructions,
                btnLabel = "Autostart Settings খুলুন",
                needsConfirm = true
            ))
        }

        return list
    }

    data class AutostartBrand(val instructions: String, val intentAction: (() -> Intent?)?)

    private fun detectAutostartBrand(brand: String): AutostartBrand? = when {
        brand.contains("xiaomi") || brand.contains("redmi") || brand.contains("poco") -> AutostartBrand(
            "📱 Xiaomi/Redmi/POCO:\nSecurity app → Manage apps → FlamboyAI PaySync → Autostart → চালু করুন",
            { tryIntent("com.miui.securitycenter", "com.miui.permcenter.autostart.AutoStartManagementActivity") }
        )
        brand.contains("huawei") || brand.contains("honor") -> AutostartBrand(
            "📱 Huawei/Honor:\nSettings → Apps → FlamboyAI PaySync → Battery → App launch → Manage manually → Auto-launch ON",
            { tryIntent("com.huawei.systemmanager", "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity") }
        )
        brand.contains("samsung") -> AutostartBrand(
            "📱 Samsung:\nSettings → Battery & device care → Battery → Background usage limits → Never sleeping apps → PaySync যোগ করুন",
            { tryIntent("com.samsung.android.lool", "com.samsung.android.sm.ui.battery.BatteryActivity") }
        )
        brand.contains("oppo") || brand.contains("realme") -> AutostartBrand(
            "📱 OPPO/Realme:\nSafe Center → Startup Manager → FlamboyAI PaySync চালু করুন",
            { tryIntent("com.coloros.safecenter", "com.coloros.safecenter.startupapp.StartupAppListActivity") }
        )
        brand.contains("vivo") -> AutostartBrand(
            "📱 Vivo:\niManager → App Manager → Autostart → FlamboyAI PaySync চালু করুন",
            { tryIntent("com.vivo.permissionmanager", "com.vivo.permissionmanager.activity.BgStartUpManagerActivity") }
        )
        brand.contains("oneplus") -> AutostartBrand(
            "📱 OnePlus:\nSettings → Battery → Battery Optimization → FlamboyAI PaySync → Don't optimize",
            { tryIntent("com.oneplus.security", "com.oneplus.security.chainlaunch.view.ChainLaunchAppListActivity") }
        )
        brand.contains("asus") -> AutostartBrand(
            "📱 Asus:\nMobile Manager → Autostart → FlamboyAI PaySync চালু করুন",
            { tryIntent("com.asus.mobilemanager", "com.asus.mobilemanager.autostart.AutoStartActivity") }
        )
        // Unknown brand — skip this step entirely
        else -> null
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    override fun onCreate(savedInstanceState: Bundle?) {
        androidx.appcompat.app.AppCompatDelegate.setDefaultNightMode(
            androidx.appcompat.app.AppCompatDelegate.MODE_NIGHT_NO
        )
        super.onCreate(savedInstanceState)

        steps = buildSteps()

        // Skip already-done steps at start
        stepIndex = steps.indexOfFirst { !isStepDone(it.key) }
        if (stepIndex == -1) { goToMain(); return }

        setContentView(R.layout.activity_setup)

        stepCounter    = findViewById(R.id.stepCounter)
        setupProgress  = findViewById(R.id.setupProgress)
        stepIcon       = findViewById(R.id.stepIcon)
        stepTitle      = findViewById(R.id.stepTitle)
        stepDesc       = findViewById(R.id.stepDesc)
        stepWhy        = findViewById(R.id.stepWhy)
        grantedRow     = findViewById(R.id.grantedRow)
        actionBtn      = findViewById(R.id.actionBtn)
        confirmDoneBtn = findViewById(R.id.confirmDoneBtn)
        skipBtn        = findViewById(R.id.skipBtn)

        setupProgress.max = steps.size
        renderStep()

        actionBtn.setOnClickListener      { handleAction() }
        confirmDoneBtn.setOnClickListener { confirmAndAdvance() }
        skipBtn.setOnClickListener        { advanceStep() }
    }

    override fun onResume() {
        super.onResume()
        if (!::actionBtn.isInitialized) return
        val step = steps.getOrNull(stepIndex) ?: return
        // Auto-advance for steps that can be detected programmatically
        if (step.key in listOf(StepKey.NOTIFICATION_ACCESS, StepKey.NOTIFICATION_PERMISSION, StepKey.DEFAULT_SMS)
            && isStepDone(step.key)) {
            android.os.Handler(mainLooper).postDelayed({ advanceStep() }, 400)
            return
        }
        renderStep()
    }

    // ── Render ────────────────────────────────────────────────────────────────

    private fun renderStep() {
        val step = steps.getOrNull(stepIndex) ?: run { goToMain(); return }
        val total = steps.size
        val num = stepIndex + 1
        val bengaliNums = listOf("১","২","৩","৪","৫","৬","৭")

        stepCounter.text       = "ধাপ ${bengaliNums.getOrElse(stepIndex){"$num"}}/$total"
        setupProgress.progress = num
        stepIcon.text          = step.icon
        stepTitle.text         = step.title
        stepDesc.text          = step.desc
        stepWhy.text           = step.why

        val isDone = isStepDone(step.key)
        if (isDone) {
            grantedRow.visibility     = View.VISIBLE
            actionBtn.text            = "পরবর্তী ধাপ →"
            actionBtn.backgroundTintList = tintOf(R.color.success)
            confirmDoneBtn.visibility = View.GONE
            skipBtn.visibility        = View.GONE
        } else {
            grantedRow.visibility = View.GONE
            actionBtn.text        = step.btnLabel
            actionBtn.backgroundTintList = tintOf(R.color.brand_primary)
            skipBtn.visibility    = View.VISIBLE
            confirmDoneBtn.visibility = if (step.needsConfirm && confirmShown) View.VISIBLE else View.GONE
        }
    }

    // ── Actions ───────────────────────────────────────────────────────────────

    private fun handleAction() {
        if (isStepDone(steps[stepIndex].key)) { advanceStep(); return }
        confirmShown = false
        when (steps[stepIndex].key) {
            StepKey.RESTRICTED_SETTINGS -> {
                startActivity(
                    Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                        data = Uri.parse("package:$packageName")
                    }
                )
                confirmShown = true
                android.os.Handler(mainLooper).postDelayed({ renderStep() }, 1500)
            }
            StepKey.NOTIFICATION_ACCESS ->
                startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
            StepKey.NOTIFICATION_PERMISSION ->
                ActivityCompat.requestPermissions(
                    this, arrayOf(Manifest.permission.POST_NOTIFICATIONS), REQ_NOTIF
                )
            StepKey.DEFAULT_SMS -> requestDefaultSmsApp()
            StepKey.BATTERY -> {
                requestBattery()
                confirmShown = true
                android.os.Handler(mainLooper).postDelayed({ renderStep() }, 1500)
            }
            StepKey.AUTOSTART -> {
                openAutostartSettings()
                confirmShown = true
                android.os.Handler(mainLooper).postDelayed({ renderStep() }, 1500)
            }
        }
    }

    private fun confirmAndAdvance() {
        when (steps[stepIndex].key) {
            StepKey.RESTRICTED_SETTINGS -> prefs.edit().putBoolean("restricted_done", true).apply()
            StepKey.BATTERY             -> prefs.edit().putBoolean("battery_done", true).apply()
            StepKey.AUTOSTART           -> prefs.edit().putBoolean("autostart_done", true).apply()
            else -> {}
        }
        advanceStep()
    }

    private fun advanceStep() {
        confirmShown = false
        stepIndex++
        // Skip already-done steps
        while (stepIndex < steps.size && isStepDone(steps[stepIndex].key)) stepIndex++
        renderStep()
    }

    // ── Step completion checks ────────────────────────────────────────────────

    private fun isStepDone(key: StepKey) = when (key) {
        StepKey.RESTRICTED_SETTINGS    -> prefs.getBoolean("restricted_done", false)
        StepKey.NOTIFICATION_ACCESS    -> isNotificationListenerEnabled()
        StepKey.NOTIFICATION_PERMISSION -> hasNotifPermission()
        StepKey.DEFAULT_SMS            -> isDefaultSmsApp()
        StepKey.BATTERY                -> isBatteryOptimizationIgnored() || prefs.getBoolean("battery_done", false)
        StepKey.AUTOSTART              -> prefs.getBoolean("autostart_done", false)
    }

    // ── Permission helpers ────────────────────────────────────────────────────

    private fun requestDefaultSmsApp() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val rm = getSystemService(RoleManager::class.java)
            if (!rm.isRoleAvailable(RoleManager.ROLE_SMS)) { advanceStep(); return }
            if (rm.isRoleHeld(RoleManager.ROLE_SMS)) { advanceStep(); return }
            try {
                startActivityForResult(rm.createRequestRoleIntent(RoleManager.ROLE_SMS), REQ_DEFAULT_SMS)
            } catch (e: Exception) {
                // RoleManager failed — try legacy intent
                tryLegacyDefaultSms()
            }
        } else {
            tryLegacyDefaultSms()
        }
    }

    private fun tryLegacyDefaultSms() {
        try {
            val intent = Intent(Telephony.Sms.Intents.ACTION_CHANGE_DEFAULT).apply {
                putExtra(Telephony.Sms.Intents.EXTRA_PACKAGE_NAME, packageName)
            }
            startActivityForResult(intent, REQ_DEFAULT_SMS)
        } catch (e: Exception) {
            // Device doesn't support changing default SMS app — skip this step
            advanceStep()
        }
    }

    private fun requestBattery() {
        try {
            startActivity(
                Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                    data = Uri.parse("package:$packageName")
                }
            )
        } catch (e: Exception) {
            startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
        }
    }

    private fun openAutostartSettings() {
        val brand = Build.MANUFACTURER.lowercase()
        val autostartBrand = detectAutostartBrand(brand) ?: return
        val intent = autostartBrand.intentAction?.invoke()
        val launched = intent?.let { runCatching { startActivity(it); true }.getOrDefault(false) } ?: false
        if (!launched) {
            startActivity(
                Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                    data = Uri.parse("package:$packageName")
                }
            )
        }
    }

    // ── Callbacks ─────────────────────────────────────────────────────────────

    override fun onRequestPermissionsResult(
        requestCode: Int, permissions: Array<out String>, grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (grantResults.isNotEmpty() && grantResults.all { it == PackageManager.PERMISSION_GRANTED }) {
            android.os.Handler(mainLooper).postDelayed({ advanceStep() }, 400)
        } else renderStep()
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == REQ_DEFAULT_SMS) {
            if (isDefaultSmsApp()) {
                android.os.Handler(mainLooper).postDelayed({ advanceStep() }, 400)
            } else {
                renderStep()
                stepWhy.text = "⚠️ Default SMS App সেট হয়নি।\n\nআবার চেষ্টা করুন অথবা \"পরে দেব\" চাপুন — Notification Listener দিয়েও কাজ চলবে।"
            }
        }
    }

    // ── Device checks ─────────────────────────────────────────────────────────

    private fun isNotificationListenerEnabled(): Boolean {
        val cn   = ComponentName(this, SmsNotificationListener::class.java)
        val flat = Settings.Secure.getString(contentResolver, "enabled_notification_listeners") ?: return false
        return flat.contains(cn.flattenToString())
    }

    private fun hasNotifPermission() =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU)
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
        else true

    private fun isDefaultSmsApp(): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val rm = getSystemService(RoleManager::class.java)
            rm.isRoleHeld(RoleManager.ROLE_SMS)
        } else {
            Telephony.Sms.getDefaultSmsPackage(this) == packageName
        }
    }

    private fun isBatteryOptimizationIgnored(): Boolean {
        val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
        return pm.isIgnoringBatteryOptimizations(packageName)
    }

    // ── Utils ─────────────────────────────────────────────────────────────────

    private fun goToMain() {
        startActivity(Intent(this, MainActivity::class.java))
        finish()
    }

    private fun tryIntent(pkg: String, cls: String) = Intent().apply {
        component = android.content.ComponentName(pkg, cls)
    }

    private fun tintOf(colorRes: Int) =
        android.content.res.ColorStateList.valueOf(ContextCompat.getColor(this, colorRes))
}
