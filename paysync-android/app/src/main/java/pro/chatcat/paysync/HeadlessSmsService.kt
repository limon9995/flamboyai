package pro.FlamboyAI.paysync

import android.app.Service
import android.content.Intent
import android.os.IBinder

class HeadlessSmsService : Service() {
    override fun onBind(intent: Intent?): IBinder? = null
}
