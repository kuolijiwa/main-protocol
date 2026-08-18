import { expect } from "chai";
import { ZeroAddress } from "ethers";
import { network } from "hardhat";

const { ethers, networkHelpers } = await network.create();

describe("ContributorRegistry", function () {
  async function deployFixture() {
    const [governance, admin, operator, contributor, secondContributor, outsider] =
      await ethers.getSigners();

    const registry = await ethers.deployContract("ContributorRegistry", [
      governance.address,
      admin.address,
    ]);
    await registry.waitForDeployment();

    return {
      registry,
      governance,
      admin,
      operator,
      contributor,
      secondContributor,
      outsider,
    };
  }

  describe("deployment and role administration", function () {
    it("rejects zero governance or admin addresses", async function () {
      const [, validAddress] = await ethers.getSigners();
      const factory = await ethers.getContractFactory("ContributorRegistry");

      await expect(factory.deploy(ZeroAddress, validAddress.address)).to.be.revertedWithCustomError(
        factory,
        "ZeroAddress",
      );
      await expect(factory.deploy(validAddress.address, ZeroAddress)).to.be.revertedWithCustomError(
        factory,
        "ZeroAddress",
      );
    });

    it("assigns the documented initial roles and role admins", async function () {
      const { registry, governance, admin } = await networkHelpers.loadFixture(deployFixture);

      const defaultAdminRole = await registry.DEFAULT_ADMIN_ROLE();
      const adminRole = await registry.ADMIN_ROLE();
      const operatorRole = await registry.OPERATOR_ROLE();
      const contributorRole = await registry.CONTRIBUTOR_ROLE();

      expect(await registry.hasRole(defaultAdminRole, governance.address)).to.equal(true);
      expect(await registry.hasRole(adminRole, admin.address)).to.equal(true);
      expect(await registry.getRoleAdmin(adminRole)).to.equal(defaultAdminRole);
      expect(await registry.getRoleAdmin(operatorRole)).to.equal(adminRole);
      expect(await registry.getRoleAdmin(contributorRole)).to.equal(adminRole);
    });

    it("lets ADMIN manage operator and contributor membership", async function () {
      const { registry, admin, operator, contributor } =
        await networkHelpers.loadFixture(deployFixture);
      const operatorRole = await registry.OPERATOR_ROLE();
      const contributorRole = await registry.CONTRIBUTOR_ROLE();

      await expect(registry.connect(admin).grantRole(operatorRole, operator.address))
        .to.emit(registry, "RoleGranted")
        .withArgs(operatorRole, operator.address, admin.address);
      await registry.connect(admin).grantRole(contributorRole, contributor.address);

      expect(await registry.hasRole(operatorRole, operator.address)).to.equal(true);
      expect(await registry.hasRole(contributorRole, contributor.address)).to.equal(true);

      await registry.connect(admin).revokeRole(operatorRole, operator.address);
      expect(await registry.hasRole(operatorRole, operator.address)).to.equal(false);
    });

    it("prevents ADMIN from granting ADMIN_ROLE", async function () {
      const { registry, admin, outsider } = await networkHelpers.loadFixture(deployFixture);
      const defaultAdminRole = await registry.DEFAULT_ADMIN_ROLE();
      const adminRole = await registry.ADMIN_ROLE();

      await expect(registry.connect(admin).grantRole(adminRole, outsider.address))
        .to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount")
        .withArgs(admin.address, defaultAdminRole);
    });
  });

  describe("operator attribution", function () {
    async function allowlistedFixture() {
      const deployment = await deployFixture();
      const { registry, admin, operator, contributor, secondContributor } = deployment;

      await registry.connect(admin).grantRole(await registry.OPERATOR_ROLE(), operator.address);
      await registry
        .connect(admin)
        .grantRole(await registry.CONTRIBUTOR_ROLE(), contributor.address);
      await registry
        .connect(admin)
        .grantRole(await registry.CONTRIBUTOR_ROLE(), secondContributor.address);

      return deployment;
    }

    it("starts with no assignment", async function () {
      const { registry, operator } = await networkHelpers.loadFixture(deployFixture);

      expect(await registry.operatorContributor(operator.address)).to.equal(ZeroAddress);
    });

    it("assigns, replaces, and clears an operator contributor", async function () {
      const { registry, admin, operator, contributor, secondContributor } =
        await networkHelpers.loadFixture(allowlistedFixture);

      await expect(
        registry.connect(admin).setOperatorContributor(operator.address, contributor.address),
      )
        .to.emit(registry, "OperatorContributorUpdated")
        .withArgs(operator.address, ZeroAddress, contributor.address);

      await expect(
        registry.connect(admin).setOperatorContributor(operator.address, secondContributor.address),
      )
        .to.emit(registry, "OperatorContributorUpdated")
        .withArgs(operator.address, contributor.address, secondContributor.address);

      await expect(registry.connect(admin).setOperatorContributor(operator.address, ZeroAddress))
        .to.emit(registry, "OperatorContributorUpdated")
        .withArgs(operator.address, secondContributor.address, ZeroAddress);

      expect(await registry.operatorContributor(operator.address)).to.equal(ZeroAddress);
    });

    it("rejects an unallowlisted operator", async function () {
      const { registry, admin, outsider, contributor } =
        await networkHelpers.loadFixture(allowlistedFixture);

      await expect(
        registry.connect(admin).setOperatorContributor(outsider.address, contributor.address),
      )
        .to.be.revertedWithCustomError(registry, "OperatorNotAllowlisted")
        .withArgs(outsider.address);
    });

    it("rejects an unallowlisted contributor", async function () {
      const { registry, admin, operator, outsider } =
        await networkHelpers.loadFixture(allowlistedFixture);

      await expect(
        registry.connect(admin).setOperatorContributor(operator.address, outsider.address),
      )
        .to.be.revertedWithCustomError(registry, "ContributorNotAllowlisted")
        .withArgs(outsider.address);
    });

    it("rejects a zero operator address", async function () {
      const { registry, admin, contributor } = await networkHelpers.loadFixture(allowlistedFixture);

      await expect(
        registry.connect(admin).setOperatorContributor(ZeroAddress, contributor.address),
      ).to.be.revertedWithCustomError(registry, "ZeroAddress");
    });

    it("restricts assignments to ADMIN", async function () {
      const { registry, operator, contributor, outsider } =
        await networkHelpers.loadFixture(allowlistedFixture);
      const adminRole = await registry.ADMIN_ROLE();

      await expect(
        registry.connect(outsider).setOperatorContributor(operator.address, contributor.address),
      )
        .to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount")
        .withArgs(outsider.address, adminRole);
    });
  });
});
