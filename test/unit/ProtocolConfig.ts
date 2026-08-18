import { expect } from "chai";
import { ZeroAddress } from "ethers";
import { network } from "hardhat";

const { ethers, networkHelpers } = await network.create();

describe("ProtocolConfig", function () {
  const initialFeeBps = 250;
  const initialChallengeWindow = 7 * 24 * 60 * 60;

  async function deployFixture() {
    const [governance, admin, paymentToken, treasury, gatewaySigner, replacement, outsider] =
      await ethers.getSigners();

    const config = await ethers.deployContract("ProtocolConfig", [
      paymentToken.address,
      initialFeeBps,
      treasury.address,
      initialChallengeWindow,
      gatewaySigner.address,
      governance.address,
      admin.address,
    ]);
    await config.waitForDeployment();

    return {
      config,
      governance,
      admin,
      paymentToken,
      treasury,
      gatewaySigner,
      replacement,
      outsider,
    };
  }

  describe("deployment", function () {
    it("stores immutable and initial configuration", async function () {
      const { config, governance, admin, paymentToken, treasury, gatewaySigner } =
        await networkHelpers.loadFixture(deployFixture);

      expect(await config.paymentToken()).to.equal(paymentToken.address);
      expect(await config.feeBps()).to.equal(initialFeeBps);
      expect(await config.treasury()).to.equal(treasury.address);
      expect(await config.challengeWindow()).to.equal(initialChallengeWindow);
      expect(await config.gatewaySigner()).to.equal(gatewaySigner.address);
      expect(await config.paused()).to.equal(false);

      expect(await config.hasRole(await config.DEFAULT_ADMIN_ROLE(), governance.address)).to.equal(
        true,
      );
      expect(await config.hasRole(await config.ADMIN_ROLE(), admin.address)).to.equal(true);
      expect(await config.getRoleAdmin(await config.ADMIN_ROLE())).to.equal(
        await config.DEFAULT_ADMIN_ROLE(),
      );
    });

    it("rejects every required zero address", async function () {
      const signers = await ethers.getSigners();
      const valid = signers.slice(0, 7).map((signer) => signer.address);
      const factory = await ethers.getContractFactory("ProtocolConfig");

      const addressArgumentIndexes = [0, 2, 4, 5, 6];
      for (const index of addressArgumentIndexes) {
        const args: [string, number, string, number, string, string, string] = [
          valid[0],
          initialFeeBps,
          valid[2],
          initialChallengeWindow,
          valid[4],
          valid[5],
          valid[6],
        ];
        args[index] = ZeroAddress as never;

        await expect(factory.deploy(...args)).to.be.revertedWithCustomError(factory, "ZeroAddress");
      }
    });

    it("rejects invalid initial fee and challenge window", async function () {
      const [paymentToken, treasury, signer, governance, admin] = await ethers.getSigners();
      const factory = await ethers.getContractFactory("ProtocolConfig");

      await expect(
        factory.deploy(
          paymentToken.address,
          10_001,
          treasury.address,
          initialChallengeWindow,
          signer.address,
          governance.address,
          admin.address,
        ),
      )
        .to.be.revertedWithCustomError(factory, "InvalidFeeBps")
        .withArgs(10_001);

      await expect(
        factory.deploy(
          paymentToken.address,
          initialFeeBps,
          treasury.address,
          0,
          signer.address,
          governance.address,
          admin.address,
        ),
      ).to.be.revertedWithCustomError(factory, "InvalidChallengeWindow");
    });
  });

  describe("timelocked configuration", function () {
    it("updates fee bps at both valid boundaries", async function () {
      const { config, governance } = await networkHelpers.loadFixture(deployFixture);

      await expect(config.connect(governance).setFeeBps(0))
        .to.emit(config, "FeeBpsUpdated")
        .withArgs(initialFeeBps, 0);
      await expect(config.connect(governance).setFeeBps(10_000))
        .to.emit(config, "FeeBpsUpdated")
        .withArgs(0, 10_000);
    });

    it("rejects a fee above 10,000 bps", async function () {
      const { config, governance } = await networkHelpers.loadFixture(deployFixture);

      await expect(config.connect(governance).setFeeBps(10_001))
        .to.be.revertedWithCustomError(config, "InvalidFeeBps")
        .withArgs(10_001);
    });

    it("updates treasury, challenge window, and gateway signer with events", async function () {
      const { config, governance, treasury, gatewaySigner, replacement, outsider } =
        await networkHelpers.loadFixture(deployFixture);

      await expect(config.connect(governance).setTreasury(replacement.address))
        .to.emit(config, "TreasuryUpdated")
        .withArgs(treasury.address, replacement.address);
      await expect(config.connect(governance).setChallengeWindow(86_400))
        .to.emit(config, "ChallengeWindowUpdated")
        .withArgs(initialChallengeWindow, 86_400);
      await expect(config.connect(governance).setGatewaySigner(outsider.address))
        .to.emit(config, "GatewaySignerUpdated")
        .withArgs(gatewaySigner.address, outsider.address);

      expect(await config.treasury()).to.equal(replacement.address);
      expect(await config.challengeWindow()).to.equal(86_400);
      expect(await config.gatewaySigner()).to.equal(outsider.address);
    });

    it("rejects zero values for nonzero configuration", async function () {
      const { config, governance } = await networkHelpers.loadFixture(deployFixture);

      await expect(
        config.connect(governance).setTreasury(ZeroAddress),
      ).to.be.revertedWithCustomError(config, "ZeroAddress");
      await expect(
        config.connect(governance).setGatewaySigner(ZeroAddress),
      ).to.be.revertedWithCustomError(config, "ZeroAddress");
      await expect(config.connect(governance).setChallengeWindow(0)).to.be.revertedWithCustomError(
        config,
        "InvalidChallengeWindow",
      );
    });

    it("rejects config changes from ADMIN and outsiders", async function () {
      const { config, admin, outsider } = await networkHelpers.loadFixture(deployFixture);
      for (const caller of [admin, outsider]) {
        await expect(config.connect(caller).setFeeBps(100))
          .to.be.revertedWithCustomError(config, "OnlyGovernanceTimelock")
          .withArgs(caller.address);
      }
    });
  });

  describe("emergency pause", function () {
    it("allows ADMIN to pause and unpause immediately", async function () {
      const { config, admin } = await networkHelpers.loadFixture(deployFixture);

      await expect(config.connect(admin).pause()).to.emit(config, "Paused").withArgs(admin.address);
      expect(await config.paused()).to.equal(true);

      await expect(config.connect(admin).unpause())
        .to.emit(config, "Unpaused")
        .withArgs(admin.address);
      expect(await config.paused()).to.equal(false);
    });

    it("rejects repeat pause-state transitions", async function () {
      const { config, admin } = await networkHelpers.loadFixture(deployFixture);

      await expect(config.connect(admin).unpause()).to.be.revertedWithCustomError(
        config,
        "ExpectedPause",
      );
      await config.connect(admin).pause();
      await expect(config.connect(admin).pause()).to.be.revertedWithCustomError(
        config,
        "EnforcedPause",
      );
    });

    it("rejects pause control from governance and outsiders", async function () {
      const { config, governance, outsider } = await networkHelpers.loadFixture(deployFixture);
      const adminRole = await config.ADMIN_ROLE();

      for (const caller of [governance, outsider]) {
        await expect(config.connect(caller).pause())
          .to.be.revertedWithCustomError(config, "AccessControlUnauthorizedAccount")
          .withArgs(caller.address, adminRole);
      }
    });
  });
});
