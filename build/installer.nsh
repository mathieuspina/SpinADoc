; Spin A Doc — compléments à l'installeur NSIS d'electron-builder (inclus automatiquement : build/installer.nsh).
;
; Désinstallation : page « Données de l'utilisateur » avec la case « Supprimer aussi mes réglages et ma bibliothèque », DÉCOCHÉE par défaut.
; Données de l'utilisateur : $APPDATA\Spin A Doc (réglages, récents, bibliothèque de tampons et de signatures, échelles de mesure).
;  - Mise à jour (nouvel installeur par-dessus l'ancien : désinstallation « --updated ») : rien n'est jamais supprimé.
;  - Désinstallation silencieuse (/S) : données conservées, sauf avec /DELETEDATA=1.
;  - Tests automatiques : /DATADIR=<dossier> remplace le dossier de données, accepté SEULEMENT s'il contient le fichier témoin
;    « .spinadoc-test » (le profil réel n'est jamais touché par les tests).
;
; Association .pdf (0.12.1) : inscription dans « Ouvrir avec » SEULEMENT (OpenWithProgids, Applications, RegisteredApplications pour la page
; « Applications par défaut » de Windows). La valeur par défaut de Software\Classes\.pdf n'est JAMAIS écrite : le lecteur choisi par
; l'utilisateur reste le sien. Clés écrites dans SHCTX (HKCU pour une installation par utilisateur), toutes retirées à la désinstallation.

!include LogicLib.nsh
!include nsDialogs.nsh
!include FileFunc.nsh

!define SPIN_PROGID "SpinADoc.pdf"
!define SPIN_CAPS "Software\SpinADoc\Capabilities"

!ifndef BUILD_UNINSTALLER
!macro customInstall
  StrCpy $0 "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
  WriteRegStr SHCTX "Software\Classes\${SPIN_PROGID}" "" "Document PDF (Spin A Doc)"
  WriteRegStr SHCTX "Software\Classes\${SPIN_PROGID}\DefaultIcon" "" "$0,0"
  WriteRegStr SHCTX "Software\Classes\${SPIN_PROGID}\shell\open\command" "" '"$0" "%1"'
  WriteRegStr SHCTX "Software\Classes\.pdf\OpenWithProgids" "${SPIN_PROGID}" ""
  WriteRegStr SHCTX "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}" "FriendlyAppName" "Spin A Doc"
  WriteRegStr SHCTX "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\SupportedTypes" ".pdf" ""
  WriteRegStr SHCTX "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\shell\open\command" "" '"$0" "%1"'
  WriteRegStr SHCTX "${SPIN_CAPS}" "ApplicationName" "Spin A Doc"
  WriteRegStr SHCTX "${SPIN_CAPS}" "ApplicationDescription" "Lecteur et éditeur de documents PDF"
  WriteRegStr SHCTX "${SPIN_CAPS}\FileAssociations" ".pdf" "${SPIN_PROGID}"
  WriteRegStr SHCTX "Software\RegisteredApplications" "Spin A Doc" "${SPIN_CAPS}"
  System::Call "shell32::SHChangeNotify(i 0x08000000, i 0x1000, p 0, p 0)"
!macroend
!endif

!ifdef BUILD_UNINSTALLER

Var SpinDelData
Var SpinDelBox

; Les fonctions sont définies DANS la macro : elle est développée avec les pages, après l'inclusion de MUI (MUI_HEADER_TEXT).
!macro customUnWelcomePage
  !insertmacro MUI_UNPAGE_WELCOME
  UninstPage custom un.spinDataPage un.spinDataPageLeave

Function un.spinDataPage
  !insertmacro MUI_HEADER_TEXT "Données de l'utilisateur" "Réglages, documents récents, bibliothèque de tampons et de signatures"
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}
  ${NSD_CreateLabel} 0 0 100% 40u "Vos réglages et votre bibliothèque sont conservés : ils seront retrouvés si vous réinstallez Spin A Doc. Cochez la case pour les supprimer aussi (dossier « $APPDATA\Spin A Doc »)."
  Pop $0
  ${NSD_CreateCheckbox} 0 48u 100% 14u "Supprimer aussi mes réglages et ma bibliothèque"
  Pop $SpinDelBox
  ${If} $SpinDelData == "1"
    ${NSD_Check} $SpinDelBox
  ${EndIf}
  nsDialogs::Show
FunctionEnd

Function un.spinDataPageLeave
  ${NSD_GetState} $SpinDelBox $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $SpinDelData "1"
  ${Else}
    StrCpy $SpinDelData "0"
  ${EndIf}
FunctionEnd
!macroend

!macro customUnInstall
  ; Association « Ouvrir avec » : retirée dans tous les cas (une mise à jour la réécrit juste après). La valeur par défaut de .pdf n'est pas touchée.
  DeleteRegValue SHCTX "Software\Classes\.pdf\OpenWithProgids" "${SPIN_PROGID}"
  DeleteRegKey SHCTX "Software\Classes\${SPIN_PROGID}"
  DeleteRegKey SHCTX "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}"
  DeleteRegValue SHCTX "Software\RegisteredApplications" "Spin A Doc"
  DeleteRegKey SHCTX "Software\SpinADoc"
  System::Call "shell32::SHChangeNotify(i 0x08000000, i 0x1000, p 0, p 0)"
  ${IfNot} ${isUpdated}
    ${GetParameters} $R0
    ClearErrors
    ${GetOptions} $R0 "/DELETEDATA=" $R1
    ${IfNot} ${Errors}
      StrCpy $SpinDelData $R1
    ${EndIf}
    ${If} $SpinDelData == "1"
      StrCpy $R2 "$APPDATA\Spin A Doc"
      ClearErrors
      ${GetOptions} $R0 "/DATADIR=" $R3
      ${IfNot} ${Errors}
        ${If} ${FileExists} "$R3\.spinadoc-test"
          StrCpy $R2 $R3
        ${Else}
          StrCpy $R2 ""
        ${EndIf}
      ${EndIf}
      ${If} $R2 != ""
        RMDir /r "$R2"
      ${EndIf}
    ${EndIf}
  ${EndIf}
!macroend

!endif
