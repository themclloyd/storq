; Installer hooks for the Windows till.
;
; Two jobs, both about the folder a shop has to find after setup.
;
; 1. Before installing, remove a per-user copy left by 1.1.0 and earlier. Those
;    builds were `currentUser`, so they live in %LOCALAPPDATA%\Storq POS with
;    their own "Add or remove" entry and shortcuts. A machine-wide install
;    cannot see them (they register under HKCU, this one writes HKLM), and
;    leaving one behind means two icons, two builds, and an update installed
;    next to a copy nobody deleted. The shop's data stays: it lives in
;    %APPDATA%\xyz.storq.pos, which a silent uninstall does not touch.
;
; 2. After installing, always write the Start Menu and desktop shortcuts. The
;    stock template only offers the desktop icon as a checkbox on the finish page,
;    so a cashier who clicks Finish is left with no icon and asks why the app "did
;    not install".

!macro NSIS_HOOK_PREINSTALL
  ; Only a machine-wide build can have a stale per-user copy to remove. Under
  ; currentUser that folder *is* $INSTDIR, so this guard also keeps a future
  ; flip back to per-user installs from deleting what it just installed.
  ; INSTALLMODE is defined after this file is included but before the hook is
  ; inserted, so the test is made here, not at the top of the file. The !error
  ; turns a missing define into a build failure instead of a silently empty hook.
  !ifndef INSTALLMODE
    !error "installer-hooks.nsh needs INSTALLMODE; include it after the template defines it."
  !endif
  !if "${INSTALLMODE}" == "perMachine"
    ; A per-user uninstaller and its shortcuts are user paths, so ask for the
    ; user's shell folders even though this installer is machine-wide.
    Push $R9
    SetShellVarContext current
    ReadRegStr $R9 HKCU "${UNINSTKEY}" "UninstallString"
    ${If} $R9 != ""
    ${OrIf} ${FileExists} "$LOCALAPPDATA\${PRODUCTNAME}\${MAINBINARYNAME}.exe"
      ; /S keeps it silent; _?= runs it in place so it does not copy itself
      ; into a temp folder it then cannot clean up.
      ${If} ${FileExists} "$LOCALAPPDATA\${PRODUCTNAME}\uninstall.exe"
        ExecWait '"$LOCALAPPDATA\${PRODUCTNAME}\uninstall.exe" /S _?=$LOCALAPPDATA\${PRODUCTNAME}'
      ${EndIf}
      Delete "$DESKTOP\${PRODUCTNAME}.lnk"
      Delete "$SMPROGRAMS\${PRODUCTNAME}.lnk"
      RMDir /r "$LOCALAPPDATA\${PRODUCTNAME}"
      DeleteRegKey HKCU "${UNINSTKEY}"
    ${EndIf}
    ; Back to the machine-wide context the rest of the install section expects.
    SetShellVarContext all
    Pop $R9
  !endif
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; The updater runs this installer with /UPDATE and /P, and in update mode the
  ; template's two shortcut functions return without doing anything. Those are
  ; precisely the shops that reported a missing icon (their older build never
  ; wrote one), so the flag is cleared for these calls and put back afterwards.
  ; /NS (no shortcuts) is a separate flag and still suppresses them.
  Push $R8
  StrCpy $R8 $UpdateMode
  StrCpy $UpdateMode 0
  Call CreateOrUpdateStartMenuShortcut
  Call CreateOrUpdateDesktopShortcut
  StrCpy $UpdateMode $R8
  Pop $R8
!macroend
