# Spin A Doc — notes pour le service informatique

Version de référence : 0.12.4. Tout ce qui suit est vérifié dans la configuration de construction (`package.json`, section `build`, et
`build/installer.nsh`) et par le test `npm run test:packaged` (installation et désinstallation silencieuses dans un dossier temporaire).

## Ce que fait l'installeur

- Installeur NSIS **par utilisateur** (`perMachine: false`) : **aucun droit administrateur** requis, rien n'est écrit pour les autres utilisateurs.
- Dossier par défaut : `%LOCALAPPDATA%\Programs\Spin A Doc` (modifiable dans l'assistant).
- Raccourcis : menu Démarrer et bureau ; entrée « Spin A Doc » dans Paramètres > Applications (clé de désinstallation dans `HKCU`).
- Association `.pdf` (mesuré par `test:packaged`) : inscription dans **« Ouvrir avec » seulement**. La valeur par défaut de
  `HKCU\Software\Classes\.pdf` n'est **jamais** écrite : le lecteur PDF de l'utilisateur reste le sien. Clés écrites (dans `HKCU` pour une
  installation par utilisateur) : `Software\Classes\.pdf\OpenWithProgids` (valeur `SpinADoc.pdf`), classe `Software\Classes\SpinADoc.pdf`
  (icône, commande `"…\Spin A Doc.exe" "%1"`), `Software\Classes\Applications\Spin A Doc.exe` (type `.pdf`), `Software\SpinADoc\Capabilities`
  et la valeur « Spin A Doc » de `Software\RegisteredApplications` (page « Applications par défaut » de Windows). Toutes retirées à la désinstallation.
- **Aucun** service Windows, **aucune** tâche planifiée, **aucun** pilote ni imprimante ajoutés, **aucune** connexion réseau, **aucune** télémétrie, **aucune** mise à jour
  automatique. Toute tentative de requête réseau de l'application est bloquée et comptée (Réglages > À propos).

## Emplacements

| Quoi | Où |
|---|---|
| Programme | `%LOCALAPPDATA%\Programs\Spin A Doc` (ou le dossier choisi) |
| Données de l'utilisateur : réglages, documents récents, bibliothèque de tampons et de signatures, échelles de mesure | `%APPDATA%\Spin A Doc` |
| Version portable | aucun fichier hors de l'exécutable, sauf les mêmes données dans `%APPDATA%\Spin A Doc` |

## Installation et désinstallation silencieuses

```bat
SpinADoc-Setup-0.12.4.exe /S
SpinADoc-Setup-0.12.4.exe /S /D=C:\Programmes\SpinADoc
```

`/D=` doit être le **dernier** argument, sans guillemets, même si le chemin contient des espaces.

```bat
"%LOCALAPPDATA%\Programs\Spin A Doc\Uninstall Spin A Doc.exe" /S
"%LOCALAPPDATA%\Programs\Spin A Doc\Uninstall Spin A Doc.exe" /S /DELETEDATA=1
```

Par défaut la désinstallation **conserve** `%APPDATA%\Spin A Doc` (retrouvé à la réinstallation). Dans l'assistant, la case « Supprimer aussi mes
réglages et ma bibliothèque » (décochée par défaut) le supprime ; en silencieux : `/DELETEDATA=1`. Une mise à jour (nouvel installeur par-dessus
l'ancien) ne supprime jamais les données.

## Si l'exécution est bloquée

- Les fichiers ne sont pas signés numériquement : **SmartScreen** peut afficher « Windows a protégé votre ordinateur » (« Informations
  complémentaires » > « Exécuter quand même »).
- **AppLocker / listes blanches** : autoriser par chemin (`%LOCALAPPDATA%\Programs\Spin A Doc\*`) ou par empreinte du fichier :

```powershell
Get-FileHash .\SpinADoc-Setup-0.12.4.exe -Algorithm SHA256
Get-FileHash "$env:LOCALAPPDATA\Programs\Spin A Doc\Spin A Doc.exe" -Algorithm SHA256
```

  Une règle par empreinte est à refaire à chaque nouvelle version. Chaque Release fournit `SHA256SUMS.txt` (empreintes de l'installeur et de
  la version portable) pour vérifier le fichier téléchargé.

## Mises à jour

Aucune mise à jour automatique (l'application ne se connecte jamais à Internet). Pour mettre à jour : lancer le nouvel installeur
par-dessus l'ancien, sans désinstaller (`SpinADoc-Setup-x.y.z.exe /S` en silencieux). Le programme est remplacé ; `%APPDATA%\Spin A Doc`
(réglages, récents, bibliothèque) est conservé — scénario vérifié par `npm run test:update` (profil comparé à l'octet près).

## Licences

Spin A Doc © SpinASoft, tous droits réservés ; utilisation gratuite, personnelle ou professionnelle, selon le contrat de licence
(EULA.fr.md, affiché par l'installeur et copié dans le dossier resources de l'application). Confidentialité : POLITIQUE-CONFIDENTIALITE.md
(aucune donnée collectée ni envoyée). Composants tiers embarqués (Electron, pdf.js, pdf-lib, tesseract.js, police Inter, icônes Lucide…) : licences
permissives uniquement (MIT, Apache-2.0, BSD-2-Clause, 0BSD, ISC, OFL-1.1), vérifiées à chaque construction ; aucune licence copyleft (GPL, AGPL,
LGPL). Texte complet : fichier `THIRD_PARTY_LICENSES` et Réglages > À propos.

## Signaler un problème

Réglages > À propos > « Copier les informations de diagnostic » : version, Windows, mémoire, écrans, noms des imprimantes. Aucun nom de fichier,
chemin ni contenu de document.
