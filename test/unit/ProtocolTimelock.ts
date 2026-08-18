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
    const timelock = await ethers.deployContract("ProtocolTimelock", [admin.address, DELAY, false]);
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
    const timelock = await ethers.deployContract("ProtocolTimelock", [admin.address, DELAY, false]);
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
    return { deployer, admin, timelock, contributors, config, datasets, nft, market, splitter };
  }

  it("is fixed to 48 hours and self-administered", async function () {
    const { deployer, admin, timelock } = await networkHelpers.loadFixture(deployFixture);
    const self = await timelock.getAddress();

    expect(await timelock.getMinDelay()).to.equal(DELAY);
    expect(await timelock.hasRole(await timelock.DEFAULT_ADMIN_ROLE(), self)).to.equal(true);
    expect(await timelock.hasRole(await timelock.DEFAULT_ADMIN_ROLE(), deployer.address)).to.equal(
      false,
    );
    expect(await timelock.hasRole(await timelock.DEFAULT_ADMIN_ROLE(), admin.address)).to.equal(
      false,
    );
    expect(await timelock.getRoleMemberCount(await timelock.DEFAULT_ADMIN_ROLE())).to.equal(1);
    expect(await timelock.getRoleMember(await timelock.DEFAULT_ADMIN_ROLE(), 0)).to.equal(self);
    for (const role of [
      await timelock.PROPOSER_ROLE(),
      await timelock.EXECUTOR_ROLE(),
      await timelock.CANCELLER_ROLE(),
    ]) {
      expect(await timelock.hasRole(role, admin.address)).to.equal(true);
      expect(await timelock.hasRole(role, deployer.address)).to.equal(false);
      expect(await timelock.getRoleMemberCount(role)).to.equal(1);
      expect(await timelock.getRoleMember(role, 0)).to.equal(admin.address);
    }
  });

  it("rejects a zero governance multisig", async function () {
    const factory = await ethers.getContractFactory("ProtocolTimelock");
    await expect(factory.deploy(ethers.ZeroAddress, DELAY, false)).to.be.revertedWithCustomError(
      factory,
      "ZeroAddress",
    );
  });

  it("allows a one-minute delay only in explicit short-delay test mode", async function () {
    const [, admin] = await ethers.getSigners();
    const factory = await ethers.getContractFactory("ProtocolTimelock");
    const shortDelay = 60n;
    const timelock = await factory.deploy(admin.address, shortDelay, true);

    expect(await timelock.getMinDelay()).to.equal(shortDelay);
    await expect(
      factory.deploy(admin.address, shortDelay - 1n, true),
    ).to.be.revertedWithCustomError(factory, "InvalidInitialDelay");
    await expect(factory.deploy(admin.address, shortDelay, false)).to.be.revertedWithCustomError(
      factory,
      "InvalidInitialDelay",
    );
  });

  it("leaves the deployment EOA without any production role", async function () {
    const d = await networkHelpers.loadFixture(upgradeFixture);
    for (const role of [
      await d.timelock.DEFAULT_ADMIN_ROLE(),
      await d.timelock.PROPOSER_ROLE(),
      await d.timelock.EXECUTOR_ROLE(),
      await d.timelock.CANCELLER_ROLE(),
    ]) {
      expect(await d.timelock.hasRole(role, d.deployer.address)).to.equal(false);
    }

    for (const contract of [d.contributors, d.config, d.datasets, d.nft, d.market, d.splitter]) {
      expect(
        await contract.hasRole(await contract.DEFAULT_ADMIN_ROLE(), d.deployer.address),
      ).to.equal(false);
    }
    for (const contract of [d.contributors, d.config, d.datasets, d.nft, d.splitter]) {
      expect(await contract.hasRole(await contract.ADMIN_ROLE(), d.deployer.address)).to.equal(
        false,
      );
    }
    expect(
      await d.contributors.hasRole(await d.contributors.OPERATOR_ROLE(), d.deployer.address),
    ).to.equal(false);
    expect(
      await d.contributors.hasRole(await d.contributors.CONTRIBUTOR_ROLE(), d.deployer.address),
    ).to.equal(false);
  });

  it("enforces the full delay before a config change", async function () {
    const { admin, timelock, config } = await networkHelpers.loadFixture(deployFixture);
    const target = await config.getAddress();
    const data = config.interface.encodeFunctionData("setFeeBps", [500]);
    const salt = ethers.id("set-fee-500");

    await expect(config.connect(admin).setFeeBps(500))
      .to.be.revertedWithCustomError(config, "OnlyGovernanceTimelock")
      .withArgs(admin.address);
    await timelock.connect(admin).schedule(target, 0, data, ZeroHash, salt, DELAY);
    await expect(
      timelock.connect(admin).execute(target, 0, data, ZeroHash, salt),
    ).to.be.revertedWithCustomError(timelock, "TimelockUnexpectedOperationState");

    const operationId = await timelock.hashOperation(target, 0, data, ZeroHash, salt);
    await networkHelpers.time.setNextBlockTimestamp(await timelock.getTimestamp(operationId));
    await timelock.connect(admin).execute(target, 0, data, ZeroHash, salt);
    expect(await config.feeBps()).to.equal(500);
  });

  it("binds every governed contract to the same immutable timelock", async function () {
    const d = await networkHelpers.loadFixture(upgradeFixture);
    const governance = await d.timelock.getAddress();

    for (const contract of [d.contributors, d.config, d.datasets, d.nft, d.market, d.splitter]) {
      expect(await contract.governanceTimelock()).to.equal(governance);
      expect(await contract.hasRole(await contract.DEFAULT_ADMIN_ROLE(), governance)).to.equal(
        true,
      );
      expect(await contract.hasRole(await contract.DEFAULT_ADMIN_ROLE(), d.admin.address)).to.equal(
        false,
      );
    }
  });

  it("prevents governance from transferring, revoking, or renouncing fixed admin control", async function () {
    const d = await networkHelpers.loadFixture(upgradeFixture);
    const governance = await d.timelock.getAddress();
    const governedContracts = [d.contributors, d.config, d.datasets, d.nft, d.market, d.splitter];
    const roleInterface = new ethers.Interface([
      "function grantRole(bytes32 role, address account)",
      "function revokeRole(bytes32 role, address account)",
      "function renounceRole(bytes32 role, address account)",
    ]);

    for (const [contractIndex, contract] of governedContracts.entries()) {
      const role = await contract.DEFAULT_ADMIN_ROLE();
      const target = await contract.getAddress();
      for (const [action, account] of [
        ["grantRole", d.admin.address],
        ["revokeRole", governance],
        ["renounceRole", governance],
      ] as const) {
        const data = roleInterface.encodeFunctionData(action, [role, account]);
        const salt = ethers.id(`forbidden-admin-${action}-${contractIndex}`);
        await d.timelock.connect(d.admin).schedule(target, 0, data, ZeroHash, salt, DELAY);
        const operationId = await d.timelock.hashOperation(target, 0, data, ZeroHash, salt);
        await networkHelpers.time.setNextBlockTimestamp(await d.timelock.getTimestamp(operationId));

        await expect(d.timelock.connect(d.admin).execute(target, 0, data, ZeroHash, salt))
          .to.be.revertedWithCustomError(contract, "GovernanceRoleLocked")
          .withArgs(account);
        expect(await contract.hasRole(role, governance)).to.equal(true);
        expect(await contract.hasRole(role, d.admin.address)).to.equal(false);
      }
    }
  });

  it("keeps the Timelock itself as the permanent sole default admin", async function () {
    const { admin, timelock } = await networkHelpers.loadFixture(deployFixture);
    const self = await timelock.getAddress();
    const role = await timelock.DEFAULT_ADMIN_ROLE();
    const roleInterface = new ethers.Interface([
      "function grantRole(bytes32 role, address account)",
      "function revokeRole(bytes32 role, address account)",
      "function renounceRole(bytes32 role, address account)",
    ]);

    for (const [action, account] of [
      ["grantRole", admin.address],
      ["revokeRole", self],
      ["renounceRole", self],
    ] as const) {
      const data = roleInterface.encodeFunctionData(action, [role, account]);
      const salt = ethers.id(`forbidden-timelock-admin-${action}`);
      await timelock.connect(admin).schedule(self, 0, data, ZeroHash, salt, DELAY);
      const operationId = await timelock.hashOperation(self, 0, data, ZeroHash, salt);
      await networkHelpers.time.setNextBlockTimestamp(await timelock.getTimestamp(operationId));

      await expect(timelock.connect(admin).execute(self, 0, data, ZeroHash, salt))
        .to.be.revertedWithCustomError(timelock, "GovernanceRoleLocked")
        .withArgs(account);
      expect(await timelock.hasRole(role, self)).to.equal(true);
      expect(await timelock.hasRole(role, admin.address)).to.equal(false);
    }
  });

  it("preserves normal Timelock operational-role management", async function () {
    const { deployer, admin, timelock } = await networkHelpers.loadFixture(deployFixture);
    const self = await timelock.getAddress();
    const proposerRole = await timelock.PROPOSER_ROLE();
    const roleInterface = new ethers.Interface([
      "function grantRole(bytes32 role, address account)",
      "function revokeRole(bytes32 role, address account)",
    ]);

    for (const [action, expected] of [
      ["grantRole", true],
      ["revokeRole", false],
    ] as const) {
      const data = roleInterface.encodeFunctionData(action, [proposerRole, deployer.address]);
      const salt = ethers.id(`permitted-timelock-${action}`);
      await timelock.connect(admin).schedule(self, 0, data, ZeroHash, salt, DELAY);
      const operationId = await timelock.hashOperation(self, 0, data, ZeroHash, salt);
      await networkHelpers.time.setNextBlockTimestamp(await timelock.getTimestamp(operationId));
      await timelock.connect(admin).execute(self, 0, data, ZeroHash, salt);
      expect(await timelock.hasRole(proposerRole, deployer.address)).to.equal(expected);
    }

    const cancellerRole = await timelock.CANCELLER_ROLE();
    await timelock.connect(admin).renounceRole(cancellerRole, admin.address);
    expect(await timelock.hasRole(cancellerRole, admin.address)).to.equal(false);
  });

  it("allows delay increases but never reductions below 48 hours", async function () {
    const { admin, timelock } = await networkHelpers.loadFixture(deployFixture);
    const target = await timelock.getAddress();
    const increasedDelay = 72n * 60n * 60n;
    const increaseData = timelock.interface.encodeFunctionData("updateDelay", [increasedDelay]);
    const increaseSalt = ethers.id("permitted-delay-increase");

    await timelock.connect(admin).schedule(target, 0, increaseData, ZeroHash, increaseSalt, DELAY);
    const increaseId = await timelock.hashOperation(
      target,
      0,
      increaseData,
      ZeroHash,
      increaseSalt,
    );
    await networkHelpers.time.setNextBlockTimestamp(await timelock.getTimestamp(increaseId));
    await timelock.connect(admin).execute(target, 0, increaseData, ZeroHash, increaseSalt);
    expect(await timelock.getMinDelay()).to.equal(increasedDelay);

    const reductionData = timelock.interface.encodeFunctionData("updateDelay", [0]);
    const reductionSalt = ethers.id("forbidden-delay-reduction");
    await timelock
      .connect(admin)
      .schedule(target, 0, reductionData, ZeroHash, reductionSalt, increasedDelay);
    const reductionId = await timelock.hashOperation(
      target,
      0,
      reductionData,
      ZeroHash,
      reductionSalt,
    );
    await networkHelpers.time.setNextBlockTimestamp(await timelock.getTimestamp(reductionId));

    await expect(timelock.connect(admin).execute(target, 0, reductionData, ZeroHash, reductionSalt))
      .to.be.revertedWithCustomError(timelock, "MinimumDelayTooShort")
      .withArgs(0, DELAY);
    expect(await timelock.getMinDelay()).to.equal(increasedDelay);
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

    await expect(market.connect(admin).upgradeToAndCall(marketImplementation, "0x"))
      .to.be.revertedWithCustomError(market, "OnlyGovernanceTimelock")
      .withArgs(admin.address);

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
