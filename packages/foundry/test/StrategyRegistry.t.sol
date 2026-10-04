// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Test } from "forge-std/Test.sol";
import { StrategyRegistry } from "../contracts/StrategyRegistry.sol";

contract StrategyRegistryTest is Test {
    StrategyRegistry internal registry;
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    bytes32 internal constant PARAMS = keccak256('{"symbol":"HBAR-USDC","slices":4}');

    function setUp() public {
        registry = new StrategyRegistry();
    }

    function _register(address operator, string memory name) internal returns (uint256 id) {
        vm.prank(operator);
        id = registry.register(name, 7_000_001, "0.0.123456", PARAMS);
    }

    function _hash(uint8 fill) internal pure returns (bytes memory h) {
        h = new bytes(48);
        for (uint256 i; i < 48; ++i) {
            h[i] = bytes1(fill);
        }
    }

    function test_register_storesStrategyAndEmits() public {
        vm.expectEmit(address(registry));
        emit StrategyRegistry.StrategyRegistered(0, alice, 7_000_001, "TWAP HBAR");
        uint256 id = _register(alice, "TWAP HBAR");

        StrategyRegistry.Strategy memory s = registry.getStrategy(id);
        assertEq(s.operator, alice);
        assertTrue(s.active);
        assertEq(s.topicNum, 7_000_001);
        assertEq(s.paramsHash, PARAMS);
        assertEq(s.venueAccount, "0.0.123456");
        assertEq(s.createdAt, block.timestamp);
        assertEq(registry.strategyCount(), 1);
        assertEq(registry.strategiesOf(alice)[0], id);
    }

    function test_register_validatesInput() public {
        vm.expectRevert(StrategyRegistry.InvalidName.selector);
        registry.register("", 1, "", PARAMS);

        vm.expectRevert(StrategyRegistry.InvalidName.selector);
        registry.register(string(new bytes(65)), 1, "", PARAMS);

        vm.expectRevert(StrategyRegistry.InvalidTopic.selector);
        registry.register("x", 0, "", PARAMS);

        vm.expectRevert(StrategyRegistry.InvalidVenueAccount.selector);
        registry.register("x", 1, string(new bytes(65)), PARAMS);

        uint256 id = registry.register("x", 1, string(new bytes(64)), PARAMS);
        assertEq(bytes(registry.getStrategy(id).venueAccount).length, 64);
    }

    function test_update_newTopicResetsCheckpoint() public {
        uint256 id = _register(alice, "TWAP HBAR");
        vm.startPrank(alice);
        registry.anchorCheckpoint(id, 500, _hash(0xaa), 1_000);

        // Same topic, new params: the checkpoint still describes this topic and is kept.
        registry.update(id, 7_000_001, bytes32(uint256(2)));
        assertEq(registry.latestCheckpoint(id).sequenceNumber, 500);

        vm.expectEmit(address(registry));
        emit StrategyRegistry.CheckpointReset(id, 7_000_001);
        registry.update(id, 7_000_002, bytes32(uint256(2)));

        StrategyRegistry.Checkpoint memory c = registry.latestCheckpoint(id);
        assertEq(c.sequenceNumber, 0);
        assertEq(c.anchoredAt, 0);
        assertEq(c.realizedPnl, 0);
        assertEq(c.runningHash.length, 0);

        // The new topic can be anchored from its own first message, not from the old topic's sequence number.
        registry.anchorCheckpoint(id, 1, _hash(0xbb), 0);
        assertEq(registry.latestCheckpoint(id).sequenceNumber, 1);
        vm.stopPrank();
    }

    function test_operatorOnlyActions() public {
        uint256 id = _register(alice, "TWAP HBAR");

        vm.startPrank(bob);
        vm.expectRevert(abi.encodeWithSelector(StrategyRegistry.NotOperator.selector, id));
        registry.update(id, 2, PARAMS);
        vm.expectRevert(abi.encodeWithSelector(StrategyRegistry.NotOperator.selector, id));
        registry.setActive(id, false);
        vm.expectRevert(abi.encodeWithSelector(StrategyRegistry.NotOperator.selector, id));
        registry.anchorCheckpoint(id, 1, _hash(1), 0);
        vm.stopPrank();

        vm.expectRevert(abi.encodeWithSelector(StrategyRegistry.UnknownStrategy.selector, 9));
        registry.setActive(9, false);
    }

    function test_update_andDeactivate() public {
        uint256 id = _register(alice, "TWAP HBAR");
        vm.startPrank(alice);
        registry.update(id, 7_000_002, bytes32(uint256(1)));
        registry.setActive(id, false);
        vm.stopPrank();

        StrategyRegistry.Strategy memory s = registry.getStrategy(id);
        assertEq(s.topicNum, 7_000_002);
        assertEq(s.paramsHash, bytes32(uint256(1)));
        assertFalse(s.active);
    }

    function test_transferOperator() public {
        uint256 id = _register(alice, "TWAP HBAR");
        vm.prank(alice);
        registry.transferOperator(id, bob);

        assertEq(registry.getStrategy(id).operator, bob);
        assertEq(registry.strategiesOf(bob)[0], id);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(StrategyRegistry.NotOperator.selector, id));
        registry.setActive(id, false);

        vm.prank(bob);
        vm.expectRevert(StrategyRegistry.InvalidOperator.selector);
        registry.transferOperator(id, address(0));
    }

    function test_transferOperator_movesIdBetweenLists() public {
        uint256 first = _register(alice, "TWAP HBAR");
        uint256 second = _register(alice, "TWAP SAUCE");
        uint256 third = _register(alice, "TWAP PACK");

        vm.prank(alice);
        registry.transferOperator(first, bob);
        uint256[] memory left = registry.strategiesOf(alice);
        assertEq(left.length, 2, "alice keeps two");
        assertTrue(left[0] != first && left[1] != first, "transferred id left alice's list");
        assertEq(registry.strategiesOf(bob).length, 1);

        // Back to alice: listed once, not twice.
        vm.prank(bob);
        registry.transferOperator(first, alice);
        assertEq(registry.strategiesOf(alice).length, 3);
        assertEq(registry.strategiesOf(bob).length, 0);

        // Transferring to yourself changes nothing.
        vm.prank(alice);
        registry.transferOperator(second, alice);
        assertEq(registry.strategiesOf(alice).length, 3);
        assertEq(registry.getStrategy(third).operator, alice);
    }

    /// forge-config: default.fuzz.runs = 256
    function testFuzz_strategiesOf_listsExactlyWhatEachOperatorRuns(uint8[16] calldata moves) public {
        address[3] memory operators = [alice, bob, makeAddr("carol")];
        for (uint256 i; i < 4; ++i) {
            _register(operators[i % 3], "TWAP");
        }
        for (uint256 i; i < moves.length; ++i) {
            uint256 id = moves[i] % 4;
            address to = operators[(moves[i] / 4) % 3];
            vm.prank(registry.getStrategy(id).operator);
            registry.transferOperator(id, to);
        }
        uint256 listed;
        for (uint256 o; o < 3; ++o) {
            uint256[] memory ids = registry.strategiesOf(operators[o]);
            listed += ids.length;
            for (uint256 j; j < ids.length; ++j) {
                assertEq(registry.getStrategy(ids[j]).operator, operators[o], "listed under its operator");
            }
        }
        assertEq(listed, 4, "every strategy listed exactly once");
    }

    function test_checkpoints_onlyMoveForward() public {
        uint256 id = _register(alice, "TWAP HBAR");
        vm.startPrank(alice);
        registry.anchorCheckpoint(id, 10, _hash(0xaa), 1_500_000);

        StrategyRegistry.Checkpoint memory c = registry.latestCheckpoint(id);
        assertEq(c.sequenceNumber, 10);
        assertEq(c.realizedPnl, 1_500_000);
        assertEq(c.runningHash, _hash(0xaa));

        vm.expectRevert(abi.encodeWithSelector(StrategyRegistry.StaleCheckpoint.selector, 10, 10));
        registry.anchorCheckpoint(id, 10, _hash(0xbb), 0);

        vm.expectRevert(StrategyRegistry.InvalidRunningHash.selector);
        registry.anchorCheckpoint(id, 11, new bytes(32), 0);

        registry.anchorCheckpoint(id, 11, _hash(0xbb), -250_000);
        assertEq(registry.latestCheckpoint(id).realizedPnl, -250_000);
        vm.stopPrank();
    }

    function test_listStrategies_newestFirstWithPaging() public {
        for (uint256 i; i < 5; ++i) {
            _register(alice, string(abi.encodePacked("S", vm.toString(i))));
        }
        StrategyRegistry.Strategy[] memory page = registry.listStrategies(0, 2);
        assertEq(page.length, 2);
        assertEq(page[0].name, "S4");
        assertEq(page[1].name, "S3");

        page = registry.listStrategies(4, 10);
        assertEq(page.length, 1);
        assertEq(page[0].name, "S0");
        assertEq(registry.listStrategies(5, 10).length, 0);
    }

    function testFuzz_register_venueAccountIsBounded(string calldata venueAccount) public {
        if (bytes(venueAccount).length > 64) {
            vm.expectRevert(StrategyRegistry.InvalidVenueAccount.selector);
            registry.register("x", 1, venueAccount, PARAMS);
        } else {
            uint256 id = registry.register("x", 1, venueAccount, PARAMS);
            assertEq(registry.getStrategy(id).venueAccount, venueAccount);
        }
    }

    function testFuzz_register_anyValidInput(string calldata name, uint64 topic, bytes32 params) public {
        vm.assume(bytes(name).length > 0 && bytes(name).length <= 64 && topic > 0);
        uint256 id = registry.register(name, topic, "0.0.1", params);
        StrategyRegistry.Strategy memory s = registry.getStrategy(id);
        assertEq(s.name, name);
        assertEq(s.topicNum, topic);
        assertEq(s.paramsHash, params);
    }
}
