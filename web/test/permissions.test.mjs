import test from "node:test";
import assert from "node:assert/strict";
import { capabilitiesForRoles } from "../src/permissions.mjs";

test("public users can browse but cannot operate privileged modules", () => {
  const permissions = capabilitiesForRoles();
  assert.equal(permissions.browse, true);
  assert.equal(permissions.buy, false);
  assert.equal(permissions.register, false);
  assert.equal(permissions.challenge, false);
  assert.equal(permissions.timelock, false);
  assert.equal(permissions.treasury, false);
});

test("contributor and operator capabilities are separated", () => {
  const contributor = capabilitiesForRoles({ connected: true, contributor: true });
  const operator = capabilitiesForRoles({ connected: true, operator: true });
  assert.equal(contributor.manageListings, true);
  assert.equal(operator.manageListings, false);
  assert.equal(contributor.register, true);
  assert.equal(operator.register, true);
});

test("admin and timelock permissions are additive", () => {
  const permissions = capabilitiesForRoles({ connected: true, admin: true, proposer: true });
  assert.equal(permissions.challenge, true);
  assert.equal(permissions.pause, true);
  assert.equal(permissions.roles, true);
  assert.equal(permissions.timelock, true);
});

test("treasury capability is isolated to the configured treasury wallet", () => {
  const permissions = capabilitiesForRoles({ connected: true, treasury: true });
  assert.equal(permissions.treasury, true);
  assert.equal(permissions.admin, false);
  assert.equal(permissions.timelock, false);
});

test("Safe owners get Safe relay capabilities without being direct protocol roles", () => {
  const permissions = capabilitiesForRoles({ connected: true, safeOwner: true });
  assert.equal(permissions.safeAdmin, true);
  assert.equal(permissions.safeTimelock, true);
  assert.equal(permissions.admin, true);
  assert.equal(permissions.timelock, true);
});
