@echo off
setlocal EnableExtensions
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 goto missing_node
if not exist teams\node_modules (
  call npm run setup
  if errorlevel 1 goto install_failed
)

rem ---- trace monitor (Vue 3 + Element Plus), built into teams\dist\trace-monitor ----
if not exist "teams\trace-monitor\node_modules" (
  echo Installing trace-monitor dependencies...
  pushd teams\trace-monitor
  call npm ci
  if errorlevel 1 (
    popd
    goto trace_monitor_install_failed
  )
  popd
)

rem ---- python trace-server (started automatically by the Teams service) ----
for /f "delims=" %%P in ('where python 2^>nul') do if not defined DEMO_TRACE_PYTHON set "DEMO_TRACE_PYTHON=%%P"
if not defined DEMO_TRACE_PYTHON (
  where py >nul 2>nul
  if not errorlevel 1 set "DEMO_TRACE_PYTHON=py"
)
if not defined DEMO_TRACE_PYTHON goto trace_python_missing
"%DEMO_TRACE_PYTHON%" -c "import fastapi, uvicorn, dotenv, google.protobuf" >nul 2>nul
if errorlevel 1 (
  echo Installing trace-server Python dependencies...
  "%DEMO_TRACE_PYTHON%" -m pip install -r "teams\trace-server\requirements.txt"
  if errorlevel 1 echo [WARN] pip install failed - the trace page will show a connection error.
)
goto launch

:trace_python_missing
echo [WARN] Python 3 not found on PATH.
echo        Install Python 3.10+ and retry, or set DEMO_TRACE_PYTHON to a python.exe.
echo.

:launch
echo Teams:      http://127.0.0.1:45970/teams
echo Talents:    http://127.0.0.1:45980/talents
echo Trace page: http://127.0.0.1:45970/teams?demo-role=owner#/trace-monitor
echo Trace API:  http://127.0.0.1:8012  (/v1/traces for OTLP, /api/v1 for queries)
echo.
echo Building Teams, Talents and the trace monitor, then starting them with trace-server.
echo Keep this window open. Press Ctrl+C to stop.
call node scripts\demo.mjs dev
exit /b %errorlevel%
:missing_node
echo Please install Node.js 24.14.1 with npm, then reopen this launcher.
pause
exit /b 1
:install_failed
echo Dependency installation failed. Check npm network access and retry.
pause
exit /b 1
:trace_monitor_install_failed
echo trace-monitor dependency installation failed. Check npm network access and retry.
pause
exit /b 1
