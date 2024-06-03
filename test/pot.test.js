const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Pot contract", function() {
    let Pot;
    let pot;
    let owner;
    let addr1;
    let addr2;
    let addrs;
    let ERC20Mock;
    let mockToken;
    const DSR_10 = '1000000003022266000000000000';  // 10% interest rate
    const DSR_20 = '1000000005781378656804590540';  // 20% interest rate


    beforeEach(async function() {
        [owner, addr1, addr2, ...addrs] = await ethers.getSigners();
        Pot = await ethers.getContractFactory("Pot");

        ERC20Mock = await ethers.getContractFactory("ERC20Mock");

        pot = await Pot.deploy();
        mockToken = await ERC20Mock.deploy('lisUSD','lisUSD',ethers.parseEther('10000'));
        // console.log("mock token address: ", mockToken.target);
        // console.log("pot address: ", pot.target);


        await pot.waitForDeployment();
        await mockToken.waitForDeployment();
        await pot.initialize('lisUSD', 'lisUSD', mockToken.target, 0, 5);
        await mockToken.mint(owner.address, ethers.parseEther('1000'));
        await mockToken.connect(owner).approve(pot.target, ethers.parseEther('1000'));
    });

    describe("Deployment", function() {
        it("Should set the right name,symbol,HAY,exitDelay,flashLoanDelay", async function() {
            expect(await pot.name()).to.equal("lisUSD");
            expect(await pot.symbol()).to.equal("lisUSD");
            expect(await pot.HAY()).to.equal(mockToken.target);
            expect(await pot.exitDelay()).to.equal(0);
            expect(await pot.flashLoanDelay()).to.equal(5);
        });

        it("Should set the right owner", async function () {
            expect(await pot.wards(owner.address)).to.equal(1);
        });

        it("Should not set non-owners as wards", async function () {
            expect(await pot.wards(addr1.address)).to.equal(0);
        });
    });

    describe("Wards authorization", function () {
        it("Should allow owner to set wards", async function () {
            await pot.connect(owner).rely(addr1.address);
            expect(await pot.wards(addr1.address)).to.equal(1);
        });

        it("Should not allow non-owners to set wards", async function () {
            await expect(pot.connect(addr1).rely(addr2.address)).to.be.revertedWith("Pot/not-authorized");
        });

        it("Should allow owner to remove wards", async function () {
            await pot.connect(owner).rely(addr1.address);
            await pot.connect(owner).deny(addr1.address);
            expect(await pot.wards(addr1.address)).to.equal(0);
        });

        it("Should not allow non-owners to remove wards", async function () {
            await expect(pot.connect(addr1).deny(addr1.address)).to.be.revertedWith("Pot/not-authorized");
        });
    });

    describe("Join function", function () {
        it("Should increase the balance of the user", async function () {
            const initialBalance = await pot.balanceOf(owner.address);
            await pot.connect(owner).join(ethers.parseEther('1'));
            const finalBalance = await pot.balanceOf(owner.address);
            expect(finalBalance).to.equal(initialBalance + ethers.parseEther('1'));
        });

        it("Should increase the total supply", async function () {
            const initialSupply = await pot.totalSupply();
            await pot.connect(owner).join(ethers.parseEther('1'));
            const finalSupply = await pot.totalSupply();
            expect(finalSupply).to.equal(initialSupply + ethers.parseEther('1'));
        });

        it("Should revert if the contract is not live", async function () {
            await pot.cage();
            await expect(pot.connect(owner).join(ethers.parseEther('1'))).to.be.revertedWith("Pot/not-live");
        });

        it("Should emit a Join event", async function () {
            await expect(pot.connect(owner).join(ethers.parseEther('1'))).to.emit(pot, 'Join').withArgs(owner.address, ethers.parseEther('1'));
        });
    });

    describe("Deposit and interest", function () {
        it("Should correctly deposit funds and calculate interest, join before set dsr", async function() {
            await pot.connect(owner).join(ethers.parseEther('10'));

            expect(await pot.balanceOf(owner.address)).to.equal(ethers.parseEther('10'));

            // Emulate elapsing time and compounding interest by updating dsr
            await pot.connect(owner).file(ethers.encodeBytes32String("dsr"), DSR_10);  // Setting 10% interest rate

            // Some time elapses
            await ethers.provider.send("evm_increaseTime", [60 * 60 * 24 * 365]);  // One year
            await ethers.provider.send("evm_mine");

            // Update chi to reflect the new dsr
            await pot.connect(owner).drip();

            let expectedReward = ethers.parseEther('1');  // 10 tokens * 10% interest
            let actualReward = await pot.earned(owner.address);
            //console.log("actualReward: ", actualReward);
            expect(await pot.earned(owner.address)).to.approximately(expectedReward, 1e12);
        });

        it("Should correctly deposit funds and calculate interest, waiting 1 year after setting dsr then join", async function() {
            await pot.connect(owner).file(ethers.encodeBytes32String("dsr"), DSR_10);  // Setting 10% interest rate

            await ethers.provider.send("evm_increaseTime", [60 * 60 * 24 * 365]);  // One year
            await ethers.provider.send("evm_mine");

            // wait 1 year then join
            await pot.connect(owner).join(ethers.parseEther('10'));

            expect(await pot.balanceOf(owner.address)).to.equal(ethers.parseEther('10'));
            // Emulate elapsing time and compounding interest by updating dsr

            // Some time elapses
            await ethers.provider.send("evm_increaseTime", [60 * 60 * 24 * 365]);  // One year
            await ethers.provider.send("evm_mine");

            // Update chi to reflect the new dsr
            await pot.connect(owner).drip();

            let expectedReward = ethers.parseEther('1.1');  // 10 tokens * 10% interest
            let actualReward = await pot.earned(owner.address);
            //console.log("actualReward: ", actualReward);
            expect(await pot.earned(owner.address)).to.approximately(expectedReward, 1e12);
        });

        it("Should correctly deposit funds and calculate interest even with DSR changes", async function() {
            await pot.connect(owner).join(ethers.parseEther('10'));

            expect(await pot.balanceOf(owner.address)).to.equal(ethers.parseEther('10'));

            // Emulate elapsing time and compounding interest by updating dsr
            await pot.connect(owner).file(ethers.encodeBytes32String("dsr"), DSR_10);  // Setting 10% interest rate
            // Some time elapses
            await ethers.provider.send("evm_increaseTime", [60 * 60 * 24 * 365 / 2]);  // Half a year
            await ethers.provider.send("evm_mine");

            // Update chi to reflect the new dsr
            await pot.connect(owner).drip();
            let expectedReward1 = ethers.parseEther('0.488088');
            expect(await pot.earned(owner.address)).to.approximately(expectedReward1, 1e12);

            // Now update the dsr
            await pot.connect(owner).file(ethers.encodeBytes32String("dsr"), DSR_20);  // Setting 20% interest rate
            // Some more time elapses
            await ethers.provider.send("evm_increaseTime", [60 * 60 * 24 * 365 / 2]);  // Half a year
            await ethers.provider.send("evm_mine");

            // Update chi again to reflect the new dsr
            await pot.connect(owner).drip();

            //console.log("actualReward: ", await pot.earned(owner.address));

            // The account's balance should've increased accordingly
            let expectedReward2 = ethers.parseEther('1.489125');
            expect(await pot.earned(owner.address)).to.approximately(expectedReward2, 1e12);
        });
    });


    describe("File function", function() {
        it("Should correctly set and change the DSR using file function", async function() {
            // File new DSR
            await pot.connect(owner).file(ethers.encodeBytes32String("dsr"), DSR_10);
            expect(await pot.dsr()).to.equal(DSR_10);

            // Change DSR
            await pot.connect(owner).file(ethers.encodeBytes32String("dsr"), DSR_20);
            expect(await pot.dsr()).to.equal(DSR_20);
        });


        it("Should deny access from unauthorized users to file function", async function() {
            // Attempt to file new DSR from unauthorized address
            await pot.connect(owner).file(ethers.encodeBytes32String("dsr"), DSR_10);
            expect(await pot.dsr()).to.equal(DSR_10);

            await expect(pot.connect(addr1).file(ethers.encodeBytes32String("dsr"), DSR_20)).to.be.revertedWith("Pot/not-authorized");
            expect(await pot.dsr()).to.equal(DSR_10);
        });
    });

    describe("Exit function", function() {
        it("Should correctly withdraw funds and interest using exit function", async function() {
            // User deposits MockTokens
            await pot.join(ethers.parseEther('10'), { from: owner.address });
            expect(await pot.balanceOf(owner.address)).to.equal(ethers.parseEther('10'));

            let userBalanceBefore = await mockToken.balanceOf(owner.address);
            let potBalanceBefore = await mockToken.balanceOf(pot.target);
            // console.log("balanceBefore: %s, potBalanceBefore: %s", userBalanceBefore.toString(), potBalanceBefore.toString());

            // Update dsr
            await pot.file(ethers.encodeBytes32String("dsr"), DSR_10, { from: owner.address });
            await ethers.provider.send("evm_increaseTime", [60 * 60 * 24 * 365]); // One year
            await ethers.provider.send("evm_mine");

            // Update chi to reflect the new dsr
            await pot.drip({ from: owner.address });

            await pot.addOperator(owner);
            expect(await pot.operators(owner)).to.equal(1);

            //deposit more for user interest
            await pot.replenish(ethers.parseEther('10'), { from: owner.address });

            // console.log("user earned: ", await pot.earned(owner.address));
            //
            // console.log("balance of pot: %s", await mockToken.balanceOf(pot.target));
            //
            // console.log("owner: %s, pot: %s", owner.address, pot.target);
            // User withdraws funds and interest
            await pot.connect(owner).exit(ethers.parseEther('10'));

            // Check Pot balance, balance is about 9 after user withdraw funds and interest
            expect(await mockToken.balanceOf(pot.target)).to.approximately(ethers.parseEther('9'), 1e12);
        });
    });

    describe("Operations", function() {
        it("Should add an operator", async function() {
            await pot.addOperator(addr1);
            expect(await pot.operators(addr1)).to.equal(1);
        });

        it("Should remove an operator", async function() {
            await pot.addOperator(addr1);
            await pot.removeOperator(addr1);
            expect(await pot.operators(addr1)).to.equal(0);
        });
    });
});
