// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IAccount} from "@account-abstraction/contracts/interfaces/IAccount.sol";
import {IEntryPoint} from "@account-abstraction/contracts/interfaces/IEntryPoint.sol";
import {PackedUserOperation} from "@account-abstraction/contracts/interfaces/PackedUserOperation.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

interface ITokenMessengerV2 {
    function depositForBurnWithHook(
        uint256 amount,
        uint32 destinationDomain,
        bytes32 mintRecipient,
        address burnToken,
        bytes32 destinationCaller,
        uint256 maxFee,
        uint32 minFinalityThreshold,
        bytes calldata hookData
    ) external;
}

// EIP-2612 signature letting this contract pull USDC without a separate approve transaction. deadline 0 skips
// the permit and relies on an existing allowance.
struct Permit {
    uint256 deadline;
    uint8 v;
    bytes32 r;
    bytes32 s;
}

function usePermit(IERC20 token, address owner, address spender, uint256 value, Permit calldata p) {
    if (p.deadline == 0) return;
    // A front-run permit leaves the allowance in place, so a failure here is not fatal.
    try IERC20Permit(address(token)).permit(owner, spender, value, p.deadline, p.v, p.r, p.s) {} catch {}
}

contract SpookBook is IAccount {
    using SafeERC20 for IERC20;

    struct Spook {
        uint128 remaining;
        uint64 expiry;
        bool active;
        uint128 gasLeft;
        uint128 amount;
    }

    uint32 private constant FINALITY = 2000;
    // Circle Forwarding Service: "cctp-forward", version 0, no extra data. Circle submits the destination mint.
    bytes private constant FORWARD_HOOK = hex"636374702d666f72776172640000000000000000000000000000000000000000";

    address public immutable owner;
    address public immutable factory;
    IEntryPoint public immutable entryPoint;
    IERC20 public immutable usdc;
    ITokenMessengerV2 public immutable messenger;

    uint256 public reserved;
    // Fee allowance still unspent by active spooks; deposit above this belongs to the owner.
    uint256 public committedGas;
    mapping(address => Spook) public spooks;
    // The spook's one-off key, sealed with a key only the issuer's passkey can derive, so its link can be
    // restored on any device. Opaque to the contract.
    mapping(address => bytes) public sealedKeys;
    address[] private signers;

    error Unauthorized();
    error InvalidValue();
    error Unavailable();

    event SpookCreated(address indexed signer, uint256 amount, uint64 expiry, uint256 gasBudget);
    event SpookCancelled(address indexed signer, uint256 released);
    event Paid(address indexed signer, address indexed recipient, uint256 amount);
    event PaidCrossChain(
        address indexed signer, uint32 indexed domain, bytes32 recipient, uint256 amount, uint256 maxFee
    );

    constructor(address issuer, address ep, address token, address tokenMessenger) {
        if (issuer == address(0) || ep.code.length == 0 || token.code.length == 0 || tokenMessenger.code.length == 0) {
            revert InvalidValue();
        }
        owner = issuer;
        factory = msg.sender;
        entryPoint = IEntryPoint(ep);
        usdc = IERC20(token);
        messenger = ITokenMessengerV2(tokenMessenger);
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }
    // The factory creates the first spook of a book it has just created, in the same transaction.
    modifier onlyOwnerOrFactory() {
        if (msg.sender != owner && msg.sender != factory) revert Unauthorized();
        _;
    }
    modifier onlyEntryPoint() {
        if (msg.sender != address(entryPoint)) revert Unauthorized();
        _;
    }

    receive() external payable {
        entryPoint.depositTo{value: msg.value}(address(this));
    }

    // Funding is a plain USDC transfer to this address.
    function available() public view returns (uint256) {
        return usdc.balanceOf(address(this)) - reserved;
    }

    function gasBalance() external view returns (uint256) {
        return entryPoint.balanceOf(address(this));
    }

    function spookCount() external view returns (uint256) {
        return signers.length;
    }

    function spook(address signer, uint128 amount, uint64 expiry, uint128 gasBudget, bytes calldata sealedKey)
        public
        onlyOwnerOrFactory
    {
        // A key can be created once, so a cancelled link never becomes spendable again.
        if (signer == address(0) || spooks[signer].expiry != 0) revert InvalidValue();
        if (amount == 0 || expiry <= block.timestamp || gasBudget == 0) revert InvalidValue();
        if (amount > available()) revert Unavailable();
        reserved += amount;
        committedGas += gasBudget;
        if (sealedKey.length > 128) revert InvalidValue();
        spooks[signer] = Spook(amount, expiry, true, gasBudget, amount);
        if (sealedKey.length > 0) sealedKeys[signer] = sealedKey;
        signers.push(signer);
        emit SpookCreated(signer, amount, expiry, gasBudget);
    }

    /// One transaction per spook: tops up the fee deposit with msg.value, pulls `pull` USDC from the owner
    /// (with an optional permit), then creates the spook.
    function fundAndSpook(
        address signer,
        uint128 amount,
        uint64 expiry,
        uint128 gasBudget,
        uint256 pull,
        Permit calldata permit,
        bytes calldata sealedKey
    ) external payable onlyOwner {
        if (msg.value > 0) entryPoint.depositTo{value: msg.value}(address(this));
        if (pull > 0) {
            usePermit(usdc, owner, address(this), pull, permit);
            usdc.safeTransferFrom(owner, address(this), pull);
        }
        spook(signer, amount, expiry, gasBudget, sealedKey);
    }

    /// Ends a spook and returns its unspent USDC plus all fee deposit no live spook needs to the owner.
    function cancel(address signer) external onlyOwner {
        Spook storage c = spooks[signer];
        if (!c.active) revert Unavailable();
        uint256 refund = c.remaining;
        reserved -= refund;
        committedGas -= c.gasLeft;
        // remaining is kept as a record of what was refunded; `active` alone gates spending.
        c.gasLeft = 0;
        c.active = false;
        if (refund > 0) usdc.safeTransfer(owner, refund);
        uint256 deposit = entryPoint.balanceOf(address(this));
        if (deposit > committedGas) entryPoint.withdrawTo(payable(owner), deposit - committedGas);
        emit SpookCancelled(signer, refund);
    }

    struct SpookView {
        address signer;
        uint128 amount;
        uint128 remaining;
        uint64 expiry;
        bool active;
        uint128 gasLeft;
        bytes sealedKey;
    }

    function list(uint256 start, uint256 count) external view returns (SpookView[] memory out) {
        uint256 end = start + count > signers.length ? signers.length : start + count;
        out = new SpookView[](end > start ? end - start : 0);
        for (uint256 i = start; i < end; i++) {
            Spook memory c = spooks[signers[i]];
            out[i - start] =
                SpookView(signers[i], c.amount, c.remaining, c.expiry, c.active, c.gasLeft, sealedKeys[signers[i]]);
        }
    }

    function pay(address signer, address recipient, uint256 amount) external onlyEntryPoint {
        if (recipient == address(0) || recipient == address(this)) revert InvalidValue();
        spend(signer, amount);
        usdc.safeTransfer(recipient, amount);
        emit Paid(signer, recipient, amount);
    }

    // amount is the total burned; the recipient receives amount minus Circle's fee (at most maxFee).
    function payCrossChain(address signer, uint32 domain, bytes32 recipient, uint256 amount, uint256 maxFee)
        external
        onlyEntryPoint
    {
        if (recipient == bytes32(0) || maxFee >= amount) revert InvalidValue();
        spend(signer, amount);
        usdc.forceApprove(address(messenger), amount);
        messenger.depositForBurnWithHook(
            amount, domain, recipient, address(usdc), bytes32(0), maxFee, FINALITY, FORWARD_HOOK
        );
        emit PaidCrossChain(signer, domain, recipient, amount, maxFee);
    }

    function spend(address signer, uint256 amount) private {
        Spook storage c = spooks[signer];
        if (!c.active || block.timestamp >= c.expiry) revert Unavailable();
        if (amount == 0 || amount > c.remaining) revert InvalidValue();
        c.remaining -= uint128(amount);
        reserved -= amount;
    }

    // The spook key signs the EIP-191 form of userOpHash. The first call argument names the spook and the
    // nonce key must equal it, giving each spook its own sequence. ERC-7562 bans TIMESTAMP here, so expiry is
    // returned as validUntil, and only this account's storage is touched.
    function validateUserOp(PackedUserOperation calldata op, bytes32 opHash, uint256)
        external
        onlyEntryPoint
        returns (uint256)
    {
        if (op.callData.length < 100 || op.paymasterAndData.length != 0 || op.initCode.length != 0) {
            return 1;
        }
        bytes4 selector = bytes4(op.callData[:4]);
        uint256 amount;
        if (selector == this.pay.selector) {
            amount = uint256(bytes32(op.callData[68:100]));
        } else if (selector == this.payCrossChain.selector && op.callData.length >= 164) {
            amount = uint256(bytes32(op.callData[100:132]));
        } else {
            return 1;
        }
        address signer = address(uint160(uint256(bytes32(op.callData[4:36]))));
        if (op.nonce >> 64 != uint256(uint160(signer))) return 1;

        Spook storage c = spooks[signer];
        uint256 cost =
            (uint256(uint128(bytes16(op.accountGasLimits)))
                    + uint128(uint256(op.accountGasLimits))
                    + op.preVerificationGas) * uint128(uint256(op.gasFees));
        // Refuse requests that would certainly fail, so a link holder cannot burn the fee budget. Signature
        // recovery runs regardless so gas estimation with a stub signature measures the real path; a bad
        // signature makes EntryPoint revert the bundle, so the fee charge below never persists.
        bool ok = c.active && amount != 0 && amount <= c.remaining && cost <= c.gasLeft;
        if (ok) {
            c.gasLeft -= uint128(cost);
            committedGas -= cost;
        }
        (address recovered, ECDSA.RecoverError err,) =
            ECDSA.tryRecover(MessageHashUtils.toEthSignedMessageHash(opHash), op.signature);
        if (!ok || err != ECDSA.RecoverError.NoError || recovered != signer) return 1;
        return uint256(c.expiry) << 160;
    }
}

contract SpookBookFactory {
    using SafeERC20 for IERC20;

    address public immutable entryPoint;
    address public immutable usdc;
    address public immutable messenger;
    mapping(address => address) public bookOf;
    event BookCreated(address indexed owner, address book);
    error Exists();

    constructor(address ep, address token, address tokenMessenger) {
        entryPoint = ep;
        usdc = token;
        messenger = tokenMessenger;
    }

    /// A first-time issuer's whole setup in one transaction: deploy the book, fund it, deposit fees, create a spook.
    function createAndSpook(
        address signer,
        uint128 amount,
        uint64 expiry,
        uint128 gasBudget,
        Permit calldata permit,
        bytes calldata sealedKey
    ) external payable returns (address book) {
        if (bookOf[msg.sender] != address(0)) revert Exists();
        book = address(new SpookBook(msg.sender, entryPoint, usdc, messenger));
        bookOf[msg.sender] = book;
        emit BookCreated(msg.sender, book);
        usePermit(IERC20(usdc), msg.sender, address(this), amount, permit);
        IERC20(usdc).safeTransferFrom(msg.sender, book, amount);
        if (msg.value > 0) IEntryPoint(entryPoint).depositTo{value: msg.value}(book);
        SpookBook(payable(book)).spook(signer, amount, expiry, gasBudget, sealedKey);
    }
}
