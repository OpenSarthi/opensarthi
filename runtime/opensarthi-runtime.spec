# -*- mode: python ; coding: utf-8 -*-
import sys
import os
from PyInstaller.utils.hooks import collect_data_files

block_cipher = None

# Collect any data files needed by dependencies
datas = [
    ('api', 'api'),
    ('tools', 'tools'),
    ('planner', 'planner'),
    ('voice', 'voice'),
]

# Add openwakeword/kokoro/faster_whisper/sentence_transformers model data if present
datas += collect_data_files('openwakeword')

a = Analysis(
    ['main.py'],
    pathex=[],
    binaries=[],
    datas=datas,
    hiddenimports=[
        'fastapi',
        'uvicorn',
        'websockets',
        'pydantic',
        'pydantic_settings',
        'pydantic_ai',
        'ollama',
        'httpx',
        'SpeechRecognition',
        'faster_whisper',
        'openwakeword',
        'kokoro',
        'mss',
        'pyautogui',
        'pytesseract',
        'cv2',
        'aiosqlite',
        'lancedb',
        'sentence_transformers',
        'structlog',
        'psutil',
        'sounddevice',
        'torchaudio',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=['gi', 'gtk', 'PyGObject'], # Linux-only libraries
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zlib_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name='opensarthi-runtime',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True, # Keep console True so stdout port logging is read by Tauri
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
