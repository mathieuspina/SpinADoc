# Politique de confidentialité — Spin A Doc

> **BROUILLON — à faire relire avant publication.**

Version du 12 novembre 2026. Éditeur : SpinASoft.

## En résumé

**Spin A Doc ne collecte, ne transmet et ne vend aucune donnée.** Le logiciel fonctionne entièrement hors ligne : il n'a ni compte
utilisateur, ni télémétrie, ni statistiques d'usage, ni rapport de plantage automatique, ni mise à jour automatique, ni publicité.

## Ce qui est vérifié dans le logiciel

- **Aucune connexion réseau** : toute requête réseau (http, https, ws, ftp…) émise par l'application est **bloquée** et comptée par une
  garde intégrée ; le compteur est visible dans Réglages > À propos (attendu : 0). Les pages de l'application sont en outre limitées par une
  politique de sécurité de contenu (CSP) qui n'autorise que les fichiers de l'application elle-même. Des tests automatiques vérifient ces
  deux points à chaque version.
- **Pas de rapport de plantage** ni de module de mise à jour : aucun n'est inclus.
- **Vérification orthographique** : assurée par le correcteur intégré à Windows, sur le poste ; Spin A Doc ne télécharge aucun dictionnaire.
- **Reconnaissance de texte (OCR)** : faite sur le poste, avec des modèles de langue livrés avec le logiciel ; aucun document n'est envoyé.

## Données conservées sur votre poste uniquement

Dans `%APPDATA%\Spin A Doc` : réglages, liste des documents récents (chemins des fichiers), bibliothèque de tampons et de signatures,
échelles de mesure mémorisées par document, caches techniques du moteur d'affichage. Ces données ne quittent jamais le poste. Vous pouvez
les effacer : Réglages (documents récents), ou en cochant « Supprimer aussi mes réglages et ma bibliothèque » lors de la désinstallation.

Vos documents PDF restent là où vous les enregistrez ; Spin A Doc ne les copie nulle part ailleurs.

## Informations de diagnostic

Le bouton « Copier les informations de diagnostic » (Réglages > À propos) copie dans le presse-papiers un texte (version, Windows, mémoire,
écrans, noms des imprimantes ; aucun nom de fichier, chemin ni contenu de document ; le nom d'utilisateur Windows est masqué). Rien n'est
envoyé : c'est vous qui choisissez de coller ce texte dans un message.

## Liens et téléchargement

Le site ou la page de téléchargement du logiciel peut avoir sa propre politique (hébergeur). Elle ne concerne pas le logiciel installé.

## Contact

Pour toute question : voir la page du projet.
