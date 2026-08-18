import { expect } from "chai";
import { publicDeploymentConfiguration } from "../../scripts/lib/deployment-record.js";

describe("Deployment records", function () {
  it("keeps public deployment configuration and excludes secrets", function () {
    const record = publicDeploymentConfiguration({
      PAYMENT_TOKEN: "0x1111111111111111111111111111111111111111",
      TIMELOCK_DELAY_SECONDS: "60",
      DEPLOYER_PRIVATE_KEY: "0xprivate",
      PIPELINE_OPERATOR_PRIVATE_KEY: "0xprivate",
      BASE_SEPOLIA_RPC_URL: "https://example.invalid",
    });

    expect(record.PAYMENT_TOKEN).to.equal("0x1111111111111111111111111111111111111111");
    expect(record.TIMELOCK_DELAY_SECONDS).to.equal("60");
    expect(record).not.to.have.property("DEPLOYER_PRIVATE_KEY");
    expect(record).not.to.have.property("PIPELINE_OPERATOR_PRIVATE_KEY");
    expect(record).not.to.have.property("BASE_SEPOLIA_RPC_URL");
  });
});
