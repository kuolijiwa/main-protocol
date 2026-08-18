import hre from "hardhat";
import { deployMainProtocol } from "./lib/deploy-main-protocol.js";

const connection = await hre.network.create();
const deployments = await deployMainProtocol(connection, process.env);

console.log(JSON.stringify(deployments, null, 2));
