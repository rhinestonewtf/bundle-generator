export const getEnvironment = (environmentString: string) => {
  switch (environmentString) {
    case 'prod':
      return {
        url: 'https://v1.orchestrator.rhinestone.dev',
        apiKey: process.env.PROD_API_KEY,
        useDevContracts: false,
        depositSignerAddress: '0x177bfcdd15bc01e99013dcc5d2b09cd87a18ce9c' as `0x${string}`,
      }
    case 'dev':
      return {
        url: 'https://dev.v1.orchestrator.rhinestone.dev',
        apiKey: process.env.DEV_API_KEY,
        useDevContracts: true,
        depositSignerAddress: '0xd452930bf270723b2048c2ec9b65a336ea45b4f9' as `0x${string}`,
      }
    case 'local':
      return {
        url: 'http://localhost:3000',
        apiKey: process.env.LOCAL_API_KEY,
        useDevContracts: true,
        depositSignerAddress: undefined,
      }
    default:
      throw new Error('Unknown environment')
  }
}

export const getDepositServiceConfig = (environmentString: string) => {
  const env = getEnvironment(environmentString)

  if (!env.depositSignerAddress) {
    throw new Error(
      `Deposit mode not supported for environment '${environmentString}': no signer address`,
    )
  }

  return {
    url: `${env.url}/deposit-processor`,
    apiKey: process.env.PROD_API_KEY!,
    orchestratorUrl: env.url,
    signerAddress: env.depositSignerAddress,
  }
}
