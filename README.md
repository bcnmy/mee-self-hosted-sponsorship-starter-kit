# self-hosted-sponsorship

This repository demonstrates how to setup the self hosted multichain sponsorship service for MEE stack.

### First steps:
1. Configure your private key in the `index.ts` file
2. Configure your MEE API key in the `index.ts` file (Optional: Defaults to Rate limited API key. But we suggest not to go with this for production)

### To install dependencies:

```bash
bun install
```

### To run:

```bash
bun run index.ts
```

### How to configure different gas tanks
In the `gasTankConfigurations` variable, you can add your own gas tank config as needed

<b>Example:</b>
```
const gasTankConfigurations: GasTankConfiguration[] = [
  {
    tokenAddress: "Your preferred token address",
    chain: baseSepolia, // Chain from viem chain list
    amountToDeposit: parseUnits("5", 6), // Config the amount to be deposited initially for your gas tank
    rpcUrl: "Paid RPC url",
    privateKey, // Your private key
  },
];
```

### How to use custom headers in SDK

<b>Example:</b>
```
sponsorshipOptions: {
  ...
  customHeaders: {
    your: "custom-headers"
  },
  ...
},
```

### API Standards to follow:
1. All the API endpoint urls should be exactly same as example to be compatible with MEE stack
2. All the request and response structure should be same as example to be compatible with MEE stack
3. The error handling and error response should be same as example to be compatible with MEE stack

### Production Best Practises:
1. Use private keys securely. We suggest to use encrypted ENV or any different strategy of your choice
2. Fund your gas tank with USDC token or any other stable coins
3. Gas tank doesn't support Native token for sponsorship, so please avoid that.
4. Deploy a gas tank in Cheap L2 networks and allow your users to consume sponsorship from there. It is the best way to achieve sponsorship with cheap gas price.
5. Use your own API protection using some authentication or authorization strategies. SDK can send custom headers where your backend API key can be passed to authenticate users/devs to use sponsorship.
6. This repository deploys the gas tank automatically. So it is very important that the gas tank should be deployed

This project was created using `bun init` in bun v1.2.9. [Bun](https://bun.sh) is a fast all-in-one JavaScript runtime.
