# protocol_technical_design.md

- Document ID: 198mHmrKeIuOGckIa71wtxyhrpCoqUwScnhNmNUlYexY
- Revision ID: AIroW34oHNdJ4ZICk-OdQCObNm_LI9o4RN-u_pAv9rpC88tcU5zwLAopwkDVPbIzppehAv1glVAvjyaHRhTXFfaUWqyInaiHRVQDnxOfcOQ
- Selected tab: all
- Protected controls: 0
- Opaque controls: 0
- Authoritative dropdowns: 0

Protected-control annotations are preservation instructions. Do not insert their displayed placeholder text to recreate a native control.

## Tab 1 (t.0)

[P00001 | 1:62 | HEADING_1]
Protocol Technical Design — Data Marketplace + Crowdsourcing

[P00002 | 62:528 | NORMAL_TEXT]
Audience: protocol / smart-contract / backend engineers Scope: the two on-chain protocols that run the data business — (1) the Main Protocol (dataset ownership, pricing, sale, revenue split) and (2) the Crowdsourcing Protocol (records arcade participation and feeds packaged, weighted datasets into the Main Protocol). Defines business logic, design principles, the contract/class sketches, and — critically — the events that form the API between the two protocols.

[P00003 | 528:529 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00004 | 529:785 | NORMAL_TEXT]
This document assumes the earlier context: datasets are large and live off-chain; the chain holds rights and settlement, not data; heavy computation (quality, novelty, weights) happens off-chain and is anchored on-chain. Everything here is EVM / L2-first.

[P00005 | 785:786 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00006 | 786:788 | NORMAL_TEXT]
[HORIZONTAL_RULE]

[P00007 | 788:818 | HEADING_2]
Summary — what we're building

[P00008 | 818:1070 | NORMAL_TEXT]
The product in one line: a marketplace where datasets that teach robots dexterity are bought and sold, plus a crowdsourcing layer that lets retail users improve those datasets by labeling (through the Arcade game) and earn a share when the data sells.

[P00009 | 1070:1071 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00010 | 1071:1786 | NORMAL_TEXT]
The business logic. There are two kinds of participant: contributors, who supply datasets (raw sensor data, processed data, or annotations), and consumers (institutions), who buy them. Every dataset ships with a free public sample and a gated full payload. A buyer can purchase either a copy (a non-exclusive license — others can still buy it) or the exclusive right (they take sole ownership and the dataset is locked to everyone else). Price is either set by the contributor or decided by auction. Any dataset can carry a list of sub-contributors with weights, and every sale automatically splits the revenue among them by weight — this is how many people (e.g., thousands of labelers) get paid from one dataset.

[P00011 | 1786:1787 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00012 | 1787:2104 | NORMAL_TEXT]
Why two protocols. For a clean start, Nurture is the only data contributor (we own the capture hardware). Retail users don't upload datasets — they contribute labels via the Arcade, and we turn their work into weighted attribution on the finished dataset. That split of responsibilities is exactly the two protocols:

[P00013 | 2104:2105 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00014 | 2105:2511 | NORMAL_TEXT | LIST id=kix.i7hy1ojuzs2v level=0]
Main Protocol — the data market. Registers datasets; holds the public sample, the encrypted payload pointer, and the content hash; runs copy and exclusive sales; supports fixed pricing and auctions; and performs weighted revenue splitting so contributors and their sub-contributors can each claim their share of every sale. It is content-agnostic and doesn't care where a dataset or its weights came from.

[P00015 | 2511:2512 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00016 | 2512:3017 | NORMAL_TEXT | LIST id=kix.i7hy1ojuzs2v level=0]
Crowdsourcing Protocol — the label feeder. Records each user's participation in the Arcade and emits an event for it. It holds no money and makes no payouts. Off-chain, Nurture's batch pipeline reads those events, verifies the labels, computes each user's weight, packages the labels together with our raw sensor data, and registers the finished dataset on the Main Protocol with those weights. Labelers thus become sub-contributors and earn — from real sales, not inflation — whenever the dataset sells.

[P00017 | 3017:3018 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00018 | 3018:3280 | NORMAL_TEXT]
The interface between them is a small set of events the Crowdsourcing Protocol emits plus the Main Protocol's registerDataset call (Part 4). The rest of this doc details the design principles, the contracts and functions, that event API, and the security model.

[P00019 | 3280:3281 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00020 | 3281:3283 | NORMAL_TEXT]
[HORIZONTAL_RULE]

[P00021 | 3283:3321 | HEADING_2]
Part 0 — How the two protocols relate

[P00022 | 3321:3388 | NORMAL_TEXT]
   Retail users (Arcade)                     Institutions (buyers)

[P00023 | 3388:3389 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00024 | 3389:3449 | NORMAL_TEXT]
          │ play / label                              │ buy

[P00025 | 3449:3450 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00026 | 3450:3506 | NORMAL_TEXT]
          ▼                                           ▼

[P00027 | 3506:3507 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00028 | 3507:3579 | NORMAL_TEXT]
 ┌─────────────────────────┐              ┌───────────────────────────┐

[P00029 | 3579:3580 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00030 | 3580:3654 | NORMAL_TEXT]
 │  CROWDSOURCING PROTOCOL  │              │      MAIN PROTOCOL         │

[P00031 | 3654:3655 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00032 | 3655:3728 | NORMAL_TEXT]
 │  • records participation │              │  • datasets & ownership   │

[P00033 | 3728:3729 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00034 | 3729:3802 | NORMAL_TEXT]
 │  • emits EVENTS ─────────┼───┐          │  • copy / exclusive sale  │

[P00035 | 3802:3803 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00036 | 3803:3875 | NORMAL_TEXT]
 └─────────────────────────┘   │          │  • pricing / auction      │

[P00037 | 3875:3876 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00038 | 3876:3948 | NORMAL_TEXT]
                               │          │  • revenue split (weights)│

[P00039 | 3948:3949 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00040 | 3949:4021 | NORMAL_TEXT]
                               ▼          └─────────────▲─────────────┘

[P00041 | 4021:4022 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00042 | 4022:4109 | NORMAL_TEXT]
                    ┌────────────────────────┐          │ registerDataset(weightsRoot)

[P00043 | 4109:4110 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00044 | 4110:4193 | NORMAL_TEXT]
                    │  BATCH PIPELINE (Nurture)│─────────┘  (off-chain → on-chain)

[P00045 | 4193:4194 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00046 | 4194:4243 | NORMAL_TEXT]
                    │  reads events → verifies │

[P00047 | 4243:4244 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00048 | 4244:4293 | NORMAL_TEXT]
                    │  labels → computes       │

[P00049 | 4293:4294 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00050 | 4294:4343 | NORMAL_TEXT]
                    │  weights → packages data │

[P00051 | 4343:4344 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00052 | 4344:4391 | NORMAL_TEXT]
                    └────────────────────────┘

[P00053 | 4391:4392 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00054 | 4392:4886 | NORMAL_TEXT]
The Crowdsourcing Protocol emits events; an off-chain Batch Pipeline (run by Nurture) consumes them, verifies the labels, computes each labeler's weight, packages the labels together with Nurture's raw sensor data into a dataset, and calls registerDataset on the Main Protocol with a Merkle root of those weights. When that dataset later sells, the Main Protocol splits revenue to every weighted sub-contributor — i.e., the labelers get paid when the data sells, not from an inflationary pool.

[P00055 | 4886:4887 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00056 | 4887:5115 | NORMAL_TEXT]
The two protocols are decoupled: the Crowdsourcing Protocol never calls the Main Protocol directly. The pipeline sits between them, and the events + the registerDataset signature are the entire contract between the two systems.

[P00057 | 5115:5116 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00058 | 5116:5118 | NORMAL_TEXT]
[HORIZONTAL_RULE]

[P00059 | 5118:5162 | HEADING_2]
Part 1 — Business logic & design principles

[P00060 | 5162:5198 | HEADING_3]
1.1 Main Protocol — what it must do

[P00061 | 5198:5315 | NORMAL_TEXT | LIST id=kix.i7hy1ojuzs2v level=0]
Contributors register datasets (raw sensor data, processed data, or annotations — the protocol is content-agnostic).

[P00062 | 5315:5420 | NORMAL_TEXT | LIST id=kix.i7hy1ojuzs2v level=0]
Every dataset has a public sample (always open, free) and a gated full payload (only buyers can access).

[P00063 | 5420:5452 | NORMAL_TEXT | LIST id=kix.i7hy1ojuzs2v level=0]
A dataset can be sold two ways:

[P00064 | 5452:5565 | NORMAL_TEXT | LIST id=kix.i7hy1ojuzs2v level=1]
Copy (non-exclusive license): the buyer gets the right to use it; others can still buy it too. Unlimited copies.

[P00065 | 5565:5690 | NORMAL_TEXT | LIST id=kix.i7hy1ojuzs2v level=1]
Exclusive right: one buyer takes exclusive ownership; the dataset is then locked and no one else can buy or gain new access.

[P00066 | 5690:5755 | NORMAL_TEXT | LIST id=kix.i7hy1ojuzs2v level=0]
Pricing is either contributor-set (fixed) or auction-determined.

[P00067 | 5755:5981 | NORMAL_TEXT | LIST id=kix.i7hy1ojuzs2v level=0]
A contributor can attach a list of sub-contributors and weights to a dataset. On every sale, the payout (net of protocol fee) is split across those sub-contributors by weight. This is what makes crowdsourced attribution work.

[P00068 | 5981:6026 | HEADING_3]
1.2 Crowdsourcing Protocol — what it must do

[P00069 | 6026:6187 | NORMAL_TEXT | LIST id=kix.i7hy1ojuzs2v level=0]
For a clean start, Nurture is the sole data contributor. Retail users don't contribute datasets directly; they contribute labels/annotations through the Arcade.

[P00070 | 6187:6293 | NORMAL_TEXT | LIST id=kix.i7hy1ojuzs2v level=0]
The protocol records each user's participation in the labeling game and emits an event per participation.

[P00071 | 6293:6605 | NORMAL_TEXT | LIST id=kix.i7hy1ojuzs2v level=0]
Nurture runs a batch pipeline that reads all participation events, verifies the labels (consensus + honeypots, off-chain), computes per-user weights based on participation and quality, packages the labels with the underlying sensor data, and uploads the finished dataset to the Main Protocol with those weights.

[P00072 | 6605:6719 | NORMAL_TEXT | LIST id=kix.i7hy1ojuzs2v level=0]
Result: labelers become sub-contributors of the packaged dataset and earn their weighted share whenever it sells.

[P00073 | 6719:6770 | HEADING_3]
1.3 Design principles (read these before the code)

[P00074 | 6770:7088 | NORMAL_TEXT | LIST id=kix.5qm4r181x3ko level=0]
Thin on-chain, heavy off-chain. The chain records rights, money, and commitments. Valuation, quality scoring, and weight computation are off-chain in the pipeline; only their results (price, weights root, content hash) are anchored on-chain. This keeps gas low and lets us evolve the ML without redeploying contracts.

[P00075 | 7088:7089 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00076 | 7089:7382 | NORMAL_TEXT | LIST id=kix.5qm4r181x3ko level=0]
Data off-chain; rights on-chain (Data Titles). Datasets never touch the chain. On-chain we store metadata, a content hash (integrity), a public sample URI, an encrypted payload URI, and entitlements (who may access). An off-chain Access Gateway enforces entitlements before serving keys/data.

[P00077 | 7382:7383 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00078 | 7383:7723 | NORMAL_TEXT | LIST id=kix.5qm4r181x3ko level=0]
Market sets price; the pipeline sets weights. Per the spec, on-chain value = market price (fixed or auction), not an algorithm. Off-chain, the pipeline may use novelty/quality models to suggest prices and to compute weights, but the protocol itself stays a simple, auditable market. Intelligence lives off-chain; settlement lives on-chain.

[P00079 | 7723:7724 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00080 | 7724:7964 | NORMAL_TEXT | LIST id=kix.5qm4r181x3ko level=0]
Value-backed rewards (no inflation). Labelers are paid as sub-contributors out of real sale revenue, not from a printed token. This is deliberate — it avoids the emissions-outrun-sinks death spiral and keeps rewards tied to genuine demand.

[P00081 | 7964:7965 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00082 | 7965:8292 | NORMAL_TEXT | LIST id=kix.5qm4r181x3ko level=0]
Pull-based, Merkle-scalable payouts. A single dataset may have thousands of sub-contributors (labelers). We never push funds to N addresses on a sale. Revenue accrues to the dataset; each sub-contributor claims their share by supplying a Merkle proof of their weight. Cost is O(1) per sale and O(1) per claim, regardless of N.

[P00083 | 8292:8293 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00084 | 8293:8697 | NORMAL_TEXT | LIST id=kix.5qm4r181x3ko level=0]
Exclusivity is a forward guarantee, honestly scoped. On-chain we can guarantee no future sales/access once a dataset is sold exclusively. We cannot claw back bytes a copy-buyer already downloaded (no DRM does). So a contributor who wants to sell true exclusivity can flag a dataset exclusive-only-if-zero-copies-sold; otherwise "exclusive" means "from now on, no one else." State this to buyers plainly.

[P00085 | 8697:8698 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00086 | 8698:8978 | NORMAL_TEXT | LIST id=kix.5qm4r181x3ko level=0]
Permissioned start, permissionless-ready. For the clean start, only allowlisted contributors (Nurture) can register datasets. The design keeps a ContributorRegistry role so this can open up later without redesign. Buyers are permissionless (or KYC-gated via a hook) from day one.

[P00087 | 8978:8979 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00088 | 8979:9232 | NORMAL_TEXT | LIST id=kix.5qm4r181x3ko level=0]
Optimistic, challengeable off-chain work. Weight computation and packaging are done by Nurture but anchored (roots + published leaves) so they can be independently recomputed and challenged. Reuse the optimistic pattern from the valuation architecture.

[P00089 | 9232:9233 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00090 | 9233:9440 | NORMAL_TEXT | LIST id=kix.5qm4r181x3ko level=0]
Decoupled protocols, evented interface. The Crowdsourcing Protocol and Main Protocol share no direct calls. The Crowdsourcing Protocol's events are the API; the pipeline is the only actor that bridges them.

[P00091 | 9440:9441 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00092 | 9441:9443 | NORMAL_TEXT]
[HORIZONTAL_RULE]

[P00093 | 9443:9473 | HEADING_2]
Part 2 — Main Protocol design

[P00094 | 9473:9488 | HEADING_3]
2.1 Data model

[P00095 | 9491:9498 | NORMAL_TEXT | TABLE row=0 col=0]
Struct

[P00096 | 9499:9510 | NORMAL_TEXT | TABLE row=0 col=1]
Key fields

[P00097 | 9511:9517 | NORMAL_TEXT | TABLE row=0 col=2]
Notes

[P00098 | 9519:9527 | NORMAL_TEXT | TABLE row=1 col=0]
Dataset

[P00099 | 9528:9650 | NORMAL_TEXT | TABLE row=1 col=1]
id, contributor, contentHash, sampleURI, payloadURI, weightsRoot, totalWeight, status, policy, copiesSold, tag, createdAt

[P00100 | 9651:9682 | NORMAL_TEXT | TABLE row=1 col=2]
The core asset ("Data Title").

[P00101 | 9684:9695 | NORMAL_TEXT | TABLE row=2 col=0]
SalePolicy

[P00102 | 9696:9773 | NORMAL_TEXT | TABLE row=2 col=1]
allowCopy, allowExclusive, exclusiveRequiresZeroCopies, licensesTransferable

[P00103 | 9774:9802 | NORMAL_TEXT | TABLE row=2 col=2]
Contributor-declared rules.

[P00104 | 9804:9812 | NORMAL_TEXT | TABLE row=3 col=0]
Listing

[P00105 | 9813:9895 | NORMAL_TEXT | TABLE row=3 col=1]
datasetId, kind{Copy,Exclusive}, pricing{Fixed,Auction}, price, auctionId, active

[P00106 | 9896:9959 | NORMAL_TEXT | TABLE row=3 col=2]
A dataset may have a copy listing and/or an exclusive listing.

[P00107 | 9961:9969 | NORMAL_TEXT | TABLE row=4 col=0]
Auction

[P00108 | 9970:10042 | NORMAL_TEXT | TABLE row=4 col=1]
datasetId, seller, reserve, endTime, highestBid, highestBidder, settled

[P00109 | 10043:10086 | NORMAL_TEXT | TABLE row=4 col=2]
English auction for exclusive rights (v1).

[P00110 | 10088:10108 | NORMAL_TEXT | TABLE row=5 col=0]
Entitlement (token)

[P00111 | 10109:10150 | NORMAL_TEXT | TABLE row=5 col=1]
ERC-1155 tokenId = hash(datasetId, kind)

[P00112 | 10151:10202 | NORMAL_TEXT | TABLE row=5 col=2]
Copy license or exclusive title; balance = access.

[P00113 | 10203:10204 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00114 | 10204:10268 | NORMAL_TEXT]
enum DatasetStatus { Draft, Listed, ExclusivelySold, Delisted }

[P00115 | 10268:10269 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00116 | 10269:10307 | NORMAL_TEXT]
enum SaleKind     { Copy, Exclusive }

[P00117 | 10307:10308 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00118 | 10308:10345 | NORMAL_TEXT]
enum PricingType  { Fixed, Auction }

[P00119 | 10345:10346 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00120 | 10346:10366 | NORMAL_TEXT]
struct SalePolicy {

[P00121 | 10366:10367 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00122 | 10367:10387 | NORMAL_TEXT]
    bool allowCopy;

[P00123 | 10387:10388 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00124 | 10388:10413 | NORMAL_TEXT]
    bool allowExclusive;

[P00125 | 10413:10414 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00126 | 10414:10488 | NORMAL_TEXT]
    bool exclusiveRequiresZeroCopies; // true => offer *true* exclusivity

[P00127 | 10488:10489 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00128 | 10489:10567 | NORMAL_TEXT]
    bool licensesTransferable;        // copy-license resale on/off (v1: off)

[P00129 | 10567:10568 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00130 | 10568:10570 | NORMAL_TEXT]
}

[P00131 | 10570:10571 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00132 | 10571:10588 | NORMAL_TEXT]
struct Dataset {

[P00133 | 10588:10589 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00134 | 10589:10610 | NORMAL_TEXT]
    uint256      id;

[P00135 | 10610:10611 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00136 | 10611:10682 | NORMAL_TEXT]
    address      contributor;   // primary contributor (e.g., Nurture)

[P00137 | 10682:10683 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00138 | 10683:10768 | NORMAL_TEXT]
    bytes32      contentHash;    // keccak of the encrypted full payload (integrity)

[P00139 | 10768:10769 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00140 | 10769:10832 | NORMAL_TEXT]
    string       sampleURI;      // PUBLIC sample, always open

[P00141 | 10832:10833 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00142 | 10833:10915 | NORMAL_TEXT]
    string       payloadURI;     // encrypted full data (gated by Access Gateway)

[P00143 | 10915:10916 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00144 | 10916:11006 | NORMAL_TEXT]
    bytes32      weightsRoot;     // Merkle root of leaves keccak(subContributor, weight)

[P00145 | 11006:11007 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00146 | 11007:11078 | NORMAL_TEXT]
    uint256      totalWeight;     // Σ weights (fixed at registration)

[P00147 | 11078:11079 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00148 | 11079:11105 | NORMAL_TEXT]
    DatasetStatus status;

[P00149 | 11105:11106 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00150 | 11106:11131 | NORMAL_TEXT]
    SalePolicy   policy;

[P00151 | 11131:11132 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00152 | 11132:11161 | NORMAL_TEXT]
    uint64       copiesSold;

[P00153 | 11161:11162 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00154 | 11162:11222 | NORMAL_TEXT]
    string       tag;            // optional shard/category

[P00155 | 11222:11223 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00156 | 11223:11251 | NORMAL_TEXT]
    uint64       createdAt;

[P00157 | 11251:11252 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00158 | 11252:11254 | NORMAL_TEXT]
}

[P00159 | 11254:11255 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00160 | 11255:11453 | NORMAL_TEXT]
Weights are fixed at registration (or, at latest, before the first listing). This keeps the revenue accumulator (2.4) mathematically sound. If a re-split is ever needed, it's a new dataset version.

[P00161 | 11453:11486 | HEADING_3]
2.2 Contracts & responsibilities

[P00162 | 11489:11498 | NORMAL_TEXT | TABLE row=0 col=0]
Contract

[P00163 | 11499:11514 | NORMAL_TEXT | TABLE row=0 col=1]
Responsibility

[P00164 | 11516:11536 | NORMAL_TEXT | TABLE row=1 col=0]
ContributorRegistry

[P00165 | 11537:11639 | NORMAL_TEXT | TABLE row=1 col=1]
Allowlist + roles (admin, operator/pipeline, contributor). Gates registerDataset for the clean start.

[P00166 | 11641:11657 | NORMAL_TEXT | TABLE row=2 col=0]
DatasetRegistry

[P00167 | 11658:11746 | NORMAL_TEXT | TABLE row=2 col=1]
Create/store Dataset records; hold sample/payload pointers, content hash, weights root.

[P00168 | 11748:11760 | NORMAL_TEXT | TABLE row=3 col=0]
Marketplace

[P00169 | 11761:11858 | NORMAL_TEXT | TABLE row=3 col=1]
Listings, buyCopy, buyExclusive, exclusivity state machine, fee handling, calls into settlement.

[P00170 | 11860:11873 | NORMAL_TEXT | TABLE row=4 col=0]
AuctionHouse

[P00171 | 11874:11954 | NORMAL_TEXT | TABLE row=4 col=1]
English auction for exclusive rights; on settle, grants title + routes payment.

[P00172 | 11956:11982 | NORMAL_TEXT | TABLE row=5 col=0]
EntitlementNFT (ERC-1155)

[P00173 | 11983:12060 | NORMAL_TEXT | TABLE row=5 col=1]
Mint copy licenses / exclusive titles; hasAccess() view used by the gateway.

[P00174 | 12062:12078 | NORMAL_TEXT | TABLE row=6 col=0]
RevenueSplitter

[P00175 | 12079:12150 | NORMAL_TEXT | TABLE row=6 col=1]
Per-dataset revenue accrual + Merkle-proof claims by sub-contributors.

[P00176 | 12152:12167 | NORMAL_TEXT | TABLE row=7 col=0]
ProtocolConfig

[P00177 | 12168:12236 | NORMAL_TEXT | TABLE row=7 col=1]
Payment token, fee bps, treasury, pause switch, gateway signer key.

[P00178 | 12238:12273 | NORMAL_TEXT | TABLE row=8 col=0]
Access Gateway (off-chain service)

[P00179 | 12274:12384 | NORMAL_TEXT | TABLE row=8 col=1]
Verifies on-chain entitlement, then delivers decryption key / data. Not a contract, but part of the protocol.

[P00180 | 12385:12417 | HEADING_3]
2.3 Key flows & function sketch

[P00181 | 12417:12446 | NORMAL_TEXT]
interface IDatasetRegistry {

[P00182 | 12446:12447 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00183 | 12447:12475 | NORMAL_TEXT]
    struct RegisterParams {

[P00184 | 12475:12476 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00185 | 12476:12505 | NORMAL_TEXT]
        bytes32 contentHash;

[P00186 | 12505:12506 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00187 | 12506:12533 | NORMAL_TEXT]
        string  sampleURI;

[P00188 | 12533:12534 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00189 | 12534:12562 | NORMAL_TEXT]
        string  payloadURI;

[P00190 | 12562:12563 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00191 | 12563:12592 | NORMAL_TEXT]
        bytes32 weightsRoot;

[P00192 | 12592:12593 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00193 | 12593:12622 | NORMAL_TEXT]
        uint256 totalWeight;

[P00194 | 12622:12623 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00195 | 12623:12650 | NORMAL_TEXT]
        SalePolicy policy;

[P00196 | 12650:12651 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00197 | 12651:12672 | NORMAL_TEXT]
        string  tag;

[P00198 | 12672:12673 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00199 | 12673:12679 | NORMAL_TEXT]
    }

[P00200 | 12679:12680 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00201 | 12680:12756 | NORMAL_TEXT]
    /// Only allowlisted contributors (clean start: Nurture). Called by the

[P00202 | 12756:12757 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00203 | 12757:12836 | NORMAL_TEXT]
    /// batch pipeline for crowdsourced datasets, or by any contributor later.

[P00204 | 12836:12837 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00205 | 12837:12931 | NORMAL_TEXT]
    function registerDataset(RegisterParams calldata p) external returns (uint256 datasetId);

[P00206 | 12931:12932 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00207 | 12932:13015 | NORMAL_TEXT]
    function getDataset(uint256 datasetId) external view returns (Dataset memory);

[P00208 | 13015:13016 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00209 | 13016:13018 | NORMAL_TEXT]
}

[P00210 | 13018:13019 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00211 | 13019:13044 | NORMAL_TEXT]
interface IMarketplace {

[P00212 | 13044:13045 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00213 | 13045:13079 | NORMAL_TEXT]
    // Listing (contributor-only)

[P00214 | 13079:13080 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00215 | 13080:13146 | NORMAL_TEXT]
    function listCopy(uint256 datasetId, uint256 price) external;

[P00216 | 13146:13147 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00217 | 13147:13223 | NORMAL_TEXT]
    function listExclusiveFixed(uint256 datasetId, uint256 price) external;

[P00218 | 13223:13224 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00219 | 13224:13321 | NORMAL_TEXT]
    function listExclusiveAuction(uint256 datasetId, uint256 reserve, uint64 duration) external;

[P00220 | 13321:13322 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00221 | 13322:13386 | NORMAL_TEXT]
    function delist(uint256 datasetId, SaleKind kind) external;

[P00222 | 13386:13387 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00223 | 13387:13411 | NORMAL_TEXT]
    // Purchase (buyer)

[P00224 | 13411:13412 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00225 | 13412:13491 | NORMAL_TEXT]
    function buyCopy(uint256 datasetId) external;       // token-approve first

[P00226 | 13491:13492 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00227 | 13492:13573 | NORMAL_TEXT]
    function buyExclusive(uint256 datasetId) external;  // fixed-price exclusive

[P00228 | 13573:13574 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00229 | 13574:13587 | NORMAL_TEXT]
    // Views

[P00230 | 13587:13588 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00231 | 13588:13676 | NORMAL_TEXT]
    function priceOf(uint256 datasetId, SaleKind kind) external view returns (uint256);

[P00232 | 13676:13677 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00233 | 13677:13679 | NORMAL_TEXT]
}

[P00234 | 13679:13680 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00235 | 13680:13694 | NORMAL_TEXT]
buyCopy logic

[P00236 | 13694:13695 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00237 | 13695:13760 | NORMAL_TEXT | LIST id=kix.z7ca54606rit level=0]
Require status == Listed, policy.allowCopy, copy listing active.

[P00238 | 13760:13891 | NORMAL_TEXT | LIST id=kix.z7ca54606rit level=0]
Pull price in the payment token from buyer → RevenueSplitter._accrue(datasetId, price) (which takes the protocol fee off the top).

[P00239 | 13891:13962 | NORMAL_TEXT | LIST id=kix.z7ca54606rit level=0]
EntitlementNFT.mint(buyer, tokenId(datasetId, Copy), 1); copiesSold++.

[P00240 | 13962:14007 | NORMAL_TEXT | LIST id=kix.z7ca54606rit level=0]
Emit CopyPurchased(datasetId, buyer, price).

[P00241 | 14007:14008 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00242 | 14008:14043 | NORMAL_TEXT]
buyExclusive logic (state machine)

[P00243 | 14043:14044 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00244 | 14044:14119 | NORMAL_TEXT | LIST id=kix.xo5izpe3vs6g level=0]
Require status == Listed, policy.allowExclusive, exclusive listing active.

[P00245 | 14119:14184 | NORMAL_TEXT | LIST id=kix.xo5izpe3vs6g level=0]
If policy.exclusiveRequiresZeroCopies → require copiesSold == 0.

[P00246 | 14184:14206 | NORMAL_TEXT | LIST id=kix.xo5izpe3vs6g level=0]
Pull price → _accrue.

[P00247 | 14206:14335 | NORMAL_TEXT | LIST id=kix.xo5izpe3vs6g level=0]
status = ExclusivelySold; deactivate all listings for the dataset; EntitlementNFT.mint(buyer, tokenId(datasetId, Exclusive), 1).

[P00248 | 14335:14416 | NORMAL_TEXT | LIST id=kix.xo5izpe3vs6g level=0]
Emit ExclusivePurchased(datasetId, buyer, price). No further sales are possible.

[P00249 | 14416:14417 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00250 | 14417:14457 | NORMAL_TEXT]
Auction (exclusive rights, English, v1)

[P00251 | 14457:14458 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00252 | 14458:14484 | NORMAL_TEXT]
interface IAuctionHouse {

[P00253 | 14484:14485 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00254 | 14485:14575 | NORMAL_TEXT]
    function bid(uint256 auctionId) external;          // escrow highest, refund previous

[P00255 | 14575:14576 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00256 | 14576:14648 | NORMAL_TEXT]
    function settle(uint256 auctionId) external;       // after endTime

[P00257 | 14648:14649 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00258 | 14649:14651 | NORMAL_TEXT]
}

[P00259 | 14651:14652 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00260 | 14652:14916 | NORMAL_TEXT]
On settle: if highestBid >= reserve, _accrue(datasetId, highestBid), mint exclusive title to highestBidder, transition dataset to ExclusivelySold. Losing bids are refunded on being outbid (pull-safe). (Sealed-bid commit-reveal is a later option for anti-sniping.)

[P00261 | 14916:14965 | HEADING_3]
2.4 Revenue split mechanism (the important part)

[P00262 | 14965:15242 | NORMAL_TEXT]
Revenue arrives over time (copies sell one by one; an exclusive sale is a lump). Sub-contributors are not registered on-chain — they're leaves in a Merkle tree — so we need an accrual scheme that supports streaming revenue and proof-based claims without iterating N addresses.

[P00263 | 15242:15243 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00264 | 15243:15263 | NORMAL_TEXT]
Accrual (per sale):

[P00265 | 15263:15264 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00266 | 15264:15294 | NORMAL_TEXT]
fee = gross * feeBps / 10_000

[P00267 | 15294:15295 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00268 | 15295:15313 | NORMAL_TEXT]
net = gross - fee

[P00269 | 15313:15314 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00270 | 15314:15337 | NORMAL_TEXT]
treasuryBalance += fee

[P00271 | 15337:15338 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00272 | 15338:15407 | NORMAL_TEXT]
cumulativeRevenue[datasetId] += net      // monotonically increasing

[P00273 | 15407:15408 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00274 | 15408:15447 | NORMAL_TEXT]
Claim (per sub-contributor, any time):

[P00275 | 15447:15448 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00276 | 15448:15498 | NORMAL_TEXT]
leaf  = keccak256(abi.encode(msg.sender, weight))

[P00277 | 15498:15499 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00278 | 15499:15560 | NORMAL_TEXT]
require MerkleProof.verify(proof, dataset.weightsRoot, leaf)

[P00279 | 15560:15561 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00280 | 15561:15628 | NORMAL_TEXT]
// this claimant's lifetime entitlement, given all revenue so far:

[P00281 | 15628:15629 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00282 | 15629:15700 | NORMAL_TEXT]
entitled = weight * cumulativeRevenue[datasetId] / dataset.totalWeight

[P00283 | 15700:15701 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00284 | 15701:15754 | NORMAL_TEXT]
owed     = entitled - claimed[datasetId][msg.sender]

[P00285 | 15754:15755 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00286 | 15755:15772 | NORMAL_TEXT]
require owed > 0

[P00287 | 15772:15773 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00288 | 15773:15812 | NORMAL_TEXT]
claimed[datasetId][msg.sender] += owed

[P00289 | 15812:15813 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00290 | 15813:15853 | NORMAL_TEXT]
paymentToken.transfer(msg.sender, owed)

[P00291 | 15853:15854 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00292 | 15854:15883 | NORMAL_TEXT]
interface IRevenueSplitter {

[P00293 | 15883:15884 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00294 | 15884:15974 | NORMAL_TEXT]
    function claim(uint256 datasetId, uint256 weight, bytes32[] calldata proof) external;

[P00295 | 15974:15975 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00296 | 15975:16079 | NORMAL_TEXT]
    function claimable(uint256 datasetId, address who, uint256 weight) external view returns (uint256);

[P00297 | 16079:16080 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00298 | 16080:16082 | NORMAL_TEXT]
}

[P00299 | 16082:16083 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00300 | 16083:16566 | NORMAL_TEXT]
Why this works: cumulativeRevenue only grows; entitled is always weight/totalWeight of it; claimed tracks what each address already took. A sub-contributor can claim once or batch across many sales; late claims still get the full historical share. It's the classic "cumulative-per-share minus debt" pattern, adapted to Merkle-identified recipients. Nurture itself is simply one leaf (with a large weight representing the raw-sensor-data contribution); labelers are the other leaves.

[P00301 | 16566:16567 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00302 | 16567:16745 | NORMAL_TEXT]
Publishing leaves: the pipeline posts the full (address, weight) list off-chain (IPFS/DA/CDN) so any sub-contributor can look up their weight + proof. Only the root is on-chain.

[P00303 | 16745:16780 | HEADING_3]
2.5 Access control & data delivery

[P00304 | 16780:16848 | NORMAL_TEXT]
The chain answers one question — "is this address entitled?" — via:

[P00305 | 16848:16849 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00306 | 16849:16931 | NORMAL_TEXT]
function hasAccess(uint256 datasetId, address who) external view returns (bool) {

[P00307 | 16931:16932 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00308 | 16932:16975 | NORMAL_TEXT]
    if (dataset.status == ExclusivelySold)

[P00309 | 16975:16976 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00310 | 16976:17057 | NORMAL_TEXT]
        return EntitlementNFT.balanceOf(who, tokenId(datasetId, Exclusive)) > 0;

[P00311 | 17057:17058 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00312 | 17058:17129 | NORMAL_TEXT]
    return EntitlementNFT.balanceOf(who, tokenId(datasetId, Copy)) > 0

[P00313 | 17129:17130 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00314 | 17130:17207 | NORMAL_TEXT]
        || EntitlementNFT.balanceOf(who, tokenId(datasetId, Exclusive)) > 0;

[P00315 | 17207:17208 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00316 | 17208:17210 | NORMAL_TEXT]
}

[P00317 | 17210:17211 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00318 | 17211:17278 | NORMAL_TEXT]
The public sample (sampleURI) is served openly and needs no check.

[P00319 | 17278:17279 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00320 | 17279:17348 | NORMAL_TEXT]
Delivery of the gated payload (v1 recommended: envelope encryption):

[P00321 | 17348:17349 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00322 | 17349:17440 | NORMAL_TEXT | LIST id=kix.g5jq6sqzvc9n level=0]
Payload encrypted once with a random data key; stored at payloadURI; contentHash anchored.

[P00323 | 17440:17517 | NORMAL_TEXT | LIST id=kix.g5jq6sqzvc9n level=0]
Buyer authenticates to the Gateway by signing a challenge with their wallet.

[P00324 | 17517:17673 | NORMAL_TEXT | LIST id=kix.g5jq6sqzvc9n level=0]
Gateway calls hasAccess(datasetId, buyer); if true, re-encrypts the data key to the buyer's public key and returns it (buyer decrypts payload client-side).

[P00325 | 17673:17894 | NORMAL_TEXT | LIST id=kix.g5jq6sqzvc9n level=0]
Trust-minimization roadmap: move key custody to a threshold/MPC or TEE service so no single Gateway operator can leak keys. (Same spectrum as the valuation-doc's forward-pass verification: start pragmatic, harden later.)

[P00326 | 17894:17941 | HEADING_3]
2.6 Exclusivity semantics (say this to buyers)

[P00327 | 17941:18301 | NORMAL_TEXT]
On-chain guarantees, once ExclusivelySold: no new copy sales, no new exclusive sales, no new entitlements minted — enforced by the state machine. It does not revoke bytes already delivered to prior copy-buyers. Contributors wanting true exclusivity set exclusiveRequiresZeroCopies = true, which makes the dataset exclusive-eligible only while copiesSold == 0.

[P00328 | 18301:18302 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00329 | 18302:18304 | NORMAL_TEXT]
[HORIZONTAL_RULE]

[P00330 | 18304:18343 | HEADING_2]
Part 3 — Crowdsourcing Protocol design

[P00331 | 18343:18397 | HEADING_3]
3.1 Flow (Arcade → events → pipeline → Main Protocol)

[P00332 | 18397:18469 | NORMAL_TEXT | LIST id=kix.u6zycxqpzp8i level=0]
Operator opens an epoch for a task type (RealOrJunk / SameOrDifferent).

[P00333 | 18469:18702 | NORMAL_TEXT | LIST id=kix.u6zycxqpzp8i level=0]
Arcade users submit their work for that epoch — one submission can cover many tasks. Each submission records a commit hash (hides answers to prevent copying, per the Arcade PRD) and an item count. Each submission emits Participated.

[P00334 | 18702:18790 | NORMAL_TEXT | LIST id=kix.u6zycxqpzp8i level=0]
Operator closes the epoch, anchoring a participation root (all submissions) and totals.

[P00335 | 18790:19081 | NORMAL_TEXT | LIST id=kix.u6zycxqpzp8i level=0]
The Batch Pipeline (off-chain) reads Participated + EpochClosed, collects the revealed answers (submitted to Nurture's service, verified against the on-chain commit hashes), runs consensus + honeypot scoring to get each user's quality-weighted contribution, and computes normalized weights.

[P00336 | 19081:19280 | NORMAL_TEXT | LIST id=kix.u6zycxqpzp8i level=0]
Pipeline packages the finished dataset (labels + Nurture's raw sensor data), uploads it, and calls registerDataset on the Main Protocol with the weightsRoot (Nurture + all labelers) and totalWeight.

[P00337 | 19280:19536 | NORMAL_TEXT | LIST id=kix.u6zycxqpzp8i level=0]
Pipeline calls anchorPackaging on the Crowdsourcing Protocol, which emits BatchPackaged linking the epochs → the new datasetId + weightsRoot. Labelers can now find the dataset they contributed to and, once it sells, claim their share on the Main Protocol.

[P00338 | 19536:19551 | HEADING_3]
3.2 Data model

[P00339 | 19551:19615 | NORMAL_TEXT]
enum TaskType   { RealOrJunk, SameOrDifferent }   // extensible

[P00340 | 19615:19616 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00341 | 19616:19679 | NORMAL_TEXT]
enum EpochPhase { Open, CommitClosed, RevealClosed, Packaged }

[P00342 | 19679:19680 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00343 | 19680:19695 | NORMAL_TEXT]
struct Epoch {

[P00344 | 19695:19696 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00345 | 19696:19715 | NORMAL_TEXT]
    uint256    id;

[P00346 | 19715:19716 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00347 | 19716:19741 | NORMAL_TEXT]
    TaskType   taskType;

[P00348 | 19741:19742 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00349 | 19742:19768 | NORMAL_TEXT]
    uint64     startTime;

[P00350 | 19768:19769 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00351 | 19769:19800 | NORMAL_TEXT]
    uint64     commitDeadline;

[P00352 | 19800:19801 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00353 | 19801:19832 | NORMAL_TEXT]
    uint64     revealDeadline;

[P00354 | 19832:19833 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00355 | 19833:19855 | NORMAL_TEXT]
    EpochPhase phase;

[P00356 | 19855:19856 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00357 | 19856:19906 | NORMAL_TEXT]
    bytes32    participationRoot; // set on close

[P00358 | 19906:19907 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00359 | 19907:19940 | NORMAL_TEXT]
    uint64     participantCount;

[P00360 | 19940:19941 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00361 | 19941:20010 | NORMAL_TEXT]
    uint64     itemCount;         // total tasks judged in the epoch

[P00362 | 20010:20011 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00363 | 20011:20013 | NORMAL_TEXT]
}

[P00364 | 20013:20044 | HEADING_3]
3.3 Contract & function sketch

[P00365 | 20044:20071 | NORMAL_TEXT]
interface ICrowdsourcing {

[P00366 | 20071:20072 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00367 | 20072:20106 | NORMAL_TEXT]
    // --- Operator (Nurture) ---

[P00368 | 20106:20107 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00369 | 20107:20195 | NORMAL_TEXT]
    function openEpoch(TaskType taskType, uint64 commitDeadline, uint64 revealDeadline)

[P00370 | 20195:20196 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00371 | 20196:20240 | NORMAL_TEXT]
        external returns (uint256 epochId);

[P00372 | 20240:20241 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00373 | 20241:20309 | NORMAL_TEXT]
    function closeEpoch(uint256 epochId, bytes32 participationRoot,

[P00374 | 20309:20310 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00375 | 20310:20387 | NORMAL_TEXT]
                        uint64 participantCount, uint64 itemCount) external;

[P00376 | 20387:20388 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00377 | 20388:20480 | NORMAL_TEXT]
    /// Called after the pipeline has registered the packaged dataset on the Main Protocol.

[P00378 | 20480:20481 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00379 | 20481:20574 | NORMAL_TEXT]
    /// Links crowdsourcing epochs → the resulting datasetId + weights. Emits BatchPackaged.

[P00380 | 20574:20575 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00381 | 20575:20661 | NORMAL_TEXT]
    function anchorPackaging(uint256 datasetId, uint256 epochStart, uint256 epochEnd,

[P00382 | 20661:20662 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00383 | 20662:20757 | NORMAL_TEXT]
                            bytes32 weightsRoot, bytes32 dataHash, uint64 itemCount) external;

[P00384 | 20757:20758 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00385 | 20758:20787 | NORMAL_TEXT]
    // --- User (Arcade) ---

[P00386 | 20787:20788 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00387 | 20788:20879 | NORMAL_TEXT]
    /// One submission may cover many tasks. commitHash hides the answers (commit-reveal).

[P00388 | 20879:20880 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00389 | 20880:20967 | NORMAL_TEXT]
    /// Emits Participated. Can be called directly by the user, or by the operator via

[P00390 | 20967:20968 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00391 | 20968:21030 | NORMAL_TEXT]
    /// meta-tx/batched relay to keep it gasless for players.

[P00392 | 21030:21031 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00393 | 21031:21106 | NORMAL_TEXT]
    function submit(uint256 epochId, bytes32 commitHash, uint32 itemCount)

[P00394 | 21106:21107 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00395 | 21107:21156 | NORMAL_TEXT]
        external returns (uint256 submissionId);

[P00396 | 21156:21157 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00397 | 21157:21225 | NORMAL_TEXT]
    function submitBatch(uint256 epochId, address[] calldata users,

[P00398 | 21225:21226 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00399 | 21226:21341 | NORMAL_TEXT]
                        bytes32[] calldata commitHashes, uint32[] calldata itemCounts) external; // operator relay

[P00400 | 21341:21342 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00401 | 21342:21344 | NORMAL_TEXT]
}

[P00402 | 21344:21345 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00403 | 21345:21352 | NORMAL_TEXT]
Notes:

[P00404 | 21352:21353 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00405 | 21353:21685 | NORMAL_TEXT | LIST id=kix.w561pn6hfz3h level=0]
Reveals happen off-chain. Users send (answers, salt) to Nurture's service; the pipeline verifies keccak(...) == commitHash from the on-chain event. This keeps per-tap cost at zero while preserving verifiability (commit is anchored before reveal). If a fully trustless reveal is later required, add an on-chain revealRoot per epoch.

[P00406 | 21685:21912 | NORMAL_TEXT | LIST id=kix.w561pn6hfz3h level=0]
Gasless play: players should not pay gas. Use submitBatch via an operator relay (or ERC-2771 meta-tx) so the Arcade backend anchors participation on the users' behalf; the user field in the event is still the player's address.

[P00407 | 21912:22036 | NORMAL_TEXT | LIST id=kix.w561pn6hfz3h level=0]
The Crowdsourcing Protocol holds no funds and does no payout — all money flows through the Main Protocol's RevenueSplitter.

[P00408 | 22036:22084 | HEADING_3]
3.4 Batch Pipeline (off-chain) responsibilities

[P00409 | 22084:22581 | NORMAL_TEXT]
Reads events → verifies reveals against commit hashes → runs consensus + honeypot quality (Arcade PRD §11) → computes per-user quality-weighted contribution → normalizes to integer weights (and assigns Nurture a weight for the raw data) → builds the Merkle tree of (address, weight) → packages + encrypts the dataset → registerDataset on Main → anchorPackaging on Crowdsourcing → publishes leaves off-chain. The pipeline is the only trusted bridge; its outputs (roots) are challengeable (Part 5).

[P00410 | 22581:22582 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00411 | 22582:22584 | NORMAL_TEXT]
[HORIZONTAL_RULE]

[P00412 | 22584:22636 | HEADING_2]
Part 4 — The API between the two protocols (events)

[P00413 | 22636:22818 | NORMAL_TEXT]
This is the integration contract. The Crowdsourcing Protocol emits these; the Batch Pipeline consumes them; BatchPackaged + registerDataset close the loop back to the Main Protocol.

[P00414 | 22818:22819 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00415 | 22819:22898 | NORMAL_TEXT]
// ── Crowdsourcing Protocol events ──────────────────────────────────────────

[P00416 | 22898:22899 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00417 | 22899:22931 | NORMAL_TEXT]
/// A labeling epoch is opened.

[P00418 | 22931:22932 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00419 | 22932:22951 | NORMAL_TEXT]
event EpochOpened(

[P00420 | 22951:22952 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00421 | 22952:22981 | NORMAL_TEXT]
    uint256 indexed epochId,

[P00422 | 22981:22982 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00423 | 22982:23032 | NORMAL_TEXT]
    uint8            taskType,        // TaskType

[P00424 | 23032:23033 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00425 | 23033:23065 | NORMAL_TEXT]
    uint64           startTime,

[P00426 | 23065:23066 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00427 | 23066:23103 | NORMAL_TEXT]
    uint64           commitDeadline,

[P00428 | 23103:23104 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00429 | 23104:23140 | NORMAL_TEXT]
    uint64           revealDeadline

[P00430 | 23140:23141 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00431 | 23141:23144 | NORMAL_TEXT]
);

[P00432 | 23144:23145 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00433 | 23145:23230 | NORMAL_TEXT]
/// A user participated (submitted work) in an epoch. THE core participation signal.

[P00434 | 23230:23231 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00435 | 23231:23313 | NORMAL_TEXT]
/// itemCount = number of tasks in this submission; commitHash hides the answers.

[P00436 | 23313:23314 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00437 | 23314:23334 | NORMAL_TEXT]
event Participated(

[P00438 | 23334:23335 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00439 | 23335:23361 | NORMAL_TEXT]
    address indexed user,

[P00440 | 23361:23362 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00441 | 23362:23391 | NORMAL_TEXT]
    uint256 indexed epochId,

[P00442 | 23391:23392 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00443 | 23392:23427 | NORMAL_TEXT]
    uint256          submissionId,

[P00444 | 23427:23428 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00445 | 23428:23461 | NORMAL_TEXT]
    bytes32          commitHash,

[P00446 | 23461:23462 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00447 | 23462:23494 | NORMAL_TEXT]
    uint32           itemCount,

[P00448 | 23494:23495 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00449 | 23495:23526 | NORMAL_TEXT]
    uint64           timestamp

[P00450 | 23526:23527 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00451 | 23527:23530 | NORMAL_TEXT]
);

[P00452 | 23530:23531 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00453 | 23531:23608 | NORMAL_TEXT]
/// An epoch is closed; participationRoot anchors all submissions for audit.

[P00454 | 23608:23609 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00455 | 23609:23628 | NORMAL_TEXT]
event EpochClosed(

[P00456 | 23628:23629 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00457 | 23629:23658 | NORMAL_TEXT]
    uint256 indexed epochId,

[P00458 | 23658:23659 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00459 | 23659:23699 | NORMAL_TEXT]
    bytes32          participationRoot,

[P00460 | 23699:23700 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00461 | 23700:23739 | NORMAL_TEXT]
    uint64           participantCount,

[P00462 | 23739:23740 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00463 | 23740:23771 | NORMAL_TEXT]
    uint64           itemCount

[P00464 | 23771:23772 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00465 | 23772:23775 | NORMAL_TEXT]
);

[P00466 | 23775:23776 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00467 | 23776:23862 | NORMAL_TEXT]
/// The pipeline packaged epochs [epochStart, epochEnd] into a Main-Protocol dataset.

[P00468 | 23862:23863 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00469 | 23863:23948 | NORMAL_TEXT]
/// weightsRoot MATCHES the weightsRoot registered on the Main Protocol, so labelers

[P00470 | 23948:23949 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00471 | 23949:24040 | NORMAL_TEXT]
/// can locate their dataset and claim once it sells. This is the crowdsourcing→main link.

[P00472 | 24040:24041 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00473 | 24041:24062 | NORMAL_TEXT]
event BatchPackaged(

[P00474 | 24062:24063 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00475 | 24063:24127 | NORMAL_TEXT]
    uint256 indexed datasetId,       // id on the Main Protocol

[P00476 | 24127:24128 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00477 | 24128:24161 | NORMAL_TEXT]
    uint256          epochStart,

[P00478 | 24161:24162 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00479 | 24162:24193 | NORMAL_TEXT]
    uint256          epochEnd,

[P00480 | 24193:24194 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00481 | 24194:24228 | NORMAL_TEXT]
    bytes32          weightsRoot,

[P00482 | 24228:24229 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00483 | 24229:24301 | NORMAL_TEXT]
    bytes32          dataHash,        // == Dataset.contentHash on Main

[P00484 | 24301:24302 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00485 | 24302:24333 | NORMAL_TEXT]
    uint64           itemCount

[P00486 | 24333:24334 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00487 | 24334:24337 | NORMAL_TEXT]
);

[P00488 | 24337:24338 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00489 | 24338:24417 | NORMAL_TEXT]
// ── Main Protocol events (the other half of the loop) ──────────────────────

[P00490 | 24417:24418 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00491 | 24418:24498 | NORMAL_TEXT]
event DatasetRegistered(uint256 indexed datasetId, address indexed contributor,

[P00492 | 24498:24499 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00493 | 24499:24587 | NORMAL_TEXT]
                        bytes32 contentHash, bytes32 weightsRoot, uint256 totalWeight);

[P00494 | 24587:24588 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00495 | 24588:24674 | NORMAL_TEXT]
event CopyPurchased(uint256 indexed datasetId, address indexed buyer, uint256 price);

[P00496 | 24674:24675 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00497 | 24675:24766 | NORMAL_TEXT]
event ExclusivePurchased(uint256 indexed datasetId, address indexed buyer, uint256 price);

[P00498 | 24766:24767 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00499 | 24767:24864 | NORMAL_TEXT]
event RevenueClaimed(uint256 indexed datasetId, address indexed subContributor, uint256 amount);

[P00500 | 24864:24865 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00501 | 24865:24901 | NORMAL_TEXT]
Consumption map (for the pipeline):

[P00502 | 24901:24902 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00503 | 24902:24984 | NORMAL_TEXT | LIST id=kix.w561pn6hfz3h level=0]
Participated → who did how much work, and the commitment to verify their answers.

[P00504 | 24984:25039 | NORMAL_TEXT | LIST id=kix.w561pn6hfz3h level=0]
EpochClosed → epoch is final; safe to start packaging.

[P00505 | 25039:25173 | NORMAL_TEXT | LIST id=kix.w561pn6hfz3h level=0]
Pipeline computes weights, calls registerDataset (Main) → gets datasetId, then anchorPackaging (Crowdsourcing) → emits BatchPackaged.

[P00506 | 25173:25304 | NORMAL_TEXT | LIST id=kix.w561pn6hfz3h level=0]
Labelers watch BatchPackaged (their dataset) and CopyPurchased/ExclusivePurchased (revenue arriving) → call RevenueSplitter.claim.

[P00507 | 25304:25305 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00508 | 25305:25307 | NORMAL_TEXT]
[HORIZONTAL_RULE]

[P00509 | 25307:25351 | HEADING_2]
Part 5 — Security, integrity & threat model

[P00510 | 25354:25362 | NORMAL_TEXT | TABLE row=0 col=0]
Concern

[P00511 | 25363:25374 | NORMAL_TEXT | TABLE row=0 col=1]
Mitigation

[P00512 | 25376:25425 | NORMAL_TEXT | TABLE row=1 col=0]
Paying N sub-contributors on-chain is infeasible

[P00513 | 25426:25489 | NORMAL_TEXT | TABLE row=1 col=1]
Accrual + Merkle-proof pull claims (2.4); O(1) per sale/claim.

[P00514 | 25491:25517 | NORMAL_TEXT | TABLE row=2 col=0]
Double-claim / over-claim

[P00515 | 25518:25636 | NORMAL_TEXT | TABLE row=2 col=1]
claimed[datasetId][addr] tracks lifetime taken; owed = entitled − claimed. Leaf binds (addr, weight); proof required.

[P00516 | 25638:25687 | NORMAL_TEXT | TABLE row=3 col=0]
Weights fraud (pipeline lies about contribution)

[P00517 | 25688:25884 | NORMAL_TEXT | TABLE row=3 col=1]
Anchor weightsRoot + publish leaves; optimistic challenge window before a dataset's first payout, letting anyone recompute weights from Participated+reveals and dispute (operator staked/slashed).

[P00518 | 25886:25915 | NORMAL_TEXT | TABLE row=4 col=0]
Answer copying in the Arcade

[P00519 | 25916:25990 | NORMAL_TEXT | TABLE row=4 col=1]
Commit-reveal: commitHash anchored via Participated before reveals exist.

[P00520 | 25992:26022 | NORMAL_TEXT | TABLE row=5 col=0]
Sybil / bots inflating weight

[P00521 | 26023:26128 | NORMAL_TEXT | TABLE row=5 col=1]
Honeypots + consensus in the pipeline (Arcade PRD); one-identity embedded wallets; per-user rate limits.

[P00522 | 26130:26188 | NORMAL_TEXT | TABLE row=6 col=0]
Exclusive buyer expects true exclusivity but copies exist

[P00523 | 26189:26330 | NORMAL_TEXT | TABLE row=6 col=1]
exclusiveRequiresZeroCopies flag; explicit on-chain state machine; honest scoping (Part 2.6). Cannot claw back delivered bytes — documented.

[P00524 | 26332:26357 | NORMAL_TEXT | TABLE row=7 col=0]
Access enforcement trust

[P00525 | 26358:26428 | NORMAL_TEXT | TABLE row=7 col=1]
v1 Gateway checks hasAccess; harden to threshold/MPC/TEE key custody.

[P00526 | 26430:26475 | NORMAL_TEXT | TABLE row=8 col=0]
Reentrancy on purchase/claim/auction refunds

[P00527 | 26476:26545 | NORMAL_TEXT | TABLE row=8 col=1]
Checks-effects-interactions; pull-payments; nonReentrant; SafeERC20.

[P00528 | 26547:26579 | NORMAL_TEXT | TABLE row=9 col=0]
Contributor spam at clean start

[P00529 | 26580:26636 | NORMAL_TEXT | TABLE row=9 col=1]
ContributorRegistry allowlist (Nurture-only initially).

[P00530 | 26638:26654 | NORMAL_TEXT | TABLE row=10 col=0]
Auction sniping

[P00531 | 26655:26745 | NORMAL_TEXT | TABLE row=10 col=1]
v1 English auction with anti-snipe time-extension; sealed-bid commit-reveal as an option.

[P00532 | 26747:26785 | NORMAL_TEXT | TABLE row=11 col=0]
Operator is a single point of failure

[P00533 | 26786:26929 | NORMAL_TEXT | TABLE row=11 col=1]
Operator/aggregator staked; roots challengeable; keep operator keys in an HSM/multisig; roadmap to decentralize the pipeline (EigenLayer AVS).

[P00534 | 26930:26931 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00535 | 26931:26933 | NORMAL_TEXT]
[HORIZONTAL_RULE]

[P00536 | 26933:26977 | HEADING_2]
Part 6 — Deployment, upgradeability, config

[P00537 | 26977:27079 | NORMAL_TEXT | LIST id=kix.w561pn6hfz3h level=0]
Chain: EVM L2 (Base / Arbitrum / OP). All heavy work off-chain; only commitments/settlement on-chain.

[P00538 | 27079:27191 | NORMAL_TEXT | LIST id=kix.w561pn6hfz3h level=0]
Payments: a configured stablecoin (USDC) via SafeERC20; feeBps + treasury in ProtocolConfig; protocol pausable.

[P00539 | 27191:27355 | NORMAL_TEXT | LIST id=kix.w561pn6hfz3h level=0]
Upgradeability: UUPS proxies behind a timelock + multisig for Marketplace, RevenueSplitter, Crowdsourcing; EntitlementNFT and Dataset records immutable-by-default.

[P00540 | 27355:27531 | NORMAL_TEXT | LIST id=kix.w561pn6hfz3h level=0]
Roles: ADMIN (config/upgrade, multisig), OPERATOR (pipeline: registerDataset, epoch mgmt, anchorPackaging), CONTRIBUTOR (allowlist), buyers permissionless (optional KYC hook).

[P00541 | 27531:27532 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00542 | 27532:27534 | NORMAL_TEXT]
[HORIZONTAL_RULE]

[P00543 | 27534:27580 | HEADING_2]
Part 7 — Open questions (decide before build)

[P00544 | 27580:27679 | NORMAL_TEXT | LIST id=kix.lzptvcymn6hs level=0]
Weights immutability: lock at registration (recommended, keeps 2.4 sound) vs allow pre-sale edits.

[P00545 | 27679:27823 | NORMAL_TEXT | LIST id=kix.lzptvcymn6hs level=0]
License transferability / secondary market: v1 non-transferable copy licenses vs enabling resale (ties to the earlier "liquid licensing" idea).

[P00546 | 27823:27914 | NORMAL_TEXT | LIST id=kix.lzptvcymn6hs level=0]
Reveal trust level: off-chain reveals (cheap, v1) vs on-chain revealRoot (more trustless).

[P00547 | 27914:27994 | NORMAL_TEXT | LIST id=kix.lzptvcymn6hs level=0]
Auction scope: exclusive-only (v1) vs also auctioning batches of copy licenses.

[P00548 | 27994:28152 | NORMAL_TEXT | LIST id=kix.lzptvcymn6hs level=0]
Nurture's raw-data weight policy: how the pipeline splits value between raw sensor data (Nurture) and annotations (labelers) — a governance/policy parameter.

[P00549 | 28152:28276 | NORMAL_TEXT | LIST id=kix.lzptvcymn6hs level=0]
Challenge window mechanics: who can challenge weights, bond sizes, and whether payouts are delayed until the window closes.

[P00550 | 28276:28277 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00551 | 28277:28279 | NORMAL_TEXT]
[HORIZONTAL_RULE]

[P00552 | 28279:28333 | HEADING_2]
Appendix — End-to-end sequence (crowdsourced dataset)

[P00553 | 28333:28430 | NORMAL_TEXT]
Arcade user      Crowdsourcing Proto      Batch Pipeline (Nurture)      Main Protocol      Buyer

[P00554 | 28430:28431 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00555 | 28431:28525 | NORMAL_TEXT]
    │ play/label        │                          │                         │              │

[P00556 | 28525:28526 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00557 | 28526:28620 | NORMAL_TEXT]
    │ submit()──────────▶ emit Participated ───────▶ (collect)               │              │

[P00558 | 28620:28621 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00559 | 28621:28716 | NORMAL_TEXT]
    │                   │ emit EpochClosed ─────────▶ verify+score+weights    │              │

[P00560 | 28716:28717 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00561 | 28717:28814 | NORMAL_TEXT]
    │                   │                          │ registerDataset()───────▶ DatasetRegistered

[P00562 | 28814:28815 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00563 | 28815:28910 | NORMAL_TEXT]
    │                   │ anchorPackaging()◀────────┤ (gets datasetId)        │              │

[P00564 | 28910:28911 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00565 | 28911:29006 | NORMAL_TEXT]
    │                   │ emit BatchPackaged ───────▶ publish leaves          │              │

[P00566 | 29006:29007 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00567 | 29007:29102 | NORMAL_TEXT]
    │                   │                          │                    listCopy/Exclusive   │

[P00568 | 29102:29103 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00569 | 29103:29198 | NORMAL_TEXT]
    │                   │                          │                         │◀── buyCopy ───┤

[P00570 | 29198:29199 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00571 | 29199:29294 | NORMAL_TEXT]
    │                   │                          │                    accrue revenue       │

[P00572 | 29294:29295 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

[P00573 | 29295:29390 | NORMAL_TEXT]
    │ RevenueSplitter.claim(datasetId, weight, proof) ──────────────────────▶ pay share      │

[P00574 | 29390:29391 | NORMAL_TEXT]
⟦EMPTY PARAGRAPH⟧

