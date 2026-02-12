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
