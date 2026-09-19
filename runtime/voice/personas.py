"""
Voice Personas Registry — OpenSarthi

Defines 6 named voice personas (3 male, 3 female).
Each persona maps to a Kokoro-82M voice ID (offline) with a gTTS fallback (lang + tld).
Language support: English (en) and Hindi (hi) only.

Usage:
    from voice.personas import get_persona, PERSONAS
    p = get_persona("JARVIS")
    # p.kokoro_voice → "am_adam"
    # p.gtts_lang → "en"
    # p.gtts_tld → "com"
"""

from dataclasses import dataclass
from typing import Optional


@dataclass(frozen=True)
class VoicePersona:
    id: str                         # Settings key (e.g. "JARVIS")
    display_name: str               # Human-readable name
    gender: str                     # "male" | "female"
    description: str                # Short style description
    language: str                   # "en" | "hi"
    edge_voice: str                 # Edge-TTS Neural Voice ID
    kokoro_voice: str               # Kokoro-82M voice ID
    gtts_lang: str                  # gTTS lang code fallback
    gtts_tld: str                   # gTTS TLD fallback


# ── Persona definitions ──────────────────────────────────────────────────────

PERSONAS: dict[str, VoicePersona] = {
    "JARVIS": VoicePersona(
        id="JARVIS",
        display_name="JARVIS",
        gender="male",
        description="Deep, authoritative & precise — the classic AI assistant",
        language="en",
        edge_voice="en-US-GuyNeural",
        kokoro_voice="am_adam",
        gtts_lang="en",
        gtts_tld="com",
    ),
    "NOVA": VoicePersona(
        id="NOVA",
        display_name="NOVA",
        gender="male",
        description="Calm, warm & reassuring — steady and reliable",
        language="en",
        edge_voice="en-US-ChristopherNeural",
        kokoro_voice="am_echo",
        gtts_lang="en",
        gtts_tld="ca",
    ),
    "ATLAS": VoicePersona(
        id="ATLAS",
        display_name="ATLAS",
        gender="male",
        description="Fast, energetic & crisp — ideal for quick tasks",
        language="en",
        edge_voice="en-GB-RyanNeural",
        kokoro_voice="am_eric",
        gtts_lang="en",
        gtts_tld="co.uk",
    ),
    "ARIA": VoicePersona(
        id="ARIA",
        display_name="ARIA",
        gender="female",
        description="Friendly, clear & helpful — natural and approachable",
        language="en",
        edge_voice="en-US-AriaNeural",
        kokoro_voice="af_heart",
        gtts_lang="en",
        gtts_tld="ie",
    ),
    "LUNA": VoicePersona(
        id="LUNA",
        display_name="LUNA",
        gender="female",
        description="Soft, soothing & elegant — smooth and thoughtful",
        language="en",
        edge_voice="en-AU-NatashaNeural",
        kokoro_voice="af_jessica",
        gtts_lang="en",
        gtts_tld="com.au",
    ),
    "SARTHI": VoicePersona(
        id="SARTHI",
        display_name="SARTHI",
        gender="female",
        description="Hindi-first, warm & expressive — natural desi voice",
        language="hi",
        edge_voice="hi-IN-SwaraNeural",
        kokoro_voice="hf_alpha",
        gtts_lang="hi",
        gtts_tld="co.in",
    ),
}

DEFAULT_PERSONA_ID = "JARVIS"


def get_persona(persona_id: str) -> VoicePersona:
    """Return the VoicePersona for a given ID, falling back to JARVIS if unknown."""
    return PERSONAS.get(persona_id.upper() if persona_id else "", PERSONAS[DEFAULT_PERSONA_ID])


def list_personas() -> list[dict]:
    """Return all personas as a JSON-serializable list for the settings API."""
    return [
        {
            "id": p.id,
            "display_name": p.display_name,
            "gender": p.gender,
            "description": p.description,
            "language": p.language,
        }
        for p in PERSONAS.values()
    ]
