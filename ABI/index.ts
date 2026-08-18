import contributorRegistryAbi from "./ContributorRegistry.abi.json" with { type: "json" };
import protocolConfigAbi from "./ProtocolConfig.abi.json" with { type: "json" };
import datasetRegistryAbi from "./DatasetRegistry.abi.json" with { type: "json" };
import entitlementNFTAbi from "./EntitlementNFT.abi.json" with { type: "json" };
import marketplaceAbi from "./Marketplace.abi.json" with { type: "json" };
import revenueSplitterAbi from "./RevenueSplitter.abi.json" with { type: "json" };
import protocolTimelockAbi from "./ProtocolTimelock.abi.json" with { type: "json" };
import paymentTokenAbi from "./PaymentTokenERC20.abi.json" with { type: "json" };

export { contributorRegistryAbi };
export { protocolConfigAbi };
export { datasetRegistryAbi };
export { entitlementNFTAbi };
export { marketplaceAbi };
export { revenueSplitterAbi };
export { protocolTimelockAbi };
export { paymentTokenAbi };

export const mainProtocolAbis = {
  contributorRegistry: contributorRegistryAbi,
  protocolConfig: protocolConfigAbi,
  datasetRegistry: datasetRegistryAbi,
  entitlementNFT: entitlementNFTAbi,
  marketplace: marketplaceAbi,
  revenueSplitter: revenueSplitterAbi,
  protocolTimelock: protocolTimelockAbi,
  paymentToken: paymentTokenAbi,
} as const;
