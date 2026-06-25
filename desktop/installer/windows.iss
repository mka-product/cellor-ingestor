; Inno Setup script for Cellor Workspace (Windows x64).
; Compile with:  iscc /DAppVersion="1.0.0" desktop\installer\windows.iss

#ifndef AppVersion
  #define AppVersion "dev"
#endif

[Setup]
AppName=Cellor Workspace
AppVersion={#AppVersion}
AppPublisher=Cellor
AppPublisherURL=https://github.com/your-org/cellor-ingestor
DefaultDirName={autopf}\Cellor
DefaultGroupName=Cellor
OutputBaseFilename=CellorSetup-Windows-x64-{#AppVersion}
OutputDir=..\..\dist
Compression=lzma2/ultra64
SolidCompression=yes
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
WizardStyle=modern
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
UninstallDisplayName=Cellor Workspace
UninstallDisplayIcon={app}\Cellor.exe
CloseApplications=yes

; Icon (optional — build will succeed without it)
#if FileExists("..\..\desktop\assets\icon.ico")
  SetupIconFile=..\..\desktop\assets\icon.ico
#endif

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Files]
; The entire PyInstaller bundle directory
Source: "..\..\dist\Cellor\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\Cellor Workspace";  Filename: "{app}\Cellor.exe"
Name: "{group}\Uninstall Cellor";  Filename: "{uninstallexe}"
Name: "{commondesktop}\Cellor Workspace"; Filename: "{app}\Cellor.exe"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Run]
Filename: "{app}\Cellor.exe"; Description: "{cm:LaunchProgram,Cellor Workspace}"; \
  Flags: nowait postinstall skipifsilent
