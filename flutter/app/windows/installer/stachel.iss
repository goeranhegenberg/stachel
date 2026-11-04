; Windows installer of the Stachel app (Inno Setup 6): Stachel-Setup-<version>.exe
;
; Per-user install without admin rights (%LOCALAPPDATA%\Programs\Stachel), start menu entry, optional desktop
; shortcut, uninstaller, URL protocol stachel:// (docs/release/desktop.md), license page (Apache-2.0), German and
; English. Not code-signed: Windows SmartScreen warns on first start („Weitere Informationen“ → „Trotzdem ausführen“).
;
; Build (flutter/app): powershell -File windows\installer\build.ps1   (builds the app, then calls ISCC with:)
;   ISCC.exe /DAppVersion=<x.y.z> /DReleaseDir=<...\Release> /DCrtDir=<...\Microsoft.VC143.CRT> windows\installer\stachel.iss
;
; UTF-8 without BOM (Inno Setup >= 6.3).

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif
#ifndef ReleaseDir
  #define ReleaseDir "..\..\build\windows\x64\runner\Release"
#endif
#ifndef OutputDir
  #define OutputDir "..\..\build\installer"
#endif

#define AppName "Stachel"
#define AppExe "stachel.exe"
#define AppPublisher "Göran Hegenberg"
#define AppUrl "https://github.com/goeranhegenberg/stachel"
#define UrlScheme "stachel"

[Setup]
; never change the AppId: Windows recognizes updates and the uninstaller by it
AppId={{70160241-6578-4988-AFEA-13C70BE49A50}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher={#AppPublisher}
AppPublisherURL={#AppUrl}
AppSupportURL={#AppUrl}/issues
AppUpdatesURL={#AppUrl}/releases
AppCopyright=Copyright 2026 {#AppPublisher}, Apache-2.0
VersionInfoVersion={#AppVersion}
VersionInfoProductName={#AppName}
VersionInfoDescription={#AppName} Setup
DefaultDirName={autopf}\{#AppName}
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
DisableDirPage=auto
; per user, no UAC prompt ({autopf} = %LOCALAPPDATA%\Programs)
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.17763
LicenseFile=..\..\..\..\LICENSE
SetupIconFile=..\runner\resources\app_icon.ico
UninstallDisplayIcon={app}\{#AppExe}
UninstallDisplayName={#AppName}
OutputDir={#OutputDir}
OutputBaseFilename=Stachel-Setup-{#AppVersion}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
; a running Stachel is closed for an update and started again
CloseApplications=yes
RestartApplications=yes
ChangesAssociations=yes
ShowLanguageDialog=auto

[Languages]
Name: "de"; MessagesFile: "compiler:Languages\German.isl"
Name: "en"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
Source: "{#ReleaseDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
; Visual C++ runtime next to the exe (app-local), so no separate redistributable is needed
#ifdef CrtDir
Source: "{#CrtDir}\msvcp140.dll"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#CrtDir}\vcruntime140.dll"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#CrtDir}\vcruntime140_1.dll"; DestDir: "{app}"; Flags: ignoreversion
#endif
Source: "..\..\..\..\LICENSE"; DestDir: "{app}"; DestName: "LICENSE.txt"; Flags: ignoreversion
Source: "..\..\..\..\NOTICE"; DestDir: "{app}"; DestName: "NOTICE.txt"; Flags: ignoreversion
Source: "..\..\..\..\THIRD_PARTY_NOTICES"; DestDir: "{app}"; DestName: "THIRD_PARTY_NOTICES.txt"; Flags: ignoreversion

[Icons]
Name: "{autoprograms}\{#AppName}"; Filename: "{app}\{#AppExe}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExe}"; Tasks: desktopicon

[Registry]
; URL protocol stachel://<host>/<path> -> the app (same link as https://<host>/<path>, lib/links.dart)
Root: HKA; Subkey: "Software\Classes\{#UrlScheme}"; ValueType: string; ValueName: ""; ValueData: "URL:{#AppName}"; Flags: uninsdeletekey
Root: HKA; Subkey: "Software\Classes\{#UrlScheme}"; ValueType: string; ValueName: "URL Protocol"; ValueData: ""
Root: HKA; Subkey: "Software\Classes\{#UrlScheme}\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: """{app}\{#AppExe}"",0"
Root: HKA; Subkey: "Software\Classes\{#UrlScheme}\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#AppExe}"" ""%1"""
; window size and position the app keeps (windows/runner/win32_window.cpp): removed with the app
Root: HKCU; Subkey: "Software\INTSODE\Stachel"; Flags: uninsdeletekey dontcreatekey
Root: HKCU; Subkey: "Software\INTSODE"; Flags: uninsdeletekeyifempty dontcreatekey

[Run]
Filename: "{app}\{#AppExe}"; Description: "{cm:LaunchProgram,{#AppName}}"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
; what the app wrote next to itself (nothing by default; the data in %APPDATA%\Stachel\Stachel stays)
Type: dirifempty; Name: "{app}"
