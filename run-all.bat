@echo off
rem Lance la stack du parapheur en local (backend + back-office + DMZ).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\run-all.ps1"
