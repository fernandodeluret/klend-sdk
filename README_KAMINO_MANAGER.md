# Kamino Manager Guidelines

## 1. Kamino Manager CLI

#### Installation Instructions

Ensure *yarn* is installed first [here](https://classic.yarnpkg.com/lang/en/docs/install/)
```shell
git clone git@github.com:Kamino-Finance/klend-sdk.git
cd klend-sdk
yarn
```

#### Requirements

In order to use the CLI, the followign `.env` configuration is required:
```
ADMIN="admin.json"
RPC="https://rpc.cluster"
KLEND_PROGRAM_ID_MAINNET="KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD"
KVAULT_PROGRAM_ID_MAINNET="kvauTFR8qm1dhniz6pYuBZkuene3Hfrs1VQhVRgCNrr"
KLEND_PROGRAM_ID_STAGING="SLendK7ySfcEzyaFqy93gDnD3RtrpXJcnRwb6zFHJSh"
KVAULT_PROGRAM_ID_STAGING="STkvh7ostar39Fwr4uZKASs1RNNuYMFMTsE77FiRsL2"
```

#### Create a new market
```
yarn kamino-manager create-market --staging --mode execute
```

- **mode** - can have these values:
  - *inspect* - will print an url to the explorer txn inspection, where it can be simulated
  - *simulate* - will print the simulation outputs 
  - *execute* - will execute the transaction
  - *multisig* - will print the bs58 transaction to be used within a multisig
  It is recommended to **1. inspect/simulate** and then **2. execute/multisig**
- **staging** - is a boolean flag. If set, staging programs will be used
- **multisig** - address string to be used as admin PublicKey. To be used in conjunction with multisig mode

#### Add a new asset to market / Create new reserve
```
yarn kamino-manager add-asset-to-market --market market_address --mint token_mint --mint-program-id TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA --reserve-config-path ./configs/reserve_config_example.json --staging --mode execute
```

- **market** - address to create the reserve for
- **mint** - the liquidity mint to create the reserve for
- **mint-program-id** - the program id of the mint - `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA` - spl token program `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb` - for token 2022 token program
- **reserve-config-path** - path to the reserve config to be used. A reserve config example can be found [here](https://github.com/Kamino-Finance/klend-sdk/blob/master/configs/reserve_config_example.json)
- **mode** - can have these values:
  - *inspect* - will print an url to the explorer txn inspection, where it can be simulated
  - *simulate* - will print the simulation outputs 
  - *execute* - will execute the transaction
  - *multisig* - will print the bs58 transaction to be used within a multisig
  It is recommended to **1. inspect/simulate** and then **2. execute/multisig**
- **staging** - is a boolean flag. If set, staging programs will be used
- **multisig** - address string to be used as admin PublicKey. To be used in conjunction with multisig mode

#### Download a reserve config

In order to update a reserve config, you need the latest reserve configuration, to modify. To get the latest, this command can be used:

```
yarn kamino-manager download-reserve-config --reserve reserve_address --staging
```

- **reserve** - address to download the reserve config for
- **staging** - is a boolean flag. If set, staging programs will be used

#### Update a reserve config
```
yarn kamino-manager update-reserve-config --reserve reserve_address --reserve-config-path ./configs/reserve_config_example.json --staging --update-entire-config --mode execute
```

- **reserve** - address to update the reserve config for
- **reserve-config-path** - the path to the config file to be used
- **update-entire-config** - wether to update the entrie reserve config or just the difference between current on-chain state and given config
- **mode** - can have these values:
  - *inspect* - will print an url to the explorer txn inspection, where it can be simulated
  - *simulate* - will print the simulation outputs 
  - *execute* - will execute the transaction
  - *multisig* - will print the bs58 transaction to be used within a multisig
  It is recommended to **1. inspect/simulate** and then **2. execute/multisig**
- **staging** - is a boolean flag. If set, staging programs will be used

A reserve config example can be found [here](https://github.com/Kamino-Finance/klend-sdk/blob/master/configs/reserve_config_example.json)

#### Download a lending market configuration

```
yarn kamino-manager download-lending-market-config --lending-market lending_market_address --staging
```

- **lending-market** - address to download the lending market config for
- **staging** - is a boolean flag. If set, staging programs will be used

#### Download a lending market together with all the associated reserves 

```
yarn kamino-manager download-lending-market-config-and-all-reserves-configs --lending-market lending_market_address --staging
```

- **lending-market** - address to download the lending market config for
- **staging** - is a boolean flag. If set, staging programs will be used

#### Update a lending market
```
yarn kamino-manager update-lending-market-from-config --lending-market lending_market_address --staging --lending-market-config-path ./configs/lending_market_address/market-lending_market_address.json --mode inspect --staging
```

- **lending-market** - address of market to update the config for
- **lending-market-config-path** - the path to the config file to be used
- **mode** - can have these values:
  - *inspect* - will print an url to the explorer txn inspection, where it can be simulated
  - *simulate* - will print the simulation outputs 
  - *execute* - will execute the transaction
  - *multisig* - will print the bs58 transaction to be used within a multisig
  It is recommended to **1. inspect/simulate** and then **2. execute/multisig**
- **staging** - is a boolean flag. If set, staging programs will be used

#### Update a lending market owner
All markets should be owned by a multisig once they are publicly used and maintained. 
However, to start of with, preparing the configuration and adding all the necessary reserves would take longer under a multisig.
In order to migrate from a hot wallet (private key on a local machine) you first need to set the lending_market_owner_cached to the new admin (ideally multisig) using the command above, followed by running the following command:

```
yarn kamino-manager update-lending-market-owner --lending-market lending_market_address --staging --mode multisig
```
**To note** this command can only be executed by the current market lending_market_owner_cached and it will set the lending_market_owner to that address.

#### Create a vault 
```
yarn kamino-manager create-vault --mint token_mint --staging --mode execute
```

- **mint** - the liquidity mint to create the reserve for
- **mode** - can have these values:
  - *inspect* - will print an url to the explorer txn inspection, where it can be simulated
  - *simulate* - will print the simulation outputs 
  - *execute* - will execute the transaction
  - *multisig* - will print the bs58 transaction to be used within a multisig
  It is recommended to **1. inspect/simulate** and then **2. execute/multisig**
- **staging** - is a boolean flag. If set, staging programs will be used
- **multisig** - address string to be used as admin PublicKey. To be used in conjunction with multisig mode

#### Update vault reserve allocation
```
yarn kamino-manager update-vault-reserve-allocation --vault vault_address --reserve reserve_address --allocation-weight number --allocation-cap number --staging --mode execute
```

- **vault** - the vault address to add/update the reserve allocation for
- **reserve** - the reserve address to add/update the reserve allocation for
- **allocation-weight** - the allocation weight for given reserve; only relevant in relation with the other reserve allocation weights
- **allocation-cap** - the allocation cap in decimal (not lamports) for given reserve
- **mode** - can have these values:
  - *inspect* - will print an url to the explorer txn inspection, where it can be simulated
  - *simulate* - will print the simulation outputs 
  - *execute* - will execute the transaction
  - *multisig* - will print the bs58 transaction to be used within a multisig
  It is recommended to **1. inspect/simulate** and then **2. execute/multisig**
- **staging** - is a boolean flag. If set, staging programs will be used
- **multisig** - address string to be used as admin PublicKey. To be used in conjunction with multisig mode

#### Get oracle mappings 
This can be used to get scope oracle mappings to be used when configuring the reserve oracle config.
```
yarn kamino-manager get-oracle-mappings
```

#### Useful to know

**Exploring the created markets** on the webapp can be done by going to 
https://app.kamino.finance/?STAGING_PROGRAM&market=market_address for the staging program
https://app.kamino.finance/?market=market_address for the prod program

**Creating a new keypair to use as an admin** can be achieved by running the following:
```
solana-keygen new -o path_to_private_key.json
```
make sure to keep the private key **private** and only shar ethe public key.
If you forget the publickey you can get it by running the following:
```
solana-keygen pubkey path_to_private_key.json
```

## 2. Kamino Manager Class 

In order to use the kamino manager class, which provides a high-level interface 
for the main actions in regards to managing a market or a vault, you will need to use 
the kamino manager class.

#### Installation Instructions

Run one of the following commands within the project directory you want to use the manager class within
```shell
# npm
npm install @kamino-finance/klend-sdk

# yarn
yarn add @kamino-finance/klend-sdk
```

#### Getting Started

```ts
const connection = new anchor.web3.Connection("rpc.url");
const kaminoManager = new KaminoManager(connection, kLendProgramId, kVaultProgramId);
```

- kLendProgramId and kVaultProgramId can be undefined and default prod programs will be used
- programIds can be found [here](https://github.com/Kamino-Finance/klend-sdk/blob/master/.env.example)

#### Example Usage

For usage examples, a good starting place is [this](https://github.com/Kamino-Finance/klend-sdk/blob/master/tests/kamino_manager_tests/kamino_manager.test.ts) test file
