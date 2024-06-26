const fs = require('fs')
const path = require('path')
const {ethers, upgrades} = require('hardhat')
const {transferProxyAdminOwner} = require('../upgrades/utils/upgrade_utils')

// Global Variables
let rad = '000000000000000000000000000000000000000000000' // 45 Decimals

module.exports.addCollateral = async function (opts) {
  const {
    symbol,
    tokenAddress,
    oracleName = 'BtcOracle',
    oracleInitializeArgs = [],
    oracleInitializer = 'initialize',
    owner,
    proxyAdminOwner,
    clipperBuf = '1100000000000000000000000000',
    clipperTail = '10800',
    clipperCusp = '600000000000000000000000000',
    clipperChip = '0',
    clipperTip = '5' + rad,
    clipperStopped = '0'
  } = opts;

  [deployer] = await ethers.getSigners()
  let NEW_OWNER = owner || '0xAca0ed4651ddA1F43f00363643CFa5EBF8774b37'
  let NEW_PROXY_ADMIN_OWNER = proxyAdminOwner || '0x08aE09467ff962aF105c23775B9Bc8EAa175D27F'

  // Fetch factories
  this.GemJoin = await hre.ethers.getContractFactory('GemJoin')
  this.Clipper = await hre.ethers.getContractFactory('Clipper')
  this.Oracle = await hre.ethers.getContractFactory(oracleName)

  // Set addresses
  const ILK = ethers.encodeBytes32String(symbol)
  let VAT = '0x33A34eAB3ee892D40420507B820347b1cA2201c4'
  let DOG = '0xd57E7b53a1572d27A04d9c1De2c4D423f1926d0B'
  let SPOT = '0x49bc2c4E5B035341b7d92Da4e6B267F7426F3038'
  let INTERACTION = '0xB68443Ee3e828baD1526b3e0Bdf2Dfc6b1975ec4'
  let VOW = '0x2078A1969Ea581D618FDBEa2C0Dc13Fc15CB9fa7'
  let ABACI = '0xc1359eD77E6B0CBF9a8130a4C28FBbB87B9501b7'

  if (hre.network.name === 'bsc_testnet') {
    NEW_OWNER = owner || deployer.address
    NEW_PROXY_ADMIN_OWNER = proxyAdminOwner || deployer.address
    VAT = '0xC9eeBDB18bD05dCF981F340b838E8CdD946D60ad'
    DOG = '0x77e4FcEbCDd30447f6e2E486B00a552A6493da0F'
    SPOT = '0x15493D9141481505f7CA3e591Cea2cBB03637B1d'
    INTERACTION = '0xb7A5999AEaE17C37d07ac4b34e56757c96387c84'
    VOW = '0x08b0e59E3AC9266738c6d14bAbAA414f3A989ccc'
    ABACI = '0x1f4F2aF5F8970654466d334208D1478eaabB28E3'
  }

  // Deploy contracts
  const gemJoin = await upgrades.deployProxy(this.GemJoin, [VAT, ILK, tokenAddress])
  await gemJoin.waitForDeployment()
  let gemJoinImplementation = await upgrades.erc1967.getImplementationAddress(gemJoin.target)
  console.log('Deployed: gemJoin    : ' + gemJoin.target)
  console.log('Imp                  : ' + gemJoinImplementation)
  // transfer proxy admin ownership
  if (deployer.address !== NEW_PROXY_ADMIN_OWNER) {
    await transferProxyAdminOwner(gemJoin.target, NEW_PROXY_ADMIN_OWNER)
    console.log('Proxy Admin Ownership Of gemJoin Transferred to: ' + NEW_PROXY_ADMIN_OWNER)
  }

  const clipper = await upgrades.deployProxy(this.Clipper, [VAT, SPOT, DOG, ILK])
  await clipper.waitForDeployment()
  let clipperImplementation = await upgrades.erc1967.getImplementationAddress(clipper.target)
  console.log('Deployed: clipCE     : ' + clipper.target)
  console.log('Imp                  : ' + clipperImplementation)
  // transfer proxy admin ownership
  if (deployer.address !== NEW_PROXY_ADMIN_OWNER) {
    await transferProxyAdminOwner(clipper.target, NEW_PROXY_ADMIN_OWNER)
    console.log('Proxy Admin Ownership Of clipCE Transferred to: ' + NEW_PROXY_ADMIN_OWNER)
  }

  const oracle = await upgrades.deployProxy(this.Oracle, oracleInitializeArgs, {initializer: oracleInitializer})
  await oracle.waitForDeployment()
  let oracleImplementation = await upgrades.erc1967.getImplementationAddress(oracle.target)
  console.log('Deployed: oracle     : ' + oracle.target)
  console.log('Imp                  : ' + oracleImplementation)
  // transfer proxy admin ownership
  if (deployer.address !== NEW_PROXY_ADMIN_OWNER) {
    await transferProxyAdminOwner(oracle.target, NEW_PROXY_ADMIN_OWNER)
    console.log('Proxy Admin Ownership Of Oracle Transferred to: ' + NEW_PROXY_ADMIN_OWNER)
  }

  // Initialize
  await gemJoin.rely(INTERACTION)

  await clipper.rely(DOG)
  await clipper.rely(INTERACTION)
  await clipper['file(bytes32,uint256)'](ethers.encodeBytes32String('buf'), clipperBuf) // 10%
  await clipper['file(bytes32,uint256)'](ethers.encodeBytes32String('tail'), clipperTail) // 3h reset time
  await clipper['file(bytes32,uint256)'](ethers.encodeBytes32String('cusp'), clipperCusp) // 60% reset ratio
  await clipper['file(bytes32,uint256)'](ethers.encodeBytes32String('chip'), clipperChip) // 0.01% from vow incentive
  await clipper['file(bytes32,uint256)'](ethers.encodeBytes32String('tip'), clipperTip) // 10$ flat fee incentive
  await clipper['file(bytes32,uint256)'](ethers.encodeBytes32String('stopped'), clipperStopped)
  await clipper['file(bytes32,address)'](ethers.encodeBytes32String('spotter'), SPOT)
  await clipper['file(bytes32,address)'](ethers.encodeBytes32String('dog'), DOG)
  await clipper['file(bytes32,address)'](ethers.encodeBytes32String('vow'), VOW)
  await clipper['file(bytes32,address)'](ethers.encodeBytes32String('calc'), ABACI)

  // Transfer Ownerships
  await gemJoin.rely(NEW_OWNER)
  await clipper.rely(NEW_OWNER)

  if (deployer.address !== NEW_OWNER) {
    await gemJoin.deny(deployer.address)
    await clipper.deny(deployer.address)
  }

  console.log('token address: ' + tokenAddress)
  console.log(ILK)

  // Store deployed addresses
  const addresses = {
    symbol,
    tokenAddress,
    ilk: ILK,
    gemJoin: gemJoin.target,
    gemJoinImplementation: gemJoinImplementation,
    clipper: clipper.target,
    clipperImplementation: clipperImplementation,
    oracle: oracle.target,
    oracleImplementation: oracleImplementation,
    oracleInitializeArgs,
    owner: NEW_OWNER,
    proxyAdminOwner: NEW_PROXY_ADMIN_OWNER,
  }

  const json_addresses = JSON.stringify(addresses)
  console.log('json addresses: ', json_addresses)
  const dir = path.join(__dirname, `../../addresses/new_collateral_${symbol}_${hre.network.name}.json`)
  fs.writeFileSync(dir, json_addresses)
  console.log('Addresses Recorded to: ' + dir)

  // Verify
  await hre.run('verify:verify', {address: gemJoin.target})
  await hre.run('verify:verify', {address: clipper.target})
  await hre.run('verify:verify', {address: oracle.target})

  await hre.run('verify:verify', {address: gemJoinImplementation})
  await hre.run('verify:verify', {address: clipperImplementation})
  await hre.run('verify:verify', {address: oracleImplementation, contract: 'contracts/oracle/BtcOracle.sol:BtcOracle'})
}
