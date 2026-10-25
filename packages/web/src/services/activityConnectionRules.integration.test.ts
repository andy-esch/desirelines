/** Credential and registry rules are exercised through the real client SDK. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { initializeApp, deleteApp } from "firebase/app";
import { connectAuthEmulator, getAuth, signInAnonymously } from "firebase/auth";
import { connectFirestoreEmulator, doc, getDoc, getFirestore, setDoc } from "firebase/firestore";

const app = initializeApp({ projectId: "demo-test-project", apiKey: "fake-key" }, "registry-rules");
const auth = getAuth(app);
const db = getFirestore(app);
connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
connectFirestoreEmulator(db, "127.0.0.1", 8080);
let uid: string;

async function seed(path: string) {
  const response = await fetch(
    `http://127.0.0.1:8080/v1/projects/demo-test-project/databases/(default)/documents/${path}`,
    {
      method: "PATCH",
      headers: { Authorization: "Bearer owner", "Content-Type": "application/json" },
      body: JSON.stringify({ fields: { marker: { stringValue: "rules-canary" } } }),
    }
  );
  expect(response.ok).toBe(true);
}

beforeAll(async () => {
  uid = (await signInAnonymously(auth)).user.uid;
  await seed(`users/${uid}/private/strava_tokens`);
  await seed(`users/${uid}/private/profile`);
  await seed(`users/${uid}/connections/strava`);
  await seed("provider_accounts/strava:123");
});
afterAll(async () => {
  await deleteApp(app);
});

describe("server-owned identity records", () => {
  it("denies owner credential access despite a valid Firebase session", async () => {
    const tokens = doc(db, `users/${uid}/private/strava_tokens`);
    await expect(getDoc(tokens)).rejects.toMatchObject({ code: "permission-denied" });
    await expect(setDoc(tokens, { access_token: "attacker-token" })).rejects.toMatchObject({
      code: "permission-denied",
    });
  });

  it("preserves owner profile reads but rejects forged provider ownership", async () => {
    const profile = doc(db, `users/${uid}/private/profile`);
    expect((await getDoc(profile)).data()?.marker).toBe("rules-canary");
    await expect(setDoc(profile, { strava_athlete_id: 999 })).rejects.toMatchObject({
      code: "permission-denied",
    });
    await expect(getDoc(doc(db, "users/someone-else/private/profile"))).rejects.toMatchObject({
      code: "permission-denied",
    });
  });

  it.each([
    "provider_accounts/strava:123",
    "identity_migration/legacy_admissions",
    "invitations/pending",
  ])("denies read/write at %s", async (path) => {
    await expect(getDoc(doc(db, path))).rejects.toMatchObject({ code: "permission-denied" });
    await expect(setDoc(doc(db, path), { uid })).rejects.toMatchObject({
      code: "permission-denied",
    });
  });

  it("keeps the initial connection record server-only", async () => {
    const connection = doc(db, `users/${uid}/connections/strava`);
    await expect(getDoc(connection)).rejects.toMatchObject({ code: "permission-denied" });
    await expect(setDoc(connection, { subject: "999" })).rejects.toMatchObject({
      code: "permission-denied",
    });
  });

  it("preserves legitimate config access while rejecting cross-user writes", async () => {
    const config = doc(db, `users/${uid}/config/v1`);
    await setDoc(config, { schemaVersion: 1, userId: uid, lastUpdated: "2026-10-25" });
    expect((await getDoc(config)).data()?.userId).toBe(uid);
    await expect(
      setDoc(doc(db, "users/someone-else/config/v1"), { userId: uid })
    ).rejects.toMatchObject({ code: "permission-denied" });
  });
});
