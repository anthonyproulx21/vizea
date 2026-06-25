# Vizéa

**Outil gratuit de visualisation de profils cognitifs, conçu au Québec pour les neuropsychologues.**

Vizéa transforme des scores de tests neuropsychologiques en un profil visuel clair (par fonction cognitive), avec les rangs centiles et les classifications selon les bandes de l'AQNP. L'outil est gratuit, sans publicité, et **aucune donnée clinique n'est conservée** : tout reste dans le navigateur, le temps de la séance.

🔗 **Site en ligne : [vizea.ca](https://vizea.ca)**

---

## Fonctionnalités

- **Quatre vues** d'un même profil : Profil, Échelles, Radar et Tableau.
- **Banque de tests** neuropsychologiques (français/québécois) avec sous-tests et fonctions cognitives.
- **Classifications** (bandes de Guilmette et coll., 2020) calculées par rang centile, cohérentes sur tous les types de score (standard, échelle, T, Z, centile).
- **Personnalisation** du graphique : couleurs, ordre, bandes, axes, étiquettes.
- **Inversion de score** lorsque « élevé = défavorable » (temps de réponse, erreurs, etc.).
- **Exports** : image (PNG), tableau (Excel), modèles et projets réutilisables (.json).
- **Démonstration guidée** intégrée pour découvrir l'outil pas à pas.

## Vie privée

Vizéa est une application **entièrement côté client** (statique). Aucun score n'est envoyé à un serveur ni sauvegardé en ligne — conforme à l'esprit de la **Loi 25**. Les seules données stockées localement (dans le navigateur) sont des préférences sans contenu clinique (thème, modèles, brouillons de banque).

## Exécuter le projet localement

Le site est statique, mais il charge `tests_bank.json` et `nouveautes.json` par `fetch()` — il faut donc le servir par un petit serveur web local (l'ouvrir directement en `file://` échouera).

```bash
# depuis le dossier du projet
python3 -m http.server 8000
# puis ouvrir http://localhost:8000
```

(N'importe quel serveur statique fait l'affaire : `npx serve`, l'extension « Live Server », etc.)

## Structure

| Fichier | Rôle |
|---|---|
| `index.html` | Structure et pages de l'application |
| `app.js` | Logique de l'interface (saisie, étapes, panneau, exports, démo) |
| `chart.js` | Construction des graphiques (Plotly) |
| `scoring.js` | Conversions de scores et bandes de classification |
| `datamodel.js` | Modèle de données d'un projet |
| `constants.js` | Constantes (types de score, fonctions, etc.) |
| `style.css` | Styles |
| `tests_bank.json` | Banque de tests (servie à la racine) |
| `nouveautes.json` | Journal des nouveautés (servi à la racine) |
| `_headers` | En-têtes Netlify (dont la politique de sécurité) |

## Contribuer

Les contributions sont bienvenues, surtout pour **enrichir ou corriger la banque de tests** et améliorer l'outil.

1. Forkez le dépôt et créez une branche.
2. Faites vos modifications.
3. Ouvrez une *pull request* décrivant le changement.

Comme Vizéa est un outil clinique, **toute modification de la banque ou des classifications est revue avec soin avant d'être intégrée**. Pour proposer un test sans passer par GitHub, le formulaire « Suggérer un test » du site fonctionne aussi.

## Avertissement clinique

Vizéa est un **outil d'aide à la visualisation**, pas un instrument diagnostique ni une source normative officielle. L'utilisateur demeure responsable de l'exactitude des scores saisis et de leur interprétation. Vérifiez toujours les valeurs par rapport aux manuels des tests.

## Licence

Vizéa est distribué sous licence **GNU AGPL-3.0-or-later**. En clair : vous êtes libre de l'utiliser, de l'étudier, de le modifier et de le redistribuer, **mais toute version dérivée — y compris déployée comme service web — doit rester ouverte sous la même licence et créditer le projet d'origine.** Cette obligation couvre aussi la banque de tests et les données incluses dans ce dépôt.

Voir le fichier [`LICENSE`](LICENSE) pour le texte complet.

Les bandes de classification s'appuient sur : Guilmette, T. J. et coll. (2020), recommandations de l'AQNP.

---

*Vizéa — un projet bénévole, par et pour la communauté neuropsychologique francophone.*
