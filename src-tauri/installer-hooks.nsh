!macro NSIS_HOOK_POSTINSTALL
  CreateDirectory "$SMPROGRAMS\tg-game-overlay"
  CreateShortcut "$SMPROGRAMS\tg-game-overlay\tg-game-overlay.lnk" "$INSTDIR\tg-game-overlay.exe"
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  Delete "$SMPROGRAMS\tg-game-overlay\tg-game-overlay.lnk"
  RMDir "$SMPROGRAMS\tg-game-overlay"
!macroend
