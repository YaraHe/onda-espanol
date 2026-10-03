// Run locally after two distinct test accounts have confirmed their email.
// Credentials are entered in this terminal, never written to disk or printed.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const envPath = fileURLToPath(new URL("../.env.local", import.meta.url));
const settings = Object.fromEntries(
  readFileSync(envPath, "utf8")
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => {
      const separator = line.indexOf("=");
      return [line.slice(0, separator), line.slice(separator + 1).trim().replace(/^["']|["']$/g, "")];
    }),
);
const url = settings.NEXT_PUBLIC_SUPABASE_URL;
const key = settings.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
assert.ok(url && key, "Missing public Supabase configuration in web/.env.local");
assert.ok(process.stdin.isTTY && process.stdout.isTTY, "Run this script in an interactive terminal");

function promptHidden(label) {
  return new Promise((resolve, reject) => {
    let value = "";
    const priorRawMode = process.stdin.isRaw;
    process.stdout.write(`${label}: `);
    process.stdin.setRawMode(true);
    process.stdin.resume();

    function finish(error) {
      process.stdin.off("data", onData);
      process.stdin.setRawMode(priorRawMode);
      process.stdin.pause();
      process.stdout.write("\n");
      if (error) reject(error);
      else resolve(value);
    }

    function onData(bytes) {
      for (const character of bytes.toString("utf8")) {
        if (character === "\r" || character === "\n") return finish();
        if (character === "\u0003") return finish(new Error("Cancelled"));
        if (character === "\u007f" || character === "\b") {
          if (value.length) {
            value = value.slice(0, -1);
            process.stdout.write("\b \b");
          }
        } else {
          value += character;
          process.stdout.write("*");
        }
      }
    }

    process.stdin.on("data", onData);
  });
}

function client() {
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}

function passed(label) {
  console.log(`PASS ${label}`);
}

async function signIn(supabase, label) {
  const email = (await promptHidden(`${label} email`)).trim();
  const password = await promptHidden(`${label} password`);
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  assert.ifError(error);
  assert.ok(data.user && data.session, `${label} did not receive a session`);
  passed(`${label} email login`);
  return data.user;
}

async function ownProfile(supabase, userId, label) {
  const { data, error } = await supabase.from("profiles").select("id,nickname").eq("id", userId).single();
  assert.ifError(error);
  assert.equal(data.id, userId);
  assert.ok(data.nickname, `${label} profile nickname is missing`);
  passed(`${label} own profile`);
}

async function ownSettings(supabase, userId, label) {
  const { data: existing, error: readError } = await supabase.from("user_settings").select("user_id,lang").eq("user_id", userId).maybeSingle();
  assert.ifError(readError);
  if (!existing) {
    const { error: insertError } = await supabase.from("user_settings").insert({ user_id: userId, lang: "es-ES" });
    assert.ifError(insertError);
  }
  const { data, error } = await supabase.from("user_settings").select("user_id,lang").eq("user_id", userId).single();
  assert.ifError(error);
  assert.equal(data.user_id, userId);
  passed(`${label} own settings`);
}

async function insertTestRecord(supabase, userId, marker) {
  const { data, error } = await supabase.from("practice_records")
    .insert({ user_id: userId, sentence: marker })
    .select("id,user_id")
    .single();
  assert.ifError(error);
  assert.equal(data.user_id, userId);
  return data.id;
}

async function cannotSeeOtherUser(supabase, otherId, otherRecordId, label) {
  for (const [table, column, value] of [
    ["profiles", "id", otherId],
    ["user_settings", "user_id", otherId],
    ["practice_records", "id", otherRecordId],
  ]) {
    const { data, error } = await supabase.from(table).select("*").eq(column, value);
    assert.ifError(error);
    assert.deepEqual(data, [], `${label} could read another user's ${table}`);
  }
  passed(`${label} cannot read other user's three tables`);
}

async function removeTestRecord(supabase, recordId, label) {
  const { data, error } = await supabase.from("practice_records").delete().eq("id", recordId).select("id");
  assert.ifError(error);
  assert.equal(data.length, 1);
  passed(`${label} test record removed`);
}

const accountA = client();
const accountB = client();
const anonymous = client();
let recordA;
let recordB;

try {
  for (const table of ["profiles", "practice_records", "user_settings"]) {
    const { data, error } = await anonymous.from(table).select("*").limit(1);
    assert.ok(error, `Anonymous request unexpectedly accessed ${table}: ${JSON.stringify(data)}`);
  }
  passed("anonymous access denied on all three tables");

  const userA = await signIn(accountA, "A");
  await ownProfile(accountA, userA.id, "A");
  await ownSettings(accountA, userA.id, "A");
  recordA = await insertTestRecord(accountA, userA.id, `__task3_rls_A_${randomUUID()}`);
  passed("A own practice record insert");

  const { error: signOutAError } = await accountA.auth.signOut();
  assert.ifError(signOutAError);
  const { data: { session: afterSignOutA } } = await accountA.auth.getSession();
  assert.equal(afterSignOutA, null);
  passed("A sign out clears session");

  const userB = await signIn(accountB, "B");
  assert.notEqual(userA.id, userB.id, "A and B must be different accounts");
  await ownProfile(accountB, userB.id, "B");
  await ownSettings(accountB, userB.id, "B");
  await cannotSeeOtherUser(accountB, userA.id, recordA, "B");

  const { error: forbiddenInsert } = await accountB.from("practice_records")
    .insert({ user_id: userA.id, sentence: `__task3_forbidden_${randomUUID()}` });
  assert.ok(forbiddenInsert, "B inserted a record owned by A");
  passed("B cannot insert A's practice record");

  const { data: forbiddenUpdate, error: forbiddenUpdateError } = await accountB.from("user_settings")
    .update({ lang: "es-MX" }).eq("user_id", userA.id).select("user_id");
  assert.ifError(forbiddenUpdateError);
  assert.deepEqual(forbiddenUpdate, []);
  passed("B cannot update A's settings");

  recordB = await insertTestRecord(accountB, userB.id, `__task3_rls_B_${randomUUID()}`);
  passed("B own practice record insert");

  const { error: reSignInAError, data: reSignInA } = await accountA.auth.signInWithPassword({
    email: (await promptHidden("A email for re-login")).trim(),
    password: await promptHidden("A password for re-login"),
  });
  assert.ifError(reSignInAError);
  assert.equal(reSignInA.user?.id, userA.id);
  assert.ok(reSignInA.session);
  passed("A re-login after sign out");
  await cannotSeeOtherUser(accountA, userB.id, recordB, "A");

  await removeTestRecord(accountA, recordA, "A");
  recordA = undefined;
  await removeTestRecord(accountB, recordB, "B");
  recordB = undefined;
  await accountA.auth.signOut();
  await accountB.auth.signOut();
  passed("Task 3 two-user RLS verification complete");
} catch (error) {
  console.error(`FAIL ${error instanceof Error ? error.message : String(error)}`);
  if (recordA || recordB) console.error("A temporary practice record may remain; report this before re-running.");
  process.exitCode = 1;
}
