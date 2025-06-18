import express, { type Request, type Response } from "express";
import { Router } from "express";
import {
  getMeeScanLink,
  testnetMcUSDC,
  toGasTankAccount,
  GasTankAccount,
  GetQuotePayload,
} from "@biconomy/abstractjs";
import {
  erc20Abi,
  formatUnits,
  http,
  isAddress,
  isHash,
  parseUnits,
  stringify,
  type Address,
  type Chain,
  type Hex,
} from "viem";
import { baseSepolia, sepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { readContract } from "viem/actions";

// Configuration for each gas tank to be initialized
interface GasTankConfiguration {
  tokenAddress: Address;
  chain: Chain;
  amountToDeposit: bigint;
  rpcUrl: string;
  privateKey: Hex;
}

// Represents a deployed or deployable gas tank
interface GasTank {
  chainId: number;
  tokenAddress: Address;
  gasTankAddress: Address;
  gasTankAccount: GasTankAccount;
}

// Info returned to clients about a gas tank
interface GasTankInfo {
  chainId: number;
  token: {
    address: Address;
    balance: string;
    decimals: number;
  };
  gasTankAddress: Address;
}

// In-memory storage for all gas tanks, keyed by chainId
const gasTanks = new Map<number, GasTank[]>();

// Private key for EOA that will own/deploy the gas tanks
const privateKey = "CONFIG_YOUR_PK_HERE" as Hex;

// List of gas tank configurations to initialize on startup
const gasTankConfigurations: GasTankConfiguration[] = [
  {
    tokenAddress: testnetMcUSDC.addressOn(baseSepolia.id),
    chain: baseSepolia,
    amountToDeposit: parseUnits("5", 6), // Config the amount to be deposited here
    rpcUrl: baseSepolia.rpcUrls.default.http[0],
    privateKey,
  },
  {
    tokenAddress: testnetMcUSDC.addressOn(sepolia.id),
    chain: sepolia,
    amountToDeposit: parseUnits("5", 6), // Config the amount to be deposited here
    rpcUrl: sepolia.rpcUrls.default.http[0],
    privateKey,
  },
];

// Initializes all sponsorship gas tanks as per configuration
const initializeSponsorship = async (
  gasTankConfigs: GasTankConfiguration[]
) => {
  // Options for the Mee API
  const options = {
    mee: {
      apiKey: "ADD_YOUR_MEE_PROJECT_API_KEY_HERE", // If you remove this, rate limited MEE key will be used
    },
  };

  for (const gasTankConfig of gasTankConfigs) {
    const { rpcUrl, chain, privateKey, tokenAddress, amountToDeposit } =
      gasTankConfig;

    // Create a gas tank account abstraction
    const gasTankAccount = await toGasTankAccount({
      transport: http(rpcUrl),
      chain,
      privateKey,
      options,
    });

    // Get the address of the gas tank account
    const { address: gasTankAddress } = await gasTankAccount.getAddress();

    // Get any existing gas tanks for this chain
    const existingGasTanks = gasTanks.get(chain.id) || [];

    // Prevent duplicate gas tanks for the same token and address
    const isDuplicateGasTank = existingGasTanks.some((gasTank) => {
      if (
        gasTank.tokenAddress.toLowerCase() === tokenAddress.toLowerCase() &&
        gasTank.gasTankAddress.toLowerCase() === gasTankAddress.toLowerCase()
      ) {
        return true;
      }

      return false;
    });

    if (isDuplicateGasTank) continue;

    // Get the EOA account from the private key
    const eoaAccount = privateKeyToAccount(privateKey);

    console.log(
      `Gas tank (${chain.id}) EOA account address: `,
      eoaAccount.address
    );

    console.log(`Gas tank (${chain.id}) account address: `, gasTankAddress);

    // Check if the gas tank account is already deployed
    const isDeployed = await gasTankAccount.isDeployed();

    if (!isDeployed) {
      // Check EOA balance for the token to ensure enough for deployment
      const balance = await readContract(gasTankAccount.publicClient, {
        address: tokenAddress,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [eoaAccount.address],
      });

      // Add a 25% buffer for gas fees
      const amountToDepositWithGasFees = (amountToDeposit * 125n) / 100n;

      if (balance < amountToDepositWithGasFees) {
        console.log(
          "Not enough balance to deploy sponsorship gas tank account. Deployment is skipped"
        );
        continue;
      }

      console.log("Sponsorship gas tank account is being deployed");

      // Deploy the gas tank account and deposit tokens
      const { hash } = await gasTankAccount.deploy({
        tokenAddress,
        amount: amountToDeposit,
      });

      if (hash) {
        // Log the transaction link for deployment
        console.log(
          "Sponsorship gas tank account deployment transaction link: ",
          getMeeScanLink(hash)
        );
      } else {
        console.log("Sponsorship gas tank account was already deployed");
      }
    }

    // Add the new gas tank to the in-memory map
    const newGasTank: GasTank = {
      chainId: chain.id,
      tokenAddress,
      gasTankAddress,
      gasTankAccount,
    };

    let gasTankArr: GasTank[] = [];

    if (existingGasTanks.length > 0) {
      gasTankArr = [...existingGasTanks, newGasTank];
    } else {
      gasTankArr = [newGasTank];
    }

    gasTanks.set(chain.id, gasTankArr);
  }
};

// Initialize all sponsorship gas tanks on startup
await initializeSponsorship(gasTankConfigurations);

const app = express();
const router = Router();
const PORT = process.env.PORT || 3004;

app.use(express.json());
app.use("/v1", router);

// Endpoint to get info about all gas tanks (balances, addresses, etc)
router.get("/sponsorship/info", async (req: Request, res: Response) => {
  try {
    const gasTankInfo: Record<string, GasTankInfo[]> = {};

    // Iterate over all chains and their gas tanks
    const existingGasTanksByChains = gasTanks.entries();

    for (const [chainId, existingGasTanks] of existingGasTanksByChains) {
      gasTankInfo[chainId] = await Promise.all(
        existingGasTanks.map(async (gasTank) => {
          // Get the token balance and decimals for each gas tank
          const { balance, decimals } = await gasTank.gasTankAccount.getBalance(
            {
              tokenAddress: gasTank.tokenAddress,
            }
          );

          return {
            chainId: gasTank.chainId,
            token: {
              address: gasTank.tokenAddress,
              balance: formatUnits(balance, decimals),
              decimals,
            },
            gasTankAddress: gasTank.gasTankAddress,
          };
        })
      );
    }

    res.json(gasTankInfo);
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Failed to fetch gas tank info";
    res.status(400).json({
      errors: [errorMessage],
    });
  }
});

// Endpoint to get the current nonce for a specific gas tank account
router.get(
  "/sponsorship/nonce/:chainId/:gasTankAddress",
  async (req: Request, res: Response) => {
    try {
      const { chainId, gasTankAddress } = req.params;

      if (!chainId) throw new Error("Invalid chain id");

      if (!gasTankAddress || !isAddress(gasTankAddress))
        throw new Error("Invalid gas tank address");

      // Find the gas tank for the given chain and address
      const existingGasTanks = gasTanks.get(Number(chainId)) || [];

      const [gasTank] = existingGasTanks.filter(
        (tank) =>
          tank.gasTankAddress.toLowerCase() === gasTankAddress.toLowerCase()
      );

      if (!gasTank) throw new Error("Gas tank not found");

      // Get the current nonce and nonce key for the account
      const { nonce, nonceKey } = await gasTank.gasTankAccount.getNonce();

      res.json({ nonceKey: nonceKey.toString(), nonce: nonce.toString() });
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Failed to fetch gas tank nonce";
      res.status(400).json({
        errors: [errorMessage],
      });
    }
  }
);

// Endpoint to get the transaction receipt for a sponsorship transaction
router.get(
  "/sponsorship/receipt/:chainId/:hash",
  async (req: Request, res: Response) => {
    try {
      const { hash, chainId } = req.params;

      if (!chainId) throw new Error("Invalid chain id");

      if (!hash || !isHash(hash)) throw new Error("Invalid transaction hash");

      // Get the first gas tank for the given chain (assumes one per chain)
      const existingGasTanks = gasTanks.get(Number(chainId)) || [];

      if (existingGasTanks.length <= 0) throw new Error("No gas tanks found");

      const [gasTank] = existingGasTanks;

      if (!gasTank) throw new Error("Gas tank not found");

      // Fetch the transaction receipt from the public client
      const receipt =
        await gasTank.gasTankAccount.publicClient.getTransactionReceipt({
          hash,
        });

      res.setHeader("Content-Type", "application/json");
      res.send(stringify(receipt));
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Failed to fetch transaction receipt";
      res.status(400).json({
        errors: [errorMessage],
      });
    }
  }
);

// Endpoint to sign a sponsorship quote using a gas tank account
router.post(
  "/sponsorship/sign/:chainId/:gasTankAddress",
  async (req: Request, res: Response) => {
    try {
      const { chainId, gasTankAddress } = req.params;

      const quote = req.body as GetQuotePayload;

      if (!chainId) throw new Error("Invalid chain id");

      if (!gasTankAddress || !isAddress(gasTankAddress))
        throw new Error("Invalid gas tank address");

      // Find the gas tank for the given chain and address
      const existingGasTanks = gasTanks.get(Number(chainId)) || [];

      const [gasTank] = existingGasTanks.filter(
        (tank) =>
          tank.gasTankAddress.toLowerCase() === gasTankAddress.toLowerCase()
      );

      if (!gasTank) throw new Error("Gas tank not found");

      if (
        quote.paymentInfo.token.toLowerCase() !==
        gasTank.tokenAddress.toLowerCase()
      ) {
        throw new Error("Sponsorship token not supported.");
      }

      // Project verification step: Here you can add logic to verify that the sponsorship request
      // is coming from an authorized or valid project. This may involve checking an API key,
      // validating a project ID, or performing other authentication/authorization checks.

      // Custom validation logic can be added here if needed.
      // For example, you may want to check the monthly spending limits, max spend per transaction,
      // or enforce business rules before signing.

      // Sign the sponsorship quote using the gas tank account
      const sponsorshipSignedQuote: GetQuotePayload =
        await gasTank.gasTankAccount.signSponsorship({ quote });

      res.json(sponsorshipSignedQuote);
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Failed to fetch transaction receipt";
      res.status(400).json({
        errors: [errorMessage],
      });
    }
  }
);

// Error handling middleware for all unhandled errors
app.use((err: Error, request: Request, response: Response, next: any) => {
  response.status(400).json({
    errors: [err.message || "Internal server error"],
  });
});

// Start the Express server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

export default app;
