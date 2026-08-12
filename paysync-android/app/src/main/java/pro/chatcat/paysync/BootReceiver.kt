package pro.FlamboyAI.paysync

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.content.ContextCompat

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED) {
            val sharedPref = context.getSharedPreferences("FlamboyAIPrefs", Context.MODE_PRIVATE)
            val pageToken = sharedPref.getString("pageToken", null)

            // Start service on boot only if pageToken is configured
            if (!pageToken.isNullOrEmpty()) {
                val serviceIntent = Intent(context, PaySyncService::class.java)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    ContextCompat.startForegroundService(context, serviceIntent)
                } else {
                    context.startService(serviceIntent)
                }
            }
        }
    }
}
