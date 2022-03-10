@echo off
setlocal enabledelayedexpansion

:BEGIN
    if .%1==.     goto :ERROR_PARAM1
    rem if .%2==.     goto :ERROR_PARAM2
    if not .%3==. goto :ERROR_PARAM3


    git tag -a "%~1" -m "Version: %~1 =>  %~2"
    git push rep --tags
    goto :FINISH


:ERROR_PARAM1
	echo.# Geben sie eine Version an die sie erstellen wollen
	pause
	goto :FINISH

:ERROR_PARAM2
	echo.# Kommentare sind optional
	pause
	goto :FINISH

:ERROR_PARAM3
	echo.# Stellen sie Kommentare bitte in doppelte Hochkommata
	pause
	goto :FINISH

:FINISH
