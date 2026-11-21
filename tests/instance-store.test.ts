import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { openInstance } from "../runtime/src/instances/store.js";

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const instancesRoot = join(repositoryRoot, "instances");

async function writeManifest(
  root: string,
  companyId: string,
  manifest: unknown = {
    company_id: companyId,
    core_version: "0.1.0",
    assets: [],
  },
): Promise<string> {
  const companyRoot = join(root, companyId);
  await mkdir(companyRoot, { recursive: true });
  await writeFile(join(companyRoot, "instance.yaml"), JSON.stringify(manifest));
  return companyRoot;
}

test("openInstance rejects a company id that traverses outside the configured root", async () => {
  await assert.rejects(() => openInstance(instancesRoot, "../other-company"));
});

test("resolve rejects a reference prefixed for another company", async () => {
  const store = await openInstance(instancesRoot, "example-company");

  await assert.rejects(async () =>
    store.resolve("company-b:styles/default/profile.json"),
  );
});

test("resolve returns a path scoped to the opened company", async () => {
  const store = await openInstance(instancesRoot, "example-company");

  assert.match(
    store.resolve("styles/default/profile.json"),
    /example-company[\\/]styles[\\/]default[\\/]profile\.json$/,
  );
});

test("resolve rejects lexical traversal outside the company root", async () => {
  const store = await openInstance(instancesRoot, "example-company");

  assert.throws(() => store.resolve("../other-company/instance.yaml"));
  assert.throws(() => store.resolve("styles\\..\\..\\other-company\\instance.yaml"));
});

test("resolve rejects a missing asset that cannot be canonically contained", async () => {
  const store = await openInstance(instancesRoot, "example-company");

  assert.throws(() => store.resolve("styles/default/missing.json"));
});

test("resolve rejects an existing link whose canonical target is outside the company root", async (t) => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "instance-store-"));
  t.after(() => rm(fixtureRoot, { recursive: true, force: true }));
  const companyRoot = await writeManifest(fixtureRoot, "company-a");
  const outsideRoot = join(fixtureRoot, "outside");
  await mkdir(outsideRoot);
  await writeFile(join(outsideRoot, "secret.json"), "{}");
  await symlink(outsideRoot, join(companyRoot, "linked"), "junction");
  const store = await openInstance(fixtureRoot, "company-a");

  assert.throws(() => store.resolve("linked/secret.json"));
});

test("openInstance rejects a missing manifest", async (t) => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "instance-store-"));
  t.after(() => rm(fixtureRoot, { recursive: true, force: true }));
  await mkdir(join(fixtureRoot, "company-a"));

  await assert.rejects(() => openInstance(fixtureRoot, "company-a"));
});

test("openInstance validates the manifest contract", async (t) => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "instance-store-"));
  t.after(() => rm(fixtureRoot, { recursive: true, force: true }));
  await writeManifest(fixtureRoot, "company-a", { company_id: "company-a" });

  await assert.rejects(() => openInstance(fixtureRoot, "company-a"));
});

test("openInstance rejects a manifest belonging to another company", async (t) => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "instance-store-"));
  t.after(() => rm(fixtureRoot, { recursive: true, force: true }));
  await writeManifest(fixtureRoot, "company-a", {
    company_id: "company-b",
    core_version: "0.1.0",
    assets: [],
  });

  await assert.rejects(() => openInstance(fixtureRoot, "company-a"));
});

test("openInstance rejects a company directory aliased to another instance path", async (t) => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "instance-store-"));
  t.after(() => rm(fixtureRoot, { recursive: true, force: true }));
  const otherCompanyRoot = await writeManifest(fixtureRoot, "company-b", {
    company_id: "company-a",
    core_version: "0.1.0",
    assets: [],
  });
  await symlink(otherCompanyRoot, join(fixtureRoot, "company-a"), "junction");

  await assert.rejects(() => openInstance(fixtureRoot, "company-a"));
});

test("openInstance rejects a manifest symlinked outside the company root", async (t) => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "instance-store-"));
  t.after(() => rm(fixtureRoot, { recursive: true, force: true }));
  const companyRoot = await writeManifest(fixtureRoot, "company-a");
  const outsideManifest = join(fixtureRoot, "outside-instance.yaml");
  await writeFile(
    outsideManifest,
    JSON.stringify({
      company_id: "company-a",
      core_version: "0.1.0",
      assets: [],
    }),
  );
  await unlink(join(companyRoot, "instance.yaml"));
  try {
    await symlink(outsideManifest, join(companyRoot, "instance.yaml"), "file");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EPERM") {
      t.skip("file symlinks are not permitted on this Windows host");
      return;
    }
    throw error;
  }

  await assert.rejects(() => openInstance(fixtureRoot, "company-a"));
});

test("resolve rejects a dangling junction that can later expose an outside file", async (t) => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "instance-store-"));
  t.after(() => rm(fixtureRoot, { recursive: true, force: true }));
  const companyRoot = await writeManifest(fixtureRoot, "company-a");
  const futureOutsideRoot = join(fixtureRoot, "future-outside");
  await symlink(futureOutsideRoot, join(companyRoot, "linked"), "junction");
  const store = await openInstance(fixtureRoot, "company-a");

  assert.throws(() => store.resolve("linked/secret.txt"));

  await mkdir(futureOutsideRoot);
  await writeFile(join(futureOutsideRoot, "secret.txt"), "outside-secret");

  assert.throws(() => store.resolve("linked/secret.txt"));
});
