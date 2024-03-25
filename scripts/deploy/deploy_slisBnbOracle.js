const hre = require("hardhat");
const { ethers, upgrades} = require("hardhat");

export async function main() {
    console.log("Network: ", hre.network.name);
    const contractName = /^bsc_testnet$/.test(hre.network.name) ? "SlisBnbOracleTestnet" : "SlisBnbOracle";
    const SlisBnbOracle = await ethers.getContractFactory(contractName);
    const slisBnbOracle = await SlisBnbOracle.deploy();
    await slisBnbOracle.deployed();
    console.log("Deployed: SlisBnbOracle: " + slisBnbOracle.address);

    await hre.run("verify:verify", {
        address: slisBnbOracle.address,
        constructorArguments: [],
    });
    console.log('Contract verified.');
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });

