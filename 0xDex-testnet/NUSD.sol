// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract NUSD is ERC20, Ownable {
    constructor() ERC20("NUSD", "NUSD") Ownable(msg.sender) {}

   
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

  
    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
    }

    
    function burnFrom(address from, uint256 amount) external {
        _spendAllowance(from, msg.sender, amount);
        _burn(from, amount);
    }

    
    function burnByOwner(address from, uint256 amount) external onlyOwner {
        _burn(from, amount);
    }
}