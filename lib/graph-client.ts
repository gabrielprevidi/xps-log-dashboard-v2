import { ClientSecretCredential } from '@azure/identity'
import { Client } from '@microsoft/microsoft-graph-client'
import { TokenCredentialAuthenticationProvider } from '@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials'

let _graphClient: Client | null = null

export function getGraphClient(): Client {
  if (!_graphClient) {
    const credential = new ClientSecretCredential(
      process.env.MS_TENANT_ID!.trim(),
      process.env.MS_CLIENT_ID!.trim(),
      process.env.MS_CLIENT_SECRET!.trim()
    )

    const authProvider = new TokenCredentialAuthenticationProvider(credential, {
      scopes: ['https://graph.microsoft.com/.default'],
    })

    _graphClient = Client.initWithMiddleware({ authProvider })
  }
  return _graphClient
}

// Alias para compatibilidade com código existente
export const graphClient = new Proxy({} as Client, {
  get(_target, prop) {
    return (getGraphClient() as unknown as Record<string | symbol, unknown>)[prop]
  },
})
