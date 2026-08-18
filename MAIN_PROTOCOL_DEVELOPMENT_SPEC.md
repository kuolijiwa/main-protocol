# Main Protocol Development Specification

## Status and source of truth

- Status: V1 fixed-price Main Protocol core contracts are implemented; deployment to a persistent network and external audit remain pending.
- Target stack: Solidity contracts developed and tested with Hardhat.
- Source of truth: `protocol_technical_design.md` in this directory. Source rules are preserved unless a rule is explicitly superseded by a confirmed V1 decision below. Deferred source features are identified as such and must not be implemented accidentally.
- Target environment: EVM L2 (Base, Arbitrum, or OP). Heavy computation and data stay off-chain; the chain records commitments, rights, and settlement.

### Implementation verification status

| Module | Status | Automated tests |
| --- | --- | ---: |
| `ContributorRegistry` | Implemented and passing | 10 |
| `ProtocolConfig` | Implemented and passing | 11 |
| `DatasetRegistry` | Implemented and passing | 21 |
| `EntitlementNFT` | Implemented and passing | 11 |
| `RevenueSplitter` | Implemented, UUPS-tested, and passing | 14 |
| `Marketplace` | Implemented, UUPS/integration-tested, and passing | 15 |
| `ProtocolTimelock` | Implemented, delay/role/execution-tested, and passing | 4 |
| Artifact/deferred-scope assertions | Passing | 2 |
| **Total** | **Full regression passing** | **88** |

The deployment and post-deployment verification scripts are implemented and TypeScript-checked. Hardhat compilation, formatting, Solidity lint, coverage, gas reporting, and the 88-test regression suite pass. Slither 0.11.5 completes with no high-severity finding; reviewed non-high findings are recorded in `security/SLITHER_REVIEW.md`. Within the confirmed V1 decisions and explicitly deferred scope, the current source has no known mismatch with this development specification. A real persistent-network deployment, production multisig wiring transactions, and an independent smart-contract audit remain release gates.

## Confirmed V1 decisions

The following choices resolve the source document's open questions or implementation gaps. They are product decisions for this build, not claims that the source document already fixed every detail.

| Topic | Confirmed V1 decision |
| --- | --- |
| Weight immutability | Weights are locked at `registerDataset`. `weightsRoot` and `totalWeight` cannot be edited afterwards; a re-split requires a new Dataset version. |
| Copy-license transferability | Copy licenses are non-transferable. `EntitlementNFT` must reject ERC-1155 transfers of `tokenId(datasetId, Copy)`. |
| Exclusive-title transferability | Exclusive titles use standard ERC-1155 transfer behavior. This is distinct from the Copy-license decision. |
| Exclusive secondary transfers | A standard ERC-1155 Exclusive transfer does not collect payment, protocol fees, royalties, or sub-contributor revenue. A protocol-managed secondary marketplace is outside V1. |
| Pricing scope | V1 supports fixed-price listings only. The contributor sets the price when creating a Copy listing with `listCopy(datasetId, price)` or an Exclusive listing with `listExclusiveFixed(datasetId, price)`. An active listing's price is immutable; changing it requires delisting and creating a new fixed-price listing. |
| Nurture raw-data weight | The Batch Pipeline determines Nurture's raw-data weight under a versioned governance policy, includes Nurture as a Merkle leaf, publishes the leaves, and locks the resulting root at registration. The Main Protocol contains no fixed raw-data-weight ratio. |
| Challenge window | `ProtocolConfig` provides a configurable `challengeWindow`; V1 does not hard-code a duration. Listings may be created for public review during the window, but purchases and claims are blocked. Anyone may submit evidence off-chain; the ADMIN multisig records and resolves a timely challenge on-chain. An upheld challenge permanently invalidates that Dataset's weights and blocks its listing, purchase, and claim paths. The corrected allocation must be registered as a normal new Dataset. No revenue migration, refund, challenge bond, or on-chain adjudication contract is needed because sales cannot occur before the challenge window closes. |
| Registration attribution | A CONTRIBUTOR registers for itself. An OPERATOR registers only for the single allowlisted contributor assigned to it in `ContributorRegistry`; `RegisterParams` is not changed to add a contributor argument. |
| Registration validation | Hash/root must be nonzero, sample/payload URIs non-empty, `totalWeight > 0`, at least one sale kind enabled, and `policy.licensesTransferable == false`. Leaf uniqueness and exact weight sum are pipeline/public-audit invariants because leaves are off-chain. |
| Dataset IDs and unknown records | Dataset IDs are sequential and start at `1`; `0` is invalid. `getDataset` and all state-changing calls revert for an unknown ID, while `priceOf`, `claimable`, and `hasAccess` return `0`, `0`, and `false`. |
| Dataset lifecycle | Registration starts at `Draft`; the first listing changes it to `Listed`; removing the last listing changes it to `Delisted`; Exclusive purchase is terminal `ExclusivelySold`; an upheld challenge sets `Delisted` plus a permanent weight-invalidated flag. |
| Duplicate Copy purchase | A wallet that already has a Copy-token balance for the Dataset cannot buy the same Copy license again. Copy supply remains unlimited across distinct buyer addresses. |
| True-exclusive listing | When `exclusiveRequiresZeroCopies == true`, an Exclusive listing cannot be created after any Copy sale. The first Copy sale automatically deactivates an already-active Exclusive listing so an ineligible offer is not left visible. |
| Claim event | A successful `RevenueSplitter.claim` emits `RevenueClaimed(datasetId, msg.sender, owed)`. |
| `hasAccess` ownership | `EntitlementNFT` exposes `hasAccess(uint256 datasetId, address who)`. It may read Dataset state through `DatasetRegistry`. |
| Access after an Exclusive sale | After `ExclusivelySold`, only the Exclusive-token holder passes `hasAccess`. Prior Copy holders keep any bytes already delivered, but the Gateway no longer provides re-download or key delivery to them. |
| Payment token | V1 uses one immutable payment-token address fixed at deployment. Replacing the token requires a new deployment/upgrade and migration plan; an ADMIN config change cannot switch the token under active listings. |
| Payment-token behavior | V1 supports a standard exact-transfer ERC-20 stablecoin only. Fee-on-transfer, rebasing, and callback-bearing token behaviors are unsupported. |
| Gateway signer config | `gatewaySigner` stores only the Gateway's public signer address/identity. No private key or decryption key is ever stored on-chain, and this signer cannot mint entitlements or override `hasAccess`. |
| Division dust | Integer-division dust remains in `RevenueSplitter` in V1. It has no ADMIN sweep path and remains available to future claims as cumulative revenue grows. |
| KYC hook | Buyers are permissionless in V1. The source document's optional KYC hook is deferred and must not be added without a new product decision. |
| Pause behavior | Pause stops registration, listing/relisting, purchases, and claims. Reads, `claimable`, delisting, challenge recording/resolution, treasury withdrawal, and pause recovery remain available. |
| Pending-challenge liveness | A Pending challenge has no automatic timeout in V1; it fails closed until ADMIN resolves it. The ADMIN multisig must operate a published resolution SLA. |
| Dependency wiring | Non-upgradeable contracts and `RevenueSplitter` receive the Marketplace proxy through an ADMIN-only `setMarketplaceOnce` operation. It rejects zero and cannot be repeated. Registration and market operations remain disabled until wiring is complete. |
| Governance delay | Production config changes and UUPS upgrades use the non-upgradeable `ProtocolTimelock`, an OpenZeppelin `TimelockController` with a fixed 48-hour minimum delay. The operational multisig is proposer, executor, and canceller; the Timelock is self-administered and is the core contracts' `DEFAULT_ADMIN_ROLE` holder. Emergency pause and challenge operations remain immediate multisig actions through `ADMIN_ROLE`. |
| Upgradeability | Only `Marketplace` and `RevenueSplitter` use UUPS proxies. `ContributorRegistry`, `DatasetRegistry`, `EntitlementNFT`, `ProtocolConfig`, and the governance-infrastructure `ProtocolTimelock` are non-upgradeable V1 contracts; mutable configuration and role management occur through their documented state and roles. |

## Scope

The Main Protocol is the data marketplace and settlement layer. It registers datasets, stores data pointers and integrity commitments, sells copy licenses or exclusive rights, and distributes revenue to Merkle-identified sub-contributors.

### In scope

- Dataset registration and Dataset records.
- Public sample and encrypted-payload pointers.
- Copy and Exclusive sales.
- Fixed-price Copy and Exclusive listings.
- ERC-1155 entitlements.
- Per-dataset revenue accrual and Merkle-proof pull claims.
- Access Gateway integration through an on-chain `hasAccess` view.
- Main Protocol events consumed by the off-chain pipeline and users.

### Out of scope for the current build

- `Crowdsourcing Protocol` contract.
- `AuctionHouse`, `IAuctionHouse`, `listExclusiveAuction`, `bid`, `settle`, auction escrow/refunds, and anti-snipe behavior. These source-document features are deferred beyond V1.
- Arcade submissions, epochs, commit-reveal, honeypots, consensus, and label scoring.
- The off-chain Batch Pipeline, including weight calculation, data packaging, encryption, and leaf publication.
- The `Access Gateway` service implementation. It is part of the overall protocol but is not a Solidity contract.

The Crowdsourcing Protocol and the Main Protocol do not call each other directly. The Batch Pipeline bridges them off-chain: it computes weights, calls `registerDataset` on Main Protocol, and later calls `anchorPackaging` on Crowdsourcing Protocol. `anchorPackaging` is not part of this build.

## Required contract names and responsibilities

| Name | Required responsibility |
| --- | --- |
| `ContributorRegistry` | Allowlist and roles: admin, operator/pipeline, contributor. Gates `registerDataset` during the clean start and maps each operator to the contributor it may represent. |
| `DatasetRegistry` | Creates and stores `Dataset` records; holds sample/payload pointers, content hash, weights root, per-Dataset challenge deadline/status, and permanent weight-invalidation state. |
| `Marketplace` | Listings, `buyCopy`, `buyExclusive`, exclusivity state machine, fee handling, and settlement calls. |
| `EntitlementNFT` | ERC-1155 copy licenses and exclusive titles; supplies the `hasAccess()` view used by the gateway. |
| `RevenueSplitter` | Per-dataset revenue accrual and Merkle-proof claims by sub-contributors. |
| `ProtocolConfig` | Immutable payment token; configurable fee bps, treasury, challenge window, pause switch, and gateway signer key. |
| `ProtocolTimelock` | Production governance infrastructure implementing the confirmed fixed 48-hour delay for configuration and UUPS upgrade authority. This is an additive deployment contract, not a new marketplace business module. |
| `Access Gateway` | Off-chain service that verifies entitlement and delivers the decryption key/data. Not a contract. |

The current contract and interface names above must be preserved. Required V1 interface names are `IDatasetRegistry`, `IMarketplace`, and `IRevenueSplitter`.

### Registry and configuration APIs

`ContributorRegistry` uses OpenZeppelin `AccessControl` and exposes these role identifiers:

```solidity
bytes32 public constant ADMIN_ROLE       = keccak256("ADMIN");
bytes32 public constant OPERATOR_ROLE    = keccak256("OPERATOR");
bytes32 public constant CONTRIBUTOR_ROLE = keccak256("CONTRIBUTOR");

function operatorContributor(address operator)
    external view returns (address);

function setOperatorContributor(address operator, address contributor)
    external; // ADMIN_ROLE only; contributor must be allowlisted or address(0)
```

`DEFAULT_ADMIN_ROLE` is held by the governance timelock and administers `ADMIN_ROLE`; `ADMIN_ROLE` is held by the operational multisig and administers OPERATOR and CONTRIBUTOR membership and operator assignments. Production deployment must not leave these roles on an externally owned deployer account.

`ProtocolConfig` exposes the source-named configuration through getters and ADMIN-governed setters:

```solidity
function paymentToken() external view returns (address); // immutable
function feeBps() external view returns (uint16);
function treasury() external view returns (address);
function challengeWindow() external view returns (uint64);
function gatewaySigner() external view returns (address);
function paused() external view returns (bool);

function setFeeBps(uint16 newFeeBps) external;
function setTreasury(address newTreasury) external;
function setChallengeWindow(uint64 newChallengeWindow) external;
function setGatewaySigner(address newGatewaySigner) external;
function pause() external;
function unpause() external;
```

All four configuration setters require `DEFAULT_ADMIN_ROLE`, held by the 48-hour production timelock. `pause` and `unpause` require `ADMIN_ROLE`, held by the operational multisig, so an incident can be stopped immediately. `paymentToken`, treasury, challenge window, and gateway signer must be nonzero when initialized; setters preserve the same validation. Each config mutation emits an event containing the old and new value; pause/unpause emit the standard `Paused(account)` and `Unpaused(account)` events.

## Domain model

### Enums

```solidity
enum DatasetStatus { Draft, Listed, ExclusivelySold, Delisted }
enum SaleKind     { Copy, Exclusive }
enum ChallengeStatus { None, Pending, Rejected, Upheld }
```

The source document also defines `PricingType { Fixed, Auction }`. V1 has no runtime pricing-type choice because every V1 listing is fixed-price. `PricingType` belongs to the deferred auction model and need not appear in V1 contract storage or interfaces.

### `SalePolicy`

```solidity
struct SalePolicy {
    bool allowCopy;
    bool allowExclusive;
    bool exclusiveRequiresZeroCopies;
    bool licensesTransferable;
}
```

Rules represented by this structure:

- `exclusiveRequiresZeroCopies == true` means the contributor offers true exclusivity: Exclusive may be sold only while `copiesSold == 0`.
- `licensesTransferable` is `false` in V1. Copy-license resale is disabled.

### `Dataset`

```solidity
struct Dataset {
    uint256       id;
    address       contributor;
    bytes32       contentHash;
    string        sampleURI;
    string        payloadURI;
    bytes32       weightsRoot;
    uint256       totalWeight;
    DatasetStatus status;
    SalePolicy    policy;
    uint64        copiesSold;
    string        tag;
    uint64        createdAt;
}
```

Field semantics:

- `contributor` is the primary contributor, for example Nurture.
- `contentHash` is the keccak hash of the encrypted full payload and anchors integrity.
- `sampleURI` is public and always open.
- `payloadURI` points to encrypted full data gated by the Access Gateway.
- `weightsRoot` is the Merkle root of leaves `keccak(subContributor, weight)`.
- `totalWeight` is the sum of weights.
- `tag` is an optional shard/category.
- A Dataset is the core asset, also called a **Data Title**.

Weights are fixed at `registerDataset` in V1. `weightsRoot` and `totalWeight` are immutable afterwards. A re-split requires a new Dataset version.

All other contributor-supplied registration fields (`contributor`, `contentHash`, `sampleURI`, `payloadURI`, `policy`, and `tag`) are also immutable in V1. Only protocol-controlled lifecycle fields (`status` and `copiesSold`) may change. Correcting metadata or pointers requires a new Dataset version; production URIs should therefore be content-addressed or backed by durable redirect infrastructure.

### `Listing` and entitlement model

```solidity
struct Listing {
    uint256 datasetId;
    SaleKind kind;
    uint256 price;
    bool active;
}

/*
Entitlement (token):
  ERC-1155 tokenId = hash(datasetId, kind)
*/
```

A Dataset can have a Copy listing and/or an Exclusive listing. An entitlement balance represents access: a Copy token is a non-exclusive license, while an Exclusive token is the exclusive title.

The source-defined `PricingType.Auction`, `Auction` model, and `auctionId` field are deferred source-model references. They are not included as unused V1 storage fields, and no auction contract is deployed.

## Required interfaces and functions

### `IDatasetRegistry`

```solidity
interface IDatasetRegistry {
    struct RegisterParams {
        bytes32 contentHash;
        string  sampleURI;
        string  payloadURI;
        bytes32 weightsRoot;
        uint256 totalWeight;
        SalePolicy policy;
        string  tag;
    }

    function registerDataset(RegisterParams calldata p)
        external
        returns (uint256 datasetId);

    function getDataset(uint256 datasetId)
        external
        view
        returns (Dataset memory);

    function challengeWindowEndsAt(uint256 datasetId)
        external
        view
        returns (uint256);

    function challengeStatus(uint256 datasetId)
        external
        view
        returns (ChallengeStatus);

    function challengeEvidenceHash(uint256 datasetId)
        external
        view
        returns (bytes32);

    function weightsInvalidated(uint256 datasetId)
        external
        view
        returns (bool);

    // ADMIN multisig only; evidence is submitted and reviewed off-chain.
    function recordChallenge(uint256 datasetId, bytes32 evidenceHash)
        external;

    // ADMIN multisig only.
    function resolveChallenge(uint256 datasetId, bool upheld)
        external;

    // Marketplace proxy only.
    function markListed(uint256 datasetId) external;
    function markDelisted(uint256 datasetId) external;
    function recordCopySale(uint256 datasetId) external;
    function recordExclusiveSale(uint256 datasetId) external;
}
```

`registerDataset` is limited to allowlisted contributors in the clean start (Nurture) and assigned operators. If an address has the CONTRIBUTOR role, direct-contributor behavior takes precedence and `Dataset.contributor = msg.sender`, even if that address also has OPERATOR. Otherwise, an OPERATOR registers for the allowlisted contributor assigned to it in `ContributorRegistry`; an operator cannot select or impersonate another contributor. This preserves the source `RegisterParams` shape, which does not contain a contributor argument.

### `IMarketplace`

```solidity
interface IMarketplace {
    // Listing (contributor-only)
    function listCopy(uint256 datasetId, uint256 price) external;
    function listExclusiveFixed(uint256 datasetId, uint256 price) external;
    function delist(uint256 datasetId, SaleKind kind) external;

    // Purchase (buyer)
    function buyCopy(uint256 datasetId) external;
    function buyExclusive(uint256 datasetId) external;

    // Views
    function priceOf(uint256 datasetId, SaleKind kind)
        external
        view
        returns (uint256);

    // DatasetRegistry only; called when a weight challenge is upheld.
    function invalidateListings(uint256 datasetId) external;
}
```

`buyCopy` and `buyExclusive` assume the buyer has approved the Marketplace proxy as payment-token spender first. Both are fixed-price purchase flows. The Dataset registration interface does not contain a price; price is set when the contributor creates the listing.

For both listing functions, `price > 0` is required. A Copy listing and an Exclusive listing may coexist. An active listing's price cannot be edited in place; the contributor changes it by calling `delist` and then creating a new listing.

`priceOf(datasetId, kind)` returns the active fixed price, or `0` when that listing is inactive or does not exist. Listing creation emits `CopyListed` or `ExclusiveListed`; successful delisting requires an active listing and emits `ListingDelisted`.

`invalidateListings` is not a public ADMIN shortcut. It is callable only by `DatasetRegistry` during an upheld-challenge transition, deactivates both listing kinds atomically, and emits `ListingDelisted` once for each listing that was active.

### `IRevenueSplitter`

```solidity
interface IRevenueSplitter {
    // Marketplace proxy only; gross tokens must already have been transferred here.
    function accrue(uint256 datasetId, uint256 gross) external;

    function claim(
        uint256 datasetId,
        uint256 weight,
        bytes32[] calldata proof
    ) external;

    function claimable(
        uint256 datasetId, address who, uint256 weight
    ) external view returns (uint256);

    // Sends the full recorded treasury balance only to ProtocolConfig.treasury().
    function withdrawTreasury() external returns (uint256 amount);
}
```

The source sketch names the settlement operation `_accrue`, but a Solidity `internal` function cannot be called across the separate `Marketplace` and `RevenueSplitter` contracts. V1 therefore exposes the integration entrypoint as `accrue`, restricts it to the Marketplace proxy, and keeps the fee calculation/accounting logic inside `RevenueSplitter`. `withdrawTreasury` may be called by anyone, but it can send funds only to the configured treasury address.

### Required access query

The Main Protocol must expose this gateway-facing view:

```solidity
function hasAccess(uint256 datasetId, address who)
    external
    view
    returns (bool);
```

`EntitlementNFT` exposes this view in V1. It may obtain the Dataset status from `DatasetRegistry`.

Copy-token transfers are rejected for both single and batch ERC-1155 transfer paths; a batch containing any Copy token must revert atomically. Minting from `address(0)` remains available only to Marketplace. V1 exposes no public Copy burn function. Exclusive tokens use standard ERC-1155 transfer behavior, including receiver checks, and their transferred balance immediately controls `hasAccess`. Those secondary transfers perform no settlement or revenue accrual in V1.

### Contract trust boundaries

- `ContributorRegistry` uses `ADMIN`, `OPERATOR`, and `CONTRIBUTOR` roles. ADMIN may allowlist contributors and call `setOperatorContributor(operator, contributor)`. The assigned contributor must already have the CONTRIBUTOR role; clearing an assignment sets it to `address(0)`.
- `DatasetRegistry.markListed`, `markDelisted`, `recordCopySale`, and `recordExclusiveSale` are callable only by the Marketplace proxy. `recordCopySale` increments `copiesSold`; `recordExclusiveSale` enters the terminal `ExclusivelySold` state.
- `Marketplace.invalidateListings` is callable only by `DatasetRegistry` and exists solely to complete an upheld-challenge transition.
- `EntitlementNFT.mint(to, datasetId, kind)` is callable only by the Marketplace proxy and always mints exactly one internally derived `tokenId(datasetId, kind)`. Accepting `datasetId` and `kind` instead of an opaque token ID lets the NFT enforce Copy non-transferability and Exclusive uniqueness. No public mint or Copy burn path exists.
- `RevenueSplitter.accrue` is callable only by the Marketplace proxy. `claim` remains permissionless for a valid Merkle leaf/proof.
- `DatasetRegistry`, `EntitlementNFT`, and `RevenueSplitter` each expose `setMarketplaceOnce(address marketplace)`. It requires ADMIN, rejects zero, and permanently closes after storing the Marketplace proxy. Their protected state-changing operations reject calls until this wiring is complete.
- Proxy-address authorizations point to the stable proxy addresses, not implementation addresses.

The token ID derivation is fixed for every contract, indexer, and Gateway integration:

```solidity
uint256 tokenId = uint256(keccak256(abi.encode(datasetId, kind)));
```

## Business flows and invariants

### Dataset registration

1. An allowlisted contributor, or its assigned OPERATOR, submits `RegisterParams` through `registerDataset`.
2. Require `contentHash != bytes32(0)`, non-empty `sampleURI`, non-empty `payloadURI`, `weightsRoot != bytes32(0)`, `totalWeight > 0`, `policy.allowCopy || policy.allowExclusive`, and `policy.licensesTransferable == false`.
3. The protocol records only metadata, rights, settlement data, and commitments. Dataset bytes never go on-chain.
4. The public sample is available at `sampleURI`; the encrypted complete payload is referenced by `payloadURI`.
5. The Dataset stores its `contentHash`, `weightsRoot`, `totalWeight`, and contributor-declared `SalePolicy`, starts with `status = Draft`, and snapshots `challengeWindowEndsAt = block.timestamp + ProtocolConfig.challengeWindow`.
6. Set `challengeStatus = None`, `weightsInvalidated = false`, and emit `DatasetRegistered`.

The leaf set must contain at most one leaf per address and its weights must sum exactly to `totalWeight`. Because only the Merkle root is stored on-chain, the Batch Pipeline validates these conditions before registration and publishes the complete leaf set for public recomputation and challenge.

### Listing rules and Dataset lifecycle

- Only `Dataset.contributor` may create or delist that Dataset's listings.
- `listCopy` requires `policy.allowCopy`; `listExclusiveFixed` requires `policy.allowExclusive`; both require `price > 0` and no active listing of the same `SaleKind`.
- If `exclusiveRequiresZeroCopies == true`, `listExclusiveFixed` additionally requires `copiesSold == 0`.
- A listing may be created during the challenge window so its price and Dataset metadata can be reviewed, but no purchase may complete before the window closes.
- While `challengeStatus == Pending`, new listings and relisting are blocked, but the contributor may delist. After `Upheld`, listing and relisting are permanently blocked.
- A Dataset moves from `Draft` or `Delisted` to `Listed` when its first active listing is created. It remains `Listed` while at least one listing is active. Delisting its final active listing changes it to `Delisted`.
- A `Delisted` Dataset may be relisted only if it is not `ExclusivelySold` and `weightsInvalidated == false`.
- A successful Exclusive purchase changes the Dataset to the terminal `ExclusivelySold` state and deactivates both listings.
- `Copy` and `Exclusive` listings may coexist, subject to `SalePolicy`. If `exclusiveRequiresZeroCopies == true`, the first successful Copy purchase deactivates any active Exclusive listing and emits `ListingDelisted`; subsequent Exclusive listing creation is blocked.

### `buyCopy`

The following sequence is required:

1. Require `status == Listed`, `policy.allowCopy`, and an active Copy listing.
2. Require `block.timestamp >= challengeWindowEndsAt`, `challengeStatus` is `None` or `Rejected`, and `weightsInvalidated == false`.
3. Require the buyer's Copy-token balance for this Dataset to be zero, preventing an accidental duplicate purchase of the same non-transferable access right.
4. Use `SafeERC20.safeTransferFrom` to pull the listed payment-token price from the buyer directly into `RevenueSplitter`, and require its token-balance increase to equal `price` exactly.
5. Call `RevenueSplitter.accrue(datasetId, price)`; it deducts the protocol fee in accounting.
6. Mint `EntitlementNFT.mint(buyer, datasetId, Copy)`; the NFT derives the token ID and amount `1` internally.
7. Increment `copiesSold` through `DatasetRegistry.recordCopySale`.
8. If `exclusiveRequiresZeroCopies == true`, deactivate any active Exclusive listing and emit `ListingDelisted(datasetId, Exclusive)`.
9. Emit `CopyPurchased(datasetId, buyer, price)`.

Copies are non-exclusive and unlimited while the Dataset remains eligible for Copy sales.

### `buyExclusive`

The fixed-price Exclusive state machine is:

1. Require `status == Listed`, `policy.allowExclusive`, and an active Exclusive listing.
2. Require `block.timestamp >= challengeWindowEndsAt`, `challengeStatus` is `None` or `Rejected`, and `weightsInvalidated == false`.
3. If `policy.exclusiveRequiresZeroCopies`, require `copiesSold == 0`.
4. Use `SafeERC20.safeTransferFrom` to pull the price directly into `RevenueSplitter`, require its token-balance increase to equal `price` exactly, then call `RevenueSplitter.accrue(datasetId, price)`.
5. Set `status = ExclusivelySold` through `DatasetRegistry.recordExclusiveSale`.
6. Deactivate all listings for the Dataset.
7. Mint `EntitlementNFT.mint(buyer, datasetId, Exclusive)`; the NFT derives the token ID and amount `1` internally.
8. Emit `ExclusivePurchased(datasetId, buyer, price)`.

After `ExclusivelySold`, the on-chain state machine permits no new Copy sales, no new Exclusive sales, and no new entitlements. It cannot revoke bytes previously delivered to Copy buyers. This distinction must be stated honestly to buyers.

### Revenue accrual and claims

On every sale:

```text
fee = gross * feeBps / 10_000
net = gross - fee
treasuryBalance += fee
cumulativeRevenue[datasetId] += net
```

For a sub-contributor claim:

```text
leaf      = keccak256(abi.encode(msg.sender, weight))
entitled  = weight * cumulativeRevenue[datasetId] / dataset.totalWeight
owed      = entitled - claimed[datasetId][msg.sender]
```

The implementation must compute `entitled` with OpenZeppelin `Math.mulDiv(weight, cumulativeRevenue, totalWeight)` to avoid intermediate multiplication overflow while preserving floor division.

Claim requirements:

1. Require `block.timestamp >= challengeWindowEndsAt`, `challengeStatus` is `None` or `Rejected`, and `weightsInvalidated == false`.
2. Verify `MerkleProof.verify(proof, dataset.weightsRoot, leaf)`.
3. Require `owed > 0`.
4. Increase `claimed[datasetId][msg.sender]` by `owed`.
5. Transfer `owed` in the configured payment token.
6. Emit `RevenueClaimed(datasetId, msg.sender, owed)`.

`cumulativeRevenue` only increases. Claims are pull-based and do not iterate across the contributor set, preserving O(1) cost per sale and per claim. Nurture is one leaf, weighted for raw-sensor-data contribution; labelers are the other leaves. The Batch Pipeline publishes the full `(address, weight)` list and proofs off-chain through IPFS, DA, or CDN; only the root is on-chain.

Merkle leaves use the source-defined encoding `keccak256(abi.encode(subContributor, weight))`. Tree construction and proof generation use sorted sibling-pair hashing compatible with OpenZeppelin `MerkleProof`; the pipeline and contracts must use the same algorithm and test vectors.

`claimable` returns `0` while the challenge window is open, while a challenge is `Pending`, or after weights are `Upheld`/invalidated. Solidity integer division may leave rounding dust in `RevenueSplitter`. V1 provides no treasury or ADMIN sweep for this dust; the cumulative formula allows part of it to become claimable as later revenue arrives, and any final remainder stays in the splitter.

Because `claimable` has no proof parameter, it is an arithmetic preview only: it does not prove that `(who, weight)` is present in the Merkle tree. Only `claim` establishes membership and can transfer funds. For an unknown Dataset, `claimable` and `hasAccess` return `0`/`false`; state-changing functions revert.

`treasuryBalance` may be withdrawn independently of contributor claims. `withdrawTreasury` requires a nonzero recorded balance, first clears it, and then transfers that amount to the current nonzero treasury address, emitting `TreasuryWithdrawn`. It cannot withdraw contributor revenue or rounding dust. The payment token must be an exact-transfer ERC-20; fee-on-transfer, rebasing, and callback-bearing tokens are unsupported.

### Challenge window and successful-challenge handling

The challenge scope in V1 is limited to an incorrect `weightsRoot`, `totalWeight`, duplicated/missing leaves, or an incorrect published `(address, weight)` allocation. Dataset content disputes are not handled by this state machine.

Per-Dataset challenge data is stored separately so the source-defined `Dataset` struct remains unchanged:

```solidity
mapping(uint256 => uint256) public challengeWindowEndsAt;
mapping(uint256 => ChallengeStatus) public challengeStatus;
mapping(uint256 => bytes32) public challengeEvidenceHash;
mapping(uint256 => bool) public weightsInvalidated;
```

The required state machine is:

1. Registration sets the deadline, `challengeStatus = None`, and `weightsInvalidated = false`.
2. Listings may be created during the review window, but `buyCopy`, `buyExclusive`, and `claim` are blocked until `block.timestamp >= challengeWindowEndsAt`.
3. Anyone may submit evidence through the published off-chain dispute channel. Before the deadline, the ADMIN multisig may call `recordChallenge(datasetId, evidenceHash)`, changing `None` or `Rejected` to `Pending` and storing the latest evidence hash. `evidenceHash` must be nonzero. A late challenge cannot be recorded through this V1 path. Earlier hashes remain discoverable through events if a rejected challenge is followed by another timely challenge.
4. While `Pending`, purchases, claims, and new/relisted listings remain blocked regardless of the deadline. Contributor delisting and ADMIN resolution remain available.
5. `resolveChallenge(datasetId, false)` changes `Pending` to `Rejected`. Purchases and claims are then allowed only after the original deadline has passed.
6. `resolveChallenge(datasetId, true)` changes `Pending` to `Upheld`, sets `weightsInvalidated = true`, calls `Marketplace.invalidateListings(datasetId)`, and sets the Dataset to `Delisted` in the same transaction. Listing, relisting, purchase, and claim paths for that Dataset are permanently blocked.
7. The Batch Pipeline may publish corrected weights only by registering a normal new Dataset, which receives a new ID and its own full challenge window. No privileged replacement Dataset, revenue migration, or deadline bypass exists.

Because no purchase can occur before the review window closes and a pending challenge blocks purchases, an upheld challenge has no accumulated sale revenue or buyer entitlements to migrate or refund. Challenge adjudication, operator stake, and slashing remain off-chain and controlled by the ADMIN multisig in V1. This centralized trust assumption must be disclosed operationally.

A Pending challenge does not expire automatically. This fail-closed rule avoids silently approving a disputed allocation, but it creates an ADMIN liveness dependency; the operating policy must publish and monitor a resolution SLA.

## Access control and data delivery

The public sample at `sampleURI` requires no entitlement check.

`hasAccess(datasetId, who)` follows this rule:

```text
if Dataset.status == ExclusivelySold:
    return balanceOf(who, tokenId(datasetId, Exclusive)) > 0

return balanceOf(who, tokenId(datasetId, Copy)) > 0
    || balanceOf(who, tokenId(datasetId, Exclusive)) > 0
```

This deliberately applies the source document's exclusive-access interpretation: after an Exclusive sale, prior Copy holders fail `hasAccess`. The protocol cannot revoke bytes or keys already delivered, but the Gateway must stop new key delivery and re-download service to those Copy holders. Buyer-facing terms must state this limitation.

For the encrypted payload, v1 uses envelope encryption:

1. The payload is encrypted once with a random data key and stored at `payloadURI`; `contentHash` is anchored on-chain.
2. The buyer authenticates to the Access Gateway by signing a wallet challenge.
3. The Gateway calls `hasAccess(datasetId, buyer)`.
4. If entitled, the Gateway re-encrypts the data key to the buyer's public key and returns it; the buyer decrypts the payload client-side.

The roadmap is threshold/MPC or TEE key custody so a single Gateway operator cannot leak keys.

`ProtocolConfig.gatewaySigner` is the public identity used to verify Gateway-signed off-chain responses where needed. It is not an alternative authorization path: on-chain entitlement remains the sole input to `hasAccess`, and all private signing/encryption material stays off-chain.

## Main Protocol event API

These event names and parameter names are part of the required Main Protocol API:

```solidity
event DatasetRegistered(
    uint256 indexed datasetId,
    address indexed contributor,
    bytes32 contentHash,
    bytes32 weightsRoot,
    uint256 totalWeight
);

event CopyPurchased(
    uint256 indexed datasetId,
    address indexed buyer,
    uint256 price
);

event ExclusivePurchased(
    uint256 indexed datasetId,
    address indexed buyer,
    uint256 price
);

event RevenueClaimed(
    uint256 indexed datasetId,
    address indexed subContributor,
    uint256 amount
);
```

V1 additionally requires events for every listing and challenge state transition so indexers do not need to infer mutable state:

```solidity
event CopyListed(uint256 indexed datasetId, uint256 price);
event ExclusiveListed(uint256 indexed datasetId, uint256 price);
event ListingDelisted(uint256 indexed datasetId, SaleKind kind);

event WeightChallengePending(
    uint256 indexed datasetId,
    bytes32 indexed evidenceHash
);

event WeightChallengeResolved(
    uint256 indexed datasetId,
    bool upheld
);

event TreasuryWithdrawn(
    address indexed treasury,
    uint256 amount
);

event RevenueAccrued(
    uint256 indexed datasetId,
    uint256 gross,
    uint256 fee,
    uint256 net
);

event OperatorContributorUpdated(
    address indexed operator,
    address indexed previousContributor,
    address indexed newContributor
);

event FeeBpsUpdated(uint16 previousFeeBps, uint16 newFeeBps);
event TreasuryUpdated(address indexed previousTreasury, address indexed newTreasury);
event ChallengeWindowUpdated(uint64 previousWindow, uint64 newWindow);
event GatewaySignerUpdated(address indexed previousSigner, address indexed newSigner);
event MarketplaceWired(address indexed marketplace);
```

The first four events are source-defined Main Protocol events. All later events are explicit V1 additions needed to expose the resolved listing, challenge, fee/configuration, operator-assignment, and one-time-wiring state transitions. `RoleGranted`, `RoleRevoked`, `Paused`, `Unpaused`, and UUPS upgrade events use their standard OpenZeppelin definitions.

`Participated`, `EpochClosed`, and `BatchPackaged` are Crowdsourcing Protocol events and are excluded from the current contract scope.

## Security, deployment, and governance requirements

- Use checks-effects-interactions, pull payments, OpenZeppelin `ReentrancyGuardTransient.nonReentrant`, and `SafeERC20` for purchase and claim paths. The Cancun EVM target and EIP-1153 transient-storage support are deployment prerequisites.
- Apply the `ContributorRegistry` allowlist during the Nurture-only clean start.
- Anchor `weightsRoot` and publish leaves. The security model calls for an optimistic challenge window before a Dataset's first payout, allowing recomputation and dispute; the operator is expected to be staked/slashed.
- Keep operator keys in an HSM or multisig. The longer-term roadmap is decentralizing the pipeline through an EigenLayer AVS.
- Use a deployment-fixed nonzero stablecoin address (USDC is the example), configurable `feeBps`, and configurable nonzero treasury in `ProtocolConfig`; require `feeBps <= 10_000` and `challengeWindow > 0`.
- Production configuration changes and UUPS upgrades use a 48-hour governance timelock. A `feeBps` change affects only future purchases. A treasury-address change affects every later `withdrawTreasury`, including fees already accrued but not yet withdrawn. A `challengeWindow` change affects only Datasets registered after that change because each Dataset snapshots its deadline at registration.
- Pause blocks `registerDataset`, new listings/relisting, `buyCopy`, `buyExclusive`, and `claim`. Read methods, `claimable`, contributor `delist`, challenge recording/resolution, `withdrawTreasury`, and ADMIN pause/unpause remain available so the protocol can reduce risk and resolve incidents while paused.
- `Marketplace` and `RevenueSplitter` use UUPS proxies; `_authorizeUpgrade` accepts only the governance timelock through `DEFAULT_ADMIN_ROLE`.
- `EntitlementNFT` and Dataset records are immutable-by-default.
- Operational roles are `ADMIN` (multisig: pause, challenge decisions, allowlist/assignment, one-time wiring), `OPERATOR` (pipeline `registerDataset`), and `CONTRIBUTOR` (allowlist). Timelocked config/upgrade authority is `DEFAULT_ADMIN_ROLE`. Buyers are permissionless in V1; the optional KYC hook is deferred.

## Decision enforcement notes

- `ProtocolConfig.challengeWindow` is configurable and has no hard-coded V1 duration. `DatasetRegistry` records `challengeWindowEndsAt[datasetId]` separately so the document-provided `Dataset` struct remains unchanged.
- `Marketplace` may list during the challenge window, but both purchase methods and `RevenueSplitter.claim` must remain blocked until the window closes and any timely challenge is resolved.
- `DatasetRegistry` must provide no mutation path for `weightsRoot` or `totalWeight` after `registerDataset`.
- `EntitlementNFT` must reject transfer operations for Copy-token IDs and allow the standard ERC-1155 transfer behavior for Exclusive-token IDs.
- The operational evidence-review and adjudication process is outside the V1 contract set. `DatasetRegistry` records only the challenge evidence hash, status, and ADMIN decision.
- An upheld challenge permanently invalidates the old Dataset's weights. Corrected weights require a normal new Dataset registration and a new challenge window; there is no settlement-only Dataset or revenue migration path.
- The immutable V1 payment token must be used consistently by `Marketplace` and `RevenueSplitter`; ADMIN cannot replace it in place.
- Any future on-chain bond, stake, dispute, or slashing mechanism is a separately scoped protocol extension and must not be silently added to V1.

## Source alignment and V1 deviation register

| Specification area | Source basis | V1 treatment |
| --- | --- | --- |
| Dataset, `SalePolicy`, statuses, and entitlement model | Part 2.1 | Names and source fields preserved. Challenge state is stored separately. V1 omits deferred auction-only listing fields. |
| Contract names and responsibilities | Part 2.2 | Source names preserved. Challenge storage and operator assignment are V1 additions needed to resolve open mechanics. |
| Registration and fixed-price market functions | Part 2.3 | Source function names/signatures preserved for `registerDataset`, fixed listing, purchase, delist, and price views. Auction entrypoints are intentionally deferred by product decision. |
| Copy and Exclusive purchase state machines | Part 2.3 and Part 2.6 | Source ordering and exclusivity rules preserved; challenge gates, duplicate-Copy prevention, and cross-contract integration entrypoints are explicit V1 completion rules. |
| Revenue formula and Merkle claims | Part 2.4 | Source formulas and leaf encoding preserved. `Math.mulDiv`, dust policy, treasury withdrawal, and the public `accrue` integration entrypoint resolve implementation gaps without changing payout proportions. |
| `hasAccess` and Gateway delivery | Part 2.5 and Part 2.6 | Source query logic preserved exactly. V1 explicitly records the resulting loss of future Gateway access for prior Copy holders after an Exclusive sale. |
| Required Main Protocol events | Part 4 | The four source events are preserved exactly. Listing, challenge, treasury, config, assignment, and wiring events are additive V1 observability events. |
| Weight challengeability | Parts 1.3 and 5; open question in Part 7 | Source requires optimistic challengeability before first payout but leaves mechanics open. V1 blocks both purchases and payouts, uses off-chain evidence plus ADMIN resolution, and permanently invalidates upheld roots. |
| Roles, pause, config, and upgrades | Part 6 | Source roles, pausing, config, and UUPS requirements are preserved. Payment-token immutability, exact pause behavior, and per-Dataset challenge snapshots are V1 decisions. |
| Governance timelock deployment | Part 6 and confirmed governance-delay decision | `ProtocolTimelock` is an additive OpenZeppelin `TimelockController` wrapper that makes the required 48-hour delay and multisig roles concrete and deployable. It adds no sale or Dataset behavior. |
| Copy transferability and weight locking | Open questions in Part 7 | Resolved as non-transferable Copy licenses and registration-time weight locking, matching the source's recommended V1 directions. |
| Auctions | Parts 1, 2.1–2.3, and 5 | This is the only source-described Main Protocol sale mode deliberately removed from the current build. All auction contracts, fields, interfaces, and tests remain deferred. |

Every requirement not directly stated in the source must appear in the Confirmed V1 decisions table or be identified as an implementation completion rule in this register. A future change to one of these decisions requires updating this document and its tests before contract code changes.

## Hardhat implementation and acceptance tests

Use Solidity for contracts and TypeScript for Hardhat configuration, deployment scripts, and tests. Use OpenZeppelin contracts for ERC-1155, access control, `SafeERC20`, `MerkleProof`, `Math.mulDiv`, reentrancy protection, and UUPS support. The test suite must include at least the following:

Required project tooling:

- Hardhat 3 plus `@nomicfoundation/hardhat-toolbox-mocha-ethers` for compile, Ethers integration, Mocha assertions, and network helpers.
- OpenZeppelin Contracts and Hardhat Upgrades for UUPS deployment and upgrade validation.
- TypeScript and generated Hardhat contract bindings for typed scripts and contract interaction.
- Hardhat 3 native `--coverage` and `--gas-stats` reporting, plus Solhint and Prettier, for test visibility and code quality. The legacy `solidity-coverage` and `hardhat-gas-reporter` plugins are not used because their current peer ranges target Hardhat 2; the required coverage and gas outputs are still produced.
- Slither in CI as an independent static-analysis gate. Findings must be fixed or recorded with a reviewed justification before release.
- Dependency versions must be pinned by the package lockfile; CI must use the lockfile rather than floating upgrades.

| Area | Required acceptance coverage |
| --- | --- |
| Registration | CONTRIBUTOR self-registration; assigned OPERATOR registration; unassigned/unauthorized rejection; every validation failure; immutable registration fields; deadline snapshot; exact `DatasetRegistered`. |
| Listing | Copy-only, Exclusive-only, and concurrent listings; zero-price rejection; same-kind duplicate rejection; delist/relist price change; status transitions; contributor-only authorization; `priceOf` inactive behavior. |
| Challenge timing | Purchase/claim blocked at `deadline - 1`; allowed at exactly `deadline`; timely record; late record rejection; Pending blocks purchase/claim/relisting; Rejected recovery; repeated timely challenge; Upheld atomically delists and permanently blocks the old Dataset. |
| Copy purchase | Exact payment, fee/net accounting, one-token mint, `copiesSold`, event, duplicate-wallet rejection, automatic Exclusive delist under the zero-copy policy, paused rejection, reentrancy resistance. |
| Exclusive purchase | Zero-copy policy branch; forward-exclusive branch after Copy sales; both listings deactivated; terminal status; one Exclusive token; no later sale or mint. |
| Entitlements | Copy single/batch transfer rejection; Exclusive transfer success and receiver checks; `hasAccess` before/after Exclusive sale and after Exclusive transfer; unknown Dataset returns false. |
| Revenue | Multiple sales and staggered claims; valid/invalid proofs; wrong weight/address; double-claim; late claim; `Math.mulDiv` large values; rounding dust; treasury isolation/withdrawal; `claimable` is non-authoritative without proof. |
| Pause/config | Exact paused/unpaused operation matrix; non-timelock config rejection; immediate ADMIN pause; fee/timestamp boundary values; treasury change semantics; challenge-window changes affect only new Datasets. |
| Dependency wiring | Zero-address rejection; ADMIN-only setup; operation rejection before wiring; successful Marketplace proxy wiring; second-call rejection on all three dependent contracts. |
| Upgradeability | Only `DEFAULT_ADMIN_ROLE`/timelock can authorize Marketplace and RevenueSplitter upgrades; 48-hour production delay; storage-layout upgrade check; all non-upgradeable contracts reject proxy-style initialization assumptions. |
| Deferred scope | ABI and deployment assertions confirm no `AuctionHouse`, `IAuctionHouse`, `listExclusiveAuction`, `bid`, or `settle` exists in V1 artifacts. |

## Hardhat source layout

This layout preserves document-provided contract and interface names and adds only normal Hardhat project organization.

```text
contracts/
  ContributorRegistry.sol
  DatasetRegistry.sol
  EntitlementNFT.sol
  Marketplace.sol
  ProtocolConfig.sol
  ProtocolTimelock.sol
  RevenueSplitter.sol
  interfaces/
    IDatasetRegistry.sol
    IEntitlementNFT.sol
    IMarketplace.sol
    IRevenueSplitter.sol
  test/
    CopyOrderReceiver.sol
    FeeOnTransferERC20.sol
    MarketplaceV2.sol
    MockERC20.sol
    MockMarketplace.sol
    NonERC1155Receiver.sol
    ReentrantERC20.sol
    RevenueSplitterV2.sol
test/
  acceptance/
    ArtifactScope.ts
  unit/
    ContributorRegistry.ts
    DatasetRegistry.ts
    EntitlementNFT.ts
    ProtocolConfig.ts
    ProtocolTimelock.ts
    RevenueSplitter.ts
  integration/
    Marketplace.ts
    MarketplaceAcceptance.ts
scripts/
  deploy.ts
  verify-deployment.ts
.github/workflows/
  ci.yml
security/
  SLITHER_REVIEW.md
hardhat.config.ts
```

Deployment order is fixed:

1. Deploy `ProtocolTimelock` with the production multisig as proposer, executor, and canceller; verify its fixed 48-hour delay and self-admin role.
2. Deploy `ContributorRegistry` and `ProtocolConfig` with `ProtocolTimelock` as `DEFAULT_ADMIN_ROLE` and the production multisig as operational `ADMIN_ROLE`.
3. Deploy `DatasetRegistry` and `EntitlementNFT` with their already-known dependencies and the same governance/operational role split.
4. Deploy and initialize the `RevenueSplitter` UUPS proxy without a Marketplace address.
5. Deploy and initialize the `Marketplace` UUPS proxy with the registry, NFT, splitter, and config addresses.
6. Through the operational multisig, call `setMarketplaceOnce` on `DatasetRegistry`, `EntitlementNFT`, and `RevenueSplitter` with the Marketplace proxy address.
7. Run `scripts/verify-deployment.ts` to verify Timelock roles/delay, every core role, dependency and wiring address, proxy implementation, immutable payment token, fee, treasury, gateway signer, challenge window, and pause state. The deployment EOA must retain no production privilege.
