import hre from "hardhat";
import { verifyMainProtocol } from "./lib/verify-main-protocol.js";

const connection = await hre.network.create();
const result = await verifyMainProtocol(connection, process.env);

console.log(JSON.stringify(result, null, 2));
