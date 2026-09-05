# examples/http : ce qui change par rapport a l everything-server de reference

`examples/http/server.ts` reprend le serveur de reference du depot
`modelcontextprotocol/conformance`
(`examples/servers/typescript/everything-server.ts`). Celui-ci cible
`@modelcontextprotocol/sdk@^1.29.0` avec Express ; ce depot utilise le SDK v2
(`@modelcontextprotocol/{core,client,server,node}@2.0.0`) et `node:http`. Les
adaptations sont les suivantes.

| Reference v1 | Ici, SDK 2.0.0 | Pourquoi |
| --- | --- | --- |
| `createMcpExpressApp` + `StreamableHTTPServerTransport` par session, plus un pont `InMemoryTransport` pour servir le sans-etat | `createMcpHandler(factory)` + `toNodeHandler` | Le SDK v2 sert nativement la revision 2026-07-28 sans etat : une instance par requete, construite par la fabrique. Le pont en memoire de la reference n existe plus. |
| `cors` + Express | Gardes `localhostHostValidation()` / `localhostOriginValidation()` de `@modelcontextprotocol/node` | `node:http` n a pas de chaine de middlewares : chaque garde repond elle-meme et renvoie `false` quand il ne faut plus traiter la requete. |
| Enrobage de `setRequestHandler` pour ajouter `ttlMs` / `cacheScope` aux resultats de liste | Option `ServerOptions.cacheHints` et `registerResource(..., { cacheHint })` | SEP-2549 est une option declarative dans le SDK v2. |
| HMAC maison (`signMrtState` / `verifyMrtState`) pour le `requestState` | `createRequestStateCodec` + `ServerOptions.requestState.verify` | Le SDK v2 fournit le codec HMAC et le crochet de verification ; un etat trafique produit le `-32602` fige attendu par `input-required-result-tampered-state`. |
| Resultats `InputRequiredResult` ecrits a la main | `inputRequired(...)`, `inputRequired.elicit/createMessage/listRoots`, `acceptedContent`, `inputResponse` | Le multi-aller-retour (SEP-2322) est natif dans le SDK v2. |
| `sendNotification({ method: 'notifications/progress', ... })` depuis `extra` | `ctx.mcpReq.notify(...)` et `ctx.mcpReq.log(...)` | Le contexte de handler a change de forme entre v1 et v2. |
| `test_missing_capability` leve une erreur | `test_missing_capability` renvoie `inputRequired({ inputRequests: { ...createMessage } })` | Dans le SDK v2 une erreur levee dans un callback d outil devient un resultat `isError`, jamais une erreur JSON-RPC. Le `-32021` ne peut donc venir que du controle de capacites du seam `input_required`, qui compare chaque requete embarquee aux capacites declarees dans l enveloppe `_meta` de la requete. |
| `completions: {}` declare dans les capacites | En plus, un argument `completable(...)` sur `test_prompt_with_arguments` | `McpServer` v2 n installe le handler `completion/complete` que si au moins un argument enregistre est completable. Declarer la capacite seule laisse la methode repondre `-32601`. |
| Prompts enregistres sans `argsSchema` | `test_input_required_result_prompt` garde le callback `(ctx)` du runtime et passe la surcharge par un `as never` | Le generique `Args` de `registerPrompt` n a pas de defaut `undefined` : sans `argsSchema` le typage annonce `(args, ctx)` alors que le runtime appelle `(ctx)`. Declarer un `z.object({})` refuserait un `prompts/get` sans `arguments`, ce que le scenario envoie. |

Outils, ressources et prompts non repris, tous hors du jeu note pour
`2026-07-28` :

- `json_schema_2020_12_tool` (scenario `json-schema-2020-12`, marque `pending`).
- Les outils annotes `x-mcp-header` de SEP-2243 (scenario
  `http-custom-header-server-validation`, marque `pending`).
- Toute la famille `tasks/*` de SEP-2663 (`greet`, `slow_compute`,
  `failing_job`, `confirm_delete`, ...), marquee `extension`.
- `test_reconnection` (SEP-1699), `test_sampling`, `test_elicitation` : hors du
  jeu note 2026-07-28, ou remplaces par le multi-aller-retour.
