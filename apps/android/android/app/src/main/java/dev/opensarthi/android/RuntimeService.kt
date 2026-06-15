package dev.opensarthi.android

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import com.chaquo.python.Python
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * RuntimeService — runs the Python FastAPI server in a foreground service.
 *
 * Why foreground service?
 *   Android kills background services aggressively. The FastAPI server must
 *   stay alive as long as the user is in the app (and optionally when backgrounded).
 *   A foreground service with a persistent notification is the correct pattern.
 *
 * How Chaquopy runs the server:
 *   Python.getInstance().getModule("main_android").callAttr("start_server")
 *   This calls start_server() in runtime/main_android.py which starts uvicorn
 *   on port 8765 in a background asyncio thread.
 */
class RuntimeService : Service() {

    companion object {
        private const val TAG = "OpenSarthiRuntime"
        private const val NOTIFICATION_ID = 1001
        private const val CHANNEL_ID = "opensarthi_runtime"
        private const val RUNTIME_PORT = 8765

        const val ACTION_PAUSE = "dev.opensarthi.android.ACTION_PAUSE"
        const val ACTION_STOP = "dev.opensarthi.android.ACTION_STOP"

        private var instance: RuntimeService? = null

        @JvmStatic
        fun updateTaskState(isTaskActive: Boolean, isPaused: Boolean) {
            instance?.updateNotificationState(isTaskActive, isPaused)
        }
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var runtimeStarted = false
    private var currentTaskActive = false
    private var currentPaused = false

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        instance = this
        createNotificationChannel()
        startForeground(NOTIFICATION_ID, buildNotification())
        startPythonRuntime()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent != null) {
            val action = intent.action
            if (action == ACTION_PAUSE) {
                togglePauseTask()
            } else if (action == ACTION_STOP) {
                stopTask()
            }
        }
        return START_STICKY
    }

    private fun togglePauseTask() {
        scope.launch {
            try {
                val py = Python.getInstance()
                val wsModule = py.getModule("api.websocket")
                val manager = wsModule.get("manager")
                if (currentPaused) {
                    manager?.callAttr("resume_all_tasks")
                } else {
                    manager?.callAttr("pause_all_tasks")
                }
            } catch (e: Exception) {
                Log.e(TAG, "Failed to toggle pause task: ${e.message}", e)
            }
        }
    }

    private fun stopTask() {
        scope.launch {
            try {
                val py = Python.getInstance()
                val wsModule = py.getModule("api.websocket")
                val manager = wsModule.get("manager")
                manager?.callAttr("stop_all_tasks")
            } catch (e: Exception) {
                Log.e(TAG, "Failed to stop task: ${e.message}", e)
            }
        }
    }

    private fun startPythonRuntime() {
        if (runtimeStarted) return
        runtimeStarted = true

        scope.launch {
            try {
                Log.i(TAG, "Starting Python FastAPI runtime on port $RUNTIME_PORT...")
                val py = Python.getInstance()
                // main_android.py is in runtime/ which is included as a Python source dir
                val mainModule = py.getModule("main_android")
                // Blocking call — start_server() runs uvicorn and blocks until service stops
                mainModule.callAttr("start_server", RUNTIME_PORT)
            } catch (e: Exception) {
                Log.e(TAG, "Python runtime failed to start: ${e.message}", e)
            }
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        instance = null
        try {
            val py = Python.getInstance()
            py.getModule("main_android").callAttr("stop_server")
        } catch (e: Exception) {
            Log.w(TAG, "Error stopping Python server: ${e.message}")
        }
        Log.i(TAG, "RuntimeService destroyed")
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "OpenSarthi AI Runtime",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Keeps the AI agent runtime active"
                setShowBadge(false)
            }
            val manager = getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(channel)
        }
    }

    fun updateNotificationState(isTaskActive: Boolean, isPaused: Boolean) {
        currentTaskActive = isTaskActive
        currentPaused = isPaused
        val notificationManager = getSystemService(NotificationManager::class.java)
        notificationManager?.notify(NOTIFICATION_ID, buildNotification())
    }

    private fun buildNotification(): Notification {
        val builder = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("OpenSarthi")
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setOngoing(true)
            .setOnlyAlertOnce(true)

        if (currentTaskActive) {
            if (currentPaused) {
                builder.setContentText("Task paused")
                val resumeIntent = Intent(this, RuntimeService::class.java).apply { action = ACTION_PAUSE }
                val pendingResume = PendingIntent.getService(
                    this,
                    1,
                    resumeIntent,
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
                )
                builder.addAction(android.R.drawable.ic_media_play, "Resume", pendingResume)
            } else {
                builder.setContentText("Task in progress...")
                val pauseIntent = Intent(this, RuntimeService::class.java).apply { action = ACTION_PAUSE }
                val pendingPause = PendingIntent.getService(
                    this,
                    1,
                    pauseIntent,
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
                )
                builder.addAction(android.R.drawable.ic_media_pause, "Pause", pendingPause)
            }

            val stopIntent = Intent(this, RuntimeService::class.java).apply { action = ACTION_STOP }
            val pendingStop = PendingIntent.getService(
                this,
                2,
                stopIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            builder.addAction(android.R.drawable.ic_menu_close_clear_cancel, "Stop", pendingStop)
        } else {
            builder.setContentText("AI runtime active")
        }

        return builder.build()
    }
}
