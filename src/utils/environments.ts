export const getEnvironment = (environmentString: string) => {
  switch (environmentString) {
    case 'prod':
      return {
        url: undefined,
        apiKey: process.env.PROD_API_KEY,
        useDevContracts: false,
      }
    case 'dev':
      return {
        url: 'https://dev.v1.orchestrator.rhinestone.dev',
        apiKey: process.env.DEV_API_KEY,
        useDevContracts: true,
      }
    case 'local':
      return {
        url: 'http://localhost:3000',
        apiKey: process.env.LOCAL_API_KEY,
        useDevContracts: true,
      }
    default:
      throw new Error('Unknown environment')
  }
}

const DEPOSIT_SIGNER_ADDRESSES: Record<string, `0x${string}`> = {
  prod: '0x177bfcdd15bc01e99013dcc5d2b09cd87a18ce9c',
  dev: '0xd452930bf270723b2048c2ec9b65a336ea45b4f9',
}

const DEPOSIT_ORCHESTRATOR_URLS: Record<string, string> = {
  prod: 'https://v1.orchestrator.rhinestone.dev',
  dev: 'https://dev.v1.orchestrator.rhinestone.dev',
}

export const getDepositServiceConfig = (environmentString: string) => {
  const orchestratorUrl = DEPOSIT_ORCHESTRATOR_URLS[environmentString]
  if (!orchestratorUrl) {
    throw new Error(
      `Deposit mode not supported for environment '${environmentString}'`,
    )
  }

  const signerAddress = DEPOSIT_SIGNER_ADDRESSES[environmentString]
  if (!signerAddress) {
    throw new Error(
      `Deposit mode not supported for environment '${environmentString}': no signer address`,
    )
  }

  return {
    url: `${orchestratorUrl}/deposit-processor`,
    apiKey: process.env.PROD_API_KEY!,
    orchestratorUrl,
    signerAddress,
  }
}
