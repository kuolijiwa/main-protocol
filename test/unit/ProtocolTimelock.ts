import { expect } from "chai";
import { ZeroHash } from "ethers";
import hre, { network } from "hardhat";
import { upgrades } from "@openzeppelin/hardhat-upgrades";

const connection = await network.create();
const { ethers, networkHelpers } = connection;
const upgradesApi = await upgrades(hre, connection);
const DELAY = 48n * 60n * 60n;

describe("ProtocolTimelock", function () {
  async function deployFixture() {
    const [deployer, admin, token, treasury, gateway] = await ethers.getSigners();
    const timelock = await ethers.deployContract("ProtocolTimelock", [admin.address]);
    const config = await ethers.deployContract("ProtocolConfig", [
      token.address,
      250,
      treasury.address,
      7 * 24 * 60 * 60,
      gateway.address,
      await timelock.getAddress(),
      admin.address,
    ]);
    return { deployer, admin, timelock, config };
  }

  async function upgradeFixture() {
    const [deployer, admin, token, treasury, gateway] = await ethers.getSigners();
    const timelock = await ethers.deployContract("ProtocolTimelock", [admin.address]);
    const governance = await timelock.getAddress();
    const contributors = await ethers.deployContract("ContributorRegistry", [
      governance,
      admin.address,
    ]);
    const config = await ethers.deployContract("ProtocolConfig", [
      token.address,
      250,
      treasury.address,
      7 * 24 * 60 * 60,
      gateway.address,
      governance,
      admin.address,
    ]);
    const datasets = await ethers.deployContract("DatasetRegistry", [
      await contributors.getAddress(),
      await config.getAddress(),
      governance,
      admin.address,
    ]);
    const nft = await ethers.deployContract("EntitlementNFT", [
      await datasets.getAddress(),
      governance,
      admin.address,
    ]);
    const splitter = await upgradesApi.deployProxy(
      await ethers.getContractFactory("RevenueSplitter"),
      [await config.getAddress(), await datasets.getAddress(), governance, admin.address],
      { kind: "uups" },
    );
    const market = await upgradesApi.deployProxy(
      await ethers.getContractFactory("Marketplace"),
      [
        await config.getAddress(),
        await datasets.getAddress(),
        await nft.getAddress(),
        await splitter.getAddress(),
        governance,
      ],
      { kind: "uups" },
    );
    return { deployer, admin, timelock, market, splitter };
  }

  it("is fixed to 48 hours and self-administered", async function () {
    const { deployer, admin, timelock } = await networkHelpers.loadFixture(deployFixture);
    const self = await timelock.getAddress();

    expect(await timelock.getMinDelay()).to.equal(DELAY);
    expect(await timelock.hasRole(await timelock.DEFAULT_ADMIN_ROLE(), self)).to.equal(true);
    expect(await timelock.hasRole(await timelock.DEFAULT_ADMIN_ROLE(), deployer.address)).to.equal(
      false,
    );
    for (const role of [
      await timelock.PROPOSER_ROLE(),
      await timelock.EXECUTOR_ROLE(),
      await timelock.CANCELLER_ROLE(),
    ]) {
      expect(await timelock.hasRole(role, admin.address)).to.equal(true);
    }
  });

  it("rejects a zero governance multisig", async function () {
    const factory = await ethers.getContractFactory("ProtocolTimelock");
    await expect(factory.deploy(ethers.ZeroAddress)).to.be.revertedWithCustomError(
      factory,
      "ZeroAddress",
    );
  });

  it("enforces the full delay before a config change", async function () {
    const { admin, timelock, config } = await networkHelpers.loadFixture(deployFixture);
    const target = await config.getAddress();
    const data = config.interface.encodeFunctionData("setFeeBps", [500]);
    const salt = ethers.id("set-fee-500");

    await expect(config.connect(admin).setFeeBps(500)).to.be.revertedWithCustomError(
      config,
      "AccessControlUnauthorizedAccount",
    );
    await timelock.connect(admin).schedule(target, 0, data, ZeroHash, salt, DELAY);
    await expect(
      timelock.connect(admin).execute(target, 0, data, ZeroHash, salt),
    ).to.be.revertedWithCustomError(timelock, "TimelockUnexpectedOperationState");

    const operationId = await timelock.hashOperation(target, 0, data, ZeroHash, salt);
    await networkHelpers.time.setNextBlockTimestamp(await timelock.getTimestamp(operationId));
    await timelock.connect(admin).execute(target, 0, data, ZeroHash, salt);
    expect(await config.feeBps()).to.equal(500);
  });

  it("enforces the same delay and storage validation for both UUPS upgrades", async function () {
    const { admin, timelock, market, splitter } = await networkHelpers.loadFixture(upgradeFixture);
    const marketProxy = await market.getAddress();
    const splitterProxy = await splitter.getAddress();
    const marketV2Factory = await ethers.getContractFactory("MarketplaceV2");
    const splitterV2Factory = await ethers.getContractFactory("RevenueSplitterV2");
    const preparedMarketImplementation = await upgradesApi.prepareUpgrade(
      marketProxy,
      marketV2Factory,
      { kind: "uups" },
    );
    const preparedSplitterImplementation = await upgradesApi.prepareUpgrade(
      splitterProxy,
      splitterV2Factory,
      { kind: "uups" },
    );
    if (
      typeof preparedMarketImplementation !== "string" ||
      typeof preparedSplitterImplementation !== "string"
    ) {
      throw new Error("prepareUpgrade did not return implementation addresses");
    }
    const marketImplementation = preparedMarketImplementation;
    const splitterImplementation = preparedSplitterImplementation;
    const marketUpgrade = marketV2Factory.interface.encodeFunctionData("upgradeToAndCall", [
      marketImplementation,
      "0x",
    ]);
    const splitterUpgrade = splitterV2Factory.interface.encodeFunctionData("upgradeToAndCall", [
      splitterImplementation,
      "0x",
    ]);

    await expect(
      market.connect(admin).upgradeToAndCall(marketImplementation, "0x"),
    ).to.be.revertedWithCustomError(market, "AccessControlUnauthorizedAccount");

    const targets = [marketProxy, splitterProxy];
    const values = [0, 0];
    const payloads = [marketUpgrade, splitterUpgrade];
    const salt = ethers.id("v2-upgrade-batch");
    await timelock.connect(admin).scheduleBatch(targets, values, payloads, ZeroHash, salt, DELAY);
    await expect(
      timelock.connect(admin).executeBatch(targets, values, payloads, ZeroHash, salt),
    ).to.be.revertedWithCustomError(timelock, "TimelockUnexpectedOperationState");

    const operationId = await timelock.hashOperationBatch(
      targets,
      values,
      payloads,
      ZeroHash,
      salt,
    );
    await networkHelpers.time.setNextBlockTimestamp(await timelock.getTimestamp(operationId));
    await timelock.connect(admin).executeBatch(targets, values, payloads, ZeroHash, salt);

    expect(await (await ethers.getContractAt("MarketplaceV2", marketProxy)).version()).to.equal(2);
    expect(
      await (await ethers.getContractAt("RevenueSplitterV2", splitterProxy)).version(),
    ).to.equal(2);
  });
});
