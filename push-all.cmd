@echo off
cd /d %~dp0

:BEGIN
REM	echo.# ADD
REM	git add .
REM	if errorlevel 1 goto :ERROR
REM	echo.#
REM	echo.#
	
	echo.# COMMIT
	git commit -a -m "%COMPUTERNAME% %USERNAME% %DATE% %TIME%"
	if errorlevel 1 goto :ERROR
	echo.#
	echo.#
	
	echo.# PUSH
	git push rep master
	if errorlevel 1 goto :ERROR
	echo.#
	
	echo.# Finish
	pause
	
	goto :FINISH

:ERROR
	echo.# Es wurden nicht alle Schritte ausgeführt
	pause

:FINISH
	