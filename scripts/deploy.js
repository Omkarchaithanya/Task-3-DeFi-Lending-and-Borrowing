const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log(`Deploying with: ${deployer.address}`);

  const MockToken = await hre.ethers.getContractFactory("MockToken");
  const token = await MockToken.deploy();
  await token.waitForDeployment();

  const tokenAddress = await token.getAddress();
  console.log(`MockToken deployed: ${tokenAddress}`);

  const DeFiPool = await hre.ethers.getContractFactory("DeFiLendingPool");
  const pool = await DeFiPool.deploy(tokenAddress);
  await pool.waitForDeployment();

  const poolAddress = await pool.getAddress();
  console.log(`DeFiLendingPool deployed: ${poolAddress}`);

  const artifact = await hre.artifacts.readArtifact("DeFiLendingPool");
  const tokenArtifact = await hre.artifacts.readArtifact("MockToken");

  const frontendConfigPath = path.join(__dirname, "..", "frontend", "src", "contractConfig.json");
  const frontendAbiPath = path.join(__dirname, "..", "frontend", "src", "abis", "DeFiLendingPool.json");
  const frontendTokenAbiPath = path.join(__dirname, "..", "frontend", "src", "abis", "MockToken.json");

  fs.mkdirSync(path.dirname(frontendAbiPath), { recursive: true });

  fs.writeFileSync(
    frontendConfigPath,
    JSON.stringify(
      {
        chainId: 31337,
        tokenAddress,
        poolAddress,
      },
      null,
      2
    )
  );

  fs.writeFileSync(frontendAbiPath, JSON.stringify(artifact.abi, null, 2));
  fs.writeFileSync(frontendTokenAbiPath, JSON.stringify(tokenArtifact.abi, null, 2));

  console.log("Frontend contract config and ABI files updated.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
