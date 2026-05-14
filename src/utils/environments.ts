type Environment = {
  url: string
  apiKey: string
  useDevContracts: boolean
}

const readApiKey = (envVar: string, environment: string): string => {
  const value = process.env[envVar]
  if (!value) {
    throw new Error(
      `${envVar} is required for the '${environment}' environment.`,
    )
  }
  return value
}

export const getEnvironment = (environmentString: string): Environment => {
  switch (environmentString) {
    case 'prod':
      return {
        url: 'https://v1.orchestrator.rhinestone.dev',
        apiKey: readApiKey('PROD_API_KEY', 'prod'),
        useDevContracts: false,
      }
    case 'dev':
      return {
        url: 'https://dev.v1.orchestrator.rhinestone.dev',
        apiKey: readApiKey('DEV_API_KEY', 'dev'),
        useDevContracts: true,
      }
    case 'local':
      return {
        url: 'http://localhost:3000',
        apiKey: readApiKey('LOCAL_API_KEY', 'local'),
        useDevContracts: true,
      }
    default:
      throw new Error('Unknown environment')
  }
}
