@echo off
cd /d %~dp0

:BEGIN
	git add .
	if errorlevel 1 goto :ERROR
	
	git commit -m "%COMPUTERNAME% %USERNAME% %DATE% %TIME%"
	if errorlevel 1 goto :ERROR
	
	git push rep master
	if errorlevel 1 goto :ERROR
	
	echo.# Finish
	pause
	
	goto :FINISH

:ERROR
	echo.# Es wurden nicht alle Schritte ausgeführt
	pause

:FINISH
	