# Firebase emulator container

Runs the Firebase Auth + Firestore emulators in one container. Used for local
development (via docker-compose) and for the `firestore-integration-tests` job in
`.github/workflows/ci.yml`.

## Files

| File | Purpose |
|---|---|
| `Dockerfile` | Image: `firebase-tools` + JRE. `WORKDIR /app`, copies a default config to `/app/firebase.json`. |
| `firebase-emulators.json` | **Dev** config. UI enabled, **no `firestore.rules`** — runs open for convenience. Baked into the image by the Dockerfile. |
| `ci-firebase.json` | **CI** config. UI disabled and **loads `firestore.rules`** so the web client-SDK security tests run against real rules. Mounted over `/app/firebase.json` at runtime (not baked in). |

The two configs intentionally diverge — dev runs open + UI; CI enforces rules +
headless. Don't "consolidate" them.

## The mount contract (why `rules` is a bare filename)

`ci-firebase.json` sets `"firestore": { "rules": "firestore.rules" }` — a bare
filename, **not** a repo-relative path like `../../../firestore.rules`.

Firebase resolves a relative `rules` path relative to the **directory the config
file resides in at runtime**. In CI we don't run Firebase from the repo tree; we
mount both files into `/app`:

```sh
docker run ... \
  -v "$REPO/firestore.rules:/app/firestore.rules:ro" \
  -v "$REPO/local-dev/containers/firebase-emulators/ci-firebase.json:/app/firebase.json:ro" \
  firebase-emulators:ci \
  firebase emulators:start --only auth,firestore --project demo-test-project
```

So at runtime the config lives at `/app/firebase.json` and `firestore.rules`
resolves to `/app/firestore.rules` — exactly where the rules file is mounted.
A repo-relative path would resolve to `/firestore.rules` inside the container and
the emulator would fail to load rules. **Keep it a bare filename.**

## Two more runtime requirements (see the CI job for the full context)

- Start with `--project demo-test-project` — the web client
  (`packages/web/src/test/integration-setup.ts`) hardcodes that project ID, and
  auth tokens won't validate against the rules context otherwise.
- Publish Firestore on host port `8080` and Auth on `9099` — the web setup
  hardcodes those ports (it does not read `FIRESTORE_EMULATOR_HOST`).
