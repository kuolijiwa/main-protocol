# Main Protocol Development Specification

## Status and source of truth

- Status: V1 fixed-price Main Protocol core contracts are implemented. A temporary EOA-admin deployment to Base Sepolia (84532) completed and passed post-deployment verification on 2026-08-18; production Safe execution and external audit remain pending.
- Target stack: Solidity contracts developed and tested with Hardhat.
- Source of truth: `protocol_technical_design.md` in this directory. Source rules are preserved unless a rule is explicitly superseded by a confirmed V1 decision below. Deferred source features are identified as such and must not be implemented accidentally.
- Target environment: EVM L2 (Base, Arbitrum, or OP). Heavy computation and data stay off-chain; the chain records commitments, rights, and settlement.

### Implementation verification status

| Module | Status | Automated tests |
| --- | --- | ---: |
| `ContributorRegistry` | Implemented and passing | 10 |
| `ProtocolConfig` | Implemented and passing | 11 |
| `DatasetRegistry` | Implemented and passing | 26 |
| `EntitlementNFT` | Implemented and passing | 13 |
| `RevenueSplitter` | Implemented, UUPS-tested, and passing | 23 |
| `Marketplace` | Implemented, UUPS/integration-tested, and passing | 22 |
| `ProtocolTimelock` | Implemented, delay/role/execution-tested, and passing | 10 |
| Artifact/deployment/network/Merkle/Manifest/Challenge/deferred-scope assertions | Passing | 39 |
| **Total** | **Full regression passing** | **154** |

The deployment and post-deployment verification scripts share the same importable, integration-tested implementation and are TypeScript-checked. Persistent-network identity and rejection branches are directly unit-tested without broadcasting a deployment. An official Safe v1.5.0 Singleton/proxy integration test requires two owner signatures, checks nonce replay rejection, executes all six onboarding/wiring transactions, and then runs full deployment verification; focused tests also reject unexpected singleton/code, modules, guard, fallback handler, code hashes, and extra privileged role members. Hardhat compilation, formatting, Solidity lint, 98.59% line coverage, 98.55% statement coverage, gas reporting, dependency gates, and the 154-test regression suite pass. Slither 0.11.5 completes with no high-severity finding; reviewed non-high findings are recorded in `security/SLITHER_REVIEW.md`. Within the confirmed V1 decisions and explicitly deferred scope, the current source has no known mismatch with this development specification. The temporary Base Sepolia EOA deployment is not a production release; production Safe execution, public challenge-intake/Gateway operations, and an independent smart-contract audit remain release gates.

## Confirmed V1 decisions

The following choices resolve the source document's open questions or implementation gaps. They are product decisions for this build, not claims that the source document already fixed every detail.

| Topic | Confirmed V1 decision |
| --- | --- |
| Weight immutability | Weights are locked at `registerDataset`. `weightsRoot` and `totalWeight` cannot be edited afterwards; a re-split requires a new Dataset version. |
| Copy-license transferability | Copy licenses are non-transferable. `EntitlementNFT` must reject ERC-1155 transfers of `tokenId(datasetId, Copy)`, including zero-value single/batch transfers before or after the first Copy mint. |
| Exclusive-title transferability | Once minted, Exclusive titles use standard ERC-1155 transfer behavior. Before the first Exclusive mint, the computed token ID is not yet a title and zero-value transfer attempts are rejected. This is distinct from the Copy-license decision. |
| Exclusive secondary transfers | A standard ERC-1155 Exclusive transfer does not collect payment, protocol fees, royalties, or sub-contributor revenue. A protocol-managed secondary marketplace is outside V1. |
| Pricing scope | V1 supports fixed-price listings only. The contributor sets the price when creating a Copy listing with `listCopy(datasetId, price)` or an Exclusive listing with `listExclusiveFixed(datasetId, price)`. An active listing's price is immutable; changing it requires delisting and creating a new fixed-price listing. |
| Buyer execution protection | Every purchase supplies the exact listed price expected by the buyer and a transaction deadline. A changed price or `block.timestamp > deadline` reverts before payment. The unprotected one-argument purchase entrypoints do not exist. |
| Seller fee protection | Each Listing snapshots the current `feeBps` as `maxFeeBps`. A later fee decrease benefits the seller, but a fee increase makes the old Listing unpurchasable until the contributor deliberately delists and relists under the new fee. |
| Nurture raw-data weight | The Batch Pipeline determines Nurture's raw-data weight under a versioned governance policy, includes Nurture as a Merkle leaf, publishes the leaves, and locks the resulting root at registration. The Main Protocol contains no fixed raw-data-weight ratio. |
| Challenge window | `ProtocolConfig` provides a configurable `challengeWindow`; V1 does not hard-code a duration. Listings may be created for public review during the window, but purchases and claims are blocked. Anyone may submit evidence off-chain; the ADMIN multisig records and resolves a timely challenge on-chain. An upheld challenge permanently invalidates that Dataset's weights and blocks its listing, purchase, and claim paths. The corrected allocation must be registered as a normal new Dataset. No revenue migration, refund, challenge bond, or on-chain adjudication contract is needed because sales cannot occur before the challenge window closes. |
| Administrator-mediated challenge | V1 does not implement permissionless on-chain challenges. Anyone submits the versioned public evidence document off-chain; only `ADMIN_ROLE` calls `recordChallenge` and `resolveChallenge`. The record commits both `evidenceURI` and `keccak256(raw evidence bytes)`, stores its timestamp and a fixed 72-hour resolution due time. Intake acknowledgement is an operational 24-hour SLA. An overdue Pending record remains fail-closed and resolvable; it never auto-passes or auto-rejects. |
| Registration attribution | A CONTRIBUTOR registers for itself. An OPERATOR registers only for the single allowlisted contributor assigned to it in `ContributorRegistry`; `RegisterParams` is not changed to add a contributor argument. |
| Initial contributor membership | At deployment completion, `NURTURE_CONTRIBUTOR` must be the sole `CONTRIBUTOR_ROLE` member. `ContributorRegistry` uses enumerable access control so post-deployment verification checks the exact role-member count and member address, rather than merely checking that Nurture is included. The ADMIN multisig may expand the allowlist later as the source permits. |
| Registration validation | Expected Dataset ID must equal `nextDatasetId`; hash/root/Manifest digest must be nonzero; sample/payload/Manifest URIs must be non-empty; `totalWeight > 0`; at least one sale kind enabled; and `policy.licensesTransferable == false`. Leaf uniqueness and exact weight sum are enforced by the Pipeline/public Manifest validator because leaves are off-chain. |
| Allocation validation and Dataset isolation | The Pipeline-facing allocation validator rejects zero/duplicate addresses, nonpositive weights, any individual weight above `totalWeight`, and any sum not exactly equal to `totalWeight`. `RevenueSplitter.unclaimedRevenue[datasetId]` caps each Dataset's aggregate claims so a malformed valid root cannot consume another Dataset's funds. Claim also rejects an individual `weight > totalWeight`. |
| Weights Manifest commitment | Every registration binds the expected sequential Dataset ID, a public `weightsURI`, `keccak256` of the exact Manifest bytes, and `main-protocol.weights-manifest.v1`. The Manifest binds chain ID, Registry, Dataset, hash/tree algorithm, full unique allocation, total/root, proofs, Pipeline version/time, and source-content digest. A claimant can discover it on-chain and use `verify:weights-manifest` without contacting the operator. |
| Dataset IDs and unknown records | Dataset IDs are sequential and start at `1`; `0` is invalid. `getDataset` and all state-changing calls revert for an unknown ID, while `priceOf`, `claimable`, and `hasAccess` return `0`, `0`, and `false`; `getListing` returns the normalized inactive record `Listing(datasetId, kind, 0, 0, false)`. |
| Dataset lifecycle | Registration starts at `Draft`; the first listing changes it to `Listed`; removing the last listing changes it to `Delisted`; Exclusive purchase is terminal `ExclusivelySold`; an upheld challenge sets `Delisted` plus a permanent weight-invalidated flag. |
| Duplicate Copy purchase | A wallet that already has a Copy-token balance for the Dataset cannot buy the same Copy license again. Copy supply remains unlimited across distinct buyer addresses. |
| True-exclusive listing | When `exclusiveRequiresZeroCopies == true`, an Exclusive listing cannot be created after any Copy sale. The first Copy sale automatically deactivates an already-active Exclusive listing so an ineligible offer is not left visible. |
| Claim event | A successful `RevenueSplitter.claim` emits `RevenueClaimed(datasetId, msg.sender, owed)`. |
| `hasAccess` ownership | `EntitlementNFT` exposes `hasAccess(uint256 datasetId, address who)`. It may read Dataset state through `DatasetRegistry`. |
| Access after an Exclusive sale | After `ExclusivelySold`, only the Exclusive-token holder passes `hasAccess`. Prior Copy holders keep any bytes already delivered, but the Gateway no longer provides re-download or key delivery to them. |
| Payment token | V1 uses one immutable payment-token address fixed at deployment. Replacing the token requires a new deployment/upgrade and migration plan; an ADMIN config change cannot switch the token under active listings. |
| Payment-token behavior | V1 supports a standard exact-transfer ERC-20 stablecoin only. Purchase ingress and claim/treasury egress verify exact balance deltas. Every payout verifies aggregate backing first, so a negative rebase fails closed. Fee-on-transfer, rebasing, blacklist, and callback-bearing token behaviors remain unsupported and require deployment review. |
| Gateway signer config | `gatewaySigner` stores only the Gateway's public signer address/identity. No private key or decryption key is ever stored on-chain, and this signer cannot mint entitlements or override `hasAccess`. |
| Division dust and token recovery | Integer-division dust remains recorded in `contributorBalance` and cannot be swept. The Timelock-only `rescueToken` may recover unrelated ERC-20s and only payment-token balance strictly above `treasuryBalance + contributorBalance`; it cannot consume contributor, treasury, or dust liabilities. |
| KYC hook | Buyers are permissionless in V1. The source document's optional KYC hook is deferred and must not be added without a new product decision. |
| Pause behavior | Pause stops registration, listing/relisting, purchases, and claims. Reads, `claimable`, delisting, challenge recording/resolution, treasury withdrawal, and pause recovery remain available. |
| Pending-challenge liveness | A Pending challenge has no automatic state transition; it fails closed until ADMIN resolves it. `challengeResolutionDueAt` publishes a fixed 72-hour adjudication SLA, while overdue resolution remains possible and triggers operational escalation. |
| Dependency wiring | Non-upgradeable contracts and `RevenueSplitter` receive the Marketplace proxy through an ADMIN-only `setMarketplaceOnce` operation. It rejects zero, code without the required binding view, and a Marketplace whose reverse `datasetRegistry`, `entitlementNFT`, or `revenueSplitter` binding does not equal the receiving contract. Wiring cannot be repeated. Registration and market operations remain disabled until wiring is complete. |
| Governance delay and authority lock | Production config changes and UUPS upgrades use the non-upgradeable `ProtocolTimelock`, an OpenZeppelin `TimelockController` with a fixed 48-hour minimum delay. Governance may increase the delay but `updateDelay` cannot reduce it below 48 hours. The operational multisig is proposer, executor, and canceller; the Timelock is permanently self-administered and is the core contracts' sole, fixed `DEFAULT_ADMIN_ROLE` holder. Neither the Timelock nor a core contract can grant that role to another address or revoke/renounce it from the Timelock. Configuration setters and UUPS authorization compare the caller directly with the stored Timelock address, so transferring a role cannot create a delay bypass. Emergency pause and challenge operations remain immediate multisig actions through `ADMIN_ROLE`. |
| Upgradeability | Only `Marketplace` and `RevenueSplitter` use UUPS proxies. `ContributorRegistry`, `DatasetRegistry`, `EntitlementNFT`, `ProtocolConfig`, and the governance-infrastructure `ProtocolTimelock` are non-upgradeable V1 contracts; mutable configuration and role management occur through their documented state and roles. |
| Production dependency pinning | Persistent deployments pin `EXPECTED_CHAIN_ID`, the payment token's runtime code hash and decimals, and a Safe-compatible operational multisig's runtime code hash, exact owner set, and threshold. Deployment and verification both probe the required read interfaces. These checks prove the reviewed identities/configuration, while the operator remains responsible for selecting a reviewed exact-transfer, non-rebasing stablecoin implementation. |
| Deployment-network prerequisite | Test deployment uses the named `baseSepolia` Hardhat network with canonical chain ID `84532`; production deployments use `base` (`8453`), `arbitrum` (`42161`), or `optimism` (`10`). Every persistent deployment requires the operator to set `EIP1153_CONFIRMED=true` only after confirming Cancun transient-storage support on the selected chain. Deployment and verification require both `EXPECTED_CHAIN_ID` and the selected Hardhat network name to match the hard-coded canonical mapping, preventing an RPC/network-name mismatch even if an operator edits both the RPC and environment expectation together. |

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
| `DatasetRegistry` | Creates and stores `Dataset` records; holds sample/payload pointers, content hash, weights root, public Manifest commitment, administrator-mediated challenge evidence/deadline/status, and permanent weight-invalidation state. |
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

`DEFAULT_ADMIN_ROLE` is held solely by the fixed governance timelock and administers `ADMIN_ROLE`; it cannot be granted to another address or revoked/renounced from that Timelock. `ADMIN_ROLE` is held by the operational multisig and administers OPERATOR and CONTRIBUTOR membership and operator assignments. Production deployment must not leave these roles on an externally owned deployer account or place `DEFAULT_ADMIN_ROLE` on the operational multisig.

`ProtocolConfig` exposes the source-named configuration through getters and Timelock-governed setters:

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

All four configuration setters require the caller to equal the fixed 48-hour production Timelock address; possession of a role alone is insufficient. `pause` and `unpause` require `ADMIN_ROLE`, held by the operational multisig, so an incident can be stopped immediately. `paymentToken`, treasury, challenge window, and gateway signer must be nonzero when initialized; setters preserve the same validation. Each config mutation emits an event containing the old and new value; pause/unpause emit the standard `Paused(account)` and `Unpaused(account)` events.

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
    uint16 maxFeeBps;
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
        uint256 expectedDatasetId;
        bytes32 contentHash;
        string  sampleURI;
        string  payloadURI;
        bytes32 weightsRoot;
        uint256 totalWeight;
        string  weightsURI;
        bytes32 weightsManifestHash;
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

    function nextDatasetId() external view returns (uint256);
    function weightsURI(uint256 datasetId) external view returns (string memory);
    function weightsManifestHash(uint256 datasetId) external view returns (bytes32);
    function WEIGHTS_MANIFEST_VERSION() external view returns (bytes32);

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

    function challengeEvidenceURI(uint256 datasetId) external view returns (string memory);
    function challengeRecordedAt(uint256 datasetId) external view returns (uint256);
    function challengeResolutionDueAt(uint256 datasetId) external view returns (uint256);
    function CHALLENGE_EVIDENCE_VERSION() external view returns (bytes32);
    function CHALLENGE_RESOLUTION_SLA() external view returns (uint256);

    function weightsInvalidated(uint256 datasetId)
        external
        view
        returns (bool);

    // ADMIN multisig only; evidence is submitted and reviewed off-chain.
    function recordChallenge(
        uint256 datasetId,
        bytes32 evidenceHash,
        string calldata evidenceURI
    ) external;

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

`registerDataset` is limited to allowlisted contributors in the clean start (Nurture) and assigned operators. If an address has the CONTRIBUTOR role, direct-contributor behavior takes precedence and `Dataset.contributor = msg.sender`, even if that address also has OPERATOR. Otherwise, an OPERATOR registers for the allowlisted contributor assigned to it in `ContributorRegistry`; an operator cannot select or impersonate another contributor. `RegisterParams` still contains no contributor argument, but V1 adds `expectedDatasetId`, `weightsURI`, and `weightsManifestHash` as the recorded security decision needed to bind a discoverable Manifest to the exact chain registration.

### `IMarketplace`

```solidity
interface IMarketplace {
    // Listing (contributor-only)
    function listCopy(uint256 datasetId, uint256 price) external;
    function listExclusiveFixed(uint256 datasetId, uint256 price) external;
    function delist(uint256 datasetId, SaleKind kind) external;

    // Purchase (buyer)
    function buyCopy(
        uint256 datasetId,
        uint256 expectedPrice,
        uint256 deadline
    ) external;

    function buyExclusive(
        uint256 datasetId,
        uint256 expectedPrice,
        uint256 deadline
    ) external;

    // Views
    function priceOf(uint256 datasetId, SaleKind kind)
        external
        view
        returns (uint256);

    function getListing(uint256 datasetId, SaleKind kind)
        external
        view
        returns (Listing memory);

    // DatasetRegistry only; called when a weight challenge is upheld.
    function invalidateListings(uint256 datasetId) external;
}
```

`buyCopy` and `buyExclusive` assume the buyer has approved the Marketplace proxy as payment-token spender first. Both are fixed-price purchase flows. `expectedPrice` must equal the active Listing price exactly, and execution requires `block.timestamp <= deadline`; these buyer commitments prevent a delist/relist price change or delayed transaction from spending an unintended allowance. The Dataset registration interface does not contain a price; price is set when the contributor creates the listing.

For both listing functions, `price > 0` is required. A Copy listing and an Exclusive listing may coexist. An active listing's price cannot be edited in place; the contributor changes it by calling `delist` and then creating a new listing. Listing creation snapshots `ProtocolConfig.feeBps` into `maxFeeBps`. Purchase fails if the current fee is greater than that snapshot, so accepting a higher fee requires deliberate delist/relist; a lower current fee applies normally.

`priceOf(datasetId, kind)` returns the active fixed price, or `0` when that listing is inactive or does not exist. `getListing(datasetId, kind)` returns the complete fixed-listing record and is part of `IMarketplace`; when no listing has ever existed for that pair, including an unknown Dataset ID, it returns `Listing(datasetId, kind, 0, 0, false)` rather than an all-zero record with the wrong identity fields. Listing creation emits `CopyListed(datasetId, price, maxFeeBps)` or `ExclusiveListed(datasetId, price, maxFeeBps)`; successful delisting requires an active listing and emits `ListingDelisted`.

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

    // Timelock only; payment-token rescue is capped to balance above all liabilities.
    function rescueToken(address token, address recipient, uint256 amount) external;
}
```

The source sketch names the settlement operation `_accrue`, but a Solidity `internal` function cannot be called across the separate `Marketplace` and `RevenueSplitter` contracts. V1 therefore exposes the integration entrypoint as `accrue`, restricts it to the Marketplace proxy, and keeps the fee calculation/accounting logic inside `RevenueSplitter`. `withdrawTreasury` may be called by anyone, but it can send funds only to the configured treasury address. `rescueToken` is restricted directly to the governance Timelock; for the configured payment token it can transfer only balance above `treasuryBalance + contributorBalance`.

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
- `DatasetRegistry`, `EntitlementNFT`, and `RevenueSplitter` each expose `setMarketplaceOnce(address marketplace)`. It requires ADMIN, rejects zero, verifies the corresponding reverse Marketplace dependency points to the receiving contract, and permanently closes after storing the Marketplace proxy. Their protected state-changing operations reject calls until this wiring is complete.
- Proxy-address authorizations point to the stable proxy addresses, not implementation addresses.

The token ID derivation is fixed for every contract, indexer, and Gateway integration:

```solidity
uint256 tokenId = uint256(keccak256(abi.encode(datasetId, kind)));
```

## Business flows and invariants

### Dataset registration

1. An allowlisted contributor, or its assigned OPERATOR, publishes the exact validated Manifest bytes and submits `RegisterParams` through `registerDataset` using the Manifest's computed root, public URI, and exact-byte digest.
2. Require `expectedDatasetId == nextDatasetId`, `contentHash != bytes32(0)`, non-empty `sampleURI`, non-empty `payloadURI`, `weightsRoot != bytes32(0)`, `totalWeight > 0`, non-empty `weightsURI`, `weightsManifestHash != bytes32(0)`, `policy.allowCopy || policy.allowExclusive`, and `policy.licensesTransferable == false`.
3. The protocol records only metadata, rights, settlement data, and commitments. Dataset bytes never go on-chain.
4. The public sample is available at `sampleURI`; the encrypted complete payload is referenced by `payloadURI`.
5. The Dataset stores its `contentHash`, `weightsRoot`, `totalWeight`, and contributor-declared `SalePolicy`; the Registry stores `weightsURI` and `weightsManifestHash`; registration starts with `status = Draft` and snapshots `challengeWindowEndsAt = block.timestamp + ProtocolConfig.challengeWindow`.
6. Set `challengeStatus = None`, `weightsInvalidated = false`, and emit `DatasetRegistered` with the Manifest URI, digest, and `WEIGHTS_MANIFEST_VERSION`.

The leaf set must contain exactly one nonzero-address leaf per included address; every weight must be positive, fit in `uint256`, and be no greater than `totalWeight`; and its weights must sum exactly to `totalWeight`. The deterministic tree sorts leaf hashes, hashes each sibling pair in sorted order, and promotes an unpaired node unchanged. The Batch Pipeline must run the strict allocation-document validator and `generate-weights-manifest.ts`; the generator verifies the live chain ID, Registry code and Manifest version, reads `nextDatasetId()` directly instead of accepting a manual Dataset ID, computes the root from validated leaves, orders Manifest entries canonically, generates every proof, validates all metadata through the same code path as the public verifier, and refuses unknown input fields. The exact generated bytes are then published for public recomputation and challenge. The chain stores the root plus the public Manifest URI, exact-byte digest, and schema/hash version. Main Protocol additionally caps aggregate claims to `unclaimedRevenue[datasetId]`, limiting any malformed root to its own Dataset balance.

### Listing rules and Dataset lifecycle

- Only `Dataset.contributor` may create or delist that Dataset's listings.
- `listCopy` requires `policy.allowCopy`; `listExclusiveFixed` requires `policy.allowExclusive`; both require `price > 0` and no active listing of the same `SaleKind`.
- Listing creation snapshots the current protocol fee as `maxFeeBps`; purchase fails after a fee increase until the contributor relists and explicitly accepts it.
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
2. Require `listing.price == expectedPrice`, `block.timestamp <= deadline`, and current `feeBps <= listing.maxFeeBps`.
3. Require `block.timestamp >= challengeWindowEndsAt`, `challengeStatus` is `None` or `Rejected`, and `weightsInvalidated == false`.
4. Require the buyer's Copy-token balance for this Dataset to be zero, preventing an accidental duplicate purchase of the same non-transferable access right.
5. Use `SafeERC20.safeTransferFrom` to pull the listed payment-token price from the buyer directly into `RevenueSplitter`, and require its token-balance increase to equal `price` exactly.
6. Call `RevenueSplitter.accrue(datasetId, price)`; it deducts the protocol fee in accounting.
7. Mint `EntitlementNFT.mint(buyer, datasetId, Copy)`; the NFT derives the token ID and amount `1` internally.
8. Increment `copiesSold` through `DatasetRegistry.recordCopySale`.
9. If `exclusiveRequiresZeroCopies == true`, deactivate any active Exclusive listing and emit `ListingDelisted(datasetId, Exclusive)`.
10. Emit `CopyPurchased(datasetId, buyer, price)`.

Copies are non-exclusive and unlimited while the Dataset remains eligible for Copy sales.

### `buyExclusive`

The fixed-price Exclusive state machine is:

1. Require `status == Listed`, `policy.allowExclusive`, and an active Exclusive listing.
2. Require `listing.price == expectedPrice`, `block.timestamp <= deadline`, and current `feeBps <= listing.maxFeeBps`.
3. Require `block.timestamp >= challengeWindowEndsAt`, `challengeStatus` is `None` or `Rejected`, and `weightsInvalidated == false`.
4. If `policy.exclusiveRequiresZeroCopies`, require `copiesSold == 0`.
5. Use `SafeERC20.safeTransferFrom` to pull the price directly into `RevenueSplitter`, require its token-balance increase to equal `price` exactly, then call `RevenueSplitter.accrue(datasetId, price)`.
6. Set `status = ExclusivelySold` through `DatasetRegistry.recordExclusiveSale`.
7. Deactivate all listings for the Dataset.
8. Mint `EntitlementNFT.mint(buyer, datasetId, Exclusive)`; the NFT derives the token ID and amount `1` internally.
9. Emit `ExclusivePurchased(datasetId, buyer, price)`.

After `ExclusivelySold`, the on-chain state machine permits no new Copy sales, no new Exclusive sales, and no new entitlements. It cannot revoke bytes previously delivered to Copy buyers. This distinction must be stated honestly to buyers.

### Revenue accrual and claims

On every sale:

```text
fee = gross * feeBps / 10_000
net = gross - fee
treasuryBalance += fee
cumulativeRevenue[datasetId] += net
unclaimedRevenue[datasetId] += net
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
3. Require `weight <= dataset.totalWeight` and `owed > 0`.
4. Require `owed <= unclaimedRevenue[datasetId]`, preventing cross-Dataset liability consumption even if a malformed root's valid leaves sum above `totalWeight`.
5. Increase `claimed[datasetId][msg.sender]` by `owed` and decrease both `unclaimedRevenue[datasetId]` and aggregate `contributorBalance` by `owed`.
6. Require aggregate payment-token backing, transfer `owed`, and verify the claimant's balance increased by exactly `owed`.
7. Emit `RevenueClaimed(datasetId, msg.sender, owed)`.

`cumulativeRevenue` only increases. Claims are pull-based and do not iterate across the contributor set, preserving O(1) cost per sale and per claim. Nurture is one leaf, weighted for raw-sensor-data contribution; labelers are the other leaves. The Batch Pipeline publishes the full `(address, weight)` list and proofs through IPFS, Arweave, DA, or another durable public store. The chain stores the root plus the public Manifest URI, exact-byte digest, and schema/hash version commitment.

Merkle leaves use the source-defined encoding `keccak256(abi.encode(subContributor, weight))`. Tree construction and proof generation use sorted sibling-pair hashing compatible with OpenZeppelin `MerkleProof`; the pipeline and contracts must use the same algorithm and test vectors.

`claimable` returns `0` while the challenge window is open, while a challenge is `Pending`, or after weights are `Upheld`/invalidated. Solidity integer division may leave rounding dust in `RevenueSplitter`. V1 provides no treasury or ADMIN sweep for this dust; the cumulative formula allows part of it to become claimable as later revenue arrives, and any final remainder stays in the splitter.

Because `claimable` has no proof parameter, it is an arithmetic preview only: it does not prove that `(who, weight)` is present in the Merkle tree. Only `claim` establishes membership and can transfer funds. For an unknown Dataset, `claimable` and `hasAccess` return `0`/`false`; state-changing functions revert.

`treasuryBalance` may be withdrawn independently of contributor claims. `withdrawTreasury` requires a nonzero recorded balance and full aggregate backing, first clears it, and then transfers that amount to the current nonzero treasury address while verifying exact receipt, emitting `TreasuryWithdrawn`. It cannot withdraw contributor revenue or rounding dust. Timelock-only token rescue can recover unrelated tokens and true payment-token surplus, but payment-token liabilities are untouchable. The payment token must be an exact-transfer ERC-20; fee-on-transfer, rebasing, blacklist, and callback-bearing tokens are unsupported.

### Challenge window and successful-challenge handling

The challenge scope in V1 is limited to an incorrect `weightsRoot`, `totalWeight`, duplicated/missing leaves, or an incorrect published `(address, weight)` allocation. Dataset content disputes are not handled by this state machine.

Per-Dataset challenge data is stored separately so the source-defined `Dataset` struct remains unchanged:

```solidity
mapping(uint256 => uint256) public challengeWindowEndsAt;
mapping(uint256 => ChallengeStatus) public challengeStatus;
mapping(uint256 => bytes32) public challengeEvidenceHash;
mapping(uint256 => string) public challengeEvidenceURI;
mapping(uint256 => uint256) public challengeRecordedAt;
mapping(uint256 => uint256) public challengeResolutionDueAt;
mapping(uint256 => bool) public weightsInvalidated;
```

The required state machine is:

1. Registration sets the deadline, `challengeStatus = None`, and `weightsInvalidated = false`.
2. Listings may be created during the review window, but `buyCopy`, `buyExclusive`, and `claim` are blocked until `block.timestamp >= challengeWindowEndsAt`.
3. Anyone may submit a public document matching `schemas/weight-challenge-evidence-v1.schema.json` through `POST /v1/datasets/{datasetId}/challenges`. Intake must execute the same strict validator exposed by `npm run validate:challenge-evidence`, including exact field set, canonical UTC timestamp, nonzero challenger/artifact digests, unique artifact URIs, and chain/Registry/Dataset/root binding. The service acknowledges a valid submission within 24 hours and escalates immediately as the review deadline approaches. Before the deadline, only the ADMIN multisig may call `recordChallenge(datasetId, evidenceHash, evidenceURI)`, changing `None` or `Rejected` to `Pending`. Both values must be nonempty; `evidenceHash = keccak256(raw evidence bytes)`. The call stores `challengeRecordedAt` and `challengeResolutionDueAt = challengeRecordedAt + 72 hours`. A late challenge cannot be recorded through this V1 path. Earlier records remain discoverable through events.
4. While `Pending`, purchases, claims, and new/relisted listings remain blocked regardless of the deadline. Contributor delisting and ADMIN resolution remain available.
5. `resolveChallenge(datasetId, false)` changes `Pending` to `Rejected`. Purchases and claims are then allowed only after the original deadline has passed.
6. `resolveChallenge(datasetId, true)` changes `Pending` to `Upheld`, sets `weightsInvalidated = true`, calls `Marketplace.invalidateListings(datasetId)`, and sets the Dataset to `Delisted` in the same transaction. Listing, relisting, purchase, and claim paths for that Dataset are permanently blocked.
7. The Batch Pipeline may publish corrected weights only by registering a normal new Dataset, which receives a new ID and its own full challenge window. No privileged replacement Dataset, revenue migration, or deadline bypass exists.

Because no purchase can occur before the review window closes and a pending challenge blocks purchases, an upheld challenge has no accumulated sale revenue or buyer entitlements to migrate or refund. Challenge adjudication, operator stake, and slashing remain off-chain and controlled by the ADMIN multisig in V1. This centralized trust assumption must be disclosed operationally.

A Pending challenge does not expire automatically. This fail-closed rule avoids silently approving a disputed allocation, but it creates an ADMIN liveness dependency. The 72-hour due time is observable on-chain; overdue records remain blocked and resolvable while monitoring publishes the SLA breach and escalates it to governance.

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
    uint256 totalWeight,
    string weightsURI,
    bytes32 weightsManifestHash,
    bytes32 weightsManifestVersion
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
event CopyListed(uint256 indexed datasetId, uint256 price, uint16 maxFeeBps);
event ExclusiveListed(uint256 indexed datasetId, uint256 price, uint16 maxFeeBps);
event ListingDelisted(uint256 indexed datasetId, SaleKind kind);

event WeightChallengePending(
    uint256 indexed datasetId,
    bytes32 indexed evidenceHash,
    string evidenceURI,
    bytes32 evidenceVersion,
    uint256 resolutionDueAt
);

event WeightChallengeResolved(
    uint256 indexed datasetId,
    bool upheld
);

event TreasuryWithdrawn(
    address indexed treasury,
    uint256 amount
);

event TokenRescued(
    address indexed token,
    address indexed recipient,
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

The four event names are source-defined Main Protocol events. The fixed-price V1 Manifest security decision extends `DatasetRegistered`; the challenge decision extends `WeightChallengePending`. All later events are explicit V1 additions needed to expose the resolved listing, challenge, fee/configuration, operator-assignment, and one-time-wiring state transitions. `RoleGranted`, `RoleRevoked`, `Paused`, `Unpaused`, and UUPS upgrade events use their standard OpenZeppelin definitions.

`Participated`, `EpochClosed`, and `BatchPackaged` are Crowdsourcing Protocol events and are excluded from the current contract scope.

## Security, deployment, and governance requirements

- Use checks-effects-interactions, pull payments, OpenZeppelin `ReentrancyGuardTransient.nonReentrant`, and `SafeERC20` for purchase and claim paths. The Cancun EVM target and EIP-1153 transient-storage support are deployment prerequisites.
- Apply the enumerable `ContributorRegistry` allowlist during the Nurture-only clean start; deployment verification requires exactly one initial `CONTRIBUTOR_ROLE` member and requires that member to equal `NURTURE_CONTRIBUTOR`.
- Anchor `weightsRoot` and publish leaves. The security model calls for an optimistic challenge window before a Dataset's first payout, allowing recomputation and dispute; the operator is expected to be staked/slashed.
- Keep operator keys in an HSM or multisig. The longer-term roadmap is decentralizing the pipeline through an EigenLayer AVS.
- Use a deployment-fixed nonzero stablecoin address (USDC is the example), configurable `feeBps`, and configurable nonzero treasury in `ProtocolConfig`; require `feeBps <= 10_000` and `challengeWindow > 0`.
- Before deploying or verifying, require an exact `EXPECTED_CHAIN_ID` match and, on persistent networks, the canonical named-network mapping (`baseSepolia=84532`, `base=8453`, `arbitrum=42161`, `optimism=10`); pin and verify the payment token runtime code hash and decimals; probe `totalSupply`, `balanceOf`, `allowance`, and `decimals`; and verify the reviewed Safe-compatible ADMIN multisig runtime code hash, exact owner set, and threshold. Code/interface checks do not replace external review of the selected stablecoin's exact-transfer and upgrade behavior.
- Production configuration changes and UUPS upgrades use a 48-hour governance timelock. A `feeBps` decrease applies to later purchases; an increase cannot apply to an existing Listing whose `maxFeeBps` snapshot is lower and requires seller relisting. A treasury-address change affects every later `withdrawTreasury`, including fees already accrued but not yet withdrawn. A `challengeWindow` change affects only Datasets registered after that change because each Dataset snapshots its deadline at registration.
- Pause blocks `registerDataset`, new listings/relisting, `buyCopy`, `buyExclusive`, and `claim`. Read methods, `claimable`, contributor `delist`, challenge recording/resolution, `withdrawTreasury`, and ADMIN pause/unpause remain available so the protocol can reduce risk and resolve incidents while paused.
- `Marketplace` and `RevenueSplitter` use UUPS proxies; `_authorizeUpgrade` accepts only the fixed stored governance-Timelock address. The Timelock remains its own sole `DEFAULT_ADMIN_ROLE` holder, and all six governed core contracts permanently bind that role to the same Timelock. All seven contracts reject attempts to grant the role elsewhere or revoke/renounce it from the Timelock.
- `EntitlementNFT` and Dataset records are immutable-by-default.
- Operational roles are `ADMIN` (multisig: pause, challenge decisions, allowlist/assignment, one-time wiring), `OPERATOR` (pipeline `registerDataset`), and `CONTRIBUTOR` (allowlist). Timelocked config/upgrade authority is `DEFAULT_ADMIN_ROLE`. Buyers are permissionless in V1; the optional KYC hook is deferred.

## Decision enforcement notes

- `ProtocolConfig.challengeWindow` is configurable and has no hard-coded V1 duration. `DatasetRegistry` records `challengeWindowEndsAt[datasetId]` separately so the document-provided `Dataset` struct remains unchanged.
- `Marketplace` may list during the challenge window, but both purchase methods and `RevenueSplitter.claim` must remain blocked until the window closes and any timely challenge is resolved.
- `DatasetRegistry` must provide no mutation path for `weightsRoot` or `totalWeight` after `registerDataset`.
- `EntitlementNFT` must reject transfer operations for Copy-token IDs. An Exclusive token ID becomes a transferable standard ERC-1155 title when it is minted; before that mint, zero-value transfer attempts for the computed ID are rejected.
- The operational evidence-review and adjudication process is outside the V1 contract set. `DatasetRegistry` records the public evidence URI and digest, record/due timestamps, status, and ADMIN decision; it does not verify the dispute facts on-chain.
- An upheld challenge permanently invalidates the old Dataset's weights. Corrected weights require a normal new Dataset registration and a new challenge window; there is no settlement-only Dataset or revenue migration path.
- The immutable V1 payment token must be used consistently by `Marketplace` and `RevenueSplitter`; ADMIN cannot replace it in place.
- Any future on-chain bond, stake, dispute, or slashing mechanism is a separately scoped protocol extension and must not be silently added to V1.

## Source alignment and V1 deviation register

| Specification area | Source basis | V1 treatment |
| --- | --- | --- |
| Dataset, `SalePolicy`, statuses, and entitlement model | Part 2.1 | Names and source fields preserved. Challenge state is stored separately. V1 omits deferred auction-only listing fields. |
| Contract names and responsibilities | Part 2.2 | Source names preserved. Challenge storage and operator assignment are V1 additions needed to resolve open mechanics. |
| Registration and fixed-price market functions | Part 2.3 | Source function names are preserved. `RegisterParams` is extended with expected Dataset ID and Manifest commitments, and purchases add price/deadline protection as explicit V1 security decisions. Auction entrypoints are intentionally deferred by product decision. |
| Copy and Exclusive purchase state machines | Part 2.3 and Part 2.6 | Source ordering and exclusivity rules preserved; challenge gates, duplicate-Copy prevention, and cross-contract integration entrypoints are explicit V1 completion rules. |
| Revenue formula and Merkle claims | Part 2.4 | Source formulas and leaf encoding preserved. `Math.mulDiv`, dust policy, treasury withdrawal, and the public `accrue` integration entrypoint resolve implementation gaps without changing payout proportions. |
| `hasAccess` and Gateway delivery | Part 2.5 and Part 2.6 | Source query logic preserved exactly. V1 explicitly records the resulting loss of future Gateway access for prior Copy holders after an Exclusive sale. |
| Required Main Protocol events | Part 4 | The four source event names are preserved. `DatasetRegistered` and the additive challenge event carry the V1 Manifest/evidence commitments and versions required for independent discovery and monitoring. |
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
- The pinned official `@safe-global/safe-smart-account` package for real threshold-signature and nonce integration testing of deployment administration transactions.
- TypeScript and generated Hardhat contract bindings for typed scripts and contract interaction.
- Hardhat 3 native `--coverage` and `--gas-stats` reporting, plus Solhint and Prettier, for test visibility and code quality. The legacy `solidity-coverage` and `hardhat-gas-reporter` plugins are not used because their current peer ranges target Hardhat 2; the required coverage and gas outputs are still produced.
- Slither in CI as an independent static-analysis gate. Findings must be fixed or recorded with a reviewed justification before release.
- Dependency versions must be pinned by the package lockfile; CI must use the lockfile rather than floating upgrades.

| Area | Required acceptance coverage |
| --- | --- |
| Registration | CONTRIBUTOR self-registration; assigned OPERATOR registration; unassigned/unauthorized rejection; every validation failure; immutable registration fields; deadline snapshot; exact `DatasetRegistered`. |
| Listing | Copy-only, Exclusive-only, and concurrent listings; zero-price rejection; same-kind duplicate rejection; delist/relist price change; `maxFeeBps` snapshot; status transitions; contributor-only authorization; `priceOf` inactive behavior. |
| Challenge timing | Purchase/claim blocked at `deadline - 1`; allowed at exactly `deadline`; timely record; late record rejection; Pending blocks purchase/claim/relisting; Rejected recovery; repeated timely challenge; Upheld atomically delists and permanently blocks the old Dataset. |
| Copy purchase | Exact expected-price and deadline protection; seller fee-cap rejection; exact payment, fee/net accounting, one-token mint, `copiesSold`, event, duplicate-wallet rejection, automatic Exclusive delist under the zero-copy policy, paused rejection, reentrancy resistance. |
| Exclusive purchase | Exact expected-price and deadline protection; seller fee-cap rejection; zero-copy policy branch; forward-exclusive branch after Copy sales; both listings deactivated; terminal status; one Exclusive token; no later sale or mint. |
| Entitlements | Copy single/batch transfer rejection; Exclusive transfer success and receiver checks; `hasAccess` before/after Exclusive sale and after Exclusive transfer; unknown Dataset returns false. |
| Revenue | Multiple sales and staggered claims; valid/invalid proofs; wrong weight/address; double-claim; late claim; `Math.mulDiv` large values; per-Dataset liability isolation against over-allocated valid leaves; individual weight cap; outbound fee, blacklist, and negative-rebase rejection; exact claimant/treasury receipt; rounding dust; Timelock-only surplus rescue; treasury isolation/withdrawal; `claimable` is non-authoritative without proof. |
| Pause/config | Exact paused/unpaused operation matrix; non-timelock config rejection; immediate ADMIN pause; fee/timestamp boundary values; treasury change semantics; challenge-window changes affect only new Datasets. |
| Dependency wiring | Zero-address rejection; ADMIN-only setup; operation rejection before wiring; reverse Marketplace dependency mismatch rejection; successful Marketplace proxy wiring; second-call rejection on all three dependent contracts. Shared deployment/verification logic must execute in integration tests, including the local-EOA exception and an official 2/2 Safe proxy that rejects one signature, rejects nonce replay, executes all six emitted administration transactions, and passes post-deployment verification. |
| Persistent deployment validation | Directly execute the persistent-network validation branch for every supported canonical network; reject canonical-chain mismatch, unreviewed names, and missing EIP-1153 confirmation. Reject payment-token code-hash/decimals mismatches; Safe proxy/singleton code, owner-set, threshold, guard, fallback-handler, or module mismatches; any core/proxy/implementation runtime-code mismatch; any extra privileged role member; and protocol constant/SLA mismatches. A real persistent-network broadcast remains a separate release gate. |
| Initial contributor identity | Post-deployment verification must fail unless `CONTRIBUTOR_ROLE` has exactly one member and that member is `NURTURE_CONTRIBUTOR`; it must also reject a distinct Pipeline operator that was additionally granted Contributor membership. |
| Cross-system Merkle compatibility | A fixed JSON vector must reproduce `keccak256(abi.encode(address,uint256))`, sorted-pair hashing, the documented total weight, root, leaves, and proofs off-chain, and every proof must pass an on-chain OpenZeppelin `MerkleProof` harness. The executable allocation validator must reject duplicate/zero addresses, zero/excessive weights, and every exact-total mismatch. |
| Weights Manifest | Generation must include complete unique leaves and proofs. Verification must reject root, Dataset ID, chain ID, Registry, total, hash-version, proof, availability, and exact-byte digest mismatches; on-chain registration must expose the public URI/digest/version and reject an unexpected next Dataset ID. |
| Challenge evidence document | The executable validator must reject schema, Dataset ID, chain ID, Registry, root, challenger, timestamp, reason, summary, artifact, duplicate-URI, unknown-field, invalid-JSON, and exact-byte commitment errors before ADMIN records the evidence. |
| Administrator-mediated Challenge | Direct non-ADMIN recording rejection; nonzero evidence URI/digest; exact evidence event/version/timestamps; timely/late boundaries; duplicate/repeated transitions; Pending fail-closed after deadline and after its 72-hour SLA; resolution remains possible after SLA; upheld and failed Marketplace invalidation behavior. |
| Upgradeability and governance isolation | Only the fixed Timelock address can authorize Marketplace and RevenueSplitter upgrades; 48-hour production minimum delay; storage-layout upgrade check; role-transfer/revoke/renounce bypass rejection across the Timelock and all six governed contracts; all non-upgradeable contracts reject proxy-style initialization assumptions. |
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
    IMarketplaceBindings.sol
    IRevenueSplitter.sol
  utils/
    FixedGovernanceAccessControl.sol
  test/
    CopyOrderReceiver.sol
    FeeOnTransferERC20.sol
    InconsistentDatasetRegistry.sol
    MarketplaceV2.sol
    MockERC20.sol
    MockMarketplace.sol
    MockSafe.sol
    MerkleProofHarness.sol
    NonERC1155Receiver.sol
    ReentrantERC20.sol
    RevenueSplitterV2.sol
test/
  acceptance/
    ArtifactScope.ts
    MerkleVector.ts
  unit/
    ChallengeEvidence.ts
    ContributorRegistry.ts
    DatasetRegistry.ts
    DeploymentValidation.ts
    EntitlementNFT.ts
    MerkleAllocation.ts
    WeightsManifest.ts
    ProtocolConfig.ts
    ProtocolTimelock.ts
    RevenueSplitter.ts
    SchemaCompatibility.ts
  integration/
    Deployment.ts
    Marketplace.ts
    MarketplaceAcceptance.ts
    OfficialSafeDeployment.ts
scripts/
  deploy.ts
  generate-weights-manifest.ts
  validate-merkle-allocation.ts
  validate-weight-challenge-evidence.ts
  verify-weights-manifest.ts
  verify-deployment.ts
  lib/
    challenge-evidence.ts
    deploy-main-protocol.ts
    deployment-validation.ts
    json-validation.ts
    merkle-allocation.ts
    weights-manifest.ts
    verify-main-protocol.ts
  base-sepolia/
    inspect.mjs
    admin.mjs
    timelock.mjs
    contributor.mjs
    operator.mjs
    buyer.mjs
    claimant.mjs
    treasury.mjs
    gateway.mjs
    run-all.mjs
    lib/common.mjs
.github/workflows/
  ci.yml
security/
  DEPENDENCY_AUDIT.md
  PRODUCTION_SECURITY_CHECKLIST.md
  SLITHER_REVIEW.md
test-vectors/
  allocation.json
  merkle.json
schemas/
  weight-challenge-evidence-v1.schema.json
  weights-manifest-v1.schema.json
hardhat.config.ts
.env.example
```

Base Sepolia 的真实 RPC 角色验收脚本、环境字段、写入保护、Safe/Timelock calldata 流程和报告判定规则见 [`BASE_SEPOLIA_LIVE_TESTING.md`](BASE_SEPOLIA_LIVE_TESTING.md)。

Deployment order is fixed:

1. Select `baseSepolia` (`84532`) for the test network or a reviewed `base` (`8453`), `arbitrum` (`42161`), or `optimism` (`10`) production network; pin the same value in `EXPECTED_CHAIN_ID`; confirm EIP-1153 support; validate the reviewed payment token's runtime code hash, decimals, and ERC-20 read interface; and validate the Safe-compatible production multisig's proxy code hash, singleton address/code hash, exact owners/threshold, exact guard/fallback-handler configuration, and absence of enabled modules. Deployment rejects any named-network/canonical-chain mismatch.
2. Deploy `ProtocolTimelock` with the production multisig as proposer, executor, and canceller; verify its initial 48-hour delay and permanently locked self-admin role.
3. Deploy `ContributorRegistry` and `ProtocolConfig` with `ProtocolTimelock` as `DEFAULT_ADMIN_ROLE` and the production multisig as operational `ADMIN_ROLE`.
4. Through the operational multisig, grant `CONTRIBUTOR_ROLE` to `NURTURE_CONTRIBUTOR`, grant `OPERATOR_ROLE` to the distinct `PIPELINE_OPERATOR`, and call `setOperatorContributor(PIPELINE_OPERATOR, NURTURE_CONTRIBUTOR)`. The Pipeline operator must not also hold `CONTRIBUTOR_ROLE`, because direct-contributor attribution takes precedence.
5. Deploy `DatasetRegistry` and `EntitlementNFT` with their already-known dependencies and the same governance/operational role split.
6. Deploy and initialize the `RevenueSplitter` UUPS proxy without a Marketplace address.
7. Deploy and initialize the `Marketplace` UUPS proxy with the registry, NFT, splitter, and config addresses.
8. Through the operational multisig, call `setMarketplaceOnce` on `DatasetRegistry`, `EntitlementNFT`, and `RevenueSplitter` with the Marketplace proxy address. `scripts/deploy.ts` emits the ordered onboarding and wiring calls together as `adminTransactions` when the deployer is not the multisig.
9. Run `scripts/verify-deployment.ts` with the emitted deployer, implementation addresses, and independently reviewed runtime code hashes supplied through `.env`. Verification checks the external dependency pins, canonical network identity, Safe security configuration, every core/proxy/implementation code hash, Timelock minimum delay and exact role-member sets, every core contract's exact admin-role sets, exact one-member initial Contributor and Operator allowlists, Nurture/Pipeline assignment, Manifest/challenge schema constants and 72-hour SLA, dependency/wiring addresses, exact proxy implementation addresses, immutable payment token, fee, treasury, gateway signer, challenge window, and pause state. It accepts a governance-increased delay but fails below 48 hours, on any extra privileged role member, or on any address/code/configuration change.

Deployment and verification consume the variables documented in `.env.example`. `ADMIN_MULTISIG_OWNERS` is a comma-separated exact owner set, `ADMIN_MULTISIG_THRESHOLD` must be at least `2` and no greater than that set's size, and the singleton/guard/fallback-handler values must match the reviewed Safe configuration exactly; V1 rejects every enabled Safe module. `NURTURE_CONTRIBUTOR` and `PIPELINE_OPERATOR` must be nonzero and distinct. `ALLOW_EOA_ADMIN=true` requires `ADMIN_MULTISIG == DEPLOYER_ADDRESS`; it is supported by default only on Hardhat's local simulated network. The explicit `ALLOW_EOA_ADMIN_ON_BASE_SEPOLIA_TEST=true` override is a temporary test-only exception for Base Sepolia verification, must never be used for production funds, and must be removed when the reviewed Safe is configured. `npm run audit:deps` is part of CI: the complete toolchain must have no High/Critical advisories and production dependencies must have no Moderate-or-higher advisories, with the rationale for any remaining Low toolchain advisories recorded in `security/DEPENDENCY_AUDIT.md`.

### External production release gates

The automated suite does not replace the following environment- and organization-owned work:

- Populate and independently review the exact Base Sepolia payment-token, production Safe, treasury, Gateway signer, Nurture Contributor, Pipeline operator, fee, and challenge-window inputs.
- Broadcast the deployment on Base Sepolia, execute the six emitted onboarding/wiring transactions through the selected production Safe, and run `verify-deployment.ts` against the resulting addresses.
- Complete an independent smart-contract audit and resolve or formally accept every finding.
- Complete the separately scoped Pipeline and Access Gateway implementations and approve the challenge-resolution SLA, HSM/multisig key custody, monitoring, incident response, and buyer-facing exclusivity disclosures.
- Complete and sign off every applicable item in `security/PRODUCTION_SECURITY_CHECKLIST.md` against the exact release commit and deployed addresses.
