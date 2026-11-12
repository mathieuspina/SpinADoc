# Publier une version de Spin A Doc

Procédure pas à pas, sur le poste de développement (Windows, Node.js 20 ou plus, dépôt à jour, `gh` connecté au dépôt GitHub).
Règles permanentes : **jamais** d'exécutable ni de PDF dans git (les binaires vont uniquement dans la Release GitHub), 100 % hors-ligne,
licences permissives, aucun nom réel (client, entreprise, serveur, personne, chantier, chemin local) dans les notes ni les messages.

## 1. Changer la version

1. Choisir le numéro (`x.y.z`) : correctif = `z`, nouvelles fonctions = `y`.
2. `package.json` et `package-lock.json` (deux occurrences) : `"version": "x.y.z"`.

   ```bash
   npm version x.y.z --no-git-tag-version
   ```

3. `CHANGELOG.md` : ajouter en tête une section `## x.y.z — AAAA-MM-JJ`, une ligne par fonction importante, rédigée pour les utilisateurs.
4. `docs/NOTES-INFORMATIQUE.md` : mettre à jour « Version de référence » et les exemples de noms d'installeur.

## 2. Suite complète (une fois)

```bash
npm test
```

```bash
npm run test:ui
```

```bash
npm run licences
```

Les trois doivent être verts. Les tests d'interface tournent hors écran : ils ne touchent ni la souris, ni le clavier, ni les fenêtres.

## 3. Construire

```bash
npm run dist
```

Produit dans `dist/` : `SpinADoc-Setup-x.y.z.exe` (installeur), `SpinADoc-Portable-x.y.z.exe` (portable) et `win-unpacked/`.
`THIRD_PARTY_LICENSES` est vérifié par `npm run licences` et embarqué dans l'application.

## 4. Tester les versions empaquetées

`test:packaged` et `test:update` installent et désinstallent l'application : ils **refusent de tourner** si Spin A Doc est déjà installé
sur le compte (même identité que l'installeur de test). Désinstaller d'abord sa propre copie (Paramètres > Applications), ou lancer ces
tests sur un autre compte Windows.

```bash
npm run test:packaged
```

Application dépaquetée, portable et installée (installation et désinstallation silencieuses dans un dossier temporaire, association
« Ouvrir avec », registre et raccourcis revenus à l'état initial, profil réel inchangé). Un plantage de l'installeur est signalé par
« AVERTISSEMENT : relance après plantage » : le noter dans les notes internes, ne pas l'ignorer.

```bash
npm run test:update
```

Installe la version précédente (installeur de version inférieure présent dans `dist/`), crée un profil de test (réglages, récents,
bibliothèque), lance le nouvel installeur par-dessus et vérifie que le profil est conservé et relu.

Vérification manuelle (une fois) : installer sur un compte de test, ouvrir un PDF, imprimer vers « Microsoft Print to PDF », désinstaller.

## 5. Empreintes et notes de version

```bash
npm run checksums
```

```bash
npm run release-notes
```

Écrit `dist/SHA256SUMS.txt` (empreinte SHA-256 de l'installeur et du portable) et `dist/RELEASE-NOTES-x.y.z.md` (section du CHANGELOG
+ instructions d'installation et de vérification). Relire les notes.

## 5 bis. Aucune donnée personnelle (dépôt public)

Les motifs privés (noms réels, chemins, adresses) sont dans un fichier **hors du dépôt** (une ligne par motif, voir l'en-tête du script).
Extraire l'installeur (`node_modules/7zip-bin/win/x64/7za.exe x dist/SpinADoc-Setup-x.y.z.exe -o<dossier temporaire>`), puis :

```bash
node scripts/scan-private.js --patterns ../private-patterns.txt --tree . --history . --dir <dossier>/resources --asar <dossier>/resources/app.asar --exe "<dossier>/Spin A Doc.exe" --exe dist/SpinADoc-Setup-x.y.z.exe
```

Attendu : aucune occurrence privée ; les e-mails et chemins génériques restants sont fictifs (`exemple.fr`, `C:\Projets\…`) ou ceux des
auteurs des composants tiers (THIRD_PARTY_LICENSES).

## 6. Commit et tag

```bash
git add -A
```

```bash
git commit -m "Version x.y.z"
```

```bash
git tag -a vx.y.z -m "Spin A Doc x.y.z"
```

```bash
git push origin main --follow-tags
```

Vérifier avant le commit que `git status` ne liste aucun `.exe`, `.pdf` ni secret (`dist/` est ignoré par git).

## 7. Release GitHub (brouillon, puis publication)

Créer un **brouillon** (rien n'est visible tant qu'il n'est pas publié) :

```bash
gh release create vx.y.z --draft --verify-tag --title "Spin A Doc x.y.z" --notes-file dist/RELEASE-NOTES-x.y.z.md dist/SpinADoc-Setup-x.y.z.exe dist/SpinADoc-Portable-x.y.z.exe dist/SHA256SUMS.txt
```

Contrôler le brouillon sur GitHub (fichiers joints, tailles, notes), puis publier :

```bash
gh release edit vx.y.z --draft=false
```

Sans `gh` : GitHub > dépôt > « Releases » > « Draft a new release », choisir le tag `vx.y.z`, titre « Spin A Doc x.y.z », coller le contenu
de `dist/RELEASE-NOTES-x.y.z.md`, joindre les trois fichiers, « Save draft », relire, puis « Publish release ».

## 8. Après la publication

- Télécharger l'installeur depuis la Release et vérifier son empreinte (`Get-FileHash … -Algorithm SHA256`) contre `SHA256SUMS.txt`.
- Prévenir les collègues avec le lien de la Release et la marche à suivre ci-dessous.

## Mettre à jour un poste

Spin A Doc n'a **pas de mise à jour automatique** : il ne se connecte jamais à Internet (principe du 100 % hors-ligne). Pour passer à une
nouvelle version :

1. Fermer Spin A Doc.
2. Télécharger `SpinADoc-Setup-x.y.z.exe` (et, si le service informatique le demande, vérifier son empreinte avec `SHA256SUMS.txt`).
3. Lancer le nouvel installeur **par-dessus l'ancien**, sans désinstaller : le programme est remplacé, les réglages, documents récents,
   tampons, signatures et échelles de mesure (`%APPDATA%\Spin A Doc`) sont conservés. Les raccourcis et l'entrée « Ouvrir avec » restent.
4. Version portable : remplacer simplement l'ancien fichier `.exe` ; les données sont les mêmes (`%APPDATA%\Spin A Doc`).

En silencieux (déploiement par le service informatique) : `SpinADoc-Setup-x.y.z.exe /S`. Ce scénario est vérifié par `npm run test:update`.
