// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title StrategyRegistry
/// @notice On-chain directory of trading strategies and their verifiable track records.
/// @dev A strategy's trades happen on Lambdaplex and every settled fill is published to an HCS topic that only the
///      operator can write to. This registry binds the pieces together where other contracts and frontends can read
///      them: who operates the strategy, which HCS topic holds its record, which Lambdaplex account trades, and a hash
///      of its parameters. Operators can anchor checkpoints of the topic (sequence number + running hash + reported
///      PnL) so a consumer, such as a copy-trading vault, can reference the record "as of" an exact HCS message.
contract StrategyRegistry {
    struct Strategy {
        address operator;
        bool active;
        uint64 topicNum; // HCS topic 0.0.<topicNum>
        uint64 createdAt;
        bytes32 paramsHash; // keccak256 of the strategy's canonical JSON parameters
        string name;
        string venueAccount; // Lambdaplex trading account, e.g. "0.0.123456"
    }

    struct Checkpoint {
        uint64 sequenceNumber; // last HCS sequence number covered
        uint64 anchoredAt;
        int128 realizedPnl; // quote units with 6 decimals, as reported by the operator
        bytes runningHash; // HCS topic running hash (48 bytes) after `sequenceNumber`
    }

    uint256 internal constant MAX_NAME_LENGTH = 64;
    uint256 internal constant MAX_VENUE_ACCOUNT_LENGTH = 64; // "0.0.x" ids and 0x EVM addresses both fit
    uint256 internal constant RUNNING_HASH_LENGTH = 48;

    Strategy[] internal _strategies;
    mapping(uint256 => Checkpoint) internal _latestCheckpoint;
    mapping(address => uint256[]) internal _byOperator;
    /// @dev Position of each strategy id in its operator's `_byOperator` list, for O(1) removal on transfer.
    mapping(uint256 => uint256) internal _operatorSlot;

    event StrategyRegistered(uint256 indexed id, address indexed operator, uint64 topicNum, string name);
    event StrategyUpdated(uint256 indexed id, uint64 topicNum, bytes32 paramsHash);
    event StrategyStatusChanged(uint256 indexed id, bool active);
    event OperatorTransferred(uint256 indexed id, address indexed previousOperator, address indexed newOperator);
    event CheckpointAnchored(uint256 indexed id, uint64 sequenceNumber, int128 realizedPnl, bytes runningHash);
    event CheckpointReset(uint256 indexed id, uint64 previousTopicNum);

    error UnknownStrategy(uint256 id);
    error NotOperator(uint256 id);
    error InvalidName();
    error InvalidVenueAccount();
    error InvalidTopic();
    error InvalidOperator();
    error InvalidRunningHash();
    error StaleCheckpoint(uint64 latest, uint64 proposed);

    modifier onlyOperator(uint256 id) {
        if (id >= _strategies.length) revert UnknownStrategy(id);
        if (_strategies[id].operator != msg.sender) revert NotOperator(id);
        _;
    }

    function register(string calldata name, uint64 topicNum, string calldata venueAccount, bytes32 paramsHash)
        external
        returns (uint256 id)
    {
        if (bytes(name).length == 0 || bytes(name).length > MAX_NAME_LENGTH) revert InvalidName();
        if (topicNum == 0) revert InvalidTopic();
        if (bytes(venueAccount).length > MAX_VENUE_ACCOUNT_LENGTH) revert InvalidVenueAccount();

        id = _strategies.length;
        _strategies.push(
            Strategy({
                operator: msg.sender,
                active: true,
                topicNum: topicNum,
                createdAt: uint64(block.timestamp),
                paramsHash: paramsHash,
                name: name,
                venueAccount: venueAccount
            })
        );
        _operatorSlot[id] = _byOperator[msg.sender].length;
        _byOperator[msg.sender].push(id);
        emit StrategyRegistered(id, msg.sender, topicNum, name);
    }

    /// @notice Changes the strategy's topic or parameters. Moving to a different topic clears the checkpoint: its
    ///         sequence number and running hash describe the old topic and mean nothing for the new one.
    function update(uint256 id, uint64 topicNum, bytes32 paramsHash) external onlyOperator(id) {
        if (topicNum == 0) revert InvalidTopic();
        Strategy storage strategy = _strategies[id];
        uint64 previousTopicNum = strategy.topicNum;
        if (topicNum != previousTopicNum) {
            delete _latestCheckpoint[id];
            emit CheckpointReset(id, previousTopicNum);
        }
        strategy.topicNum = topicNum;
        strategy.paramsHash = paramsHash;
        emit StrategyUpdated(id, topicNum, paramsHash);
    }

    function setActive(uint256 id, bool active) external onlyOperator(id) {
        _strategies[id].active = active;
        emit StrategyStatusChanged(id, active);
    }

    function transferOperator(uint256 id, address newOperator) external onlyOperator(id) {
        if (newOperator == address(0)) revert InvalidOperator();
        if (newOperator == msg.sender) return;

        // Move the id between operators' lists (swap-and-pop), so `strategiesOf` only lists what each one operates.
        uint256[] storage previous = _byOperator[msg.sender];
        uint256 slot = _operatorSlot[id];
        uint256 last = previous[previous.length - 1];
        previous[slot] = last;
        _operatorSlot[last] = slot;
        previous.pop();

        _operatorSlot[id] = _byOperator[newOperator].length;
        _byOperator[newOperator].push(id);
        _strategies[id].operator = newOperator;
        emit OperatorTransferred(id, msg.sender, newOperator);
    }

    /// @notice Anchors the strategy's HCS record up to `sequenceNumber`. Checkpoints only move forward.
    function anchorCheckpoint(uint256 id, uint64 sequenceNumber, bytes calldata runningHash, int128 realizedPnl)
        external
        onlyOperator(id)
    {
        if (runningHash.length != RUNNING_HASH_LENGTH) revert InvalidRunningHash();
        uint64 latest = _latestCheckpoint[id].sequenceNumber;
        if (sequenceNumber <= latest) revert StaleCheckpoint(latest, sequenceNumber);

        _latestCheckpoint[id] = Checkpoint({
            sequenceNumber: sequenceNumber,
            anchoredAt: uint64(block.timestamp),
            realizedPnl: realizedPnl,
            runningHash: runningHash
        });
        emit CheckpointAnchored(id, sequenceNumber, realizedPnl, runningHash);
    }

    function getStrategy(uint256 id) external view returns (Strategy memory) {
        if (id >= _strategies.length) revert UnknownStrategy(id);
        return _strategies[id];
    }

    function latestCheckpoint(uint256 id) external view returns (Checkpoint memory) {
        if (id >= _strategies.length) revert UnknownStrategy(id);
        return _latestCheckpoint[id];
    }

    function strategyCount() external view returns (uint256) {
        return _strategies.length;
    }

    /// @notice Ids `operator` currently operates. Order changes when a strategy is transferred away.
    function strategiesOf(address operator) external view returns (uint256[] memory) {
        return _byOperator[operator];
    }

    /// @notice A page of strategies, newest first, for frontends.
    function listStrategies(uint256 offset, uint256 limit) external view returns (Strategy[] memory page) {
        uint256 total = _strategies.length;
        if (offset >= total) return new Strategy[](0);
        uint256 count = total - offset < limit ? total - offset : limit;
        page = new Strategy[](count);
        for (uint256 i; i < count; ++i) {
            page[i] = _strategies[total - 1 - offset - i];
        }
    }
}
