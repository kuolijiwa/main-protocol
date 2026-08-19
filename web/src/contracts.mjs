export function resolveContractBinding(key, addresses, abis) {
  const addressKey = addresses[key] ? key : `${key}Proxy`;
  const abiKey = abis[key] ? key : key.replace(/Proxy$/, "");
  return {
    addressKey,
    abiKey,
    address: addresses[addressKey],
    abi: abis[abiKey],
  };
}
