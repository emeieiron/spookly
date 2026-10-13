// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ChequeBookForkTest, IPermitToken} from "./ChequeBook.t.sol";
import {ChequeBook, Permit} from "../src/ChequeBook.sol";

// Models the property relevant to EIP-7702: execution remains at the issuer's
// address, but USDC sees contract code and rejects the deployed v/r/s permit.
contract BatchWallet {
    receive() external payable {}

    function isValidSignature(bytes32, bytes calldata) external pure returns (bytes4) {
        return 0xffffffff;
    }

    function execute(address target, bytes calldata data, uint256 value, uint256 approval) external {
        require(msg.sender == address(this), "owner authorization");
        if (approval > 0) {
            (bool approved,) = address(0x534b2f3A21130d7a60830c2Df862319e593943A3)
                .call(abi.encodeWithSignature("approve(address,uint256)", target, approval));
            require(approved, "approval failed");
        }
        (bool success, bytes memory result) = target.call{value: value}(data);
        if (!success) {
            assembly { revert(add(result, 32), mload(result)) }
        }
    }
}

contract SponsoredWalletForkTest is ChequeBookForkTest {
    function testDelegatedWalletCreatesBookWithExactApproval() public {
        issuer = vm.addr(0xBA7C4);
        issuerKey = 0xBA7C4;
        mintUsdc(issuer, 5e6);
        vm.deal(issuer, 1 ether);
        Permit memory p = permit(address(factory), 2e6);
        uint256 nonce = IPermitToken(address(USDC)).nonces(issuer);
        vm.etch(issuer, address(new BatchWallet()).code);
        vm.prank(issuer);
        BatchWallet(payable(issuer))
            .execute(
                address(factory),
                abi.encodeCall(
                    factory.createAndWrite,
                    (vm.addr(21), 2e6, uint64(block.timestamp + 1 days), 0.3 ether, p, bytes(""))
                ),
                0.3 ether,
                2e6
            );
        ChequeBook created = ChequeBook(payable(factory.bookOf(issuer)));
        require(created.owner() == issuer && created.reserved() == 2e6, "same owner and funded cheque");
        require(USDC.allowance(issuer, address(factory)) == 0, "exact approval consumed");
        require(IPermitToken(address(USDC)).nonces(issuer) == nonce, "raw permit rejected");
    }

    function testDelegatedWalletFundsExistingBookAndReceivesCancellation() public {
        Permit memory p = permit(address(book), 2e6);
        vm.etch(issuer, address(new BatchWallet()).code);
        vm.prank(issuer);
        BatchWallet(payable(issuer))
            .execute(
                address(book),
                abi.encodeCall(
                    book.fundAndWrite,
                    (vm.addr(22), 2e6, uint64(block.timestamp + 1 days), 0.2 ether, 2e6, p, bytes(""))
                ),
                0.2 ether,
                2e6
            );
        require(book.reserved() == 12e6 && USDC.allowance(issuer, address(book)) == 0, "funded and no allowance left");
        vm.prank(issuer);
        BatchWallet(payable(issuer)).execute(address(book), abi.encodeCall(book.cancel, (vm.addr(22))), 0, 0);
        require(book.reserved() == 10e6 && USDC.balanceOf(issuer) == 10e6, "cancel refunded to delegated wallet");
    }
}
