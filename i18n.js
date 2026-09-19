/* ==========================================================================
   Vizéa — internationalisation (bilingue FR / EN)
   --------------------------------------------------------------------------
   The app's default language is French. This module adds an English option
   behind a header toggle. Translation is DISPLAY-ONLY: nothing about the data
   model changes, so cognitive-function keys, test names and saved projects are
   untouched. Test names deliberately stay in French in both languages.

   Usage in markup:
     <span data-i18n="nav.home">Accueil</span>        → sets textContent
     <h1 data-i18n-html="home.title">…</h1>           → sets innerHTML (markup ok)
     <input data-i18n-attr="placeholder:home.search"> → sets an attribute

   Usage in code (later steps):
     VizeaI18n.t("some.key")           → the string in the current language
     VizeaI18n.getLang() / setLang()   → read / change language
   A "vizea:langchange" event fires on document whenever the language changes,
   so dynamically-built UI can re-render itself.
   ========================================================================== */
(function () {
  "use strict";

  var STORE_KEY = "vizea_lang";
  var DEFAULT = "fr";

  // --- Dictionary --------------------------------------------------------
  // Only French keys have to exist; a missing English string falls back to the
  // French one (so the app is never broken mid-translation).
  var DICT = {
    fr: {
      "lang.toggle": "EN",
      "lang.toggleAria": "Switch to English",
      "meta.title": "Vizéa — Visualisation de profils cognitifs",
      "meta.desc": "Vizéa transforme des scores standardisés en un profil cognitif clair, regroupé par fonction cognitive. Gratuit, confidentiel, et fait au Québec.",
      "news.kicker": "Nouveautés",
      "news.h2": "Ce qui évolue dans <span class=\"brand\">Vizéa</span>.",
      "news.lede": "Le journal des améliorations apportées à l'outil, de la plus récente à la plus ancienne.",
      "news.empty": "Aucune nouveauté pour le moment.",

      "nav.home": "Accueil",
      "nav.viz": "Visualisation",
      "nav.demo": "Démo",
      "nav.about": "À propos",
      "nav.news": "Nouveautés",
      "nav.suggest": "Suggérer un test",
      "nav.donate": "Faire un don",
      "nav.menuOpen": "Ouvrir le menu",
      "theme.toggle": "Thème clair/sombre",

      "home.eyebrow": "Outil clinique · Gratuit · D'ici",
      "home.title": "Voir un <span class=\"accent-word\">profil</span>,<br>pas seulement des chiffres.",
      "home.slogan": "Vizéa présente des scores standardisés en un profil cognitif clair, regroupé par fonction cognitive : Prêt à interpréter, à exporter, à montrer.",
      "home.btnStart": "Commencer une visualisation",
      "home.btnDemo": "Commencer une démonstration",
      "home.btnDiscover": "Découvrir le projet",
      "home.btnInstall": "Installer l'application",
      "home.note": "Aucune donnée clinique conservée. Les scores restent dans votre navigateur le temps de la séance.",

      "home.card.label": "Profil cognitif",
      "home.card.lang": "Langage",
      "home.card.visuo": "Visuo.",
      "home.card.mem": "Mémoire",
      "home.card.att": "Attention",
      "home.card.exec": "Exéc.",
      "home.feat1.title": "Un profil d'un coup d'œil",
      "home.feat1.desc": "Chaque score est replacé sur une échelle commune et regroupé par fonction cognitive, sur fond des bandes d'interprétation reconnues.",
      "home.feat2.title": "Entièrement ajustable",
      "home.feat2.desc": "Changez d'échelle, de type de graphique, de couleurs, masquez des fonctions, ajoutez les valeurs, puis exportez l'image finale.",
      "home.feat3.title": "Confidentiel par conception",
      "home.feat3.desc": "Les scores ne quittent jamais votre appareil. Seuls vos modèles de tests et vos préférences de graphique sont enregistrés, localement.",
      "home.cta.title": "Prêt à visualiser un profil ?",
      "home.cta.desc": "Aucune inscription requise. Créez un projet, entrez vos scores, obtenez le graphique.",
      "home.cta.btn": "Ouvrir l'outil",

      "common.close": "Fermer",
      "common.value": "Valeur",
      "common.scoreType": "Type de score",
      "score.percentile": "Rang centile",
      "score.standard": "Score standard",
      "score.scaled": "Score pondéré",
      "score.z": "Score Z",
      "score.t": "Score T",

      "wiz.tab.project": "Projet",
      "wiz.tab.tests": "Tests",
      "wiz.tab.scores": "Scores",
      "wiz.tab.chart": "Graphique",
      "wiz.new.title": "Nouveau projet",
      "wiz.new.intro": "Donnez un nom à la séance, choisissez un point de départ, puis ajoutez vos tests. Tout reste local sur votre appareil.",
      "wiz.new.privacy": "N'inscrivez aucun renseignement permettant d'identifier la personne évaluée (nom, date de naissance, initiales). Utilisez un code interne si nécessaire.",
      "wiz.new.nameLabel": "Nom du projet",
      "wiz.new.namePh": "Ex : Évaluation 2026-014",
      "wiz.new.startLabel": "Point de départ",
      "wiz.new.blankOption": "Projet vierge : Aucun modèle",
      "wiz.new.templateHint": "Un modèle reprend toute la structure enregistrée (tests, scores, fonctions, types), sans aucune valeur.",
      "wiz.new.deleteTemplate": "Supprimer ce modèle",
      "wiz.new.confirm": "Je confirme que ce titre ne contient aucune donnée nominative.",
      "wiz.new.create": "Créer le projet",
      "wiz.new.or": "ou",
      "wiz.new.importTitle": "Reprendre un projet exporté (.vizea)",
      "wiz.new.importDesc": "Recharge un projet complet, scores compris.",
      "wiz.tests.title": "Sélection des tests",
      "wiz.tests.searchPh": "Rechercher une batterie ou un test…",
      "wiz.tests.manualPh": "Nom d'un test absent de la liste",
      "wiz.tests.addManual": "Ajouter manuellement",
      "wiz.tests.selected": "Tests sélectionnés",
      "wiz.tests.emptyHint": "Aucun test sélectionné pour l'instant.",
      "wiz.tests.warning": "Sélectionnez au moins un test pour continuer.",
      "wiz.tests.next": "Continuer vers les scores →",
      "wiz.scores.title": "Entrée des scores",
      "wiz.scores.intro": "Pour chaque score : la valeur, son type, et la ou les fonctions cognitives évaluées. Vous pouvez ajouter plusieurs scores à un même test.",
      "wiz.scores.kbdHint": "Astuce : appuyez sur <kbd>Entrée</kbd> pour passer au champ de score suivant (ou <kbd>Tab</kbd> pour le champ suivant).",
      "wiz.scores.back": "← Retour aux tests",
      "wiz.scores.toChart": "Voir le graphique →",

      "panel.open": "Personnaliser",
      "panel.title": "Personnaliser",
      "export.image": "Image (PNG)",
      "export.excel": "Exporter en Excel",
      "export.template": "Enregistrer comme modèle",
      "export.project": "Exporter le projet (.vizea)",
      "panel.sec.display": "Affichage",
      "panel.sec.bands": "Bandes d'interprétation",
      "panel.sec.content": "Contenu et couleurs",
      "panel.sec.compare": "Ligne de comparaison",
      "panel.displayScale": "Échelle affichée",
      "panel.chartType": "Type de graphique",
      "panel.typeLine": "Ligne",
      "panel.typeRadar": "Radar",
      "panel.textSize": "Taille du texte",
      "panel.dataLabels": "Valeur sur les points",
      "panel.proportional": "Espacement proportionnel à la rareté",
      "panel.testLabels": "Nom des tests (axe horizontal)",
      "panel.radarFill": "Ombrage du profil (radar)",
      "panel.title2": "Titre du graphique",
      "panel.titlePh": "Laisser vide pour aucun titre",
      "panel.showBands": "Afficher les bandes",
      "panel.bandLabels": "Nom des bandes sur le graphique",
      "panel.bandOpacity": "Intensité des couleurs",
      "panel.renameBands": "Renommer les bandes",
      "panel.resetNames": "Rétablir les noms d'origine",
      "panel.axisLimits": "Limites de l'axe vertical",
      "panel.axisHint": "Laissez vide pour l'étendue automatique.",
      "panel.min": "Minimum",
      "panel.max": "Maximum",
      "panel.functions": "Fonctions affichées",
      "panel.fnHint": "Glissez pour réordonner · décochez pour masquer",
      "panel.tests": "Tests affichés",
      "panel.testsHint": "Glissez pour réordonner · décochez pour masquer · cliquez le nom pour le renommer",
      "panel.viewOnly": "Affichage seulement : vos données saisies ne changent pas.",
      "panel.colors": "Couleurs par fonction",
      "panel.radarColor": "Couleur du profil (radar)",
      "panel.radarProfile": "Profil radar",
      "panel.compareHint": "Trace un repère horizontal (ex. QI estimé) pour situer le profil.",
      "panel.compareLabel": "Étiquette (optionnelle)",
      "panel.comparePh": "ex. QI estimé",
      "panel.removeLine": "Retirer la ligne",
      "view.line": "Profil",
      "view.scales": "Échelles",
      "view.radar": "Radar",
      "view.table": "Tableau",
      "common.template": "Modèle",
      "wiz.new.blankWithTemplates": "Aucun modèle — projet vierge",
      "wiz.new.blankNoTemplates": "Aucun modèle enregistré — projet vierge",
      "wiz.tests.listEmpty": "Tapez ci-dessus pour rechercher un test…",
      "common.type": "Type",
      "scores.fieldName": "Nom du score",
      "scores.fieldScore": "Score",
      "scores.fieldFunctions": "Fonctions",
      "scores.addScore": "+ Ajouter un score à ce test",
      "scores.direction": "Sens",
      "scores.namePh": "Nom du score (optionnel)",
      "scores.fnPlaceholder": "Fonctions cognitives…",
      "scores.addFn": "Ajouter une fonction…",
      "scores.inverted": "Inversé",
      "scores.invertedTitle": "Score inversé (élevé = défavorable)",
      "scores.invertedNote": "* Score inversé (élevé = défavorable) : positionné et classé selon son écart inverse à la moyenne.",
      "scales.title": "Échelles globales",
      "scales.hint": "· score standard ou rang centile",
      "scales.useForViz": "Utiliser ces valeurs pour la visualisation des échelles",
      "scales.sigle": "Sigle",
      "scales.add": "+ Ajouter une échelle",
      "scales.useEgqi": "Utiliser le score à l'EGQI",
      "scales.egqiHint": "Entrez une valeur à l'EGQI (test Wechsler) pour l'activer.",
      "comment.title": "Commentaire",
      "comment.placeholder": "Observation, remarque, note personnelle…",
      "comment.pin": "Épingler",
      "comment.pinned": "Épinglé",
      "comment.pinTitle": "Afficher ce commentaire en permanence sur le graphique (et dans l'image exportée)",
      "comment.pinnedTitle": "Retirer l'étiquette du graphique",
      "common.done": "Terminé",
      "panel.noFunctions": "Aucune fonction à afficher.",
      "panel.renameHint": "renommer pour l'affichage (n'affecte pas la classification)",
      "panel.fnRenameHint": "Renommer pour l'affichage (n'affecte pas les scores ni le regroupement)",
      "panel.axisHintFull": "En valeurs « {scale} ». Laissez vide pour l'étendue automatique.",
      "panel.scalesColor": "Couleur de la ligne",
      "panel.scalesShown": "Échelles affichées",
      "table.byTest": "Par test",
      "table.byFunction": "Par fonction",
      "table.classification": "Classification",
      "table.color": "Couleur",
      "table.comments": "Commentaires",
      "footer.install": "Installer l'application",
      "footer.source": "Code source",
      "footer.netlify": "Propulsé par Netlify",
      "chart.defaultTitle": "Visualisation des scores par fonctions cognitives",
      "chart.defaultScalesTitle": "Visualisation des échelles globales",
      "common.save": "Enregistrer",
      "common.cancel": "Annuler",
      "scores.errImpossible": "Valeur impossible pour un {type} (doit être entre {min} et {max}).",
      "scores.warnUnusual": "Valeur inhabituelle pour un {type} (plage attendue : {min} à {max}). Vérifiez la saisie.",
      "scores.warnUnusualShort": "Valeur inhabituelle pour un {type} (plage attendue : {min} à {max}).",
      "scores.pctRange": "Le rang centile doit être entre 0 et 100.",
      "dialog.saveAs.title": "Enregistrer sous",
      "dialog.saveAs.desc": "Nommez le fichier avant de le télécharger. Il ira dans le dossier de téléchargement de votre navigateur.",
      "dialog.template.prompt": "Nom du modèle (sélection de tests + préférences, sans aucun score) :",
      "dialog.deleteTemplate": "Supprimer ce modèle ? Cette action est définitive.",
      "dialog.removeTest.title": "Retirer ce test ?",
      "dialog.removeTest.msg": "« {test} » n'a qu'un seul score. Le retirer enlèvera ce test du projet.",
      "dialog.removeTest.thisTest": "Ce test",
      "common.remove": "Retirer",
      "tests.moveUp": "Monter",
      "tests.moveDown": "Descendre",
      "leave.title": "Retourner à l'écran de projet ?",
      "leave.desc": "Vous quittez la séance en cours. Si vous démarrez ensuite un nouveau projet, les scores entrés (non exportés) seront perdus. C'est voulu : aucune donnée clinique n'est conservée. Vous pouvez exporter le projet avant de continuer.",
      "leave.export": "Exporter (.vizea) puis continuer",
      "leave.discard": "Continuer sans enregistrer",
      "donate.title": "Soutenir Vizéa",
      "donate.desc": "Vizéa est un projet bénévole. Votre contribution aide à le maintenir et à l'améliorer. Merci !",
      "donate.other": "Autre",
      "donate.loading": "Chargement du module de paiement…",
      "donate.thanks": "Merci infiniment pour votre soutien.",
      "suggest.title": "Suggérer un test",
      "suggest.desc": "Aidez la banque à grandir. Proposez un test ou une batterie à ajouter.",
      "suggest.nameLabel": "Nom du test ou de la batterie",
      "suggest.namePh": "Ex : WISC-V, Figure de Rey…",
      "suggest.fnLabel": "Fonctions cognitives associées",
      "suggest.descLabel": "Description (optionnel)",
      "suggest.descPh": "Conditions, scores utilisés, etc.",
      "suggest.yourName": "Votre nom (optionnel)",
      "suggest.yourEmail": "Votre courriel (optionnel)",
      "suggest.send": "Envoyer la suggestion",
      "suggest.battery": "Batterie évaluant plusieurs fonctions",
      "suggest.success": "Merci, votre suggestion a été acheminée.",
      "install.kicker": "Application",
      "install.h2": "Installer <span class=\"brand\">Vizéa</span> comme application",
      "install.lede": "Optionnel et gratuit : en plus du site web, Vizéa peut s'installer comme une application avec quelques avantages, et sans jamais rien changer à la version web habituelle.",
      "install.b1t": "Hors ligne",
      "install.b1d": "Utilisez Vizéa sans connexion Internet, une fois l'application ouverte.",
      "install.b2t": "Ouverture en un clic",
      "install.b2d": "Une icône dans le Dock ou le menu Démarrer, dans sa propre fenêtre, sans passer par le navigateur.",
      "install.b3t": "Double-clic sur vos projets",
      "install.b3d": "Ouvrez un fichier <strong>.vizea</strong> directement pour reprendre un projet (Chrome / Edge sur ordinateur).",
      "install.b4t": "Mêmes garanties de confidentialité",
      "install.b4d": "Aucune donnée clinique n'est collectée ni transmise; seuls les fichiers de l'outil sont mis en cache.",
      "install.howTitle": "Comment l'installer",
      "install.clickBtn": "Cliquez ce bouton :",
      "install.installNow": "Installer Vizéa",
      "install.confirmInstall": "Confirmez <strong>« Installer »</strong> dans la petite fenêtre du navigateur.",
      "install.hint": "À noter : l'installation n'est <strong>pas</strong> un téléchargement. Vizéa s'ajoute à vos applications (menu Démarrer sur Windows, Dock sur Mac), pas à vos téléchargements.",
      "install.safariWarn": "Safari installe une version <strong>partielle</strong> : Vizéa fonctionne dans sa propre fenêtre et hors ligne, mais l'ouverture des projets <strong>.vizea</strong> par double-clic n'est pas prise en charge. Pour l'<strong>installation complète</strong>, utilisez plutôt <strong>Chrome</strong> ou <strong>Edge</strong> sur ordinateur.",
      "install.safariIntro": "Pour ajouter Vizéa au Dock avec Safari :",
      "install.safari1": "Ouvrez le menu <strong>Fichier</strong>, dans la barre tout en haut de l'écran.",
      "install.safari2": "Choisissez <strong>« Ajouter au Dock »</strong>.",
      "install.safari3": "Confirmez le nom, puis cliquez <strong>« Ajouter »</strong>.",
      "install.firefox": "Firefox <strong>ne permet pas</strong> d'installer les applications web. Pour installer Vizéa, ouvrez cette page dans <strong>Chrome</strong> ou <strong>Edge</strong> sur ordinateur, ou continuez simplement sur le site : tout fonctionne pareil.",
      "install.iosNote": "Sur iPhone / iPad, l'installation se fait par le menu Partager (l'ouverture des fichiers .vizea par double-clic n'existe pas sur ces appareils).",
      "install.ios1": "Touchez le bouton <strong>Partager</strong> (un carré avec une flèche vers le haut).",
      "install.ios2": "Faites défiler, puis touchez <strong>« Sur l'écran d'accueil »</strong>.",
      "install.ios3": "Touchez <strong>« Ajouter »</strong>, en haut à droite.",
      "install.otherWarn": "Pour l'<strong>installation complète</strong> (installation en un clic et ouverture des projets .vizea par double-clic), utilisez <strong>Chrome</strong> ou <strong>Edge</strong> sur ordinateur.",
      "install.otherAlt": "Sinon : sur <strong>Safari (Mac)</strong>, <strong>Fichier → Ajouter au Dock</strong>; sur <strong>iPhone / iPad</strong>, <strong>Partager → Sur l'écran d'accueil</strong>.",
      "install.allMethods": "Voir les méthodes pour tous les navigateurs",
      "install.m1": "<strong>Chrome ou Edge (ordinateur)</strong> — le bouton « Installer Vizéa » ci-dessus, ou l'icône d'installation dans la barre d'adresse.",
      "install.m2": "<strong>Safari (Mac)</strong> — menu <strong>Fichier → Ajouter au Dock</strong>.",
      "install.m3": "<strong>iPhone / iPad</strong> — bouton <strong>Partager → Sur l'écran d'accueil</strong>.",
      "install.m4": "<strong>Firefox</strong> — non pris en charge; utilisez Chrome ou Edge, ou continuez sur le site.",
      "install.privacy": "Confidentialité : installée ou non, Vizéa fonctionne entièrement sur votre appareil. Aucun score ni projet n'est envoyé à un serveur.",
      "demo.s1.t": "Bienvenue dans Vizéa",
      "demo.s1.b": "Cette courte visite vous montre l'outil de bout en bout, avec des données fictives. Appuyez sur « Suivant » pour avancer à votre rythme — vous pouvez quitter à tout moment.",
      "demo.s2.t": "Tout commence ici",
      "demo.s2.b": "L'onglet « Visualisation » ouvre le flux en quatre étapes : projet, sélection des tests, saisie des scores, puis le graphique.",
      "demo.s3.t": "1 · Le projet",
      "demo.s3.b": "On donne un nom au projet — regardez, la démo le saisit.",
      "demo.s4.t": "Reprendre un projet",
      "demo.s4.b": "Vous terminez une deuxième rencontre et voulez compléter un profil déjà commencé ? Importez le projet enregistré pour continuer exactement là où vous étiez.",
      "demo.s5.t": "Partir d'un modèle",
      "demo.s5.b": "Vous utilisez souvent la même batterie ? Un modèle réutilise les mêmes tests et les mêmes préférences graphiques — pour gagner du temps à chaque évaluation.",
      "demo.s6.t": "2 · Choisir les tests",
      "demo.s6.b": "On cherche un test — ici la démo tape « D-KE » — puis on coche ceux qu'on veut. Quelques tests sont déjà sélectionnés pour la suite.",
      "demo.s7.t": "3 · Saisir les scores",
      "demo.s7.b": "Chaque test apparaît en carte. La démo a déjà rempli des scores fictifs — ici le WAIS-IV et ses sous-tests, qui alimenteront aussi les indices.",
      "demo.s8.t": "Ajouter un score",
      "demo.s8.b": "Un même test peut recevoir plusieurs scores. La démo clique « + Ajouter un score » et saisit « Flexibilité (erreurs) » — chaque score se rattache à la fonction de votre choix.",
      "demo.s9.t": "Réassigner la fonction",
      "demo.s9.b": "Chaque score est rattaché à une fonction cognitive, modifiable ici. Par exemple, vous pourriez vouloir classer « Couleurs » et « Mots » sous le langage oral plutôt que les fonctions exécutives — c'est vous qui décidez.",
      "demo.s10.t": "4 · Le graphique",
      "demo.s10.b": "Voici le profil cognitif : chaque point est placé selon son rang centile, sur des bandes d'interprétation. Le sélecteur en haut bascule entre quatre visualisations — suivons-les une à une.",
      "demo.s11.t": "Vue Échelles",
      "demo.s11.b": "La vue « Échelles » présente les indices composites (ICV, IRP, IMT, IVT…) plutôt que les sous-tests individuels.",
      "demo.s12.t": "Vue Radar",
      "demo.s12.b": "La vue « Radar » dispose les fonctions en étoile — pratique pour saisir la forme générale du profil d'un coup d'œil.",
      "demo.s13.t": "Personnaliser le graphique",
      "demo.s13.b": "Le bouton « Personnaliser » ouvre un panneau pour ajuster les couleurs, l'ordre des fonctions, les bandes d'interprétation et les axes.",
      "demo.s14.t": "Exporter — Image (PNG)",
      "demo.s14.b": "Depuis une vue graphique, ce bouton exporte une image PNG haute résolution, prête à être utilisée.",
      "demo.s15.t": "Vue Tableau",
      "demo.s15.b": "La vue « Tableau » liste les scores — regroupés par test ou par fonction — avec, pour chacun, la valeur, le rang centile et la classification.",
      "demo.s16.t": "Exporter — Excel",
      "demo.s16.b": "En vue Tableau, ce bouton exporte le tableau vers Excel, prêt à intégrer dans un rapport.",
      "demo.s17.t": "Exporter — Modèle",
      "demo.s17.b": "Enregistre les tests choisis et vos préférences graphiques comme modèle réutilisable, pour gagner du temps aux prochaines évaluations.",
      "demo.s18.t": "Exporter — Projet (.vizea)",
      "demo.s18.b": "Exporte tout le projet dans un fichier .vizea. Une fois Vizéa installée, un double-clic sur ce fichier rouvre le projet; sinon, on le glisse sur la fenêtre ou on l'importe.",
      "demo.s19.t": "À vous de jouer !",
      "demo.s19.b": "C'est tout ! Explorez librement ce projet de démonstration, ou créez le vôtre via « Visualisation ». Bonne visualisation !",
      "demo.quit": "Quitter",
      "demo.next": "Suivant",
      "demo.finish": "Terminer",
      "about.kicker": "À propos",
      "about.heroTitle": "Un outil clinique, <em>libre</em> et <em>fait ici</em>.",
      "about.lede": "<span class=\"brand\">Vizéa</span> rend la visualisation des profils cognitifs claire, rapide et accessible, gratuitement, et sans dépendre des grandes compagnies.",
      "about.c1t": "À propos de Vizéa",
      "about.c1p1": "<span class=\"brand\">Vizéa</span> est un outil technologique québécois conçu pour faciliter la visualisation des profils cognitifs. Il s'adresse aux professionnels de la santé, aux étudiants et aux chercheurs, en offrant une solution gratuite, accessible et indépendante des grandes compagnies qui dominent le domaine.",
      "about.c1p2": "L'objectif est simple : Redonner le contrôle de nos outils, favoriser une pratique plus libre et collaborative, et soutenir l'évolution de nos professions sans barrières commerciales ni coûts récurrents. <span class=\"brand\">Vizéa</span> permet une visualisation rapide, intuitive et personnalisée des profils cognitifs, pour une meilleure compréhension des forces et des défis de la personne évaluée.",
      "about.c1p3": "Il me semble évident qu'un tel outil devrait déjà exister, et pourtant, ce n'est pas le cas. Si <span class=\"brand\">Vizéa</span> peut combler ce vide, même modestement, alors le projet aura du sens.",
      "about.c2t": "Pourquoi ce projet ?",
      "about.c2p1": "L'idée est née lorsque mes superviseures d'internat m'ont demandé en supervision de partager et regrouper les résultats d'un patient pour faciliter la compréhension de son profil. J'en avais assez d'utiliser des fichiers Excel bricolés, transmis de façon informelle par des professionnels que je ne connaissais même pas. Cette dépendance à des outils opaques m'a poussé à créer une solution claire, fiable et ouverte.",
      "about.c2p2": "Dans notre milieu, on nous répète souvent qu'il faut « faire plus avec moins ». Mais les outils technologiques qui pourraient nous aider sont soit inexistants, soit hors de prix, souvent proposés par des compagnies qui profitent déjà largement du système. <span class=\"brand\">Vizéa</span> vise à changer cela.",
      "about.c3t": "Une plateforme évolutive",
      "about.c3p1": "<span class=\"brand\">Vizéa</span> est conçu pour être utilisé, adapté et perfectionné avec le temps. La fonction de suggestion de tests permet à la plateforme de grandir avec la communauté, en s'ajustant aux réalités cliniques et aux besoins du terrain. Mon souhait est que cette plateforme réponde à un besoin réel, partagé par d'autres cliniciens, et qu'elle devienne un outil naturel dans notre pratique.",
      "about.c4t": "Le regroupement par fonction",
      "about.c4p1": "Pour regrouper les tests, j'ai retenu un ensemble volontairement concis de fonctions cognitives, celles qui correspondent le mieux à la majorité des tests, sans multiplier les catégories à l'infini. L'objectif est de garder l'outil lisible et fonctionnel plutôt que d'imposer des dizaines de fonctions qui alourdiraient la lecture. Au besoin, vous pouvez toujours en ajouter.",
      "about.c4p2": "Les associations par défaut reposent sur mon jugement clinique, en tenant compte de ce que chaque test ou batterie est présumé mesurer. Comme vous le savez, certains tests ne se rattachent pas parfaitement à une seule fonction : l'Arithmétique, par exemple, peut relever du raisonnement non verbal, de la mémoire de travail ou des mathématiques, selon la batterie utilisée et l'interprétation du clinicien. C'est pourquoi <span class=\"brand\">Vizéa</span> vous laisse libre de reclassifier, renommer et réorganiser les fonctions selon vos besoins et votre lecture du profil.",
      "about.c4p3": "Enfin, les bandes d'interprétation suivent la classification normative proposée par l'American Academy of Clinical Neuropsychology (Guilmette et al., 2020) et adoptée par l'AQNP.",
      "about.c5t": "Confidentialité d'abord",
      "about.c5p1": "<span class=\"brand\">Vizéa</span> ne conserve aucune donnée clinique. Les scores que vous entrez vivent uniquement dans votre navigateur, le temps de la séance, et servent seulement à produire le graphique. Vous seul décidez de l'exporter et de le conserver, sur votre propre environnement sécurisé. Seuls vos modèles de tests et vos préférences de graphique (qui ne contiennent aucune information clinique) sont enregistrés localement.",
      "about.c6t": "Un engagement bénévole",
      "about.c6p1": "Ce projet est volontaire, et je tiens à ce qu'il le reste. Les coûts liés aux tests, aux protocoles et aux abonnements ne cessent d'augmenter. Et ces frais, qu'ils soient absorbés par le privé ou le public, finissent toujours par retomber sur les patients. <span class=\"brand\">Vizéa</span> est une plateforme gratuite, accessible, et pensée pour le bien commun.",
      "about.c7t": "Mon parcours",
      "about.c7p1": "Je poursuis actuellement mon doctorat en neuropsychologie à l'Université du Québec en Outaouais (UQO). Je réalise mes deux internats dans des milieux hospitaliers, avec une patientèle pédiatrique. En ce qui concerne mes modestes compétences en programmation, j'ai été initié au vaste monde de l'informatique en apprenant Matlab dans le cadre de mon projet de thèse d'honneur et de mon essai doctoral au sein du Laboratoire de Perception Visuelle et Sociale de l'UQO. J'ai également acquis des connaissances en Java grâce à un cours hors programme suivi durant mon baccalauréat.",
      "about.c7p2": "Je dois confier que les aspects esthétiques de cet outil ont grandement bénéficiés de l'aide de Claude IA. C'est grâce à sa grande consommation d'eau et ma plus grande consommation de café que <span class=\"brand\">Vizéa</span> est disponible et aussi joli.",
      "about.authorTitle": "Anthony Proulx, B.Sc.<br>Candidat au doctorat en neuropsychologie<br>Université du Québec en Outaouais"
    },
    en: {
      "lang.toggle": "FR",
      "lang.toggleAria": "Passer en français",
      "meta.title": "Vizéa — Cognitive profile visualization",
      "meta.desc": "Vizéa turns standardized scores into a clear cognitive profile, grouped by cognitive function. Free, private, and made in Quebec.",
      "news.kicker": "What's new",
      "news.h2": "What's evolving in <span class=\"brand\">Vizéa</span>.",
      "news.lede": "The log of improvements made to the tool, from newest to oldest.",
      "news.empty": "Nothing new for the moment.",

      "nav.home": "Home",
      "nav.viz": "Visualization",
      "nav.demo": "Demo",
      "nav.about": "About",
      "nav.news": "What's new",
      "nav.suggest": "Suggest a test",
      "nav.donate": "Donate",
      "nav.menuOpen": "Open menu",
      "theme.toggle": "Light/dark theme",

      "home.eyebrow": "Clinical tool · Free · Made here",
      "home.title": "See a <span class=\"accent-word\">profile</span>,<br>not just numbers.",
      "home.slogan": "Vizéa turns standardized scores into a clear cognitive profile, grouped by cognitive function: ready to interpret, export and share.",
      "home.btnStart": "Start a visualization",
      "home.btnDemo": "Start a demonstration",
      "home.btnDiscover": "Discover the project",
      "home.btnInstall": "Install the app",
      "home.note": "No clinical data is kept. Scores stay in your browser for the duration of the session only.",

      "home.card.label": "Cognitive profile",
      "home.card.lang": "Language",
      "home.card.visuo": "Visuo.",
      "home.card.mem": "Memory",
      "home.card.att": "Attention",
      "home.card.exec": "Exec.",
      "home.feat1.title": "A profile at a glance",
      "home.feat1.desc": "Every score is placed on a common scale and grouped by cognitive function, over the recognized interpretation bands.",
      "home.feat2.title": "Fully adjustable",
      "home.feat2.desc": "Change the scale, chart type and colours, hide functions, add the values, then export the finished image.",
      "home.feat3.title": "Private by design",
      "home.feat3.desc": "Scores never leave your device. Only your test templates and chart preferences are saved, locally.",
      "home.cta.title": "Ready to visualize a profile?",
      "home.cta.desc": "No sign-up required. Create a project, enter your scores, get the chart.",
      "home.cta.btn": "Open the tool",

      "common.close": "Close",
      "common.value": "Value",
      "common.scoreType": "Score type",
      "score.percentile": "Percentile rank",
      "score.standard": "Standard score",
      "score.scaled": "Scaled score",
      "score.z": "Z-score",
      "score.t": "T-score",

      "wiz.tab.project": "Project",
      "wiz.tab.tests": "Tests",
      "wiz.tab.scores": "Scores",
      "wiz.tab.chart": "Chart",
      "wiz.new.title": "New project",
      "wiz.new.intro": "Give the session a name, choose a starting point, then add your tests. Everything stays local on your device.",
      "wiz.new.privacy": "Do not enter any information that could identify the person assessed (name, date of birth, initials). Use an internal code if needed.",
      "wiz.new.nameLabel": "Project name",
      "wiz.new.namePh": "e.g. Assessment 2026-014",
      "wiz.new.startLabel": "Starting point",
      "wiz.new.blankOption": "Blank project: no template",
      "wiz.new.templateHint": "A template reuses the whole saved structure (tests, scores, functions, types), without any value.",
      "wiz.new.deleteTemplate": "Delete this template",
      "wiz.new.confirm": "I confirm this title contains no identifying information.",
      "wiz.new.create": "Create the project",
      "wiz.new.or": "or",
      "wiz.new.importTitle": "Reopen an exported project (.vizea)",
      "wiz.new.importDesc": "Reloads a full project, scores included.",
      "wiz.tests.title": "Test selection",
      "wiz.tests.searchPh": "Search for a battery or a test…",
      "wiz.tests.manualPh": "Name of a test not in the list",
      "wiz.tests.addManual": "Add manually",
      "wiz.tests.selected": "Selected tests",
      "wiz.tests.emptyHint": "No test selected yet.",
      "wiz.tests.warning": "Select at least one test to continue.",
      "wiz.tests.next": "Continue to scores →",
      "wiz.scores.title": "Score entry",
      "wiz.scores.intro": "For each score: the value, its type, and the cognitive function(s) assessed. You can add several scores to the same test.",
      "wiz.scores.kbdHint": "Tip: press <kbd>Enter</kbd> to move to the next score field (or <kbd>Tab</kbd> for the next field).",
      "wiz.scores.back": "← Back to tests",
      "wiz.scores.toChart": "View the chart →",

      "panel.open": "Customize",
      "panel.title": "Customize",
      "export.image": "Image (PNG)",
      "export.excel": "Export to Excel",
      "export.template": "Save as template",
      "export.project": "Export the project (.vizea)",
      "panel.sec.display": "Display",
      "panel.sec.bands": "Interpretation bands",
      "panel.sec.content": "Content and colours",
      "panel.sec.compare": "Comparison line",
      "panel.displayScale": "Displayed scale",
      "panel.chartType": "Chart type",
      "panel.typeLine": "Line",
      "panel.typeRadar": "Radar",
      "panel.textSize": "Text size",
      "panel.dataLabels": "Value on points",
      "panel.proportional": "Spacing proportional to rarity",
      "panel.testLabels": "Test names (horizontal axis)",
      "panel.radarFill": "Profile shading (radar)",
      "panel.title2": "Chart title",
      "panel.titlePh": "Leave empty for no title",
      "panel.showBands": "Show bands",
      "panel.bandLabels": "Band names on the chart",
      "panel.bandOpacity": "Colour intensity",
      "panel.renameBands": "Rename bands",
      "panel.resetNames": "Restore original names",
      "panel.axisLimits": "Vertical axis limits",
      "panel.axisHint": "Leave empty for automatic range.",
      "panel.min": "Minimum",
      "panel.max": "Maximum",
      "panel.functions": "Displayed functions",
      "panel.fnHint": "Drag to reorder · uncheck to hide",
      "panel.tests": "Displayed tests",
      "panel.testsHint": "Drag to reorder · uncheck to hide · click the name to rename it",
      "panel.viewOnly": "Display only: your entered data does not change.",
      "panel.colors": "Colours by function",
      "panel.radarColor": "Profile colour (radar)",
      "panel.radarProfile": "Radar profile",
      "panel.compareHint": "Draws a horizontal marker (e.g. estimated IQ) to situate the profile.",
      "panel.compareLabel": "Label (optional)",
      "panel.comparePh": "e.g. estimated IQ",
      "panel.removeLine": "Remove the line",
      "view.line": "Profile",
      "view.scales": "Scales",
      "view.radar": "Radar",
      "view.table": "Table",
      "common.template": "Template",
      "wiz.new.blankWithTemplates": "No template — blank project",
      "wiz.new.blankNoTemplates": "No saved template — blank project",
      "wiz.tests.listEmpty": "Type above to search for a test…",
      "common.type": "Type",
      "scores.fieldName": "Score name",
      "scores.fieldScore": "Score",
      "scores.fieldFunctions": "Functions",
      "scores.addScore": "+ Add a score to this test",
      "scores.direction": "Direction",
      "scores.namePh": "Score name (optional)",
      "scores.fnPlaceholder": "Cognitive functions…",
      "scores.addFn": "Add a function…",
      "scores.inverted": "Inverted",
      "scores.invertedTitle": "Inverted score (high = unfavourable)",
      "scores.invertedNote": "* Inverted score (high = unfavourable): positioned and classified by its inverse distance from the mean.",
      "scales.title": "Global scales",
      "scales.hint": "· standard score or percentile rank",
      "scales.useForViz": "Use these values for the scales view",
      "scales.sigle": "Abbrev.",
      "scales.add": "+ Add a scale",
      "scales.useEgqi": "Use the FSIQ score",
      "scales.egqiHint": "Enter an FSIQ value (Wechsler test) to enable it.",
      "comment.title": "Comment",
      "comment.placeholder": "Observation, remark, personal note…",
      "comment.pin": "Pin",
      "comment.pinned": "Pinned",
      "comment.pinTitle": "Show this comment permanently on the chart (and in the exported image)",
      "comment.pinnedTitle": "Remove the label from the chart",
      "common.done": "Done",
      "panel.noFunctions": "No function to display.",
      "panel.renameHint": "rename for display (does not affect classification)",
      "panel.fnRenameHint": "Rename for display (does not affect scores or grouping)",
      "panel.axisHintFull": "In « {scale} » values. Leave empty for automatic range.",
      "panel.scalesColor": "Line colour",
      "panel.scalesShown": "Displayed scales",
      "table.byTest": "By test",
      "table.byFunction": "By function",
      "table.classification": "Classification",
      "table.color": "Colour",
      "table.comments": "Comments",
      "footer.install": "Install the app",
      "footer.source": "Source code",
      "footer.netlify": "Powered by Netlify",
      "chart.defaultTitle": "Scores visualized by cognitive function",
      "chart.defaultScalesTitle": "Global scales overview",
      "common.save": "Save",
      "common.cancel": "Cancel",
      "scores.errImpossible": "Impossible value for a {type} (must be between {min} and {max}).",
      "scores.warnUnusual": "Unusual value for a {type} (expected range: {min} to {max}). Please check your entry.",
      "scores.warnUnusualShort": "Unusual value for a {type} (expected range: {min} to {max}).",
      "scores.pctRange": "The percentile rank must be between 0 and 100.",
      "dialog.saveAs.title": "Save as",
      "dialog.saveAs.desc": "Name the file before downloading. It will go to your browser's downloads folder.",
      "dialog.template.prompt": "Template name (test selection + preferences, no scores):",
      "dialog.deleteTemplate": "Delete this template? This action is permanent.",
      "dialog.removeTest.title": "Remove this test?",
      "dialog.removeTest.msg": "“{test}” has only one score. Removing it will take this test out of the project.",
      "dialog.removeTest.thisTest": "This test",
      "common.remove": "Remove",
      "tests.moveUp": "Move up",
      "tests.moveDown": "Move down",
      "leave.title": "Return to the project screen?",
      "leave.desc": "You are leaving the current session. If you then start a new project, the scores you entered (not exported) will be lost. This is intentional: no clinical data is kept. You can export the project before continuing.",
      "leave.export": "Export (.vizea) then continue",
      "leave.discard": "Continue without saving",
      "donate.title": "Support Vizéa",
      "donate.desc": "Vizéa is a volunteer project. Your contribution helps keep it running and improving. Thank you!",
      "donate.other": "Other",
      "donate.loading": "Loading the payment module…",
      "donate.thanks": "Thank you so much for your support.",
      "suggest.title": "Suggest a test",
      "suggest.desc": "Help the bank grow. Propose a test or a battery to add.",
      "suggest.nameLabel": "Name of the test or battery",
      "suggest.namePh": "e.g. WISC-V, Rey Figure…",
      "suggest.fnLabel": "Associated cognitive functions",
      "suggest.descLabel": "Description (optional)",
      "suggest.descPh": "Conditions, scores used, etc.",
      "suggest.yourName": "Your name (optional)",
      "suggest.yourEmail": "Your email (optional)",
      "suggest.send": "Send suggestion",
      "suggest.battery": "Battery assessing several functions",
      "suggest.success": "Thank you, your suggestion has been sent.",
      "install.kicker": "App",
      "install.h2": "Install <span class=\"brand\">Vizéa</span> as an app",
      "install.lede": "Optional and free: in addition to the website, Vizéa can be installed as an app with a few advantages, and without ever changing anything about the usual web version.",
      "install.b1t": "Offline",
      "install.b1d": "Use Vizéa without an Internet connection, once the app is open.",
      "install.b2t": "One-click launch",
      "install.b2d": "An icon in the Dock or Start menu, in its own window, without going through the browser.",
      "install.b3t": "Double-click your projects",
      "install.b3d": "Open a <strong>.vizea</strong> file directly to reopen a project (Chrome / Edge on desktop).",
      "install.b4t": "Same privacy guarantees",
      "install.b4d": "No clinical data is collected or transmitted; only the tool's files are cached.",
      "install.howTitle": "How to install it",
      "install.clickBtn": "Click this button:",
      "install.installNow": "Install Vizéa",
      "install.confirmInstall": "Confirm <strong>“Install”</strong> in the small browser window.",
      "install.hint": "Note: installing is <strong>not</strong> a download. Vizéa is added to your apps (Start menu on Windows, Dock on Mac), not to your downloads.",
      "install.safariWarn": "Safari installs a <strong>partial</strong> version: Vizéa runs in its own window and offline, but opening <strong>.vizea</strong> projects by double-click is not supported. For the <strong>full installation</strong>, use <strong>Chrome</strong> or <strong>Edge</strong> on desktop instead.",
      "install.safariIntro": "To add Vizéa to the Dock with Safari:",
      "install.safari1": "Open the <strong>File</strong> menu, in the bar at the very top of the screen.",
      "install.safari2": "Choose <strong>“Add to Dock”</strong>.",
      "install.safari3": "Confirm the name, then click <strong>“Add”</strong>.",
      "install.firefox": "Firefox <strong>does not allow</strong> installing web apps. To install Vizéa, open this page in <strong>Chrome</strong> or <strong>Edge</strong> on desktop, or simply continue on the site: everything works the same.",
      "install.iosNote": "On iPhone / iPad, installation is done through the Share menu (opening .vizea files by double-click does not exist on these devices).",
      "install.ios1": "Tap the <strong>Share</strong> button (a square with an upward arrow).",
      "install.ios2": "Scroll down, then tap <strong>“Add to Home Screen”</strong>.",
      "install.ios3": "Tap <strong>“Add”</strong>, at the top right.",
      "install.otherWarn": "For the <strong>full installation</strong> (one-click install and opening .vizea projects by double-click), use <strong>Chrome</strong> or <strong>Edge</strong> on desktop.",
      "install.otherAlt": "Otherwise: on <strong>Safari (Mac)</strong>, <strong>File → Add to Dock</strong>; on <strong>iPhone / iPad</strong>, <strong>Share → Add to Home Screen</strong>.",
      "install.allMethods": "See the methods for all browsers",
      "install.m1": "<strong>Chrome or Edge (desktop)</strong> — the “Install Vizéa” button above, or the install icon in the address bar.",
      "install.m2": "<strong>Safari (Mac)</strong> — <strong>File → Add to Dock</strong> menu.",
      "install.m3": "<strong>iPhone / iPad</strong> — <strong>Share → Add to Home Screen</strong> button.",
      "install.m4": "<strong>Firefox</strong> — not supported; use Chrome or Edge, or continue on the site.",
      "install.privacy": "Privacy: installed or not, Vizéa runs entirely on your device. No score or project is sent to a server.",
      "demo.s1.t": "Welcome to Vizéa",
      "demo.s1.b": "This short tour walks you through the tool from start to finish, with fictional data. Press “Next” to move at your own pace — you can leave at any time.",
      "demo.s2.t": "It all starts here",
      "demo.s2.b": "The “Visualization” tab opens the four-step flow: project, test selection, score entry, then the chart.",
      "demo.s3.t": "1 · The project",
      "demo.s3.b": "You give the project a name — watch, the demo enters it.",
      "demo.s4.t": "Reopen a project",
      "demo.s4.b": "Finishing a follow-up session and want to complete a profile you already started? Import the saved project to pick up exactly where you left off.",
      "demo.s5.t": "Start from a template",
      "demo.s5.b": "Often use the same battery? A template reuses the same tests and chart preferences — to save time at every assessment.",
      "demo.s6.t": "2 · Choose the tests",
      "demo.s6.b": "You search for a test — here the demo types “D-KE” — then check the ones you want. A few tests are already selected for what follows.",
      "demo.s7.t": "3 · Enter the scores",
      "demo.s7.b": "Each test appears as a card. The demo has already filled in fictional scores — here the WAIS-IV and its subtests, which also feed the indices.",
      "demo.s8.t": "Add a score",
      "demo.s8.b": "A single test can take several scores. The demo clicks “+ Add a score” and enters “Flexibility (errors)” — each score attaches to the function of your choice.",
      "demo.s9.t": "Reassign the function",
      "demo.s9.b": "Each score is tied to a cognitive function, editable here. For example, you might want to classify “Colours” and “Words” under oral language rather than executive functions — it's up to you.",
      "demo.s10.t": "4 · The chart",
      "demo.s10.b": "Here is the cognitive profile: each point is placed by its percentile rank, over interpretation bands. The selector at the top switches between four visualizations — let's go through them one by one.",
      "demo.s11.t": "Scales view",
      "demo.s11.b": "The “Scales” view shows the composite indices (VCI, PRI, WMI, PSI…) rather than the individual subtests.",
      "demo.s12.t": "Radar view",
      "demo.s12.b": "The “Radar” view lays the functions out in a star — handy to grasp the overall shape of the profile at a glance.",
      "demo.s13.t": "Customize the chart",
      "demo.s13.b": "The “Customize” button opens a panel to adjust the colours, the order of functions, the interpretation bands and the axes.",
      "demo.s14.t": "Export — Image (PNG)",
      "demo.s14.b": "From a chart view, this button exports a high-resolution PNG image, ready to use.",
      "demo.s15.t": "Table view",
      "demo.s15.b": "The “Table” view lists the scores — grouped by test or by function — with, for each, the value, the percentile rank and the classification.",
      "demo.s16.t": "Export — Excel",
      "demo.s16.b": "In Table view, this button exports the table to Excel, ready to include in a report.",
      "demo.s17.t": "Export — Template",
      "demo.s17.b": "Saves the chosen tests and your chart preferences as a reusable template, to save time on future assessments.",
      "demo.s18.t": "Export — Project (.vizea)",
      "demo.s18.b": "Exports the whole project to a .vizea file. Once Vizéa is installed, double-clicking this file reopens the project; otherwise, drag it onto the window or import it.",
      "demo.s19.t": "You're all set!",
      "demo.s19.b": "That's it! Explore this demo project freely, or create your own via “Visualization”. Happy visualizing!",
      "demo.quit": "Leave",
      "demo.next": "Next",
      "demo.finish": "Finish",
      "about.kicker": "About",
      "about.heroTitle": "A clinical tool, <em>free</em> and <em>made here</em>.",
      "about.lede": "<span class=\"brand\">Vizéa</span> makes visualizing cognitive profiles clear, fast and accessible, for free, and without depending on the big companies.",
      "about.c1t": "About Vizéa",
      "about.c1p1": "<span class=\"brand\">Vizéa</span> is a Quebec-made tool designed to make visualizing cognitive profiles easier. It is meant for health professionals, students and researchers, offering a free, accessible solution that is independent of the large companies dominating the field.",
      "about.c1p2": "The goal is simple: give us back control over our tools, encourage a freer and more collaborative practice, and support the growth of our professions without commercial barriers or recurring costs. <span class=\"brand\">Vizéa</span> allows a fast, intuitive and personalized visualization of cognitive profiles, for a better understanding of the strengths and challenges of the person assessed.",
      "about.c1p3": "It seems obvious to me that such a tool should already exist, and yet it doesn't. If <span class=\"brand\">Vizéa</span> can fill that gap, even modestly, then the project will have been worthwhile.",
      "about.c2t": "Why this project?",
      "about.c2p1": "The idea was born when my internship supervisors asked me, in supervision, to gather and share a patient's results to make their profile easier to understand. I was tired of using cobbled-together Excel files, passed along informally by professionals I didn't even know. That reliance on opaque tools pushed me to create a clear, reliable and open solution.",
      "about.c2p2": "In our field, we are often told we must “do more with less.” But the technological tools that could help us are either non-existent or overpriced, often offered by companies that already profit handsomely from the system. <span class=\"brand\">Vizéa</span> aims to change that.",
      "about.c3t": "An evolving platform",
      "about.c3p1": "<span class=\"brand\">Vizéa</span> is meant to be used, adapted and refined over time. The test-suggestion feature lets the platform grow with the community, adjusting to clinical realities and to the needs of the field. My hope is that this platform meets a real need, shared by other clinicians, and becomes a natural part of our practice.",
      "about.c4t": "Grouping by function",
      "about.c4p1": "To group the tests, I chose a deliberately concise set of cognitive functions, the ones that best match the majority of tests, without multiplying categories endlessly. The aim is to keep the tool readable and functional rather than imposing dozens of functions that would weigh down the reading. If needed, you can always add more.",
      "about.c4p2": "The default associations rest on my clinical judgment, taking into account what each test or battery is presumed to measure. As you know, some tests don't map perfectly onto a single function: Arithmetic, for instance, can draw on nonverbal reasoning, working memory or mathematics, depending on the battery used and the clinician's interpretation. That is why <span class=\"brand\">Vizéa</span> leaves you free to reclassify, rename and reorganize the functions to suit your needs and your reading of the profile.",
      "about.c4p3": "Finally, the interpretation bands follow the normative classification proposed by the American Academy of Clinical Neuropsychology (Guilmette et al., 2020) and adopted by the AQNP.",
      "about.c5t": "Privacy first",
      "about.c5p1": "<span class=\"brand\">Vizéa</span> keeps no clinical data. The scores you enter live only in your browser, for the duration of the session, and serve only to produce the chart. You alone decide whether to export and keep it, in your own secure environment. Only your test templates and chart preferences (which contain no clinical information) are saved locally.",
      "about.c6t": "A volunteer commitment",
      "about.c6p1": "This project is voluntary, and I intend to keep it that way. The costs of tests, protocols and subscriptions keep rising. And those costs, whether absorbed by the private or the public sector, always end up falling back on patients. <span class=\"brand\">Vizéa</span> is a free, accessible platform, built for the common good.",
      "about.c7t": "My background",
      "about.c7p1": "I am currently completing my doctorate in neuropsychology at the Université du Québec en Outaouais (UQO). I am doing my two internships in hospital settings, with a pediatric population. As for my modest programming skills, I was introduced to the vast world of computing by learning Matlab as part of my honours thesis and my doctoral essay at UQO's Visual and Social Perception Laboratory. I also picked up some Java through an elective course taken during my bachelor's degree.",
      "about.c7p2": "I have to admit that the visual side of this tool owes a great deal to Claude AI. It's thanks to its large water consumption and my even larger coffee consumption that <span class=\"brand\">Vizéa</span> is available, and this good-looking.",
      "about.authorTitle": "Anthony Proulx, B.Sc.<br>Doctoral candidate in neuropsychology<br>Université du Québec en Outaouais"
    }
  };

  var lang = DEFAULT;
  try {
    var urlLang = "";
    try { urlLang = (new URLSearchParams(location.search).get("lang") || "").toLowerCase(); } catch (e) { urlLang = ""; }
    var saved = localStorage.getItem(STORE_KEY);
    if (urlLang === "fr" || urlLang === "en") {
      lang = urlLang;                       // explicit link intent wins, and is remembered
      try { localStorage.setItem(STORE_KEY, lang); } catch (e) {}
    } else if (saved === "fr" || saved === "en") {
      lang = saved;
    } else {
      // No stored choice: open in the visitor's browser language (English
      // outside French locales), so professionals elsewhere land in English.
      var navLang = ((navigator && (navigator.language || navigator.userLanguage)) || "").toLowerCase();
      if (navLang.indexOf("en") === 0) lang = "en";
    }
  } catch (e) { /* private mode: keep default */ }

  function t(key) {
    var l = DICT[lang] || DICT[DEFAULT];
    if (l && key in l) return l[key];
    if (DICT[DEFAULT] && key in DICT[DEFAULT]) return DICT[DEFAULT][key];
    return key;
  }

  // Some visible text comes from CSS `content:` (e.g. empty-state hints), which
  // can't take a data-i18n attribute. We expose those as CSS custom properties
  // and update them per language. The value is a quoted CSS string.
  var CSS_VARS = { "--i18n-testEmpty": "wiz.tests.listEmpty" };
  function applyCssVars() {
    var root = document.documentElement;
    Object.keys(CSS_VARS).forEach(function (v) {
      root.style.setProperty(v, JSON.stringify(t(CSS_VARS[v])));
    });
  }

  function applyTranslations(root) {
    root = root || document;
    root.querySelectorAll("[data-i18n]").forEach(function (el) {
      el.textContent = t(el.getAttribute("data-i18n"));
    });
    root.querySelectorAll("[data-i18n-html]").forEach(function (el) {
      el.innerHTML = t(el.getAttribute("data-i18n-html"));
    });
    root.querySelectorAll("[data-i18n-attr]").forEach(function (el) {
      // "placeholder:home.search, title:foo.bar"
      el.getAttribute("data-i18n-attr").split(",").forEach(function (pair) {
        var bits = pair.split(":");
        if (bits.length === 2) el.setAttribute(bits[0].trim(), t(bits[1].trim()));
      });
    });
    if (root === document) {
      applyCssVars();
      // Page title and meta description follow the language (helps when the page
      // is shared or bookmarked in English).
      var mt = t("meta.title");
      if (mt && mt !== "meta.title") document.title = mt;
      var md = document.querySelector('meta[name="description"]');
      var mdt = t("meta.desc");
      if (md && mdt && mdt !== "meta.desc") md.setAttribute("content", mdt);
      var ogt = document.querySelector('meta[property="og:title"]');
      if (ogt && mt && mt !== "meta.title") ogt.setAttribute("content", mt);
      var ogd = document.querySelector('meta[property="og:description"]');
      if (ogd && mdt && mdt !== "meta.desc") ogd.setAttribute("content", mdt);
    }
  }

  function setLang(next, opts) {
    if (next !== "fr" && next !== "en") return;
    lang = next;
    try { localStorage.setItem(STORE_KEY, lang); } catch (e) { /* noop */ }
    document.documentElement.setAttribute("lang", lang);
    applyTranslations(document);
    syncToggleButton();
    if (!opts || !opts.silent) {
      document.dispatchEvent(new CustomEvent("vizea:langchange", { detail: { lang: lang } }));
    }
  }

  function syncToggleButton() {
    var btn = document.getElementById("langToggle");
    if (!btn) return;
    btn.textContent = t("lang.toggle");
    btn.setAttribute("aria-label", t("lang.toggleAria"));
    btn.setAttribute("title", t("lang.toggleAria"));
  }

  // Delegated click handler (robust to script/DOM timing and any re-render):
  // a single listener on document catches clicks on #langToggle whenever it
  // exists, instead of binding directly at init time.
  document.addEventListener("click", function (e) {
    var btn = e.target && e.target.closest ? e.target.closest("#langToggle") : null;
    if (btn) setLang(lang === "fr" ? "en" : "fr");
  });

  function init() {
    document.documentElement.setAttribute("lang", lang);
    applyTranslations(document);
    syncToggleButton();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  window.VizeaI18n = {
    t: t,
    getLang: function () { return lang; },
    setLang: setLang,
    applyTranslations: applyTranslations,
    // Lets later steps register extra dictionary entries as we translate more.
    extend: function (frMap, enMap) {
      Object.assign(DICT.fr, frMap || {});
      Object.assign(DICT.en, enMap || {});
    }
  };
})();
