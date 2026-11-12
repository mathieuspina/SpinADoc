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

## Checklist de la première publication (dépôt rendu public)

À faire à la main, dans cet ordre. Rien n'est publié tant que le dépôt est privé et que la Release est en brouillon.

**Réglages du dépôt GitHub** (Settings > General)
- [ ] Description courte (ex. « Lecteur et éditeur de PDF pour Windows, 100 % hors-ligne, en français ») et sujets (Topics) :
      `pdf`, `pdf-editor`, `windows`, `electron`, `offline`, `ocr`, `french`.
- [ ] Features : décocher **Issues**, **Projects**, **Wiki** si inutile, **Discussions** ; Settings > Actions > General : **Disable actions**.
      (Si les Issues restent fermées, CONTRIBUTING.md doit indiquer un autre moyen de signaler un bogue.)

**Avant le passage en public**
- [ ] Relecture juridique de `EULA.fr.md` et de `POLITIQUE-CONFIDENTIALITE.md` (par une personne compétente).
- [ ] Recherche d'antériorité de la marque « Spin A Doc » / « SpinASoft » : bases INPI (data.inpi.fr) et EUIPO (TMview / eSearch plus).
- [ ] Scan privé final (section 5 bis) : zéro occurrence privée sur l'arbre, `git log -p --all`, l'installeur extrait et les propriétés des exécutables.

**Passage en public** (Settings > General > Danger Zone > Change repository visibility > Public)
- [ ] Settings > Code security : activer **Secret scanning**, **Push protection** et **Private vulnerability reporting**
      (nécessaire pour le bouton « Report a vulnerability » de SECURITY.md).

**Tag et Release**
- [ ] Pousser le tag : `git push origin vx.y.z` (le tag local existe déjà, voir section 6).
- [ ] Créer la Release en **brouillon** (section 7, `--draft --verify-tag`), relire fichiers joints, tailles et notes.
- [ ] Publier le brouillon (`gh release edit vx.y.z --draft=false`).

**Après la publication**
- [ ] Télécharger l'installeur depuis la page de la Release, puis `Get-FileHash .SpinADoc-Setup-x.y.z.exe -Algorithm SHA256` : identique à
      `SHA256SUMS.txt` (et à `dist/SHA256SUMS.txt` du poste de construction).
- [ ] Envoyer l'installeur et le portable à **VirusTotal** (virustotal.com, « File ») ; noter le résultat (quelques détections
      heuristiques sont possibles pour un exécutable non signé) et garder le lien des rapports.

## Mettre à jour un poste

Spin A Doc n'a **pas de mise à jour automatique** : il ne se connecte jamais à Internet (principe du 100 % hors-ligne). Pour passer à une
nouvelle version :

1. Fermer Spin A Doc.
2. Télécharger `SpinADoc-Setup-x.y.z.exe` (et, si le service informatique le demande, vérifier son empreinte avec `SHA256SUMS.txt`).
3. Lancer le nouvel installeur **par-dessus l'ancien**, sans désinstaller : le programme est remplacé, les réglages, documents récents,
   tampons, signatures et échelles de mesure (`%APPDATA%\Spin A Doc`) sont conservés. Les raccourcis et l'entrée « Ouvrir avec » restent.
4. Version portable : remplacer simplement l'ancien fichier `.exe` ; les données sont les mêmes (`%APPDATA%\Spin A Doc`).

En silencieux (déploiement par le service informatique) : `SpinADoc-Setup-x.y.z.exe /S`. Ce scénario est vérifié par `npm run test:update`.
