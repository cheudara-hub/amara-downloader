; AMARA Downloader NSIS Installer Script
Unicode True

!include "MUI2.nsh"
!include "FileFunc.nsh"

!ifndef AMARA_VERSION
  !define AMARA_VERSION "2.8.8"
!endif
!ifndef RUNTIME_DIR
  !define RUNTIME_DIR "..\Hongguo English"
!endif
!ifndef UNINSTALL_FILES
  !error "Build with tools/build-windows.py to generate the safe uninstall manifest"
!endif
!ifndef OUTPUT_FILE
  !define OUTPUT_FILE "..\release\AMARA-Downloader-Setup-${AMARA_VERSION}.exe"
!endif

Name "AMARA Downloader"
OutFile "${OUTPUT_FILE}"
InstallDir "$LOCALAPPDATA\Programs\AMARA Downloader"
InstallDirRegKey HKCU "Software\AMARA Downloader" "InstallDir"
RequestExecutionLevel user

SetCompressor /SOLID lzma

!ifndef APP_PACKAGE
  !define APP_PACKAGE "..\Hongguo English\resources\app.asar"
!endif

!define MUI_ICON "${RUNTIME_DIR}\amara.ico"
!define MUI_UNICON "${RUNTIME_DIR}\amara.ico"
!define MUI_ABORTWARNING

; Pages
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES

!define MUI_FINISHPAGE_RUN "$INSTDIR\AMARA Downloader.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Launch AMARA Downloader"
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "English"

Section "AMARA Downloader" SecApp
  SetOutPath "$INSTDIR"
  
  ; Package runtime files only; preserve existing user settings and queues.
  File /r /x english-user-data /x app.asar /x *.log "${RUNTIME_DIR}\*.*"
  SetOutPath "$INSTDIR\resources"
  File /oname=app.asar "${APP_PACKAGE}"
  SetOutPath "$INSTDIR"
  
  ; Write uninstaller
  WriteUninstaller "$INSTDIR\Uninstall AMARA Downloader.exe"
  
  ; Registry keys for Add/Remove Programs
  WriteRegStr HKCU "Software\AMARA Downloader" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AMARA Downloader" "DisplayName" "AMARA Downloader"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AMARA Downloader" "UninstallString" '"$INSTDIR\Uninstall AMARA Downloader.exe"'
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AMARA Downloader" "DisplayIcon" "$INSTDIR\amara.ico"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AMARA Downloader" "DisplayVersion" "${AMARA_VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AMARA Downloader" "Publisher" "AMARA"
  
  ; Shortcuts
  CreateDirectory "$SMPROGRAMS\AMARA Downloader"
  CreateShortcut "$SMPROGRAMS\AMARA Downloader\AMARA Downloader.lnk" "$INSTDIR\AMARA Downloader.exe" "" "$INSTDIR\amara.ico" 0
  CreateShortcut "$SMPROGRAMS\AMARA Downloader\Uninstall AMARA Downloader.lnk" "$INSTDIR\Uninstall AMARA Downloader.exe" "" "$INSTDIR\amara.ico" 0
  CreateShortcut "$DESKTOP\AMARA Downloader.lnk" "$INSTDIR\AMARA Downloader.exe" "" "$INSTDIR\amara.ico" 0
SectionEnd

Section "Uninstall"
  Delete "$DESKTOP\AMARA Downloader.lnk"
  RMDir /r "$SMPROGRAMS\AMARA Downloader"
  
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AMARA Downloader"
  DeleteRegKey HKCU "Software\AMARA Downloader"
  
  ; Remove packaged files only. Keep settings, queues, and any user videos.
  !include "${UNINSTALL_FILES}"
  Delete "$INSTDIR\Uninstall AMARA Downloader.exe"
  RMDir "$INSTDIR"
SectionEnd
