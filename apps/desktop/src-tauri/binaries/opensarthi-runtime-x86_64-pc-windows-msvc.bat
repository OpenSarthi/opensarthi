@echo off
REM OpenSarthi — Windows Sidecar Wrapper
REM Locates the Python runtime, sets up a venv if needed, and starts the backend server.

setlocal enabledelayedexpansion

REM Get the directory of this script
set "SCRIPT_DIR=%~dp0"

REM 1. Resolve the runtime directory
if exist "%SCRIPT_DIR%..\..\..\..\..\runtime" (
    set "RUNTIME_DIR=%SCRIPT_DIR%..\..\..\..\..\runtime"
) else if exist "%SCRIPT_DIR%..\..\..\..\runtime" (
    set "RUNTIME_DIR=%SCRIPT_DIR%..\..\..\..\runtime"
) else if exist "%SCRIPT_DIR%resources\runtime" (
    set "RUNTIME_DIR=%SCRIPT_DIR%resources\runtime"
) else (
    set "RUNTIME_DIR=%SCRIPT_DIR%..\resources\runtime"
)

REM Normalize the path
for %%i in ("%RUNTIME_DIR%") do set "RUNTIME_DIR=%%~fi"

REM 2. User config venv directory
set "USER_VENV_DIR=%LOCALAPPDATA%\opensarthi"
set "USER_VENV=%USER_VENV_DIR%\.venv"

REM 3. Check for a working venv
set "ACTIVE_VENV="

REM Check dev venv first
if exist "%RUNTIME_DIR%\.venv\Scripts\python.exe" (
    "%RUNTIME_DIR%\.venv\Scripts\python.exe" -c "import uvicorn, fastapi" >NUL 2>&1
    if !errorlevel! equ 0 (
        set "ACTIVE_VENV=%RUNTIME_DIR%\.venv"
        goto :venv_ready
    )
)

REM Check user venv
if exist "%USER_VENV%\Scripts\python.exe" (
    "%USER_VENV%\Scripts\python.exe" -c "import uvicorn, fastapi" >NUL 2>&1
    if !errorlevel! equ 0 (
        set "ACTIVE_VENV=%USER_VENV%"
        goto :venv_ready
    )
)

REM 4. Bootstrap: Create a fresh venv
echo Bootstrapping Python virtual environment in %USER_VENV_DIR%...
if not exist "%USER_VENV_DIR%" mkdir "%USER_VENV_DIR%"

REM Find Python 3.10+
set "PYTHON_BIN="
for %%p in (python3 python py) do (
    where %%p >NUL 2>&1
    if !errorlevel! equ 0 (
        %%p -c "import sys; sys.exit(0 if sys.version_info >= (3,10) else 1)" >NUL 2>&1
        if !errorlevel! equ 0 (
            set "PYTHON_BIN=%%p"
            goto :found_python
        )
    )
)

REM Try py launcher with version flag
py -3.12 --version >NUL 2>&1
if !errorlevel! equ 0 (
    set "PYTHON_BIN=py -3.12"
    goto :found_python
)
py -3.11 --version >NUL 2>&1
if !errorlevel! equ 0 (
    set "PYTHON_BIN=py -3.11"
    goto :found_python
)
py -3.10 --version >NUL 2>&1
if !errorlevel! equ 0 (
    set "PYTHON_BIN=py -3.10"
    goto :found_python
)

echo ERROR: No compatible Python 3.10+ found on this system.
echo Please install Python 3.10 or later from https://www.python.org/downloads/
exit /b 1

:found_python
echo Using Python: %PYTHON_BIN%

%PYTHON_BIN% -m venv "%USER_VENV%"
if !errorlevel! neq 0 (
    echo ERROR: Failed to create Python virtual environment.
    exit /b 1
)

set "ACTIVE_VENV=%USER_VENV%"

REM Install dependencies
call "%ACTIVE_VENV%\Scripts\activate.bat"
python -m pip install --upgrade pip --quiet
if exist "%RUNTIME_DIR%\requirements.txt" (
    pip install -r "%RUNTIME_DIR%\requirements.txt" --quiet
    echo Dependencies installed successfully.
) else (
    echo WARNING: requirements.txt not found at %RUNTIME_DIR%\requirements.txt
)

:venv_ready
REM 5. Activate the virtual environment and launch
call "%ACTIVE_VENV%\Scripts\activate.bat"

REM 6. Enter the runtime directory and launch
cd /d "%RUNTIME_DIR%"
python main.py %*
