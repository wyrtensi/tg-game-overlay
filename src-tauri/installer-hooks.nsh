!macro NSIS_HOOK_POSTINSTALL
  CreateDirectory "$SMPROGRAMS\tg-game-overlay"
  CreateShortcut "$SMPROGRAMS\tg-game-overlay\tg-game-overlay.lnk" "$INSTDIR\tg-game-overlay.exe"
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  Delete "$SMPROGRAMS\tg-game-overlay\tg-game-overlay.lnk"
  RMDir "$SMPROGRAMS\tg-game-overlay"
  ; The app writes this value itself while autostart is on and puts it back on its next start.
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "tg-game-overlay"
!macroend
