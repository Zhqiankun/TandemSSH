!macro customInstall
  FileOpen $0 "$INSTDIR\.tandemssh-installed" w
  FileWrite $0 "app.tandemssh.desktop/v1$\r$\n"
  FileClose $0
!macroend

!macro customUnInstall
  Delete "$INSTDIR\.tandemssh-installed"
!macroend
