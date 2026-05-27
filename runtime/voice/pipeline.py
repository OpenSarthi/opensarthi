import asyncio
import structlog
import queue
import threading
import time
import shutil
import os
import platform
import tempfile
import numpy as np
import speech_recognition as sr
from typing import AsyncGenerator

from voice.stt import FasterWhisperSTT

logger = structlog.get_logger()

class VoicePipeline:
    def __init__(self):
        self.is_listening = False
        self.is_speaking = False
        self.is_recording_command = False
        self.current_playback_id = ""
        self.on_voice_state = None
        self.last_speech_time = 0.0
        self.start_recording_time = 0.0
        self.last_speech_stop_time = 0.0
        self._speech_buffer = []

        self.recognizer = sr.Recognizer()
        self.audio_queue = queue.Queue()
        self.listen_thread = None
        self.stt = FasterWhisperSTT()

    async def initialize(self):
        """Pre-adjust for ambient noise and pre-load local offline STT model."""
        logger.info("Initializing voice models")
        try:
            import pyaudio
            logger.info("PyAudio imported successfully in pipeline")
        except Exception as pe:
            logger.exception("Failed to import pyaudio directly")

        try:
            with sr.Microphone() as source:
                self.recognizer.adjust_for_ambient_noise(source, duration=1)
                logger.info("Microphone initialized and calibrated.")
        except Exception as e:
            logger.warning(f"Could not initialize microphone: {e}")

        try:
            # Pre-load local STT model in background so first-time capture is instantaneous
            loop = asyncio.get_running_loop()
            await loop.run_in_executor(None, self.stt.load)
            logger.info("Local offline STT model pre-loaded successfully.")
        except Exception as e:
            logger.error(f"Could not pre-load STT model: {e}")

    def _listen_worker(self):
        try:
            with sr.Microphone() as source:
                while self.is_listening:
                    if self.is_speaking or (time.time() - getattr(self, 'last_speech_stop_time', 0.0) < 1.5):
                        # Empty queue continuously during active speech and cooldown period
                        while not self.audio_queue.empty():
                            try:
                                self.audio_queue.get_nowait()
                            except Exception:
                                pass
                        time.sleep(0.1)
                        continue
                    try:
                        # Listen for audio phrase
                        audio = self.recognizer.listen(source, timeout=1, phrase_time_limit=8)
                        # Re-verify that speaking/cooldown didn't trigger while listening
                        if not self.is_speaking and (time.time() - getattr(self, 'last_speech_stop_time', 0.0) >= 1.5):
                            self.audio_queue.put(audio)
                    except sr.WaitTimeoutError:
                        continue
                    except Exception as e:
                        logger.error(f"Mic error: {e}")
                        time.sleep(1)
        except Exception as e:
            logger.error(f"Failed to open microphone: {e}")

    async def start_listening(self) -> AsyncGenerator[str, None]:
        self.is_listening = True
        logger.info("Started native Python listening")
        
        # Clear queue on startup
        while not self.audio_queue.empty():
            try:
                self.audio_queue.get_nowait()
            except Exception:
                pass

        self.listen_thread = threading.Thread(target=self._listen_worker, daemon=True)
        self.listen_thread.start()
        
        try:
            while self.is_listening:
                while not self.audio_queue.empty():
                    audio = self.audio_queue.get()
                    if self.is_speaking or (time.time() - getattr(self, 'last_speech_stop_time', 0.0) < 1.5):
                        continue
                    try:
                        # Convert audio to numpy float32 array at 16kHz
                        raw_data = audio.get_raw_data(convert_rate=16000, convert_width=2)
                        audio_array = np.frombuffer(raw_data, dtype=np.int16).astype(np.float32) / 32767.0
                        
                        # Transcribe locally in background executor (completely network-free offline transcription)
                        loop = asyncio.get_running_loop()
                        text, confidence = await loop.run_in_executor(None, self.stt.transcribe, audio_array)
                        
                        if text:
                            logger.info(f"Local offline STT transcribed: {text}")
                            yield text
                    except Exception as e:
                        logger.error(f"Local STT processing failed: {e}")
                
                await asyncio.sleep(0.1)
        except asyncio.CancelledError:
            pass
        finally:
            self.stop_listening()

    def stop_listening(self):
        self.is_listening = False
        if self.listen_thread:
            self.listen_thread = None
        logger.info("Stopped native Python listening")

    def stop_speaking(self):
        """Immediately interrupt any active speech playback."""
        self.current_playback_id = ""
        import os
        if platform.system() == "Windows":
            os.system("taskkill /F /IM wmplayer.exe >NUL 2>&1")
        else:
            os.system("killall -9 mpg123 mpv paplay aplay >/dev/null 2>&1")
        self.is_speaking = False
        self.last_speech_stop_time = time.time()
        # Drain queue
        while not self.audio_queue.empty():
            try:
                self.audio_queue.get_nowait()
            except Exception:
                pass
        logger.info("Interrupted and stopped speech synthesis")

    async def speak(self, text: str) -> str:
        """Synthesize and speak text using the best available voice engine, awaiting completion."""
        import subprocess
        import shutil
        import os
        import threading
        
        self.is_speaking = True
        try:
            logger.info("Synthesizing speech", text=text)
            
            # Clean text from emojis or problematic characters
            cleaned_text = "".join(c for c in text if c.isalnum() or c.isspace() or c in ".,!?;:'\"-")
            if not cleaned_text.strip():
                return "none"

            # Check and self-install gtts if missing
            gtts_available = False
            try:
                import gtts
                gtts_available = True
            except ImportError:
                import sys
                logger.info("gtts is missing. Dynamically self-installing gtts...")
                try:
                    subprocess.check_call(
                        [sys.executable, "-m", "pip", "install", "gtts"],
                        stdout=subprocess.DEVNULL,
                        stderr=subprocess.DEVNULL
                    )
                    import gtts
                    gtts_available = True
                    logger.info("gtts successfully self-installed!")
                except Exception as e:
                    logger.warning(f"Could not dynamically self-install gtts: {e}")

            # Layer 1: Premium Google Assistant Voice (gTTS)
            if gtts_available:
                try:
                    from gtts import gTTS
                    import uuid
                    import time
                    import re
                    
                    # Generate new unique playback ID to isolate this speech run and prevent overlaps
                    playback_id = str(uuid.uuid4())
                    self.current_playback_id = playback_id
                    
                    # Instantly terminate any active audio players to interrupt speech immediately
                    if platform.system() == "Windows":
                        os.system("taskkill /F /IM wmplayer.exe >NUL 2>&1")
                    else:
                        os.system("killall -9 mpg123 mpv paplay aplay >/dev/null 2>&1")
                    
                    from config import settings
                    voice_config = getattr(settings, "voice_accent", "ie")
                    speed = getattr(settings, "voice_speed", 1.35)
                    
                    # Resolve language and TLD dynamically based on settings
                    if voice_config in ['fr', 'es', 'de', 'hi', 'ja', 'it', 'pt']:
                        lang = voice_config
                        if voice_config == 'hi':
                            tld = 'co.in'
                        elif voice_config == 'ja':
                            tld = 'co.jp'
                        elif voice_config == 'pt':
                            tld = 'com.br'
                        else:
                            tld = voice_config
                    else:
                        lang = 'en'
                        tld = voice_config
                    
                    # Split text into sentences for sub-second start latency
                    sentences = [s.strip() for s in re.split(r'(?<=[.!?])\s+', cleaned_text) if s.strip()]
                    if not sentences:
                        return "none"
                        
                    downloaded = [False] * len(sentences)
                    _tmpdir = tempfile.gettempdir()
                    mp3_paths = [os.path.join(_tmpdir, f"opensarthi_voice_{i}.mp3") for i in range(len(sentences))]
                    wav_paths = [os.path.join(_tmpdir, f"opensarthi_voice_{i}.wav") for i in range(len(sentences))]
                    
                    # sequential downloader background thread
                    def download_worker(p_id):
                        for idx, sentence in enumerate(sentences):
                            if p_id != self.current_playback_id:
                                break
                            try:
                                tts = gTTS(text=sentence, lang=lang, tld=tld)
                                tts.save(mp3_paths[idx])
                                downloaded[idx] = True
                            except Exception as de:
                                logger.error(f"gTTS chunk {idx} download failed: {de}")
                                downloaded[idx] = True # Mark true so loop doesn't block forever
                    
                    # playback worker
                    def _play_gtts(p_id):
                        try:
                            for idx in range(len(sentences)):
                                if p_id != self.current_playback_id:
                                    return
                                    
                                while not downloaded[idx]:
                                    if p_id != self.current_playback_id:
                                        return
                                    time.sleep(0.02)
                                    
                                mp3_path = mp3_paths[idx]
                                wav_path = wav_paths[idx]
                                
                                if not os.path.exists(mp3_path):
                                    continue
                                    
                                speedup_mp3_path = os.path.join(_tmpdir, f"opensarthi_voice_fast_{idx}.mp3")
                                if shutil.which("ffmpeg"):
                                    try:
                                        if os.system(f"ffmpeg -y -i {mp3_path} -filter:a 'atempo={speed}' {speedup_mp3_path} >/dev/null 2>&1") == 0:
                                            mp3_path = speedup_mp3_path
                                    except Exception as fe:
                                        logger.warning(f"ffmpeg speedup failed on chunk {idx}: {fe}")
                                        
                                wav_converted = False
                                if shutil.which("mpg123"):
                                    try:
                                        os.system(f"mpg123 -w {wav_path} {mp3_path} >/dev/null 2>&1")
                                        wav_converted = True
                                    except Exception:
                                        pass
                                if not wav_converted and shutil.which("ffmpeg"):
                                    try:
                                        os.system(f"ffmpeg -y -i {mp3_path} {wav_path} >/dev/null 2>&1")
                                        wav_converted = True
                                    except Exception:
                                        pass
 
                                if p_id != self.current_playback_id:
                                    return
 
                                played = False
                                if shutil.which("mpv"):
                                    if mp3_path == speedup_mp3_path:
                                        os.system(f"mpv {mp3_path} >/dev/null 2>&1")
                                    else:
                                        os.system(f"mpv --speed={speed} {mp3_path} >/dev/null 2>&1")
                                    played = True
                                    
                                if not played and shutil.which("mpg123"):
                                    for driver in ["pulse", "alsa"]:
                                        exit_code = os.system(f"mpg123 -o {driver} {mp3_path} >/dev/null 2>&1")
                                        if exit_code == 0:
                                            played = True
                                            break
                                    if not played:
                                        os.system(f"mpg123 {mp3_path} >/dev/null 2>&1")
                                        played = True
                                        
                                if not played and wav_converted:
                                    if shutil.which("paplay"):
                                        os.system(f"paplay {wav_path} >/dev/null 2>&1")
                                        played = True
                                    elif shutil.which("aplay"):
                                        os.system(f"aplay {wav_path} >/dev/null 2>&1")
                                        played = True
                                        
                                if not played:
                                    for player in ["mpg321", "play", "cvlc"]:
                                        if shutil.which(player):
                                            if player == "cvlc":
                                                os.system(f"cvlc --play-and-exit {mp3_path} >/dev/null 2>&1")
                                            elif player == "play":
                                                os.system(f"play {mp3_path} >/dev/null 2>&1")
                                            else:
                                                os.system(f"{player} {mp3_path} >/dev/null 2>&1")
                                            played = True
                                            break
                        except Exception as ex:
                            logger.error(f"gTTS playback failure: {ex}")
                    
                    threading.Thread(target=download_worker, args=(playback_id,), daemon=True).start()
                    await asyncio.to_thread(_play_gtts, playback_id)
                    logger.info("Speech synthesis streaming completed successfully")
                    return "gtts"
                except Exception as e:
                    logger.warning(f"Failed to play premium gTTS voice: {e}")
 
            # Layer 2: Speech Dispatcher client (Offline Fallback)
            if shutil.which("spd-say"):
                try:
                    await asyncio.to_thread(
                        subprocess.run,
                        ["spd-say", "-t", "female1", "-r", "0", "-w", cleaned_text],
                        stdout=subprocess.DEVNULL,
                        stderr=subprocess.DEVNULL
                    )
                    logger.info("Speech synthesis completed via spd-say fallback")
                    return "spd-say"
                except Exception as e:
                    logger.warning(f"spd-say fallback execution failed: {e}")
 
            # Layer 3: eSpeak (Offline Fallback)
            if shutil.which("espeak"):
                try:
                    await asyncio.to_thread(
                        subprocess.run,
                        ["espeak", "-v", "en-us+f3", "-s", "160", cleaned_text],
                        stdout=subprocess.DEVNULL,
                        stderr=subprocess.DEVNULL
                    )
                    logger.info("Speech synthesis completed via espeak fallback")
                    return "espeak"
                except Exception as e:
                    logger.warning(f"espeak fallback execution failed: {e}")
 
            logger.warning("No speech synthesis engines could play the audio output!")
            return "none"
        finally:
            self.is_speaking = False
            self.last_speech_stop_time = time.time()
            # Drain any audio that was queued during speech
            while not self.audio_queue.empty():
                try:
                    self.audio_queue.get_nowait()
                except Exception:
                    pass
