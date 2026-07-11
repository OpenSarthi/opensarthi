import numpy as np
import os
from typing import Optional

class SileroVAD:
    """
    Voice Activity Detection using Silero VAD model via ONNX Runtime.
    Lightweight, runs on CPU, works offline, no PyTorch dependency!
    """

    def __init__(self, sample_rate: int = 16000, threshold: float = 0.5):
        self.sample_rate = sample_rate
        self.threshold = threshold
        self._session = None
        self._loaded = False
        self._load_attempted = False
        
        # Recurrent model states for Silero VAD
        self._h = np.zeros((1, 1, 128), dtype=np.float32)
        self._c = np.zeros((1, 1, 128), dtype=np.float32)
        self._context = np.zeros((1, 64), dtype=np.float32)

    def load(self):
        self._load_attempted = True
        try:
            import onnxruntime
            
            # Resolve model path
            model_path = None
            
            # Check 1: faster_whisper assets
            try:
                from faster_whisper.utils import get_assets_path
                path = os.path.join(get_assets_path(), "silero_vad_v6.onnx")
                if os.path.exists(path):
                    model_path = path
            except Exception:
                pass
                
            # Check 2: openwakeword resources
            if not model_path:
                try:
                    import openwakeword
                    path = os.path.join(os.path.dirname(openwakeword.__file__), "resources", "models", "silero_vad.onnx")
                    if os.path.exists(path):
                        model_path = path
                except Exception:
                    pass
                    
            # Check 3: standard config dir
            if not model_path:
                path = os.path.expanduser("~/.config/opensarthi/models/silero_vad.onnx")
                if os.path.exists(path):
                    model_path = path
                    
            if not model_path:
                raise FileNotFoundError("Could not find silero_vad.onnx in faster-whisper, openwakeword, or config directories.")
                
            opts = onnxruntime.SessionOptions()
            opts.inter_op_num_threads = 1
            opts.intra_op_num_threads = 1
            opts.enable_cpu_mem_arena = False
            opts.log_severity_level = 4
            
            self._session = onnxruntime.InferenceSession(
                model_path,
                providers=["CPUExecutionProvider"],
                sess_options=opts
            )
            self._loaded = True
            print(f"[VAD] Silero VAD (ONNX) loaded successfully from: {model_path}")
            
        except Exception as e:
            print(f"[VAD] Could not load Silero VAD (ONNX), using RMS energy threshold fallback: {e}")
            self._session = None
            self._loaded = False

    def is_speech(self, audio_chunk: np.ndarray) -> bool:
        """
        Returns True if audio chunk contains active speech.
        audio_chunk: float32 numpy array, 16kHz mono, expects 512 samples
        """
        if not self._loaded and not self._load_attempted:
            self.load()

        if self._loaded and self._session is not None:
            try:
                # Ensure input is float32 1D array of size 512
                audio_float = audio_chunk.astype(np.float32)
                if audio_float.ndim > 1:
                    audio_float = audio_float.flatten()
                
                # If chunk is not 512 samples, pad or slice it
                if len(audio_float) != 512:
                    if len(audio_float) < 512:
                        audio_float = np.pad(audio_float, (0, 512 - len(audio_float)))
                    else:
                        audio_float = audio_float[:512]
                
                # Reshape to (1, 512)
                audio_input = audio_float.reshape(1, 512)
                
                # Prepend context -> (1, 576)
                input_data = np.concatenate([self._context, audio_input], axis=1)
                
                # Run inference
                outputs = self._session.run(
                    None,
                    {"input": input_data, "h": self._h, "c": self._c}
                )
                
                # Update states for next chunk
                prob = float(outputs[0][0])
                self._h = outputs[1]
                self._c = outputs[2]
                self._context = audio_input[:, -64:]  # save last 64 samples for next context
                
                return prob > self.threshold
            except Exception:
                # Fall back to RMS if session run fails
                pass

        # Fallback: Root Mean Square (RMS) energy thresholding
        rms = np.sqrt(np.mean(audio_chunk**2))
        return rms > 0.015
