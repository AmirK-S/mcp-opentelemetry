# Post LinkedIn, mcp-opentelemetry

> Deux blocs à envoyer tels quels : le français, puis sa variante anglaise.
> Le reste du fichier est du commentaire, il ne se publie pas.
> Contrôle mécanique : `recherche/outils/verifier-message.py --type message --stade premier --canal fr`.
> Le verdict est reporté en bas de ce fichier.

## Français

```
Treize instrumentations OpenTelemetry pour MCP (Model Context Protocol) mesurées en lisant leur code publié, pas leur README. Deux propagent le contexte de trace et posent l'attribut requis par les conventions sémantiques.

Sans propagation, la trace repart de zéro au serveur : l'appel d'outil n'est plus rattaché à l'agent qui l'a déclenché. C'est le point aveugle de l'observabilité des agents.

mcp-opentelemetry fait deux choses pour le SDK TypeScript 2.x : il propage le W3C Trace Context par params._meta, injecté côté client et extrait côté serveur ; il ouvre un span client et un span serveur, nommés et attribués selon la convention.

La suite de conformance officielle rend 50 scénarios identiques, avec et sans instrumentation.

npmjs.com/package/mcp-opentelemetry

Si vous tracez vos serveurs autrement, dites-le.

#MCP #OpenTelemetry
```

<!-- source du chiffre 13 et du chiffre 2 : recherche/R9-matrice-instrumentations.md, section « Paquets mesures » et colonne 5 (seuls `mcp` 2.1.1 et `mcp-opentelemetry` 0.1.0 propagent et posent `mcp.method.name`) -->
<!-- source du chiffre 50 : test/integration/results/conformance/comparison.md, « Scenarios: 50. Identical: 50. Diverging: 0. » -->

## English

```
Thirteen OpenTelemetry instrumentations for MCP (Model Context Protocol), measured by reading their published code, not their README. Two of them propagate trace context and set the attribute the semantic conventions require.

Without propagation the trace restarts at the server: the tool call is no longer linked to the agent that triggered it. That is the blind spot in agent observability.

mcp-opentelemetry does two things for the TypeScript SDK 2.x: it propagates W3C Trace Context through params._meta, injected on the client and extracted on the server; it opens a client span and a server span, named and attributed as the convention asks.

The official conformance suite returns 50 identical scenarios, with and without instrumentation.

npmjs.com/package/mcp-opentelemetry

If you trace your servers another way, just say so.

#MCP #OpenTelemetry
```

## Notes de rédaction

- Le lien s'écrit sans `https://` ni `www.` : la règle D8 du contrôleur refuse toute URL complète dans un texte sortant de premier contact. La forme courte reste cliquable sur LinkedIn.
- Deux hashtags, pas plus. Aucune tournure de crochet. Aucun tiret cadratin.
- Le chiffre sort toujours dans la même respiration que son origine : « 50 scénarios identiques, avec et sans instrumentation » se vérifie dans `test/integration/results/conformance/comparison.md`.
- Ce qui n'est pas dit et ne doit pas être ajouté : le paquet ne trace aucune notification et n'émet aucune métrique. Si un commentaire le demande, la réponse est dans le README, section « Known limits ».

## Verdict du contrôleur

Commande exécutée le 06/09/2026, depuis `/Users/amirkellousidhoum/Desktop/Code` :

    python3 recherche/outils/verifier-message.py .../docs/POST-LINKEDIN.md --type message --stade premier --canal fr

Sortie :

    bloc 1 (847 car.) : PRÊT
    bloc 2 (858 car.) : PRÊT

Code de sortie 0, aucune erreur, aucun avertissement. Le contrôleur ne lit que les blocs entre triples accents graves : ce fichier n'en contient que deux, les deux textes à envoyer, pour que le verdict reste lisible.

Deux corrections ont été nécessaires avant ce verdict : le lien écrit sans schéma ni `www.` (règle D8, qui refuse toute URL complète dans un texte de premier contact), et le mot `attached` remplacé par `linked` dans le bloc anglais, `attached` étant lui aussi refusé par D8.

---

<sub>Post LinkedIn · mcp-opentelemetry 0.1.0 · 06/09/2026 · personne ne l'envoie depuis ce dépôt ; le dossier de prospection publie.</sub>
