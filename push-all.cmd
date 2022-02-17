@echo off
cd /d %~dp0

:BEGIN
	echo.# ADD
	git add .
	if errorlevel 1 goto :ERROR
	echo.#
	echo.#
	
	echo.# COMMIT
	git commit -m "%COMPUTERNAME% %USERNAME% %DATE% %TIME%"
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
	