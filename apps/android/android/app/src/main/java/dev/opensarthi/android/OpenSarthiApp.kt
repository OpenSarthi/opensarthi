package dev.opensarthi.android

import android.app.Application
import android.util.Log
import com.chaquo.python.Python
import com.chaquo.python.android.AndroidPlatform

/**
 * Application class — starts Chaquopy Python runtime before anything else.
 * Called once per process lifetime.
 */
class OpenSarthiApp : Application() {

    companion object {
        private const val TAG = "OpenSarthiApp"
    }

    override fun onCreate() {
        super.onCreate()

        // Initialize Chaquopy Python runtime
        if (!Python.isStarted()) {
            Log.i(TAG, "Starting Chaquopy Python runtime...")
            Python.start(AndroidPlatform(this))
            Log.i(TAG, "Python runtime started.")
        }
    }
}
