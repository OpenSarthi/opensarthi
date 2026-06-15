package dev.opensarthi.android

import android.os.Bundle
import android.util.Log
import com.getcapacitor.BridgeActivity
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.core.splashscreen.SplashScreenViewProvider
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

/**
 * Main activity — extends Capacitor's BridgeActivity to host the React WebView.
 *
 * On create, it starts the Python FastAPI runtime in a background thread via RuntimeService.
 * The React WebView then connects to ws://127.0.0.1:8765/ws — same protocol as desktop.
 *
 * Runtime startup sequence:
 *   1. OpenSarthiApp.onCreate → Python.start() (Chaquopy)
 *   2. MainActivity.onCreate  → starts RuntimeService
 *   3. RuntimeService         → runs main_android.py (FastAPI on port 8765)
 *   4. React WebView          → connects to ws://127.0.0.1:8765/ws
 */
class MainActivity : BridgeActivity() {

    companion object {
        private const val TAG = "OpenSarthi"
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        val splashScreen = installSplashScreen()
        splashScreen.setOnExitAnimationListener { provider: SplashScreenViewProvider ->
            provider.remove()
        }
        super.onCreate(savedInstanceState)
        AndroidVoiceBridge.init(this)
        
        // Request necessary permissions at startup
        val permissions = mutableListOf<String>()
        if (androidx.core.content.ContextCompat.checkSelfPermission(this, android.Manifest.permission.RECORD_AUDIO) 
            != android.content.pm.PackageManager.PERMISSION_GRANTED) {
            permissions.add(android.Manifest.permission.RECORD_AUDIO)
        }
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.TIRAMISU) {
            if (androidx.core.content.ContextCompat.checkSelfPermission(this, "android.permission.POST_NOTIFICATIONS") 
                != android.content.pm.PackageManager.PERMISSION_GRANTED) {
                permissions.add("android.permission.POST_NOTIFICATIONS")
            }
        }
        if (permissions.isNotEmpty()) {
            androidx.core.app.ActivityCompat.requestPermissions(
                this, 
                permissions.toTypedArray(), 
                101
            )
        }
        
        startRuntimeService()
    }

    private fun startRuntimeService() {
        Log.i(TAG, "Starting OpenSarthi runtime service...")
        val intent = android.content.Intent(this, RuntimeService::class.java)
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
            startForegroundService(intent)
        } else {
            startService(intent)
        }
    }
}
