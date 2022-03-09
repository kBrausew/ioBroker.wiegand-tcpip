@echo off
cd /d %~dp0

if not .%2==. goto :ERROR_PARAM

:BEGIN
	echo.# ADD
	git add .
REM	if errorlevel 1 goto :ERROR
	echo.#
	echo.#
	
	echo.# COMMIT
	git commit -a -m "%1 %COMPUTERNAME% %USERNAME% %DATE% %TIME%"
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
	goto :FINISH

:ERROR_PARAM
	echo.# Stellen sie Kommentare bitte in doppelte Hochkommatas
	pause
	goto :FINISH

:FINISH
	