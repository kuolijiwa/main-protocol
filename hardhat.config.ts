import hardhatToolboxMochaEthers from "@nomicfoundation/hardhat-toolbox-mocha-ethers";
import hardhatUpgrades from "@openzeppelin/hardhat-upgrades";
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { configVariable, defineConfig } from "hardhat/config";

if (existsSync(".env")) loadEnvFile(".env");

export default defineConfig({
  plugins: [hardhatToolboxMochaEthers, hardhatUpgrades],
  solidity: {
    version: "0.8.28",
    settings: {
      evmVersion: "cancun",
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  networks: {
    baseSepolia: {
      type: "http",
      chainType: "op",
      url: configVariable("BASE_SEPOLIA_RPC_URL"),
      accounts: [configVariable("DEPLOYER_PRIVATE_KEY")],
    },
    base: {
      type: "http",
      chainType: "op",
      url: configVariable("BASE_RPC_URL"),
      accounts: [configVariable("DEPLOYER_PRIVATE_KEY")],
    },
    arbitrum: {
      type: "http",
      chainType: "l1",
      url: configVariable("ARBITRUM_RPC_URL"),
      accounts: [configVariable("DEPLOYER_PRIVATE_KEY")],
    },
    optimism: {
      type: "http",
      chainType: "op",
      url: configVariable("OPTIMISM_RPC_URL"),
      accounts: [configVariable("DEPLOYER_PRIVATE_KEY")],
    },
  },
});
