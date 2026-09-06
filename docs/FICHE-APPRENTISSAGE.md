# Fiche orale, mcp-opentelemetry

> Format des fiches de vente orale (`contenu/matiere-brute/fiches-techniques-entretiens/projets/vente-orale/00-METHODE.md`).
> Matière : ce dépôt, le rapport `recherche/R9-matrice-instrumentations.md` du dossier parent, et `DECISIONS.md` (D-001 à D-008).
> Règle tenue partout : le code est écrit par un agent, le cadrage, le refus, la borne, la vérification et la mesure sont d'Amir.
> Paquet publié : https://www.npmjs.com/package/mcp-opentelemetry · Dépôt : https://github.com/AmirK-S/mcp-opentelemetry
> **État au 06/09/2026, à dire tel quel.** npm sert la version 0.1.0, seule version publiée (`npm view mcp-opentelemetry versions`). La branche `main` du dépôt porte déjà 0.2.0 non publiée, qui couvre les requêtes initiées par le serveur (`CHANGELOG.md`, bloc `[0.2.0]`). Les deux se disent ensemble : « publié en 0.1.0, la 0.2.0 est écrite et pas encore poussée sur npm ».

---

## La phrase d'une ligne

> « mcp-opentelemetry est un paquet npm qui rend traçable de bout en bout un appel d'outil MCP : le contexte de trace du client voyage dans `params._meta`, le serveur le reprend comme parent, et la trace se lit d'un bloc dans Jaeger. J'ai commencé par mesurer les treize instrumentations existantes avant d'en écrire une. »

---

## La pile technique, avec le mot exact du marché

| Brique | Le mot du marché | Ce qu'elle fait ici précisément | Fichier |
|---|---|---|---|
| Protocole | **MCP, révision `2026-07-28`** | le paquet cible le SDK TypeScript 2.x, première ligne de version qui parle cette révision ; le SDK 1.x n'est pas supporté | `README.md`, section « Status » |
| Propagation | **W3C Trace Context dans `params._meta`** | les trois clés réservées non préfixées `traceparent`, `tracestate`, `baggage` (SEP-414), injectées côté client, extraites côté serveur | `src/keys.ts`, 14 lignes |
| Spans | **conventions sémantiques OpenTelemetry pour MCP** | un span `CLIENT` par requête sortante, un span `SERVER` par requête entrante, nommés `{mcp.method.name} {cible}` | `src/instrumentation.ts` |
| Attributs | **noms de la convention, aucun nom maison** | `mcp.method.name`, `jsonrpc.request.id`, `gen_ai.tool.name`, `gen_ai.operation.name`, `gen_ai.prompt.name`, `mcp.resource.uri`, `error.type`, `rpc.response.status_code`, `network.transport` | `src/semconv.ts`, 53 lignes |
| Parentage | **contexte distant en parent, contexte ambiant en lien** | le contexte porté par `_meta` est le parent du span serveur ; le contexte ambiant du processus serveur devient un `link`, pas un parent, comme la convention le demande | `src/instrumentation.ts`, bloc de création du span serveur |
| Point d'accroche | **décorateur de transport** | une seule fonction enveloppe `send`, `onmessage` et `onclose` du transport ; ni fork du SDK, ni `--require`, ni correctif de module au chargement | `src/instrumentation.ts`, `instrumentTransport` |
| Dépendances | **une seule dépendance de production, en `peerDependencies`** | `@opentelemetry/api` ; les paquets MCP sont en `devDependencies` et ne sont jamais importés à l'exécution | `package.json` |
| Vérification | **suite hors ligne, transport et exportateur en mémoire** | `npm test` : 89 tests passants et 4 en attente sur `main` le 06/09/2026, sans réseau ni conteneur ; 83 passants sur le code de la 0.1.0 publiée | sortie de `npm test` |
| Vérification externe | **suite de conformance officielle** | `@modelcontextprotocol/conformance` 0.2.0-alpha.11 avec `--requirements 2026-07-28`, exécutée deux fois contre le même serveur d'exemple, nu puis instrumenté | `scripts/conformance.sh` |
| Observabilité | **observabilité des agents** | la trace montre le span de l'agent, le span client, le span serveur dans l'autre processus, et les spans ouverts à l'intérieur de l'outil | `examples/stdio/` |

---

## Le gabarit 60 à 90 secondes, rempli

**Contexte.** Projet personnel, publié sur npm sous licence MIT en septembre 2026, version 0.1.0, la 0.2.0 étant écrite dans le dépôt et pas encore publiée. C'est une instrumentation OpenTelemetry pour le SDK MCP TypeScript, écrite après une mesure de l'existant.

**Problème.** Quand un agent appelle un outil sur un serveur MCP, l'appel change de processus. Sans propagation du contexte, la trace repart de zéro côté serveur : on obtient deux traces sans lien, et on ne peut plus dire quel appel d'agent a produit quelle requête en base. J'ai mesuré l'ampleur du trou avant de le boucher : sur treize instrumentations MCP dont j'ai lu le code publié, deux propagent le contexte et posent l'attribut requis par la convention.
<!-- source: recherche/R9-matrice-instrumentations.md, section « Paquets mesures » (13 lignes) et colonne 5 ; les deux sont `mcp` 2.1.1 et ce paquet -->

**Ce que j'ai construit.** Trois briques. Un décorateur de transport qui injecte les trois clés réservées dans `params._meta` côté client. Le même décorateur, côté serveur, qui les extrait et ouvre un span `SERVER` actif pendant l'exécution de l'outil, donc les spans que l'outil crée se rangent dessous. Et un module unique qui détient toutes les chaînes d'attributs de la convention, épinglé et vérifié par test.

**La décision dont je suis le plus fier.** Le paquet n'importe rien de `@modelcontextprotocol/*` à l'exécution. Les trois clés réservées et les gardes de type JSON-RPC sont définies en interne, et un test les compare aux constantes publiées par le SDK. L'alternative écartée était d'importer `@modelcontextprotocol/core/internal`, qui est le seul endroit d'où ces constantes sont exportées. Le critère : lier un paquet à un sous-chemin nommé « internal » d'un SDK dans sa première ligne de version, c'est accepter qu'un correctif du SDK casse mes utilisateurs. Le seuil de bascule est écrit : le jour où le SDK exporte ces constantes depuis sa racine publique, j'importe et je supprime mon module.

**Le résultat mesuré.** La suite de conformance officielle rend 50 scénarios identiques, 185 vérifications, avec et sans instrumentation ; aucun scénario ne casse à cause du traçage. Sa limite, que je dis avant qu'on la trouve : c'est une preuve de non-régression du protocole, pas une preuve que mes spans sont justes. Ce sont les tests de la suite hors ligne, 89 passants sur `main` le 06/09, qui vérifient les spans, et quatre mutations manuelles du code m'ont dit ce que chacun garde.
<!-- source: test/integration/results/conformance/comparison.md (50 scénarios, 0 divergence) ; README.md section « How it is tested » (185 checks, mutations 16/55/8/4) ; sortie de npm test du 06/09/2026 (83 passants, 4 en attente) -->

---

## Cinq décisions revendicables, avec la preuve dans le code

**D1. Cadrer le point d'accroche sur le transport, et refuser la seconde couche.**
Le brief prévoyait deux couches : le transport pour la propagation, une enveloppe de `setRequestHandler` pour le span serveur. Décidé le 05/09 : une seule couche. Le décorateur de transport voit le nom de la méthode, la cible, la version de protocole et la réponse, donc il construit le span serveur nommé et attribué à lui seul ; `setRequestHandler` n'est jamais enveloppé.
Critère : le gestionnaire s'exécute dans la continuation synchrone de `onmessage`, ce qui a été sondé dans le SDK avant d'écrire une ligne. Un `context.with()` posé autour de `onmessage` couvre donc déjà le corps de l'outil, y compris après un `await`.
Preuve : `DECISIONS.md` D-006 ; `src/instrumentation.ts`, `instrumentTransport` ; le test « runs the tool handler inside the server span context » de `test/requests.test.ts` passe sans aucune couche B ; la mutation qui retire l'activation du contexte autour du dispatch fait tomber 4 tests.
<!-- source: DECISIONS.md D-006 ; README.md, « Four manual mutations, run once on 2026-09-05 » -->
Ce que ça coûte, et je le dis : les rejets d'entrée HTTP avant le transport (405, en-tête `Mcp-Method` absent) ne produisent aucun span. C'est écrit dans le README, section « Known limits ».

**D2. Refuser toute dépendance MCP à l'exécution, et vérifier ce refus par un test.**
Les trois clés réservées ne sont exportées que par `@modelcontextprotocol/core/internal`, `client` et `server`, jamais par la racine publique de `core`. Décidé : les redéfinir dans `src/keys.ts`, et écrire un test qui les compare aux constantes du SDK, pour que la divergence se voie au lieu de se subir.
Critère : la seule dépendance de production est `@opentelemetry/api`, en `peerDependencies`. Le paquet travaille sur la forme du transport, pas sur des types importés, donc il reste utilisable sur toute la ligne 2.x.
Preuve : `src/keys.ts`, 14 lignes ; `test/keys.test.ts` ; `package.json`, un seul `peerDependencies` ; `DECISIONS.md` D-006, point 2.
Seuil de bascule, écrit : si le SDK publie ces constantes depuis sa racine, le module interne disparaît.

**D3. Borner les chaînes de la convention dans un module unique, épinglé et comparé.**
Toutes les constantes `ATTR_MCP_*` et `ATTR_GEN_AI_TOOL_*` de `@opentelemetry/semantic-conventions` sont marquées dépréciées depuis 1.42.0 : elles ont déménagé vers un dépôt qui ne produit encore aucun paquet. Décidé : un module unique, `src/semconv.ts`, qui détient les chaînes ; `@opentelemetry/semantic-conventions` épinglé en exact sur 1.43.0 en `devDependencies` ; et un test qui compare mes chaînes aux constantes dépréciées du paquet.
Critère : le risque a changé de nature. Ce n'est plus « la convention bouge et le paquet de constantes suit », c'est « la convention bouge et aucun paquet ne suit ». Une chaîne littérale répandue dans le code rendrait ce mouvement ingérable ; concentrée dans un module de cinquante lignes, il devient une version mineure.
Preuve : `src/semconv.ts`, 53 lignes ; `test/semconv.test.ts`, 20 tests ; `DECISIONS.md` D-005 ; `docs/END-OF-LIFE.md`, section 1, qui nomme les trois signaux à surveiller.
<!-- source: sortie de npm test du 06/09/2026 pour les 20 tests de semconv.test.ts ; DECISIONS.md D-005 pour la dépréciation depuis 1.42.0 -->

**D4. Refuser l'option de troncature, et la remplacer par une mesure.**
La question ouverte était : faut-il une option pour tronquer le `baggage`, puisque tracer alourdit chaque message. Décidé : non, aucune option. À la place, un test calcule le poids d'un `_meta` maximal et le README publie le chiffre.
Le chiffre : un `_meta` complet, avec les deux clés d'enveloppe requises, un `tracestate` de 512 caractères et un `baggage` de 8192 octets, pèse 8909 octets sérialisés. La borne effective la plus basse de l'écosystème est le défaut de 100 Kio d'`express.json()`, que `@modelcontextprotocol/express` n'écrase pas ; le tampon stdio du SDK est à 10 Mio. Et `@opentelemetry/core` borne déjà `baggage` et `tracestate`, silencieusement ; le paquet, lui, écrit une ligne de debug quand une entrée est perdue.
<!-- source: test/size.test.ts, assertion `toBe(8909)` ; README.md, section « Size » ; DECISIONS.md D-004 -->
Preuve : `test/size.test.ts` ; `README.md`, section « Size » ; `DECISIONS.md` D-004.
Ce que ça vend : une objection de performance se répond par un chiffre et son fichier, pas par une option de plus.

**D5. Mesurer l'écosystème avant d'écrire, puis publier borné et refermer la borne ensuite.**
Avant la première ligne, j'ai téléchargé et lu le code publié de treize instrumentations MCP, npm et PyPI, jamais leur README, avec un script qui refait la mesure de bout en bout. Résultat : deux propagent le contexte et posent l'attribut requis. C'est ce qui a justifié d'écrire le paquet, et c'est aussi ce qui l'a borné.
Puis, à la publication, décidé de sortir 0.1.0 avec la moitié manquante écrite noir sur blanc dans le README et le CHANGELOG plutôt que d'attendre : requêtes initiées par le serveur, notifications, métriques, annoncées pour la suite dans cet ordre. La première des trois est refermée depuis, en 0.2.0 dans le dépôt : les deux transports traitent désormais les deux sens.
Preuve : `recherche/R9-matrice-instrumentations.md`, section « Paquets mesures » et son script de reprise ; `DECISIONS.md` D-003 et D-007 ; `README.md`, sections « Known limits » et « Roadmap » ; `CHANGELOG.md`, bloc « Not covered in this release » de la 0.1.0, puis bloc `[0.2.0]`.
Le rapport contient aussi une section de réserves sur mon propre paquet, six points, écrite avant publication. C'est ce que je montre quand on me demande si je sais critiquer mon travail.

---

## Les huit questions les plus probables

**1. « Pourquoi un paquet de plus, il en existe déjà une dizaine ? »**
Parce que j'ai lu leur code au lieu de leur README, et que la promesse et le code divergent souvent. Sur treize paquets mesurés, deux propagent le contexte de trace et posent l'attribut requis par la convention ; un troisième exporte bien une fonction d'injection mais ne la câble nulle part. La niche n'est pas « faire des spans MCP », elle est « faire des spans MCP qui se rattachent à la trace de l'agent, sur le SDK TypeScript 2.x ».

**2. « Comment savez-vous que ça marche ? »**
Trois niveaux, et je donne leur limite avec eux. `npm test` fait tourner une suite hors ligne, transport et exportateur en mémoire, qui vérifie attribut par attribut et relation de parenté par relation de parenté ; elle a rendu 89 tests passants et 4 en attente sur `main` le 06/09. `npm run test:integration` lance deux vrais processus sur stdio, puis relit la trace depuis l'API de Jaeger. Et la suite de conformance officielle tourne deux fois contre le même serveur, nu puis instrumenté, et compare : 50 scénarios identiques, aucune divergence.

**3. « Vos tests, ils testent quelque chose ou ils passent ? »**
J'ai posé la question au code, en cassant quatre choses une par une. Extraction désactivée : 16 tests rouges. Nom de span sans cible : 55. Injection retirée : 8. Contexte non activé autour du dispatch : 4. C'est la seule façon que je connaisse de savoir ce qu'une suite garde vraiment, et le chiffre le plus faible, 4, est celui qui m'a le plus appris : la garde la plus fine du paquet est aussi la moins couverte.

**4. « La conformance passe, donc c'est conforme ? »**
Non, et c'est important. La suite de conformance vérifie que le protocole MCP reste correct quand mon instrumentation est en place, elle ne vérifie pas mes spans. Ce qu'elle prouve exactement : les mêmes 50 scénarios, les mêmes 185 vérifications, le même verdict des deux côtés, donc le traçage ne change rien au comportement observable du serveur.

**5. « Qu'est-ce qui ne marche pas ? »**
Trois trous étaient écrits dans le README de la 0.1.0 avant que quiconque me les demande ; il en reste deux. Les notifications, `notifications/progress` et `notifications/cancelled`, traversent l'instrumentation sans span ni propagation, alors que la convention demande l'injection sur les notifications comme sur les requêtes. Et aucune métrique n'est émise alors que la convention en définit quatre : les quatre noms sont déclarés dans mon module de constantes et utilisés nulle part. Le troisième trou, les requêtes que le serveur initie, était structurel, et c'est celui que la 0.2.0 referme dans le dépôt.

**6. « Et si le SDK livre sa propre instrumentation demain ? »**
C'est déjà arrivé côté Python : le SDK y a fait d'OpenTelemetry un intergiciel par défaut. Côté TypeScript, l'issue existe sans code, et un mainteneur a écrit dans le fil de cadrage que cela devrait vivre dans un paquet séparé, sans dépendance dure sur `@opentelemetry/api` dans les paquets publiés : ce paquet prend exactement cette forme, depuis l'extérieur. La réponse est écrite dans `docs/END-OF-LIFE.md` : détecter l'instrumentation du SDK sur le transport, s'effacer sur ce qu'elle couvre, garder le reste, et le dire dans le README de cette version.

**7. « Vous avez codé ça ? »**
Le code est écrit par un agent, comme chez vous. Ce qui est de moi tient dans huit décisions datées et sourcées : le point d'accroche unique, le refus d'importer un sous-chemin interne du SDK, le module unique pour les chaînes de la convention, le refus d'une option de troncature remplacée par une mesure, et le périmètre de la première version. Chacune nomme son alternative écartée et son seuil de bascule, et je peux ouvrir le fichier devant vous.

**8. « Ça sert à quoi, concrètement, dans une équipe ? »**
À répondre à la question « pourquoi cet appel a mis quatre secondes » quand l'appel traverse deux processus. Aujourd'hui, un serveur MCP derrière un hôte qui n'envoie pas de `traceparent` produit des traces racines, une par appel d'outil, sans lien avec l'agent : je l'ai vérifié le 05/09 sur un client réel, qui parle une révision antérieure et ne met dans `_meta` qu'un jeton de progression et son propre identifiant d'appel. Avec le paquet des deux côtés, la trace se lit d'un bloc, et les spans que l'outil ouvre lui-même se rangent sous le span serveur.

---

## Les trois questions pièges

**Piège 1. « Votre README parle de 79 tests, votre suite en affiche 89. »**
Vrai, et c'est le README qui a raison au moment où il a été écrit. Les quatre mutations manuelles ont été exécutées le 05/09 contre une suite de 79 tests ; la suite a grossi depuis, elle rend 89 passants et 4 en attente sur `main` le 06/09. La règle que je tiens : l'artefact fait foi, la documentation suit, et le chiffre des mutations reste attaché à la suite contre laquelle elles ont tourné.
Comment ne pas tomber : donner les deux chiffres et leur date dans la même phrase, avant qu'on ouvre le terminal. Même règle pour la version : npm sert 0.1.0, le dépôt est à 0.2.0 non publiée, et c'est moi qui le dis en premier.

**Piège 2. « Votre journal de décision dit 8 917 octets, votre README dit 8 909. »**
Vrai aussi. Le chiffre qui fait foi est celui que le test calcule, 8 909, parce qu'il est recalculé à chaque exécution ; l'entrée de décision porte une valeur intermédiaire qui n'a pas été reprise. C'est exactement le genre d'écart qui se nomme soi-même, et la correction tient en un mot dans le journal.
Comment ne pas tomber : citer le test, pas le document. Un chiffre vérifié par une assertion bat un chiffre recopié.

**Piège 3. « Vous réécrivez le `traceparent` du message entrant, personne ne vous l'a demandé. »**
Exact, et la convention ne le demande nulle part. Côté serveur, après extraction, le paquet réinjecte dans `params._meta` le contexte du span serveur avant de rendre la main au SDK, pour que toute extraction en aval se parente correctement au lieu de se parenter au client. Le prix est réel : un gestionnaire qui comparerait le `traceparent` du message à celui du fil verrait la différence, et l'identifiant de trace, lui, ne change pas.
Comment ne pas tomber : dire que c'est un écart assumé, dire le test de coexistence qui échouait sans lui, et dire que c'est écrit dans le README, section « Parenting ».

---

## Ce qu'il referait autrement

Une seule chose, et elle est déjà écrite dans le dépôt : mesurer le surcoût par requête avant de publier, pas après. Le paquet publie un chiffre de taille, 8 909 octets pour un `_meta` maximal, mais aucun chiffre de temps. Or la première objection d'une équipe qui met une instrumentation en production n'est pas « combien d'octets », c'est « combien de microsecondes par appel ». La mesure est inscrite au quatrième point de la feuille de route, ce qui veut dire qu'elle a été identifiée et repoussée, et je le dis dans cet ordre : identifiée, repoussée, pas oubliée.

Le second point, plus petit : `mcp.session.id` n'est pas posé alors que l'interface de transport expose déjà l'identifiant. C'est le recommandé le plus facile à poser du lot, et il ne l'est pas.

---

## Vocabulaire

**À employer**

`MCP` (forme longue à la première occurrence : Model Context Protocol) · `OpenTelemetry` · `W3C Trace Context` · `conventions sémantiques` · `observabilité des agents` · `propagation de contexte` · `span client`, `span serveur` · `parent distant`, `lien vers le contexte ambiant` · `suite de conformance` · `décorateur de transport` · `attribut requis`, `attribut conditionnel`

**Les verbes qui se disent**

`cadrer` · `choisir` · `refuser` · `borner` · `vérifier` · `mesurer` · `écarter` · `dater` · `sourcer`

**Les mots à éviter**

`j'ai codé`, `j'ai implémenté`, `j'ai développé de A à Z` · `expert`, `architecte` · `state of the art`, `production ready`, `robuste`, `complet` · `traçage distribué de bout en bout` employé sans dire que les notifications et les métriques ne sont pas couvertes · `la dernière version` sans préciser npm ou le dépôt · le nom d'un client ou d'un employeur · un compteur d'années · toute comparaison à un autre paquet qui ne cite pas la ligne de code mesurée

---

## La démonstration en cinq minutes

Prérequis : Docker et Node 20 ou plus. Tout tourne en local, rien n'est envoyé à l'extérieur.

**1. Le collecteur, dans un premier terminal.** Environ 30 secondes.

    docker run --rm --name jaeger -p 16686:16686 -p 4317:4317 -p 4318:4318 cr.jaegertracing.io/jaegertracing/jaeger:2.20.0

Ce qu'Amir dit pendant que l'image descend : « C'est Jaeger, un lecteur de traces OpenTelemetry standard. Rien dans ce que vous allez voir n'est propre à mon paquet : il émet de l'OpenTelemetry, donc n'importe quel collecteur qui parle OTLP fait l'affaire, le vôtre y compris. »

**2. Le dépôt, dans un second terminal.** Environ une minute.

    git clone https://github.com/AmirK-S/mcp-opentelemetry
    cd mcp-opentelemetry
    npm ci

Ce qu'il dit pendant l'installation : « Le paquet lui-même n'a qu'une dépendance de production, `@opentelemetry/api`, et elle est en `peerDependencies` : c'est vous qui décidez de sa version. Tout ce qui descend ici, ce sont les outils de test et les paquets MCP, qui ne sont jamais importés à l'exécution. »

**3. La démonstration.** Environ 10 secondes.

    npm run example:stdio

Ce qu'il dit : « Un client MCP démarre un serveur en processus séparé, ouvre un span appelé `agent`, et appelle un outil dedans. Deux processus, deux exportateurs, aucun canal entre eux à part le protocole. »

La commande imprime le contenu de la réponse, puis l'identifiant de trace, puis un lien.

**4. La trace, dans le navigateur.** Environ une minute.

    http://localhost:16686/trace/<identifiant imprimé>

Ce qu'il montre, en pointant du haut vers le bas, quatre spans :
- `agent`, ouvert par le client avant l'appel ;
- `tools/call get-weather`, le span `CLIENT`, nommé par la convention : le nom de la méthode, puis la cible ;
- `tools/call get-weather` à nouveau, le span `SERVER`, dans l'autre processus ;
- `lookup-forecast`, ouvert par le code de l'outil lui-même.

Ce qu'il dit : « Le quatrième span est le seul qui compte pour l'argument. Le code de l'outil ouvre un span ordinaire, sans rien savoir de MCP ni de mon paquet, et il se range au bon endroit, dans l'autre processus, parce que le contexte a voyagé dans `params._meta`. Sans propagation, ce span-là ouvre une deuxième trace, et la question `pourquoi cet appel a été lent` n'a plus de réponse. » Puis cliquer sur le span serveur et lire ses attributs : `mcp.method.name`, `gen_ai.tool.name`, `jsonrpc.request.id`. « Ce sont les noms de la convention, pas les miens. C'est ce qui fait qu'un tableau de bord écrit pour la convention marche sans être adapté. »

**5. La vérification.** Environ 5 secondes.

    npm test

Ce qu'il dit pendant que ça défile : « Hors ligne, transport et exportateur en mémoire, moins d'une seconde. Ce qui est vérifié ici n'est pas que ça tourne, c'est que chaque attribut porte le bon nom et que chaque span a le bon parent. Et pour savoir ce que cette suite garde vraiment, j'ai cassé quatre choses une par une : extraction désactivée, 16 tests rouges ; nom de span sans cible, 55 ; injection retirée, 8 ; contexte non activé autour du dispatch, 4. »

**6. Si le temps le permet.** Environ trois minutes, réseau requis.

    npm run conformance

Ce qu'il dit : « La suite de conformance officielle du protocole, lancée deux fois contre le même serveur d'exemple : une fois nu, une fois instrumenté. Le script échoue à la moindre différence. Dernière exécution : 50 scénarios, 185 vérifications, verdict identique des deux côtés. Ce que ça prouve, et seulement ça : mon instrumentation ne change rien au comportement du serveur. Elle ne prouve pas que mes spans sont justes, ce sont les tests d'avant qui le font. »

**Si la démonstration casse.** Le repli tient en une phrase : le fichier `test/integration/results/jaeger-trace.json` contient la trace de la dernière exécution, relue depuis l'API de Jaeger, et `test/integration/results/conformance/comparison.md` contient le tableau des 50 scénarios ligne par ligne. Une démonstration qui casse se remplace par son artefact, jamais par une explication.

---

<sub>Fiche orale · mcp-opentelemetry, 0.1.0 publiée et 0.2.0 dans le dépôt · 06/09/2026 · chiffres relevés le 06/09/2026 · sources : ce dépôt, `recherche/R9-matrice-instrumentations.md`, `DECISIONS.md` D-001 à D-008.</sub>
