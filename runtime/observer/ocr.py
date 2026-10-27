import asyncio
import io
import shutil
from typing import Optional

TESSERACT_AVAILABLE = shutil.which("tesseract") is not None

async def extract_text(image_bytes: bytes, lang: str = "eng") -> Optional[str]:
    """
    Run Tesseract OCR on provided PNG image bytes inside a thread pool (non-blocking).
    Crops to the center area for efficiency.
    """
    if not TESSERACT_AVAILABLE:
        return None

    try:
        import pytesseract
        from PIL import Image

        def _run_ocr():
            img = Image.open(io.BytesIO(image_bytes))
            # Downscale high-resolution screenshot to prevent 100% CPU lockup
            w, h = img.size
            max_dim = 1000
            if w > max_dim or h > max_dim:
                scale = min(max_dim / w, max_dim / h)
                new_w = max(1, int(w * scale))
                new_h = max(1, int(h * scale))
                img = img.resize((new_w, new_h), Image.Resampling.BILINEAR)
            # Grayscale for speed and lower memory
            if img.mode != "L":
                img = img.convert("L")
            text = pytesseract.image_to_string(img, lang=lang, config="--psm 6")
            lines = [line.strip() for line in text.splitlines() if line.strip()]
            return "\n".join(lines)[:3000]

        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, _run_ocr)
    except ImportError:
        return None  # pytesseract or PIL not installed
    except Exception:
        return None
