export const CAPABILITIES = Object.freeze([
  "browse",
  "buy",
  "register",
  "manageListings",
  "claim",
  "admin",
  "challenge",
  "pause",
  "roles",
  "timelock",
  "treasury",
  "safeAdmin",
  "safeTimelock",
]);

export function capabilitiesForRoles({
  connected = false,
  contributor = false,
  operator = false,
  admin = false,
  proposer = false,
  executor = false,
  treasury = false,
  safeOwner = false,
} = {}) {
  const result = new Set(["browse"]);
  if (connected) result.add("buy").add("claim");
  if (contributor) result.add("register").add("manageListings");
  if (operator) result.add("register");
  if (admin) result.add("admin").add("challenge").add("pause").add("roles");
  if (proposer || executor) result.add("timelock");
  if (treasury) result.add("treasury");
  if (safeOwner)
    result
      .add("safeAdmin")
      .add("safeTimelock")
      .add("admin")
      .add("challenge")
      .add("pause")
      .add("roles")
      .add("timelock");
  return Object.fromEntries(CAPABILITIES.map((capability) => [capability, result.has(capability)]));
}

export function canOperate(capabilities, capability) {
  return Boolean(capabilities?.[capability]);
}
