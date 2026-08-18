import hre from "hardhat";
import { deployMainProtocol } from "./lib/deploy-main-protocol.js";
import { writeDeploymentRecord } from "./lib/deployment-record.js";

const connection = await hre.network.create();
const deployments = await deployMainProtocol(connection, process.env);
const deploymentRecord = await writeDeploymentRecord(connection, deployments, process.env);

console.log(JSON.stringify({ ...deployments, deploymentRecord }, null, 2));
