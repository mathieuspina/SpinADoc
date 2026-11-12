# Journal des versions — Spin A Doc

Une ligne par fonction importante. Les dates sont celles du dépôt. Les versions 0.x sont des versions de travail.
Pour la mise à jour d'un poste, voir [RELEASING.md](RELEASING.md#mettre-à-jour-un-poste).

## 1.0.0 — 2026-11-12
Première version publique. Lecteur et éditeur de PDF pour Windows, 100 % hors-ligne, interface en français. Fonctions
(vérifiées par les tests automatiques ; impression sur papier non vérifiée, voir « Limites connues » dans le README) :
- Lecture : onglets, miniatures, signets, recherche, zoom ; « Ouvrir avec » pour les PDF, sans remplacer le lecteur par défaut.
- Annotations : texte, modification de texte existant par recouvrement, formes, nuages, surlignage, crayon, légende fléchée, notes, tampons,
  images, signature dessinée (sans valeur juridique).
- Mesure : échelle saisie ou calibrée, distances, surfaces, angles, cotes, aimantation sur les traits du plan, export CSV.
- Pages : rotation, déplacement, duplication, suppression, insertion, recadrage, extraction, division, numérotation ; fusion de plusieurs PDF.
- Impression à la taille réelle, en couleur, en gris ou en noir et blanc, sans bloquer l'application.
- Comparaison de deux versions d'un plan (zones modifiées, texte), avec rapport PDF.
- Reconnaissance du texte (OCR) en français et en anglais, sans réseau.
- Formulaires : remplissage des champs existants et création de champs.
- Caviardage par transformation des pages en images et nettoyage des structures cachées (à vérifier dans un autre lecteur avant diffusion).
- Document : propriétés, protection par mot de passe, optimisation, export des pages en images.
- Aide intégrée (F1), fenêtre À propos, informations de diagnostic sans nom de fichier ni chemin.

Publication :
- Titulaire des droits : SpinASoft ; contrat de licence utilisateur final (EULA) affiché par l'installeur ; politique de confidentialité.
- Plus de fichier de configuration de mise à jour dans l'application (aucune mise à jour automatique).
- Licences tierces complétées (modèles de langue de l'OCR, polices, icônes) et livrées dans le dossier de l'application.
- Logiciel non signé numériquement : avertissement possible de Windows SmartScreen, vérification par empreinte SHA-256 (README, aide).
- Limites connues mises à jour (README, aide).

## 0.12.4 — 2026-11-12
- OCR : détection de l'orientation plus fiable. Une page posée de côté ou à l'envers est redressée même quand la lecture à l'endroit semble
  « presque correcte » (cas d'une page lue à 60 % de confiance, et du texte clairsemé couché, qui n'étaient pas redressés).
- OCR : les quatre sens sont comparés sur une partie de la page seulement, puis la page est relue une fois : plus rapide qu'avant sur les pages
  douteuses, aucun surcoût sur les pages droites.
- Aide : limites de la reconnaissance (manuscrit, plans peu contrastés ou clairsemés, fond gris très bruité).

## 0.12.3 — 2026-11-12
- Préparation de la publication : procédure pas à pas (RELEASING.md), empreintes SHA-256 de l'installeur et de la version portable (SHA256SUMS.txt), ce journal des versions.
- Mise à jour d'un poste documentée (nouvel installeur par-dessus l'ancien, réglages conservés) et vérifiée par un test automatique.
- OCR : trace de diagnostic de l'orientation (passes essayées, mots, confiance), sans effet sur le résultat.

## 0.12.2 — 2026-11-11
- Imprimante virtuelle retirée : « Microsoft Print to PDF », fourni avec Windows, suffit.
- Un PDF ouvert alors que Spin A Doc tourne déjà s'ajoute en onglet, même pendant le démarrage.
- Ruban : étiquettes de groupe toujours entières, libellés des boutons sur deux lignes au plus.

## 0.12.1 — 2026-11-11
- Spin A Doc s'inscrit dans « Ouvrir avec » pour les PDF, sans jamais remplacer le lecteur par défaut ; accès direct à la page « Applications par défaut » de Windows.

## 0.12.0 — 2026-11-11
- Aide intégrée (F1) avec sommaire et recherche, rubrique « Où sont les commandes ? ».
- Fenêtre À propos : version, date de construction, licences, compteur de requêtes réseau bloquées (100 % hors-ligne).
- Informations de diagnostic à copier, sans chemin ni nom de fichier.
- Ruban regroupé en 7 onglets, sans perte de commande.
- Les signets du PDF sont conservés après les opérations de pages.
- Désinstallation : case pour supprimer aussi les réglages et la bibliothèque (décochée par défaut).

## 0.11.0 — 2026-11-11
- Création de champs de formulaire (texte, case à cocher, boutons radio, liste déroulante, liste, date), écrits comme de vrais champs PDF.
- Propriétés des champs, noms uniques, duplication, alignement, ordre de tabulation, mode Prévisualiser / remplir.

## 0.10.3 — 2026-11-11
- Panneau Propriétés sans débordement, largeur réglable par le bord gauche.

## 0.10.2 — 2026-11-11
- Caviardage sûr : zones, recherche de mots et de modèles (e-mail, téléphone, IBAN), application par rasterisation des pages concernées, nettoyage du PDF et des métadonnées.
- Sorties protégées : impression, export en images, fusion, extraction et division proposent d'appliquer d'abord le caviardage.

## 0.10.1 — 2026-11-11
- Légende fléchée (texte et repère, coude, pointes, aimantation).

## 0.10.0 — 2026-11-11
- Reconnaissance de texte (OCR) hors ligne, français et anglais : couche de texte invisible, recherche et copie sur les scans.

## 0.9.1 — 2026-11-11
- Comparaison de deux documents : superposition, fondu, côte à côte, différences de texte, rapport PDF.

## 0.9.0 — 2026-11-10
- Numérotation des pages, dépôt de PDF dans les miniatures.
- Onglet Document : export en images, propriétés, optimisation, protection par mot de passe, ouverture des PDF protégés.
- Remplissage des formulaires PDF.

## 0.8.0 — 2026-11-10
- Fusion de PDF.
- Impression non bloquante (file d'attente).

## 0.7.0 — 2026-11-10
- Onglet Pages : pivoter, supprimer, extraire, réordonner, dupliquer, insérer, recadrer, diviser.

## 0.6.0 — 2026-11-10
- Impression à la taille exacte du papier (plans A0 à A4), en couleur, en gris ou en noir et blanc.
- Déplacement du document au clic molette ou avec Espace.

## 0.5.0 — 2026-11-10
- Onglet Mesure : distances, polylignes, surfaces, angles, cotes, cercles, échelle et calibrage, aimantation sur le dessin, export CSV.

## 0.4.0 — 2026-11-10
- Notes, tampons, images et signatures tracées ; bibliothèque personnelle de tampons et de signatures.

## 0.3.1 — 2026-11-09
- Outils persistants, panneaux flottants, barre de titre intégrée.
- Modification du texte existant fidèle à l'original (couleur, police, fond, inclinaison, pages pivotées).
- Versions installée et portable vérifiées automatiquement.

## 0.3.0 — 2026-11-09
- Annotations figées dans le PDF à l'enregistrement : formes (ligne, flèche, rectangle, ellipse, polygone, nuage de révision), marquage du texte (surligner, souligner, barrer) ; panneau Propriétés et panneau Annotations.

## 0.2.1 — 2026-11-09
- Corrections de l'interface (ruban, affichage page par page, boîtes de fermeture), nouveau logo.

## 0.2.0 — 2026-11-09
- Interface à ruban, onglets multi-documents, panneau latéral, accueil, réglages ; licences tierces vérifiées.

## 0.1.0 — 2026-11-09
- Première version : visionneuse PDF, ajout et remplacement de texte, documents récents, recherche.
