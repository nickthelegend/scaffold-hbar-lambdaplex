//SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import { ScaffoldETHDeploy } from "./DeployHelpers.s.sol";
import { StrategyRegistry } from "../contracts/StrategyRegistry.sol";

/// @notice Deploys StrategyRegistry. Run with `yarn foundry:deploy --network hedera_testnet`.
contract DeployScript is ScaffoldETHDeploy {
    function run() external ScaffoldEthDeployerRunner {
        StrategyRegistry registry = new StrategyRegistry();
        deployments.push(Deployment({ name: "StrategyRegistry", addr: address(registry) }));
    }
}
