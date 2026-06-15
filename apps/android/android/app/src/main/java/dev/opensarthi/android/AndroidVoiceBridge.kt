package dev.opensarthi.android

import android.content.Context
import android.content.Intent
import android.media.AudioManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.util.Log
import com.chaquo.python.Python
import java.util.Locale

/**
 * AndroidVoiceBridge — singleton for STT (SpeechRecognizer) and TTS (TextToSpeech).
 *
 * IMPORTANT: companion object methods MUST be @JvmStatic so Chaquopy can call them
 * as normal Java static methods from Python.
 */
class AndroidVoiceBridge private constructor(private val context: Context) : TextToSpeech.OnInitListener {

    companion object {
        private const val TAG = "AndroidVoiceBridge"

        @Volatile
        private var instance: AndroidVoiceBridge? = null

        @JvmStatic
        fun init(context: Context) {
            if (instance == null) {
                synchronized(this) {
                    if (instance == null) {
                        instance = AndroidVoiceBridge(context.applicationContext)
                    }
                }
            }
        }

        @JvmStatic
        fun getInstance(): AndroidVoiceBridge {
            return instance ?: throw IllegalStateException(
                "AndroidVoiceBridge not initialized. Call init(context) first."
            )
        }
    }

    private val mainHandler = Handler(Looper.getMainLooper())
    private var tts: TextToSpeech? = null
    private var speechRecognizer: SpeechRecognizer? = null
    private var isTtsInitialized = false

    @Volatile var isListeningActive = false
    @Volatile private var isSpeaking = false

    // Called by Python to be notified when an utterance finishes
    var onTtsComplete: Runnable? = null

    fun setTtsCompleteListener(listener: Runnable?) {
        this.onTtsComplete = listener
    }

    init {
        mainHandler.post {
            try {
                tts = TextToSpeech(context, this)
                initSpeechRecognizer()
            } catch (e: Exception) {
                Log.e(TAG, "Failed to initialize voice components on main thread", e)
            }
        }
    }

    private fun initSpeechRecognizer() {
        try {
            speechRecognizer?.destroy()
            speechRecognizer = SpeechRecognizer.createSpeechRecognizer(context)
            speechRecognizer?.setRecognitionListener(object : RecognitionListener {
                override fun onReadyForSpeech(params: Bundle?) {
                    Log.d(TAG, "Ready for speech")
                }
                override fun onBeginningOfSpeech() {}
                override fun onRmsChanged(rmsdB: Float) {}
                override fun onBufferReceived(buffer: ByteArray?) {}
                override fun onEndOfSpeech() { Log.d(TAG, "End of speech") }
                override fun onError(error: Int) {
                    val msg = when (error) {
                        SpeechRecognizer.ERROR_AUDIO -> "Audio error"
                        SpeechRecognizer.ERROR_CLIENT -> "Client error"
                        SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "No RECORD_AUDIO permission"
                        SpeechRecognizer.ERROR_NETWORK -> "Network error"
                        SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> "Network timeout"
                        SpeechRecognizer.ERROR_NO_MATCH -> "No speech match"
                        SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "Recognizer busy"
                        SpeechRecognizer.ERROR_SERVER -> "Server error"
                        SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "Speech timeout"
                        else -> "Unknown error $error"
                    }
                    Log.e(TAG, "SpeechRecognizer error: $msg ($error)")
                    if (isListeningActive && !isSpeaking) {
                        val delay = if (error == SpeechRecognizer.ERROR_RECOGNIZER_BUSY) 1200L else 250L
                        mainHandler.postDelayed({ rearmRecognizer() }, delay)
                    }
                }
                override fun onResults(results: Bundle?) {
                    val matches = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                    if (!matches.isNullOrEmpty()) {
                        Log.d(TAG, "Final: ${matches[0]}")
                        sendTranscriptToPython(matches[0])
                    }
                    if (isListeningActive && !isSpeaking) {
                        mainHandler.postDelayed({ rearmRecognizer() }, 150L)
                    }
                }
                override fun onPartialResults(partialResults: Bundle?) {
                    val matches = partialResults?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                    if (!matches.isNullOrEmpty()) {
                        sendPartialTranscriptToPython(matches[0])
                    }
                }
                override fun onEvent(eventType: Int, params: Bundle?) {}
            })
            Log.d(TAG, "SpeechRecognizer initialized")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to init SpeechRecognizer: ${e.message}", e)
        }
    }

    // ── TTS ──────────────────────────────────────────────────────────────────

    override fun onInit(status: Int) {
        if (status == TextToSpeech.SUCCESS) {
            val result = tts?.setLanguage(Locale.US)
            if (result == TextToSpeech.LANG_MISSING_DATA || result == TextToSpeech.LANG_NOT_SUPPORTED) {
                tts?.setLanguage(Locale.getDefault())
            }
            tts?.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                override fun onStart(utteranceId: String?) {
                    isSpeaking = true
                }
                override fun onDone(utteranceId: String?) {
                    handleSpeechFinished()
                }
                @Deprecated("Deprecated in Java")
                override fun onError(utteranceId: String?) {
                    handleSpeechFinished()
                }
                override fun onError(utteranceId: String?, errorCode: Int) {
                    Log.e(TAG, "TTS utterance error: $errorCode")
                    handleSpeechFinished()
                }
                override fun onStop(utteranceId: String?, interrupted: Boolean) {
                    handleSpeechFinished()
                }
            })
            isTtsInitialized = true
            Log.d(TAG, "TTS initialized")
        } else {
            Log.e(TAG, "TTS init failed: $status")
        }
    }

    private fun handleSpeechFinished() {
        isSpeaking = false
        onTtsComplete?.run()
        onTtsComplete = null
        sendVoiceStateToPython("idle")
        if (isListeningActive) {
            mainHandler.postDelayed({ rearmRecognizer() }, 350L)
        }
    }

    fun speak(text: String) {
        if (!isTtsInitialized) { Log.w(TAG, "TTS not ready"); return }
        mainHandler.post {
            if (isListeningActive) {
                try { speechRecognizer?.stopListening() } catch (_: Exception) {}
            }
            isSpeaking = true
            sendVoiceStateToPython("speaking")
            tts?.speak(text, TextToSpeech.QUEUE_FLUSH, null, "os_${System.currentTimeMillis()}")
        }
    }

    fun stopSpeaking() {
        mainHandler.post {
            try { tts?.stop() } catch (e: Exception) { Log.e(TAG, "stopSpeaking: ${e.message}") }
            isSpeaking = false
        }
    }

    // ── STT ──────────────────────────────────────────────────────────────────

    private var isSystemMuted = false

    private fun muteSystemSounds() {
        if (!isSystemMuted) {
            try {
                val audioManager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
                audioManager.adjustStreamVolume(AudioManager.STREAM_SYSTEM, AudioManager.ADJUST_MUTE, 0)
                isSystemMuted = true
            } catch (e: Exception) {
                Log.e(TAG, "Failed to mute system sounds: ${e.message}")
            }
        }
    }

    private fun restoreSystemSounds() {
        if (isSystemMuted) {
            try {
                val audioManager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
                audioManager.adjustStreamVolume(AudioManager.STREAM_SYSTEM, AudioManager.ADJUST_UNMUTE, 0)
                isSystemMuted = false
            } catch (e: Exception) {
                Log.e(TAG, "Failed to restore system sounds: ${e.message}")
            }
        }
    }

    // ── STT ──────────────────────────────────────────────────────────────────

    fun startListening() {
        isListeningActive = true
        muteSystemSounds()
        mainHandler.post { rearmRecognizer() }
        Log.d(TAG, "startListening() called")
    }

    fun stopListening() {
        isListeningActive = false
        restoreSystemSounds()
        mainHandler.post {
            try { speechRecognizer?.stopListening() } catch (e: Exception) { Log.e(TAG, "stopListening: ${e.message}") }
        }
        Log.d(TAG, "stopListening() called")
    }

    private fun rearmRecognizer() {
        if (!isListeningActive || isSpeaking) return
        try {
            muteSystemSounds()
            speechRecognizer?.cancel()
            val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.getDefault())
                putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
                putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_MINIMUM_LENGTH_MILLIS, 500L)
                putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 1500L)
            }
            speechRecognizer?.startListening(intent)
        } catch (e: Exception) {
            Log.e(TAG, "rearmRecognizer failed: ${e.message}")
            mainHandler.postDelayed({ rearmRecognizer() }, 1000L)
        }
    }

    // ── Python callbacks ──────────────────────────────────────────────────────

    private fun sendTranscriptToPython(text: String) {
        try {
            Python.getInstance().getModule("voice.android_bridge").callAttr("_on_transcript", text)
        } catch (e: Exception) { Log.e(TAG, "sendTranscript: ${e.message}") }
    }

    private fun sendPartialTranscriptToPython(text: String) {
        try {
            Python.getInstance().getModule("voice.android_bridge").callAttr("_on_partial_transcript", text)
        } catch (_: Exception) { }
    }

    private fun sendVoiceStateToPython(state: String) {
        try {
            Python.getInstance().getModule("voice.android_bridge").callAttr("_on_voice_state", state)
        } catch (_: Exception) { }
    }

    fun destroy() {
        isListeningActive = false
        restoreSystemSounds()
        speechRecognizer?.destroy()
        tts?.shutdown()
    }
}
