// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ChequeBook, ChequeBookFactory, Permit} from "../src/ChequeBook.sol";
import {IEntryPoint} from "@account-abstraction/contracts/interfaces/IEntryPoint.sol";
import {PackedUserOperation} from "@account-abstraction/contracts/interfaces/PackedUserOperation.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

interface Vm {
    function envAddress(string calldata) external returns (address);
    function etch(address, bytes calldata) external;
    function addr(uint256) external pure returns (address);
    function sign(uint256, bytes32) external pure returns (uint8, bytes32, bytes32);
    function prank(address) external;
    function deal(address, uint256) external;
    function store(address, bytes32, bytes32) external;
    function load(address, bytes32) external view returns (bytes32);
    function warp(uint256) external;
    function expectRevert() external;
    function expectRevert(bytes4) external;
    function expectRevert(bytes calldata) external;
}

interface IPermitToken {
    function nonces(address) external view returns (uint256);
    function DOMAIN_SEPARATOR() external view returns (bytes32);
}

// Run through scripts/forge.mjs on the configured Monad fork so the real EntryPoint 0.7, USDC and CCTP TokenMessengerV2 are exercised.
contract ChequeBookForkTest {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    IEntryPoint constant EP = IEntryPoint(0x0000000071727De22E5E9d8BAf0edAc6f37da032);
    IERC20 USDC;
    address MESSENGER;

    uint256 issuerKey = 0x1551E5;
    address issuer;
    ChequeBookFactory factory;
    address payee = address(0x3E4C);
    address bundler = address(0xB0B);
    uint256 chequeKey = 0xC4E9E;
    address signer;
    ChequeBook book;
    bytes constant SEALED = hex"01aabbccddeeff00112233";

    function setUp() public {
        USDC = IERC20(vm.envAddress("PIPPO_USDC"));
        MESSENGER = vm.envAddress("PIPPO_TOKEN_MESSENGER");
        issuer = vm.addr(issuerKey);
        signer = vm.addr(chequeKey);
        factory = new ChequeBookFactory(address(EP), address(USDC), MESSENGER);
        mintUsdc(issuer, 20e6);
        vm.deal(issuer, 10 ether);
        // One transaction creates the book, pulls 10 USDC by permit, deposits fees and writes the cheque.
        Permit memory p = permit(address(factory), 10e6);
        vm.prank(issuer);
        book = ChequeBook(
            payable(factory.createAndWrite{value: 1 ether}(
                    signer, 10e6, uint64(block.timestamp + 1 days), 0.5 ether, p, SEALED
                ))
        );
        require(factory.bookOf(issuer) == address(book) && book.gasBalance() == 1 ether, "setup");
        require(book.reserved() == 10e6 && book.available() == 0 && USDC.balanceOf(issuer) == 10e6, "funded");
    }

    function testFundAndWritePullsOnlyTheShortfall() public {
        vm.prank(issuer);
        USDC.transfer(address(book), 4e6);
        Permit memory p = permit(address(book), 2e6);
        vm.prank(issuer);
        book.fundAndWrite{value: 0.2 ether}(vm.addr(9), 6e6, uint64(block.timestamp + 1 days), 0.2 ether, 2e6, p, "");
        require(USDC.balanceOf(issuer) == 4e6 && book.reserved() == 16e6 && book.available() == 0, "shortfall only");
        require(book.gasBalance() == 1.2 ether && book.committedGas() == 0.7 ether, "fees topped up");
    }

    function testSealedKeyIsStoredWithTheCheque() public {
        require(keccak256(book.sealedKeys(signer)) == keccak256(SEALED), "stored");
        ChequeBook.ChequeView[] memory list = book.list(0, 1);
        require(keccak256(list[0].sealedKey) == keccak256(SEALED), "listed");
        Permit memory p = permit(address(book), 1e6);
        vm.prank(issuer);
        vm.expectRevert(ChequeBook.InvalidValue.selector);
        book.fundAndWrite(vm.addr(9), 1e6, uint64(block.timestamp + 1 days), 0.1 ether, 1e6, p, new bytes(129));
    }

    function testCreateAndWriteOncePerIssuer() public {
        Permit memory p = permit(address(factory), 1e6);
        vm.prank(issuer);
        vm.expectRevert(ChequeBookFactory.Exists.selector);
        factory.createAndWrite(vm.addr(9), 1e6, uint64(block.timestamp + 1 days), 0.1 ether, p, "");
    }

    function testCancelRefundsUsdcAndSpareFees() public {
        submit(chequeKey, abi.encodeCall(ChequeBook.pay, (signer, payee, 3e6)));
        uint256 monBefore = issuer.balance;
        uint256 deposit = book.gasBalance();
        vm.prank(issuer);
        book.cancel(signer);
        require(USDC.balanceOf(issuer) == 17e6 && book.reserved() == 0, "usdc refunded");
        (uint128 refunded,, bool active,, uint128 amount) = book.cheques(signer);
        require(amount == 10e6 && refunded == 7e6 && !active, "history kept");
        require(
            issuer.balance == monBefore + deposit && book.gasBalance() == 0 && book.committedGas() == 0, "fees refunded"
        );
    }

    function testCancelKeepsFeesOtherChequesNeed() public {
        address second = vm.addr(9);
        Permit memory p = permit(address(book), 2e6);
        vm.prank(issuer);
        book.fundAndWrite(second, 2e6, uint64(block.timestamp + 1 days), 0.2 ether, 2e6, p, "");
        vm.prank(issuer);
        book.cancel(signer);
        require(book.committedGas() == 0.2 ether && book.gasBalance() == 0.2 ether, "second cheque keeps its fees");
        require(book.reserved() == 2e6 && USDC.balanceOf(issuer) == 18e6, "second cheque keeps its USDC");
    }

    function testPaysPayeeOnMonad() public {
        submit(chequeKey, abi.encodeCall(ChequeBook.pay, (signer, payee, 3e6)));
        require(USDC.balanceOf(payee) == 3e6, "payee paid");
        (uint128 remaining,,, uint128 gasLeft,) = book.cheques(signer);
        require(remaining == 7e6 && gasLeft < 0.5 ether, "cheque debited");
        require(book.reserved() == 7e6 && book.available() == 0, "accounting");
        require(book.committedGas() == gasLeft, "committed fees track the cheque");
    }

    function testBurnsForCrossChainPayee() public {
        uint256 before = USDC.balanceOf(address(book));
        submit(
            chequeKey,
            abi.encodeCall(ChequeBook.payCrossChain, (signer, 6, bytes32(uint256(uint160(payee))), 2.1e6, 0.1e6))
        );
        require(USDC.balanceOf(address(book)) == before - 2.1e6, "burned");
        (uint128 remaining,,,,) = book.cheques(signer);
        require(remaining == 7.9e6, "cheque debited");
    }

    function testSequentialPaymentsUseChequeNonce() public {
        submit(chequeKey, abi.encodeCall(ChequeBook.pay, (signer, payee, 1e6)));
        submit(chequeKey, abi.encodeCall(ChequeBook.pay, (signer, payee, 1e6)));
        require(USDC.balanceOf(payee) == 2e6, "two payments");
    }

    function testRejectsWrongKey() public {
        PackedUserOperation memory op = build(0xBAD, abi.encodeCall(ChequeBook.pay, (signer, payee, 1e6)));
        expectFailedOp(op, "AA24 signature error");
    }

    function testRejectsOverspendBeforeChargingFees() public {
        PackedUserOperation memory op = build(chequeKey, abi.encodeCall(ChequeBook.pay, (signer, payee, 11e6)));
        expectFailedOp(op, "AA24 signature error");
        (,,, uint128 gasLeft,) = book.cheques(signer);
        require(gasLeft == 0.5 ether, "fee budget untouched");
    }

    function testRejectsOtherChequesNonce() public {
        PackedUserOperation memory op = build(chequeKey, abi.encodeCall(ChequeBook.pay, (signer, payee, 1e6)));
        op.nonce = EP.getNonce(address(book), 0);
        op.signature = signOp(chequeKey, op);
        expectFailedOp(op, "AA24 signature error");
    }

    function testCancelledChequeCannotPayAndReleasesFunds() public {
        vm.prank(issuer);
        book.cancel(signer);
        require(book.reserved() == 0 && USDC.balanceOf(issuer) == 20e6, "refunded");
        // The swept fee deposit already stops it at prefund, ahead of the cheque's own rejection.
        expectFailedOp(
            build(chequeKey, abi.encodeCall(ChequeBook.pay, (signer, payee, 1e6))), "AA21 didn't pay prefund"
        );
    }

    function testExpiredChequeCannotPay() public {
        vm.warp(block.timestamp + 2 days);
        expectFailedOp(
            build(chequeKey, abi.encodeCall(ChequeBook.pay, (signer, payee, 1e6))), "AA22 expired or not due"
        );
    }

    function testIssuerGuards() public {
        vm.prank(issuer);
        vm.expectRevert(ChequeBook.InvalidValue.selector);
        book.write(signer, 1e6, uint64(block.timestamp + 1 days), 0.1 ether, "");
        vm.prank(issuer);
        vm.expectRevert(ChequeBook.Unavailable.selector);
        book.write(vm.addr(7), 1, uint64(block.timestamp + 1 days), 0.1 ether, "");
        vm.prank(issuer);
        vm.expectRevert(ChequeBook.Unavailable.selector);
        book.cancel(vm.addr(7));
        vm.prank(payee);
        vm.expectRevert(ChequeBook.Unauthorized.selector);
        book.write(vm.addr(8), 1e6, uint64(block.timestamp + 1 days), 0.1 ether, "");
        vm.expectRevert(ChequeBook.Unauthorized.selector);
        book.pay(signer, payee, 1e6);
    }

    function build(uint256 key, bytes memory callData) internal view returns (PackedUserOperation memory op) {
        op.sender = address(book);
        op.nonce = EP.getNonce(address(book), uint192(uint160(signer)));
        op.callData = callData;
        op.accountGasLimits = bytes32((uint256(150_000) << 128) | 600_000);
        op.preVerificationGas = 60_000;
        op.gasFees = bytes32((uint256(2 gwei) << 128) | 100 gwei);
        op.signature = signOp(key, op);
    }

    function signOp(uint256 key, PackedUserOperation memory op) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, MessageHashUtils.toEthSignedMessageHash(EP.getUserOpHash(op)));
        return abi.encodePacked(r, s, v);
    }

    function submit(uint256 key, bytes memory callData) internal {
        PackedUserOperation[] memory ops = new PackedUserOperation[](1);
        ops[0] = build(key, callData);
        vm.prank(bundler);
        EP.handleOps(ops, payable(bundler));
    }

    function expectFailedOp(PackedUserOperation memory op, string memory reason) internal {
        PackedUserOperation[] memory ops = new PackedUserOperation[](1);
        ops[0] = op;
        vm.prank(bundler);
        vm.expectRevert(abi.encodeWithSelector(IEntryPoint.FailedOp.selector, 0, reason));
        EP.handleOps(ops, payable(bundler));
    }

    function permit(address spender, uint256 value) internal view returns (Permit memory p) {
        bytes32 typehash =
            keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");
        uint256 nonce = IPermitToken(address(USDC)).nonces(issuer);
        p.deadline = block.timestamp + 1 hours;
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                IPermitToken(address(USDC)).DOMAIN_SEPARATOR(),
                keccak256(abi.encode(typehash, issuer, spender, value, nonce, p.deadline))
            )
        );
        (p.v, p.r, p.s) = vm.sign(issuerKey, digest);
    }

    // Finds the balance slot of the USDC proxy by probing mapping slots.
    function mintUsdc(address to, uint256 amount) internal {
        for (uint256 i = 0; i < 20; i++) {
            bytes32 slot = keccak256(abi.encode(to, i));
            bytes32 prior = vm.load(address(USDC), slot);
            vm.store(address(USDC), slot, bytes32(amount));
            if (USDC.balanceOf(to) == amount) return;
            vm.store(address(USDC), slot, prior);
        }
        revert("USDC balance slot not found");
    }
}
